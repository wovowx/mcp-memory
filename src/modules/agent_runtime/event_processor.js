// ============================================================
// event_processor.js — Phase 1.5 @GPT 最小闭环核心
// pending → claim → read → chat2api → send → ack
// 注意按 chat.js 真实返回结构适配
// v2 (2026-09-03)：源头清洗 GPT 回复中的 reaction 元数据标记
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

// 清洗 GPT 回复里的 reaction 元数据（chat2api 网关把 OpenAI 的 reaction 混进了文本）
// 形如 ⚠message_reaction⚠👋⚠ —— 在 GPT App 里是「在消息下加一个小表情」，不是正文
// 源头剥离，保证写库的就是干净正文
function cleanReplyContent(text) {
    if (!text) return '';
    // 整段剥离 ⚠message_reaction⚠...⚠（含中间的 emoji）
    return String(text)
        .replace(/\u26a0message_reaction\u26a0.*?\u26a0/gs, '')
        .replace(/\u26a0[^\u26a0]*\u26a0/g, '')
        .trim();
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

            // 源头清洗：剥离 reaction 元数据，再写库
            const cleanContent = cleanReplyContent(reply.content);
            if (!cleanContent) throw new Error('GPT 回复清洗后为空');

            const sent = await sendMessage(env, message.thread_id, cleanContent);

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