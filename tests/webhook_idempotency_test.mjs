// webhook 三行为验证测试 · 2026-10-20 · 待办③（幂等+重试）
// 验证 chat_webhook.js 的 A 正常到达 / B 重复投递幂等 / C 失败重试不破坏状态
// 运行：cd /tmp && node webhook_behavior_test.mjs
import { handleChatWebhook } from '/tmp/mm2/src/tools/chat_webhook.js';
import { putMemory } from '../src/tools/memory_unified.js';

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
}

console.log(`\n===== 结果：${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail ? 1 : 0);