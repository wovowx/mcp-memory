// 阶段4：Router/注册表契约隔离 Mock 回归测试（Operit 独立测试 · 2026-10-26）
// 运行：从仓库根目录执行 node tests/router_registry_contract_test.mjs
import { handleMCPRequest } from '../src/modules/mcp_router.js';
import { handleDatabaseTool } from '../src/tools/database.js';

const env = { SUPABASE_URL: 'https://mock.supabase.co', SUPABASE_ANON_KEY: 'mock-anon-key' };
let pass = 0, fail = 0;
function check(name, cond, extra = '') { if (cond) { pass++; console.log('  ✅ ' + name); } else { fail++; console.log('  ❌ ' + name + ' ' + extra); } }

const fixture = [
  { name: 'memory', enabled: true, description: 'memory tool', handler_type: 'js', handler_config: { handler: 'memory' } },
  { name: 'supabase_db', enabled: true, description: 'database', handler_type: 'js', handler_config: { handler: 'database' }, input_schema: { type: 'object', required: ['action'], properties: { action: { type: 'string', enum: ['query', 'insert', 'update', 'delete', 'tables', 'exec'] }, sql: { type: 'string' }, table: { type: 'string' }, columns: { type: 'string' } } } },
  { name: 'supabase_schema', enabled: true, description: 'schema', handler_type: 'js', handler_config: { handler: 'database' }, input_schema: { type: 'object', required: ['action'], properties: { action: { type: 'string', enum: ['create_table', 'drop_table', 'tables', 'exec', 'schema_dump'] }, sql: { type: 'string' }, table: { type: 'string' }, columns: { type: 'string' }, format: { type: 'string', enum: ['md', 'json'] }, rls: { type: 'boolean' } } } },
  { name: 'image_upload', enabled: true, description: 'media', handler_type: 'ai', handler_config: { handler: 'ai' } },
  { name: 'master-router', enabled: true, description: 'router', handler_type: 'text' }, // 无 handler_config.handler
  { name: 'memory_remember', enabled: true, description: 'remember', handler_type: 'js', handler_config: { handler: 'memory' } },
  { name: 'create_patch_proposal', enabled: true, description: 'create proposal', handler_type: 'js', handler_config: { handler: 'database' }, input_schema: null }
];
let registryMode = 'ok'; let memoriesRestCount = 0; let usagePatchCount = 0; let otherRestCount = 0; let patchProposalPostCount = 0;
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
  if (s.includes('/rest/v1/patch_proposals') && m === 'POST') { patchProposalPostCount++; return { ok: true, status: 201, json: async () => [{ id: 'mock-proposal-id' }], text: async () => '' }; }
  if (s.includes('/rest/v1/rpc/exec_sql')) { ddlRpcCount++; lastExecSql = JSON.parse(opts.body || '{}').sql || ''; return { ok: true, status: 200, text: async () => '', json: async () => [] }; }
  if (s.endsWith('/rest/v1/')) { tableListCount++; return { ok: true, status: 200, json: async () => ({ definitions: { memories: {}, memory_events: {} } }) }; }
  if (s.includes('/rest/v1/memories') || s.includes('/rest/v1/memory_events')) { memoriesRestCount++; return { ok: true, status: 200, json: async () => [] }; }
  if (s.includes('/rest/v1/')) { otherRestCount++; return { ok: true, status: 200, json: async () => [] }; }
  throw new Error('unexpected mock fetch: ' + s);
};
const callTool = async (name, args = {}) => (await handleMCPRequest({ jsonrpc: '2.0', id: 'c', method: 'tools/call', params: { name, arguments: args } }, env)).data.result.content[0].text;
const listToolDefs = async () => (await handleMCPRequest({ jsonrpc: '2.0', id: 'l', method: 'tools/list' }, env)).data.result.tools;
const listTools = async () => (await listToolDefs()).map(t => t.name);
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

  const listedTools = await listToolDefs();
  const listedDbTool = listedTools.find(tool => tool.name === 'supabase_db');
  const listedSchemaTool = listedTools.find(tool => tool.name === 'supabase_schema');
  check('tools/list 暴露 supabase_db necessity 参数', listedDbTool?.inputSchema?.properties?.necessity?.type === 'string');
  check('tools/list 不额外开放 supabase_db drop_table action', !listedDbTool?.inputSchema?.properties?.action?.enum?.includes('drop_table'));
  check('tools/list 暴露 supabase_schema necessity 参数', listedSchemaTool?.inputSchema?.properties?.necessity?.type === 'string');
  check('tools/list 保留注册的 supabase_schema drop_table action', listedSchemaTool?.inputSchema?.properties?.action?.enum?.includes('drop_table'));

  const listedProposalTool = listedTools.find(tool => tool.name === 'create_patch_proposal');
  check('tools/list 为 create_patch_proposal 暴露必填 schema', listedProposalTool?.inputSchema?.required?.join(',') === 'target_file,change_summary,reason');
  usagePatchCount = 0; patchProposalPostCount = 0;
  t = await callTool('create_patch_proposal', {});
  check('create_patch_proposal 缺参在 Router schema 层拒绝', t.includes('[MISSING_REQUIRED_PARAM]'));
  check('缺参不写 proposal 且不计 usage', patchProposalPostCount === 0 && usagePatchCount === 0);
  t = await callTool('create_patch_proposal', { target_file: 'src/mock.js', change_summary: 'mock change', reason: 'contract test' });
  check('create_patch_proposal 成功写入隔离 mock', t.includes('✅ Patch Proposal 已创建') && patchProposalPostCount === 1);
  check('create_patch_proposal 成功恰好计一次 usage', usagePatchCount === 1);

  ddlRpcCount = 0; tableListCount = 0;
  t = await callTool('supabase_exec', { action: 'exec', sql: 'DROP TABLE public.mock_probe' });
  check('未注册 supabase_ 前缀拒绝', t.includes('[UNKNOWN_TOOL]'));
  check('未注册前缀不触达 exec_sql', ddlRpcCount === 0);

  ddlRpcCount = 0; tableListCount = 0;
  t = await callTool('supabase_schema', { action: 'create_table', table: 'mock_probe', columns: 'id uuid' });
  check('注册的 supabase_schema create_table 缺 necessity 被拒绝', t.includes('TABLE_CHANGE_GUARD_REQUIRED'));
  check('create_table 缺参拒绝不调用 RPC', ddlRpcCount === 0);

  ddlRpcCount = 0; tableListCount = 0;
  t = await callTool('supabase_schema', { action: 'drop_table', table: 'mock_probe' });
  check('注册的 supabase_schema drop_table 缺 necessity 被拒绝', t.includes('TABLE_CHANGE_GUARD_REQUIRED'));
  check('drop_table 缺参拒绝不调用 RPC', ddlRpcCount === 0);
  t = await callTool('supabase_schema', { action: 'drop_table', table: 'mock_probe', necessity: 'fixture check' });
  check('公开 necessity 后只进入隔离 RPC mock', t.startsWith('✅ 删表成功') && ddlRpcCount === 1 && lastExecSql.startsWith('DROP TABLE'));

  ddlRpcCount = 0; tableListCount = 0;
  t = await callTool('supabase_db', { action: 'exec', sql: 'ALTER TABLE public.mock_probe ADD COLUMN probe text' });
  check('exec DDL 缺 necessity 被拒绝', t.includes('TABLE_CHANGE_GUARD_REQUIRED'));
  check('exec DDL 被拒时不调用 RPC', ddlRpcCount === 0);
  check('exec DDL 拒绝前尝试列出现有表', tableListCount === 1);

  ddlRpcCount = 0; tableListCount = 0;
  t = await handleDatabaseTool('supabase_db', { action: 'create_table', table: 'mock_probe', columns: 'id uuid' }, env);
  check('create_table 空 necessity 仍被拒绝', t.includes('TABLE_CHANGE_GUARD_REQUIRED') && ddlRpcCount === 0);
  t = await handleDatabaseTool('supabase_db', { action: 'drop_table', table: 'mock_probe' }, env);
  check('drop_table 缺 necessity 被拒绝', t.includes('TABLE_CHANGE_GUARD_REQUIRED') && ddlRpcCount === 0);
  t = await handleDatabaseTool('supabase_db', { action: 'drop_table', table: 'mock_probe', necessity: 'fixture check' }, env);
  check('drop_table 提供 necessity 后才到隔离 RPC', t.startsWith('✅ 删表成功') && ddlRpcCount === 1 && lastExecSql.startsWith('DROP TABLE'));

  ddlRpcCount = 0;
  t = await handleDatabaseTool('supabase_db', { action: 'drop_table', table: 'mock_probe', necessity: '   ' }, env);
  check('drop_table 空白 necessity 被拒绝', t.includes('TABLE_CHANGE_GUARD_REQUIRED') && ddlRpcCount === 0);

  ddlRpcCount = 0;
  t = await handleDatabaseTool('supabase_db', { action: 'exec', sql: 'DROP TABLE public.mock_probe' }, env);
  check('exec DDL 空 necessity 被拒绝', t.includes('TABLE_CHANGE_GUARD_REQUIRED') && ddlRpcCount === 0);
  ddlRpcCount = 0;
  t = await handleDatabaseTool('supabase_db', { action: 'exec', sql: 'IMPORT FOREIGN SCHEMA public FROM SERVER mock_server INTO public' }, env);
  check('exec IMPORT FOREIGN SCHEMA 缺 necessity 被拒绝且不调用 RPC', t.includes('TABLE_CHANGE_GUARD_REQUIRED') && ddlRpcCount === 0);
  ddlRpcCount = 0;
  t = await handleDatabaseTool('supabase_db', { action: 'exec', sql: "SECURITY LABEL FOR 'dummy' ON TABLE public.mock_probe IS 'fixture'" }, env);
  check('exec SECURITY LABEL 缺 necessity 被拒绝且不调用 RPC', t.includes('TABLE_CHANGE_GUARD_REQUIRED') && ddlRpcCount === 0);
  t = await handleDatabaseTool('supabase_db', { action: 'exec', sql: 'SELECT 1' }, env);
  check('exec 只读 SQL 保持兼容', t.startsWith('✅ SQL执行成功') && ddlRpcCount === 1 && lastExecSql === 'SELECT 1');
  ddlRpcCount = 0;
  t = await handleDatabaseTool('supabase_db', { action: 'exec', sql: 'CREATE TABLE public.mock_probe (id uuid)', necessity: 'fixture check' }, env);
  check('exec DDL 提供 necessity 后仅命中隔离 RPC mock', t.startsWith('✅ SQL执行成功') && ddlRpcCount === 1 && lastExecSql.startsWith('CREATE TABLE'));

  // Constrained DDL parser tests: all fetch calls remain isolated by the mock above.
  ddlRpcCount = 0; tableListCount = 0;
  t = await handleDatabaseTool('supabase_schema', {
    action: 'create_table', table: 'mock_safe',
    columns: 'id uuid PRIMARY KEY, name text NOT NULL',
    necessity: 'isolated parser fixture'
  }, env);
  check('DDL parser accepts basic column definitions and safely quotes identifiers',
    t.startsWith('✅ 建表成功') && ddlRpcCount === 1 &&
    lastExecSql.includes('CREATE TABLE IF NOT EXISTS public."mock_safe" ("id" uuid PRIMARY KEY, "name" text NOT NULL)') &&
    lastExecSql.includes('ALTER TABLE public."mock_safe" ENABLE ROW LEVEL SECURITY'));

  ddlRpcCount = 0;
  t = await handleDatabaseTool('supabase_schema', {
    action: 'create_table', table: 'mock_defaults',
    columns: "amount numeric(10,2) DEFAULT 12.34, aliases uuid[], display_name text DEFAULT 'O''Reilly, Jr.', active boolean DEFAULT true, created_at timestamptz DEFAULT CURRENT_TIMESTAMP, description text DEFAULT 'semi; DROP TABLE x --'",
    necessity: 'isolated parser fixture'
  }, env);
  check('DDL parser accepts numeric(p,s), arrays, escaped string and safe defaults',
    t.startsWith('✅ 建表成功') && ddlRpcCount === 1 &&
    lastExecSql.includes('numeric(10,2) DEFAULT 12.34') &&
    lastExecSql.includes("E'O''Reilly, Jr.'") &&
    lastExecSql.includes("E'semi; DROP TABLE x --'") &&
    lastExecSql.includes('uuid[]') && lastExecSql.includes('DEFAULT TRUE') &&
    lastExecSql.includes('DEFAULT CURRENT_TIMESTAMP'));

  ddlRpcCount = 0;
  t = await handleDatabaseTool('supabase_schema', {
    action: 'create_table', table: 'mock_no_rls',
    columns: 'value varchar(40), code char(2), score double precision',
    rls: false, necessity: 'isolated parser fixture'
  }, env);
  check('DDL parser accepts varchar/char/double precision and preserves rls=false',
    t.startsWith('✅ 建表成功') && ddlRpcCount === 1 &&
    lastExecSql.includes('"value" varchar(40)') &&
    lastExecSql.includes('"code" char(2)') &&
    lastExecSql.includes('"score" double precision') &&
    !lastExecSql.includes('ENABLE ROW LEVEL SECURITY'));

  const invalidTableNames = [
    'BadName', 'public.mock_probe', 'mock_probe; DROP TABLE memories',
    'mock probe', '"mock_probe"', 'x'.repeat(64)
  ];
  for (const invalidTable of invalidTableNames) {
    ddlRpcCount = 0; tableListCount = 0;
    t = await handleDatabaseTool('supabase_schema', {
      action: 'create_table', table: invalidTable, columns: 'id uuid',
      necessity: 'isolated parser fixture'
    }, env);
    check('rejects invalid table identifier without DDL RPC: ' + invalidTable,
      t.startsWith('❌ 输入校验失败：') && ddlRpcCount === 0);
  }

  const invalidColumnDefinitions = [
    'id uuid); DROP TABLE public.memories; --',
    'id uuid; DROP TABLE public.memories',
    'name text -- comment',
    'id uuid /* comment */',
    "name text DEFAULT 'unterminated",
    'amount numeric(10,2',
    'id uuid CHECK (true)',
    'id custom_type',
    'id integer DEFAULT 1 + 1',
    'id uuid, id text',
    'Name text',
    'id uuid,',
    'id uuid,, name text',
    'id text[][]'
  ];
  for (const invalidColumns of invalidColumnDefinitions) {
    ddlRpcCount = 0; tableListCount = 0;
    t = await handleDatabaseTool('supabase_schema', {
      action: 'create_table', table: 'mock_probe', columns: invalidColumns,
      necessity: 'isolated parser fixture'
    }, env);
    check('rejects unsupported/injected column grammar without DDL RPC: ' + invalidColumns,
      t.startsWith('❌ 输入校验失败：') && ddlRpcCount === 0);
  }

  ddlRpcCount = 0;
  t = await handleDatabaseTool('supabase_schema', {
    action: 'drop_table', table: 'mock_probe; DROP TABLE memories',
    necessity: 'isolated parser fixture'
  }, env);
  check('drop_table rejects invalid identifier before RPC',
    t.startsWith('❌ 输入校验失败：') && ddlRpcCount === 0);

  ddlRpcCount = 0;
  t = await handleDatabaseTool('supabase_schema', {
    action: 'drop_table', table: 'mock_probe',
    necessity: 'isolated parser fixture'
  }, env);
  check('drop_table valid identifier safely quoted and uses one isolated RPC',
    t.startsWith('✅ 删表成功') && ddlRpcCount === 1 &&
    lastExecSql === 'DROP TABLE IF EXISTS public."mock_probe" CASCADE');

} finally { globalThis.fetch = origFetch; }
console.log('===== ' + pass + ' 通过 / ' + fail + ' 失败 =====');
process.exit(fail ? 1 : 0);

