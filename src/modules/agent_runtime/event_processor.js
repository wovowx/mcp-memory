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
//       Worker 侧不再代执行工具，注入/审计/结论全部失去意义。
// ============================================================
import { pendingEvents, claim, loadMessage, sendMessage, acknowledge } from "./chat_adapter.js";
import { callChat2Api } from "./chat2api_client.js";

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
    return "你是 Common Ground 中的 GPT Agent。\n\n请直接、简洁地回复用户 @ 的消息。\n\n当前 Thread:\n" + message.thread_id + "\n\n" + ctxBlock + "\n\n工具能力：你已原生挂载 Ziven_MCP 插件（MCP 工具可直接调用，如 github_read / ds_quota / create_patch_proposal 等）。当需要读取代码、查询数据或提交修改提案时，直接调用对应的 MCP 工具即可——工具会真实执行并返回结果。**不需要输出任何文本标记，也不需要模拟工具调用格式**。\n\n行为规范（Active Policies，见 ZivenLab governance/policy-index.md）：\n- AAD 行为透明：每次回复末尾用 [Activity] 块披露 Actions/Observation/Decision/Evidence/NotDone（没调用过的工具不许写「已读取」）\n- Ownership 闭环：承诺「盯着/负责」= 一口气跑到终态，不把检查责任转回 Ziven/柳柳；等待是状态不是结束\n\n协同写代码流程（配合 Ziven / 柳柳）：\n1. 理解任务：先输出需求理解（目标 / 涉及模块 / 未知信息）\n2. 读取代码：调 github_read 读目标文件 + 相关依赖（不猜，先看事实）\n3. 提 Patch：调 create_patch_proposal 提交修改意向（含 current_behavior / desired_behavior / reasoning / evidence / risk / test_plan——基于什么事实提出什么修改）\n4. 人工审核：Ziven review → 柳柳确认（方向变化时）→ apply\n\n如果上下文已足够就直接回复用户。";
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
    const autoContext = await readThreadContext(env, message?.thread_id, 10);
    const messages = [
        { role: 'system', content: buildSystemPrompt(message, autoContext) },
        { role: 'user', content: message.content }
    ];
    const reply = await callChat2Api(env, messages, { timeoutMs: CHAT_TIMEOUT_MS });
    return cleanReplyContent(reply.content || '');
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
                await acknowledge(env, event.event_id, 'failed');
            } catch (ackErr) {
                console.error("ack failed fallback err: " + ackErr.message, "orig: " + error.message);
            }
        }
    }
    return { processed: events.length };
}