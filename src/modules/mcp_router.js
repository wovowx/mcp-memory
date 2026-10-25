// ============================================================
// mcp_router.js — Worker MCP Server 核心实现层（协议 + tool dispatch）
// 从 index.js 抽出（v6.11.2）：避免 mcp_client 与 index 循环依赖，单真相源
// 职责：只做 MCP 协议 + tool dispatch；不做 permission/approval/capability/audit
// ============================================================
import { getEnabledSkills, getSkillByName, addSkill, updateSkill, deleteSkill } from '../utils/skills.js';
import { handleMemoryTool } from '../tools/memory_unified.js';
import { handleDataTool } from '../tools/data.js';
import { handleAITool } from '../tools/ai.js';
import { handleGitHubTool, GITHUB_TOOL_DEFS } from '../tools/github_v64.js';
import { handleDatabaseTool } from '../tools/database.js';
import { handleCategoryTool } from '../tools/category.js';
import handleKnowledgeSkill from '../tools/knowledge.js';
import { handleIncrementUsage } from '../tools/increment_usage.js';
import { handleDeleteBranch } from '../tools/delete_branch.js';
import { handleChatTool, CHAT_TOOL_DEFS } from '../tools/chat_mcp.js';
import { handleCfProxyTool } from '../tools/cf_proxy.js';
import { validateRelease } from './release_guard.js';

const handlerMap = {
    'memory': handleMemoryTool,
    'category': handleCategoryTool,
    'data': handleDataTool,
    'ai': handleAITool,
    'github': handleGitHubTool,
    'database': handleDatabaseTool,
    'knowledge': handleKnowledgeSkill,
    'skill': handleSkillManagement,
    'increment_usage': handleIncrementUsage,
    'delete_branch': handleDeleteBranch,
    'chat': handleChatTool,
    'cf_proxy': handleCfProxyTool
};

// ============================================================
// dispatch_tool 网关（P0 · 2026-10-18 Ziven×GPT 讨论 + 业内踩肩）
// 职责：执行前硬门禁——调用信封校验 + 工具注册校验
// 现状（本文件第4行）：只做 dispatch，不做 permission/audit → 这里补第一道缝。
// 原则（GPT 确认）：让非法调用无法执行，不靠 Agent 自觉。
// 最小切片只做两件事（可扩展，后续加 schema/角色权限/副作用策略）：
//   1. 调用信封校验：name 必须为非空字符串
//   2. 工具注册校验：name 必须在已知工具集合内（handlerMap + 动态前缀 + create_patch_proposal），未知拒
// 校验不通过 → 执行前返回结构化错误，绝不进入 handler。
// ============================================================
const KNOWN_HANDLERS = new Set(Object.keys(handlerMap));

function isKnownToolName(name) {
    if (!name || typeof name !== 'string') return false;
    if (KNOWN_HANDLERS.has(name)) return true;                    // handlerMap 直连工具
    if (name === 'create_patch_proposal') return true;            // 专门 handler
    // 动态注册的前缀族（其余走 skills 表懒注册）
    if (name.startsWith('github_')) return true;                  // handleGitHubTool
    if (name.startsWith('supabase_')) return true;                // handleDatabaseTool
    if (name.startsWith('memory_')) return true;                  // handleMemoryTool
    if (name.startsWith('database_')) return true;                // handleDatabaseTool
    if (name.startsWith('category_')) return true;                // handleCategoryTool
    if (name.startsWith('skill_')) return true;                   // handleSkillManagement
    return null;                                                  // null=前缀未匹配，需查注册表
}
// v6.35.7 (2026-10-18)：修复——前缀未匹配的工具（如 cloudflare_deploy_status/deploy/chat2api 等
// 走 skills 表动态注册的合法 ziven_mcp 工具）会被误判为 UNKNOWN_TOOL。改为查 getCachedSkills 注册表兜底，
// 与现有懒注册逻辑一致；只有连注册表都没有才真拒绝。验证难度前置，防误伤。
async function isKnownTool(env, name) {
    const prefix = isKnownToolName(name);
    if (prefix === true) return true;
    if (prefix === false) return false;
    try {
        const skills = await getCachedSkills(env);
        return Array.isArray(skills) && skills.some(s => s && s.name === name);
    } catch (e) { return false; }
}
// v6.35.8 (2026-10-18)：从工具注册表取 input_schema（含 required）。
// 对齐"踩肩+不重复造"：直接复用 skills 表/GITHUB_TOOL_DEFS 已有的参数契约，不自己定义。
// 返回 null=查不到 schema（这种情况走信封校验放行，不误伤无 schema 的工具）。
async function getToolSchema(env, name) {
    // 前缀族直连工具——它们的 input_schema 在 GITHUB_TOOL_DEFS / skills 表
    try {
        const skills = await getCachedSkills(env);
        const skill = Array.isArray(skills) ? skills.find(s => s && s.name === name) : null;
        if (skill && skill.input_schema && typeof skill.input_schema === 'object') {
            return skill.input_schema;
        }
    } catch (e) { /* 查不到用信封校验兜底 */ }
    return null;
}
// v6.35.7：dispatchGuard 改 async + 接收 env，前缀未匹配查注册表兜底
// v6.35.8：加参数 schema 校验——input_schema.required 里的字段缺一个都拒（定稿验收#1），
//   这是真正拦"漏 path/tool_name/必需参数"这类构造层污染的硬约束，不只信封层面。
async function dispatchGuard(env, name, args) {
    // 1. 调用信封校验
    if (!name || typeof name !== 'string') {
        return { allowed: false, code: 'INVALID_TOOL_NAME', reason: 'tool 调用缺少有效 name（可能 tool_name 丢失/污染）', expected: 'name 必须是非空字符串' };
    }
    // 2. 工具注册校验（前缀 + 注册表兜底）
    if (!(await isKnownTool(env, name))) {
        return { allowed: false, code: 'UNKNOWN_TOOL', reason: '未知工具: ' + name, expected: 'name 必须在已注册工具集合内' };
    }
    // 参数信封校验：arguments 必须为对象（可选增强，先最小）
    if (args !== undefined && args !== null && typeof args !== 'object') {
        return { allowed: false, code: 'INVALID_ARGS', reason: 'arguments 必须是对象', expected: 'arguments 为 JSON 对象' };
    }
    // 3. 参数 schema 校验（v6.35.8）：required 字段缺一个都拒（若该工具有规范 schema）
    const schema = await getToolSchema(env, name);
    if (schema && Array.isArray(schema.required) && schema.required.length > 0) {
        const missing = schema.required.filter(req => {
            // args 缺字段 或 值为空字符串/undefined/null 都算"未提供"
            const v = args?.[req];
            return v === undefined || v === null || v === '';
        });
        if (missing.length > 0) {
            return { allowed: false, code: 'MISSING_REQUIRED_PARAM', reason: '缺少必需参数: ' + missing.join(', '), expected: '必填: ' + schema.required.join(', ') };
        }
    }
    return { allowed: true };
}

const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2024-11-05', '2025-03-26'];
const DEFAULT_PROTOCOL_VERSION = '2025-06-18';
const skillCache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

async function getCachedSkills(env) {
    const now = Date.now();
    const cached = skillCache.get('skills');
    if (cached && (now - cached.time) < CACHE_TTL) return cached.skills;
    const skills = await getEnabledSkills(env);
    skillCache.set('skills', { skills, time: now });
    return skills;
}

async function invalidateCache() { skillCache.clear(); }

// release_guard 前置闸：push/merge 到 main 必须版本化；非 main 分支放行
// v6.32.3 (2026-09-08)：FIX rebase 标题失守——rebase 模式 GitHub 保留 dev 原始 commit 标题，
//   只校验 merge 参数 commit_title 没意义（merge 时的 title 不会落到 main 上）。
//   改为：rebase 模式校验源分支 HEAD commit 标题（rebase 后真实出现在 main 上的标题）；
//   merge/squash 模式才校验 commit_title 参数（会真实落到 main）。
async function getPullRequestHeadBranch(env, pullNumber, repo = env.GITHUB_REPO) {
    try {
        const token = env.GITHUB_TOKEN;
        if (!token || !repo || !pullNumber) return '';
        const resp = await fetch(`https://api.github.com/repos/${repo}/pulls/${pullNumber}`, {
            headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json', 'User-Agent': 'ziven-bridge' }
        });
        if (!resp.ok) return '';
        const data = await resp.json();
        return (data.head && data.head.ref) || '';
    } catch (e) { return ''; }
}

async function getBranchHeadCommitTitle(env, branch, repo = env.GITHUB_REPO) {
    try {
        const token = env.GITHUB_TOKEN;
        if (!token || !repo || !branch) return '';
        const resp = await fetch(`https://api.github.com/repos/${repo}/commits/${encodeURIComponent(branch)}`, {
            headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json', 'User-Agent': 'ziven-bridge' }
        });
        if (!resp.ok) return '';
        const data = await resp.json();
        return (data.commit?.message || '').split('\n')[0] || '';
    } catch (e) { return ''; }
}

export async function githubReleaseGuard(name, safeArgs, env) {
    if (name !== 'github_push' && name !== 'github_merge_to_main' && name !== 'github_merge_pull_request' && name !== 'github_edit') {
        return { allowed: true };
    }
    // 多仓库调用按实际目标仓库选择发布策略；未指定目标仓库时兼容默认 GITHUB_REPO。
    const targetRepo = safeArgs.repo || env.GITHUB_REPO;
    // v6.32.5: github_edit 按 push 处理（写操作）——写 dev 放行，写 main 拦（版本化）
    const isPush = name === 'github_push' || name === 'github_edit';
    const branch = isPush ? (safeArgs.branch || 'main') : 'main';
    const action = isPush ? 'push' : 'merge';

    // rebase（默认）模式：merge 标题由源分支 HEAD commit 决定，校验真实标题
    if (!isPush) {
        const mergeMethod = (safeArgs.merge_method || 'rebase');
        if (mergeMethod === 'rebase') {
            let srcBranch = '';
            if (name === 'github_merge_to_main') srcBranch = safeArgs.branch || 'dev';
            else if (name === 'github_merge_pull_request') {
                // v6.34.1 FIX：PR rebase merge 也会真实落库 PR head 分支的原始 commit 标题，必须查真实标题校验
                const prHead = await getPullRequestHeadBranch(env, safeArgs.pull_number, targetRepo);
                if (prHead) {
                    const realTitle = await getBranchHeadCommitTitle(env, prHead, targetRepo);
                    if (realTitle) {
                        return validateRelease({ repo: targetRepo, branch, commitTitle: realTitle, action });
                    }
                }
                // 查不到 PR head / 标题——保守拒绝，不静默放行
                return validateRelease({ repo: targetRepo, branch, commitTitle: safeArgs.commit_title || safeArgs.title || undefined, action });
            }
            const headTitle = await getBranchHeadCommitTitle(env, srcBranch, targetRepo);
            if (headTitle) {
                return validateRelease({ repo: targetRepo, branch, commitTitle: headTitle, action });
            }
            // 查不到 dev HEAD 标题（网络/权限）——fallback 到参数校验，不静默放行
            return validateRelease({ repo: targetRepo, branch, commitTitle: safeArgs.commit_title || safeArgs.title || undefined, action });
        }
    }

    const commitTitle = isPush ? (safeArgs.message || '') : (safeArgs.commit_title || safeArgs.title || undefined);
    return validateRelease({ repo: targetRepo, branch, commitTitle, action });
}

async function passiveSyncGithubTool(env, name) {
    try {
        const existing = await getSkillByName(env, name);
        if (existing) return null;
        const def = GITHUB_TOOL_DEFS.find(d => d.name === name);
        if (!def) return null;
        const ok = await addSkill(env, {
            name: def.name, description: def.description, input_schema: def.input_schema,
            handler_type: 'js', handler_config: { handler: def.handler || 'github' },
            category: def.category || 'GitHub', tags: def.tags || []
        });
        await invalidateCache();
        return ok ? 'auto registered: ' + name : 'auto register fail: ' + name;
    } catch (e) { return 'auto register err: ' + e.message; }
}

async function syncChatTools(env) {
    let changed = false;
    for (const def of CHAT_TOOL_DEFS) {
        const existing = await getSkillByName(env, def.name);
        if (existing) continue;
        const ok = await addSkill(env, {
            name: def.name, description: def.description, input_schema: def.input_schema,
            handler_type: 'js', handler_config: { handler: 'chat' },
            category: 'Common Ground', tags: ['chat', 'common-ground']
        });
        if (ok) changed = true;
    }
    if (changed) await invalidateCache();
}

async function autoIncrementUsage(env, name) {
    // v6.38.0 自动使用打点：工具执行成功后分发层自动+1（②自动技能沉淀数据源修复，不再靠 AI 自觉调 increment_usage）
    if (!name || name === 'increment_usage') return;
    try { await handleIncrementUsage(name, { name }, env); } catch (e) { /* 静默，不污染回复 */ }
}

export async function handleMCPRequest(body, env) {
    const { method, params, id } = body || {};
    if (!method) return { ok: false, data: { jsonrpc: '2.0', id: id ?? null, error: { code: -32600, message: 'Invalid Request' } } };
    const isNotification = id === undefined || id === null;
    if (method === 'notifications/initialized' || method.startsWith('notifications/')) return { ok: true, data: null, notification: true };
    if (method === 'initialize') {
        const clientVersion = params?.protocolVersion;
        const negotiated = SUPPORTED_PROTOCOL_VERSIONS.includes(clientVersion) ? clientVersion : DEFAULT_PROTOCOL_VERSION;
        return { ok: true, data: { jsonrpc: '2.0', id, result: { protocolVersion: negotiated, capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'ZivenAgent', version: '6.5.0' } } } };
    }
    if (method === 'tools/list') {
        await syncChatTools(env);
        const skills = await getCachedSkills(env);
        const tools = skills.map(s => ({ name: s.name, description: s.description, inputSchema: s.input_schema || {} }));
        return { ok: true, data: { jsonrpc: '2.0', id, result: { tools } } };
    }
    if (method === 'tools/call') {
        const { name, arguments: args } = params || {};
        const safeArgs = args || {};
        // dispatch_tool 网关：执行前硬门禁（P0 · 2026-10-18，v6.35.7 async+注册表兜底）
        const guard = await dispatchGuard(env, name, safeArgs);
        if (!guard.allowed) {
            return { ok: true, data: { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: 'DISPATCH_GUARD_REJECT: [' + guard.code + '] ' + guard.reason + ' Expected: ' + guard.expected }] } } };
        }
        let text = '';
        try {
            // create_patch_proposal 提前拦截（无论 skills 注册与否）
            if (name === 'create_patch_proposal') {
                text = await handleCreatePatchProposal(safeArgs, env);
                return { ok: true, data: { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }] } } };
            }
            if (name?.startsWith('supabase_')) {
                text = await handleDatabaseTool(name, safeArgs, env);
                await invalidateCache();
            } else if (name === 'memory' || name?.startsWith('memory_')) {
                text = await handleMemoryTool(name, safeArgs, env);
            } else if (name?.startsWith('github_')) {
                const syncNote = await passiveSyncGithubTool(env, name);
                const guard = await githubReleaseGuard(name, safeArgs, env);
                if (!guard.allowed) {
                    text = 'RELEASE_GUARD: ' + guard.reason + ' Expected: ' + guard.expected;
                } else {
                    text = await handleGitHubTool(name, safeArgs, env);
                }
                if (syncNote) text += '\n\n' + syncNote;
            } else if (name === 'cf_proxy') {
                // v6.34.0：CF API 代理——用 env.CLOUDFLARE_API_TOKEN 代调 Cloudflare API（只执行不暴露）
                text = await handleCfProxyTool(safeArgs, env);
            } else if (CHAT_TOOL_DEFS.some(d => d.name === name)) {
                await syncChatTools(env);
                text = await handleChatTool(name, safeArgs, env);
            } else {
                const skill = await getSkillByName(env, name);
                if (!skill) {
                    if (name === 'skill_add' || name === 'skill_update' || name === 'skill_delete' || name === 'skill_list') {
                        text = await handleSkillManagement(name, safeArgs, env);
                        await invalidateCache();
                    } else if (name === 'increment_usage') {
                        text = await handleIncrementUsage(name, safeArgs, env);
                    } else if (name === 'create_patch_proposal') {
                        text = await handleCreatePatchProposal(safeArgs, env);
                    } else text = 'unknown tool: ' + name;
                } else {
                    const handler = handlerMap[skill.handler_config?.handler];
                    if (handler) text = await handler(name, safeArgs, env);
                    else text = 'handler type not implemented: ' + skill.handler_type;
                }
            }
        } catch (e) { text = 'err: ' + e.message; }
        const toolOk = !text.startsWith('err:') && !text.startsWith('RELEASE_GUARD:') && !text.startsWith('DISPATCH_GUARD_REJECT:');
        if (toolOk) await autoIncrementUsage(env, name);
        return { ok: true, data: { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }] } } };
    }
    if (method === 'ping') return { ok: true, data: { jsonrpc: '2.0', id, result: {} } };
    return { ok: true, data: { jsonrpc: '2.0', id: id ?? null, error: { code: -32601, message: 'Method not found: ' + method } } };
}

async function handleSkillManagement(name, safeArgs, env) {
    let text = '';
    if (name === 'skill_list') {
        const skills = await getEnabledSkills(env);
        if (skills.length === 0) text = 'no skills';
        else { let lines = 'skills (' + skills.length + '):' + '\n\n'; for (const s of skills) { const status = s.enabled ? 'ok' : 'off'; lines += '- ' + s.name + ' (' + status + '): ' + (s.description || '') + '\n'; } }
    } else if (name === 'skill_add') {
        if (!safeArgs.name) text = 'need name';
        else { try { await addSkill(env, { name: safeArgs.name, description: safeArgs.description || '', input_schema: safeArgs.input_schema || {}, handler_type: safeArgs.handler_type || 'js', handler_config: safeArgs.handler_config || {} }); text = 'added: ' + safeArgs.name; } catch (e) { text = 'add fail: ' + e.message; } }
    } else if (name === 'skill_update') {
        if (!safeArgs.name) text = 'need name';
        else { try { const updates = {}; if (safeArgs.description) updates.description = safeArgs.description; if (safeArgs.input_schema) updates.input_schema = safeArgs.input_schema; if (safeArgs.handler_config) updates.handler_config = safeArgs.handler_config; await updateSkill(env, safeArgs.name, updates); text = 'updated: ' + safeArgs.name; } catch (e) { text = 'update fail: ' + e.message; } }
    } else if (name === 'skill_delete') {
        if (!safeArgs.name) text = 'need name';
        else { await deleteSkill(env, safeArgs.name); text = 'deleted: ' + safeArgs.name; }
    }
    return text;
}


// ============================================================
// create_patch_proposal - GPT App 通道：读代码后把修改意图写入 patch_proposals
// 2026-09-05 Ziven x GPT #765/#766 —— P2.1.2 Patch Proposal Capability
// ============================================================
async function handleCreatePatchProposal(args, env) {
    const supabaseUrl = env.SUPABASE_URL;
    const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseKey) return '❌ Supabase 未配置';
    const required = ['target_file', 'change_summary', 'reason'];
    for (const f of required) { if (!args[f]) return '❌ 缺少参数: ' + f; }
    const headers = { 'Authorization': 'Bearer ' + supabaseKey, 'apikey': supabaseKey, 'Content-Type': 'application/json' };
    const evidence = Array.isArray(args.evidence) ? args.evidence : (args.evidence ? [args.evidence] : []);
    const diff = (typeof args.diff === 'string') ? args.diff : JSON.stringify(args.diff || {});
    const body = { target: args.target_file, change: args.change_summary, reason: args.reason, diff: diff, evidence: evidence, risk: args.risk || 'low', status: 'proposed', created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    if (args.old_sha) body.rollback_sha = args.old_sha;
    try {
        const resp = await fetch(supabaseUrl + '/rest/v1/patch_proposals', { method: 'POST', headers: { ...headers, 'Prefer': 'return=representation' }, body: JSON.stringify(body) });
        if (!resp.ok) { const errText = await resp.text(); return '❌ 写入失败 (' + resp.status + '): ' + errText; }
        const data = await resp.json();
        const id = Array.isArray(data) ? (data[0] && data[0].id) : (data && data.id);
        return '✅ Patch Proposal 已创建 (id=' + (id || '?') + '\n目标: ' + args.target_file + '\n改动: ' + args.change_summary + '\n状态: proposed（等 Ziven review + 柳柳确认）';
    } catch (e) { return '❌ 创建失败: ' + e.message; }
}