// ============================================================
// Worker 入口（优化版v5 - MCP 兼容版）
// ============================================================
// v5 变更（2026-08-31）：MCP 兼容性改造（方案A·最小手术）
//  1. 移除 hasCalledHelp 模块级全局守卫（跨客户端状态污染）
//  2. initialize 做协议版本协商
//  3. 处理 notifications/initialized（notification 回 202 空响应）
//  4. CORS 补齐 Authorization/Accept/MCP-Session-Id
//  5. 保留无状态 POST 应答（stateless 模式），GET 兼容 SSE
// v6.3 变更（2026-09-01）：自动注册兜底（passiveSyncGithubTool）
// v6.5 变更（2026-09-01）：Common Ground chat MCP tools
// @ts-nocheck
import { buildErrorResponse, jsonResponse } from './utils/response.js';
import { uploadFileToSupabase } from './utils/storage.js';
import { getEnabledSkills, getSkillByName, addSkill, updateSkill, deleteSkill } from './utils/skills.js';
import { handleMemoryTool } from './tools/memory_unified.js';
import { handleDataTool } from './tools/data.js';
import { handleAITool } from './tools/ai.js';
import { handleGitHubTool, GITHUB_TOOL_DEFS } from './tools/github_v64.js';
import { handleDatabaseTool } from './tools/database.js';
import { handleCategoryTool } from './tools/category.js';
import handleKnowledgeSkill from './tools/knowledge.js';
import { handleIncrementUsage } from './tools/increment_usage.js';
import { handleDeleteBranch } from './tools/delete_branch.js';
import { handleChatRequest } from './tools/chat.js';
import { handleChatTool, CHAT_TOOL_DEFS } from './tools/chat_mcp.js';

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
        return ok ? '⚠️ 已自动注册新工具：' + name + '——哥哥有空检查一下 schema 是否正确（自动注册只补缺，不覆盖）' : '⚠️ 自动注册失败：' + name;
    } catch (e) { return '⚠️ 自动注册检查出错：' + e.message; }
}

// Common Ground chat tools use the same skills registry as other MCP tools.
// Missing chat definitions are inserted once; existing rows are never overwritten.
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

async function handleMCPRequest(body, env) {
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
                text = await handleGitHubTool(name, safeArgs, env);
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
                    } else text = '❌ 未知工具：' + name;
                } else {
                    const handler = handlerMap[skill.handler_config?.handler];
                    if (handler) text = await handler(name, safeArgs, env);
                    else text = '❌ 技能类型未实现：' + skill.handler_type;
                }
            }
        } catch (e) { text = '❌ 执行出错：' + e.message; }
        return { ok: true, data: { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }] } } };
    }
    if (method === 'ping') return { ok: true, data: { jsonrpc: '2.0', id, result: {} } };
    return { ok: true, data: { jsonrpc: '2.0', id: id ?? null, error: { code: -32601, message: 'Method not found: ' + method } } };
}

async function handleSkillManagement(name, safeArgs, env) {
    let text = '';
    if (name === 'skill_list') {
        const skills = await getEnabledSkills(env);
        if (skills.length === 0) text = '💡 暂无技能';
        else {
            let lines = '💡 **技能列表**（共 ' + skills.length + ' 个）：\n\n';
            for (const s of skills) {
                const status = s.enabled ? '✅' : '⛔';
                lines += `${status} **${s.name}**\n`;
                lines += `   📝 ${s.description?.substring(0, 80) || ''}${s.description?.length > 80 ? '...' : ''}\n`;
                lines += `   📂 ${s.category || '默认'}\n\n`;
            }
            text = lines;
        }
    } else if (name === 'skill_add') {
        if (!safeArgs.name || !safeArgs.description || !safeArgs.input_schema) text = '❌ 缺少参数：需要 name, description, input_schema';
        else {
            try {
                const inputSchema = typeof safeArgs.input_schema === 'string' ? JSON.parse(safeArgs.input_schema) : safeArgs.input_schema;
                await addSkill(env, { name: safeArgs.name, description: safeArgs.description, input_schema: inputSchema, handler_type: safeArgs.handler_type || 'js', handler_config: safeArgs.handler_config || { handler: 'ai' }, category: safeArgs.category || '自定义', tags: safeArgs.tags || [] });
                text = '✅ 技能已添加：' + safeArgs.name + '\n' + '📝 描述：' + safeArgs.description.substring(0, 100) + '\n' + '📂 分类：' + (safeArgs.category || '自定义');
            } catch (e) { text = '❌ 添加失败：' + e.message; }
        }
    } else if (name === 'skill_update') {
        if (!safeArgs.name) text = '❌ 缺少参数：需要 name';
        else {
            try {
                const updates = {};
                if (safeArgs.description) updates.description = safeArgs.description;
                if (safeArgs.input_schema) updates.input_schema = typeof safeArgs.input_schema === 'string' ? JSON.parse(safeArgs.input_schema) : safeArgs.input_schema;
                if (safeArgs.category) updates.category = safeArgs.category;
                if (safeArgs.enabled !== undefined) updates.enabled = safeArgs.enabled;
                if (safeArgs.handler_config) updates.handler_config = safeArgs.handler_config;
                if (safeArgs.handler_type) updates.handler_type = safeArgs.handler_type;
                await updateSkill(env, safeArgs.name, updates); text = '✅ 技能已更新：' + safeArgs.name;
            } catch (e) { text = '❌ 更新失败：' + e.message; }
        }
    } else if (name === 'skill_delete') {
        if (!safeArgs.name) text = '❌ 缺少参数：需要 name';
        else { await deleteSkill(env, safeArgs.name); text = '🗑️ 已删除技能：' + safeArgs.name; }
    }
    return text;
}

async function handleGitHubWebhook(payload, env) {
    try {
        const event = payload.action || 'push'; const ref = payload.ref || 'refs/heads/main';
        if (ref !== 'refs/heads/main') return { status: 'ignored', reason: '非main分支' };
        await invalidateCache(); return { status: 'success', message: '技能缓存已清除，等待下次help()调用刷新', event };
    } catch (e) { return { status: 'error', message: e.message }; }
}

export default {
    async fetch(request, env) {
        if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return buildErrorResponse('Supabase 未配置：请在环境变量中设置 SUPABASE_URL 和 SUPABASE_ANON_KEY', 500);
        if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Last-Event-ID, Authorization, Accept, MCP-Session-Id', 'Access-Control-Expose-Headers': 'MCP-Session-Id, Last-Event-ID, Content-Type', 'Access-Control-Max-Age': '86400' } });
        const url = new URL(request.url);
        if (url.pathname === '/chat' || url.pathname === '/chat/' || url.pathname.startsWith('/api/chat')) { const result = await handleChatRequest(request, url, env); if (result) return result; }
        if (url.pathname === '/memory-universe' || url.pathname === '/memory-universe/') {
            try { const resp = await fetch('https://raw.githubusercontent.com/wovowx/mcp-memory/main/src/public/memory-universe.html'); const html = await resp.text(); return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Access-Control-Allow-Origin': '*' } }); }
            catch (e) { return buildErrorResponse('加载记忆宇宙失败: ' + e.message, 500); }
        }
        if (url.pathname === '/upload' && request.method === 'POST') {
            try { const formData = await request.formData(); const file = formData.get('file'); if (!file) return buildErrorResponse('没有文件'); if (file.size > 50 * 1024 * 1024) return buildErrorResponse('文件太大，最大 50MB'); const blockedTypes = ['application/x-executable', 'application/x-msdownload', 'text/html', 'application/javascript']; if (blockedTypes.includes(file.type)) return buildErrorResponse('不支持该文件类型'); const result = await uploadFileToSupabase(file, env); return jsonResponse(result); }
            catch (e) { return buildErrorResponse(e.message, 500); }
        }
        if (url.pathname === '/github/webhook' && request.method === 'POST') {
            try { const payload = await request.json(); const result = await handleGitHubWebhook(payload, env); return jsonResponse(result); }
            catch (e) { return buildErrorResponse('Webhook处理失败: ' + e.message, 500); }
        }
        if (url.pathname === '/mcp') {
            if (request.method === 'GET') {
                const accept = (request.headers.get('Accept') || '').toLowerCase();
                if (accept.includes('text/event-stream')) {
                    const encoder = new TextEncoder(); const stream = new ReadableStream({ start(controller) { controller.enqueue(encoder.encode('event: message\n')); controller.enqueue(encoder.encode('data: {"type":"connected"}\n\n')); const keepAlive = setInterval(() => { try { controller.enqueue(encoder.encode(': keepalive\n\n')); } catch { clearInterval(keepAlive); } }, 30000); return () => clearInterval(keepAlive); } });
                    return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'Connection': 'keep-alive', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept, MCP-Session-Id' } });
                }
                return jsonResponse({ service: 'ZivenAgent', status: 'ok', mcp: '/mcp' });
            }
            if (request.method === 'POST') {
                try {
                    const body = await request.json(); const result = await handleMCPRequest(body, env);
                    if (result.notification) return new Response(null, { status: 202, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept, MCP-Session-Id' } });
                    const status = result.ok === false ? 400 : 200;
                    return new Response(JSON.stringify(result.data), { status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept, MCP-Session-Id' } });
                } catch (e) { return jsonResponse({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error: ' + e.message } }, 400); }
            }
            return new Response('Method not allowed', { status: 405 });
        }
        if (url.pathname === '/' || url.pathname === '/health') {
            const skills = await getEnabledSkills(env); return new Response('💚 Ziven MCP Server running (' + skills.length + ' skills | Supabase OK)', { status: 200, headers: { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' } });
        }
        return new Response('Not found', { status: 404 });
    }
};
