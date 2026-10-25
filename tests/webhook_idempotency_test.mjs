// webhook 三行为验证测试 · 2026-10-20 · 待办③（幂等+重试）
// 验证 chat_webhook.js 的 A 正常到达 / B 重复投递幂等 / C 失败重试不破坏状态
// 运行：cd /tmp && node webhook_behavior_test.mjs
import { handleChatWebhook } from '/tmp/mm2/src/tools/chat_webhook.js';
import { handleMCPRequest } from '/tmp/mm2/src/modules/mcp_router.js';

const env = {
  SUPABASE_URL: 'https://mock.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'mock-service-key',
  SUPABASE_ANON_KEY: 'mock-anon-key',
};

// 可控的 mock fetch：queryEvent 返回由当前用例指定的 rows；audit 写入记入数组
let mockQueryRows = [];
let queryFail = false; // 模拟 C：查询失败（网络/500）
const auditRows = [];
let routerMockMode = false;
let routerFetchMode = 'empty';
let usageFetchCount = 0;
globalThis.fetch = async (url, opts = {}) => {
  const s = String(url);
  if (routerMockMode && s.includes('/rest/v1/skills')) {
    if (routerFetchMode === 'http500') return { ok: false, status: 500, text: async () => 'mock registry HTTP 500' };
    if (routerFetchMode === 'network') throw new Error('mock registry network failure');
    return { ok: true, status: 200, json: async () => [] };
  }
  if (routerMockMode && s.includes('/rest/v1/')) {
    if (s.includes('usage_count') || s.includes('last_used')) usageFetchCount++;
    return { ok: true, status: 200, json: async () => [] };
  }
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

console.log('\n[Router 注册表故障契约]');
routerMockMode = true;
const routerEnv = { SUPABASE_URL: 'https://mock.supabase.co', SUPABASE_ANON_KEY: 'mock-anon-key' };
async function callTool(name) {
  return handleMCPRequest({ jsonrpc: '2.0', id: 'router-test', method: 'tools/call', params: { name, arguments: {} } }, routerEnv);
}
{
  routerFetchMode = 'network';
  const res = await callTool('memory_test_schema_failure');
  const text = res.data.result.content[0].text;
  check('前缀工具 Schema 查询网络失败→TOOL_REGISTRY_UNAVAILABLE', text.includes('[TOOL_REGISTRY_UNAVAILABLE]'), text);
  check('Schema 查询失败不进入工具、不增加 usage_count', usageFetchCount === 0, 'usageFetchCount=' + usageFetchCount);
}
{
  routerFetchMode = 'http500';
  const res = await callTool('truly_unknown_tool');
  const text = res.data.result.content[0].text;
  check('注册表 HTTP 500→TOOL_REGISTRY_UNAVAILABLE', text.includes('[TOOL_REGISTRY_UNAVAILABLE]'), text);
  check('注册表 HTTP 500 不增加 usage_count', usageFetchCount === 0, 'usageFetchCount=' + usageFetchCount);
}
{
  routerFetchMode = 'network';
  const res = await callTool('another_unknown_tool');
  const text = res.data.result.content[0].text;
  check('注册表网络异常→TOOL_REGISTRY_UNAVAILABLE', text.includes('[TOOL_REGISTRY_UNAVAILABLE]'), text);
}
{
  routerFetchMode = 'empty';
  const res = await callTool('truly_unknown_tool');
  const text = res.data.result.content[0].text;
  check('注册表查询成功且无匹配项→UNKNOWN_TOOL', text.includes('[UNKNOWN_TOOL]'), text);
}

console.log(`\n===== 结果：${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail ? 1 : 0);