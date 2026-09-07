// ============================================================
// event_processor.js — Phase 1.5 @GPT 最小闭环核心（纯净版 v9）
// pending → claim → read → chat2api → send → ack
//
// v9 (2026-09-06)：外部工具注入链路全部移除（柳柳拍板）
//   删：文本标记解析（parseToolCalls/extractJsonObject）
//        Worker 代执行（executeTool/TOOLS 注册表）
//        审计链（agent_tool_calls + capability_trace）
//        结论队列（agent_tool_conclusions + processToolConclusions）
//        MCP permission guard + discoverToolsForPrompt 文本注入
//   留：事件生命周期（chat_adapter）
//        callChat2Api（GPT 真身）
//        readThreadContext（防失忆主动上下文注入）
//        buildSystemPrompt（原生 MCP 提示——GPT 经自己 App 插件调用工具）
// 背景：GPT 改走 ChatGPT App 内部原生插件（Ziven_MCP connector），
// v10 (2026-09-06)：buildSystemPrompt 去工具名（意图式委托，柳柳拍板）——删 create_patch_proposal 幽灵工具引用 + 显式点名工具名；能力描述意图式（按任务目标自主选工具）
//       Worker 侧不再代执行工具，注入/审计/结论全部失去意义。
// ============================================================
import { pendingEvents, claim, loadMessage, sendMessage, acknowledge } from "./chat_adapter.js";
import { callChat2Api } from "./chat2api_client.js";
import { resolveAgentContext } from "./context_resolver.js"; // M1.2

const CHAT_TIMEOUT_MS = 27000; // 单轮 GPT 调用预算（Cloudflare Worker 30s wall-clock 硬上限）

// ============ Thread 上下文读取（T3.1 防失忆） ============
async function readThreadContext(env, threadId, limit = 10) {
    if (!threadId) return null;
    const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY;
    const h = { 'Authorization': 'Bearer ' + key, 'apikey': key };
    try {
        const tr = await fetch(env.SUPABASE_URL + "/rest/v1/chat_threads?thread_id=eq." + threadId + "&select=thread_id,title,status,created_at,creator", { headers: h });
        const threads = tr.ok ? await tr.json() : [];
        const mr = await fetch(env.SUPABASE_URL + "/rest/v1/chat_messages?thread_id=eq." + threadId + "&select=author,content,created_at&order=created_at.desc&limit=" + limit, { headers: h });
        const msgs = mr.ok ? await mr.json() : [];
        msgs.reverse();
        const cr = await fetch(env.SUPABASE_URL + "/rest/v1/thread_contexts?thread_id=eq." + threadId + "&select=summary,decisions,open_questions,recent_context,version,created_at&order=version.desc&limit=1", { headers: h });
        const contexts = cr.ok ? await cr.json() : [];
        return {
            thread: threads[0] || { thread_id: threadId },
            recent_messages: msgs.map(m => ({ author: m.author, content: m.content, created_at: m.created_at })),
            context: contexts[0] || null
        };
    } catch (e) {
        console.error("[context_read] err: " + e.message);
        return null;
    }
}

function buildSystemPrompt(message, context) {
    const ctxBlock = context
        ? "<runtime_context>\n标题: " + (context.thread?.title || message.thread_id) + "\n状态: " + (context.thread?.status || "unknown") + "\n最近消息 (" + (context.recent_messages?.length || 0) + "条):\n" + (context.recent_messages || []).map(m => "[" + m.author + "] " + String(m.content).slice(0, 200)).join("\n") + "\n\n历史摘要 v" + (context.context?.version || "-") + ":\n" + (context.context?.summary || "(暂无摘要)") + "\n决定: " + JSON.stringify(context.context?.decisions || []) + "\n开放问题: " + JSON.stringify(context.context?.open_questions || []) + "\n下一步: " + JSON.stringify((context.context?.recent_context && context.context.recent_context.next_actions) || []) + "</runtime_context>"
        : '';
    return "你是 Common Ground 中的 GPT Agent。\n\n请直接、简洁地回复用户 @ 的消息。\n\n当前 Thread:\n" + message.thread_id + "\n\n" + ctxBlock + "\n\n工具能力：你已原生挂载 Ziven_MCP 插件，MCP 工具可直接调用。当需要读取代码、查询数据或完成操作时，根据任务目标自行选择当前可用工具完成即可——工具会真实执行并返回结果。**不需要输出任何文本标记，也不需要模拟工具调用格式**。\n\n行为规范（Active Policies，见 ZivenLab governance/policy-index.md）：\n- AAD 行为透明：每次回复末尾用 [Activity] 块披露 Actions/Observation/Decision/Evidence/NotDone（没调用过的工具不许写「已读取」）\n- Ownership 闭环：承诺「盯着/负责」= 一口气跑到终态，不把检查责任转回 Ziven/柳柳；等待是状态不是结束\n\n协同写代码流程（配合 Ziven / 柳柳）：\n1. 理解任务：先输出需求理解（目标 / 涉及模块 / 未知信息）\n2. 读取代码：读取目标文件 + 相关依赖（不猜，先看事实）\n3. 提方案：基于已读事实，给出修改方案（含当前行为 / 期望行为 / 理由 / 依据 / 风险 / 测试计划），请 Ziven review、柳柳确认（方向变化时）\n4. 人工审核：Ziven review → 柳柳确认（方向变化时）→ 由 Ziven 合并与部署\n\n如果上下文已足够就直接回复用户。";
}

// 清洗 GPT 回复里的 reaction 元数据（chat2api 网关把 OpenAI 的 reaction 混进了文本）
function cleanReplyContent(text) {
    if (!text) return '';
    return String(text)
        .replace(/\u26a0message_reaction\u26a0.*?\u26a0/gs, '')
        .replace(/\u26a0[^\u26a0]*\u26a0/g, '')
        .trim();
}

// 单轮：context 注入 → chat2api → 清洗回复
async function generateReply(env, message) {
    // M1.2：用 Context Resolver 组装恢复包（GPT #923/#925）
    // 渐进迁移：resolver 内部自己查 state/messages/contexts；旧 readThreadContext 保留兼容
    let autoContext = null;
    try {
        const resolved = await resolveAgentContext(env, 'gpt', message?.thread_id);
        if (resolved && !resolved.error) {
            autoContext = {
                thread: { title: resolved.knowledge_context?.version != null ? 'Thread #' + message.thread_id : message.thread_id, status: 'active' },
                recent_messages: [
                    ...(resolved.trigger_context ? [{ author: resolved.trigger_context.author || '?', content: resolved.trigger_context.content || '', created_at: resolved.trigger_context.created_at }] : []),
                    ...(resolved.delta_context?.messages || []).map(m => ({ author: m.author, content: m.content, created_at: m.created_at }))
                ],
                context: resolved.knowledge_context ? {
                    version: resolved.knowledge_context.version,
                    summary: resolved.knowledge_context.summary,
                    decisions: resolved.knowledge_context.decisions || [],
                    open_questions: resolved.knowledge_context.open_questions || [],
                    recent_context: resolved.knowledge_context.recent_context
                } : null,
                state: resolved.state
            };
        }
    } catch (e) {
        console.error('[context_resolver] err: ' + e.message);
    }
    // fallback：resolver 失败或 missing_trigger 时退回旧 readThreadContext（兼容）
    if (!autoContext) autoContext = await readThreadContext(env, message?.thread_id, 10);
    const messages = [
        { role: 'system', content: buildSystemPrompt(message, autoContext) },
        { role: 'user', content: message.content }
    ];
    const reply = await callChat2Api(env, messages, { timeoutMs: CHAT_TIMEOUT_MS });
    return cleanReplyContent(reply.content || '');
}

// M1-b B（GPT #895）：失败可见——向聊天室发 system 消息（author=system），同一事件最多提示一次（去重）
async function notifyFail(env, event, error) {
    try {
        const threadId = (event.payload && event.payload.thread_id) || '';
        if (!threadId) return;
        const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY;
        const h = { 'Authorization': 'Bearer ' + key, 'apikey': key };
        // 去重：查该 source message 是否已有 fail_notice 事件（防止重复刷屏）
        const dup = await fetch(env.SUPABASE_URL + "/rest/v1/chat_agent_events?select=event_id&payload->>type=eq.fail_notice&message_id=eq." + encodeURIComponent(event.message_id), { headers: h }).then(r => r.ok ? r.json() : []);
        if (Array.isArray(dup) && dup.length > 0) return;
        const notice = '[系统] ⚠️ GPT 处理失败：事件 ' + event.event_id + ' 原因：' + String(error.message || 'unknown').slice(0, 200);
        await sendMessage(env, threadId, notice, { metadata: { m1b_fail_event: event.event_id } }, 'system');
    } catch (e) {
        console.error('fail notice send err: ' + e.message);
    }
}

export async function processPendingEvents(env) {
    const events = await pendingEvents(env);

    for (const event of events) {
        const claimed = await claim(env, event.event_id);
        if (!claimed || !claimed.claimed) continue;

        try {
            const message = await loadMessage(env, event.message_id);
            if (!message) throw new Error('无法读取消息');

            const content = await generateReply(env, message);
            if (content) {
                await sendMessage(env, message.thread_id, content, {}, 'gpt');
            }

            await acknowledge(env, event.event_id, 'success');
        } catch (error) {
            try {
                await notifyFail(env, event, error);
                await acknowledge(env, event.event_id, 'failed');
            } catch (ackErr) {
                console.error("ack failed fallback err: " + ackErr.message, "orig: " + error.message);
            }
        }
    }
    return { processed: events.length };
}