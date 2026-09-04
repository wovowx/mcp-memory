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
    'chat': handleChatTool
};

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
async function githubReleaseGuard(name, safeArgs, env) {
    if (name !== 'github_push' && name !== 'github_merge_to_main' && name !== 'github_merge_pull_request') {
        return { allowed: true };
    }
    const isPush = name === 'github_push';
    const branch = isPush ? (safeArgs.branch || 'main') : 'main';
    const commitTitle = isPush ? (safeArgs.message || '') : (safeArgs.commit_title || safeArgs.title || undefined);
    return validateRelease({ repo: env.GITHUB_REPO, branch, commitTitle, action: isPush ? 'push' : 'merge' });
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
        let text = '';
        try {
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
                    } else text = 'unknown tool: ' + name;
                } else {
                    const handler = handlerMap[skill.handler_config?.handler];
                    if (handler) text = await handler(name, safeArgs, env);
                    else text = 'handler type not implemented: ' + skill.handler_type;
                }
            }
        } catch (e) { text = 'err: ' + e.message; }
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
        else { let lines = 'skills (' + skills.length + '):

'; for (const s of skills) { const status = s.enabled ? 'ok' : 'off'; lines += '- ' + s.name + ' (' + status + '): ' + (s.description || '') + '
'; } text = lines; }
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
