// ============================================================
// chat_adapter.js — Runtime 与 chat.js 的适配层
// Phase 1.5 @GPT 最小闭环
// 说明：按 chat.js 真实签名适配
// v2 (2026-09-03)：sendMessage 支持额外字段（tool_calls 随消息写入）
// ============================================================
import {
    createMessage,
    getPendingEvents,
    claimEvent,
    readMessage,
    ackEvent
} from "../../tools/chat.js";

export async function pendingEvents(env) {
    // getPendingEvents 返回 {events:[...], limit, offset, has_more}
    const result = await getPendingEvents(env, "gpt");
    return Array.isArray(result?.events) ? result.events : [];
}

export async function claim(env, eventId) {
    // claimEvent 返回 {claimed:true,event} 或 {claimed:false,...}
    return await claimEvent(env, eventId, "gpt");
}

export async function loadMessage(env, messageId) {
    return await readMessage(env, messageId);
}

export async function sendMessage(env, threadId, content, extra = {}) {
    // extra.tool_calls 会作为消息的额外字段（前端渲染工具卡片用）
    const payload = { author: "gpt", content, ...extra };
    return await createMessage(env, threadId, payload);
}

export async function acknowledge(env, eventId, status) {
    // ackEvent 签名 (env, eventId, agent, targetStatus)，不含 payload
    return await ackEvent(env, eventId, "gpt", status);
}