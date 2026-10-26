// 阶段4：Router/注册表契约隔离 Mock 回归测试（Operit 独立测试 · 2026-10-26）
// 运行：从仓库根目录执行 node tests/router_registry_contract_test.mjs
import { handleMCPRequest } from '../src/modules/mcp_router.js';
import { handleDatabaseTool } from '../src/tools/database.js';

const env = { SUPABASE_URL: 'https://mock.supabase.co', SUPABASE_ANON_KEY: 'mock-anon-key' };
let pass = 0, fail = 0;
function check(name, cond, extra = '') { if (cond) { pass++; console.log('  ✅ ' + name); } else { fail++; console.log('  ❌ ' + name + ' ' + extra); } }

const fixture = [
  { name: 'memory', enabled: true, description: 'memory tool', handler_type: 'js', handler_config: { handler: 'memory' } },
  { name: 'supabase_db', enabled: true, description: 'database', handler_type: 'js', handler_config: { handler: 'database' }, input_schema: { type: 'object', required: ['action'], properties: { action: { type: 'string', enum: ['query', 'insert', 'update', 'delete', 'tables', 'exec'] }, sql: { type: 'string' }, necessity: { type: 'string' }, table: { type: 'string' }, columns: { type: 'string' } } } },
  { name: 'image_upload', enabled: true, description: 'media', handler_type: 'ai', handler_config: { handler: 'ai' } },
  { name: 'master-router', enabled: true, description: 'router', handler_type: 'text' }, // 无 handler_config.handler
  { name: 'memory_remember', enabled: true, description: 'remember', handler_type: 'js', handler_config: { handler: 'memory' } }
];
let registryMode = 'ok'; let memoriesRestCount = 0; let usagePatchCount = 0; let otherRestCount = 0;
let ddlRpcCount = 0; let tableListCount = 0; let lastExecSql = '';
const origFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  const s = String(url); const m = (opts.method || 'GET').toUpperCase();
  if (s.includes('/rest/v1/skills')) {
    if (registryMode === 'network') throw new Error('mock registry network down');
    if (registryMode === 'http500') return { ok: false, status: 500, text: async () => 'mock registry HTTP 500' };
    if (m === 'POST') return { ok: true, status: 201, json: async () => [] };
    if (m === 'PATCH' || s.includes('usage_count') || s.includes('last_used')) { usagePatchCount++; return { ok: true, status: 200, json: async () => [] }; }
    if (s.includes('enabled=eq.true')) return { ok: true, status: 200, json: async () => fixture };
    const nm = (s.match(/name=eq\.([^&]+)/) || [])[1];
    const hit = nm ? fixture.find(x => x.name === decodeURIComponent(nm)) : null;
    return { ok: true, status: 200, json: async () => hit ? [hit] : [] };
  }
  if (s.includes('/rest/v1/rpc/exec_sql')) { ddlRpcCount++; lastExecSql = JSON.parse(opts.body || '{}').sql || ''; return { ok: true, status: 200, text: async () => '', json: async () => [] }; }
  if (s.endsWith('/rest/v1/')) { tableListCount++; return { ok: true, status: 200, json: async () => ({ definitions: { memories: {}, memory_events: {} } }) }; }
  if (s.includes('/rest/v1/memories') || s.includes('/rest/v1/memory_events')) { memoriesRestCount++; return { ok: true, status: 200, json: async () => [] }; }
  if (s.includes('/rest/v1/')) { otherRestCount++; return { ok: true, status: 200, json: async () => [] }; }
  throw new Error('unexpected mock fetch: ' + s);
};
const callTool = async (name, args = {}) => (await handleMCPRequest({ jsonrpc: '2.0', id: 'c', method: 'tools/call', params: { name, arguments: args } }, env)).data.result.content[0].text;
const listTools = async () => (await handleMCPRequest({ jsonrpc: '2.0', id: 'l', method: 'tools/list' }, env)).data.result.tools.map(t => t.name);
try {
  registryMode = 'network'; memoriesRestCount = 0; otherRestCount = 0;
  let t = await callTool('memory_schema_probe_net'); check('net→TOOL_REGISTRY_UNAVAILABLE', t.includes('[TOOL_REGISTRY_UNAVAILABLE]')); check('net 不发业务 REST', memoriesRestCount === 0 && otherRestCount === 0);
  registryMode = 'http500'; memoriesRestCount = 0; otherRestCount = 0;
  t = await callTool('memory_schema_probe_500'); check('500→TOOL_REGISTRY_UNAVAILABLE', t.includes('[TOOL_REGISTRY_UNAVAILABLE]')); check('500 不发业务 REST', memoriesRestCount === 0 && otherRestCount === 0);
  registryMode = 'ok';
  let names = await listTools(); check('list 含 memory', names.includes('memory')); check('list 无 memory_move', !names.includes('memory_move'));
  memoriesRestCount = 0; t = await callTool('memory_move', {});
  check('memory_move 空参→缺参', t.includes('需要 key 和 newCategory')); check('memory_move 不访问 memories/events', memoriesRestCount === 0);
  memoriesRestCount = 0; otherRestCount = 0; usagePatchCount = 0; t = await callTool('category_move_category', {});
  check('category→unknown tool', t.includes('unknown tool')); check('无业务写/不记 usage', memoriesRestCount === 0 && otherRestCount === 0 && usagePatchCount === 0);
  names = await listTools(); check('list 暴露 master-router', names.includes('master-router'));
  usagePatchCount = 0; t = await callTool('master-router', {});
  check('call→handler type not implemented', t.includes('handler type not implemented')); check('handler 缺失不再触发 usage PATCH（修复）', usagePatchCount === 0);
  usagePatchCount = 0; t = await callTool('memory_move', {}); check('memory_move 失败缺参不计数', usagePatchCount === 0);
  t = await callTool('memory_remember', {}); check('已注册 handler 返回参数失败不计数', t.startsWith('❌') && usagePatchCount === 0);
  t = await callTool('memory_remember', { key: 'probe_key', value: 'v' }); check('成功恰好计一次', usagePatchCount === 1);

  ddlRpcCount = 0; tableListCount = 0;
  t = await callTool('supabase_exec', { action: 'exec', sql: 'DROP TABLE public.mock_probe' });
  check('未注册 supabase_ 前缀拒绝', t.includes('[UNKNOWN_TOOL]'));
  check('未注册前缀不触达 exec_sql', ddlRpcCount === 0);

  ddlRpcCount = 0; tableListCount = 0;
  t = await callTool('supabase_db', { action: 'exec', sql: 'ALTER TABLE public.mock_probe ADD COLUMN probe text' });
  check('exec DDL 缺 necessity 被拒绝', t.includes('TABLE_CHANGE_GUARD_REQUIRED'));
  check('exec DDL 被拒时不调用 RPC', ddlRpcCount === 0);
  check('exec DDL 拒绝前尝试列出现有表', tableListCount === 1);

  ddlRpcCount = 0; tableListCount = 0;
  t = await handleDatabaseTool('supabase_db', { action: 'create_table', table: 'mock_probe', columns: 'id uuid' }, env);
  check('create_table 空 necessity 仍被拒绝', t.includes('TABLE_CHANGE_GUARD_REQUIRED') && ddlRpcCount === 0);
  t = await handleDatabaseTool('supabase_db', { action: 'drop_table', table: 'mock_probe', necessity: 'fixture check' }, env);
  check('drop_table 空间要求独立测试通过 necessity 后到 RPC', t.startsWith('✅ 删表成功') && ddlRpcCount === 1 && lastExecSql.startsWith('DROP TABLE'));

  ddlRpcCount = 0;
  t = await handleDatabaseTool('supabase_db', { action: 'drop_table', table: 'mock_probe', necessity: '   ' }, env);
  check('drop_table 空白 necessity 被拒绝', t.includes('TABLE_CHANGE_GUARD_REQUIRED') && ddlRpcCount === 0);

  ddlRpcCount = 0;
  t = await handleDatabaseTool('supabase_db', { action: 'exec', sql: 'DROP TABLE public.mock_probe' }, env);
  check('exec DDL 空 necessity 被拒绝', t.includes('TABLE_CHANGE_GUARD_REQUIRED') && ddlRpcCount === 0);
  t = await handleDatabaseTool('supabase_db', { action: 'exec', sql: 'SELECT 1' }, env);
  check('exec 只读 SQL 保持兼容', t.startsWith('✅ SQL执行成功') && ddlRpcCount === 1 && lastExecSql === 'SELECT 1');
  ddlRpcCount = 0;
  t = await handleDatabaseTool('supabase_db', { action: 'exec', sql: 'CREATE TABLE public.mock_probe (id uuid)', necessity: 'fixture check' }, env);
  check('exec DDL 提供 necessity 后仅命中隔离 RPC mock', t.startsWith('✅ SQL执行成功') && ddlRpcCount === 1 && lastExecSql.startsWith('CREATE TABLE'));
} finally { globalThis.fetch = origFetch; }
console.log('===== ' + pass + ' 通过 / ' + fail + ' 失败 =====');
process.exit(fail ? 1 : 0);

