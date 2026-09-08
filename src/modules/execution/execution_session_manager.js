// ============================================================
// execution_session_manager.js — Execution Session Manager (B4)
// 执行 GPT 独立框的「会话编排层」：任务开始前，明确获得一个
// 可控、可追踪、独占的 GPT conversation 资源。
//
// 设计收敛：GPT + Ziven 讨论确认，柳柳拍板（2026-09-08）
//
// 核心原则：
// - 不属于 chat2api（只负责 transport），也不塞进 execution_run（任务生命周期）
// - 显式不隐式：execution_session_init -> ready -> 再 execution_start
// - conversation_id 是「执行资源」不是身份；身份 = agent_id + thread_id
// - 换 id = 归档旧 + 新增新 + 写事件，不 UPDATE
//
// v1 (2026-09-08)：领 id + bind + rotate + archive
// ============================================================

function sbFetch(env, url, method, body) {
    if (method === undefined) method = 'GET';
    const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY;
    const headers = { "Authorization": "Bearer " + key, "apikey": key, "Content-Type": "application/json", "Prefer": "return=representation" };
    const opts = { method, headers };
    if (body) opts.body = JSON.stringify(body);
    return fetch(url, opts);
}

async function acquireConversation(env, initMessage) {
    const chat2apiUrl = env.CHAT2API_URL;
    const baseBody = {
        messages: [{ role: "user", content: initMessage || "初始化执行会话。" }],
        conversation_id: "",
        history_disabled: false,
        stream: false
    };
    // 429 降级：与 chat2api_client.js v6 一致 —— 上游对某 model 限流时自动降级 default model 重试一次
    // 依据：chat2api 官方源码 chatLimit.py —— 429 是 token+model 维度，错误信息
    //       "You can continue with the default model now" 明说降级即可继续
    async function doInit(model) {
        const body = { ...baseBody, model: model };
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), (env.EXEC_TIMEOUT_MS || 30000));
        try {
            const resp = await fetch(chat2apiUrl, {
                method: "POST",
                headers: { "Authorization": "Bearer " + (env.CHATGPT_ACCESS_TOKEN || env.CHAT2API_TOKEN || ""), "Content-Type": "application/json" },
                body: JSON.stringify(body),
                signal: controller.signal
            });
            const text = await resp.text();
            if (resp.status === 429 && !(env.EXEC_NO_FALLBACK)) {
                return { retryWith: (env.GPT_FALLBACK_MODEL || "auto") };
            }
            if (!resp.ok) throw new Error("chat2api init failed " + resp.status + ": " + text.slice(0, 300));
            const data = JSON.parse(text);
            const cid = data.conversation_id || null;
            if (!cid) throw new Error("chat2api did not return conversation_id (is bridge < v8?)");
            return { conversation_id: cid };
        } catch (e) {
            if (e.name === "AbortError") throw new Error("chat2api init timeout");
            throw e;
        } finally {
            clearTimeout(timer);
        }
    }
    const first = await doInit(env.GPT_MODEL || "gpt-4o-mini");
    if (first.retryWith) {
        console.log("[exec] init 429, fallback model " + first.retryWith);
        return await doInit(first.retryWith);
    }
    return first;
}
async function bindConversation(env, agentId, threadId, conversationId, reason) {
    const url = env.SUPABASE_URL + "/rest/v1/conversation_bindings";
    const row = {
        conversation_id: conversationId,
        agent_id: agentId,
        thread_id: threadId,
        purpose: "execution",
        access_mode: "exclusive",
        route_type: "temporary",
        status: "active",
        source: "execution_session_init",
        metadata: { reason: reason || "session init", created_by: "execution_session_manager" }
    };
    const resp = await sbFetch(env, url, "POST", row);
    if (!resp.ok) throw new Error("bindConversation failed " + resp.status + ": " + (await resp.text()).slice(0, 300));
    const rows = await resp.json();
    return (Array.isArray(rows) && rows[0]) || rows;
}

async function writeBindingChangedEvent(env, agentId, threadId, oldId, newId, reason) {
    // 绑定变更是「路由状态事件」，写独立审计表 conversation_binding_events，
    // 不混进 chat_agent_events（聊天消息事实源，message_id NOT NULL）
    try {
        const url = env.SUPABASE_URL + "/rest/v1/conversation_binding_events";
        const ev = {
            agent_id: agentId,
            thread_id: threadId,
            old_conversation_id: oldId,
            new_conversation_id: newId,
            reason: reason
        };
        const resp = await sbFetch(env, url, "POST", ev);
        if (!resp.ok) console.error("[exec] write binding event failed: " + resp.status + ": " + (await resp.text()).slice(0, 200));
    } catch (e) {
        console.error("[exec] write binding event error: " + e.message);
    }
}

async function archiveActiveBindings(env, agentId, threadId) {
    const url = env.SUPABASE_URL + "/rest/v1/conversation_bindings?agent_id=eq." + encodeURIComponent(agentId)
        + "&thread_id=eq." + encodeURIComponent(threadId) + "&status=eq.active";
    const resp = await sbFetch(env, url, "PATCH", { status: "archived", archived_at: new Date().toISOString() });
    if (!resp.ok) throw new Error("archiveActiveBindings failed " + resp.status);
    return resp.json();
}



// ============ execution thread 管理（B4 接入层）============

// 查/建 execution thread（thread_type=execution）
// 柳柳原始需求：执行框 = 单独聊天框，换执行 GPT 的 ID 就更新绑定新 ID 到这个框
async function ensureExecutionThread(env, threadId, opts) {
    const tid = threadId || "execution-room";
    // 1) 查是否存在
    const query = env.SUPABASE_URL + "/rest/v1/chat_threads?thread_id=eq." + encodeURIComponent(tid) + "&select=thread_id,title,status&limit=1";
    const qr = await sbFetch(env, query);
    if (qr.ok) {
        const rows = await qr.json();
        if (rows && rows.length) return rows[0];
    }
    // 2) 不存在则创建（thread_type=execution，长期事实容器）
    const row = {
        thread_id: tid,
        title: opts?.title || "执行框（execution-room）",
        creator: opts?.creator || "system",
        status: "active",
        thread_type: "execution",
        metadata: { purpose: "execution", parent_thread_id: opts?.parentThreadId || null }
    };
    const resp = await sbFetch(env, env.SUPABASE_URL + "/rest/v1/chat_threads", "POST", row);
    if (!resp.ok) throw new Error("ensureExecutionThread create failed " + resp.status + ": " + (await resp.text()).slice(0, 300));
    const rows = await resp.json();
    return (Array.isArray(rows) && rows[0]) || rows;
}

export async function initExecutionSession(env, opts) {
    const agent = opts.agentId || "gpt";
    const thread = opts.threadId || "execution-room";
    // B4 接入：确保 execution thread 存在（长期事实容器），再领 conversation（短期模型会话）
    const execThread = await ensureExecutionThread(env, thread, {
        title: opts.threadTitle || "执行框（execution-room）",
        creator: opts.creator || "system",
        parentThreadId: opts.parentThreadId || null
    });
    const acquired = await acquireConversation(env, opts.initMessage);
    const binding = await bindConversation(env, agent, thread, acquired.conversation_id, opts.reason);
    return { status: "ready", execution_session_id: binding.id, conversation_id: acquired.conversation_id, binding_id: binding.id, agent_id: agent, thread_id: thread, thread: execThread };
}

export async function rotateExecutionSession(env, opts) {
    const agent = opts.agentId || "gpt";
    const thread = opts.threadId || "execution-room";
    const url = env.SUPABASE_URL + "/rest/v1/conversation_bindings?agent_id=eq." + encodeURIComponent(agent)
        + "&thread_id=eq." + encodeURIComponent(thread) + "&status=eq.active&select=id,conversation_id&limit=1";
    const resp = await sbFetch(env, url);
    const rows = resp.ok ? await resp.json() : [];
    const oldId = rows && rows[0] ? rows[0].conversation_id : null;
    await archiveActiveBindings(env, agent, thread);
    const acquired = await acquireConversation(env, "执行会话更换，初始化新对话。");
    const binding = await bindConversation(env, agent, thread, acquired.conversation_id, opts.reason || "context_reset");
    await writeBindingChangedEvent(env, agent, thread, oldId, acquired.conversation_id, opts.reason || "context_reset");
    return { status: "ready", execution_session_id: binding.id, conversation_id: acquired.conversation_id, binding_id: binding.id, previous_conversation_id: oldId, agent_id: agent, thread_id: thread };
}

export async function getActiveExecutionBinding(env, opts) {
    const agent = opts.agentId || "gpt";
    const thread = opts.threadId || "execution-room";
    const url = env.SUPABASE_URL + "/rest/v1/conversation_bindings?agent_id=eq." + encodeURIComponent(agent)
        + "&thread_id=eq." + encodeURIComponent(thread) + "&status=eq.active&purpose=eq.execution&select=*&order=created_at.desc&limit=1";
    const resp = await sbFetch(env, url);
    if (!resp.ok) throw new Error("getActiveExecutionBinding failed " + resp.status);
    const rows = await resp.json();
    return rows && rows[0] ? rows[0] : null;
}


// ============ B4 MVP 5-6：任务派发 ============

// 创建 execution_run 记录（status=created）
async function createExecutionRun(env, opts) {
    const url = env.SUPABASE_URL + "/rest/v1/execution_runs";
    const row = {
        execution_session_id: opts.executionSessionId || null,
        agent_id: opts.agentId || "gpt",
        thread_id: opts.threadId || "execution-room",
        task_type: opts.taskType || "code",
        status: "created",
        task_desc: opts.taskDesc || ""
    };
    const resp = await sbFetch(env, url, "POST", row);
    if (!resp.ok) throw new Error("createExecutionRun failed " + resp.status + ": " + (await resp.text()).slice(0, 300));
    const rows = await resp.json();
    return (Array.isArray(rows) && rows[0]) || rows;
}

// 更新 execution_run 状态
export async function updateExecutionRun(env, runId, patch) {
    const url = env.SUPABASE_URL + "/rest/v1/execution_runs?id=eq." + encodeURIComponent(runId);
    const resp = await sbFetch(env, url, "PATCH", patch);
    if (!resp.ok) throw new Error("updateExecutionRun failed " + resp.status);
    return resp.json();
}

// 用指定 conversation_id 调 chat2api 派发任务消息（复用执行会话上下文）
async function sendTaskToConversation(env, conversationId, taskMessage, timeoutMs, modelOverride) {
    const chat2apiUrl = env.CHAT2API_URL;
    const body = {
        model: modelOverride || env.GPT_MODEL || "gpt-4o-mini",
        messages: [{ role: "user", content: taskMessage }],
        conversation_id: conversationId,
        history_disabled: false,
        stream: false
    };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs || 30000);
    try {
        const resp = await fetch(chat2apiUrl, {
            method: "POST",
            headers: { "Authorization": "Bearer " + (env.CHATGPT_ACCESS_TOKEN || env.CHAT2API_TOKEN || ""), "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: controller.signal
        });
        const text = await resp.text();
        if (resp.status === 429 && !(env.EXEC_NO_FALLBACK)) {
            return { retryWith: (env.GPT_FALLBACK_MODEL || "auto") };
        }
        if (!resp.ok) throw new Error("chat2api task failed " + resp.status + ": " + text.slice(0, 300));
        const data = JSON.parse(text);
        return { content: data?.choices?.[0]?.message?.content || "", conversation_id: data.conversation_id || conversationId };
    } catch (e) {
        if (e.name === "AbortError") throw new Error("chat2api task timeout");
        throw e;
    } finally {
        clearTimeout(timer);
    }
}

// 派发任务：提任务 -> 用 active 执行 binding -> 调 GPT -> 写回结果
// 返回 { run_id, status, reply, conversation_id }
export async function dispatchExecutionTask(env, opts) {
    const agent = opts.agentId || "gpt";
    const thread = opts.threadId || "execution-room";
    const taskDesc = opts.taskDesc || opts.task || "";
    if (!taskDesc) throw new Error("dispatchExecutionTask: missing task");

    // 1) 找当前 active 执行 binding（复用已有 execution conversation，不新建）
    const binding = await getActiveExecutionBinding(env, { agentId: agent, threadId: thread });
    if (!binding) throw new Error("dispatchExecutionTask: no active execution binding, call init first");
    const conversationId = binding.conversation_id;

    // 2) 创建 execution_run
    const run = await createExecutionRun(env, { executionSessionId: binding.id, agentId: agent, threadId: thread, taskType: opts.taskType, taskDesc: taskDesc });

    // 3) 标记 running
    await updateExecutionRun(env, run.id, { status: "running", started_at: new Date().toISOString() });

    // 4) 调 GPT 派发任务
        const taskMessage = "[EXECUTION TASK]" + String.fromCharCode(10) + taskDesc + String.fromCharCode(10) + String.fromCharCode(10) + "请完成上述执行任务。你可以调用 Ziven_MCP 工具（github_read/supabase_db 等）来读取和修改代码。完成后简要汇报结果。";
    let result = await sendTaskToConversation(env, conversationId, taskMessage);
    if (result.retryWith) {
        console.log("[exec] task 429, fallback model " + result.retryWith);
        result = await sendTaskToConversation(env, conversationId, taskMessage, null, result.retryWith);
    }

    // 5) 写回结果 + completed
    await updateExecutionRun(env, run.id, { status: "completed", finished_at: new Date().toISOString(), result: { reply: result.content, conversation_id: result.conversation_id } });

    return { run_id: run.id, status: "completed", reply: result.content, conversation_id: result.conversation_id };
}
