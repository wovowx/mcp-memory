// P2 Session Bootstrap contract tests — no real Supabase, GitHub or chatroom access.
import assert from 'node:assert/strict';
import {
    BOOTSTRAP_KEYS, BOOTSTRAP_CONTRACT_VERSION, SESSION_BOOTSTRAP_TOOL,
    parseCheckpoint, buildSessionBootstrap, handleSessionBootstrap
} from '../src/modules/session/bootstrap.js';
import { handleMCPRequest } from '../src/modules/mcp_router.js';

const env = { SUPABASE_URL: 'https://mock.supabase.co', SUPABASE_ANON_KEY: 'mock-read-key' };
let passed = 0;
function check(label, condition) {
    assert.ok(condition, label);
    passed++;
    console.log('  ✅ ' + label);
}
const currentText = '【2026-11-05 latest】\n- active_focus: P2跨宿主恢复\n- **workflow_state=P2_BOOTSTRAP_IMPLEMENTING**。next_action：落实合同测试\n- next_action: 验证恢复接口\n--- 旧工作检查点（仅历史） ---\n- workflow_state=OLD_STATE\n- next_action: 不应使用历史任务';
const sourceValues = {
    identity: 'PRIVATE_IDENTITY_MUST_NOT_LEAK',
    profile: 'PRIVATE_PROFILE_MUST_NOT_LEAK',
    navigation: '导航：唯一云端源',
    checkpoint: currentText,
    protocol: '# Session Bootstrap SB-1.0'
};
const allRecords = Object.fromEntries(Object.entries(BOOTSTRAP_KEYS).map(([name, key]) => [
    key, { id: 'memory-' + name, key, category: name, value: sourceValues[name],
        status: 'active', valid_to: null, version: 4, updated_at: '2026-11-05T05:20:00Z' }
]));

function mockReads(options = {}) {
    const calls = [];
    globalThis.fetch = async (url, init = {}) => {
        const target = new URL(String(url));
        const method = init.method || 'GET';
        calls.push({ url: String(url), method });
        if (method !== 'GET') throw new Error('unexpected write ' + method);
        if (target.pathname.endsWith('/rest/v1/memories')) {
            const requested = target.searchParams.get('key');
            if (requested !== null) {
                const key = requested.startsWith('eq.') ? requested.slice(3) : requested;
                if (options.errorKey === key) throw new Error('mock failure');
                if (options.missingKey === key) return { ok: true, status: 200, json: async () => [] };
                const row = allRecords[key];
                const overridden = options.overrides?.[key] || row;
                return { ok: true, status: 200, json: async () => overridden ? [overridden] : [] };
            }
            if (options.failStats) return { ok: false, status: 503, json: async () => ({ message: 'unavailable' }) };
            return { ok: true, status: 200, json: async () => Object.values(allRecords) };
        }
        throw new Error('unexpected endpoint: ' + target.pathname);
    };
    return calls;
}

console.log('\n[P2 source and checkpoint contracts]');
const parsed = parseCheckpoint(currentText);
check('current overlay wins over retained historical snapshots',
    parsed.workflow_state === 'P2_BOOTSTRAP_IMPLEMENTING'
    && parsed.next_action?.startsWith('验证恢复接口')
    && !parsed.excerpt.includes('OLD_STATE'));
check('P2 new tool carries stable MCP name and schema',
    SESSION_BOOTSTRAP_TOOL.name === 'session_bootstrap'
    && SESSION_BOOTSTRAP_TOOL.input_schema.properties.host.type === 'string');

let calls = mockReads();
const ready = await buildSessionBootstrap(env, {
    host: 'chatgpt', invocation: 'explicit',
    available_tools: ['memory', 'session_bootstrap']
});
check('all authoritative current sources and current memory stats give READY',
    ready.status === 'READY' && ready.restored === true && ready.contract_version === BOOTSTRAP_CONTRACT_VERSION
    && Object.values(ready.sources).every(s => s.status === 'ok')
    && ready.memory_stats.total === 5 && ready.memory_stats.category_count === 5);
check('explicit checkpoint phase and next action are recovered',
    ready.current_work.workflow_state === 'P2_BOOTSTRAP_IMPLEMENTING'
    && ready.current_work.next_action?.includes('验证恢复接口'));
check('bootstrap never grants code, merge, deployment or DB permissions',
    ready.permissions.granted_by_bootstrap === false && ready.permissions.permitted_next_step === 'verify_scope_and_approval');
check('private identity and profile contents are not emitted',
    !JSON.stringify(ready).includes('PRIVATE_IDENTITY_MUST_NOT_LEAK')
    && !JSON.stringify(ready).includes('PRIVATE_PROFILE_MUST_NOT_LEAK'));
check('bootstrap uses GET-only Memory Core reads and never probes tools/list or skills registry',
    calls.length === 6 && calls.every(call => call.method === 'GET'
    && call.url.includes('/rest/v1/memories') && !call.url.includes('/rest/v1/skills')));
check('host advertised tools do not become verified startup hooks',
    ready.host.name === 'chatgpt' && ready.host.startup_hook_verified === false
    && ready.host.capability_evidence === 'host_reported_not_tested');

calls = mockReads({ missingKey: BOOTSTRAP_KEYS.identity });
const missingIdentity = await buildSessionBootstrap(env);
check('missing identity root forces BLOCKED', missingIdentity.status === 'BLOCKED'
    && missingIdentity.blockers.includes('identity_missing'));

calls = mockReads({ missingKey: BOOTSTRAP_KEYS.checkpoint });
const missingCheckpoint = await buildSessionBootstrap(env);
check('missing unique checkpoint cannot be replaced by other memories', missingCheckpoint.status === 'BLOCKED'
    && missingCheckpoint.current_work === null);

calls = mockReads({ failStats: true });
const failedStats = await buildSessionBootstrap(env);
check('failed current memory stats forces BLOCKED', failedStats.status === 'BLOCKED'
    && failedStats.blockers.includes('memory_stats_invalid'));

calls = mockReads({ missingKey: BOOTSTRAP_KEYS.navigation });
const noNavigation = await buildSessionBootstrap(env);
check('optional navigation absence gives DEGRADED, never false READY',
    noNavigation.status === 'DEGRADED' && noNavigation.warnings.includes('navigation_missing'));

calls = mockReads({ overrides: { [BOOTSTRAP_KEYS.checkpoint]: {
    ...allRecords[BOOTSTRAP_KEYS.checkpoint], key: '当前工作检查点'
} } });
const falseKey = await buildSessionBootstrap(env);
check('same-title but wrong canonical key is rejected',
    falseKey.status === 'BLOCKED' && falseKey.sources.checkpoint.error === 'non_authoritative_record');

calls = mockReads({ overrides: { [BOOTSTRAP_KEYS.checkpoint]: {
    ...allRecords[BOOTSTRAP_KEYS.checkpoint], value: '没有 workflow_state 和 next_action 的有效字段'
} } });
const missingFields = await buildSessionBootstrap(env);
check('incomplete current checkpoint is not treated as fully restored',
    missingFields.status === 'DEGRADED' && missingFields.warnings.includes('checkpoint_fields_incomplete'));

calls = mockReads({ errorKey: BOOTSTRAP_KEYS.protocol });
const brokenProtocol = await buildSessionBootstrap(env);
check('protocol read exception is reported without inventing success',
    brokenProtocol.status === 'DEGRADED' && brokenProtocol.sources.protocol.status === 'error');

console.log('\n[P2 MCP facade and host adapter contract]');
calls = mockReads();
const wrapped = await handleSessionBootstrap('session_bootstrap', { host: 'operit' }, env);
check('scenario facade returns stable JSON evidence', JSON.parse(wrapped).status === 'READY');
const routed = await handleMCPRequest({
    jsonrpc: '2.0', id: 7, method: 'tools/call',
    params: { name: 'session_bootstrap', arguments: { host: 'operit', invocation: 'frame_instruction' } }
}, env);
const routedData = JSON.parse(routed.data.result.content[0].text);
check('MCP dispatch accepts bootstrap without skills registry side effects',
    routedData.status === 'READY' && routedData.host.name === 'operit'
    && routedData.host.startup_hook_verified === false);
check('bootstrap routing excludes automatic usage telemetry and all writes',
    calls.length === 12 && calls.every(call => call.method === 'GET'
        && call.url.includes('/rest/v1/memories')));
calls = mockReads();
const invalidHost = await handleMCPRequest({
    jsonrpc: '2.0', id: 8, method: 'tools/call',
    params: { name: 'session_bootstrap', arguments: { host: 'unrecognized' } }
}, env);
check('existing MCP schema guard rejects invalid host before any reads',
    invalidHost.data.result.content[0].text.includes('DISPATCH_GUARD_REJECT')
    && calls.length === 0);

console.log('\nP2 Session Bootstrap contracts: ' + passed + ' passed, 0 failed.');
