// ============================================================
// event_processor.js — Phase 1.5 @GPT 最小闭环核心
// pending → claim → read → chat2api → send → ack
// 注意按 chat.js 真实返回结构适配
// ============================================================
import { pendingEvents, claim, loadMessage, sendMessage, acknowledge } from "./chat_adapter.js";
import { callChat2Api } from "./chat2api_client.js";

function buildPrompt(message) {
    return `你是 Common Ground 中的 GPT Agent。

请直接、简洁地回复下面这条来自用户的 @ 消息。

Thread:
${message.thread_id}

用户:
${message.content}

请直接回复用户，不要附加多余的说明。`;
}

export async function processPendingEvents(env) {
    const events = await pendingEvents(env);

    for (const event of events) {
        // claimEvent 返回 {claimed:true/false,...}
        const claimed = await claim(env, event.event_id);
        if (!claimed || !claimed.claimed) continue; // 已被其他 runtime 抢走

        try {
            const message = await loadMessage(env, event.message_id);
            if (!message) throw new Error('无法读取消息');

            const prompt = buildPrompt(message);
            const reply = await callChat2Api(env, prompt);

            const sent = await sendMessage(env, message.thread_id, reply.content);

            await acknowledge(env, event.event_id, 'success');
        } catch (error) {
            // GPT 失败必须保留 failed 状态，不能吞掉
            try {
                await acknowledge(env, event.event_id, 'failed');
            } catch (ackErr) {
                console.error('ack failed fallback err: ' + ackErr.message, 'orig: ' + error.message);
            }
        }
    }
    return { processed: events.length };
}