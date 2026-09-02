// ============================================================
// chat2api_client.js — chat2api 调用封装（OpenAI 兼容格式）
// Phase 1.5 @GPT 最小闭环
// 兼容读取：CHATGPT_ACCESS_TOKEN（已配）→ CHAT2API_TOKEN（备选）
// ============================================================

export async function callChat2Api(env, prompt) {
    const token = env.CHATGPT_ACCESS_TOKEN || env.CHAT2API_TOKEN || '';
    const response = await fetch(env.CHAT2API_URL, {
        method: 'POST',
        headers: {
            'Authorization': 'Bearer ' + token,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: prompt }],
            conversation_id: env.GPT_CONVERSATION_ID || null,
            HISTORY_DISABLED: false,
            stream: false
        })
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