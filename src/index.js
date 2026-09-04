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
// v6.9 变更（2026-09-04）：release_guard 前置闸 —— github_push/merge 到 main 必须版本化（柳柳要求硬拦截，不靠记性）
// @ts-nocheck
import { buildErrorResponse, jsonResponse } from './utils/response.js';
import { uploadFileToSupabase } from './utils/storage.js';
import { getEnabledSkills } from './utils/skills.js';
import { handleChatRequest } from './tools/chat.js';
import { handleChatWebhook } from './tools/chat_webhook.js';
import { processPendingEvents } from './modules/agent_runtime/event_processor.js';
import { callChat2Api } from './modules/agent_runtime/chat2api_client.js';
import { watchdogSweep } from './modules/agent_runtime/watchdog.js';
import { handleMCPRequest } from './modules/mcp_router.js';

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
};
