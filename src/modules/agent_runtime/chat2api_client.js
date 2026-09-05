// ============================================================
// chat2api_client.js — chat2api 调用封装（OpenAI 兼容格式）
// Phase 1.5 @GPT 最小闭环
// 兼容读取：CHATGPT_ACCESS_TOKEN（已配）→ CHAT2API_TOKEN（备选）
// v2 (2026-09-03)：支持 messages 数组（工具循环 Runtime Loop 多轮上下文）
// v3 (2026-09-05)：Level 1 Capability Injection MVP —— 支持 tools 参数（OpenAI 工具声明）
// v4 (2026-09-05)：fetchWithTimeout —— 30s 超时（工具循环第二轮慢时不无限挂）
// ============================================================

// v5 (2026-09-05)：timeoutMs 可配置 —— 工具循环第二轮用短超时（v6.13 A：wall-clock 预算管理）
// v6 (2026-09-05)：429 自动降级 —— GPT_MODEL(gpt-5.6) 被限流时自动降级到默认模型(auto)重试一次，避免事件 delivery failed 卡死 GPT 收不到消息（柳柳点出「用auto模型」+ 429 提示 continue with default model）
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
        conversation_id: env.GPT_CONVERSATION_ID || null,
        HISTORY_DISABLED: false,
        stream: false
    };

    // v3: Capability Injection —— 把 MCP 能力以 OpenAI tools 声明传入，让模型真正「看到可调用工具」
    // 这是 Level 1 验收的核心：注入不只是 prompt 文本，而是结构化工具声明
    if (Array.isArray(options?.tools) && options.tools.length > 0) {
        body.tools = options.tools;
        body.tool_choice = 'auto';
        // v3 trace（GPT #691 要求 #1）：payload 级证据 —— tools 有没有真的进请求
        console.log('[chat2api-payload] tool_count=' + options.tools.length + ' tool_names=' + options.tools.map(t => t.function?.name).join(','));
    } else {
        console.log('[chat2api-payload] tools=EMPTY（本轮未注入工具声明）');
    }

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