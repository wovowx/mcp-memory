// ============================================================
// Chatroom MVP - 页面 + API 路由（v1）
// 2026-09-01 三方对齐（11方案/15数据模型/16建表SQL/22分工）
// rules: GPT agent_events.py 同规则（@all展开、mentions语义、agent_events仅agent）
// ============================================================
import { jsonResponse, buildErrorResponse } from '../utils/response.js';

const AGENTS = ['gpt', 'ziven'];
const ALL_ACTORS = ['liuliu', 'gpt', 'ziven'];
const PRECIPITATE_KEYWORD = '@沉淀';

// ------------------------------------------------------------
// Supabase REST（沿用 database.js 模式）
// 优先 service role key（RLS 之下仍可读写），fallback anon key
// ------------------------------------------------------------
function supabaseHeaders(env) {
    const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY;
    return {
        'Authorization': `Bearer ${key}`,
        'apikey': key,
        'Content-Type': 'application/json'
    };
}

async function sbQuery(env, table, opts = {}) {
    const { select = '*', filters = null, order = null, limit = null } = opts;
    let url = `${env.SUPABASE_URL}/rest/v1/${table}?select=${select}`;
    if (filters) {
        for (const [col, val] of Object.entries(filters)) {
            const v = encodeURIComponent(val);
            url += `&${col}=eq.${v}`;
        }
    }
    if (order) url += `&order=${order}`;
    if (limit) url += `&limit=${limit}`;
    const resp = await fetch(url, { headers: supabaseHeaders(env) });
    if (!resp.ok) throw new Error(`查询失败 ${resp.status}: ${await resp.text()}`);
    return resp.json();
}

async function sbInsert(env, table, data, { ignoreDuplicates = false } = {}) {
    const headers = supabaseHeaders(env);
    if (ignoreDuplicates) headers['Prefer'] = 'resolution=ignore-duplicates,return=representation';
    else headers['Prefer'] = 'return=representation';
    const resp = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(data)
    });
    if (!resp.ok) throw new Error(`插入失败 ${resp.status}: ${await resp.text()}`);
    return resp.json();
}

async function sbUpdate(env, table, idCol, id, data) {
    const resp = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${idCol}=eq.${id}`, {
        method: 'PATCH',
        headers: supabaseHeaders(env),
        body: JSON.stringify(data)
    });
    if (!resp.ok) throw new Error(`更新失败 ${resp.status}: ${await resp.text()}`);
    return resp.json();
}

// ------------------------------------------------------------
// mentions 解析（与 GPT agent_events.py 同规则）
// 返回 { mentions: string[], events: string[] }
// - mentions：原文语义 @ 到的完整目标（区分大小写宽松）
// - events：实际需要生成 Agent Event 的 agent（仅 gpt/ziven）
// - @all → mentions=[liuliu,gpt,ziven]，events 只含 gpt/ziven
// - @沉淀 → 只进 mentions，不生成事件
// ------------------------------------------------------------
function parseMentions(content) {
    const mentions = [];
    const events = [];
    if (!content) return { mentions, events };
    const lower = content.toLowerCase();

    if (lower.includes('@all')) {
        for (const a of ALL_ACTORS) {
            if (!mentions.includes(a)) mentions.push(a);
        }
        for (const a of AGENTS) {
            if (!events.includes(a)) events.push(a);
        }
    }

    if (lower.includes(PRECIPITATE_KEYWORD)) {
        if (!mentions.includes('沉淀')) mentions.push('沉淀');
    }

    for (const a of ALL_ACTORS) {
        if (lower.includes('@' + a)) {
            if (!mentions.includes(a)) mentions.push(a);
            if (AGENTS.includes(a) && !events.includes(a)) events.push(a);
        }
    }

    return { mentions, events };
}

// ------------------------------------------------------------
// 发消息：写 message + 生成 agent events（幂等）
// ------------------------------------------------------------
async function createMessage(env, threadId, payload) {
    const author = (payload.author || 'liuliu').toLowerCase();
    const content = String(payload.content || '').trim();
    if (!content) throw new Error('消息内容不能为空');
    if (!ALL_ACTORS.includes(author)) throw new Error(`非法 author: ${author}`);

    const { mentions, events } = parseMentions(content);

    // 1. 写 message（mentions 存原文语义）
    const msgData = {
        thread_id: threadId,
        author,
        content,
        mentions: mentions.length ? mentions : null,
        reply_to: payload.reply_to || null
    };
    const inserted = await sbInsert(env, 'chat_messages', msgData);
    const message = Array.isArray(inserted) ? inserted[0] : inserted;
    const messageId = message.message_id;

    // 2. 为每个实际 agent 生成事件（幂等：UNIQUE(message_id, agent) + ignore-duplicates）
    const created = [];
    for (const agent of events) {
        const eventData = {
            message_id: messageId,
            agent,
            status: 'processing',
            payload: {
                thread_id: threadId,
                author,
                content,
                mentions
            }
        };
        try {
            await sbInsert(env, 'chat_agent_events', eventData, { ignoreDuplicates: true });
            created.push(agent);
        } catch (e) {
            // 不因单个事件失败阻塞消息本身
        }
    }

    return { message, mentions, events: created };
}

// ------------------------------------------------------------
// 路由分发
// ------------------------------------------------------------
export async function handleChatRequest(request, url, env) {
    const path = url.pathname;
    const method = request.method;

    // 页面
    if (path === '/chat' || path === '/chat/') {
        if (method !== 'GET') return new Response('Method not allowed', { status: 405 });
        try {
            const resp = await fetch('https://raw.githubusercontent.com/wovowx/mcp-memory/main/src/public/chat.html');
            const html = await resp.text();
            return new Response(html, {
                status: 200,
                headers: {
                    'Content-Type': 'text/html; charset=utf-8',
                    'Access-Control-Allow-Origin': '*'
                }
            });
        } catch (e) {
            return buildErrorResponse('加载聊天室失败: ' + e.message, 500);
        }
    }

    // API
    if (!path.startsWith('/api/chat')) return null; // 不是本路由，交给上层

    const segments = path.split('/').filter(Boolean); // ['api','chat',...]

    try {
        // GET /api/chat/threads
        if (segments.length === 3 && method === 'GET') {
            const data = await sbQuery(env, 'chat_threads', { order: 'created_at.desc', limit: 100 });
            return jsonResponse(data);
        }

        // POST /api/chat/threads
        if (segments.length === 3 && method === 'POST') {
            const body = await request.json();
            const title = String(body.title || '未命名话题').trim();
            const creator = (body.creator || 'liuliu').toLowerCase();
            if (!ALL_ACTORS.includes(creator)) throw new Error(`非法 creator: ${creator}`);
            const data = await sbInsert(env, 'chat_threads', { title, creator, status: 'active' });
            const thread = Array.isArray(data) ? data[0] : data;
            return jsonResponse(thread, 201);
        }

        // GET /api/chat/threads/:id/messages
        if (segments.length === 5 && segments[3] === 'messages' && method === 'GET') {
            const id = decodeURIComponent(segments[4]);
            const data = await sbQuery(env, 'chat_messages', {
                filters: { thread_id: id },
                order: 'created_at.asc'
            });
            return jsonResponse(data);
        }

        // POST /api/chat/threads/:id/messages
        if (segments.length === 5 && segments[3] === 'messages' && method === 'POST') {
            const id = decodeURIComponent(segments[4]);
            const payload = await request.json();
            const result = await createMessage(env, id, payload);
            return jsonResponse(result, 201);
        }

        // GET /api/chat/events?agent=&status=
        if (segments.length === 3 && segments[2] === 'events' && method === 'GET') {
            const agent = url.searchParams.get('agent');
            const status = url.searchParams.get('status') || 'processing';
            const filters = { status };
            if (agent) filters.agent = agent;
            const data = await sbQuery(env, 'chat_agent_events', {
                filters,
                order: 'created_at.asc',
                limit: 50
            });
            return jsonResponse(data);
        }

        // POST /api/chat/events/:id/update
        if (segments.length === 5 && segments[2] === 'events' && segments[4] === 'update' && method === 'POST') {
            const eventId = decodeURIComponent(segments[3]);
            const body = await request.json();
            const allowed = ['processing', 'success', 'failed'];
            if (!allowed.includes(body.status)) throw new Error(`非法 status: ${body.status}`);
            const data = await sbUpdate(env, 'chat_agent_events', 'event_id', eventId, { status: body.status });
            return jsonResponse(data);
        }

        return buildErrorResponse('API 路由不存在: ' + path, 404);
    } catch (e) {
        return buildErrorResponse(e.message, 400);
    }
}
