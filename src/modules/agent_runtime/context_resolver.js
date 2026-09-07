// ============================================================
// context_resolver.js — Agent Context Resolver（M1.2）
// 让被@唤醒的 Agent 知道「为什么被叫」「漏掉了什么」「已有哪些背景」
//
// 设计收敛：GPT #923/#925 + Ziven #926 确认，柳柳拍板（2026-09-07）
//
// 核心原则：
// - resolveAgentContext(env, agent_id, thread_id) —— 不接收 event/message，
//   消费游标只能来自 agent_chat_state（Agent 消费进度事实）
// - 输出固定层级 { trigger_context, delta_context, knowledge_context, state }
// - Resolver 只读取与组装，不负责生成知识（不自动摘要/不查 memory/GitHub/skill）
//
// v1 (2026-09-07)：M1.2 初版
// ============================================================

function sbFetch(env, url, headers = {}) {
    const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY;
    return fetch(url, { headers: { 'Authorization': 'Bearer ' + key, 'apikey': key, ...headers } });
}

async function getAgentState(env, agentId, threadId) {
    const resp = await sbFetch(env, `${env.SUPABASE_URL}/rest/v1/agent_chat_state?agent_id=eq.${encodeURIComponent(agentId)}&thread_id=eq.${encodeURIComponent(threadId)}&select=*&limit=1`);
    if (!resp.ok) return null;
    const rows = await resp.json();
    return rows && rows[0] ? rows[0] : null;
}

async function getTriggerContext(env, triggerEventId) {
    if (!triggerEventId) return null;
    const resp = await sbFetch(env, `${env.SUPABASE_URL}/rest/v1/chat_agent_events?event_id=eq.${encodeURIComponent(triggerEventId)}&select=event_id,message_id,agent,payload,created_at&limit=1`);
    if (!resp.ok) return null;
    const rows = await resp.json();
    const ev = rows && rows[0];
    if (!ev) return null;
    const payload = ev.payload || {};
    return {
        event_id: ev.event_id,
        message_id: ev.message_id || payload.source_message_id || payload.message_id || null,
        thread_id: payload.thread_id || null,
        author: payload.author || payload.trigger_agent || null,
        content: payload.content_preview || null,
        created_at: ev.created_at || payload.created_at || null
    };
}

async function getDeltaMessages(env, threadId, afterMessageId, limit) {
    if (!afterMessageId) {
        // 首次接触：取 thread 最近 limit 条（不含 trigger 的处理由调用方决定）
        const resp = await sbFetch(env, `${env.SUPABASE_URL}/rest/v1/chat_messages?thread_id=eq.${encodeURIComponent(threadId)}&select=message_id,author,content,created_at&order=created_at.desc&limit=${limit}`);
        if (!resp.ok) return { messages: [], overflow: false, available_count: 0 };
        const rows = await resp.json();
        rows.reverse();
        return { messages: rows, overflow: false, available_count: rows.length };
    }
    // 已有消费位置：取最近消息（desc）再过滤出 afterMessageId 之后（修复 asc+limit 取最早的 bug）
    const scanLimit = Math.max(limit * 2, 50);
    const msgResp = await sbFetch(env, `${env.SUPABASE_URL}/rest/v1/chat_messages?thread_id=eq.${encodeURIComponent(threadId)}&select=message_id,author,content,created_at&order=created_at.desc&limit=${scanLimit}`);
    if (!msgResp.ok) return { messages: [], overflow: false, available_count: 0 };
    let rows = await msgResp.json();
    rows.reverse();
    const idx = rows.findIndex(m => m.message_id === afterMessageId);
    let fresh = idx >= 0 ? rows.slice(idx + 1) : rows;
    fresh = fresh.filter(m => m.message_id !== afterMessageId);
    const available = fresh.length;
    const overflow = available > limit;
    const messages = overflow ? fresh.slice(fresh.length - limit) : fresh;
    return { messages, overflow, available_count: available };
async function getKnowledgeContext(env, threadId) {
    const resp = await sbFetch(env, `${env.SUPABASE_URL}/rest/v1/thread_contexts?thread_id=eq.${encodeURIComponent(threadId)}&select=summary,decisions,open_questions,recent_context,version,created_at&order=version.desc&limit=1`);
    if (!resp.ok) return null;
    const rows = await resp.json();
    const ctx = rows && rows[0];
    if (!ctx) return null;
    return {
        version: ctx.version || null,
        summary: ctx.summary || null,
        decisions: ctx.decisions || [],
        open_questions: ctx.open_questions || [],
        recent_context: ctx.recent_context || null
    };
}

// 主入口：M1.2 Agent Context Resolver
export async function resolveAgentContext(env, agentId, threadId) {
    if (!agentId || !threadId) {
        return { error: 'missing_params', trigger_context: null, delta_context: null, knowledge_context: null, state: null };
    }

    const state = await getAgentState(env, agentId, threadId);
    const lastTriggerEventId = state?.last_trigger_event_id || null;
    const lastConsumedMessageId = state?.last_consumed_message_id || null;

    // Layer 1：Trigger Context（强制）—— 找不到 trigger 不唤醒
    const trigger = await getTriggerContext(env, lastTriggerEventId);
    if (!trigger) {
        return {
            error: 'missing_trigger_context',
            trigger_context: null,
            delta_context: null,
            knowledge_context: null,
            state: { last_consumed_message_id: lastConsumedMessageId, last_trigger_event_id: lastTriggerEventId, last_seen_at: state?.last_seen_at || null, is_first_contact: lastConsumedMessageId == null }
        };
    }

    // Layer 2：Delta Context（核心）—— 从消费位置到 trigger
    const limit = Number(env.CONTEXT_DELTA_LIMIT) || 10;
    const deltaRaw = await getDeltaMessages(env, threadId, lastConsumedMessageId, limit);
    // 确保 trigger 消息可见（若不在 delta 里则补到最前），但不重复
    const hasTriggerMsg = deltaRaw.messages.some(m => m.message_id === trigger.message_id);
    let deltaMessages = deltaRaw.messages;
    if (trigger.message_id && !hasTriggerMsg) {
        // 把 trigger 消息单独取出来补到最前
        const tResp = await sbFetch(env, `${env.SUPABASE_URL}/rest/v1/chat_messages?message_id=eq.${encodeURIComponent(trigger.message_id)}&select=message_id,author,content,created_at&limit=1`);
        if (tResp.ok) {
            const tRows = await tResp.json();
            if (tRows && tRows[0]) deltaMessages = [tRows[0], ...deltaMessages];
        }
    }

    // Layer 3：Knowledge Context（按需）—— 只搬运不生成
    const knowledge = await getKnowledgeContext(env, threadId);

    return {
        trigger_context: trigger,
        delta_context: {
            from_message_id: lastConsumedMessageId || null,
            messages: deltaMessages.map(m => ({
                id: m.message_id,
                author: m.author,
                content: m.content ? String(m.content).slice(0, 500) : '',
                created_at: m.created_at
            })),
            count: deltaMessages.length,
            overflow: deltaRaw.overflow,
            available_count: deltaRaw.available_count
        },
        knowledge_context: knowledge,
        state: {
            last_consumed_message_id: lastConsumedMessageId,
            last_trigger_event_id: lastTriggerEventId,
            last_seen_at: state?.last_seen_at || null,
            is_first_contact: lastConsumedMessageId == null
        }
    };
}
