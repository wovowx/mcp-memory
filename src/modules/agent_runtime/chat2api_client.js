// ============================================================
// chat2api_client.js — chat2api 调用封装（OpenAI 兼容格式）
// Phase 1.5 @GPT 最小闭环
// 兼容读取：CHATGPT_ACCESS_TOKEN（已配）→ CHAT2API_TOKEN（备选）
// v2 (2026-09-03)：支持 messages 数组（工具循环 Runtime Loop 多轮上下文）
// ============================================================

export async function callChat2Api(env, promptOrMessages) {
    const token = env.CHATGPT_ACCESS_TOKEN || env.CHAT2API_TOKEN || '';
    // 兼容：传字符串 → 单条 user 消息；传数组 → 直接用多轮 messages（工具循环用）
    const messages = Array.isArray(promptOrMessages)
        ? promptOrMessages
        : [{ role: 'user', content: promptOrMessages }];

    const body = {
        model: 'gpt-4o-mini',
        messages,
        conversation_id: env.GPT_CONVERSATION_ID || null,
        HISTORY_DISABLED: false,
        stream: false
    };

    const response = await fetch(env.CHAT2API_URL, {
        method: 'POST',
        headers: {
            'Authorization': 'Bearer ' + token,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`chat2api failed ${response.status}: ${text}`);
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
        throw new Error('chat2api response missing choices[0].message.content');
    }

    return {
        content,
        conversation_id: data.conversation_id || null,
        raw: data
    };
}