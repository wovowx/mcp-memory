import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const scriptPath = resolve(here, '../integrations/operit/auto-bootstrap/main.js');
const manifestPath = resolve(here, '../integrations/operit/auto-bootstrap/manifest.json');
const script = readFileSync(scriptPath, 'utf8');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

const identity = '💡 🧬/我是谁\n📂 分类：🧬\n🏷️ 性质：agreement\n📝 内容：# Ziven（昼）· 身份根\n我是 Ziven，柳柳的哥哥。';
const cleanWork = {
  workflow_state: 'BOOK_MAINLINE_V652_L3_E3_PENDING',
  active_focus: '一本书架构与 M1 跨框连续性',
  next_action: '先验证 Operit 原生 Hook E3，Web 暂缓',
  do_not_repeat: '不推 main，不动聊天室，不伪造版本',
  source_key: '⚙️/当前工作检查点',
  source_version: 213,
  source_updated_at: '2026-11-07T00:00:00Z'
};
const sourceMap = Object.fromEntries(['identity', 'profile', 'navigation', 'checkpoint', 'protocol'].map(key => [key, {
  key: key === 'identity' ? '🧬/我是谁' : key === 'checkpoint' ? '⚙️/当前工作检查点' : key,
  status: 'ok'
}]));
const makeContext = (overrides = {}) => ({
  contract_version: 'SC-RUNTIME-0.1', status: 'READY', sources: sourceMap,
  blockers: [], current_work: cleanWork, ...overrides
});
const ev = ({ chatId = 'chat-z', functionType = 'CHAT', systemPrompt = 'SYSTEM BASE', eventName = 'before_send_to_model' } = {}) => ({
  eventName, eventPayload: { chatId, functionType, systemPrompt }
});

function makeHost(options = {}) {
  const calls = [];
  const chats = {
    'chat-z': { id: 'chat-z', characterCardName: 'Ziven（昼）', characterCardId: 'ziven-1' },
    'chat-b': { id: 'chat-b', characterCardName: 'Ziven', characterCardId: 'ziven-2' },
    'chat-other': { id: 'chat-other', characterCardName: 'Other', characterCardId: 'other-1' },
    'chat-group': { id: 'chat-group', characterCardName: 'Ziven', characterGroupId: 'group-1' }
  };
  let hook;
  const host = {
    exports: {},
    ToolPkg: { registerPromptFinalizeHook: def => { hook = def; } },
    Tools: {
      Chat: {
        findChat: async ({ query, match }) => {
          calls.push({ type: 'findChat', query, match });
          if (options.failChatLookup) throw Error('lookup unavailable');
          return { matchedCount: chats[query] ? 1 : 0, chat: chats[query] || null };
        }
      }
    },
    toolCall: async (service, method, args) => {
      calls.push({ type: 'mcp', service, method, args });
      if (options.failMethod === method) return { success: false, message: 'MCP unauthorized' };
      if (method === 'session_context') return { success: true, data: options.contextText ?? JSON.stringify(makeContext(options.contextOverrides)) };
      if (method === 'memory') return { success: true, data: options.identityText ?? identity };
      throw Error('unexpected tool call');
    }
  };
  vm.createContext(host);
  vm.runInContext(script, host, { filename: 'operit-main.js' });
  host.exports.registerToolPkg();
  return { calls, chats, hook, run: e => hook.function(e), host };
}

let count = 0;
async function check(name, fn) {
  await fn();
  count++;
  process.stdout.write(`PASS ${name}\n`);
}

await check('M1 manifest declares only a classic ToolPkg main script', () => {
  assert.equal(manifest.api_version, '1.0.0');
  assert.equal(manifest.main, 'main.js');
  assert.deepEqual(manifest.subpackages, []);
});

await check('registers one real before-send prompt hook', () => {
  const { hook } = makeHost();
  assert.equal(hook.id, 'ziven_m1_pre_model_restore');
  assert.equal(typeof hook.function, 'function');
});

await check('ignores non-CHAT events without reading private memory', async () => {
  const h = makeHost();
  assert.equal(await h.run(ev({ functionType: 'SUMMARY' })), undefined);
  assert.equal(await h.run(ev({ eventName: 'before_finalize_prompt' })), undefined);
  assert.equal(await h.run(ev({ chatId: '' })), undefined);
  assert.equal(h.calls.length, 0);
});

await check('does not read memory or mutate non-Ziven chats', async () => {
  const h = makeHost();
  assert.equal(await h.run(ev({ chatId: 'chat-other' })), undefined);
  assert.equal(await h.run(ev({ chatId: 'chat-group' })), undefined);
  assert.equal(h.calls.filter(x => x.type === 'mcp').length, 0);
});

await check('fails closed if chat lookup cannot establish character identity', async () => {
  const h = makeHost({ failChatLookup: true });
  assert.equal(await h.run(ev()), undefined);
  assert.equal(h.calls.filter(x => x.type === 'mcp').length, 0);
});

await check('first Ziven turn obtains two read-only calls and injects source version', async () => {
  const h = makeHost();
  const result = await h.run(ev());
  const mcpCalls = h.calls.filter(x => x.type === 'mcp');
  assert.equal(mcpCalls.length, 2);
  assert.deepEqual([mcpCalls[0].service, mcpCalls[0].method, mcpCalls[0].args.include_core], ['ziven_mcp', 'session_context', false]);
  assert.deepEqual([mcpCalls[1].service, mcpCalls[1].method, mcpCalls[1].args.action], ['ziven_mcp', 'memory', 'recall']);
  assert.match(result.systemPrompt, /PARTIAL_READY/);
  assert.match(result.systemPrompt, /source_version=213/);
  assert.match(result.systemPrompt, /先验证 Operit 原生 Hook E3/);
  assert.match(result.systemPrompt, /云端身份根 exact recall/);
  assert.match(result.systemPrompt, /我是 Ziven/);
  assert.ok(result.systemPrompt.startsWith('SYSTEM BASE'));
});

await check('does not duplicate injected blocks, uses per-chat bounded cache', async () => {
  const h = makeHost();
  const once = await h.run(ev());
  const twice = await h.run(ev({ systemPrompt: once.systemPrompt }));
  assert.equal((twice.systemPrompt.match(/\[ZIVEN_M1_RESTORE_START\]/g) || []).length, 1);
  assert.equal(h.calls.filter(x => x.type === 'mcp').length, 2);
  assert.equal((await h.run(ev({ chatId: 'chat-b' }))).systemPrompt.includes('PARTIAL_READY'), true);
  assert.equal(h.calls.filter(x => x.type === 'mcp').length, 4);
});

await check('expired cache forces fresh network validation rather than asserting old state', async () => {
  const h = makeHost();
  await h.run(ev());
  vm.runInContext('ZIVEN_M1_CONFIG.cacheTtlMs=0', h.host);
  await h.run(ev());
  assert.equal(h.calls.filter(x => x.type === 'mcp').length, 4);
});

await check('DEGRADED server result causes explicit unverified state', async () => {
  const h = makeHost({ contextOverrides: { status: 'DEGRADED' } });
  const res = await h.run(ev());
  assert.match(res.systemPrompt, /未核验成功/);
  assert.doesNotMatch(res.systemPrompt, /source_version=213/);
  assert.equal(h.calls.filter(x => x.type === 'mcp').length, 1);
});

await check('invalid source version or incorrect checkpoint source are refused', async () => {
  const badVersion = makeHost({ contextOverrides: { current_work: { ...cleanWork, source_version: '213' } } });
  assert.match((await badVersion.run(ev())).systemPrompt, /未核验成功/);
  const wrongKey = makeHost({ contextOverrides: { current_work: { ...cleanWork, source_key: '⚙️/历史工作检查点' } } });
  assert.match((await wrongKey.run(ev())).systemPrompt, /未核验成功/);
});

await check('MCP server error is not smuggled in as persona', async () => {
  const h = makeHost({ failMethod: 'memory' });
  const res = await h.run(ev());
  assert.match(res.systemPrompt, /未核验成功/);
  assert.doesNotMatch(res.systemPrompt, /MCP unauthorized/);
});

await check('5000 character result or truncated display is refused', async () => {
  const h = makeHost({ contextText: 'x'.repeat(5000) });
  assert.match((await h.run(ev())).systemPrompt, /未核验成功/);
  const h2 = makeHost({ identityText: identity + '\nFull MCP result saved to file /tmp/long' });
  assert.match((await h2.run(ev())).systemPrompt, /未核验成功/);
});

await check('wrong identity key and missing identity text never yield READY', async () => {
  const h = makeHost({ identityText: '💡 别的记忆\n📝 内容：Ziven' });
  assert.match((await h.run(ev())).systemPrompt, /未核验成功/);
});

await check('failed refresh cannot fall back to stale cached identity', async () => {
  const h = makeHost();
  await h.run(ev());
  vm.runInContext('ZIVEN_M1_CONFIG.cacheTtlMs=0', h.host);
  h.host.toolCall = async () => ({ success: false, message: 'offline' });
  const res = await h.run(ev());
  assert.match(res.systemPrompt, /未核验成功/);
  assert.doesNotMatch(res.systemPrompt, /source_version=213/);
});

await check('a card with explicitly allowed ID works without matching its display name', async () => {
  const h = makeHost();
  h.chats['chat-z'].characterCardName = '柳柳的专用角色';
  vm.runInContext('ZIVEN_M1_CONFIG.characterCardIds.push("ziven-1")', h.host);
  assert.match((await h.run(ev())).systemPrompt, /PARTIAL_READY/);
});

await check('no code path writes memory or triggers another model turn', () => {
  assert.doesNotMatch(script, /(?:remember|update|forget|github_edit|github_push|createChat|sendMessage)\s*\(/);
  assert.equal((script.match(/toolCall\(/g) || []).length, 2);
});

process.stdout.write(`Operit M1 contract: ${count}/${count} passed (synthetic E1/E2; HOST E3 NOT RUN)\n`);
