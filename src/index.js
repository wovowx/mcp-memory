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
// v6.6 变更（2026-09-02）：触发链 PoC webhook 端点（/api/chat/webhook）
// v6.7 变更（2026-09-02）：Phase 1.5 @GPT 最小闭环（scheduled cron + webhook 触发）
// v6.8 变更（2026-09-04）：P0-2 Phase1 watchdog —— scheduled 先 watchdogSweep 恢复生命周期，再 processPendingEvents（独立模块不挂 processor）
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
import { handleChatWebhook } from './tools/chat_webhook.js';
import { processPendingEvents } from './modules/agent_runtime/event_processor.js';
import { callChat2Api } from './modules/agent_runtime/chat2api_client.js';
import { watchdogSweep } from './modules/agent_runtime/watchdog.js';

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
        else {
            let lines = 'skills (' + skills.length + '):\n\n';
            for (const s of skills) {
                const status = s.enabled ? 'ok' : 'off';
                lines += status + ' ' + s.name + '\n';
                lines += '   ' + (s.description?.substring(0, 80) || '') + '\n';
                lines += '   ' + (s.category || 'default') + '\n\n';
            }
            text = lines;
        }
    } else if (name === 'skill_add') {
        if (!safeArgs.name || !safeArgs.description || !safeArgs.input_schema) text = 'need name, description, input_schema';
        else {
            try {
                const inputSchema = typeof safeArgs.input_schema === 'string' ? JSON.parse(safeArgs.input_schema) : safeArgs.input_schema;
                await addSkill(env, { name: safeArgs.name, description: safeArgs.description, input_schema: inputSchema, handler_type: safeArgs.handler_type || 'js', handler_config: safeArgs.handler_config || { handler: 'ai' }, category: safeArgs.category || 'default', tags: safeArgs.tags || [] });
                text = 'added: ' + safeArgs.name;
            } catch (e) { text = 'add fail: ' + e.message; }
        }
    } else if (name === 'skill_update') {
        if (!safeArgs.name) text = 'need name';
        else {
            try {
                const updates = {};
                if (safeArgs.description) updates.description = safeArgs.description;
                if (safeArgs.input_schema) updates.input_schema = typeof safeArgs.input_schema === 'string' ? JSON.parse(safeArgs.input_schema) : safeArgs.input_schema;
                if (safeArgs.category) updates.category = safeArgs.category;
                if (safeArgs.enabled !== undefined) updates.enabled = safeArgs.enabled;
                if (safeArgs.handler_config) updates.handler_config = safeArgs.handler_config;
                if (safeArgs.handler_type) updates.handler_type = safeArgs.handler_type;
                await updateSkill(env, safeArgs.name, updates); text = 'updated: ' + safeArgs.name;
            } catch (e) { text = 'update fail: ' + e.message; }
        }
    } else if (name === 'skill_delete') {
        if (!safeArgs.name) text = 'need name';
        else { await deleteSkill(env, safeArgs.name); text = 'deleted: ' + safeArgs.name; }
    }
    return text;
}

export default {
    async fetch(request, env, ctx) {
        if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return buildErrorResponse('Supabase not configured', 500);
        if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Last-Event-ID, Authorization, Accept, MCP-Session-Id', 'Access-Control-Expose-Headers': 'MCP-Session-Id, Last-Event-ID, Content-Type', 'Access-Control-Max-Age': '86400' } });
        const url = new URL(request.url);
        if (url.pathname === '/api/chat/webhook' && request.method === 'POST') {
            ctx.waitUntil(processPendingEvents(env).catch(e => console.error('webhook proc err: ' + e.message)));
            return await handleChatWebhook(request, env);
        }
        if (url.pathname === '/api/chat2api/ask' && request.method === 'POST') {
            try {
                const body = await request.json();
                const prompt = body?.message || '';
                if (!prompt) return jsonResponse({ ok: false, error: 'missing message' }, 400);
                const result = await callChat2Api(env, prompt);
                return jsonResponse({ ok: true, reply: result.content, conversation_id: result.conversation_id }, 200);
            } catch (e) {
                return jsonResponse({ ok: false, error: e.message }, 500);
            }
        }
        if (url.pathname === '/chat' || url.pathname === '/chat/' || url.pathname.startsWith('/api/chat')) { const result = await handleChatRequest(request, url, env); if (result) return result; }
        if (url.pathname === '/memory-universe' || url.pathname === '/memory-universe/') {
            try { const resp = await fetch('https://raw.githubusercontent.com/wovowx/mcp-memory/main/src/public/memory-universe.html'); const html = await resp.text(); return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Access-Control-Allow-Origin': '*' } }); }
            catch (e) { return buildErrorResponse('load memory universe fail: ' + e.message, 500); }
        }
        if (url.pathname === '/upload' && request.method === 'POST') {
            try { const formData = await request.formData(); const file = formData.get('file'); if (!file) return buildErrorResponse('no file'); if (file.size > 50 * 1024 * 1024) return buildErrorResponse('too large'); const blockedTypes = ['application/x-executable', 'application/x-msdownload', 'text/html', 'application/javascript']; if (blockedTypes.includes(file.type)) return buildErrorResponse('blocked type'); const result = await uploadFileToSupabase(file, env); return jsonResponse(result); }
            catch (e) { return buildErrorResponse(e.message, 500); }
        }
        if (url.pathname === '/github/webhook' && request.method === 'POST') {
            try { const payload = await request.json(); const result = await handleGitHubWebhook(payload, env); return jsonResponse(result); }
            catch (e) { return buildErrorResponse('Webhook fail: ' + e.message, 500); }
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
                } catch (e) { return jsonResponse({ ok: false, error: e.message }, 500); }
            }
        }
        if (url.pathname === '/') {
            const skills = await getEnabledSkills(env); return new Response('Ziven MCP Server running (' + skills.length + ' skills | Supabase OK)', { status: 200, headers: { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' } });
        }
        return new Response('Not found', { status: 404 });
    },

    async scheduled(event, env, ctx) {
        try {
            // P0-2 Phase1：先恢复生命周期（watchdog），再让消费者拿新任务（避免竞争）
            await watchdogSweep(env);
            const result = await processPendingEvents(env);
            console.log('scheduled processed:', JSON.stringify(result));
        } catch (e) {
            console.error('scheduled error:', e.message);
        }
    }
};