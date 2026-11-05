// 阶段4：Router/注册表/DDL parser/Patch Engine 隔离 Mock 契约回归（2026-10-27）
// 运行：从仓库根目录执行 node tests/router_registry_contract_test.mjs
import { handleMCPRequest } from '../src/modules/mcp_router.js';
import { handleDatabaseTool } from '../src/tools/database.js';
import { parseColumnDefinitions, quoteDdlIdentifier } from '../src/modules/database/ddl_parser.js';
import { handleGitHubTool } from '../src/tools/github_v64.js';
import { handleCloudflareTool } from '../src/modules/cloudflare/worker_status.js';
import { resolvePatchTargetPolicy, validatePatchTargetFile, validatePatch } from '../src/modules/patch_engine.js';
import { detectRepoType, validateRelease } from '../src/modules/release_guard.js';
import { validateRepoRelativePath } from '../src/utils/helpers.js';
import { buildErrorResponse, jsonResponse } from '../src/utils/response.js';

const env = { SUPABASE_URL: 'https://mock.supabase.co', SUPABASE_ANON_KEY: 'mock-anon-key' };
let pass = 0, fail = 0;
function check(name, cond, extra = '') { if (cond) { pass++; console.log('  ✅ ' + name); } else { fail++; console.log('  ❌ ' + name + ' ' + extra); } }

console.log('\n[Cloudflare provider contracts] deploy status, deploy detail, build logs and verify_main');
{
  const headersSeen = [];
  const jsonResponseMock = (payload, status = 200) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload)
  });

  const noTokenCalls = [];
  const noToken = await handleCloudflareTool('cloudflare_deploy_status', {}, {}, async (...args) => {
    noTokenCalls.push(args);
    throw new Error('must not fetch without a token');
  });
  check('Cloudflare service rejects missing token before network access',
    noToken.includes('Cloudflare token not set') && noTokenCalls.length === 0);

  const noAccount = await handleCloudflareTool('cloudflare_deploy_status', {}, {
    CLOUDFLARE_API_TOKEN: 'cf-token'
  }, async () => { throw new Error('must not fetch without account'); });
  check('Cloudflare service rejects missing account before network access',
    noAccount.includes('CLOUDFLARE_ACCOUNT_ID not set'));

  const statusCalls = [];
  const statusOutput = await handleCloudflareTool('cloudflare_deploy_status', {
    account_id: 'account-1',
    worker_name: 'mcp-memory',
    limit: 5
  }, { CLOUDFLARE_API_TOKEN: 'cf-token' }, async (url, options = {}) => {
    const address = String(url);
    statusCalls.push(address);
    headersSeen.push(options.headers);
    if (address.endsWith('/workers/scripts/mcp-memory/deployments')) {
      return jsonResponseMock({
        result: { deployments: [{ id: 'deploy-123456789', created_on: '2026-11-04T05:00:00Z', source: 'git' }] }
      });
    }
    if (address.endsWith('/workers/scripts/mcp-memory/versions?per_page=5')) {
      return jsonResponseMock({
        result: { items: [{ id: 'version-abcdef123', number: 17, metadata: { created_on: '2026-11-04T04:59:00Z', source: 'git' } }] }
      });
    }
    throw new Error('unexpected deploy status request: ' + address);
  });
  check('Cloudflare deployment status combines deployments and versions without changing its output shape',
    statusCalls.length === 2 &&
    statusOutput.includes('Cloudflare 部署状态 (mcp-memory)') &&
    statusOutput.includes('deploy-1') &&
    statusOutput.includes('#17 [version-') &&
    headersSeen.every(h => h?.Authorization === 'Bearer cf-token'));

  const detailCalls = [];
  const detailOutput = await handleCloudflareTool('cloudflare_deploy_logs', {
    account_id: 'account-1',
    worker_name: 'mcp-memory',
    deployment_id: 'deploy-full-id'
  }, { CLOUDFLARE_API_TOKEN: 'cf-token' }, async (url, options = {}) => {
    detailCalls.push(String(url));
    return jsonResponseMock({
      result: {
        id: 'deploy-full-id',
        created_on: '2026-11-04T05:00:00Z',
        source: 'git',
        trigger: { type: 'push' },
        status: { success: true },
        metadata: { commit_hash: 'abc123' },
        error: null,
        author_email: 'ziven@example.test'
      }
    });
  });
  check('Cloudflare deployment detail preserves the requested ID and structured metadata',
    detailCalls.length === 1 &&
    detailCalls[0].endsWith('/deployments/deploy-full-id') &&
    detailOutput.includes('deploy-full-id') &&
    detailOutput.includes('abc123') &&
    detailOutput.includes('ziven@example.test'));

  const buildCalls = [];
  const buildOutput = await handleCloudflareTool('cloudflare_build_logs', {
    account_id: 'account-1',
    worker_name: 'mcp-memory',
    limit: 2
  }, { CLOUDFLARE_API_TOKEN: 'cf-token' }, async (url, options = {}) => {
    const address = String(url);
    buildCalls.push(address);
    if (address.endsWith('/workers/scripts')) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ result: [{ id: 'mcp-memory', tag: 'worker-tag-1' }] })
      };
    }
    if (address.endsWith('/builds/workers/worker-tag-1/builds?per_page=2')) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          result: [{ build_uuid: 'build-uuid-1', status: 'failure', branch: 'dev', created_at: '2026-11-04T05:01:00Z' }]
        })
      };
    }
    if (address.endsWith('/builds/builds/build-uuid-1/logs')) {
      return jsonResponseMock({ result: 'SyntaxError: unexpected token' });
    }
    throw new Error('unexpected build log request: ' + address);
  });
  check('Cloudflare build log service resolves Worker tag, build UUID and log tail',
    buildCalls.length === 3 &&
    buildOutput.includes('build-uuid-1') &&
    buildOutput.includes('status=failure') &&
    buildOutput.includes('SyntaxError: unexpected token'));

  const verifyCalls = [];
  const verified = await handleCloudflareTool('cloudflare_deploy_status', {
    account_id: 'account-1',
    worker_name: 'mcp-memory',
    verify_main: true,
    repo: 'wovowx/mcp-memory'
  }, {
    CLOUDFLARE_API_TOKEN: 'cf-token',
    GITHUB_TOKEN: 'gh-token'
  }, async (url, options = {}) => {
    const address = String(url);
    verifyCalls.push(address);
    if (address.endsWith('/workers/scripts/mcp-memory/deployments')) {
      return jsonResponseMock({
        result: { deployments: [{ id: 'deploy-123456789', created_on: '2026-11-04T05:02:00Z', source: 'git' }] }
      });
    }
    if (address.endsWith('/workers/scripts/mcp-memory/versions?per_page=5')) {
      return jsonResponseMock({ result: { items: [] } });
    }
    if (address.endsWith('/repos/wovowx/mcp-memory/commits/main')) {
      return jsonResponseMock({
        sha: 'main-sha-123',
        commit: { committer: { date: '2026-11-04T05:01:00Z' } }
      });
    }
    throw new Error('unexpected verify_main request: ' + address);
  });
  check('verify_main remains in the Cloudflare service and compares the latest deployment with GitHub main',
    verifyCalls.length === 3 &&
    verified.includes('main HEAD: main-sha-123') &&
    verified.includes('status: VERIFIED'));

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const address = String(url);
    if (address.endsWith('/workers/scripts/mcp-memory/deployments')) {
      return jsonResponseMock({
        result: { deployments: [{ id: 'facade-deploy-1', created_on: '2026-11-04T05:02:00Z', source: 'git' }] }
      });
    }
    if (address.endsWith('/workers/scripts/mcp-memory/versions?per_page=5')) {
      return jsonResponseMock({ result: { items: [] } });
    }
    throw new Error('unexpected facade Cloudflare request: ' + address);
  };
  try {
    const facadeOutput = await handleGitHubTool('cloudflare_deploy_status', {
      account_id: 'account-1'
    }, {
      GITHUB_TOKEN: 'gh-token',
      GITHUB_REPO: 'wovowx/mcp-memory',
      CLOUDFLARE_API_TOKEN: 'cf-token'
    });
    check('github_v64 keeps the existing Cloudflare tool names and delegates through its facade',
      facadeOutput.includes('Cloudflare 部署状态 (mcp-memory)') &&
      facadeOutput.includes('facade-d'));
  } finally {
    globalThis.fetch = originalFetch;
  }
}

// ---------- Shared response contract ----------
console.log('\n[Shared response helper contract]');
for (const status of [400, 401, 404, 500]) {
  const actual = buildErrorResponse('test error', status);
  const expected = jsonResponse({ error: 'test error' }, status);
  const actualBody = await actual.json();
  const expectedBody = await expected.json();
  check(
    `buildErrorResponse reuses the JSON response contract (status ${status})`,
    actual.status === expected.status &&
      actual.headers.get('content-type') === expected.headers.get('content-type') &&
      actual.headers.get('access-control-allow-origin') === expected.headers.get('access-control-allow-origin') &&
      JSON.stringify(actualBody) === JSON.stringify(expectedBody)
  );
}
console.log('\n[Isolated DDL parser module contract]');
const parsedColumns = parseColumnDefinitions("amount numeric(10,2) DEFAULT 12.34, display_name text DEFAULT 'O''Reilly, Jr.', aliases uuid[]");
check('isolated DDL identifier validator safely quotes table names',
  quoteDdlIdentifier('mock_probe', '表名') === '"mock_probe"');
let tableIdentifierRejected = false;
try { quoteDdlIdentifier('mock_probe; DROP TABLE memories', '表名'); } catch { tableIdentifierRejected = true; }
check('isolated DDL identifier validator rejects injected table names', tableIdentifierRejected);
const expectedDisplayName = `"display_name" text DEFAULT E'O''Reilly, Jr.'`;
check('isolated DDL parser returns validated SQL fragments',
  parsedColumns.length === 3 &&
  parsedColumns[0] === '"amount" numeric(10,2) DEFAULT 12.34' &&
  parsedColumns[1] === expectedDisplayName &&
  parsedColumns[2] === '"aliases" uuid[]');
let ddlRejected = false;
try { parseColumnDefinitions('id uuid); DROP TABLE memories; --'); } catch { ddlRejected = true; }
check('isolated DDL parser rejects injected multi-statement input', ddlRejected);
ddlRejected = false;
try { parseColumnDefinitions('id uuid, id text'); } catch { ddlRejected = true; }
check('isolated DDL parser rejects duplicate column names', ddlRejected);

const defaultErrorResponse = buildErrorResponse('default status');
check('buildErrorResponse keeps the default 400 status', defaultErrorResponse.status === 400);
check('buildErrorResponse keeps the { error } body', JSON.stringify(await defaultErrorResponse.json()) === JSON.stringify({ error: 'default status' }));

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

  // github_push must only fetch public content from the exact configured Supabase origin.
  const previousPushFetch = globalThis.fetch;
  let pushFetchCalls = 0, uploadFetchCount = 0, fileExistenceChecks = 0, observedRedirect = '', observedPathUrl = '';
  globalThis.fetch = async (url, opts = {}) => {
    pushFetchCalls++;
    const s = String(url), method = (opts.method || 'GET').toUpperCase();
    if (s.includes('/contents/src/a.txt?ref=dev') && method === 'GET') {
      return { ok: true, status: 200, json: async () => ({ type: 'file', name: 'a.txt', sha: 'mock-old-sha', size: 1 }) };
    }
    if (s.includes('/contents/?ref=dev') && method === 'GET') {
      return { ok: true, status: 200, json: async () => [{ type: 'file', name: 'demo.txt' }] };
    }
    if (s.includes('/contents/src/a%20b/c%23d.js?ref=dev') && method === 'GET') {
      observedPathUrl = s;
      return { ok: false, status: 404, json: async () => ({ message: 'mock path read' }) };
    }
    if (s.includes('/storage/v1/object/public/files/demo.txt')) {
      uploadFetchCount++; observedRedirect = opts.redirect || '';
      const bytes = new TextEncoder().encode('hello');
      return { ok: true, status: 200, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
    }
    if (s.includes('/contents/demo.txt?ref=dev') && method === 'GET') {
      fileExistenceChecks++;
      return fileExistenceChecks === 1
        ? { ok: false, status: 404, json: async () => ({ message: 'not found' }) }
        : { ok: true, status: 200, json: async () => ({ size: 5 }) };
    }
    if (s.endsWith('/contents/demo.txt') && method === 'PUT') return { ok: true, status: 201, json: async () => ({ content: { html_url: 'https://github.com/wovowx/mcp-memory/blob/dev/demo.txt' } }) };
    throw new Error('unexpected github_push mock fetch: ' + method + ' ' + s);
  };
  const pushEnv = { GITHUB_TOKEN: 'mock-gh-token', GITHUB_REPO: 'wovowx/mcp-memory', SUPABASE_URL: 'https://mock.supabase.co' };
  try {
    let pushResult = await handleGitHubTool('github_push', { path: 'demo.txt', branch: 'dev', content_url: 'https://another-project.supabase.co/storage/v1/object/public/files/demo.txt' }, pushEnv);
    const invalidPathCalls = [
      ['github_push', { path: '../outside.txt', branch: 'dev', content_url: 'https://mock.supabase.co/storage/v1/object/public/files/demo.txt' }],
      ['github_push', { path: '   ', branch: 'dev', content_url: 'https://mock.supabase.co/storage/v1/object/public/files/demo.txt' }],
      ['github_read', { path: '../outside.txt', branch: 'dev' }],
      ['github_list', { path: 'src/../../outside', branch: 'dev' }],
      ['github_delete', { path: '../outside.txt', branch: 'dev' }],
      ['github_edit', { path: '../outside.txt', branch: 'dev', operations: [{ old: 'a', new: 'b' }] }],
      ['github_copy', { source_repo: 'wovowx/mcp-memory', source_path: '../outside.txt', target_repo: 'wovowx/mcp-memory', target_path: 'copy.txt' }],
      ['github_copy', { source_repo: 'wovowx/mcp-memory', source_path: ' src/a.txt ', target_repo: 'wovowx/mcp-memory', target_path: 'copy.txt' }],
      ['github_copy', { source_repo: 'wovowx/mcp-memory', source_path: 'src/a.txt', target_repo: 'wovowx/mcp-memory', target_path: 'src/../../outside.txt' }],
      ['github_move', { source_repo: 'wovowx/mcp-memory', source_path: '../outside.txt', target_repo: 'wovowx/mcp-memory', target_path: 'moved.txt' }],
      ['github_move', { source_repo: 'wovowx/mcp-memory', source_path: '   ', target_repo: 'wovowx/mcp-memory', target_path: 'moved.txt' }],
      ['github_move', { source_repo: 'wovowx/mcp-memory', source_path: ' src/a.txt ', target_repo: 'wovowx/mcp-memory', target_path: 'moved.txt' }],
      ['github_move', { source_repo: 'wovowx/mcp-memory', source_path: 'src/a.txt', target_repo: 'wovowx/mcp-memory', target_path: 'src/../../outside.txt' }]
    ];
    for (const [toolName, args] of invalidPathCalls) {
      const before = pushFetchCalls;
      const rejected = await handleGitHubTool(toolName, args, pushEnv);
      check(toolName + ' rejects traversal path before any request', rejected.includes('INVALID_REPO_PATH') && pushFetchCalls === before);
    }
    check('github_push rejects a different Supabase project before fetching', pushResult.includes('exact configured SUPABASE_URL origin') && pushFetchCalls === 0);
    const readBefore = pushFetchCalls;
    await handleGitHubTool('github_read', { path: 'src/a b/c#d.js', branch: 'dev' }, pushEnv);
    check('github_read encodes reserved path characters by segment', observedPathUrl.includes('/contents/src/a%20b/c%23d.js?ref=dev') && pushFetchCalls === readBefore + 1);
    pushFetchCalls = 0;
    const rootList = await handleGitHubTool('github_list', { path: '', branch: 'dev' }, pushEnv);
    check('github_list still supports root directory listing', rootList.includes('Directory: (root)') && rootList.includes('[FILE] demo.txt'));
    pushFetchCalls = 0;
    const sameMove = await handleGitHubTool('github_move', { source_repo: 'wovowx/mcp-memory', source_branch: 'dev', source_path: 'src/a.txt', target_repo: 'wovowx/mcp-memory', target_branch: 'dev', target_path: 'src/a.txt', overwrite: true }, pushEnv);
    check('github_move refuses identical same-branch source/target before copy or delete', sameMove.includes('SOURCE_TARGET_IDENTICAL') && pushFetchCalls === 1);
    pushFetchCalls = 0;
    const sameCopy = await handleGitHubTool('github_copy', { source_repo: 'wovowx/mcp-memory', source_branch: 'dev', source_path: 'src/a.txt', target_repo: 'wovowx/mcp-memory', target_branch: 'dev', target_path: 'src/a.txt', overwrite: true }, pushEnv);
    check('github_copy refuses identical source/target before any request', sameCopy.includes('SOURCE_IS_TARGET') && pushFetchCalls === 0);
    pushFetchCalls = 0;
    pushResult = await handleGitHubTool('github_push', { path: 'demo.txt', branch: 'dev', content_url: 'https://mock.supabase.co.evil.example/storage/v1/object/public/files/demo.txt' }, pushEnv);
    check('github_push rejects deceptive Supabase hostname before fetching', pushResult.includes('exact configured SUPABASE_URL origin') && pushFetchCalls === 0);
    pushResult = await handleGitHubTool('github_push', { path: 'demo.txt', branch: 'dev', content_url: 'https://mock.supabase.co/storage/v1/object/public/files/demo.txt' }, pushEnv);
    check('github_push accepts exact configured public-files origin with redirects disabled', pushResult.includes('Verified: true') && uploadFetchCount === 1 && observedRedirect === 'error' && fileExistenceChecks === 2);
  } finally { globalThis.fetch = previousPushFetch; }

  // Patch Engine / release guard contracts.
  check('release policy recognizes the configured repository exactly', detectRepoType('wovowx/mcp-memory').type === 'code');
  check('release policy rejects same-name repository under an unknown owner', detectRepoType('another-owner/mcp-memory').type === 'unknown');
  check('release policy rejects unqualified repository aliases', detectRepoType('mcp-memory').type === 'unknown' && detectRepoType('zivenlab').type === 'unknown');
  check('release guard blocks case-variant main branch', validateRelease({ repo: 'wovowx/mcp-memory', branch: 'MAIN', commitTitle: 'v1.0.0: test', action: 'push' }).allowed === false);
  check('Patch target validator rejects traversal and empty path segments', !validatePatchTargetFile('../outside.txt').ok && !validatePatchTargetFile('src/../../outside.txt').ok && !validateRepoRelativePath('src//file.txt').ok && !validateRepoRelativePath('src/./file.txt').ok);
  check('Patch target validator rejects absolute/backslash/control paths', !validatePatchTargetFile('/root/file.txt').ok && !validatePatchTargetFile('src\\file.txt').ok && !validatePatchTargetFile('src/\u0000file.txt').ok);
  check('shared path validator rejects blank and padded path segments', !validateRepoRelativePath('   ').ok && !validateRepoRelativePath('src/   /file.txt').ok && !validateRepoRelativePath(' src/file.txt').ok);
  check('Patch target validator permits ordinary repository-relative paths', validatePatchTargetFile('src/modules/example.js').ok);
  check('shared repository path helper returns segment-safe encoded paths', validateRepoRelativePath('src/a b/c#d.js').encodedPath === 'src/a%20b/c%23d.js');
  check('Patch validator rejects fractional line numbers', !validatePatch('a\nb', { file: 'f', changes: [{ start_line: 1.5, delete_lines: 0, insert_lines: ['x'] }] }).ok);
  check('Patch validator rejects overlapping changes', !validatePatch('a\nb\nc', { file: 'f', changes: [{ start_line: 1, delete_lines: 2, insert_lines: [] }, { start_line: 2, delete_lines: 1, insert_lines: ['x'] }] }).ok);
  check('Patch validator rejects empty no-op changes', !validatePatch('a\nb', { file: 'f', changes: [{ start_line: 1, delete_lines: 0, insert_lines: [] }] }).ok);
  check('Patch validator rejects multi-line entries and malformed delete snapshots', !validatePatch('a\nb', { file: 'f', changes: [{ start_line: 1, delete_lines: 0, insert_lines: ['x\ny'] }] }).ok && !validatePatch('a\nb', { file: 'f', changes: [{ start_line: 1, delete_lines: 1, insert_lines: [], delete_content: [] }] }).ok);

  check('Patch policy defaults to dev', resolvePatchTargetPolicy('wovowx/mcp-memory', 'dev', { GITHUB_REPO: 'wovowx/mcp-memory' }).ok);
  check('Patch policy blocks main alias refs/heads/main', !resolvePatchTargetPolicy('wovowx/mcp-memory', 'refs/heads/main', { GITHUB_REPO: 'wovowx/mcp-memory', PATCH_ENGINE_ALLOWED_BRANCHES: 'dev,feature/x,refs/heads/main' }).ok);
  check('Patch policy blocks case-variant main branch even if configured', !resolvePatchTargetPolicy('wovowx/mcp-memory', 'MAIN', { GITHUB_REPO: 'wovowx/mcp-memory', PATCH_ENGINE_ALLOWED_BRANCHES: 'dev,MAIN' }).ok);
  check('Patch policy rejects nested refs/heads alias that could resolve to protected refs', !resolvePatchTargetPolicy('wovowx/mcp-memory', 'refs/heads/refs/heads/main', { GITHUB_REPO: 'wovowx/mcp-memory', PATCH_ENGINE_ALLOWED_BRANCHES: 'dev,refs/heads/refs/heads/main' }).ok);
  check('Patch policy rejects repository strings that can alter the API URL', !resolvePatchTargetPolicy('wovowx/mcp-memory?redirect=1', 'dev', { GITHUB_REPO: 'wovowx/mcp-memory?redirect=1' }).ok);
  check('Patch policy rejects unlisted feature branch', !resolvePatchTargetPolicy('wovowx/mcp-memory', 'feature/x', { GITHUB_REPO: 'wovowx/mcp-memory' }).ok);
  check('Patch policy allows explicitly configured feature branch', resolvePatchTargetPolicy('wovowx/mcp-memory', 'feature/x', { GITHUB_REPO: 'wovowx/mcp-memory', PATCH_ENGINE_ALLOWED_BRANCHES: 'dev,feature/x' }).ok);
  check('Patch policy rejects repository outside exact allowlist', !resolvePatchTargetPolicy('other-owner/mcp-memory', 'dev', { GITHUB_REPO: 'wovowx/mcp-memory', GITHUB_ALLOWED_REPOS: 'wovowx/ZivenLab' }).ok);

  let patchFetchCount = 0, patchPutCount = 0, patchAppliedAttempts = 0;
  let patchClaimMode = 'ok', patchAppliedMode = 'ok', patchPutMode = 'ok', patchProposalStatus = 'approved';
  let patchProposalTarget = 'src/mock.txt', patchDiffTarget = 'src/mock.txt';
  const patchEnv = {
    GITHUB_TOKEN: 'mock-gh-token', GITHUB_REPO: 'wovowx/mcp-memory',
    SUPABASE_URL: 'https://mock.supabase.co', SUPABASE_ANON_KEY: 'mock-anon-key'
  };
  const patchMockFetch = async (url, opts = {}) => {
    patchFetchCount++;
    const s = String(url), method = (opts.method || 'GET').toUpperCase();
    if (s.includes('/rest/v1/patch_proposals')) {
      if (method === 'GET') return { ok: true, status: 200, json: async () => [{
        id: 'mock-proposal-id', status: patchProposalStatus, target: patchProposalTarget,
        diff: JSON.stringify({ file: patchDiffTarget, changes: [{ start_line: 2, delete_lines: 1, insert_lines: ['new'] }] })
      }] };
      const body = JSON.parse(opts.body || '{}');
      if (s.includes('status=eq.approved') && body.status === 'applying') {
        if (patchClaimMode === 'empty') return { ok: true, status: 200, json: async () => [] };
        patchProposalStatus = 'applying';
        return { ok: true, status: 200, json: async () => [{ id: 'mock-proposal-id', status: 'applying' }] };
      }
      if (s.includes('status=eq.applying') && body.status === 'applied') {
        patchAppliedAttempts++;
        if (patchAppliedMode === 'http500') return { ok: false, status: 500, json: async () => ({ message: 'mock state failure' }) };
        if (patchAppliedMode === 'empty') return { ok: true, status: 200, json: async () => [] };
        patchProposalStatus = 'applied';
        return { ok: true, status: 200, json: async () => [{ id: 'mock-proposal-id', status: 'applied' }] };
      }
      if (s.includes('status=eq.applying') && body.status === 'approved') {
        patchProposalStatus = 'approved';
        return { ok: true, status: 200, json: async () => [{ id: 'mock-proposal-id', status: 'approved' }] };
      }
      return { ok: false, status: 400, json: async () => ({ message: 'unexpected proposal PATCH' }) };
    }
    if (s.includes('api.github.com/repos/wovowx/mcp-memory/contents/src/mock.txt') && method === 'GET') {
      return { ok: true, status: 200, json: async () => ({ sha: 'oldsha123456789', content: btoa('a\nold\nb') }) };
    }
    if (s.includes('api.github.com/repos/wovowx/mcp-memory/contents/src/mock.txt') && method === 'PUT') {
      patchPutCount++;
      if (patchPutMode === 'missing-sha') return { ok: true, status: 200, json: async () => ({ content: { path: 'src/mock.txt' } }) };
      if (patchPutMode === 'wrong-path') return { ok: true, status: 200, json: async () => ({ content: { path: 'src/elsewhere.txt', sha: 'newsha123456789' } }) };
      return { ok: true, status: 200, json: async () => ({ content: { path: 'src/mock.txt', sha: 'newsha123456789' } }) };
    }
    throw new Error('unexpected Patch Engine mock fetch: ' + method + ' ' + s);
  };
  globalThis.fetch = patchMockFetch;
  const applyPatchMock = (branch = 'dev', extraEnv = {}) => handleGitHubTool('github_apply_patch', { proposal_id: 'mock-proposal-id', branch }, { ...patchEnv, ...extraEnv });
  try {
    patchFetchCount = 0; patchPutCount = 0;
    t = await handleGitHubTool('github_apply_patch', { proposal_id: 'mock-proposal-id', repo: 'other-owner/mcp-memory', branch: 'dev' }, patchEnv);
    check('github_apply_patch rejects unauthorized repository before any network request', t.includes('Repository not allowed') && patchFetchCount === 0 && patchPutCount === 0);

    patchFetchCount = 0; patchPutCount = 0;
    t = await applyPatchMock('main');
    check('github_apply_patch rejects main before any network request', t.includes('MAIN_PROTECTED') && patchFetchCount === 0 && patchPutCount === 0);

    patchFetchCount = 0; patchPutCount = 0;
    t = await applyPatchMock('feature/not-enabled');
    check('github_apply_patch rejects unlisted branch before any network request', t.includes('BRANCH_NOT_ALLOWED') && patchFetchCount === 0 && patchPutCount === 0);

    patchProposalTarget = 'src/approved.txt'; patchDiffTarget = 'src/other.txt';
    patchFetchCount = 0; patchPutCount = 0; patchProposalStatus = 'approved';
    t = await applyPatchMock('dev');
    check('Patch Engine rejects diff target that differs from approved proposal target before GitHub reads/writes', t.includes('PATCH_TARGET_MISMATCH') && patchFetchCount === 1 && patchPutCount === 0);

    patchProposalTarget = '../outside.txt'; patchDiffTarget = '../outside.txt';
    patchFetchCount = 0; patchPutCount = 0; patchProposalStatus = 'approved';
    t = await applyPatchMock('dev');
    check('Patch Engine rejects traversal target before GitHub reads/writes', t.includes('INVALID_TARGET_PATH') && patchFetchCount === 1 && patchPutCount === 0);

    patchProposalTarget = 'src/mock.txt'; patchDiffTarget = 'src/mock.txt';
    patchFetchCount = 0; patchPutCount = 0; patchProposalStatus = 'approved';
    t = await applyPatchMock('feature/authorized', { PATCH_ENGINE_ALLOWED_BRANCHES: 'dev,feature/authorized' });
    check('explicitly authorized feature branch can apply patch', t.includes('status: applied') && patchPutCount === 1 && patchProposalStatus === 'applied');

    patchFetchCount = 0; patchPutCount = 0; patchProposalStatus = 'approved'; patchClaimMode = 'empty';
    t = await applyPatchMock('dev');
    check('lost atomic proposal claim prevents GitHub PUT', t.includes('已被其他执行占用') && patchPutCount === 0);
    patchClaimMode = 'ok';

    patchFetchCount = 0; patchPutCount = 0; patchAppliedAttempts = 0; patchProposalStatus = 'approved'; patchAppliedMode = 'http500';
    t = await applyPatchMock('dev');
    check('status PATCH HTTP failure reports partial success and does not claim applied', t.includes('PARTIAL SUCCESS') && t.includes('不要直接重试') && patchPutCount === 1 && patchProposalStatus === 'applying');
    patchAppliedMode = 'empty';
    patchFetchCount = 0; patchPutCount = 0; patchProposalStatus = 'approved';
    t = await applyPatchMock('dev');
    check('status PATCH zero-row response reports partial success', t.includes('PARTIAL SUCCESS') && patchPutCount === 1 && patchProposalStatus === 'applying');
    patchAppliedMode = 'ok';

    patchPutMode = 'missing-sha';
    patchFetchCount = 0; patchPutCount = 0; patchAppliedAttempts = 0; patchProposalStatus = 'approved';
    t = await applyPatchMock('dev');
    check('Patch Engine keeps proposal applying when successful PUT response lacks content SHA', t.includes('PARTIAL/UNKNOWN') && t.includes('remains applying') && patchPutCount === 1 && patchProposalStatus === 'applying' && patchAppliedAttempts === 0);
    patchPutMode = 'wrong-path';
    patchFetchCount = 0; patchPutCount = 0; patchAppliedAttempts = 0; patchProposalStatus = 'approved';
    t = await applyPatchMock('dev');
    check('Patch Engine refuses to mark applied when PUT response identifies another path', t.includes('PARTIAL/UNKNOWN') && t.includes('src/elsewhere.txt') && patchProposalStatus === 'applying' && patchAppliedAttempts === 0);
    patchPutMode = 'ok';

    patchFetchCount = 0; patchPutCount = 0; patchProposalStatus = 'applied';
    t = await applyPatchMock('dev');
    check('already-applied proposal is rejected before GitHub PUT', t.includes('proposal status=applied') && patchPutCount === 0);
  } finally { globalThis.fetch = origFetch; }

} finally { globalThis.fetch = origFetch; }

console.log('\n[GitHub PR auto-sync contracts] only a merged dev → main PR may move dev');
{
  const originalFetchForMerge = globalThis.fetch;
  const mergeEnv = { GITHUB_TOKEN: 'mock-gh-token', GITHUB_REPO: 'wovowx/mcp-memory' };
  const mainShaForMerge = 'a'.repeat(40);

  async function runMergeScenario({
    handler = 'pr',
    mergeStatus = 200,
    mergePayload = { merged: true },
    prStatus = 200,
    prMetadata = { merged: true, head: { ref: 'dev' }, base: { ref: 'main' } },
    prJsonThrows = false,
    mainRefPayload = { object: { sha: mainShaForMerge } },
    sourceBranch = 'dev'
  } = {}) {
    const calls = [];
    const response = (payload, status = 200) => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => payload
    });
    globalThis.fetch = async (url, options = {}) => {
      const address = String(url);
      const method = (options.method || 'GET').toUpperCase();
      calls.push({ address, method, body: options.body || null });
      if (handler === 'pr') {
        if (address.endsWith('/pulls/42/merge') && method === 'PUT') return response(mergePayload, mergeStatus);
      } else {
        if (address.endsWith('/pulls') && method === 'POST') {
          return response({ number: 43, mergeable: true, mergeable_state: 'clean', html_url: 'https://example.test/pull/43' });
        }
        if (address.endsWith('/pulls/43/merge') && method === 'PUT') return response(mergePayload, mergeStatus);
      }
      const pullNumber = handler === 'pr' ? 42 : 43;
      if (address.endsWith('/pulls/' + pullNumber) && method === 'GET') {
        if (prJsonThrows) return { ok: true, status: 200, json: async () => { throw new Error('mock invalid PR JSON'); } };
        return response(prMetadata, prStatus);
      }
      if (address.endsWith('/git/ref/heads/main') && method === 'GET') return response(mainRefPayload);
      if (address.endsWith('/git/refs/heads/dev') && method === 'PATCH') return response({ ref: 'refs/heads/dev' });
      throw new Error('unexpected merge mock request: ' + method + ' ' + address);
    };
    try {
      const output = handler === 'pr'
        ? await handleGitHubTool('github_merge_pull_request', { pull_number: 42 }, mergeEnv)
        : await handleGitHubTool('github_merge_to_main', { branch: sourceBranch }, mergeEnv);
      return { output, calls };
    } finally {
      globalThis.fetch = originalFetchForMerge;
    }
  }

  const movedToMain = await runMergeScenario();
  const movedCalls = movedToMain.calls;
  const devPatch = movedCalls.find(c => c.method === 'PATCH' && c.address.endsWith('/git/refs/heads/dev'));
  check('merged dev → main PR fetches metadata then syncs dev to main SHA',
    movedToMain.output.includes('dev → main') && !!devPatch &&
    JSON.parse(devPatch.body).sha === mainShaForMerge &&
    JSON.parse(devPatch.body).force === true &&
    movedCalls.findIndex(c => c.address.endsWith('/pulls/42') && c.method === 'GET') < movedCalls.findIndex(c => c.method === 'PATCH'));

  const scoped = await runMergeScenario({
    prMetadata: { merged: true, head: { ref: 'release/v6.36.0' }, base: { ref: 'main' } }
  });
  check('merged scoped release → main PR skips dev ref mutation',
    scoped.output.includes('已跳过 dev 自动同步') && !scoped.calls.some(c => c.method === 'PATCH' && c.address.endsWith('/git/refs/heads/dev')) &&
    !scoped.calls.some(c => c.address.endsWith('/git/ref/heads/main')));

  const otherBase = await runMergeScenario({
    prMetadata: { merged: true, head: { ref: 'dev' }, base: { ref: 'release' } }
  });
  check('merged dev → non-main PR skips dev ref mutation',
    otherBase.output.includes('dev → release') && !otherBase.calls.some(c => c.method === 'PATCH' && c.address.endsWith('/git/refs/heads/dev')));

  const metadataHttpFailure = await runMergeScenario({ prStatus: 503, prMetadata: { message: 'unavailable' } });
  check('PR metadata HTTP failure fails closed before reading main ref or patching dev',
    metadataHttpFailure.output.includes('读取 PR #42 信息失败') &&
    !metadataHttpFailure.calls.some(c => c.address.endsWith('/git/ref/heads/main')) &&
    !metadataHttpFailure.calls.some(c => c.method === 'PATCH'));

  const metadataMissingRefs = await runMergeScenario({
    prMetadata: { merged: true, head: { ref: 'dev' } }
  });
  check('incomplete PR head/base metadata fails closed',
    metadataMissingRefs.output.includes('缺少完整 head/base ref') &&
    !metadataMissingRefs.calls.some(c => c.method === 'PATCH'));

  const metadataNotMerged = await runMergeScenario({
    mergeStatus: 405,
    mergePayload: { message: 'already merged' },
    prMetadata: { merged: false, head: { ref: 'dev' }, base: { ref: 'main' } }
  });
  check('HTTP 405 alone cannot trigger dev sync when PR metadata is not merged',
    metadataNotMerged.output.includes('未能确认 merged=true') &&
    !metadataNotMerged.calls.some(c => c.method === 'PATCH'));

  const metadataInvalidJson = await runMergeScenario({ prJsonThrows: true });
  check('malformed PR metadata response fails closed',
    metadataInvalidJson.output.includes('读取异常') &&
    !metadataInvalidJson.calls.some(c => c.method === 'PATCH'));

  const invalidMainSha = await runMergeScenario({
    mainRefPayload: { object: { sha: 'not-a-commit-sha' } }
  });
  check('invalid main ref SHA prevents dev PATCH',
    invalidMainSha.output.includes('未返回有效 commit SHA') &&
    !invalidMainSha.calls.some(c => c.method === 'PATCH'));

  const alreadyMergedValid = await runMergeScenario({
    mergeStatus: 405,
    mergePayload: { message: 'already merged' }
  });
  check('HTTP 405 already-merged path syncs only after valid merged dev → main metadata',
    alreadyMergedValid.output.includes('dev → main') &&
    alreadyMergedValid.calls.some(c => c.method === 'PATCH' && c.address.endsWith('/git/refs/heads/dev')));

  const mergeToMain = await runMergeScenario({ handler: 'merge_to_main' });
  check('github_merge_to_main uses the same PR head/base guard',
    mergeToMain.output.includes('dev → main') &&
    mergeToMain.calls.some(c => c.method === 'GET' && c.address.endsWith('/pulls/43')) &&
    mergeToMain.calls.some(c => c.method === 'PATCH' && c.address.endsWith('/git/refs/heads/dev')));

  const mergeToScoped = await runMergeScenario({
    handler: 'merge_to_main',
    sourceBranch: 'release/v6.36.0',
    prMetadata: { merged: true, head: { ref: 'release/v6.36.0' }, base: { ref: 'main' } }
  });
  check('github_merge_to_main scoped release path also leaves dev unchanged',
    mergeToScoped.output.includes('已跳过 dev 自动同步') &&
    !mergeToScoped.calls.some(c => c.method === 'PATCH' && c.address.endsWith('/git/refs/heads/dev')));
}

console.log('===== ' + pass + ' 通过 / ' + fail + ' 失败 =====');
process.exit(fail ? 1 : 0);

