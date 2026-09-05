// ============================================================
// event_processor.js — Phase 1.5 @GPT 最小闭环核心 + Runtime Tool Loop
// pending → claim → read → chat2api → (tool loop?) → send → ack
// v2 (2026-09-03)：源头清洗 reaction 元数据
// v3 (2026-09-03)：Runtime Tool Loop —— GPT 可请求工具，Worker 执行并回填结果
// v4 (2026-09-03)：T2.5 审计链 —— 每次工具调用写 agent_tool_calls（运行事实源）
// v5 (2026-09-03)：T3.1 context_read/context_update 真实实现（治失忆）
// v5.1 (2026-09-03)：buildPrompt 强化 —— 明确告诉 GPT 工具已挂载，直接输出标记即执行
// v6 (2026-09-03)：T3.1 主动注入 —— Runtime 自动读 thread 上下文注入 prompt（不依赖 GPT 自觉调工具）
// v7 (2026-09-03)：T3.2 github_read 真实实现 —— GPT 可读白名单仓库真实代码
// v7.1 (2026-09-03)：github_read 编码修复 —— TextDecoder UTF-8 解码（修中文乱码）
// v6.18.0 (2026-09-05)：原生 MCP 模式优先（浏览器挂插件通道），文本桥降级 fallback（TEXT_BRIDGE_MODE=text）
// v8 (2026-09-03)：prompt 格式重构 —— system/user 分离（GPT 建议）：系统指令/工具规则/上下文注入走 system，user 只放实际 @ 内容（buildPrompt → buildSystemPrompt）
// ============================================================
import { pendingEvents, claim, loadMessage, sendMessage, acknowledge } from "./chat_adapter.js";
import { callChat2Api } from "./chat2api_client.js";
import { discoverMCPTools, mcpCallTool } from "./mcp_client.js";
import { checkCapabilityAccess } from "../permission_guard.js";

const MAX_TOOL_ROUNDS = 5;
const CONCLUSION_TIMEOUT_MS = 25000; // v6.14 (B)：结论生成独立请求，可用满 25s（不再被第一轮挤占）

// ============ Thread 上下文读取（T3.1） ============
// context_read 工具 + runToolLoop 主动注入共用
async function readThreadContext(env, threadId, limit = 10) {
    if (!threadId) return null;
    const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY;
    const h = { 'Authorization': 'Bearer ' + key, 'apikey': key };
    try {
        const tr = await fetch(`${env.SUPABASE_URL}/rest/v1/chat_threads?thread_id=eq.${threadId}&select=thread_id,title,status,created_at,creator`, { headers: h });
        const threads = tr.ok ? await tr.json() : [];
        const mr = await fetch(`${env.SUPABASE_URL}/rest/v1/chat_messages?thread_id=eq.${threadId}&select=author,content,created_at&order=created_at.desc&limit=${limit}`, { headers: h });
        const msgs = mr.ok ? await mr.json() : [];
        msgs.reverse();
        const cr = await fetch(`${env.SUPABASE_URL}/rest/v1/thread_contexts?thread_id=eq.${threadId}&select=summary,decisions,open_questions,recent_context,version,created_at&order=version.desc&limit=1`, { headers: h });
        const contexts = cr.ok ? await cr.json() : [];
        return {
            thread: threads[0] || { thread_id: threadId },
            recent_messages: msgs.map(m => ({ author: m.author, content: m.content, created_at: m.created_at })),
            context: contexts[0] || null
        };
    } catch (e) {
        console.error('[context_read] err: ' + e.message);
        return null;
    }
}

// ============ 工具注册表（T2 先放只读/安全工具） ============
// 每个工具：async (env, args, ctx) => 返回结果对象，ctx 携带当前消息上下文（如 thread_id）
const TOOLS = {
    echo: async (env, args) => ({ ok: true, result: args }),
    context_read: async (env, args, ctx) => {
        // 读取 thread 上下文（治失忆）—— T3.1 真实实现（复用 readThreadContext）
        const threadId = args?.thread_id || ctx?.thread_id;
        const limit = Math.min(parseInt(args?.limit) || 20, 50);
        if (!threadId) return { ok: false, error: '缺少 thread_id' };
        const data = await readThreadContext(env, threadId, limit);
        if (!data) return { ok: false, error: 'context_read 读取失败' };
        return { ok: true, ...data, note: '返回消息上限 ' + limit + '，需要更多用 limit 参数' };
    },
    context_update: async (env, args, ctx) => {
        // 维护 thread 摘要（T3.1）—— version 递增新插入，不覆盖历史（75号设计）
        const threadId = args?.thread_id || ctx?.thread_id;
        if (!threadId) return { ok: false, error: '缺少 thread_id' };
        const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY;
        const h = { 'Authorization': 'Bearer ' + key, 'apikey': key, 'Content-Type': 'application/json', 'Prefer': 'return=representation' };
        try {
            // 查当前最大 version
            const vr = await fetch(`${env.SUPABASE_URL}/rest/v1/thread_contexts?thread_id=eq.${threadId}&select=version&order=version.desc&limit=1`, { headers: h });
            const rows = vr.ok ? await vr.json() : [];
            const nextVersion = (rows[0]?.version || 0) + 1;
            const row = {
                thread_id: threadId,
                summary: args?.summary || null,
                decisions: args?.decisions ?? [],
                open_questions: args?.open_questions ?? [],
                recent_context: args?.next_actions ? { next_actions: args.next_actions } : (args?.recent_context || null),
                version: nextVersion
            };
            const pr = await fetch(`${env.SUPABASE_URL}/rest/v1/thread_contexts`, {
                method: 'POST', headers: h, body: JSON.stringify(row)
            });
            if (!pr.ok) return { ok: false, error: 'context_update 写入失败: ' + pr.status + ' ' + (await pr.text()).slice(0, 200) };
            return { ok: true, version: nextVersion, saved: row };
        } catch (e) {
            return { ok: false, error: 'context_update 失败: ' + e.message };
        }
    },

    supabase_query: async (env, args) => {
        // 查 Supabase（T3 接真实）
        return { ok: true, note: 'supabase_query 工具待 T3 接入真实实现，当前返回占位' };
    }
};

// ============ 审计写入（agent_tool_calls） ============
async function insertAgentToolCall(env, { event_id, message_id, agent, call, round }) {
    const name = call?.tool || call?.name || 'unknown';
    const args = call?.arguments || call?.args || {};
    const row = {
        event_id: event_id || null,
        message_id: message_id || null,
        agent: agent || 'gpt',
        tool_name: name,
        arguments: args,
        status: 'running',
        round: round ?? null
    };
    const url = `${env.SUPABASE_URL}/rest/v1/agent_tool_calls`;
    const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY;
    try {
        const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + key, 'apikey': key, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
            body: JSON.stringify(row)
        });
        if (!resp.ok) { console.error('[tool-audit] insert fail: ' + resp.status + ' ' + await resp.text()); return null; }
        const data = await resp.json();
        return Array.isArray(data) ? data[0] : data;
    } catch (e) { console.error('[tool-audit] insert err: ' + e.message); return null; }
}

async function updateAgentToolCall(env, toolCallId, patch) {
    if (!toolCallId) return;
    const url = `${env.SUPABASE_URL}/rest/v1/agent_tool_calls?id=eq.${toolCallId}`;
    const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY;
    try {
        const resp = await fetch(url, {
            method: 'PATCH',
            headers: { 'Authorization': 'Bearer ' + key, 'apikey': key, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
            body: JSON.stringify(patch)
        });
        if (!resp.ok) console.error('[tool-audit] update fail: ' + resp.status + ' ' + await resp.text());
    } catch (e) { console.error('[tool-audit] update err: ' + e.message); }
}

// ============ MCP Capability Path MVP Guard ============
const MCP_READ_ALLOWLIST = new Set(["github_read", "supabase_query", "ds_quota"]);
const MCP_DENY_PATTERN = /^(github_push|github_merge|github_delete|github_create|deploy|.*_delete|.*_update|.*_insert|.*_exec)$/i;
function mcpPermission(name) {
  if (MCP_DENY_PATTERN.test(name)) return "deny";
  if (MCP_READ_ALLOWLIST.has(name)) return "read";
  return "unknown";
}

// 从 GPT 回复里解析工具调用请求
// 约定格式：GPT 在回复里输出一行【工具调用】json【/工具调用】
// v6.13.1 (B)：chat2api 网关对 OpenAI tools 有损，偶发把原生 tool_call 截断成不完整标记（缺 【/工具调用】）
// v6.14.1 (B2)：GPT 输出格式不稳定（解释文本+工具块混合/缺闭合）——新增智能 JSON 提取器：
//   从第一个 { 开始 brace 配对（跳过字符串内 {} 与转义），忽略前置文本，真正提取工具调用 JSON
function extractJsonObject(str) {
    const s = String(str);
    const start = s.indexOf('{');
    if (start < 0) return null;
    // 解析候选：原样解析；失败则补 1-4 个右花括号（chat2api 网关截断最外层 }）
    const tryParse = (cand) => {
        const attempts = [cand];
        for (let n = 1; n <= 4; n++) attempts.push(cand + '}'.repeat(n));
        for (const a of attempts) {
            try {
                const obj = JSON.parse(a);
                if (obj && (obj.tool || obj.name)) return a;
            } catch (e) { /* 尝试下一个 */ }
        }
        return null;
    };
    // 滑动截断：逐字符增长，找「可解析且含 tool/name」的最长前缀
    let best = null, bestLen = 0;
    for (let end = start + 1; end <= s.length; end++) {
        const cand = s.slice(start, end);
        if (cand[cand.length - 1] !== '}' && end < s.length) continue; // 只试 } 结尾或全文末尾
        const good = tryParse(cand);
        if (good && good.length > bestLen) { best = good; bestLen = good.length; }
    }
    // 全文末尾兜底（即使不以 } 结尾，可能是截断点）
    const tailGood = tryParse(s.slice(start));
    if (tailGood && tailGood.length > bestLen) best = tailGood;
    return best;
}
function parseToolCalls(content) {
    const calls = [];
    const text = String(content || '');
    const normalizeCall = (obj, raw, err) => {
        if (obj && (obj.tool || obj.name)) {
            if (!obj.tool && obj.name) obj.tool = obj.name;
            calls.push(obj);
        } else {
            // v6.14.4 (GPT #713)：parse 失败明确标记 __parse_error__，不伪装 echo 成功
            calls.push({ tool: '__parse_error__', arguments: { parse_error: (raw || '').slice(0, 200), error: err || 'invalid tool call object' } });
        }
    };

    // 1) 完整闭合标记（正常格式）——内部也用 extractJsonObject 鲁棒提取
    const fullRe = /【\s*工具调用\s*】([\s\S]*?)【\s*\/工具调用\s*】/g;
    let m;
    while ((m = fullRe.exec(text)) !== null) {
        const extracted = extractJsonObject(m[1]);
        if (extracted) {
            try { normalizeCall(JSON.parse(extracted), extracted); }
            catch (e) { normalizeCall(null, extracted, e.message); }
        } else {
            normalizeCall(null, m[1], 'no json object in marked block');
        }
    }
    if (calls.length > 0) return calls;

    // 2) 容错：不完整标记（有开头、无闭合）——GPT/chat2api 偶发输出截断（#695/#697 实锤）
    const openRe = /【\s*工具调用\s*】([\s\S]*?)(?=【\s*工具调用\s*】|$)/g;
    let om;
    while ((om = openRe.exec(text)) !== null) {
        const raw = om[1].trim();
        if (!raw) continue;
        // 智能提取：忽略前置解释文本，从第一个 { brace 配对
        const extracted = extractJsonObject(raw);
        if (extracted) {
            try { normalizeCall(JSON.parse(extracted), extracted); }
            catch (e) { normalizeCall(null, extracted, e.message); }
        } else {
            normalizeCall(null, raw.slice(0, 200), 'no valid JSON in incomplete mark');
        }
    }
    if (calls.length > 0) return calls;

    // 3) 保守容错：整段文本就是一个 JSON 对象（裸 tool call）
    const trimmed = text.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        try {
            const parsed = JSON.parse(trimmed);
            if (parsed && (parsed.tool || parsed.name)) {
                if (!parsed.tool && parsed.name) parsed.tool = parsed.name;
                calls.push(parsed);
            }
        } catch (e) { /* 不是合法 JSON 就当普通正文 */ }
    }
    return calls;
}

async function executeTool(env, call, ctx) {
  const name = call?.tool || call?.name || '';
  const args = call?.arguments || call?.args || {};
  // v6.14.4 (GPT #713)：明确解析失败，不伪装 echo 成功
  if (name === '__parse_error__') {
    return { ok: false, error: '工具调用解析失败: ' + (args.error || args.parse_error || 'unknown'), tool_source: 'parse' };
  }
  const fn = TOOLS[name];
  if (fn) {
    try { const res = await fn(env, args, ctx); return { ok: true, ...res, tool_source: 'local' }; }
    catch (e) { return { ok: false, error: e.message, tool_source: 'local' }; }
  }
  const permission = mcpPermission(name);
  // v6.16.1: write 能力（github_push/github_merge）先过 Permission Guard（GPT 是受控对象）
  if (permission === 'deny' && (name === 'github_push' || name === 'github_merge')) {
    const guard = checkCapabilityAccess({
      agent: 'gpt',
      capability: name,
      target: { branch: args?.branch || 'dev', repo: args?.repo, rollback_sha: args?.rollback_sha },
      context: { thread_id: ctx?.thread_id },
      decision: { proposal_id: args?.proposal_id, proposal_status: args?.proposal_status, reviewed_by: args?.reviewed_by, approved_by: args?.approved_by },
      evidence: Array.isArray(args?.evidence) ? args.evidence : [],
      risk: args?.risk || 'low'
    });
    if (!guard.allowed) {
      return { ok: false, error: 'Permission Guard 拒绝: ' + guard.reason + ' — ' + guard.expected, tool_source: 'permission_guard', guard };
    }
    try {
      const res = await mcpCallTool(env, name, args);
      return { ok: true, result: res, tool_source: 'mcp' };
    } catch (e) {
      return { ok: false, error: 'MCP fallback 失败: ' + e.message, tool_source: 'mcp' };
    }
  }
  if (permission !== 'read') {
    return { ok: false, error: 'MCP 拒绝调用 ' + name + ': permission=' + permission + '（MVP 仅开放 read）', tool_source: 'mcp_guard' };
  }
  try {
    const res = await mcpCallTool(env, name, args);
    return { ok: true, result: res, tool_source: 'mcp' };
  } catch (e) {
    return { ok: false, error: 'MCP fallback 失败: ' + e.message, tool_source: 'mcp' };
  }
}

// 从 GPT 回复里剥离工具调用标记，得到干净正文
function stripToolMarkers(content) {
    return String(content)
        .replace(/【\s*工具调用\s*】[\s\S]*?【\s*\/工具调用\s*】/g, '')
        .trim();
}

function buildSystemPrompt(message, context, env) {
    // v8: system 角色 —— Agent 身份 + 工具规则 + runtime_context（不暴露在 user 消息���，GPT 建议）
    const ctxBlock = context
        ? `<runtime_context>\n标题: ${context.thread?.title || message.thread_id}\n状态: ${context.thread?.status || 'unknown'}\n最近消息 (${context.recent_messages?.length || 0}条):\n${(context.recent_messages || []).map(m => `[${m.author}] ${String(m.content).slice(0, 200)}`).join('\n') || '(空)'}\n\n历史摘要 v${context.context?.version || '-'}:\n${context.context?.summary || '(暂无摘要)'}\n决定: ${JSON.stringify(context.context?.decisions || [])}\n开放问题: ${JSON.stringify(context.context?.open_questions || [])}\n下一步: ${JSON.stringify((context.context?.recent_context && context.context.recent_context.next_actions) || [])}</runtime_context>`
        : '';

        // v9: 动态附上 MCP 发现的 read capability
        // ⚠️ 角色定位（GPT #691 要求 #3）：本块是 debug/context 辅助，不是能力源
        // 真正让 GPT「可调用」的是 chat2api 请求里的 tools[]（OpenAI 工具声明）
    let mcpToolsBlock = '';
    try { const tools = discoverToolsForPrompt(); if (tools.length) { mcpToolsBlock = '\nMCP 只读工具（Runtime 自动发现，仅 read 权限，辅助说明；可调用面以 tools schema 为准）：\n' + tools.map(t => '- ' + t.name + '：' + (t.description || '（无描述）')).join('\n'); } } catch (e) { mcpToolsBlock = '\n（MCP 工具发现不可用：' + e.message + '）'; }

    console.log('\n[mcp-prompt] mcpToolsBlock=' + JSON.stringify(mcpToolsBlock.slice(0, 200)));

    // v6.18.0 (BIG)：原生 MCP 模式优先 —— 浏览器挂插件通道打通后，GPT 原生调 MCP，不再需要文本标记
    // 老文本桥（文本标记教条）降级为 fallback：TEXT_BRIDGE_MODE=text 时恢复旧 prompt
    const isNative = !env?.TEXT_BRIDGE_MODE || env.TEXT_BRIDGE_MODE === 'native';
    if (isNative) {
        return `你是 Common Ground 中的 GPT Agent。

请直接、简洁地回复用户 @ 的消息。

当前 Thread:
${message.thread_id}

${ctxBlock}

工具能力：你已原生挂载 Ziven_MCP 插件（MCP 工具可直接调用，如 github_read / ds_quota / create_patch_proposal 等）。当需要读取代码、查询数据或提交修改提案时，直接调用对应的 MCP 工具即可——工具会真实执行并返回结果。**不需要输出任何文本标记，也不需要模拟工具调用格式**。

协同写代码流程（配合 Ziven / 柳柳）：
1. 理解任务：先输出需求理解（目标 / 涉及模块 / 未知信息）
2. 读取代码：调 github_read 读目标文件 + 相关依赖（不猜，先看事实）
3. 提 Patch：调 create_patch_proposal 提交修改意向（含 current_behavior / desired_behavior / reasoning / evidence / risk / test_plan——基于什么事实提出什么修改）
4. 人工审核：Ziven review → 柳柳确认（方向变化时）→ apply

如果上下文已足够就直接回复用户。`;
    }

    return `你是 Common Ground 中的 GPT Agent。

请直接、简洁地回复用户 @ 的消息。

当前 Thread:
${message.thread_id}

${ctxBlock}

工具已挂载到当前 Runtime 并可供你调用。执行模型：你（GPT Agent）在回复文本中输出一行【工具调用】JSON【/工具调用】标记，Worker Runtime 会解析该标记并真实执行对应的 MCP 工具，然后把真实结果回传给你继续。你不需要持有工具入口——你的文本标记就是调用方式（Worker 是你的执行手）。当前已挂载的可调用工具包括：echo / context_read / context_update / github_read / supabase_query，以及 MCP 只读工具（ds_quota 等，见下方列表）。如果你需要调用，直接输出标记即可；不需要先询问工具是否可用。

标记格式：
【工具调用】{"tool":"工具名","arguments":{...}}【/工具调用】

可用工具：
- echo：回显参数（测试用）
- context_read：读取 Thread 上下文（防失忆，先读再答，参数 {thread_id?, limit?}）
- context_update：更新 Thread 摘要（summary/decisions/open_questions/next_actions，帮助后续恢复上下文）
- github_read：读取 GitHub 文件（只读白名单，参数 {repo?, path, branch?, start_line?, end_line?}）
- supabase_query：查询 Supabase 数据${mcpToolsBlock}

如果上下文已足够就直接回复用户；需要更详细内容用 context_read；讨论中有重要决定/结论用 context_update 保存。`;
}

// 当前进程内 MCP read 工具快照
let mcpPromptToolsCache = [];
export function setMCPPromptTools(tools) { mcpPromptToolsCache = tools || []; }
function discoverToolsForPrompt() { return mcpPromptToolsCache; }

// 清洗 GPT 回复里的 reaction 元数据（chat2api 网关把 OpenAI 的 reaction 混进了文本）
// 形如 ⚠message_reaction⚠👋⚠ —— 在 GPT App 里是「在消息下加一个小表情」，不是正文
// 源头剥离，保证写库的就是干净正文
function cleanReplyContent(text) {
    if (!text) return '';
    // 整段剥离 ⚠message_reaction⚠...⚠（含中间的 emoji）
    return String(text)
        .replace(/\u26a0message_reaction\u26a0.*?\u26a0/gs, '')
        .replace(/\u26a0[^\u26a0]*\u26a0/g, '')
        .replace(/【\s*工具调用\s*】[\s\S]*?【\s*\/工具调用\s*】/g, '')
        .trim();
}

async function runToolLoop(env, message, event) {
    // v6.13 A：Cloudflare Worker 单请求 wall-clock 硬上限（30s）——预算管理，保证兜底在预算内跑完
    const LOOP_START = Date.now();
    const WALL_BUDGET_MS = 27000;    // 总预算 27s，留 3s 给落库 + ack
    const ROUND_FIRST_MS = 22000;    // 第一轮：GPT 首次生成，给足
    const ROUND_LATER_MS = 8000;     // 第二轮+：只需基于工具结果收尾，短超时防卡（v6.12.1 的 30s 超时实际轮不到——进程先死）
    const remainingBudget = () => WALL_BUDGET_MS - (Date.now() - LOOP_START);

    // T3.1 防失忆：Runtime 主动读取 thread 上下文注入 prompt（不依赖 GPT 自觉调工具）
    const autoContext = await readThreadContext(env, message?.thread_id, 10);
    // v9 + Level1 MVP: 运行前发现一次 MCP read 工具，并构建 OpenAI tools 声明（真实注入）
    // v6.13.1 (B)：injection_mode 标注真实注入方式 —— prompt_text（tools 参数因 chat2api 有损已停用）
    let capabilityTrace = { discovered: 0, filtered: 0, injected: 0, names: [], has_ds: false, injection_mode: 'prompt_text' };
    let traceWritten = false; // v6.13 A：trace 是否已提前落库（工具执行后立即写，不等最终答复）
    let openaiTools = [];
    try {
        const mcpTools = await discoverMCPTools(env);
        capabilityTrace.discovered = mcpTools.length;
        const visible = mcpTools.filter(t => mcpPermission(t.name) === 'read');
        capabilityTrace.filtered = visible.length;
        capabilityTrace.names = visible.map(v => v.name);
        capabilityTrace.has_ds = visible.some(v => v.name === 'ds_quota');
        // 快照给 buildSystemPrompt 文本注入（保留原行为）
        setMCPPromptTools(visible.map(t => ({ name: t.name, description: t.description })));
        // Level1: 构建 OpenAI 结构化工具声明 —— MCP capability 真正注入 GPT 可调用面
        openaiTools = visible.map(t => ({
            type: 'function',
            function: {
                name: t.name,
                description: t.description || '(MCP capability)',
                parameters: t.inputSchema || { type: 'object', properties: {} }
            }
        }));
        console.log('[mcp-discover] total=' + mcpTools.length + ' read=' + visible.length + ' names=' + visible.map(v=>v.name).join(',') + ' has_ds=' + visible.some(v=>v.name==='ds_quota') + ' tools=' + openaiTools.length);
    } catch (e) { console.error('[mcp-discover] err: ' + e.message); }
    capabilityTrace.injected = openaiTools.length;

    // v8: system+user 分离（GPT 建议）：系统指令/工具规则/runtime_context 走 system，user 只放实际 @ 内容
    const messages = [
        { role: 'system', content: buildSystemPrompt(message, autoContext, env) },
        { role: 'user', content: message.content }
    ];
    const toolCalls = [];
    let finalContent = '';

    // v6.13 A：���一的兜底内容生成器（工具已执行但最终答复失败/预算耗尽时用）
    const fallbackReply = () => {
        const summary = toolCalls.map(tc => tc.tool_name + (tc.result?.ok ? '✅' : '❌')).join(' ');
        return `[工具执行完成，但最终回复生成超时] 已执行: ${summary}。如需更多操作请再@我。`;
    };

    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
        // Level1 MVP: 每轮都带 MCP 工具声明（OpenAI tools），让 GPT 可调用面持续可见
        // v6.13 A：第二轮用短超时 + 预算不足直接兜底——事件绝不卡死在 processing
        const budgetLeft = remainingBudget();
        let reply = null;
        if (round > 0 && budgetLeft < ROUND_LATER_MS + 3000) {
            // 剩余预算连短超时轮都跑不完 → 直接兜底，保证落库 + ack 在预算内
            console.log('[tool-loop] round=' + round + ' 预算不足(' + budgetLeft + 'ms) → 直接兜底');
        } else {
            const roundTimeout = Math.min(round === 0 ? ROUND_FIRST_MS : ROUND_LATER_MS, Math.max(3000, budgetLeft - 3000));
            try {
                // v6.13.1 (B)：不再传 tools —— chat2api 网关对 OpenAI tools 有损（把原生 tool_call 截断成不完整标记，实锤 #695/#697）
                // 能力注入改回 prompt 文本（mcpToolsBlock + 工具规则文本）；openaiTools 仅保留作 trace/审计计数
                reply = await callChat2Api(env, messages, { timeoutMs: roundTimeout });
            } catch (chatErr) {
                console.error('[tool-loop] round=' + round + ' chat2api 失败: ' + chatErr.message + ' timeout=' + roundTimeout);
                if (round > 0 && toolCalls.length > 0) {
                    // 已执行过工具但拿不到最终回复 → 用工具结果摘要兜底（短超时保证能走到这里）
                    finalContent = fallbackReply();
                    console.log('[tool-loop] 使用工具结果兜底回复');
                    break;
                }
                throw chatErr; // 第一轮就失败（还没任何工具结果）→ 让上层 catch 标 failed
            }
        }
        if (!reply) {
            if (round > 0 && toolCalls.length > 0) {
                finalContent = fallbackReply();
                console.log('[tool-loop] 预算不足兜底回复');
            } else {
                finalContent = '[系统繁忙，回复生成超时，请稍后再试]';
            }
            break;
        }
        const content = reply.content || '';

        // 解析工具调用
        const calls = parseToolCalls(content);
        if (calls.length === 0) {
            // 没有工具调用 = 最终回复
            finalContent = cleanReplyContent(content);
            break;
        }

        // 有工具调用：执行每个工具，把结果追加到消息上下文
        messages.push({ role: 'assistant', content });
        for (const call of calls) {
            // 执行工具
            const result = await executeTool(env, call, { thread_id: message?.thread_id });

            // Level1 MVP trace（GPT #691 要求 #2）：invoked/result/tool_source 追赶链
            const traceName = call?.tool || call?.name || 'unknown';
            capabilityTrace.invoked_names = capabilityTrace.invoked_names || [];
            if (!capabilityTrace.invoked_names.includes(traceName)) capabilityTrace.invoked_names.push(traceName);
            capabilityTrace.last_result_ok = result.ok;
            capabilityTrace.last_tool_source = result.tool_source || null;
            capabilityTrace.last_invoked_at = new Date().toISOString();

            // T2.5 审计链：写 agent_tool_calls（运行事实源）
            const name = call?.tool || call?.name || 'unknown';
            const auditRow = await insertAgentToolCall(env, {
                event_id: event?.event_id,
                message_id: message?.message_id,
                agent: 'gpt',
                call,
                round
            });
            if (auditRow?.id) {
                await updateAgentToolCall(env, auditRow.id, {
                    status: result.ok ? 'success' : 'failed',
                    result: result.ok ? result : null,
                    error: result.ok ? null : (result.error || null),
                    finished_at: new Date().toISOString()
                });
            }

            // 前端展示快照（chat_messages.tool_calls 简化）
            toolCalls.push({
                tool_name: name,
                arguments: call?.arguments || call?.args || {},
                result,
                status: result.ok ? 'success' : 'failed',
                error: result.ok ? null : result.error,
                audit_id: auditRow?.id || null
            });
            messages.push({
                role: 'user',
                content: `【工具结果】{"tool":"${name}","result":${JSON.stringify(result)}}【/工具结果】`
            });
        }
        // v6.13 A：工具执行完立即落 capability_trace（不等最终答复）——第二轮就算卡死，Capability 证据也已入库
        try {
            const traceRow = await insertAgentToolCall(env, {
                event_id: event?.event_id,
                message_id: message?.message_id,
                agent: 'gpt',
                call: { tool: '__capability_trace__', arguments: capabilityTrace },
                round: null
            });
            if (traceRow?.id) {
                await updateAgentToolCall(env, traceRow.id, {
                    status: 'success',
                    result: { ok: true, capability_trace: capabilityTrace, injected: openaiTools.length, tool_sources: ['mcp'] },
                    error: null,
                    finished_at: new Date().toISOString()
                });
            }
            traceWritten = true;
        } catch (e) {
            console.error('[capability-trace] 提前写 trace 失败: ' + e.message);
        }

        // v6.14 (B)：工具执行完 → 排结论任务，不再实时跑第二轮
        // 理由：Cloudflare Worker 30s wall-clock 硬上限，第一轮已花 ~18s，第二轮挤在剩余预算里必然超时
        // 拆成独立任务后，结论生成单独用满 25s（下次 cron 触发），事件1秒级 ack 闭环
        if (toolCalls.length > 0) {
            try {
                await enqueueToolConclusion(env, {
                    event_id: event?.event_id,
                    message_id: message?.message_id,
                    thread_id: message?.thread_id,
                    agent: 'gpt',
                    context_messages: messages.slice(), // 第二阶段完整上下文：system + user + assistant(工具调用) + user(工具结果)
                    tool_results: toolCalls.map(tc => ({ tool_name: tc.tool_name, status: tc.status, result: tc.result }))
                });
                // 阶段1结束：不落库最终回复（结论任务会落），原事件由 processPendingEvents ack
                console.log('[tool-loop] 工具已执行，结论任务已排队（pendingConclusion）');
                return { content: '', toolCalls, pendingConclusion: true };
            } catch (enqueueErr) {
                console.error('[tool-loop] 排队结论失败: ' + enqueueErr.message);
                // 排队失败 → 用工具结果摘要兜底（保证有回复）
                finalContent = fallbackReply();
                break;
            }
        }
        // 下一轮继续让 GPT 基于工具结果回复
    }

    if (!finalContent && toolCalls.length > 0) {
        // 工具循环到顶还没拿到最终回复，用最后一次内容兜底
        finalContent = '(工具循环达到上限，未完成最终回复)';
    }

    // Level1 MVP: Capability Injection 证据链 —— trace 已在工具执行后提前落库；这里只兜未写场景（无工具调用时）
    // 验收要求（GPT #689）：不靠「GPT 说我看到了」，要有可查询的观测证据
    if (!traceWritten) {
        try {
            const traceRow = await insertAgentToolCall(env, {
                event_id: event?.event_id,
                message_id: message?.message_id,
                agent: 'gpt',
                call: { tool: '__capability_trace__', arguments: capabilityTrace },
                round: null
            });
            if (traceRow?.id) {
                await updateAgentToolCall(env, traceRow.id, {
                    status: 'success',
                    result: { ok: true, capability_trace: capabilityTrace, injected: openaiTools.length, tool_sources: ['mcp'] },
                    error: null,
                    finished_at: new Date().toISOString()
                });
            }
        } catch (e) {
            console.error('[capability-trace] 写 trace 失败: ' + e.message);
        }
    }

    return { content: finalContent, toolCalls, pendingConclusion: false };
}

// ============ v6.14 (B)：工具结论异步队列 ============
// 拆两段：事件1（工具执行）秒级 ack 闭环；结论生成独立任务（下次 cron），单独用满 25s 预算
// 表：agent_tool_conclusions（status: pending → processing → done / failed）

function sbSupabase(env) {
    const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY;
    return { 'Authorization': 'Bearer ' + key, 'apikey': key, 'Content-Type': 'application/json', 'Prefer': 'return=representation' };
}

// 排队结论任务（阶段1 工具执行成功后调用）
async function enqueueToolConclusion(env, { event_id, message_id, thread_id, agent, context_messages, tool_results }) {
    const headers = sbSupabase(env);
    const resp = await fetch(`${env.SUPABASE_URL}/rest/v1/agent_tool_conclusions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            event_id, message_id, thread_id, agent,
            context_messages: context_messages || [],
            tool_results: tool_results || [],
            status: 'pending',
            retry_count: 0
        })
    });
    if (!resp.ok) throw new Error('enqueue conclusion 写入失败: ' + resp.status + ' ' + (await resp.text()).slice(0, 200));
    return true;
}

// 扫描并处理待生成的结论（阶段2：cron/webhook 触发，独立 25s 预算）
export async function processToolConclusions(env) {
    const headers = sbSupabase(env);
    // 查 pending（按 created_at 旧→新）
    const listResp = await fetch(`${env.SUPABASE_URL}/rest/v1/agent_tool_conclusions?select=*&status=eq.pending&order=created_at.asc&limit=10`, { headers });
    if (!listResp.ok) return { ok: false, error: '查询结论队列失败: ' + listResp.status };
    const rows = await listResp.json();
    const results = [];

    for (const row of (Array.isArray(rows) ? rows : [])) {
        const conclusionId = row.id;
        const threadId = row.thread_id;
        const contextMessages = Array.isArray(row.context_messages) ? row.context_messages : [];

        // claim：pending → processing（防并发重复处理）
        const claimResp = await fetch(`${env.SUPABASE_URL}/rest/v1/agent_tool_conclusions?id=eq.${conclusionId}&status=eq.pending`, {
            method: 'PATCH',
            headers,
            body: JSON.stringify({ status: 'processing', updated_at: new Date().toISOString() })
        });
        if (!claimResp.ok) { results.push({ id: conclusionId, action: 'claim_failed', error: claimResp.status }); continue; }

        // 独立请求：结论生成可用满 25s（不再被第一轮挤占）
        let finalText = '';
        try {
            const reply = await callChat2Api(env, contextMessages, { timeoutMs: CONCLUSION_TIMEOUT_MS });
            finalText = cleanReplyContent(reply.content || '');
            // 若结论里还带工具调用标记（GPT 又调工具），剥离后保留纯正文；本轮不再展开工具循环（递归防爆）
            const calls = parseToolCalls(reply.content || '');
            if (calls.length > 0) {
                console.log('[conclusion] GPT 在结论阶段又请求工具（忽略，直接给摘要）: ' + JSON.stringify(calls.map(c => c.tool)));
            }
            if (!finalText) finalText = '(工具执行完成，结论生成返回空)';
        } catch (e) {
            console.error('[conclusion] 结论生成失败: ' + e.message);
            // 失败 → retry（最多 3 次）后 failed；用工具结果摘要兜底写回
            const nextRetry = (row.retry_count || 0) + 1;
            const toolSummary = (row.tool_results || []).map(t => `${t.tool_name}${t.status === 'success' ? '✅' : '❌'}`).join(' ');
            const status = nextRetry >= 3 ? 'failed' : 'pending';
            await fetch(`${env.SUPABASE_URL}/rest/v1/agent_tool_conclusions?id=eq.${conclusionId}`, {
                method: 'PATCH', headers,
                body: JSON.stringify({ status, retry_count: nextRetry, updated_at: new Date().toISOString(), completed_at: status === 'failed' ? new Date().toISOString() : null })
            });
            if (status === 'failed') {
                // 终极兜底：把工具结果摘要作为 GPT 回复写回（不让用户永远等不到）
                try { await sendMessage(env, threadId, toolSummary ? `[工具执行完成，结论生成失败] 已执行: ${toolSummary}` : '[结论生成失败]', { tool_calls: row.tool_results || [] }, 'gpt'); } catch (e2) { console.error('[conclusion] 兜底写回失败: ' + e2.message); }
            }
            results.push({ id: conclusionId, action: status, retry: nextRetry, error: e.message });
            continue;
        }

        // 成功：把 GPT 结论写回聊天室（复用 sendMessage → createMessage 自动推进 counter）
        try {
            await sendMessage(env, threadId, finalText, { tool_calls: row.tool_results || [] }, row.agent || 'gpt');
            await fetch(`${env.SUPABASE_URL}/rest/v1/agent_tool_conclusions?id=eq.${conclusionId}`, {
                method: 'PATCH', headers,
                body: JSON.stringify({ status: 'done', completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
            });
            results.push({ id: conclusionId, action: 'done' });
        } catch (e) {
            // 写回失败：重试（不把任务丢掉）
            const nextRetry = (row.retry_count || 0) + 1;
            const status = nextRetry >= 3 ? 'failed' : 'pending';
            await fetch(`${env.SUPABASE_URL}/rest/v1/agent_tool_conclusions?id=eq.${conclusionId}`, {
                method: 'PATCH', headers,
                body: JSON.stringify({ status, retry_count: nextRetry, updated_at: new Date().toISOString() })
            });
            results.push({ id: conclusionId, action: 'write_retry_' + status, error: e.message });
        }
    }
    return { ok: true, scanned: rows.length, results };
}

export async function processPendingEvents(env) {
    const events = await pendingEvents(env);

    for (const event of events) {
        const claimed = await claim(env, event.event_id);
        if (!claimed || !claimed.claimed) continue;

        try {
            const message = await loadMessage(env, event.message_id);
            if (!message) throw new Error('无法读取消息');

            // Runtime Tool Loop：GPT 可请求工具，Worker 执行并回填（带审计）
            const { content, toolCalls, pendingConclusion } = await runToolLoop(env, message, event);

            // v6.14 (B)：pendingConclusion = 工具已执行、结论任务已排队（异步写回），本事件直接 ack
            // 只有「非 pendingConclusion」（第一轮就是最终回复 / 兜底）才由本事件写回聊天室
            if (!pendingConclusion) {
                const sent = await sendMessage(env, message.thread_id, content, toolCalls.length ? { tool_calls: toolCalls } : {});
            }

            await acknowledge(env, event.event_id, 'success');
        } catch (error) {
            try {
                await acknowledge(env, event.event_id, 'failed');
            } catch (ackErr) {
                console.error('ack failed fallback err: ' + ackErr.message, 'orig: ' + error.message);
            }
        }
    }
    return { processed: events.length };
}
