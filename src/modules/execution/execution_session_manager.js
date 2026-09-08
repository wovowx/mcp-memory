// ============================================================
// execution_session_manager.js — Execution Session Manager (B4)
// 执行 GPT 独立框的「会话编排层」：任务开始前，明确获得一个
// 可控、可追踪、独占的 GPT conversation 资源。
//
// 设计收敛：GPT + Ziven 讨论确认，柳柳拍板（2026-09-08）
//
// 核心原则：
// - 不属于 chat2api（只负责 transport），也不塞进 execution_run（任务生命周期）
// - 显式不隐式：execution_session_init -> ready -> 再 execution_start
// - conversation_id 是「执行资源」不是身份；身份 = agent_id + thread_id
// - 换 id = 归档旧 + 新增新 + 写事件，不 UPDATE
//
// v1 (2026-09-08)：领 id + bind + rotate + archive
// ============================================================

function sbFetch(env, url, method, body) {
    if (method === undefined) method = 'GET';
    const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY;
    const headers = { "Authorization": "Bearer " + key, "apikey": key, "Content-Type": "application/json", "Prefer": "return=representation" };
    const opts = { method, headers };
    if (body) opts.body = JSON.stringify(body);
    return fetch(url, opts);
}

async function acquireConversation(env, initMessage) {
    const chat2apiUrl = env.CHAT2API_URL;
    const body = {
        model: env.GPT_MODEL || "gpt-4o-mini",
        messages: [{ role: "user", content: initMessage || "初始化执行会话。" }],
        conversation_id: "",
        history_disabled: false,
        stream: false
    };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), (env.EXEC_TIMEOUT_MS || 30000));
    try {
        const resp = await fetch(chat2apiUrl, {
            method: "POST",
            headers: { "Authorization": "Bearer " + (env.CHATGPT_ACCESS_TOKEN || env.CHAT2API_TOKEN || ""), "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: controller.signal
        });
        const text = await resp.text();
        if (!resp.ok) throw new Error("chat2api init failed " + resp.status + ": " + text.slice(0, 300));
        const data = JSON.parse(text);
        const cid = data.conversation_id || null;
        if (!cid) throw new Error("chat2api did not return conversation_id (is bridge < v8?)");
        return { conversation_id: cid };
    } catch (e) {
        if (e.name === "AbortError") throw new Error("chat2api init timeout");
        throw e;
    } finally {
        clearTimeout(timer);
    }
}

async function bindConversation(env, agentId, threadId, conversationId, reason) {
    const url = env.SUPABASE_URL + "/rest/v1/conversation_bindings";
    const row = {
        conversation_id: conversationId,
        agent_id: agentId,
        thread_id: threadId,
        purpose: "execution",
        access_mode: "exclusive",
        route_type: "temporary",
        status: "active",
        source: "execution_session_init",
        metadata: { reason: reason || "session init", created_by: "execution_session_manager" }
    };
    const resp = await sbFetch(env, url, "POST", row);
    if (!resp.ok) throw new Error("bindConversation failed " + resp.status + ": " + (await resp.text()).slice(0, 300));
    const rows = await resp.json();
    return (Array.isArray(rows) && rows[0]) || rows;
}

async function writeBindingChangedEvent(env, agentId, threadId, oldId, newId, reason) {
    try {
        const url = env.SUPABASE_URL + "/rest/v1/chat_agent_events";
        const ev = {
            agent: agentId,
            payload: {
                event_type: "conversation_binding_changed",
                type: "conversation_binding_changed",
                old_id: oldId,
                new_id: newId,
                reason: reason,
                thread_id: threadId,
                timestamp: new Date().toISOString()
            },
            status: "pending"
        };
        const resp = await sbFetch(env, url, "POST", ev);
        if (!resp.ok) console.error("[exec] write event failed: " + resp.status + ": " + (await resp.text()).slice(0, 200));
    } catch (e) {
        console.error("[exec] write event error: " + e.message);
    }
}

async function archiveActiveBindings(env, agentId, threadId) {
    const url = env.SUPABASE_URL + "/rest/v1/conversation_bindings?agent_id=eq." + encodeURIComponent(agentId)
        + "&thread_id=eq." + encodeURIComponent(threadId) + "&status=eq.active";
    const resp = await sbFetch(env, url, "PATCH", { status: "archived", archived_at: new Date().toISOString() });
    if (!resp.ok) throw new Error("archiveActiveBindings failed " + resp.status);
    return resp.json();
}

export async function initExecutionSession(env, opts) {
    const agent = opts.agentId || "gpt";
    const thread = opts.threadId || "execution-room";
    const acquired = await acquireConversation(env, opts.initMessage);
    const binding = await bindConversation(env, agent, thread, acquired.conversation_id, opts.reason);
    return { status: "ready", execution_session_id: binding.id, conversation_id: acquired.conversation_id, binding_id: binding.id, agent_id: agent, thread_id: thread };
}

export async function rotateExecutionSession(env, opts) {
    const agent = opts.agentId || "gpt";
    const thread = opts.threadId || "execution-room";
    const url = env.SUPABASE_URL + "/rest/v1/conversation_bindings?agent_id=eq." + encodeURIComponent(agent)
        + "&thread_id=eq." + encodeURIComponent(thread) + "&status=eq.active&select=id,conversation_id&limit=1";
    const resp = await sbFetch(env, url);
    const rows = resp.ok ? await resp.json() : [];
    const oldId = rows && rows[0] ? rows[0].conversation_id : null;
    await archiveActiveBindings(env, agent, thread);
    const acquired = await acquireConversation(env, "执行会话更换，初始化新对话。");
    const binding = await bindConversation(env, agent, thread, acquired.conversation_id, opts.reason || "context_reset");
    await writeBindingChangedEvent(env, agent, thread, oldId, acquired.conversation_id, opts.reason || "context_reset");
    return { status: "ready", execution_session_id: binding.id, conversation_id: acquired.conversation_id, binding_id: binding.id, previous_conversation_id: oldId, agent_id: agent, thread_id: thread };
}

export async function getActiveExecutionBinding(env, opts) {
    const agent = opts.agentId || "gpt";
    const thread = opts.threadId || "execution-room";
    const url = env.SUPABASE_URL + "/rest/v1/conversation_bindings?agent_id=eq." + encodeURIComponent(agent)
        + "&thread_id=eq." + encodeURIComponent(thread) + "&status=eq.active&purpose=eq.execution&select=*&order=created_at.desc&limit=1";
    const resp = await sbFetch(env, url);
    if (!resp.ok) throw new Error("getActiveExecutionBinding failed " + resp.status);
    const rows = await resp.json();
    return rows && rows[0] ? rows[0] : null;
}
