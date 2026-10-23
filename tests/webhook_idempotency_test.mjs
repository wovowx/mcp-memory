// webhook 三行为验证测试 · 2026-10-20 · 待办③（幂等+重试）
// 验证 chat_webhook.js 的 A 正常到达 / B 重复投递幂等 / C 失败重试不破坏状态
// 运行：node tests/webhook_idempotency_test.mjs
import { handleChatWebhook } from '../src/tools/chat_webhook.js';
import { handleMemoryTool, putMemory } from '../src/tools/memory_unified.js';
import { handleAITool } from '../src/tools/ai.js';
import { handleMCPRequest } from '../src/modules/mcp_router.js';

const env = {
  SUPABASE_URL: 'https://mock.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'mock-service-key',
  SUPABASE_ANON_KEY: 'mock-anon-key',
};

// 可控的 mock fetch：queryEvent 返回由当前用例指定的 rows；audit 写入记入数组
let mockQueryRows = [];
let queryFail = false; // 模拟 C：查询失败（网络/500）
const auditRows = [];
globalThis.fetch = async (url, opts = {}) => {
  const s = String(url);
  if (s.includes('/chat_agent_events?select')) {
    if (queryFail) return { ok: false, status: 503, text: async () => 'mock upstream down' };
    return { ok: true, json: async () => mockQueryRows };
  }
  if (s.includes('/chat_webhook_audit')) {
    auditRows.push(JSON.parse(opts.body));
    return { ok: true };
  }
  throw new Error('unexpected fetch: ' + s);
};

const BASE = 'https://mock.supabase.co/webhook';
function post(payload) {
  return handleChatWebhook(new Request(BASE, { method: 'POST', body: JSON.stringify(payload) }), env);
}

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra}`); }
}

// ---------- 用例 ----------
console.log('\n[用例 A] 合法 INSERT + 事件未 claim 未终结 → 首次有效投递 delivered');
{
  mockQueryRows = [{ event_id: 'evt-A', status: 'processing', claimed_at: null, agent: 'gpt' }];
  const payload = { type: 'INSERT', table: 'chat_agent_events', record: { event_id: 'evt-A', agent: 'gpt' } };
  const res = await post(payload);
  const body = await res.json();
  check('返回 200', res.status === 200, 'got ' + res.status);
  check('status=delivered（首次有效投递）', body.status === 'delivered', JSON.stringify(body));
  check('写入 audit delivered', auditRows.some(r => r.decision === 'delivered'));
}

console.log('\n[用例 B1] 重复投递：事件已被 claim → duplicate，不重复处理');
{
  mockQueryRows = [{ event_id: 'evt-B1', status: 'processing', claimed_at: '2026-10-20T00:00:00Z', agent: 'gpt' }];
  const payload = { type: 'INSERT', table: 'chat_agent_events', record: { event_id: 'evt-B1', agent: 'gpt' } };
  const res = await post(payload);
  const body = await res.json();
  check('返回 200', res.status === 200, 'got ' + res.status);
  check('status=duplicate（已 claim 不重复处理）', body.status === 'duplicate', JSON.stringify(body));
  check('写入 audit duplicate', auditRows.some(r => r.decision === 'duplicate'));
}

console.log('\n[用例 B2] 重复投递：事件已终结(success) → duplicate，不重复处理');
{
  mockQueryRows = [{ event_id: 'evt-B2', status: 'success', claimed_at: null, agent: 'gpt' }];
  const payload = { type: 'INSERT', table: 'chat_agent_events', record: { event_id: 'evt-B2', agent: 'gpt' } };
  const res = await post(payload);
  const body = await res.json();
  check('status=duplicate', body.status === 'duplicate', JSON.stringify(body));
}

console.log('\n[用例 校验] 非 INSERT / 非目标表 → ignored，不入主流程');
{
  const p1 = { type: 'UPDATE', table: 'chat_agent_events', record: { event_id: 'x' } };
  const r1 = await post(p1); const b1 = await r1.json();
  check('UPDATE→ignored', r1.status === 202 && b1.status === 'ignored', JSON.stringify(b1));
  const p2 = { type: 'INSERT', table: 'other', record: { event_id: 'x' } };
  const r2 = await post(p2);
  check('非目标表→ignored', r2.status === 202, 'got ' + r2.status);
}

console.log('\n[用例 C] 查询失败（upstream 500/网络）→ 返回 500，事件状态不改（可重试），写 audit error');
{
  queryFail = true;
  const payload = { type: 'INSERT', table: 'chat_agent_events', record: { event_id: 'evt-C', agent: 'gpt' } };
  const res = await post(payload);
  const text = await res.text();
  check('返回 500（可重试）', res.status === 500, 'got ' + res.status);
  check('audit 记 error（decision=error 且可重试提示）', auditRows.some(r => r.decision === 'error' && /可重试/.test(r.reason)));
  check('日志里不含 delivered/duplicate（未破坏状态判定）', !auditRows.some(r => r.event_id === 'evt-C' && (r.decision === 'delivered' || r.decision === 'duplicate')));
  queryFail = false;
}

// ---------- 记忆写入失败契约回归 ----------
console.log('\n[记忆写入] HTTP 失败必须返回失败结果，不能误报成功');
{
  const writeEnv = { SUPABASE_URL: 'https://mock.supabase.co', SUPABASE_ANON_KEY: 'mock-anon-key' };
  let existing = null;
  let insertStatus = 500, eventStatus = 201, patchStatus = 204;
  const writeCalls = [];
  globalThis.fetch = async (url, opts = {}) => {
    const s = String(url); writeCalls.push({ url: s, method: opts.method || 'GET' });
    if (s.includes('/rest/v1/memories?key=eq.')) return { ok: true, status: 200, json: async () => existing ? [existing] : [] };
    if (s.includes('/rest/v1/memory_events')) return { ok: eventStatus >= 200 && eventStatus < 300, status: eventStatus };
    if (s.includes('/rest/v1/memories?id=eq.')) return { ok: patchStatus >= 200 && patchStatus < 300, status: patchStatus };
    if (s.endsWith('/rest/v1/memories')) return { ok: insertStatus >= 200 && insertStatus < 300, status: insertStatus };
    throw new Error('unexpected memory fetch: ' + s);
  };

  existing = null; insertStatus = 500;
  let result = await putMemory(writeEnv, 'test/write-fail', { value: 'sample' });
  check('INSERT HTTP 500 → ok=false', result.ok === false && result.stage === 'insert');

  existing = { id: 'memory-1', key: 'test/update-event-fail', value: 'old', version: 1 };
  eventStatus = 503; patchStatus = 204; writeCalls.length = 0;
  result = await putMemory(writeEnv, existing.key, { value: 'new' });
  check('历史事件 HTTP 503 → ok=false', result.ok === false && result.stage === 'history');
  check('历史事件失败后不 PATCH 当前记忆', !writeCalls.some(c => c.method === 'PATCH'));

  eventStatus = 201; patchStatus = 503; writeCalls.length = 0;
  result = await putMemory(writeEnv, existing.key, { value: 'new' });
  check('UPDATE HTTP 503 → ok=false', result.ok === false && result.stage === 'update');

  // 目标创建失败时，rename 不得先软删除源记录。
  const source = { id: 'source-1', key: 'test/source', value: 'keep me', version: 1, created_at: '2026-10-23T00:00:00Z' };
  const renameCalls = [];
  globalThis.fetch = async (url, opts = {}) => {
    const s = String(url); renameCalls.push({ url: s, method: opts.method || 'GET' });
    if (s.includes('/rest/v1/memories?key=eq.')) {
      const isSource = s.includes('key=eq.test%2Fsource');
      return { ok: true, status: 200, json: async () => isSource ? [source] : [] };
    }
    if (s.endsWith('/rest/v1/memories')) return { ok: false, status: 500 };
    throw new Error('unexpected rename fetch: ' + s);
  };
  const renameText = await handleMemoryTool('memory_rename', { old_key: 'test/source', new_key: 'test/target' }, writeEnv);
  check('rename 目标写入失败时明确报告源记录保留', renameText.includes('源记录保留'));
  check('rename 目标写入失败时未 PATCH 源记录', !renameCalls.some(c => c.method === 'PATCH' && c.url.includes('test%2Fsource')));

  // 源软删除请求成功但回查失败时，不能把整个 rename 变成无上下文异常。
  const verifyCalls = [];
  let sourceReadCount = 0;
  globalThis.fetch = async (url, opts = {}) => {
    const s = String(url), method = opts.method || 'GET';
    verifyCalls.push({ url: s, method });
    if (method === 'PATCH' && s.includes('/rest/v1/memories?key=eq.')) return { ok: true, status: 204 };
    if (method === 'GET' && s.includes('/rest/v1/memories?key=eq.test%2Fsource')) {
      sourceReadCount++;
      return sourceReadCount === 1
        ? { ok: true, status: 200, json: async () => [source] }
        : { ok: false, status: 503 };
    }
    if (method === 'GET' && s.includes('/rest/v1/memories?key=eq.test%2Ftarget')) return { ok: true, status: 200, json: async () => [] };
    if (method === 'POST' && s.endsWith('/rest/v1/memories')) return { ok: true, status: 201 };
    throw new Error('unexpected verification fetch: ' + s + ' ' + method);
  };
  const verifyText = await handleMemoryTool('memory_rename', { old_key: 'test/source', new_key: 'test/target' }, writeEnv);
  check('源软删除回查失败时明确报告目标已写、源删除未确认', verifyText.includes('目标已写入') && verifyText.includes('源记录未能确认删除'));
  check('回查失败场景确实执行过源软删除与后续验证', verifyCalls.some(c => c.method === 'PATCH' && c.url.includes('test%2Fsource')) && verifyCalls.some(c => c.method === 'GET' && c.url.includes('test%2Fsource')));
}

console.log('\\n[query_files] 查询成功、空结果、参数错误与 HTTP 失败契约');
{
  const queryEnv = { SUPABASE_URL: 'https://mock.supabase.co', SUPABASE_ANON_KEY: 'mock-anon-key' };
  let fileRows = [{ id: 'file-1', file_name: 'note.txt', description: 'test file', content_type: 'text' }];
  let fileQueryStatus = 200;
  let usagePatches = 0;
  const skillRow = {
    name: 'query_files', description: '查询文件', enabled: true, usage_count: 2,
    input_schema: { type: 'object', properties: { keyword: { type: 'string' } } },
    handler_config: { handler: 'ai' }, handler_type: 'js'
  };
  globalThis.fetch = async (url, opts = {}) => {
    const s = String(url), method = opts.method || 'GET';
    if (s.includes('/rest/v1/skills?enabled=eq.true&select=*')) return { ok: true, status: 200, json: async () => [skillRow] };
    if (s.includes('/rest/v1/skills?name=eq.query_files&select=*')) return { ok: true, status: 200, json: async () => [skillRow] };
    if (s.includes('/rest/v1/skills?name=eq.query_files') && method === 'PATCH') { usagePatches++; return { ok: true, status: 204, json: async () => [] }; }
    if (s.includes('/rest/v1/files?select=*')) {
      if (fileQueryStatus !== 200) return { ok: false, status: fileQueryStatus, text: async () => 'mock files upstream failure' };
      return { ok: true, status: 200, json: async () => fileRows };
    }
    throw new Error('unexpected query_files test fetch: ' + s + ' ' + method);
  };

  const found = await handleAITool('query_files', { keyword: 'note' }, queryEnv);
  check('查询成功返回文件内容与数量', found.includes('找到 1 个文件') && found.includes('note.txt'), found);

  fileRows = [];
  const empty = await handleAITool('query_files', {}, queryEnv);
  check('空结果有明确空态，不返回空字符串', empty.includes('没有找到符合条件的文件') && empty.length > 0, empty);

  const invalid = await handleAITool('query_files', { limit: 0 }, queryEnv);
  check('参数错误明确返回失败标记', invalid.startsWith('❌') && invalid.includes('limit'), invalid);

  fileQueryStatus = 503;
  const failed = await handleAITool('query_files', { keyword: 'note' }, queryEnv);
  check('底层 HTTP 503 明确返回查询失败', failed.startsWith('❌') && failed.includes('503'), failed);

  fileQueryStatus = 200; fileRows = [{ id: 'file-1', file_name: 'note.txt' }];
  const successCall = await handleMCPRequest({ method: 'tools/call', id: 801, params: { name: 'query_files', arguments: { keyword: 'note' } } }, queryEnv);
  check('MCP 成功调用正常返回并增加一次 usage_count', successCall.data.result.content[0].text.includes('找到 1 个文件') && usagePatches === 1, JSON.stringify({ text: successCall.data.result.content[0].text, usagePatches }));

  fileQueryStatus = 503;
  const failedCall = await handleMCPRequest({ method: 'tools/call', id: 802, params: { name: 'query_files', arguments: { keyword: 'note' } } }, queryEnv);
  check('MCP 查询失败不增加 usage_count', failedCall.data.result.content[0].text.startsWith('❌') && usagePatches === 1, JSON.stringify({ text: failedCall.data.result.content[0].text, usagePatches }));
}

console.log(`\\n===== 结果：${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail ? 1 : 0);