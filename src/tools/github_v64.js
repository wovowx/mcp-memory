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
import { validatePatch, applyPatch } from '../modules/patch_engine.js';

// ============================================================
// GITHUB_TOOL_DEFS - 所有 github_* 工具的元数据（唯一真相源）
// 用于：自动注册 / 差异检测 / help() 展示
// 原则：代码是权威，Supabase skills 表只是缓存
// ============================================================
export const GITHUB_TOOL_DEFS = [
    { name: 'github_push', description: '推送文件到 GitHub 仓库（支持多仓库 repo 参数，白名单兜底）。内容必须通过 content_url 传入（我们自己的 Supabase 存储 url，先经 /upload 上传得到；服务端从 url 拉取，不经过对话上下文，永不截断）。写入后自动做 size 校验，校验失败返回 WRITE_VERIFY_FAILED 而不是 success。', input_schema: { type: 'object', properties: { path: { type: 'string', description: '文件路径' }, content_url: { type: 'string', description: '必填，文件内容来源：仅限我们自己的 Supabase 存储 url（*.supabase.co/storage/v1/object/public/files/...），先经 /upload 上传本地文件拿到 url 再传这里' }, branch: { type: 'string', description: '分支名（默认main）' }, message: { type: 'string', description: '提交信息' }, repo: { type: 'string', description: '可选，目标仓库（如 wovowx/ZivenLab），默认 GITHUB_REPO' } }, required: ['path', 'content_url'] }, handler: 'github', category: 'GitHub', tags: ['GitHub', '推送'] },
    { name: 'github_create_repo', description: '在 GitHub 创建新仓库。', input_schema: { type: 'object', properties: { repo: { type: 'string', description: '仓库名称' }, private: { type: 'boolean', description: '是否私有（默认false）' }, description: { type: 'string', description: '仓库描述' } }, required: ['repo'] }, handler: 'github', category: 'GitHub', tags: ['GitHub', '仓库'] },
    { name: 'github_read', description: '读取 GitHub 仓库文件内容（UTF-8 安全，支持中文）。支持 start_line/end_line 范围读取；默认最多返回前200行；返回 total_lines/returned_lines/truncated/has_more，明确是否截断。', input_schema: { type: 'object', properties: { path: { type: 'string', description: '文件路径' }, branch: { type: 'string', description: '分支名（默认main）' }, repo: { type: 'string', description: '可选，目标仓库' }, start_line: { type: 'number', description: '起始行（1-based，可选）' }, end_line: { type: 'number', description: '结束行（包含，可选）' } }, required: ['path'] }, handler: 'github', category: 'GitHub', tags: ['GitHub', '读取'] },
    { name: 'github_list', description: '列出 GitHub 仓库目录内容（文件/子目录）。', input_schema: { type: 'object', properties: { path: { type: 'string', description: '目录路径（默认根）' }, branch: { type: 'string', description: '分支名（默认main）' }, repo: { type: 'string', description: '可选，目标仓库' } } }, handler: 'github', category: 'GitHub', tags: ['GitHub', '目录'] },
    { name: 'github_delete', description: '删除 GitHub 仓库文件。', input_schema: { type: 'object', properties: { path: { type: 'string', description: '文件路径' }, branch: { type: 'string', description: '分支名（默认main）' }, message: { type: 'string', description: '提交信息' }, repo: { type: 'string', description: '可选，目标仓库' } }, required: ['path'] }, handler: 'github', category: 'GitHub', tags: ['GitHub', '删除'] },
    { name: 'github_merge_to_main', description: '智能三步合并 dev 到 main：建PR→查可合并→合并。merge_method **默认 rebase**（标准发布策略，防标题重复）；显式 merge 必须带 commit_title + merge_reason（禁止策略含糊）。合并成功后自动 sync dev。', input_schema: { type: 'object', properties: { branch: { type: 'string', description: '源分支（默认dev）' }, title: { type: 'string', description: 'PR标题' }, body: { type: 'string', description: 'PR描述' }, merge_method: { type: 'string', enum: ['merge', 'rebase', 'squash'], description: '合并方式（推荐rebase或merge）' }, commit_title: { type: 'string', description: '自定义合并 commit 标题（版本号+名称）' }, repo: { type: 'string', description: '可选，目标仓库' } } }, handler: 'github', category: 'GitHub', tags: ['GitHub', '合并', 'PR'] },
    { name: 'github_create_pull_request', description: '新建 Pull Request。', input_schema: { type: 'object', properties: { head: { type: 'string', description: '源分支（默认dev）' }, base: { type: 'string', description: '目标分支（默认main）' }, title: { type: 'string', description: 'PR标题' }, body: { type: 'string', description: 'PR描述' }, repo: { type: 'string', description: '可选，目标仓库' } }, required: ['title'] }, handler: 'github', category: 'GitHub', tags: ['GitHub', 'PR'] },
    { name: 'github_merge_pull_request', description: '合并指定 Pull Request。支持 merge_method（merge/squash/rebase）和 commit_title（自定义 commit 标题，从版本号开始）。合并成功后自动 sync dev。', input_schema: { type: 'object', properties: { pull_number: { type: 'number', description: 'PR编号' }, merge_method: { type: 'string', enum: ['merge', 'rebase', 'squash'], description: '合并方式' }, commit_title: { type: 'string', description: '自定义 commit 标题（版本号+名称）' }, title: { type: 'string', description: '自定义 commit 标题（别名）' }, repo: { type: 'string', description: '可选，目标仓库' } }, required: ['pull_number'] }, handler: 'github', category: 'GitHub', tags: ['GitHub', '合并', 'PR'] },
    { name: 'github_close_pull_request', description: '关闭废弃的 Pull Request。', input_schema: { type: 'object', properties: { pull_number: { type: 'number', description: 'PR编号' }, repo: { type: 'string', description: '可选，目标仓库' } }, required: ['pull_number'] }, handler: 'github', category: 'GitHub', tags: ['GitHub', 'PR'] },
    { name: 'github_compare_branches', description: '对比两个分支差异（base...head），返回值：ahead/behind/status/files。', input_schema: { type: 'object', properties: { base: { type: 'string', description: '基础分支（默认main）' }, head: { type: 'string', description: '对比分支（默认dev）' }, repo: { type: 'string', description: '可选，目标仓库' } } }, handler: 'github', category: 'GitHub', tags: ['GitHub', '分支', '对比'] },
    { name: 'github_get_pull_request', description: '查询单个 Pull Request 详情（state/merged/mergeable）。', input_schema: { type: 'object', properties: { pull_number: { type: 'number', description: 'PR编号' }, repo: { type: 'string', description: '可选，目标仓库' } }, required: ['pull_number'] }, handler: 'github', category: 'GitHub', tags: ['GitHub', 'PR'] },
    { name: 'github_create_branch', description: '从指定分支新建分支（多仓库兼容）。', input_schema: { type: 'object', properties: { name: { type: 'string', description: '新分支名' }, branch: { type: 'string', description: '新分支名（与name二选一）' }, from: { type: 'string', description: '源分支（默认main）' }, base: { type: 'string', description: '源分支（与from二选一）' }, repo: { type: 'string', description: '可选，目标仓库' } } }, handler: 'github', category: 'GitHub', tags: ['GitHub', '分支'] },
    { name: 'github_sync_branch', description: '让分支直接指向源分支最新 commit（fast-forward 同步，不删分支）。分叉根治专用。', input_schema: { type: 'object', properties: { name: { type: 'string', description: '要同步的分支（默认dev）' }, branch: { type: 'string', description: '要同步的分支（与name二选一）' }, from: { type: 'string', description: '源分支（默认main）' }, base: { type: 'string', description: '源分支（与from二选一）' }, repo: { type: 'string', description: '可选，目标仓库' } } }, handler: 'github', category: 'GitHub', tags: ['GitHub', '分支', '同步'] },
    { name: 'github_copy', description: '跨仓库/跨分支复制文件（GitHub → GitHub，内容不经过 Agent 上下文，由 MCP 服务端内部搬运）。参数：source_repo/source_branch/source_path/target_repo/target_branch/target_path/overwrite/message。复制后自动做 size 校验，source/target 大小不一致返回 COPY_VERIFY_FAILED 而不是 success。', input_schema: { type: 'object', properties: { source_repo: { type: 'string', description: '源仓库（如 wovowx/ZivenLab）' }, source_branch: { type: 'string', description: '源分支（默认main）' }, source_path: { type: 'string', description: '源文件路径' }, target_repo: { type: 'string', description: '目标仓库（如 wovowx/mcp-memory）' }, target_branch: { type: 'string', description: '目标分支（默认main）' }, target_path: { type: 'string', description: '目标文件路径' }, overwrite: { type: 'boolean', description: '目标存在时是否覆盖（默认false）' }, message: { type: 'string', description: '提交信息（可选）' } }, required: ['source_repo', 'source_path', 'target_repo', 'target_path'] }, handler: 'github', category: 'GitHub', tags: ['GitHub', '复制', '搬运'] },
    { name: 'github_auto_sync', description: '自动同步 github_* 工具注册表：对比 GITHUB_TOOL_DEFS（代码真相源）与 Supabase skills 表，新增自动补注册，变化/孤儿列出待确认。', input_schema: { type: 'object', properties: { dry_run: { type: 'boolean', description: '仅报告不写入（默认false）' } } }, handler: 'github', category: 'GitHub', tags: ['GitHub', '自动注册', '同步'] },
    { name: 'cloudflare_deploy_status', description: '查询 Cloudflare Workers 部署记录与版本列表（部署日志）：读 Worker 的 deployments + versions，返回最近部署时间/来源/ID。支持 verify_main=true 自动对比 main HEAD commit vs 最新部署版本，返回 VERIFIED/DEPLOY_UNVERIFIED（部署后必查，柳柳铁律）。需要 Worker env 已配置 CLOUDFLARE_API_TOKEN 和 CLOUDFLARE_ACCOUNT_ID。', input_schema: { type: 'object', properties: { account_id: { type: 'string', description: '可选，Cloudflare Account ID（默认用 env CLOUDFLARE_ACCOUNT_ID）' }, worker_name: { type: 'string', description: '可选，Worker 名称（默认 mcp-memory）' }, limit: { type: 'number', description: '可选，返回条数（默认5，最大10）' }, verify_main: { type: 'boolean', description: '可选，true 时对比 main HEAD commit vs 最新部署版本，返回 VERIFIED/DEPLOY_UNVERIFIED（部署后必查）' }, repo: { type: 'string', description: '可选，verify_main 时对比的仓库（默认 mcp-memory）' } } }, handler: 'github', category: 'GitHub', tags: ['Cloudflare', '部署', '日志', '状态'] },

    { name: 'cloudflare_deploy_logs', description: '查询 Cloudflare Workers 部署日志与单次部署详情（部署失败排查）。支持：1) deployment_id 查单次部署详情（status/trigger/metadata/error）；2) 默认查最近 N 次部署的详情列表；3) include_raw=true 返回 Cloudflare API 原始响应（定位 API/网络问题）。专为 DEPLOY_UNVERIFIED 排查设计（柳柳铁律：部署后必查 + 失败必查日志）。需要 Worker env 已配置 CLOUDFLARE_API_TOKEN 和 CLOUDFLARE_ACCOUNT_ID。', input_schema: { type: 'object', properties: { account_id: { type: 'string', description: '可选，Cloudflare Account ID（默认用 env CLOUDFLARE_ACCOUNT_ID）' }, worker_name: { type: 'string', description: '可选，Worker 名称（默认 mcp-memory）' }, deployment_id: { type: 'string', description: '可选，查单次部署详情（可传完整 id 或前 8-12 位）' }, limit: { type: 'number', description: '可选，返回条数（默认3，最大10）' }, include_raw: { type: 'boolean', description: '可选，true 时返回 Cloudflare API 原始响应（不解析）' } } }, handler: 'github', category: 'GitHub', tags: ['Cloudflare', '部署', '日志', '详情', '排查'] },
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
// tryAutoSyncDev - 合完 main 后自动把 dev 同步到最新（硬性要求）
// 只有 dev 不领先 main（无未合入独立 commit）时才自动 fast-forward，
// 否则跳过并提示——避免 force 覆盖把 dev 未合入的改动冲掉。
// 这是解决「合完不 sync → 下一轮 PR 必 dirty」的根本手段。
// ============================================================
async function tryAutoSyncDev(baseUrl, ghHeaders) {
    try {
        const cmpResp = await fetch(`${baseUrl}/compare/main...dev`, { headers: ghHeaders });
        if (!cmpResp.ok) return '⚠️ 自动同步 dev 失败：无法对比分支';
        const cmp = await cmpResp.json();
        if (cmp.ahead_by > 0) {
            return '⚠️ 检测到 dev 仍有未合入 main 的改动（ahead_by=' + cmp.ahead_by + '），未自动同步，请先处理。';
        }
        const refResp = await fetch(`${baseUrl}/git/ref/heads/main`, { headers: ghHeaders });
        if (!refResp.ok) return '⚠️ 自动同步 dev 失败：取 main SHA 出错';
        const refData = await refResp.json();
        const sha = refData.object.sha;
        const updResp = await fetch(`${baseUrl}/git/refs/heads/dev`, {
            method: 'PATCH',
            headers: ghHeaders,
            body: JSON.stringify({ sha, force: true })
        });
        if (!updResp.ok) return '⚠️ 自动同步 dev 失败：' + (await updResp.json()).message;
        return '✅ 合并后已自动同步 dev → main（' + sha.slice(0, 8) + '），下次 PR 不再冲突';
    } catch (e) {
        return '⚠️ 自动同步 dev 出错：' + e.message;
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

    try {
        // github_push
        if (name === 'github_push') {
            if (!safeArgs.path || !safeArgs.content_url) return 'ERROR: Missing path or content_url (push 必须带 content_url，先经 /upload 上传拿 url)';
            const message = safeArgs.message || `Update ${safeArgs.path}`;
            const branch = safeArgs.branch || 'main';
            if (branch === 'main') {
                text = '⚠️ WARNING: You are pushing directly to main. This triggers Cloudflare deploy + creates fork divergence. Recommend: push to dev first, then use PR/merge to main. Ask user to confirm before continuing. If confirmed, push will proceed.';
            }
            let base64Content;
            if (safeArgs.content_url) {
                // v6.4.2: 大文件 url 通道——只允许我们自己的 Supabase 存储（先 /upload 上传拿 url），不经过 Agent 上下文
                let cu; try { cu = new URL(safeArgs.content_url); } catch (e) { return (text ? text + '\n\n' : '') + 'ERROR: content_url invalid URL'; }
                const cuHost = cu.hostname || '';
                const cuPath = cu.pathname || '';
                if (!cuHost.endsWith('.supabase.co') || !cuPath.startsWith('/storage/v1/object/public/files/')) {
                    return (text ? text + '\n\n' : '') + 'ERROR: content_url must be our own Supabase storage url (*.supabase.co/storage/v1/object/public/files/...). Use our /upload endpoint first to get an url.';
                }
                const urlResp = await fetch(safeArgs.content_url, { headers: { 'User-Agent': 'ziven-mcp' } });
                if (!urlResp.ok) return (text ? text + '\n\n' : '') + 'ERROR: content_url fetch failed - HTTP ' + urlResp.status;
                const buf = await urlResp.arrayBuffer();
                const bytes = new Uint8Array(buf);
                let bin = '';
                for (let i = 0; i < bytes.length; i += 0x8000) {
                    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
                }
                base64Content = btoa(bin);
            }
            // 计算预期 UTF-8 字节长度（解码 base64 后），用于写入后校验
            // v6.4.3: strict base64 validity check (content_url 服务端生成，若截断会 block)
            if (typeof base64Content !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64Content) || base64Content.length % 4 !== 0) {
                return (text ? text + '\n\n' : '') + `ERROR: INPUT_CORRUPT - base64 content is not valid (possibly truncated). Length=${(base64Content || '').length}, mod4=${(base64Content || '').length % 4}. Refusing to push.`;
            }
            const expectedBytes = atob(base64Content).length;
            const checkResp = await fetch(`${baseUrl}/contents/${safeArgs.path}?ref=${branch}`, { headers: ghHeaders });
            let sha = null;
            if (checkResp.ok) { const data = await checkResp.json(); sha = data.sha; }
            const body = { message, content: base64Content, branch };
            if (sha) body.sha = sha;
            const resp = await fetch(`${baseUrl}/contents/${safeArgs.path}`, {
                method: 'PUT', headers: ghHeaders, body: JSON.stringify(body)
            });
            if (!resp.ok) { const err = await resp.json(); throw new Error(err.message || `HTTP ${resp.status}`); }
            const data = await resp.json();
            // v6.4: 写入后完整性校验——「API 成功 ≠ 文件成功」（ISSUE-3 fix: retry up to 3 times to avoid consistency window）
            let verified = false;
            let finalSize = 0;
            for (let attempt = 1; attempt <= 3 && !verified; attempt++) {
                try {
                    const verifyResp = await fetch(`${baseUrl}/contents/${safeArgs.path}?ref=${branch}`, { headers: ghHeaders });
                    if (verifyResp.ok) {
                        const vData = await verifyResp.json();
                        finalSize = vData.size || 0;
                        verified = finalSize === expectedBytes && finalSize > 0;
                    } else { finalSize = 0; }
                } catch (e) { finalSize = 0; }
                if (!verified && attempt < 3) await new Promise(r => setTimeout(r, 300 * attempt));
            }
            if (!verified) {
                return (text ? text + '\n\n' : '') + `ERROR: WRITE_VERIFY_FAILED - file written but size verification failed (expected ${expectedBytes}, got ${finalSize}). The file may be truncated or corrupt. This is NOT a success.`;
            }
            text = (text ? text + '\n\n' : '') + `OK: File pushed to GitHub\nPath: ${safeArgs.path}\nMsg: ${message}\nURL: ${data.content?.html_url || 'pushed'}\nVerified: true\nFile size: ${finalSize} bytes`;
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

        // github_read
        else if (name === 'github_read') {
            if (!safeArgs.path) return 'ERROR: Missing path';
            const branch = safeArgs.branch || 'main';
            const resp = await fetch(`${baseUrl}/contents/${safeArgs.path}?ref=${branch}`, { headers: ghHeaders });
            if (!resp.ok) { const err = await resp.json(); throw new Error(err.message || `HTTP ${resp.status}`); }
            const data = await resp.json();
            if (data.type === 'file') {
                // v6.4: 范围读取 + 默认上限 + 明确截断标记
                const DEFAULT_MAX_LINES = 200;
                const MAX_RESPONSE_CHARS = 12000;
                const fullContent = base64ToUtf8(data.content);
                const totalLines = fullContent.split('\n').length;
                const startLine = safeArgs.start_line !== undefined ? parseInt(safeArgs.start_line, 10) : 1;
                const endLine = safeArgs.end_line !== undefined ? parseInt(safeArgs.end_line, 10) : (startLine + DEFAULT_MAX_LINES - 1);
                const allLines = fullContent.split('\n');
                // BUG-1 fix: out-of-range returns explicit empty result, no negative line counts
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
                    // 单次响应字节上限保护
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

        // github_list
        else if (name === 'github_list') {
            const path = safeArgs.path || '';
            const branch = safeArgs.branch || 'main';
            const resp = await fetch(`${baseUrl}/contents/${path}?ref=${branch}`, { headers: ghHeaders });
            if (!resp.ok) { const err = await resp.json(); throw new Error(err.message || `HTTP ${resp.status}`); }
            const data = await resp.json();
            const items = Array.isArray(data) ? data : [data];
            text = 'Directory: ' + (path || '(root)') + '\n' +
                items.map(i => `${i.type === 'dir' ? '[DIR]' : '[FILE]'} ${i.name}${i.type === 'dir' ? '/' : ''}`).join('\n');
        }

        // github_delete
        else if (name === 'github_delete') {
            if (!safeArgs.path) return 'ERROR: Missing path';
            const branch = safeArgs.branch || 'main';
            const checkResp = await fetch(`${baseUrl}/contents/${safeArgs.path}?ref=${branch}`, { headers: ghHeaders });
            if (!checkResp.ok) { const err = await checkResp.json(); throw new Error(err.message || `HTTP ${checkResp.status}`); }
            const data = await checkResp.json();
            const resp = await fetch(`${baseUrl}/contents/${safeArgs.path}`, {
                method: 'DELETE',
                headers: ghHeaders,
                body: JSON.stringify({ message: safeArgs.message || `Delete ${safeArgs.path}`, sha: data.sha, branch })
            });
            if (!resp.ok) { const err = await resp.json(); throw new Error(err.message || `HTTP ${resp.status}`); }
            text = `DELETED: ${safeArgs.path}`;
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
                        const syncNote = await tryAutoSyncDev(baseUrl, ghHeaders);
                        steps.push(syncNote);
                    }
                    text = steps.join('\n');
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
                    const syncNote = await tryAutoSyncDev(baseUrl, ghHeaders);
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
        else if (name === 'github_sync_branch') {
            const targetBranch = safeArgs.name || safeArgs.branch || 'dev';
            const fromBranch = safeArgs.from || safeArgs.base || 'main';
            if (targetBranch === fromBranch) return 'ERROR: target and source are the same branch';
            const refResp = await fetch(`${baseUrl}/git/ref/heads/${fromBranch}`, { headers: ghHeaders });
            if (!refResp.ok) {
                const err = await refResp.json();
                throw new Error('取源��支失败：' + (err.message || `HTTP ${refResp.status}`));
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


        // github_copy - 跨仓库/跨分支文件复制（内容不经过 Agent 上下文）
        else if (name === 'github_copy') {
            if (!safeArgs.source_repo || !safeArgs.source_path || !safeArgs.target_repo || !safeArgs.target_path) {
                return 'ERROR: github_copy requires source_repo, source_path, target_repo, target_path';
            }
            const sourceRepo = String(safeArgs.source_repo).trim();
            const sourceBranch = safeArgs.source_branch || 'main';
            const sourcePath = String(safeArgs.source_path).trim();
            const targetRepo = String(safeArgs.target_repo).trim();
            const targetBranch = safeArgs.target_branch || 'main';
            const targetPath = String(safeArgs.target_path).trim();
            const overwrite = safeArgs.overwrite === true;
            const message = safeArgs.message || `Copy ${sourcePath} → ${targetPath}`;

            // 安全1：source 和 target 都必须过白名单
            const allowedRaw = env.GITHUB_ALLOWED_REPOS || '';
            const allowed = allowedRaw.split(',').map(s => s.trim()).filter(Boolean);
            const checkRepo = (r) => r === env.GITHUB_REPO || (allowed.length > 0 && allowed.includes(r));
            if (!checkRepo(sourceRepo)) return `ERROR: Repository not allowed: ${sourceRepo}`;
            if (!checkRepo(targetRepo)) return `ERROR: Repository not allowed: ${targetRepo}`;

            // 安全2：source 与 target 相同则拒绝
            if (sourceRepo === targetRepo && sourceBranch === targetBranch && sourcePath === targetPath) {
                return 'ERROR: SOURCE_IS_TARGET - source and target are the same file';
            }

            const srcBase = `https://api.github.com/repos/${sourceRepo}`;
            const tgtBase = `https://api.github.com/repos/${targetRepo}`;

            // 读 source 文件（服务端内部，内容不进 Agent 上下文）
            const srcResp = await fetch(`${srcBase}/contents/${encodeURIComponent(sourcePath)}?ref=${sourceBranch}`, { headers: ghHeaders });
            if (!srcResp.ok) {
                if (srcResp.status === 404) return 'ERROR: SOURCE_NOT_FOUND - ' + sourcePath + ' not found in ' + sourceRepo + '@' + sourceBranch;
                const err = await srcResp.json();
                return `ERROR: GITHUB_API_ERROR - source read failed: ${err.message || srcResp.status}`;
            }
            const srcData = await srcResp.json();
            if (!srcData.content) return 'ERROR: SOURCE_NOT_FOUND - no content at ' + sourcePath;
            const fileSha = srcData.sha;

            // 检查 target 是否存在
            const tgtCheck = await fetch(`${tgtBase}/contents/${encodeURIComponent(targetPath)}?ref=${targetBranch}`, { headers: ghHeaders });
            let targetSha = null;
            let overwritten = false;
            if (tgtCheck.ok) {
                const tgtData = await tgtCheck.json();
                targetSha = tgtData.sha;
                if (!overwrite) {
                    return `ERROR: TARGET_EXISTS - ${targetPath} already exists in ${targetRepo}@${targetBranch}. Set overwrite=true to overwrite.`;
                }
                overwritten = true;
            } else if (tgtCheck.status !== 404) {
                const err = await tgtCheck.json();
                return `ERROR: GITHUB_API_ERROR - target check failed: ${err.message || tgtCheck.status}`;
            }

            // target=main 时走 push-main 警示逻辑
            let warn = '';
            if (targetBranch === 'main') {
                warn = '⚠️ WARNING: Copying directly to main. This triggers Cloudflare deploy. Confirm before continuing.';
            }

            // PUT 到 target（用 source 的 base64 内容，服务端内部传递）
            const body = { message, content: srcData.content, branch: targetBranch };
            if (targetSha) body.sha = targetSha;
            const putResp = await fetch(`${tgtBase}/contents/${encodeURIComponent(targetPath)}`, {
                method: 'PUT', headers: ghHeaders, body: JSON.stringify(body)
            });
            if (!putResp.ok) {
                const err = await putResp.json();
                return `ERROR: GITHUB_API_ERROR - target write failed: ${err.message || putResp.status}`;
            }
            const putData = await putResp.json();

            // v6.4: copy 后完整性校验——「API 成功 ≠ 文件成功」（ISSUE-4 fix: retry up to 3 times to avoid consistency window）
            // 必须验证 target 最终 size 与 source size 一致，否则判定 copy 失败
            let verified = false;
            let targetFinalSize = 0;
            for (let attempt = 1; attempt <= 3 && !verified; attempt++) {
                try {
                    const verifyResp = await fetch(`${tgtBase}/contents/${encodeURIComponent(targetPath)}?ref=${targetBranch}`, { headers: ghHeaders });
                    if (verifyResp.ok) {
                        const vData = await verifyResp.json();
                        targetFinalSize = vData.size || 0;
                        verified = targetFinalSize === (srcData.size || 0) && targetFinalSize > 0;
                    } else { targetFinalSize = 0; }
                } catch (e) { targetFinalSize = 0; }
                if (!verified && attempt < 3) await new Promise(r => setTimeout(r, 300 * attempt));
            }
            if (!verified) {
                return (warn ? warn + '\n\n' : '') + `ERROR: COPY_VERIFY_FAILED - target written but size mismatched (source ${srcData.size || 0}, target ${targetFinalSize}). The copy may be truncated or corrupt. This is NOT a success.`;
            }

            text = (warn ? warn + '\n\n' : '') + JSON.stringify({
                success: true,
                verified: true,
                source_repo: sourceRepo,
                source_branch: sourceBranch,
                source_path: sourcePath,
                source_size: srcData.size || 0,
                target_repo: targetRepo,
                target_branch: targetBranch,
                target_path: targetPath,
                target_size: targetFinalSize,
                file_sha: fileSha,
                commit_sha: putData.commit?.sha || '',
                overwritten
            }, null, 2);
        }

        // cloudflare_deploy_logs - 部署日志/详情查询（v6.18.1 新增 · 柳柳要求「做查日志的工具」）
        else if (name === 'cloudflare_deploy_logs') {
            const cfToken = env.CLOUDFLARE_API_TOKEN;
            if (!cfToken) return 'ERROR: CLOUDFLARE_API_TOKEN secret not set (set via wrangler secret put)';
            const account = safeArgs.account_id || env.CLOUDFLARE_ACCOUNT_ID || '';
            if (!account) return 'ERROR: CLOUDFLARE_ACCOUNT_ID not set';
            const worker = safeArgs.worker_name || 'mcp-memory';
            const limit = Math.min(10, safeArgs.limit || 3);
            const base = 'https://api.cloudflare.com/client/v4/accounts/' + account + '/workers/scripts/' + worker;
            const cfHeaders = { 'Authorization': 'Bearer ' + cfToken, 'Content-Type': 'application/json' };
            const includeRaw = safeArgs.include_raw === true || safeArgs.include_raw === 'true';

            // 模式 A：查单次部署详情
            if (safeArgs.deployment_id) {
                const depId = String(safeArgs.deployment_id);
                const dResp = await fetch(base + '/deployments/' + encodeURIComponent(depId) + '/details', { headers: cfHeaders });
                let detail = null, rawErr = null;
                try {
                    const dJson = await dResp.json();
                    if (!dResp.ok) rawErr = JSON.stringify(dJson).slice(0, 300);
                    else detail = dJson;
                } catch (e) { rawErr = dResp.status + ' ' + e.message; }
                if (includeRaw) return JSON.stringify({ ok: dResp.ok, http: dResp.status, raw: detail || rawErr, note: 'raw response' }, null, 2);
                if (!detail) return 'ERROR: 部署详情查询失败' + (rawErr ? ': ' + rawErr : '（HTTP ' + dResp.status + '）');
                const r = detail.result || detail;
                const lines = [
                    '📋 Cloudflare 部署详情 (' + worker + ')',
                    '  deployment_id: ' + (r.id || safeArgs.deployment_id),
                    '  created_on: ' + (r.created_on || '?'),
                    '  source: ' + (r.source || '?'),
                    '  trigger: ' + JSON.stringify(r.trigger || null),
                    '  status: ' + JSON.stringify(r.status || null),
                    '  metadata: ' + JSON.stringify(r.metadata || null),
                    '  error: ' + JSON.stringify(r.error || null),
                    '  author: ' + (r.author_email || r.author || '?')
                ];
                return lines.join('\n');
            }

            // 模式 B：最近 N 次部署 + 各自详情
            const depResp = await fetch(base + '/deployments?per_page=' + limit, { headers: cfHeaders });
            let depList = [];
            let depErr = null;
            try {
                const d = await depResp.json();
                if (!depResp.ok) depErr = (d.errors && d.errors[0] && d.errors[0].message) || ('HTTP ' + depResp.status);
                else depList = (d.result && d.result.deployments || []).slice(0, limit);
            } catch (e) { depErr = e.message; }
            if (depErr) return 'ERROR: 查询部署列表失败: ' + depErr;

            const out = [];
            for (const dep of depList) {
                const item = {
                    id: (dep.id || '').slice(0, 12),
                    created_on: dep.created_on,
                    source: dep.source,
                    trigger: dep.trigger || null,
                    status: dep.status || null
                };
                try {
                    const dr = await fetch(base + '/deployments/' + encodeURIComponent(dep.id) + '/details', { headers: cfHeaders });
                    if (dr.ok) {
                        const dj = await dr.json();
                        const det = dj.result || dj;
                        item.detail = { trigger: det.trigger || null, metadata: det.metadata || null, status: det.status || null, error: det.error || null };
                    } else {
                        item.detail_error = 'HTTP ' + dr.status;
                    }
                } catch (e) { item.detail_error = e.message; }
                out.push(item);
            }
            if (includeRaw) return JSON.stringify({ ok: depResp.ok, http: depResp.status, raw: out, note: 'raw response (parsed deployments + details)' }, null, 2);
            return JSON.stringify(out, null, 2);
        }

        // cloudflare_deploy_status
        else if (name === 'cloudflare_deploy_status') {
            const cfToken = env.CLOUDFLARE_API_TOKEN;
            if (!cfToken) return 'ERROR: CLOUDFLARE_API_TOKEN secret not set (set via wrangler secret put)';
            const account = safeArgs.account_id || env.CLOUDFLARE_ACCOUNT_ID || '';
            if (!account) return 'ERROR: CLOUDFLARE_ACCOUNT_ID not set';
            const worker = safeArgs.worker_name || 'mcp-memory';
            const limit = Math.min(10, safeArgs.limit || 5);
            const base = 'https://api.cloudflare.com/client/v4/accounts/' + account + '/workers/scripts/' + worker;
            const cfHeaders = { 'Authorization': 'Bearer ' + cfToken, 'Content-Type': 'application/json' };
            const [depRes, verRes] = await Promise.all([
                fetch(base + '/deployments', { headers: cfHeaders }),
                fetch(base + '/versions?per_page=' + limit, { headers: cfHeaders })
            ]);
            let deployments = [], versions = [];
            let depErr = null, verErr = null;
            try {
                const d = await depRes.json();
                if (!depRes.ok) depErr = (d.errors && d.errors[0] && d.errors[0].message) || ('HTTP ' + depRes.status);
                else deployments = (d.result && d.result.deployments || []).slice(0, limit).map(function (x) { return { id: (x.id || '').slice(0, 8), created_on: x.created_on, source: x.source }; });
            } catch (e) { depErr = e.message; }
            try {
                const v = await verRes.json();
                if (!verRes.ok) verErr = (v.errors && v.errors[0] && v.errors[0].message) || ('HTTP ' + verRes.status);
                else versions = (v.result && v.result.items || []).slice(0, limit).map(function (x) { return { id: (x.id || '').slice(0, 8), number: x.number, created_on: x.metadata && x.metadata.created_on, source: x.metadata && x.metadata.source }; });
            } catch (e) { verErr = e.message; }

            const depLine = depErr ? ('Deployments 错误: ' + depErr) : ('Deployments 最近 ' + deployments.length + ' 次:\n' + deployments.map(function (d, i) { return '  ' + (i+1) + '. [' + d.id + '] ' + d.created_on + ' (' + d.source + ')'; }).join('\n'));
            const verLine = verErr ? ('Versions 错误: ' + verErr) : ('Versions 最近 ' + versions.length + ' 个:\n' + versions.map(function (v, i) { return '  ' + (i+1) + '. #' + v.number + ' [' + v.id + '] ' + v.created_on + ' (' + v.source + ')'; }).join('\n'));
            text = '\u2705 Cloudflare 部署状态 (' + worker + '):\n' + depLine + '\n' + verLine;

            // v6.17.0 verify_main: 部署后必查（柳柳铁律）——对比 main HEAD commit vs 最新部署版本
            if (safeArgs.verify_main === true || safeArgs.verify_main === 'true') {
                try {
                    const verifyRepo = safeArgs.repo || env.GITHUB_REPO || 'wovowx/mcp-memory';
                    const ghToken = env.GITHUB_TOKEN || '';
                    const ghVerifyHeaders = { 'Authorization': 'Bearer ' + ghToken, 'Accept': 'application/vnd.github+json', 'User-Agent': 'mcp-memory' };
                    const ghResp = await fetch('https://api.github.com/repos/' + verifyRepo + '/commits/main', { headers: ghVerifyHeaders });
                    const ghData = await ghResp.json();
                    const mainSha = (ghData && ghData.sha) || '';
                    const mainDate = (ghData && ghData.commit && ghData.commit.committer && ghData.commit.committer.date) || '';
                    const latestDep = deployments.length > 0 ? deployments[0] : null;
                    const latestDepDate = latestDep ? latestDep.created_on : '';
                    const deployedOk = latestDepDate && mainDate && (latestDepDate >= mainDate);
                    const verifyStatus = deployedOk ? 'VERIFIED' : 'DEPLOY_UNVERIFIED';
                    text += '\n\n🔍 verify_main (' + verifyRepo + '):\n' +
                        '  main HEAD: ' + mainSha.slice(0, 12) + ' (' + mainDate + ')\n' +
                        '  latest deploy: ' + (latestDep ? '[' + latestDep.id + '] ' + latestDepDate : 'NONE') + '\n' +
                        '  status: ' + verifyStatus + (deployedOk ? ' ✅ main 已上线' : ' ⚠️ main 比最新部署新——部署可能未触发/失败，去查部署日志');
                } catch (e) {
                    text += '\n\n🔍 verify_main 错误: ' + e.message;
                }
            }
        }


        // github_apply_patch - Patch Engine MVP (structured patch)
        else if (name === 'github_apply_patch') {
            const proposalId = safeArgs.proposal_id;
            if (!proposalId) return 'ERROR: Missing proposal_id';
            const branch = safeArgs.branch || 'dev';
            if (branch === 'main') return 'ERROR: github_apply_patch 禁止 main（release_guard 家族）';
            const applyRepo = (safeArgs && safeArgs.repo) || env.GITHUB_REPO;
            if (!env.SUPABASE_URL) return 'ERROR: SUPABASE_URL not configured';
            const sbKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY;
            if (!sbKey) return 'ERROR: Supabase key not configured';
            const sbHeaders = { 'apikey': sbKey, 'Authorization': 'Bearer ' + sbKey, 'Content-Type': 'application/json' };
            // 1) 查 proposal
            const propResp = await fetch(env.SUPABASE_URL + '/rest/v1/patch_proposals?id=eq.' + proposalId + '&select=*', { headers: sbHeaders });
            const propRows = await propResp.json();
            const proposal = Array.isArray(propRows) ? propRows[0] : null;
            if (!proposal) return 'ERROR: proposal not found: ' + proposalId;
            if (proposal.status !== 'approved') return 'ERROR: proposal status=' + proposal.status + '（必须 approved 才能 apply）';
            // 2) 解析 structured patch
            let patch = null;
            try { patch = JSON.parse(proposal.diff); } catch (e) { patch = null; }
            if (!patch || !Array.isArray(patch.changes) || patch.changes.length === 0) return 'ERROR: proposal.diff 不是有效 structured patch JSON';
            const targetFile = patch.file || proposal.target;
            if (!targetFile) return 'ERROR: 缺少目标文件（patch.file / proposal.target）';
            // 3) 读目标文件当前内容（目标分支）
            const ghToken = env.GITHUB_TOKEN;
            if (!ghToken) return 'ERROR: GITHUB_TOKEN not configured';
            const ghApplyHeaders = { 'Authorization': 'Bearer ' + ghToken, 'Accept': 'application/vnd.github+json', 'User-Agent': 'mcp-memory' };
            const gbUrl = 'https://api.github.com/repos/' + applyRepo;
            const fileUrl = gbUrl + '/contents/' + targetFile.split('/').map(encodeURIComponent).join('/') + '?ref=' + branch;
            const fileResp = await fetch(fileUrl, { headers: ghApplyHeaders });
            const fileData = await fileResp.json();
            if (!fileResp.ok) return 'ERROR: 读取文件失败: ' + (fileData.message || fileResp.status);
            const oldSha = fileData.sha;
            let fileContent;
            try { fileContent = base64ToUtf8(fileData.content); } catch (e) { return 'ERROR: base64 解码失败: ' + e.message; }
            // 4) validate + apply
            const vRes = validatePatch(fileContent, patch);
            if (!vRes.ok) return 'ERROR: validatePatch: ' + vRes.errors.join('; ');
            const aRes = applyPatch(fileContent, patch);
            if (!aRes.ok) return 'ERROR: applyPatch: ' + (aRes.errors ? aRes.errors.join('; ') : 'unknown');
            const newContent = aRes.content;
            // 5) 写入 GitHub（PUT contents，带 old sha）
            const putBody = { message: 'v6.17.1: apply patch proposal ' + proposalId.slice(0, 8) + ' (' + applyRepo + ' ' + branch + ' ' + targetFile + ')', content: utf8ToBase64(newContent), sha: oldSha, branch: branch };
            const putResp = await fetch(gbUrl + '/contents/' + targetFile.split('/').map(encodeURIComponent).join('/'), { method: 'PUT', headers: ghApplyHeaders, body: JSON.stringify(putBody) });
            const putData = await putResp.json();
            if (!putResp.ok) return 'ERROR: 写入失败: ' + (putData.message || putResp.status);
            // 6) 更新 proposal 状态
            const updBody = { status: 'applied', applied_by: 'ziven', applied_at: new Date().toISOString(), rollback_sha: oldSha, updated_at: new Date().toISOString() };
            await fetch(env.SUPABASE_URL + '/rest/v1/patch_proposals?id=eq.' + proposalId, { method: 'PATCH', headers: sbHeaders, body: JSON.stringify(updBody) });
            text = '✅ github_apply_patch 成功\nproposal: ' + proposalId + '\nfile: ' + targetFile + ' (' + branch + ')\nold_sha: ' + oldSha.slice(0, 12) + '\nnew_sha: ' + (putData.content && putData.content.sha ? putData.content.sha.slice(0, 12) : '?') + '\nrollback: ' + oldSha.slice(0, 12) + '\nstatus: applied';
        }
        else return 'ERROR: Unknown GitHub tool: ' + name;
    } catch (e) {
        return 'ERROR: ' + e.message;
    }
    return text;
}