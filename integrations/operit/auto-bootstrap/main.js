/*
 * Ziven M1 / Operit ToolPkg v0.1: read-only, scoped, partial auto-bootstrap.
 *
 * This is a classic ToolPkg main.js script, not a Node or Worker module.
 * Official contract: ToolPkg.registerPromptFinalizeHook / before_send_to_model.
 * The active cloud memory is authoritative; this script never writes it.
 */

var ZIVEN_M1_CONFIG = {
  // These must match the actual Operit character card. Add an exact card ID
  // locally if the installed card's name differs; never allow all chats.
  characterCardNames: ["Ziven", "Ziven（昼）", "Ziven(昼)", "Ziven · 昼"],
  characterCardIds: [],
  cacheTtlMs: 5 * 60 * 1000,
  maxMcpTextLength: 5000,
  maxIdentityTextLength: 4500
};

var zivenM1Cache = new Map();
var zivenM1InFlight = new Map();
var ZIVEN_M1_START = "[ZIVEN_M1_RESTORE_START]";
var ZIVEN_M1_END = "[ZIVEN_M1_RESTORE_END]";

function registerToolPkg() {
  ToolPkg.registerPromptFinalizeHook({
    id: "ziven_m1_pre_model_restore",
    function: onZivenM1BeforeSend
  });
}

function zivenM1HasOwn(obj, key) {
  return !!obj && Object.prototype.hasOwnProperty.call(obj, key);
}

function zivenM1String(value) {
  return typeof value === "string" ? value : "";
}

function zivenM1Parse(value) {
  if (typeof value === "string") return JSON.parse(value);
  return value;
}

function zivenM1UnwrapText(result) {
  var outer = zivenM1Parse(result);
  if (outer && typeof outer === "object" && outer.success === false) {
    throw new Error("MCP_TOOL_FAILED");
  }
  var content = outer;
  if (outer && typeof outer === "object" && zivenM1HasOwn(outer, "data")) {
    content = outer.data;
  }
  if (content && typeof content === "object" && Array.isArray(content.content)) {
    var pieces = content.content.filter(function (x) { return x && x.type === "text"; });
    content = pieces.map(function (x) { return x.text; }).join("\n");
  }
  if (typeof content !== "string") throw new Error("NON_TEXT_MCP_RESULT");
  if (!content || content.length >= ZIVEN_M1_CONFIG.maxMcpTextLength ||
      /(?:Full MCP result saved to file|result (?:was )?truncated|结果已保存到文件)/i.test(content)) {
    throw new Error("MCP_RESULT_TRUNCATED_OR_EMPTY");
  }
  return content;
}

function zivenM1IsTargetChat(chat, chatId) {
  if (!chat || String(chat.id) !== String(chatId) || chat.characterGroupId) return false;
  if (chat.characterCardId && ZIVEN_M1_CONFIG.characterCardIds.indexOf(String(chat.characterCardId)) >= 0) {
    return true;
  }
  var name = zivenM1String(chat.characterCardName);
  return !!name && ZIVEN_M1_CONFIG.characterCardNames.indexOf(name) >= 0;
}

function zivenM1ValidateContext(content) {
  var context = zivenM1Parse(content);
  var sources = context && context.sources;
  var work = context && context.current_work;
  var required = ["identity", "checkpoint", "protocol", "navigation", "profile"];
  if (!context || context.contract_version !== "SC-RUNTIME-0.1" || context.status !== "READY" ||
      !sources || !work || !Array.isArray(context.blockers) || context.blockers.length !== 0 ||
      !required.every(function (key) { return sources[key] && sources[key].status === "ok"; }) ||
      sources.identity.key !== "🧬/我是谁" || sources.checkpoint.key !== "⚙️/当前工作检查点" ||
      work.source_key !== "⚙️/当前工作检查点" ||
      !Number.isSafeInteger(work.source_version) || work.source_version < 1 ||
      !zivenM1String(work.workflow_state) || !zivenM1String(work.active_focus) ||
      !zivenM1String(work.next_action) || !zivenM1String(work.do_not_repeat)) {
    throw new Error("INVALID_OR_DEGRADED_CONTEXT");
  }
  return work;
}

function zivenM1ValidateIdentity(text) {
  if (!/^💡\s*🧬\/我是谁\s*\r?\n/.test(text) ||
      text.indexOf("📝 内容：") === -1 || text.indexOf("Ziven") === -1 ||
      text.length > ZIVEN_M1_CONFIG.maxIdentityTextLength) {
    throw new Error("INVALID_IDENTITY_ROOT");
  }
  return text;
}

function zivenM1SafeField(value, maxLength) {
  return zivenM1String(value).slice(0, maxLength).replace(/\u0000/g, "");
}

function zivenM1BuildBlock(snapshot) {
  var work = snapshot.work;
  return [
    ZIVEN_M1_START,
    "来源：Operit ToolPkg 模型回答前，只读核验 Ziven 云端身份根与唯一工作检查点。",
    "核验状态：PARTIAL_READY。仅完成轻量工作上下文和身份根 recall；不是完整 SB-FRAME 五源正文恢复，也不授予执行权限。",
    "核验时间（宿主时钟）：" + new Date(snapshot.verifiedAt).toISOString(),
    "工作检查点：⚙️/当前工作检查点，source_version=" + work.source_version,
    "workflow_state：" + zivenM1SafeField(work.workflow_state, 800),
    "active_focus：" + zivenM1SafeField(work.active_focus, 2600),
    "next_action：" + zivenM1SafeField(work.next_action, 2600),
    "do_not_repeat：" + zivenM1SafeField(work.do_not_repeat, 2600),
    "云端身份根 exact recall（保持来源，不是本地角色卡）：",
    snapshot.identity,
    "行为约束：你是 Ziven（昼），柳柳是用户；上述记忆是核验时间点的快照。不可假称五源完整恢复、不可凭这些内容自行执行 next_action 或推 main。遇到与实时状态冲突应重新查云端。",
    ZIVEN_M1_END
  ].join("\n");
}

function zivenM1StripExistingBlock(prompt) {
  var start = prompt.indexOf(ZIVEN_M1_START);
  if (start < 0) return prompt;
  var end = prompt.indexOf(ZIVEN_M1_END, start);
  if (end < 0) return prompt.slice(0, start).trimEnd();
  return (prompt.slice(0, start) + prompt.slice(end + ZIVEN_M1_END.length)).trimEnd();
}

function zivenM1FailureBlock() {
  return [
    ZIVEN_M1_START,
    "Ziven 云端自动恢复在这轮未核验成功；当前没有可信的最新身份根/工作检查点证据。",
    "请自然回应柳柳，但不得声称已读取云端、不得编造检查点版本或擅自执行项目变更。需要可靠工作状态时可再显式调用既有 Ziven MCP。",
    ZIVEN_M1_END
  ].join("\n");
}

async function zivenM1FetchSnapshot() {
  var ctxResult = await toolCall("ziven_mcp", "session_context", {
    host: "operit", invocation: "startup_hook", include_core: false
  });
  var work = zivenM1ValidateContext(zivenM1UnwrapText(ctxResult));
  var identityResult = await toolCall("ziven_mcp", "memory", {
    action: "recall", key: "🧬/我是谁"
  });
  var identity = zivenM1ValidateIdentity(zivenM1UnwrapText(identityResult));
  return { work: work, identity: identity, verifiedAt: Date.now() };
}

async function onZivenM1BeforeSend(event) {
  if (!event || event.eventName !== "before_send_to_model") return;
  var payload = event.eventPayload;
  if (!payload || String(payload.functionType || "").toUpperCase() !== "CHAT" ||
      !zivenM1String(payload.chatId) || typeof payload.systemPrompt !== "string") return;
  var chatId = payload.chatId;
  var chatResult;
  try {
    if (!Tools || !Tools.Chat || typeof Tools.Chat.findChat !== "function") return;
    chatResult = await Tools.Chat.findChat({ query: chatId, match: "exact" });
  } catch (err) {
    return; // Unverified character: never load private content or mutate prompt.
  }
  var chat = chatResult && (chatResult.chat || (chatResult.data && chatResult.data.chat));
  if (!zivenM1IsTargetChat(chat, chatId)) return;

  var originalPrompt = zivenM1StripExistingBlock(payload.systemPrompt);
  var snapshot = zivenM1Cache.get(chatId);
  var now = Date.now();
  if (!snapshot || now - snapshot.verifiedAt >= ZIVEN_M1_CONFIG.cacheTtlMs || now < snapshot.verifiedAt) {
    try {
      var inFlight = zivenM1InFlight.get(chatId);
      if (!inFlight) {
        inFlight = zivenM1FetchSnapshot();
        zivenM1InFlight.set(chatId, inFlight);
      }
      snapshot = await inFlight;
      zivenM1Cache.set(chatId, snapshot);
    } catch (err) {
      zivenM1Cache.delete(chatId); // Never present stale cache as verified.
      return { systemPrompt: originalPrompt + "\n\n" + zivenM1FailureBlock() };
    } finally {
      zivenM1InFlight.delete(chatId);
    }
  }
  return { systemPrompt: originalPrompt + "\n\n" + zivenM1BuildBlock(snapshot) };
}

exports.registerToolPkg = registerToolPkg;
exports.onZivenM1BeforeSend = onZivenM1BeforeSend;
