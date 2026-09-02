// ============================================================
// chat_adapter.js — Runtime 与 chat.js 的适配层
// Phase 1.5 @GPT 最小闭环
// 说明：按 chat.js 真实签名适配
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

export async function sendMessage(env, threadId, content) {
    return await createMessage(env, threadId, {
        author: "gpt",
        content
    });
}

export async function acknowledge(env, eventId, status) {
    // ackEvent 签名 (env, eventId, agent, targetStatus)，不含 payload
    return await ackEvent(env, eventId, "gpt", status);
}