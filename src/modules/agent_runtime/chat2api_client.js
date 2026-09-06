// ============================================================
// chat2api_client.js — chat2api 调用封装（OpenAI 兼容格式）
// Phase 1.5 @GPT 最小闭环
// 兼容读取：CHATGPT_ACCESS_TOKEN（已配）→ CHAT2API_TOKEN（备选）
// v2 (2026-09-03)：支持 messages 数组（工具循环 Runtime Loop 多轮上下文）
// v4 (2026-09-05)：fetchWithTimeout —— 30s 超时（工具循环第二轮慢时不无限挂）
// ============================================================
// v5 (2026-09-05)：timeoutMs 可配置 —— 工具循环第二轮用短超时（v6.13 A：wall-clock 预算管理）
// v6 (2026-09-05)：429 自动降级 —— GPT_MODEL(gpt-5.6) 被限流时自动降级到默认模型(auto)重试一次
// v7 (2026-09-06)：删除 v3 tools 注入分支 —— GPT 改走原生插件通道（Ziven_MCP connector），
//                   Worker 侧不再注入 OpenAI 工具声明（柳柳拍板外部注入链路全删）
async function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } catch (e) {
        if (e.name === 'AbortError') throw new Error('chat2api timeout after ' + timeoutMs + 'ms');
        throw e;
    } finally {
        clearTimeout(timer);
    }
}

async function doChat2ApiRequest(env, body, timeoutMs) {
    const response = await fetchWithTimeout(env.CHAT2API_URL, {
        method: 'POST',
        headers: {
            'Authorization': 'Bearer ' + (env.CHATGPT_ACCESS_TOKEN || env.CHAT2API_TOKEN || ''),
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    }, timeoutMs);
    const text = await response.text();
    return { status: response.status, text };
}

export async function callChat2Api(env, promptOrMessages, options = {}) {
    const timeoutMs = options?.timeoutMs || 30000; // v5: 可配置超时（默认 30s，第二轮可传短超时）
    // 兼容：传字符串 → 单条 user 消息；传数组 → 直接用多轮 messages（工具循环用）
    const messages = Array.isArray(promptOrMessages)
        ? promptOrMessages
        : [{ role: 'user', content: promptOrMessages }];

    const body = {
        model: env.GPT_MODEL || 'gpt-4o-mini', // v6.17.3: GPT_MODEL 可配置（驱动自定义 GPT / gizmo）
        messages,
        // v6.20 (2026-09-06)：conversation_id 参数优先 —— options.conversation_id 有值用参数（含 ""=开新框），
        // 无参数回退 env.GPT_CONVERSATION_ID（默认正式对话 6a9c3dbc）。柳柳拍板：哥哥调用时自己带。
        conversation_id: Object.prototype.hasOwnProperty.call(options, 'conversation_id')
            ? options.conversation_id
            : (env.GPT_CONVERSATION_ID || null),
        // v6.21 (2026-09-06)：history_disabled 可配置 —— 执行会话用完即焚（不落 ChatGPT 历史，页面不堆聊天）
        // v6.21.1 (2026-09-06)：字段名修正！chat2api(ChatService.py L77) 读的是小写 history_disabled，
        //   之前误用大写 HISTORY_DISABLED 根本没透传到（聊天空测试 conversation_id=null 暴露的 bug）
        history_disabled: Object.prototype.hasOwnProperty.call(options, 'history_disabled')
            ? !!options.history_disabled
            : false,
        stream: false
    };

    let result = await doChat2ApiRequest(env, body, timeoutMs);

    // v6: 429 限流自动降级 —— GPT_MODEL(gpt-5.6) 超额时，改用默认模型(auto)重试一次
    // 依据：chat2api 429 detail "You can continue with the default model now"（柳柳 2026-09-05 点出）
    if (result.status === 429 && !options?.noFallback) {
        const fallbackModel = env.GPT_FALLBACK_MODEL || 'auto';
        console.log('[chat2api] 429 限流，降级模型 ' + fallbackModel + ' 重试一次');
        const fallbackBody = { ...body, model: fallbackModel };
        result = await doChat2ApiRequest(env, fallbackBody, timeoutMs);
    }

    if (result.status !== 200 && result.status !== 201) {
        throw new Error(`chat2api failed ${result.status}: ${result.text}`);
    }

    const data = JSON.parse(result.text);
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