// ============================================================
// GitHub Tools (Extended)
// ============================================================
// github_push / github_create_repo / github_read / github_list / github_delete / github_merge_to_main
// github_close_pull_request / github_compare_branches / github_get_pull_request
// github_create_pull_request / github_merge_pull_request (2026-08-29 ADD: PR工具适配分支保护)
// 2026-08-17 FIX: btoa cannot handle Chinese -> UTF-8 safe base64
// 2026-08-25 ADD: closePR/compare/getPR + push-main warning
// 2026-09-01 ADD v6.3: GITHUB_TOOL_DEFS 元数据（自动注册真相源）+ github_auto_sync 自动同步
import { getEnabledSkills, addSkill } from '../utils/skills.js';

// ============================================================
// GITHUB_TOOL_DEFS - 所有 github_* 工具的元数据（唯一真相源）
// 用于：自动注册 / 差异检测 / help() 展示
// 原则：代码是权威，Supabase skills 表只是缓存
// ============================================================
export const GITHUB_TOOL_DEFS = [
    { name: 'github_push', description: '推送文件到 GitHub 仓库（支持多仓库 repo 参数，白名单兜底）。JSON 内容请用 content_base64 传 pre-encoded base64（普通 content 传 JSON 会被序列化成 [object Object]）。', input_schema: { type: 'object', properties: { path: { type: 'string', description: '文件路径' }, content: { type: 'string', description: '文件内容（JSON 请用 content_base64）' }, content_base64: { type: 'string', description: '可选，pre-encoded base64 内容（推 JSON 用这个）' }, branch: { type: 'string', description: '分支名（默认main）' }, message: { type: 'string', description: '提交信息' }, repo: { type: 'string', description: '可选，目标仓库（如 wovowx/ZivenLab），默认 GITHUB_REPO' } }, required: ['path'] }, handler: 'github', category: 'GitHub', tags: ['GitHub', '推送'] },
    { name: 'github_create_repo', description: '在 GitHub 创建新仓库。', input_schema: { type: 'object', properties: { repo: { type: 'string', description: '仓库名称' }, private: { type: 'boolean', description: '是否私有（默认false）' }, description: { type: 'string', description: '仓库描述' } }, required: ['repo'] }, handler: 'github', category: 'GitHub', tags: ['GitHub', '仓库'] },
    { name: 'github_read', description: '读取 GitHub 仓库文件内容（UTF-8 安全，支持中文）。', input_schema: { type: 'object', properties: { path: { type: 'string', description: '文件路径' }, branch: { type: 'string', description: '分支名（默认main）' }, repo: { type: 'string', description: '可选，目标仓库' } }, required: ['path'] }, handler: 'github', category: 'GitHub', tags: ['GitHub', '读取'] },
    { name: 'github_list', description: '列出 GitHub 仓库目录内容（文件/子目录）。', input_schema: { type: 'object', properties: { path: { type: 'string', description: '目录路径（默认根）' }, branch: { type: 'string', description: '分支名（默认main）' }, repo: { type: 'string', description: '可选，目标仓库' } } }, handler: 'github', category: 'GitHub', tags: ['GitHub', '目录'] },
    { name: 'github_delete', description: '删除 GitHub 仓库文件。', input_schema: { type: 'object', properties: { path: { type: 'string', description: '文件路径' }, branch: { type: 'string', description: '分支名（默认main）' }, message: { type: 'string', description: '提交信息' }, repo: { type: 'string', description: '可选，目标仓库' } }, required: ['path'] }, handler: 'github', category: 'GitHub', tags: ['GitHub', '删除'] },
    { name: 'github_merge_to_main', description: '智能三步合并 dev 到 main：建PR→查可合并→合并。支持 commit_title（版本号+名称）和 merge_method（merge/rebase，不用squash）。', input_schema: { type: 'object', properties: { branch: { type: 'string', description: '源分支（默认dev）' }, title: { type: 'string', description: 'PR标题' }, body: { type: 'string', description: 'PR描述' }, merge_method: { type: 'string', enum: ['merge', 'rebase', 'squash'], description: '合并方式（推荐rebase或merge）' }, commit_title: { type: 'string', description: '自定义合并 commit 标题（版本号+名称）' }, repo: { type: 'string', description: '可选，目标仓库' } } }, handler: 'github', category: 'GitHub', tags: ['GitHub', '合并', 'PR'] },
    { name: 'github_create_pull_request', description: '新建 Pull Request。', input_schema: { type: 'object', properties: { head: { type: 'string', description: '源分支（默认dev）' }, base: { type: 'string', description: '目标分支（默认main）' }, title: { type: 'string', description: 'PR标题' }, body: { type: 'string', description: 'PR描述' }, repo: { type: 'string', description: '可选，目标仓库' } }, required: ['title'] }, handler: 'github', category: 'GitHub', tags: ['GitHub', 'PR'] },
    { name: 'github_merge_pull_request', description: '合并指定 Pull Request。支持 merge_method（merge/squash/rebase）和 commit_title（自定义 commit 标题，从版本号开始）。', input_schema: { type: 'object', properties: { pull_number: { type: 'number', description: 'PR编号' }, merge_method: { type: 'string', enum: ['merge', 'rebase', 'squash'], description: '合并方式' }, commit_title: { type: 'string', description: '自定义 commit 标题（版本号+名称）' }, title: { type: 'string', description: '自定义 commit 标题（别名）' }, repo: { type: 'string', description: '可选，目标仓库' } }, required: ['pull_number'] }, handler: 'github', category: 'GitHub', tags: ['GitHub', '合并', 'PR'] },
    { name: 'github_close_pull_request', description: '关闭废弃的 Pull Request。', input_schema: { type: 'object', properties: { pull_number: { type: 'number', description: 'PR编号' }, repo: { type: 'string', description: '可选，目标仓库' } }, required: ['pull_number'] }, handler: 'github', category: 'GitHub', tags: ['GitHub', 'PR'] },
    { name: 'github_compare_branches', description: '对比两个分支差异（base...head），返回值：ahead/behind/status/files。', input_schema: { type: 'object', properties: { base: { type: 'string', description: '基础分支（默认main）' }, head: { type: 'string', description: '对比分支（默认dev）' }, repo: { type: 'string', description: '可选，目标仓库' } } }, handler: 'github', category: 'GitHub', tags: ['GitHub', '分支', '对比'] },
    { name: 'github_get_pull_request', description: '查询单个 Pull Request 详情（state/merged/mergeable）。', input_schema: { type: 'object', properties: { pull_number: { type: 'number', description: 'PR编号' }, repo: { type: 'string', description: '可选，目标仓库' } }, required: ['pull_number'] }, handler: 'github', category: 'GitHub', tags: ['GitHub', 'PR'] },
    { name: 'github_create_branch', description: '从指定分支新建分支（多仓库兼容）。', input_schema: { type: 'object', properties: { name: { type: 'string', description: '新分支名' }, branch: { type: 'string', description: '新分支名（与name二选一）' }, from: { type: 'string', description: '源分支（默认main）' }, base: { type: 'string', description: '源分支（与from二选一）' }, repo: { type: 'string', description: '可选，目标仓库' } } }, handler: 'github', category: 'GitHub', tags: ['GitHub', '分支'] },
    { name: 'github_sync_branch', description: '让分支直接指向源分支最新 commit（fast-forward 同步，不删分支）。分叉根治专用。', input_schema: { type: 'object', properties: { name: { type: 'string', description: '要同步的分支（默认dev）' }, branch: { type: 'string', description: '要同步的分支（与name二选一）' }, from: { type: 'string', description: '源分支（默认main）' }, base: { type: 'string', description: '源分支（与from二选一）' }, repo: { type: 'string', description: '可选，目标仓库' } } }, handler: 'github', category: 'GitHub', tags: ['GitHub', '分支', '同步'] },
    { name: 'github_auto_sync', description: '自动同步 github_* 工具注册表：对比 GITHUB_TOOL_DEFS（代码真相源）与 Supabase skills 表，新增自动补注册，变化/孤儿列出待确认。', input_schema: { type: 'object', properties: { dry_run: { type: 'boolean', description: '仅报告不写入（默认false）' } } }, handler: 'github', category: 'GitHub', tags: ['GitHub', '自动注册', '同步'] }
];

// ============================================================
// autoSyncGithubTools - 全量对比 + 自动补新增
// 四态：新增(自动注册) / 变化(报告待确认) / 孤儿(报告待确认) / 无变化
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
            const schemaSame = JSON.stringify(existing.input_schema || {}) === JSON.stringify(def.input_schema || {});
            const descSame = (existing.description || '') === (def.description || '');
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

    // ============================================================
    // v6 多仓库支持：repo 参数 + GITHUB_ALLOWED_REPOS 白名单兜底
    // ============================================================
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
        // ============================================
        // github_push - push/update file (with main-branch warning)
        // ============================================
        if (name === 'github_push') {
            if (!safeArgs.path || (!safeArgs.content && !safeArgs.content_base64)) return 'ERROR: Missing path and content (or content_base64)';
            const message = safeArgs.message || `Update ${safeArgs.path}`;
            const branch = safeArgs.branch || 'main';
            if (branch === 'main') {
                text = '⚠️ WARNING: You are pushing directly to main. This triggers Cloudflare deploy + creates fork divergence. Recommend: push to dev first, then use PR/merge to main. Ask user to confirm before continuing. If confirmed, push will proceed.';
            }
            let base64Content;
            if (safeArgs.content_base64) {
                base64Content = safeArgs.content_base64;
            } else {
                base64Content = utf8ToBase64(String(safeArgs.content));
            }
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
            text = (text ? text + '\n\n' : '') + `OK: File pushed to GitHub\nPath: ${safeArgs.path}\nMsg: ${message}\nURL: ${data.content?.html_url || 'pushed'}`;
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
                const content = base64ToUtf8(data.content);
                text = `Path: ${data.path}\nSize: ${data.size} bytes\n\n${content.substring(0, 4000)}`;
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
            const mergeMethod = (safeArgs && safeArgs.merge_method) || 'merge';
            const mergeTitle = (safeArgs && safeArgs.commit_title) || (safeArgs && safeArgs.title) || undefined;
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

        // github_merge_pull_request (with commit_title/rebase)
        else if (name === 'github_merge_pull_request') {
            const pr = safeArgs.pull_number;
            if (!pr) return 'ERROR: Missing pull_number';
            const method = safeArgs.merge_method || 'merge';
            const commitTitle = safeArgs.commit_title || safeArgs.title || undefined;
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

        // github_auto_sync (v6.3 NEW)
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

        else return 'ERROR: Unknown GitHub tool: ' + name;
    } catch (e) {
        return 'ERROR: ' + e.message;
    }
    return text;
}