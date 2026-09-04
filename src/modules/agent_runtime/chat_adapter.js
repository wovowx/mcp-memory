// ============================================================
// chat_adapter.js — Runtime 与 chat.js 的适配层
// Phase 1.5 @GPT 最小闭环 + P0-2 Phase1 事件可靠基础设施
// v3 (2026-09-04)：支持 agent 参数（不再硬编码 gpt）+ delivery_status 状态机 + claimed_by
// ============================================================
import {
    createMessage,
    getPendingEvents,
    claimEvent,
    readMessage,
    ackEvent
} from "../../tools/chat.js";

const SUPABASE_HEADERS = (env) => {
    const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY;
    return { 'Authorization': 'Bearer ' + key, 'apikey': key, 'Content-Type': 'application/json', 'Prefer': 'return=representation' };
};

// P0-2：更新事件 delivery_status 状态机
export async function updateDeliveryStatus(env, eventId, status) {
    const url = `${env.SUPABASE_URL}/rest/v1/chat_agent_events?event_id=eq.${encodeURIComponent(eventId)}`;
    const resp = await fetch(url, {
        method: 'PATCH',
        headers: SUPABASE_HEADERS(env),
        body: JSON.stringify({ delivery_status: status })
    });
    if (!resp.ok) throw new Error('更新 delivery_status 失败 ' + resp.status);
    return true;
}

// P0-2：标记 dead_letter（重试超限进死信队列）
export async function markDeadLetter(env, eventId, reason) {
    const url = `${env.SUPABASE_URL}/rest/v1/chat_agent_events?event_id=eq.${encodeURIComponent(eventId)}`;
    const resp = await fetch(url, {
        method: 'PATCH',
        headers: SUPABASE_HEADERS(env),
        body: JSON.stringify({ dead_letter: true, delivery_status: 'failed' })
    });
    if (!resp.ok) throw new Error('标记 dead_letter 失败 ' + resp.status);
    return true;
}

export async function pendingEvents(env, agent = 'gpt') {
    // getPendingEvents 返回 {events:[...], limit, offset, has_more}
    const result = await getPendingEvents(env, agent);
    return Array.isArray(result?.events) ? result.events : [];
}

export async function claim(env, eventId, agent = 'gpt') {
    // claimEvent 返回 {claimed:true,event} 或 {claimed:false,...}
    const result = await claimEvent(env, eventId, agent);
    if (result?.claimed) {
        // 状态机：claimed + claimed_by 记录
        await updateDeliveryStatus(env, eventId, 'claimed').catch(() => {});
        await fetch(`${env.SUPABASE_URL}/rest/v1/chat_agent_events?event_id=eq.${encodeURIComponent(eventId)}`, {
            method: 'PATCH',
            headers: SUPABASE_HEADERS(env),
            body: JSON.stringify({ claimed_by: agent })
        }).catch(() => {});
    }
    return result;
}

export async function loadMessage(env, messageId) {
    return await readMessage(env, messageId);
}

export async function sendMessage(env, threadId, content, extra = {}, agent = 'gpt') {
    const payload = { author: agent, content, ...extra };
    return await createMessage(env, threadId, payload);
}

export async function acknowledge(env, eventId, status, agent = 'gpt') {
    const result = await ackEvent(env, eventId, agent, status);
    if (status === 'success' || status === 'failed') {
        // 终态同步 delivery_status
        await updateDeliveryStatus(env, eventId, status === 'success' ? 'acked' : 'failed').catch(() => {});
    }
    return result;
}