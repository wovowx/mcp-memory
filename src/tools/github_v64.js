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
import { handlePatchWorkflow } from '../modules/patch_workflow.js';
import { validateRepoRelativePath } from '../utils/helpers.js';
import { handleCloudflareTool } from '../modules/cloudflare/worker_status.js';
import { BRANCH_PR_TOOL_NAMES, handleBranchPrTool } from '../modules/github/branch_pr.js';
import { getContent, listContents, pushFileFromStorage, editFileByAnchors, deleteFile, copyFile, movePath, formatContentsResult } from '../modules/github/contents.js';
import { createGithubTextFile } from '../modules/scenes/github_file.js';
// Guarded recovery primitive for restoring the development ref to an exact commit.
// It never permits main or another branch, and requires an expected current HEAD.
export { restoreBranchReference } from '../modules/github/branch_pr.js';

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
    { name: 'github_create_file', description: '在已授权仓库的 dev 分支直接创建全新 UTF-8 文本文件（无须模板或上传链接）：先检查目标不存在，再写入并回读逐字节验证。dry_run=true 只预检不写。禁止覆写、main、其它分支；大于64 KiB请用现有上传+github_push。', input_schema: { type: 'object', properties: { repo: { type: 'string', description: '可选，允许的仓库，默认 GITHUB_REPO' }, branch: { type: 'string', enum: ['dev'], description: '仅 dev（默认 dev）' }, path: { type: 'string', description: '新文件路径，不能已存在' }, content: { type: 'string', description: 'UTF-8 文本，允许空文件' }, message: { type: 'string', description: '可选提交信息' }, dry_run: { type: 'boolean', description: 'true 只检查目标，不产生写入' } }, required: ['path', 'content'] }, handler: 'github', category: 'GitHub', tags: ['GitHub', '创建文件', '场景'] },
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
// Branch/PR ref primitives and guarded PR-sync workflow live in modules/github/branch_pr.js.

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

        // One-book scenario: direct text creation reuses Contents read/write/verify.
        else if (name === 'github_create_file') {
            return formatContentsResult(name, await createGithubTextFile(contentsCtx, safeArgs || {}));
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

        // Branch/PR workflows share one domain provider; the public facade keeps token/repo/release gates.
        else if (BRANCH_PR_TOOL_NAMES.has(name)) {
            return await handleBranchPrTool(name, safeArgs, { repo, baseUrl, ghHeaders });
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

        // Patch scenario orchestration lives in patch_workflow; the public facade keeps the existing tool contract.
        else if (name === 'github_apply_patch') {
            return await handlePatchWorkflow(name, safeArgs, env, { base64ToUtf8, utf8ToBase64 });
        }
        else return 'ERROR: Unknown GitHub tool: ' + name;
    } catch (e) {
        return 'ERROR: ' + e.message;
    }
    return text;
}
