// ============================================================
// GitHub Tools (Extended)
// ============================================================
// github_push / github_create_repo / github_read / github_list / github_delete / github_merge_to_main
// github_close_pull_request / github_compare_branches / github_get_pull_request
// github_create_pull_request / github_merge_pull_request (2026-08-29 ADD: PR工具适配分支保护)
// 2026-08-17 FIX: btoa cannot handle Chinese -> UTF-8 safe base64
// 2026-08-25 ADD: closePR/compare/getPR + push-main warning
// 2026-09-01 ADD v6.3: GITHUB_TOOL_DEFS 元数据（自动注册真相源）+ github_auto_sync 自动同步
// 2026-09-01 ADD v6.4: 基础工具第一阶段——github_read 范围读取+截断标记 / github_push 写入后 size 校验 / github_copy copy 后 size 校验（「API 成功 ≠ 文件成功」）
import { getEnabledSkills, addSkill } from '../utils/skills.js';
import { validatePatch, applyPatch, resolvePatchTargetPolicy, validatePatchTargetFile } from '../modules/patch_engine.js';
import { validateRepoRelativePath } from '../utils/helpers.js';
import { handleCloudflareTool } from '../modules/cloudflare/worker_status.js';
import { getContent, listContents, pushFileFromStorage, editFileByAnchors, deleteFile, copyFile, movePath, formatContentsResult } from '../modules/github/contents.js';
// Guarded recovery primitive for restoring the development ref to an exact commit.
// It never permits main or another branch, and requires an expected current HEAD.
export async function restoreBranchReference({
    baseUrl, headers, branch = 'dev', targetSha, expectedSha, fetchImpl = fetch
} = {}) {
    const fail = (code, message, extra = {}) => ({ ok: false, code, message, ...extra });
    const validSha = value => typeof value === 'string' && /^[0-9a-f]{40}$/i.test(value);
    const readJson = async response => {
        try { return await response.json(); } catch { return {}; }
    };

    if (branch !== 'dev') return fail('BRANCH_NOT_ALLOWED', '精确恢复模式只允许操作 dev。');
    if (!validSha(targetSha) || !validSha(expectedSha)) {
        return fail('INVALID_SHA', 'targetSha 和 expectedSha 都必须是完整的 40 位 commit SHA。');
    }

    let response;
    let payload;
    try {
        response = await fetchImpl.call(globalThis, `${baseUrl}/commits/${targetSha}`, { headers });
        payload = await readJson(response);
    } catch (error) {
        return fail('TARGET_COMMIT_READ_FAILED', error?.message || String(error));
    }
    if (!response.ok || (payload.sha || '').toLowerCase() !== targetSha.toLowerCase()) {
        return fail('TARGET_COMMIT_NOT_FOUND', payload.message || `HTTP ${response.status}`, { status: response.status });
    }

    const refUrl = `${baseUrl}/git/ref/heads/dev`;
    try {
        response = await fetchImpl.call(globalThis, refUrl, { headers });
        payload = await readJson(response);
    } catch (error) {
        return fail('CURRENT_REF_READ_FAILED', error?.message || String(error));
    }
    if (!response.ok) return fail('CURRENT_REF_READ_FAILED', payload.message || `HTTP ${response.status}`, { status: response.status });
    const currentSha = payload.object?.sha;
    if (!currentSha || currentSha.toLowerCase() !== expectedSha.toLowerCase()) {
        return fail('HEAD_MISMATCH', 'dev 当前 HEAD 已变化，拒绝覆盖。', { currentSha: currentSha || null });
    }

    try {
        response = await fetchImpl.call(globalThis, `${baseUrl}/git/refs/heads/dev`, {
            method: 'PATCH',
            headers,
            body: JSON.stringify({ sha: targetSha, force: true })
        });
        payload = await readJson(response);
    } catch (error) {
        return fail('REF_UPDATE_FAILED', error?.message || String(error), { previousSha: currentSha });
    }
    if (!response.ok) return fail('REF_UPDATE_FAILED', payload.message || `HTTP ${response.status}`, { status: response.status, previousSha: currentSha });

    try {
        response = await fetchImpl.call(globalThis, refUrl, { headers });
        payload = await readJson(response);
    } catch (error) {
        return fail('REF_VERIFY_FAILED', error?.message || String(error), { previousSha: currentSha });
    }
    const verifiedSha = payload.object?.sha;
    if (!response.ok || !verifiedSha || verifiedSha.toLowerCase() !== targetSha.toLowerCase()) {
        return fail('REF_VERIFY_FAILED', payload.message || '更新后回读的 dev HEAD 与目标 SHA 不一致。', {
            status: response.status, previousSha: currentSha, verifiedSha: verifiedSha || null
        });
    }
    return { ok: true, branch: 'dev', previousSha: currentSha, sha: verifiedSha };
}


// ============================================================
// GITHUB_TOOL_DEFS - 所有 github_* 工具的元数据（唯一真相源）
// 用于：自动注册 / 差异检测 / help() 展示
// 原则：代码是权威，Supabase skills 表只是缓存
// ============================================================
// [github_edit 增强] ANCHOR_NOT_FOUND 时给出最接近候选+差异提示·治失败不可诊断（2026-10-20）
function firstDiff(aArr, bArr) {
    var n = Math.max(aArr.length, bArr.length);
    for (var i = 0; i < n; i++) {
        var a = aArr[i], b = bArr[i];
        if (a !== b) return { pos: i, a: a == null ? '<end>' : a, b: b == null ? '<end>' : b };
    }
    return null;
}
function findSimilarCandidates(contentSrc, anchor, topN, minSim) {
    if (topN == null) topN = 3;
    if (minSim == null) minSim = 0.5;
    var ac = Array.from(anchor);
    var acSet = new Set(ac);
    var lines = contentSrc.split('\n');
    var scored = [];
    for (var li = 0; li < lines.length; li++) {
        var L = Array.from(lines[li]);
        var hit = 0;
        for (var k = 0; k < L.length; k++) if (acSet.has(L[k])) hit++;
        var sim = L.length ? hit / Math.max(L.length, ac.length) : 0;
        scored.push({ li: li, line: lines[li], sim: sim });
    }
    scored.sort(function (a, b) { return b.sim - a.sim; });
    var hints = [];
    for (var s2 = 0; s2 < scored.length && s2 < topN; s2++) {
        var s = scored[s2];
        if (s.sim < minSim) continue;
        var d = firstDiff(ac, Array.from(s.line));
        var pct = Math.round(s.sim * 100);
        var msg = 'L' + (s.li + 1) + '(sim ' + pct + '%): ' + s.line.slice(0, 70);
        if (d) msg += '  << 差异#' + d.pos + ': old「' + d.a + '」≠ 该行「' + d.b + '」';
        hints.push(msg);
    }
    return hints.length ? hints.join('\n  ') : '';
}

export const GITHUB_TOOL_DEFS = [
    { name: 'github_push', description: '【创建入口】推送 NEW 文件到 GitHub 仓库（目标文件不存在时）。内容通过 content_url（我们自己的 Supabase 存储 url，先经 /upload）传入。如果文件已存在会被拒绝（GITHUB_PUSH_EXISTING_FILE）——修改已有文件请用 github_edit（读→改→写回一次完成，服务端精确替换，不用上传）。省略 branch 时默认 dev；写入后以 blob SHA 与字节数验证，允许空文件。', input_schema: { type: 'object', properties: { path: { type: 'string', description: '文件路径' }, content_url: { type: 'string', description: '必填，文件内容来源：仅限我们自己的 Supabase 存储 url（*.supabase.co/storage/v1/object/public/files/...），先经 /upload 上传本地文件拿到 url 再传这里' }, branch: { type: 'string', description: '分支名（默认dev）' }, message: { type: 'string', description: '提交信息' }, repo: { type: 'string', description: '可选，目标仓库（如 wovowx/ZivenLab），默认 GITHUB_REPO' } }, required: ['path', 'content_url'] }, handler: 'github', category: 'GitHub', tags: ['GitHub', '推送'] },
    { name: 'github_create_repo', description: '在 GitHub 创建新仓库。', input_schema: { type: 'object', properties: { repo: { type: 'string', description: '仓库名称' }, private: { type: 'boolean', description: '是否私有（默认false）' }, description: { type: 'string', description: '仓库描述' } }, required: ['repo'] }, handler: 'github', category: 'GitHub', tags: ['GitHub', '仓库'] },
    { name: 'github_read', description: '读取 GitHub 仓库文件内容（UTF-8 安全，支持中文）。支持 start_line/end_line 范围读取；默认最多返回前200行；返回 total_lines/returned_lines/truncated/has_more，明确是否截断。', input_schema: { type: 'object', properties: { path: { type: 'string', description: '文件路径' }, branch: { type: 'string', description: '分支名（默认main）' }, repo: { type: 'string', description: '可选，目标仓库' }, start_line: { type: 'number', description: '起始行（1-based，可选）' }, end_line: { type: 'number', description: '结束行（包含，可选）' } }, required: ['path'] }, handler: 'github', category: 'GitHub', tags: ['GitHub', '读取'] },
    { name: 'github_list', description: '列出 GitHub 仓库目录内容（文件/子目录）。', input_schema: { type: 'object', properties: { path: { type: 'string', description: '目录路径（默认根）' }, branch: { type: 'string', description: '分支名（默认main）' }, repo: { type: 'string', description: '可选，目标仓库' } } }, handler: 'github', category: 'GitHub', tags: ['GitHub', '目录'] },
    { name: 'github_delete', description: '删除 GitHub 仓库文件。', input_schema: { type: 'object', properties: { path: { type: 'string', description: '文件路径' }, branch: { type: 'string', description: '分支名（默认dev）' }, message: { type: 'string', description: '提交信息' }, repo: { type: 'string', description: '可选，目标仓库' } }, required: ['path'] }, handler: 'github', category: 'GitHub', tags: ['GitHub', '删除'] },
    { name: 'github_merge_to_main', description: '智能三步合并 dev 到 main：建PR→查可合并→合并。merge_method **默认 rebase**（标准发布策略，防标题重复）；显式 merge 必须带 commit_title + merge_reason（禁止策略含糊）。合并成功后自动 sync dev。', input_schema: { type: 'object', properties: { branch: { type: 'string', description: '源分支（默认dev）' }, title: { type: 'string', description: 'PR标题' }, body: { type: 'string', description: 'PR描述' }, merge_method: { type: 'string', enum: ['merge', 'rebase', 'squash'], description: '合并方式（推荐rebase或merge）' }, commit_title: { type: 'string', description: '自定义合并 commit 标题（版本号+名称）' }, repo: { type: 'string', description: '可选，目标仓库' } } }, handler: 'github', category: 'GitHub', tags: ['GitHub', '合并', 'PR'] },
    { name: 'github_create_pull_request', description: '新建 Pull Request。', input_schema: { type: 'object', properties: { head: { type: 'string', description: '源分支（默认dev）' }, base: { type: 'string', description: '目标分支（默认main）' }, title: { type: 'string', description: 'PR标题' }, body: { type: 'string', description: 'PR描述' }, repo: { type: 'string', description: '可选，目标仓库' } }, required: ['title'] }, handler: 'github', category: 'GitHub', tags: ['GitHub', 'PR'] },
    { name: 'github_merge_pull_request', description: '合并指定 Pull Request。支持 merge_method（merge/squash/rebase）和 commit_title（自定义 commit 标题，从版本号开始）。合并成功后自动 sync dev。', input_schema: { type: 'object', properties: { pull_number: { type: 'number', description: 'PR编号' }, merge_method: { type: 'string', enum: ['merge', 'rebase', 'squash'], description: '合并方式' }, commit_title: { type: 'string', description: '自定义 commit 标题（版本号+名称）' }, title: { type: 'string', description: '自定义 commit 标题（别名）' }, repo: { type: 'string', description: '可选，目标仓库' } }, required: ['pull_number'] }, handler: 'github', category: 'GitHub', tags: ['GitHub', '合并', 'PR'] },
    { name: 'github_edit', description: '服务端编辑文件：读 GitHub 文件 → 按 operations 数组（{old,new} 精确替换，锚点必须唯一）→ 写回同一分支。一次调用完成修改+提交+size 校验，不用先 /upload。默认 dev 分支（push 到 main 会被 release_guard 拦）。dry_run=true 预览不写。', input_schema: { type: 'object', properties: { path: { type: 'string', description: '文件路径' }, branch: { type: 'string', description: '目标分支（默认dev）' }, message: { type: 'string', description: 'commit message（发布必须 vX.Y.Z: 名称）' }, operations: { type: 'array', items: { type: 'object', properties: { old: { type: 'string', description: '要替换的原文' }, new: { type: 'string', description: '替换成的新内容' } } }, description: '替换操作列表：[{old,new}]，每个 old 必须唯一匹配' }, dry_run: { type: 'boolean', description: '预览不写入（默认false）' }, repo: { type: 'string', description: '可选，目标仓库' } }, required: ['path', 'operations'] }, handler: 'github', category: 'GitHub', tags: ['GitHub', '编辑', '修改'] },
    { name: 'github_close_pull_request', description: '关闭废弃的 Pull Request。', input_schema: { type: 'object', properties: { pull_number: { type: 'number', description: 'PR编号' }, repo: { type: 'string', description: '可选，目标仓库' } }, required: ['pull_number'] }, handler: 'github', category: 'GitHub', tags: ['GitHub', 'PR'] },
    { name: 'github_compare_branches', description: '对比两个分支差异（base...head），返回值：ahead/behind/status/files。', input_schema: { type: 'object', properties: { base: { type: 'string', description: '基础分支（默认main）' }, head: { type: 'string', description: '对比分支（默认dev）' }, repo: { type: 'string', description: '可选，目标仓库' } } }, handler: 'github', category: 'GitHub', tags: ['GitHub', '分支', '对比'] },
    { name: 'github_get_pull_request', description: '查询单个 Pull Request 详情（state/merged/mergeable）。', input_schema: { type: 'object', properties: { pull_number: { type: 'number', description: 'PR编号' }, repo: { type: 'string', description: '可选，目标仓库' } }, required: ['pull_number'] }, handler: 'github', category: 'GitHub', tags: ['GitHub', 'PR'] },
    { name: 'github_create_branch', description: '从指定分支新建分支（多仓库兼容）。', input_schema: { type: 'object', properties: { name: { type: 'string', description: '新分支名' }, branch: { type: 'string', description: '新分支名（与name二选一）' }, from: { type: 'string', description: '源分支（默认main）' }, base: { type: 'string', description: '源分支（与from二选一）' }, repo: { type: 'string', description: '可选，目标仓库' } } }, handler: 'github', category: 'GitHub', tags: ['GitHub', '分支'] },
    { name: 'github_sync_branch', description: '常规模式将目标分支同步到源分支；精确恢复模式仅允许 dev：from="sha:<40位commit SHA>"、base="<预期当前dev HEAD SHA>"。执行前校验目标提交和当前HEAD，更新后回读验证。', input_schema: { type: 'object', properties: { name: { type: 'string', description: '目标分支（默认dev；精确恢复仅允许dev）' }, branch: { type: 'string', description: '目标分支（与name二选一）' }, from: { type: 'string', description: '源分支；或 sha:<40位commit SHA> 进入精确恢复模式' }, base: { type: 'string', description: '常规模式是源分支别名；精确恢复模式是预期当前dev HEAD SHA' }, repo: { type: 'string', description: '可选，目标仓库' } } }, handler: 'github', category: 'GitHub', tags: ['GitHub', '分支', '同步', '恢复'] },
    { name: 'github_copy', description: '跨仓库/跨分支复制文件（GitHub → GitHub，内容不经过 Agent 上下文，由 MCP 服务端内部搬运）。参数：source_repo/source_branch/source_path/target_repo/target_branch/target_path/overwrite/message。复制后自动做 size 校验，源/目标 blob SHA 不一致返回 COPY_VERIFY_FAILED；允许空文件。target_branch 省略时默认 dev。', input_schema: { type: 'object', properties: { source_repo: { type: 'string', description: '源仓库（如 wovowx/ZivenLab）' }, source_branch: { type: 'string', description: '源分支（默认main）' }, source_path: { type: 'string', description: '源文件路径' }, target_repo: { type: 'string', description: '目标仓库（如 wovowx/mcp-memory）' }, target_branch: { type: 'string', description: '目标分支（默认dev）' }, target_path: { type: 'string', description: '目标文件路径' }, overwrite: { type: 'boolean', description: '目标存在时是否覆盖（默认false）' }, message: { type: 'string', description: '提交信息（可选）' } }, required: ['source_repo', 'source_path', 'target_repo', 'target_path'] }, handler: 'github', category: 'GitHub', tags: ['GitHub', '复制', '搬运'] },
    { name: 'github_move', description: '移动/搬移文件或目录（GitHub → GitHub，内容不经过 Agent 上下文，由 MCP 服务端内部搬运）。源是文件→单文件搬移；源是目录→自动递归收集全部文件，逐个 copy 并校验 blob SHA；递归树截断时安全回退枚举；全部复制验证后重新检查源 SHA，只有未变化的源才删除。部分失败会准确报告已复制/已删除/保留源文件。参数：source_repo/source_branch/source_path/target_repo/target_branch/target_path/overwrite/recursive/message。默认 recursive=true。', input_schema: { type: 'object', properties: { source_repo: { type: 'string', description: '源仓库（如 wovowx/ZivenLab）' }, source_branch: { type: 'string', description: '源分支（默认dev；移动会删除源，禁止 main）' }, source_path: { type: 'string', description: '源文件或目录路径' }, target_repo: { type: 'string', description: '目标仓库（如 wovowx/mcp-memory）' }, target_branch: { type: 'string', description: '目标分支（默认dev）' }, target_path: { type: 'string', description: '目标文件或目录路径' }, overwrite: { type: 'boolean', description: '目标已存在时是否覆盖（默认false）' }, recursive: { type: 'boolean', description: '源是目录时是否递归（默认true）' }, message: { type: 'string', description: '提交信息（可选）' } }, required: ['source_repo', 'source_path', 'target_repo', 'target_path'] }, handler: 'github', category: 'GitHub', tags: ['GitHub', '移动', '搬运', '目录'] },
    { name: 'github_auto_sync', description: '自动同步 github_* 工具注册表：对比 GITHUB_TOOL_DEFS（代码真相源）与 Supabase skills 表，新增自动补注册，变化/孤儿列出待确认。', input_schema: { type: 'object', properties: { dry_run: { type: 'boolean', description: '仅报告不写入（默认false）' } } }, handler: 'github', category: 'GitHub', tags: ['GitHub', '自动注册', '同步'] },
    { name: 'cloudflare_deploy_status', description: '查询 Cloudflare Workers 部署记录与版本列表（部署日志）：读 Worker 的 deployments + versions，返回最近部署时间/来源/ID。支持 verify_main=true 自动对比 main HEAD commit vs 最新部署版本，返回 VERIFIED/DEPLOY_UNVERIFIED（部署后必查，柳柳铁律）。需要 Worker env 已配置 CLOUDFLARE_API_TOKEN 和 CLOUDFLARE_ACCOUNT_ID。', input_schema: { type: 'object', properties: { account_id: { type: 'string', description: '可选，Cloudflare Account ID（默认用 env CLOUDFLARE_ACCOUNT_ID）' }, worker_name: { type: 'string', description: '可选，Worker 名称（默认 mcp-memory）' }, limit: { type: 'number', description: '可选，返回条数（默认5，最大10）' }, verify_main: { type: 'boolean', description: '可选，true 时对比 main HEAD commit vs 最新部署版本，返回 VERIFIED/DEPLOY_UNVERIFIED（部署后必查）' }, repo: { type: 'string', description: '可选，verify_main 时对比的仓库（默认 mcp-memory）' } } }, handler: 'github', category: 'GitHub', tags: ['Cloudflare', '部署', '日志', '状态'] },

    { name: 'cloudflare_deploy_logs', description: '查询 Cloudflare Workers 部署日志与单次部署详情（部署失败排查）。支持：1) deployment_id 查单次部署详情（status/trigger/metadata/error）；2) 默认查最近 N 次部署的详情列表；3) include_raw=true 返回 Cloudflare API 原始响应（定位 API/网络问题）。专为 DEPLOY_UNVERIFIED 排查设计（柳柳铁律：部署后必查 + 失败必查日志）。需要 Worker env 已配置 CLOUDFLARE_API_TOKEN 和 CLOUDFLARE_ACCOUNT_ID。', input_schema: { type: 'object', properties: { account_id: { type: 'string', description: '可选，Cloudflare Account ID（默认用 env CLOUDFLARE_ACCOUNT_ID）' }, worker_name: { type: 'string', description: '可选，Worker 名称（默认 mcp-memory）' }, deployment_id: { type: 'string', description: '可选，查单次部署详情（可传完整 id 或前 8-12 位）' }, limit: { type: 'number', description: '可选，返回条数（默认3，最大10）' }, include_raw: { type: 'boolean', description: '可选，true 时返回 Cloudflare API 原始响应（不解析）' } } }, handler: 'github', category: 'GitHub', tags: ['Cloudflare', '部署', '日志', '详情', '排查'] },
    { name: 'cloudflare_build_logs', description: '查询 Cloudflare Workers 构建日志（Git 集成构建阶段，含部署失败完整报错如 SyntaxError/10021）。通过 Workers Builds API：自动查 Worker tag → 列最近构建（build_uuid/status/branch/error）→ 拉构建日志全文。这是 cloudflare_deploy_logs 查不到的「构建阶段失败日志」通道（柳柳贴的那种构建日志）。注意：Builds API 需要 user-scoped API token（权限 Workers Builds Configuration Edit + Workers Scripts Read）；token 不支持时返回明确错误。', input_schema: { type: 'object', properties: { account_id: { type: 'string', description: '可选，Cloudflare Account ID（默认用 env CLOUDFLARE_ACCOUNT_ID）' }, worker_name: { type: 'string', description: '可选，Worker 名称（默认 mcp-memory）' }, build_uuid: { type: 'string', description: '可选，查指定构建的日志（不传则列最近 N 次构建+状态，再从第一个有错误/最近的构建拉日志）' }, limit: { type: 'number', description: '可选，返回构建条数（默认3，最大10）' }, include_raw: { type: 'boolean', description: '可选，true 时返回 Cloudflare API 原始响应（不解析）' } } }, handler: 'github', category: 'GitHub', tags: ['Cloudflare', '构建', '日志', '排查'] },
    { name: 'github_apply_patch', description: '应用已批准的 Patch Proposal 到分支（Patch Engine MVP）。输入 proposal_id；查 patch_proposals → 校验/应用 structured patch → 提交 → 记录 rollback_sha → 更新状态。前置：proposal 必须 approved（Permission Guard 家族）。', input_schema: { type: 'object', properties: { proposal_id: { type: 'string', description: 'patch_proposals.id' }, branch: { type: 'string', description: '目标分支（必须 dev，禁止 main）' }, repo: { type: 'string', description: '可选，目标仓库' } }, required: ['proposal_id'] }, handler: 'github', category: 'GitHub', tags: ['Patch', 'Apply', 'Proposal'] }
];

// ============================================================
// normalize - 递归排序对象 key，实现「语义相等」比较
// 原因：JSON.stringify 对属性顺序敏感，而 Supabase 存储 JSON 会重排 key 顺序，
//       导致同样的 schema 被误判为「变化」。排序 key 后再比较才是真正的语义差异。
// ============================================================
function normalize(value) {
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === 'object') {
        const sorted = {};
        for (const k of Object.keys(value).sort()) sorted[k] = normalize(value[k]);
        return sorted;
    }
    return value;
}

// ============================================================
// tryAutoSyncDev - 仅在已合并的 dev → main PR 后同步 dev
// scoped release / hotfix / 其他 head/base 一律不移动 dev。
// PR metadata 不可读取或字段不完整时 fail closed。
// ============================================================
async function tryAutoSyncDev(baseUrl, ghHeaders, pullNumber) {
    try {
        const prNum = Number(pullNumber);
        if (!Number.isSafeInteger(prNum) || prNum <= 0) {
            return 'ℹ️ 已跳过 dev 自动同步：缺少有效 PR 编号，dev 未修改';
        }

        // 必须用 GitHub 当前 PR metadata 判断实际 head/base 与 merged 状态，
        // 不能仅凭调用入口的参数或 merge endpoint 的 HTTP 状态推断。
        const prResp = await fetch(`${baseUrl}/pulls/${prNum}`, { headers: ghHeaders });
        if (!prResp.ok) {
            return `⚠️ 已跳过 dev 自动同步：读取 PR #${prNum} 信息失败（HTTP ${prResp.status}），dev 未修改`;
        }
        const prData = await prResp.json();
        if (!prData || prData.merged !== true) {
            return `ℹ️ 已跳过 dev 自动同步：PR #${prNum} 未能确认 merged=true，dev 未修改`;
        }

        const headRef = prData.head?.ref;
        const baseRef = prData.base?.ref;
        if (typeof headRef !== 'string' || typeof baseRef !== 'string' || !headRef || !baseRef) {
            return `⚠️ 已跳过 dev 自动同步：PR #${prNum} 缺少完整 head/base ref，dev 未修改`;
        }
        if (headRef !== 'dev' || baseRef !== 'main') {
            return `ℹ️ 已跳过 dev 自动同步：PR #${prNum} 为 ${headRef} → ${baseRef}，仅 dev → main 可触发同步；dev 未修改`;
        }

        const refResp = await fetch(`${baseUrl}/git/ref/heads/main`, { headers: ghHeaders });
        if (!refResp.ok) return '⚠️ 自动同步 dev 失败：取 main SHA 出错；dev 未确认修改';
        const refData = await refResp.json();
        const sha = refData?.object?.sha;
        if (typeof sha !== 'string' || !/^[0-9a-f]{40}$/i.test(sha)) {
            return '⚠️ 自动同步 dev 已停止：main ref 未返回有效 commit SHA；dev 未修改';
        }

        const updResp = await fetch(`${baseUrl}/git/refs/heads/dev`, {
            method: 'PATCH',
            headers: ghHeaders,
            body: JSON.stringify({ sha, force: true })
        });
        if (!updResp.ok) {
            let message = `HTTP ${updResp.status}`;
            try { message = (await updResp.json())?.message || message; } catch {}
            return '⚠️ 自动同步 dev 失败：' + message;
        }
        return `✅ 已确认 PR #${prNum} 为 dev → main，合并后自动同步 dev → main（${sha.slice(0, 8)}）`;
    } catch (e) {
        return '⚠️ 已跳过/停止 dev 自动同步：PR 或 ref 信息读取异常，dev 未执行后续同步。' + e.message;
    }
}

// ============================================================
// autoSyncGithubTools - 全量对比 + 自动补新增
// 四态：���增(自动注册) / 变化(报告待确认) / 孤儿(报告待确认) / 无变化
// ============================================================
export async function autoSyncGithubTools(env, dryRun = false) {
    const added = [];
    const changed = [];
    const orphan = [];
    const currentSkills = (await getEnabledSkills(env)) || [];
    const tableMap = new Map(currentSkills.map(s => [s.name, s]));
    const defNames = new Set(GITHUB_TOOL_DEFS.map(d => d.name));

    for (const def of GITHUB_TOOL_DEFS) {
        const existing = tableMap.get(def.name);
        if (!existing) {
            if (!dryRun) {
                await addSkill(env, {
                    name: def.name,
                    description: def.description,
                    input_schema: def.input_schema,
                    handler_type: 'js',
                    handler_config: { handler: def.handler || 'github' },
                    category: def.category || 'GitHub',
                    tags: def.tags || []
                });
            }
            added.push(def.name);
        } else {
            const schemaSame = JSON.stringify(normalize(existing.input_schema || {})) === JSON.stringify(normalize(def.input_schema || {}));
            const descSame = (existing.description || '').trim() === (def.description || '').trim();
            if (!schemaSame || !descSame) changed.push(def.name);
        }
    }

    for (const s of currentSkills) {
        if (s.name?.startsWith('github_') && !defNames.has(s.name)) orphan.push(s.name);
    }

    return { added, changed, orphan, totalDefs: GITHUB_TOOL_DEFS.length, tableCount: currentSkills.filter(s => s.name?.startsWith('github_')).length };
}

// UTF-8 safe base64 encode (supports Chinese)
function utf8ToBase64(str) {
    const bytes = new TextEncoder().encode(str);
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
}

// UTF-8 safe base64 decode (supports Chinese)
function base64ToUtf8(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
}

export async function handleGitHubTool(name, safeArgs, env) {
    let text = '';
    const token = env.GITHUB_TOKEN;
    if (!token) return 'ERROR: GitHub Token not configured. Set GITHUB_TOKEN in Cloudflare env vars';
    if (!env.GITHUB_REPO) return 'ERROR: GitHub Repo not configured. Set GITHUB_REPO in Cloudflare env vars';

    let repo = env.GITHUB_REPO;
    if (name !== 'github_create_repo' && safeArgs.repo) {
        const target = String(safeArgs.repo).trim();
        const allowedRaw = env.GITHUB_ALLOWED_REPOS || '';
        const allowed = allowedRaw.split(',').map(s => s.trim()).filter(Boolean);
        if (target === env.GITHUB_REPO) {
            repo = target;
        } else if (allowed.length > 0 && allowed.includes(target)) {
            repo = target;
        } else {
            return `ERROR: Repository not allowed: ${target}. Allowed repos: ${[env.GITHUB_REPO, ...allowed].join(', ')}`;
        }
    }

    const baseUrl = `https://api.github.com/repos/${repo}`;
    const ghHeaders = {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        'User-Agent': 'Cloudflare-Worker-MCP/1.0'
    };

    const contentsCtx = {
        repo, env, headers: ghHeaders, fetchImpl: fetch,
        validateRepoRelativePath, base64ToUtf8, utf8ToBase64, findSimilarCandidates
    };

    try {
        // GitHub Contents scenario workflow (details are isolated in the domain module).
        if (name === 'github_push') {
            return formatContentsResult(name, await pushFileFromStorage(contentsCtx, safeArgs || {}));
        }

        // github_create_repo
        else if (name === 'github_create_repo') {
            if (!safeArgs.repo) return 'ERROR: Missing repo name';
            const resp = await fetch('https://api.github.com/user/repos', {
                method: 'POST',
                headers: ghHeaders,
                body: JSON.stringify({ name: safeArgs.repo, description: safeArgs.description || '', private: safeArgs.private || false, auto_init: true })
            });
            if (!resp.ok) { const err = await resp.json(); throw new Error(err.message || `HTTP ${resp.status}`); }
            const data = await resp.json();
            text = `OK: Repo created\nName: ${data.full_name}\nURL: ${data.html_url}`;
        }

        // github_read: the facade formats ranges; the domain primitive owns GitHub Contents I/O.
        else if (name === 'github_read') {
            if (!safeArgs.path) return 'ERROR: Missing path';
            const branch = safeArgs.branch || 'main';
            const read = await getContent(contentsCtx, { repo, path: safeArgs.path, branch });
            if (!read.ok) {
                if (read.code === 'INVALID_REPO_PATH') return 'ERROR: ' + read.code + ': ' + read.message;
                throw new Error(read.message || ('HTTP ' + (read.status || 'unknown')));
            }
            const data = read.data;
            if (data.type === 'file') {
                // v6.4: 范围读取 + 默认上限 + 明确截断标记
                const DEFAULT_MAX_LINES = 200;
                const MAX_RESPONSE_CHARS = 12000;
                const fullContent = base64ToUtf8(data.content || '');
                const totalLines = fullContent.split('\n').length;
                const startLine = safeArgs.start_line !== undefined ? parseInt(safeArgs.start_line, 10) : 1;
                const endLine = safeArgs.end_line !== undefined ? parseInt(safeArgs.end_line, 10) : (startLine + DEFAULT_MAX_LINES - 1);
                const allLines = fullContent.split('\n');
                if (startLine > totalLines || endLine < 1) {
                    const clampedStart = Math.max(1, Math.min(startLine, totalLines));
                    const clampedEnd = Math.min(totalLines, Math.max(1, endLine));
                    text = `Path: ${data.path}\nSize: ${data.size} bytes\nTotal lines: ${totalLines}\nReturned lines: 0\nTruncated: false\nHas more: false\nRange: ${clampedStart}-${clampedEnd}\n\n(empty range: start_line=${startLine} end_line=${endLine} is out of bounds for ${totalLines} lines)`;
                } else {
                    const safeStart = Math.max(1, startLine);
                    let safeEnd = Math.min(totalLines, Math.max(safeStart, endLine));
                    let selected = allLines.slice(safeStart - 1, safeEnd);
                    let truncated = false;
                    let hasMore = false;
                    let responseText = selected.join('\n');
                    if (responseText.length > MAX_RESPONSE_CHARS) {
                        selected = allLines.slice(safeStart - 1);
                        let buf = '';
                        let cutAt = selected.length;
                        for (let i = 0; i < selected.length; i++) {
                            if ((buf + '\n' + selected[i]).length > MAX_RESPONSE_CHARS) { cutAt = i; break; }
                            buf += (i === 0 ? '' : '\n') + selected[i];
                        }
                        responseText = buf;
                        safeEnd = safeStart + cutAt;
                        truncated = true;
                        hasMore = true;
                    }
                    if (safeEnd < totalLines) hasMore = true;
                    text = `Path: ${data.path}\nSize: ${data.size} bytes\nTotal lines: ${totalLines}\nReturned lines: ${safeEnd - safeStart + 1}\nTruncated: ${truncated}\nHas more: ${hasMore}\nRange: ${safeStart}-${safeEnd}\n\n${responseText}`;
                }
            } else {
                text = `Path: ${data.path} is a directory`;
            }
        }


        // github_list: the facade formats entries; the domain primitive owns GitHub Contents I/O.
        else if (name === 'github_list') {
            const path = safeArgs.path || '';
            const branch = safeArgs.branch || 'main';
            const listing = await listContents(contentsCtx, { repo, path, branch });
            if (!listing.ok) {
                if (listing.code === 'INVALID_REPO_PATH') return 'ERROR: ' + listing.code + ': ' + listing.message;
                throw new Error(listing.message || ('HTTP ' + (listing.status || 'unknown')));
            }
            text = 'Directory: ' + (path || '(root)') + '\n' +
                listing.items.map(i => `${i.type === 'dir' ? '[DIR]' : '[FILE]'} ${i.name}${i.type === 'dir' ? '/' : ''}`).join('\n');
        }


        // github_delete
        else if (name === 'github_delete') {
            return formatContentsResult(name, await deleteFile(contentsCtx, safeArgs || {}));
        }

        // github_edit
        else if (name === 'github_edit') {
            return formatContentsResult(name, await editFileByAnchors(contentsCtx, safeArgs || {}));
        }

        // github_merge_to_main
        else if (name === 'github_merge_to_main') {
            const branch = (safeArgs && safeArgs.branch) || 'dev';
            const title = (safeArgs && safeArgs.title) || `Merge ${branch} into main`;
            const prBody = (safeArgs && safeArgs.body) || '';
            const mergeMethod = (safeArgs && safeArgs.merge_method) || 'rebase';
            const mergeTitle = (safeArgs && safeArgs.commit_title) || (safeArgs && safeArgs.title) || undefined;
            const mergeReason = (safeArgs && safeArgs.merge_reason) || '';
            if (mergeMethod === 'merge') {
                if (!mergeTitle) return 'ERROR: MERGE_REQUIRES_COMMIT_TITLE: 显式 merge 必须带 commit_title（否则 GitHub 会把标题写两遍，参见 PR #131 事故）';
                if (!mergeReason) return 'ERROR: MERGE_REQUIRES_REASON: 显式 merge 必须说明 merge_reason（hotfix/emergency/history-preserve）——禁止策略含糊，见 release_guard 家族规则';
            }
            const steps = [];

            try {
                const creatResp = await fetch(`${baseUrl}/pulls`, {
                    method: 'POST',
                    headers: ghHeaders,
                    body: JSON.stringify({ title: mergeTitle || title, head: branch, base: 'main', body: prBody })
                });
                const prData = await creatResp.json();
                if (!creatResp.ok) {
                    const existingResp = await fetch(`${baseUrl}/pulls?state=open&head=${repo.split('/')[0]}:${branch}&base=main`, { headers: ghHeaders });
                    const existing = await existingResp.json();
                    if (Array.isArray(existing) && existing.length > 0) {
                        const prNum = existing[0].number;
                        steps.push(`步骤1（建PR）：已存在 PR #${prNum}，直接沿用 ${existing[0].html_url}`);
                        prData.number = prNum;
                        prData.mergeable = existing[0].mergeable;
                        prData.mergeable_state = existing[0].mergeable_state;
                    } else {
                        throw new Error('建PR失败：' + (prData.message || `HTTP ${creatResp.status}`));
                    }
                } else {
                    steps.push(`步骤1（建PR）：创建成功 PR #${prData.number} ${prData.html_url}`);
                    prData.mergeable = prData.mergeable;
                    prData.mergeable_state = prData.mergeable_state;
                }

                const prNum = prData.number;
                let mergeable = prData.mergeable;
                let mergeableState = prData.mergeable_state;
                if (mergeable === null) {
                    const waitResp = await fetch(`${baseUrl}/pulls/${prNum}`, { headers: ghHeaders });
                    const waitData = await waitResp.json();
                    mergeable = waitData.mergeable;
                    mergeableState = waitData.mergeable_state;
                }
                if (mergeable === false) {
                    steps.push(`步骤2（查可合并）：❌ 不可合并（mergeable_state=${mergeableState}）——有冲突，请先回 dev 对齐 main`);
                    return steps.join('\n') + '\n\n⛔ 停止：PR 存在冲突，未合并。请先解决冲突再重试。';
                }
                steps.push(`步骤2（查可合并）：✅ 可合并（mergeable_state=${mergeableState || 'clean'}）`);

                const mergeBody = { merge_method: mergeMethod };
                if (mergeTitle && mergeMethod !== 'rebase') mergeBody.commit_title = mergeTitle;
                const mergeResp = await fetch(`${baseUrl}/pulls/${prNum}/merge`, {
                    method: 'PUT',
                    headers: ghHeaders,
                    body: JSON.stringify(mergeBody)
                });
                const mergeData = await mergeResp.json();
                if (mergeResp.ok || mergeResp.status === 405) {
                    steps.push('步骤3（合并）：✅ 已合并' + (mergeData.html_url ? ' ' + mergeData.html_url : ''));
                    if (mergeTitle && mergeMethod !== 'rebase') steps.push('Commit: ' + mergeTitle);
                    if (mergeMethod === 'rebase') steps.push('(rebase: 保留 dev 原始 commit 名，无 Merge PR 前缀)');
                    if (mergeData.merged || mergeResp.status === 405) {
                        const syncNote = await tryAutoSyncDev(baseUrl, ghHeaders, prNum);
                        steps.push(syncNote);
                    }
                    text = steps.join('\n');
                    text += '\n\n⚠️ 部署验证提示（Deploy Closure · 规范生效机制 Step 4）: 合并已成功，请按 deploy skill 第 6 步自动闭环——sleep 45s → cloudflare_deploy_status(verify_main=true) → 若 DEPLOY_UNVERIFIED 自动调 cloudflare_deploy_logs 查日志分类自愈，不许让柳柳手动贴日志。';
                } else {
                    throw new Error('合并失败：' + (mergeData.message || `HTTP ${mergeResp.status}`));
                }
            } catch (e) {
                if (steps.length > 0) {
                    return 'ERROR: ' + steps.join('\n') + '\n\n❌ ' + e.message;
                }
                throw new Error(e.message);
            }
        }

        // github_create_pull_request
        else if (name === 'github_create_pull_request') {
            const head = safeArgs.head || 'dev';
            const base = safeArgs.base || 'main';
            const title = safeArgs.title || `Merge ${head} into ${base}`;
            const body = safeArgs.body || '';
            const resp = await fetch(`${baseUrl}/pulls`, {
                method: 'POST',
                headers: ghHeaders,
                body: JSON.stringify({ title, head, base, body })
            });
            const data = await resp.json();
            if (!resp.ok) { throw new Error('建PR失败：' + (data.message || `HTTP ${resp.status}`)); }
            text = `OK: PR #${data.number} created\nTitle: ${data.title}\nURL: ${data.html_url}\nMergeable: ${data.mergeable}`;
        }

        // github_merge_pull_request
        else if (name === 'github_merge_pull_request') {
            const pr = safeArgs.pull_number;
            if (!pr) return 'ERROR: Missing pull_number';
            const method = safeArgs.merge_method || 'rebase';
            const commitTitle = safeArgs.commit_title || safeArgs.title || undefined;
            const mergeReason = (safeArgs && safeArgs.merge_reason) || '';
            if (method === 'merge') {
                if (!commitTitle) return 'ERROR: MERGE_REQUIRES_COMMIT_TITLE: 显式 merge 必须带 commit_title（否则 GitHub 会把标题写两遍，参见 PR #131 事故）';
                if (!mergeReason) return 'ERROR: MERGE_REQUIRES_REASON: 显式 merge 必须说明 merge_reason（hotfix/emergency/history-preserve）——禁止策略含糊，见 release_guard 家族规则';
            }
            const mergeBody = { merge_method: method };
            if (commitTitle) mergeBody.commit_title = commitTitle;
            const resp = await fetch(`${baseUrl}/pulls/${pr}/merge`, {
                method: 'PUT',
                headers: ghHeaders,
                body: JSON.stringify(mergeBody)
            });
            const data = await resp.json();
            if (resp.ok || resp.status === 405) {
                const merged = resp.ok ? (data.merged ? '✅ 已合并' : '⚠️ 未合并') : 'ℹ️ 已经合并过（405）';
                text = `OK: PR #${pr} ${merged}\n` + (data.html_url ? `URL: ${data.html_url}` : '');
                if (commitTitle && method !== 'rebase') text += `\nCommit: ${commitTitle}`;
                if (method === 'rebase') text += '\n(rebase: 保留 dev 原始 commit 名，无 Merge PR 前缀)';
                if (data.merged || resp.status === 405) {
                    const syncNote = await tryAutoSyncDev(baseUrl, ghHeaders, pr);
                    text += '\n\n' + syncNote;
                }
            } else {
                throw new Error('合并失败：' + (data.message || `HTTP ${resp.status}`));
            }
        }

        // github_close_pull_request
        else if (name === 'github_close_pull_request') {
            const pr = safeArgs.pull_number;
            if (!pr) return 'ERROR: Missing pull_number';
            const resp = await fetch(`${baseUrl}/pulls/${pr}`, {
                method: 'PATCH',
                headers: ghHeaders,
                body: JSON.stringify({ state: 'closed' })
            });
            if (!resp.ok) { const err = await resp.json(); throw new Error(err.message || `HTTP ${resp.status}`); }
            const data = await resp.json();
            text = `OK: PR #${pr} closed\nState: ${data.state}\nURL: ${data.html_url || ''}`;
        }

        // github_compare_branches
        else if (name === 'github_compare_branches') {
            const base = safeArgs.base || 'main';
            const head = safeArgs.head || 'dev';
            const resp = await fetch(`${baseUrl}/compare/${base}...${head}`, { headers: ghHeaders });
            if (!resp.ok) { const err = await resp.json(); throw new Error(err.message || `HTTP ${resp.status}`); }
            const data = await resp.json();
            text = `Compare ${base}...${head}\nAhead by: ${data.ahead_by}\nBehind by: ${data.behind_by}\nStatus: ${data.status}\nTotal commits: ${data.total_commits}`;
            if (data.files && data.files.length) {
                text += '\nFiles changed (' + data.files.length + '):\n' + data.files.slice(0, 30).map(f => `  ${f.status} ${f.filename}`).join('\n');
            }
        }

        // github_get_pull_request
        else if (name === 'github_get_pull_request') {
            const pr = safeArgs.pull_number;
            if (!pr) return 'ERROR: Missing pull_number';
            const resp = await fetch(`${baseUrl}/pulls/${pr}`, { headers: ghHeaders });
            if (!resp.ok) { const err = await resp.json(); throw new Error(err.message || `HTTP ${resp.status}`); }
            const data = await resp.json();
            text = `PR #${data.number}: ${data.title}\nState: ${data.state}\nMerged: ${data.merged}\nMergeable: ${data.mergeable}\nMergeable state: ${data.mergeable_state}\nHead: ${data.head ? data.head.ref : '?'}\nBase: ${data.base ? data.base.ref : '?'}\nURL: ${data.html_url || ''}`;
        }

        // github_sync_branch
        // github_sync_branch
        else if (name === 'github_sync_branch') {
            const targetBranch = safeArgs.name || safeArgs.branch || 'dev';
            const shaMatch = typeof safeArgs.from === 'string' ? safeArgs.from.match(/^sha:([0-9a-f]{40})$/i) : null;
            if (shaMatch) {
                const restored = await restoreBranchReference({
                    baseUrl, headers: ghHeaders, branch: targetBranch,
                    targetSha: shaMatch[1], expectedSha: safeArgs.base, fetchImpl: fetch
                });
                if (!restored.ok) throw new Error(`精确恢复失败 [${restored.code}]：${restored.message}`);
                text = `✅ 已精确恢复：${targetBranch} ${restored.previousSha.slice(0, 8)} → ${restored.sha.slice(0, 8)}（expected SHA 校验及回读验证通过）`;
            } else {
                const fromBranch = safeArgs.from || safeArgs.base || 'main';
                if (targetBranch === fromBranch) return 'ERROR: target and source are the same branch';
                const refResp = await fetch(`${baseUrl}/git/ref/heads/${fromBranch}`, { headers: ghHeaders });
                if (!refResp.ok) {
                    const err = await refResp.json();
                    throw new Error('取源分支失败：' + (err.message || `HTTP ${refResp.status}`));
                }
                const refData = await refResp.json();
                const sha = refData.object.sha;
                const updateResp = await fetch(`${baseUrl}/git/refs/heads/${targetBranch}`, {
                    method: 'PATCH',
                    headers: ghHeaders,
                    body: JSON.stringify({ sha, force: true })
                });
                if (!updateResp.ok) {
                    const err = await updateResp.json();
                    throw new Error('同步失败：' + (err.message || `HTTP ${updateResp.status}`));
                }
                text = `✅ 已同步：${targetBranch} → ${fromBranch}（${sha.slice(0, 8)}，未删分支）`;
            }
        }

        // github_create_branch
        else if (name === 'github_create_branch') {
            const newBranch = safeArgs.name || safeArgs.branch;
            if (!newBranch) return 'ERROR: Missing branch name (name or branch)';
            if (newBranch === 'main') return 'ERROR: main already exists';
            const from = safeArgs.from || safeArgs.base || 'main';
            const refResp = await fetch(`${baseUrl}/git/ref/heads/${from}`, { headers: ghHeaders });
            if (!refResp.ok) {
                const err = await refResp.json();
                throw new Error('取源分支失败：' + (err.message || `HTTP ${refResp.status}`));
            }
            const refData = await refResp.json();
            const sha = refData.object.sha;
            const createResp = await fetch(`${baseUrl}/git/refs`, {
                method: 'POST',
                headers: ghHeaders,
                body: JSON.stringify({ ref: `refs/heads/${newBranch}`, sha })
            });
            if (createResp.status === 422) {
                const errText = await createResp.text();
                return `❌ 分支已存在或创建失败：${newBranch}（${errText.substring(0, 120)}）`;
            }
            if (!createResp.ok) {
                const err = await createResp.json();
                throw new Error('建分支失败：' + (err.message || `HTTP ${createResp.status}`));
            }
            text = `✅ 已创建分支：${newBranch}（源自 ${from} ${sha.slice(0, 8)}）`;
        }

        // github_auto_sync
        else if (name === 'github_auto_sync') {
            const dryRun = safeArgs.dry_run === true;
            const report = await autoSyncGithubTools(env, dryRun);
            if (dryRun) {
                text = `📋 差异报告（dry-run，未写入）：\n🆕 新增待注册 ${report.added.length}：${report.added.join(', ') || '无'}\n🔄 变化待确认 ${report.changed.length}：${report.changed.join(', ') || '无'}\n🗑️ 孤儿待确认 ${report.orphan.length}：${report.orphan.join(', ') || '无'}\n📊 代码定义 ${report.totalDefs} / 表内已有 ${report.tableCount}`;
            } else {
                const lines = [];
                if (report.added.length) lines.push('🆕 自动注册新增 ' + report.added.length + '：' + report.added.join(', '));
                if (report.changed.length) lines.push('🔄 变化待确认（建议手动复核）' + report.changed.length + '：' + report.changed.join(', '));
                if (report.orphan.length) lines.push('🗑️ 孤儿待确认（代码已无，勿随意删）' + report.orphan.length + '：' + report.orphan.join(', '));
                if (!lines.length) lines.push('✅ 全部同步，无变化');
                lines.push(`📊 代码定义 ${report.totalDefs} / 表内已有 ${report.tableCount}`);
                if (report.added.length) lines.push('⚠️ 哥哥有空复核一下新注册工具的 schema 是否正确（自动注册只补缺，不覆盖）');
                text = lines.join('\n');
            }
        }


        // github_copy - reusable single-file copy workflow
        else if (name === 'github_copy') {
            return formatContentsResult(name, await copyFile(contentsCtx, safeArgs || {}));
        }

        // github_move - directory orchestration: enumerate, copy+verify all, recheck snapshots, then delete.
        else if (name === 'github_move') {
            return formatContentsResult(name, await movePath(contentsCtx, safeArgs || {}));
        }

        // Cloudflare Worker status/build/deploy tools share one verified provider.
        else if (name === 'cloudflare_deploy_logs' || name === 'cloudflare_build_logs' || name === 'cloudflare_deploy_status') {
            return await handleCloudflareTool(name, safeArgs, env);
        }

        // github_apply_patch - Patch Engine MVP (structured patch)
        else if (name === 'github_apply_patch') {
            const proposalId = safeArgs.proposal_id;
            if (!proposalId) return 'ERROR: Missing proposal_id';
            const requestedBranch = safeArgs.branch || 'dev';
            const requestedRepo = (safeArgs && safeArgs.repo) || env.GITHUB_REPO;
            // Fail closed before any Supabase/GitHub request. New branches are enabled only by policy config.
            const targetPolicy = resolvePatchTargetPolicy(requestedRepo, requestedBranch, env);
            if (!targetPolicy.ok) return 'ERROR: ' + targetPolicy.code + ': ' + targetPolicy.reason;
            const branch = targetPolicy.branch;
            const applyRepo = targetPolicy.repo;
            if (!env.SUPABASE_URL) return 'ERROR: SUPABASE_URL not configured';
            const sbKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY;
            if (!sbKey) return 'ERROR: Supabase key not configured';
            const sbHeaders = { 'apikey': sbKey, 'Authorization': 'Bearer ' + sbKey, 'Content-Type': 'application/json' };
            const proposalUrl = env.SUPABASE_URL + '/rest/v1/patch_proposals?id=eq.' + encodeURIComponent(proposalId);
            // 1) 查 proposal，明确检查 HTTP 状态
            const propResp = await fetch(proposalUrl + '&select=*', { headers: sbHeaders });
            if (!propResp.ok) return 'ERROR: 读取 proposal 失败: HTTP ' + propResp.status;
            const propRows = await propResp.json();
            const proposal = Array.isArray(propRows) ? propRows[0] : null;
            if (!proposal) return 'ERROR: proposal not found: ' + proposalId;
            if (proposal.status !== 'approved') return 'ERROR: proposal status=' + proposal.status + '（必须 approved 才能 apply）';
            // 2) 解析 structured patch
            let patch = null;
            try { patch = JSON.parse(proposal.diff); } catch (e) { patch = null; }
            if (!patch || !Array.isArray(patch.changes) || patch.changes.length === 0) return 'ERROR: proposal.diff 不是有效 structured patch JSON';
            const proposalTarget = proposal.target == null ? '' : proposal.target;
            const diffTarget = patch.file == null ? '' : patch.file;
            if ((proposalTarget && typeof proposalTarget !== 'string') || (diffTarget && typeof diffTarget !== 'string')) return 'ERROR: proposal target / patch.file 必须是字符串路径';
            if (proposalTarget && diffTarget && proposalTarget !== diffTarget) return 'ERROR: PATCH_TARGET_MISMATCH: proposal.target 与 patch.file 不一致；拒绝写入未经 proposal target 明确绑定的文件';
            const targetFile = proposalTarget || diffTarget;
            if (!targetFile) return 'ERROR: 缺少目标文件（patch.file / proposal.target）';
            const targetPathPolicy = validatePatchTargetFile(targetFile);
            if (!targetPathPolicy.ok) return 'ERROR: ' + targetPathPolicy.code + ': ' + targetPathPolicy.reason;
            patch.file = targetFile;
            // 3) 读目标文件当前内容（目标分支）
            const ghToken = env.GITHUB_TOKEN;
            if (!ghToken) return 'ERROR: GITHUB_TOKEN not configured';
            const ghApplyHeaders = { 'Authorization': 'Bearer ' + ghToken, 'Accept': 'application/vnd.github+json', 'User-Agent': 'mcp-memory' };
            const gbUrl = 'https://api.github.com/repos/' + applyRepo;
            const fileUrl = gbUrl + '/contents/' + targetPathPolicy.encodedPath + '?ref=' + encodeURIComponent(branch);
            const fileResp = await fetch(fileUrl, { headers: ghApplyHeaders });
            let fileData;
            try { fileData = await fileResp.json(); } catch (e) { return 'ERROR: 读取目标文件响应无效'; }
            if (!fileResp.ok) return 'ERROR: 读取文件失败: ' + (fileData.message || fileResp.status);
            const oldSha = fileData.sha;
            let fileContent;
            try { fileContent = base64ToUtf8(fileData.content); } catch (e) { return 'ERROR: base64 解码失败: ' + e.message; }
            // 4) validate + apply before claiming proposal
            const vRes = validatePatch(fileContent, patch);
            if (!vRes.ok) return 'ERROR: validatePatch: ' + vRes.errors.join('; ');
            const aRes = applyPatch(fileContent, patch);
            if (!aRes.ok) return 'ERROR: applyPatch: ' + (aRes.errors ? aRes.errors.join('; ') : 'unknown');
            const newContent = aRes.content;
            // 5) Atomically claim only an approved proposal. A competing call gets zero rows and cannot write GitHub.
            const claimAt = new Date().toISOString();
            let claimResp;
            try {
                claimResp = await fetch(proposalUrl + '&status=eq.approved&select=id,status', {
                    method: 'PATCH',
                    headers: { ...sbHeaders, 'Prefer': 'return=representation' },
                    body: JSON.stringify({ status: 'applying', updated_at: claimAt })
                });
            } catch (e) { return 'UNKNOWN: proposal 原子认领请求结果未知；本次尚未请求 GitHub 写入，但 proposal 可能已进入 applying。请先核对状态，不要盲目重试。错误: ' + e.message; }
            if (!claimResp.ok) return 'ERROR/UNKNOWN: proposal 原子认领返回 HTTP ' + claimResp.status + '；本次未请求 GitHub 写入，但请核对 proposal 状态后再重试。';
            let claimedRows;
            try { claimedRows = await claimResp.json(); } catch (e) { claimedRows = null; }
            if (!Array.isArray(claimedRows) || !claimedRows.some(row => row && row.id === proposalId && row.status === 'applying')) {
                return 'ERROR: proposal 已被其他执行占用或状态已变化；本次未写入 GitHub';
            }
            // 6) 写入 GitHub（PUT contents，带 old sha）
            const putBody = { message: 'Patch Engine: apply proposal ' + proposalId.slice(0, 8) + ' (' + applyRepo + ' ' + branch + ' ' + targetFile + ')', content: utf8ToBase64(newContent), sha: oldSha, branch: branch };
            let putResp;
            try {
                putResp = await fetch(gbUrl + '/contents/' + targetPathPolicy.encodedPath, { method: 'PUT', headers: ghApplyHeaders, body: JSON.stringify(putBody) });
            } catch (e) {
                return 'PARTIAL/UNKNOWN: proposal 已锁定为 applying，但 GitHub 写入结果未知；为避免重复应用未自动解锁。请先核对目标文件，再人工恢复 proposal 状态。错误: ' + e.message;
            }
            let putData;
            try { putData = await putResp.json(); } catch (e) { putData = {}; }
            if (!putResp.ok) {
                // Definite client-side rejection (excluding timeout/rate-limit): release the claim. Server/timeout outcomes remain locked for reconciliation.
                if (putResp.status >= 400 && putResp.status < 500 && putResp.status !== 408 && putResp.status !== 429) {
                    let releaseOk = false;
                    try {
                        const releaseResp = await fetch(proposalUrl + '&status=eq.applying&select=id,status', {
                            method: 'PATCH', headers: { ...sbHeaders, 'Prefer': 'return=representation' },
                            body: JSON.stringify({ status: 'approved', updated_at: new Date().toISOString() })
                        });
                        const releaseRows = releaseResp.ok ? await releaseResp.json() : null;
                        releaseOk = Array.isArray(releaseRows) && releaseRows.some(row => row && row.id === proposalId && row.status === 'approved');
                    } catch (e) { releaseOk = false; }
                    return 'ERROR: GitHub 写入被拒绝 (HTTP ' + putResp.status + '): ' + (putData.message || 'unknown') + (releaseOk ? '；proposal 已恢复 approved' : '；proposal 仍可能处于 applying，请核对状态后再处理');
                }
                return 'PARTIAL/UNKNOWN: GitHub 写入返回 HTTP ' + putResp.status + '，proposal 保持 applying 以防重复应用；请核对目标文件后再恢复状态。详情: ' + (putData.message || 'unknown');
            }
            // A 2xx alone is not enough: require a returned content SHA before marking the proposal applied.
            // GitHub may have accepted the write while returning an unusable/truncated response; keep applying for reconciliation.
            const returnedContent = putData && putData.content;
            const returnedSha = returnedContent && typeof returnedContent.sha === 'string' ? returnedContent.sha : '';
            const returnedPath = returnedContent && typeof returnedContent.path === 'string' ? returnedContent.path : '';
            if (!returnedSha || (returnedPath && returnedPath !== targetFile)) {
                return 'PARTIAL/UNKNOWN: GitHub PUT returned HTTP success but did not provide a verifiable target identity; proposal remains applying and was not marked applied. Check the repository file before reconciliation; do not retry blindly. proposal=' + proposalId + ' expected_file=' + targetFile + ' returned_file=' + (returnedPath || '?') + ' returned_sha=' + (returnedSha || '?');
            }
            // 7) Confirm applied state transition. HTTP success alone is insufficient; require returned row.
            const appliedAt = new Date().toISOString();
            let stateResp;
            try {
                stateResp = await fetch(proposalUrl + '&status=eq.applying&select=id,status', {
                    method: 'PATCH', headers: { ...sbHeaders, 'Prefer': 'return=representation' },
                    body: JSON.stringify({ status: 'applied', applied_by: 'ziven', applied_at: appliedAt, rollback_sha: oldSha, updated_at: appliedAt })
                });
            } catch (e) {
                return 'PARTIAL SUCCESS: GitHub 文件已写入，但 proposal 状态确认请求失败；proposal 可能仍为 applying。不要直接重试。proposal=' + proposalId + ' file=' + targetFile + ' branch=' + branch + ' old_sha=' + oldSha + ' new_sha=' + ((putData.content && putData.content.sha) || '?') + ' error=' + e.message;
            }
            let stateRows;
            try { stateRows = stateResp.ok ? await stateResp.json() : null; } catch (e) { stateRows = null; }
            if (!stateResp.ok || !Array.isArray(stateRows) || !stateRows.some(row => row && row.id === proposalId && row.status === 'applied')) {
                return 'PARTIAL SUCCESS: GitHub 文件已写入，但 proposal 状态未能确认变为 applied（HTTP ' + stateResp.status + '）。proposal 可能仍为 applying；不要直接重试。proposal=' + proposalId + ' file=' + targetFile + ' branch=' + branch + ' old_sha=' + oldSha + ' new_sha=' + ((putData.content && putData.content.sha) || '?');
            }
            text = '✅ github_apply_patch 成功\nproposal: ' + proposalId + '\nfile: ' + targetFile + ' (' + branch + ')\nold_sha: ' + oldSha.slice(0, 12) + '\nnew_sha: ' + (putData.content && putData.content.sha ? putData.content.sha.slice(0, 12) : '?') + '\nrollback: ' + oldSha.slice(0, 12) + '\nstatus: applied';
        }
        else return 'ERROR: Unknown GitHub tool: ' + name;
    } catch (e) {
        return 'ERROR: ' + e.message;
    }
    return text;
}