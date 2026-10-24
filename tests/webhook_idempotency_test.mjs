// webhook 三行为验证测试 · 2026-10-20 · 待办③（幂等+重试）
// 验证 chat_webhook.js 的 A 正常到达 / B 重复投递幂等 / C 失败重试不破坏状态
// 运行：node tests/webhook_idempotency_test.mjs
import { handleChatWebhook } from '../src/tools/chat_webhook.js';
import { handleMemoryTool, putMemory } from '../src/tools/memory_unified.js';
import { handleAITool } from '../src/tools/ai.js';
import { handleMCPRequest, validateSchemaSubset } from '../src/modules/mcp_router.js';

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

console.log('[update_file] 元数据更新：成功/未找到/HTTP失败/参数错误/网络异常/usage 契约');
{
  const skillQ = { name: 'query_files', enabled: true, usage_count: 0, input_schema: { type: 'object' }, handler_config: { handler: 'ai' }, handler_type: 'js' };
  const skU = { name: 'update_file', description: 'u', enabled: true, usage_count: 0, input_schema: { type: 'object' }, handler_config: { handler: 'ai' }, handler_type: 'js' };
  const skD = { name: 'delete_file', description: 'd', enabled: true, usage_count: 0, input_schema: { type: 'object' }, handler_config: { handler: 'ai' }, handler_type: 'js' };
  let patchRows=[], patchStatus=200, netErr=false, usagePatches=0;
  globalThis.fetch = async (url, opts={}) => {
    const s=String(url), m=opts.method||'GET';
    if (s.includes('/rest/v1/skills?enabled=eq.true&select=*')) return { ok:true, status:200, json: async () => [skU, skD, skillQ] };
    if (s.includes('/rest/v1/skills?name=eq.update_file&select=*')) return { ok:true, status:200, json: async () => [skU] };
    if (s.includes('/rest/v1/skills?name=eq.update_file') && m==='PATCH') { usagePatches++; return { ok:true, status:204, json: async () => [] }; }
    if (s.includes('/rest/v1/files?id=eq.')) {
      if (netErr) throw new Error('network down');
      if (patchStatus!==200) return { ok:false, status:patchStatus, text: async () => 'mock patch fail' };
      return { ok:true, status:200, json: async () => patchRows };
    }
    throw new Error('unexpected update_file fetch: ' + s + ' ' + m);
  };
  patchRows = [{ id:'file-9', file_name:'doc.txt' }];
  const u1 = await handleAITool('update_file', { file_id:'file-9', category:'x' }, env);
  check('update_file 成功返回更新信息', u1.startsWith('✅ 文件元数据更新成功') && u1.includes('doc.txt'));
  patchRows = [];
  const u2 = await handleAITool('update_file', { file_id:'nope', category:'x' }, env);
  check('update_file 未找到明确失败', u2.startsWith('❌') && u2.includes('未找到'));
  patchRows = [{ id:'file-9' }]; patchStatus = 500;
  const u3 = await handleAITool('update_file', { file_id:'file-9', tags:['t'] }, env);
  check('update_file HTTP 失败明确标记', u3.startsWith('❌') && u3.includes('HTTP 500'));
  patchStatus = 200;
  const u4 = await handleAITool('update_file', { file_id:'', category:'x' }, env);
  check('update_file 参数错误明确标记', u4.startsWith('❌') && u4.includes('file_id'));
  const u5 = await handleAITool('update_file', { file_id:'file-9' }, env);
  check('update_file 无字段明确标记', u5.startsWith('❌') && u5.includes('至少提供'));
  netErr = true;
  const u6 = await handleAITool('update_file', { file_id:'file-9', category:'x' }, env);
  check('update_file 网络异常明确标记', u6.startsWith('❌') && u6.includes('更新失败'));
  netErr = false; patchRows = [{ id:'file-9', file_name:'doc.txt' }];
  const um = await handleMCPRequest({ method:'tools/call', id:910, params:{ name:'update_file', arguments:{ file_id:'file-9', category:'x' } } }, env);
  check('update_file MCP 成功增加一次 usage_count', um.data.result.content[0].text.startsWith('✅') && usagePatches === 1);
  const umb = await handleMCPRequest({ method:'tools/call', id:911, params:{ name:'update_file', arguments:{ file_id:'' } } }, env);
  check('update_file MCP 参数错误不增加 usage_count', umb.data.result.content[0].text.startsWith('❌') && usagePatches === 1);
}
console.log('[delete_file] 先删 Storage 再删元数据：成功/未找到/缺路径/Storage失败/部分失败/网络异常/usage 契约');
{
  const skillQ = { name: 'query_files', enabled: true, usage_count: 0, input_schema: { type: 'object' }, handler_config: { handler: 'ai' }, handler_type: 'js' };
  const skU = { name: 'update_file', description: 'u', enabled: true, usage_count: 0, input_schema: { type: 'object' }, handler_config: { handler: 'ai' }, handler_type: 'js' };
  const skD = { name: 'delete_file', description: 'd', enabled: true, usage_count: 0, input_schema: { type: 'object' }, handler_config: { handler: 'ai' }, handler_type: 'js' };
  let fileRec=[], storageStatus=200, metaStatus=200, lookupStatus=200, netErr=false, metaRows=[{ id:'file-7' }];
  let sDel=0, mDel=0, usagePatches=0;
  globalThis.fetch = async (url, opts={}) => {
    const s=String(url), m=opts.method||'GET';
    if (s.includes('/rest/v1/skills?enabled=eq.true&select=*')) return { ok:true, status:200, json: async () => [skU, skD, skillQ] };
    if (s.includes('/rest/v1/skills?name=eq.delete_file&select=*')) return { ok:true, status:200, json: async () => [skD] };
    if (s.includes('/rest/v1/skills?name=eq.delete_file') && m==='PATCH') { usagePatches++; return { ok:true, status:204, json: async () => [] }; }
    if (s.includes('/rest/v1/files?select=id,file_path,file_name')) {
      if (netErr) throw new Error('network down');
      if (lookupStatus!==200) return { ok:false, status:lookupStatus, text: async () => 'lookup fail' };
      return { ok:true, status:200, json: async () => fileRec };
    }
    if (s.includes('/storage/v1/object/files/')) { sDel++; return storageStatus===200 ? { ok:true, status:200 } : { ok:false, status:storageStatus, text: async () => 'storage fail' }; }
    if (s.includes('/rest/v1/files?id=eq.') && m==='DELETE') { mDel++; return metaStatus===200 ? { ok:true, status:200, json: async () => metaRows } : { ok:false, status:metaStatus, text: async () => 'meta fail' }; }
    throw new Error('unexpected delete_file fetch: ' + s + ' ' + m);
  };
  fileRec = [{ id:'file-7', file_path:'b/dir/f.txt', file_name:'f.txt' }];
  const d1 = await handleAITool('delete_file', { file_id:'file-7' }, env);
  check('delete_file 成功删除并确认元数据返回目标行', d1.startsWith('✅ 文件删除成功') && d1.includes('已确认'));
  metaRows=[];
  const d0 = await handleAITool('delete_file', { file_id:'file-7' }, env);
  check('delete_file Storage 成功但元数据 DELETE 返回零行时报告部分失败', d0.startsWith('❌') && d0.includes('未返回被删除的元数据行'));
  metaRows=[{ id:'file-7' }];
  fileRec = [];
  const d2 = await handleAITool('delete_file', { file_id:'nope' }, env);
  check('delete_file 未找到明确失败', d2.startsWith('❌') && d2.includes('未找到'));
  fileRec = [{ id:'file-7', file_path:'', file_name:'f' }];
  const d3 = await handleAITool('delete_file', { file_id:'file-7' }, env);
  check('delete_file 缺 file_path 明确不执行删除', d3.startsWith('❌') && d3.includes('缺少有效 file_path'));
  fileRec = [{ id:'file-7', file_path:'b/f.txt', file_name:'f' }]; storageStatus=500; sDel=0; mDel=0;
  const d4 = await handleAITool('delete_file', { file_id:'file-7' }, env);
  check('delete_file Storage失败→DB元数据保留(未发 metadata DELETE)', d4.startsWith('❌') && d4.includes('Storage 对象未确认删除') && mDel===0);
  storageStatus=200; metaStatus=500; sDel=0; mDel=0;
  const d5 = await handleAITool('delete_file', { file_id:'file-7' }, env);
  check('delete_file 部分失败明确报告', d5.startsWith('❌') && d5.includes('部分失败') && sDel===1 && mDel===1);
  storageStatus=200; metaStatus=200; lookupStatus=500;
  const d6 = await handleAITool('delete_file', { file_id:'file-7' }, env);
  check('delete_file 查询元数据失败明确标记', d6.startsWith('❌') && d6.includes('查询文件元数据'));
  lookupStatus=200; netErr=true;
  const d7 = await handleAITool('delete_file', { file_id:'file-7' }, env);
  check('delete_file 网络异常明确标记', d7.startsWith('❌') && d7.includes('删除失败'));
  netErr=false; storageStatus=200; metaStatus=200; fileRec=[{ id:'file-7', file_path:'b/f.txt', file_name:'f' }];
  const dm = await handleMCPRequest({ method:'tools/call', id:912, params:{ name:'delete_file', arguments:{ file_id:'file-7' } } }, env);
  check('delete_file MCP 成功增加一次 usage_count', dm.data.result.content[0].text.startsWith('✅') && usagePatches===1);
  metaStatus=500; const before=usagePatches;
  const dmb = await handleMCPRequest({ method:'tools/call', id:913, params:{ name:'delete_file', arguments:{ file_id:'file-7' } } }, env);
  check('delete_file MCP 部分失败不增加 usage_count', dmb.data.result.content[0].text.startsWith('❌') && dmb.data.result.content[0].text.includes('部分失败') && usagePatches===before);
}
console.log('\n[query_files] 查询成功、空结果、参数错误与 HTTP 失败契约');
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

  const invalidCall = await handleMCPRequest({ method: 'tools/call', id: 803, params: { name: 'query_files', arguments: { limit: 0 } } }, queryEnv);
  check('MCP 参数错误不增加 usage_count', invalidCall.data.result.content[0].text.startsWith('❌') && usagePatches === 1, JSON.stringify({ text: invalidCall.data.result.content[0].text, usagePatches }));

  fileQueryStatus = 503;
  const failedCall = await handleMCPRequest({ method: 'tools/call', id: 802, params: { name: 'query_files', arguments: { keyword: 'note' } } }, queryEnv);
  check('MCP 查询失败不增加 usage_count', failedCall.data.result.content[0].text.startsWith('❌') && usagePatches === 1, JSON.stringify({ text: failedCall.data.result.content[0].text, usagePatches }));
}

console.log('\n[dispatch schema] 有边界的 JSON Schema 子集校验');
{
  const schema = {
    type: 'object',
    required: ['name'],
    properties: {
      name: { type: 'string' },
      mode: { type: 'string', enum: ['brief', 'full'] },
      tags: { type: 'array', items: { type: 'string' } },
      score: { type: 'number', minimum: 1, maximum: 5 },
      count: { type: 'integer' }
    }
  };
  check('schema required 缺失被识别', validateSchemaSubset(schema, { mode: 'brief' })?.includes('缺少必需参数: name'));
  check('schema type 错误被识别', validateSchemaSubset(schema, { name: 42 })?.includes('arguments.name 类型错误'));
  check('schema enum 非法值被识别', validateSchemaSubset(schema, { name: 'ok', mode: 'verbose' })?.includes('arguments.mode 不在允许的枚举值中'));
  check('schema array items 类型错误被识别', validateSchemaSubset(schema, { name: 'ok', tags: ['valid', 2] })?.includes('arguments.tags[1] 类型错误'));
  check('schema minimum 越界被识别', validateSchemaSubset(schema, { name: 'ok', score: 0 })?.includes('小于最小值 1'));
  check('schema maximum 越界被识别', validateSchemaSubset(schema, { name: 'ok', score: 6 })?.includes('大于最大值 5'));
  check('schema integer 类型正确', validateSchemaSubset(schema, { name: 'ok', count: 2 }) === null);
  check('符合已声明子集的参数放行', validateSchemaSubset(schema, { name: 'ok', mode: 'brief', tags: ['a'], score: 3, count: 2 }) === null);
  check('未声明的 schema 关键字不擅自拒绝', validateSchemaSubset({ type: 'object', patternProperties: { x: {} } }, { x: true }) === null);
}
console.log('\n[skill] 技能注册管理反馈：查询失败/空态/写失败/零行/usage 契约');
{
  const skL={name:'skill_list',enabled:true,usage_count:0,input_schema:{},handler_config:{handler:'skill'},handler_type:'js'};
  const skA={name:'skill_add',enabled:true,usage_count:0,input_schema:{},handler_config:{handler:'skill'},handler_type:'js'};
  const skU={name:'skill_update',enabled:true,usage_count:0,input_schema:{},handler_config:{handler:'skill'},handler_type:'js'};
  const skD={name:'skill_delete',enabled:true,usage_count:0,input_schema:{},handler_config:{handler:'skill'},handler_type:'js'};
  const queryRow={ name:'query_files',description:'q',enabled:true,usage_count:7,input_schema:{type:'object',properties:{keyword:{type:'string'}}},handler_config:{handler:'ai'},handler_type:'js' };
  let list500=false, emptyEnabled=false, addStatus=201, addRows=[{id:1}], upStatus=200, upRows=[{id:1}], delStatus=200, delRows=[{id:1}];
  let fileRows=[{id:'f1',file_name:'note.txt'}], fileStatus=200, usageFail=false;
  const usageShots=[];
  globalThis.fetch=async(url,opts={})=>{
    const s=String(url), m=(opts.method||'GET').toUpperCase();
    if (s.includes('/rest/v1/skills?enabled=eq.true&select=*')){ if(list500) return {ok:false,status:500,text:async()=> 'reg down'}; if(emptyEnabled) return {ok:true,status:200,json:async()=> []}; return {ok:true,status:200,json:async()=> [skL,skA,skU,skD,queryRow]}; }
    for (const tn of ['skill_list','skill_add','skill_update','skill_delete']){
      if (m==='GET' && s.includes('/rest/v1/skills?name=eq.'+tn+'&select=*')) return {ok:true,status:200,json:async()=> []};
    }
    if (m==='GET' && s.includes('/rest/v1/skills?name=eq.query_files&select=*')) return {ok:true,status:200,json:async()=> [queryRow]};
    if (m==='PATCH' && s.includes('/rest/v1/skills?name=eq.query_files')){ usageShots.push('query_files'); if(usageFail) return {ok:false,status:500,text:async()=> 'usage down'}; return {ok:true,status:204,json:async()=> []}; }
    if (m==='POST' && s.includes('/rest/v1/skills')){ if(addStatus!==201) return {ok:false,status:addStatus,text:async()=> 'add fail'}; return {ok:true,status:201,json:async()=> addRows}; }
    if (m==='PATCH' && s.includes('/rest/v1/skills?name=eq.mySkill')){ if(upStatus!==200) return {ok:false,status:upStatus,text:async()=> 'up fail'}; return {ok:true,status:200,json:async()=> upRows}; }
    if (m==='DELETE' && s.includes('/rest/v1/skills?name=eq.mySkill')){ if(delStatus!==200) return {ok:false,status:delStatus,text:async()=> 'del fail'}; return {ok:true,status:200,json:async()=> delRows}; }
    if (s.includes('/rest/v1/files?select=*')){ if(fileStatus!==200) return {ok:false,status:fileStatus,text:async()=> 'files down'}; return {ok:true,status:200,json:async()=> fileRows}; }
    throw new Error('unexpected fetch '+s+' '+m);
  };
  const v=async nm=>{ const r=await handleMCPRequest({method:'tools/call',id:1,params:{name:nm,arguments:{}}},env); return r.data.result.content[0].text; };
  const va=async(nm,arg)=>{ const r=await handleMCPRequest({method:'tools/call',id:1,params:{name:nm,arguments:arg}},env); return r.data.result.content[0].text; };
  let t;
  list500=true;
  t=await v('skill_list');
  check('getEnabledSkills HTTP500 -> skill_list 归一化 err: 且不产生 usage PATCH', t.startsWith('err:') && !usageShots.some(x=>x.startsWith('skill')));
  list500=false;
  emptyEnabled=true;
  t=await v('skill_list');
  check('skill_list 空结果返回明确空态 no skills', t==='no skills');
  emptyEnabled=false;
  t=await v('skill_list');
  check('skill_list 非空列表实际包含技能名', t.includes('skills (5)') && t.includes('skill_add'));
  t=await va('skill_add',{name:'newSkill'});
  check('skill_add 成功返回 added', t==='added: newSkill');
  t=await v('skill_add');
  check('skill_add 缺 name -> err: missing name', t==='err: missing name');
  addStatus=500;
  t=await va('skill_add',{name:'x'});
  check('skill_add 底层非2xx -> err: write failed', t==='err: skill_add write failed: x');
  addStatus=201; addRows=[];
  t=await va('skill_add',{name:'x'});
  check('skill_add 零行响应不误报成功', t.startsWith('err:'));
  addRows=[{id:1}];
  t=await va('skill_update',{name:'mySkill',description:'new'});
  check('skill_update 成功返回 updated', t==='updated: mySkill');
  upStatus=500;
  t=await va('skill_update',{name:'mySkill'});
  check('skill_update 底层失败 -> err: 且不误打点', t.startsWith('err:') && !usageShots.some(x=>x.startsWith('skill')));
  upStatus=200;
  t=await va('skill_delete',{name:'mySkill'});
  check('skill_delete 成功返回 deleted、管理工具不误打点 usage', t==='deleted: mySkill' && !usageShots.some(x=>x.startsWith('skill')));
  delStatus=500;
  t=await va('skill_delete',{name:'mySkill'});
  check('skill_delete 失败 -> err:', t.startsWith('err:'));
  delStatus=200;
  const rOK=await handleMCPRequest({method:'tools/call',id:2,params:{name:'query_files',arguments:{keyword:'note'}}},env);
  check('query_files(ai) 成功调用增加一次 usage', rOK.data.result.content[0].text.includes('找到 1 个文件') && usageShots.filter(x=>x==='query_files').length===1);
  fileStatus=503;
  const rFail=await handleMCPRequest({method:'tools/call',id:3,params:{name:'query_files',arguments:{keyword:'note'}}},env);
  check('query_files 查询失败不增加 usage', rFail.data.result.content[0].text.startsWith('\u274c') && usageShots.filter(x=>x==='query_files').length===1);
  fileStatus=200;
  usageFail=true;
  const rUF=await handleMCPRequest({method:'tools/call',id:4,params:{name:'query_files',arguments:{keyword:'note'}}},env);
  check('usage 计数自身失败不改写原工具响应', rUF.data.result.content[0].text.includes('找到 1 个文件'));
  usageFail=false;
}

console.log(`\n===== 结果：${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail ? 1 : 0);