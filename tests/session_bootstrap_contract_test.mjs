// P2 Session Bootstrap contract tests — no real Supabase, GitHub or chatroom access.
import assert from 'node:assert/strict';
import {
    BOOTSTRAP_KEYS, BOOTSTRAP_CONTRACT_VERSION, SESSION_BOOTSTRAP_TOOL,
    parseCheckpoint, buildSessionBootstrap, handleSessionBootstrap,
    SESSION_CONTEXT_TOOL, SESSION_CONTEXT_CONTRACT_VERSION,
    buildSessionContext, handleSessionContext
} from '../src/modules/session/bootstrap.js';
import { handleMCPRequest } from '../src/modules/mcp_router.js';

const env = { SUPABASE_URL: 'https://mock.supabase.co', SUPABASE_ANON_KEY: 'mock-read-key' };
let passed = 0;
function check(label, condition) {
    assert.ok(condition, label);
    passed++;
    console.log('  ✅ ' + label);
}
const currentText = '【2026-11-05 latest】\n- active_focus: P2跨宿主恢复\n- do_not_repeat: 不重复P1审计\n- **workflow_state=P2_BOOTSTRAP_IMPLEMENTING**。next_action：落实合同测试\n- next_action: 验证恢复接口\n- decision: 柳柳同意只读恢复工作流\n- evidence: 依据最新检查点和已批准方案\n--- 旧工作检查点（仅历史） ---\n- workflow_state=OLD_STATE\n- next_action: 不应使用历史任务\n- decision: 旧方案必须执行';
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
    let unkeyedMemoryReads = 0;
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
                if (options.failCheckpointAfterFirst && key === BOOTSTRAP_KEYS.checkpoint &&
                    calls.filter(call => call.url.includes(encodeURIComponent(key))).length > 1) {
                    throw new Error('checkpoint changed midflight');
                }
                if (options.missingKey === key) return { ok: true, status: 200, json: async () => [] };
                const row = allRecords[key];
                const overridden = options.overrides?.[key] || row;
                return { ok: true, status: 200, json: async () => overridden ? [overridden] : [] };
            }
            if (options.failStats) return { ok: false, status: 503, json: async () => ({ message: 'unavailable' }) };
            unkeyedMemoryReads++;
            if (options.failMemorySearch && unkeyedMemoryReads > 1) return { ok: false, status: 503, json: async () => ({ message: 'unavailable' }) };
            return { ok: true, status: 200, json: async () => [...Object.values(allRecords), ...(options.relatedRows || [])] };
        }
        if (target.pathname.endsWith('/rest/v1/memory_aliases')) {
            if (options.failAliases) throw new Error('aliases unavailable');
            return { ok: true, status: 200, json: async () => [] };
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
    && ready.current_work.next_action?.includes('验证恢复接口')
    && ready.current_work.active_focus === 'P2跨宿主恢复'
    && ready.current_work.do_not_repeat === '不重复P1审计');
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

calls = mockReads({ overrides: { [BOOTSTRAP_KEYS.checkpoint]: {
    ...allRecords[BOOTSTRAP_KEYS.checkpoint], updated_at: '2026-01-01T00:00:00Z'
} } });
const stale = await buildSessionBootstrap(env);
check('checkpoint older than 30 days is DEGRADED and cannot claim READY',
    stale.status === 'DEGRADED' && stale.warnings.includes('checkpoint_stale'));

calls = mockReads({ overrides: { [BOOTSTRAP_KEYS.checkpoint]: {
    ...allRecords[BOOTSTRAP_KEYS.checkpoint], updated_at: 'not-an-iso-date'
} } });
const invalidTimestamp = await buildSessionBootstrap(env);
check('unverifiable checkpoint time degrades recovery evidence',
    invalidTimestamp.status === 'DEGRADED' && invalidTimestamp.warnings.includes('checkpoint_timestamp_unverified'));

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

console.log('\n[Session Context resume-work contracts]');
check('new session context has a separate stable tool and compatible host schema',
    SESSION_CONTEXT_TOOL.name === 'session_context'
    && SESSION_CONTEXT_TOOL.input_schema.properties.host === SESSION_BOOTSTRAP_TOOL.input_schema.properties.host
    && SESSION_CONTEXT_TOOL.input_schema.properties.topic.type === 'string');

calls = mockReads();
const context = await buildSessionContext(env, { host: 'chatgpt' });
check('resume-work context reuses canonical checkpoint and bounded confirmed decision',
    context.status === 'READY' && context.contract_version === SESSION_CONTEXT_CONTRACT_VERSION
    && context.current_work.workflow_state === 'P2_BOOTSTRAP_IMPLEMENTING'
    && context.current_work.next_action === '验证恢复接口'
    && context.current_work.source_key === BOOTSTRAP_KEYS.checkpoint
    && context.confirmed_context.decision.text.includes('柳柳同意')
    && !JSON.stringify(context).includes('旧方案必须执行'));
check('without topic no guesses, identity/profile full text or write-capable permissions leak',
    context.related_status === 'not_requested' && context.related_memories.length === 0
    && context.permissions.granted_by_context === false
    && !JSON.stringify(context).includes('PRIVATE_IDENTITY_MUST_NOT_LEAK')
    && !JSON.stringify(context).includes('PRIVATE_PROFILE_MUST_NOT_LEAK'));
check('context without topic is read-only and does not visit registry or tools/list',
    calls.length === 7 && calls.every(call => call.method === 'GET'
        && call.url.includes('/rest/v1/memories') && !call.url.includes('/skills')));

const relatedRows = Array.from({ length: 4 }, (_, i) => ({
    id: 'related-' + i, key: '项目笔记/' + i, value: '项目笔记已确认 ' + i,
    category: '项目笔记', status: 'active', valid_to: null,
    updated_at: '2026-11-05T05:20:00Z', created_at: '2026-11-05T05:20:00Z'
}));
relatedRows.push({
    id: 'expired', key: '项目笔记/旧版', value: '项目笔记已撤销', category: '项目笔记',
    status: 'active', valid_to: '2026-10-31T00:00:00Z'
});
relatedRows.push({
    id: 'revoked', key: '项目笔记/撤销', value: '项目笔记无效', category: '项目笔记',
    status: 'retired', valid_to: null
});
calls = mockReads({ relatedRows });
const relatedContext = await buildSessionContext(env, { topic: '项目笔记' });
check('topic invokes Memory Core and returns at most three currently effective related records',
    relatedContext.status === 'READY' && relatedContext.related_status === 'matched_best_effort'
    && relatedContext.related_memories.length === 3
    && relatedContext.related_memories.every(hit => hit.key.startsWith('项目笔记/')
        && hit.match_reason && hit.source_updated_at));
check('topic path does not use write methods and records source metadata',
    calls.length === 9 && calls.every(call => call.method === 'GET')
    && calls.some(call => call.url.includes('/rest/v1/memory_aliases')));

calls = mockReads({ missingKey: BOOTSTRAP_KEYS.identity });
const contextBlocked = await buildSessionContext(env, { topic: '项目笔记' });
check('missing identity blocks context before optional retrieval',
    contextBlocked.status === 'BLOCKED' && contextBlocked.current_work === null
    && contextBlocked.related_memories.length === 0 && calls.length === 6);

calls = mockReads({ failCheckpointAfterFirst: true });
const checkpointRace = await buildSessionContext(env);
check('checkpoint disappears between source checks and context read: fail closed',
    checkpointRace.status === 'BLOCKED' && checkpointRace.blockers.includes('checkpoint_context_read_failed'));

calls = mockReads({ overrides: { [BOOTSTRAP_KEYS.checkpoint]: {
    ...allRecords[BOOTSTRAP_KEYS.checkpoint], value: '只有普通文本没有任何结构化工作字段'
} } });
const contextIncomplete = await buildSessionContext(env);
check('incomplete checkpoint keeps degraded context status',
    contextIncomplete.status === 'DEGRADED' && contextIncomplete.warnings.includes('context_checkpoint_fields_incomplete'));

calls = mockReads({ overrides: { [BOOTSTRAP_KEYS.checkpoint]: {
    ...allRecords[BOOTSTRAP_KEYS.checkpoint],
    value: currentText.replace('- decision: 柳柳同意只读恢复工作流\n', '')
} } });
const decisionMissing = await buildSessionContext(env);
check('a missing recorded decision cannot be presented as verified READY context',
    decisionMissing.status === 'DEGRADED'
    && decisionMissing.warnings.includes('checkpoint_decision_not_recorded')
    && decisionMissing.confirmed_context.decision.text === null);

calls = mockReads({ failAliases: true });
const relatedUnavailable = await buildSessionContext(env, { topic: '项目笔记' });
check('related retrieval errors degrade the optional context without inventing results',
    relatedUnavailable.status === 'DEGRADED' && relatedUnavailable.related_status === 'partial' &&
    relatedUnavailable.related_sources?.aliases?.error_code === 'network_error');

calls = mockReads();
const tooLong = await buildSessionContext(env, { topic: 'A'.repeat(121) });
check('overlong topic blocked before network reads', tooLong.status === 'BLOCKED'
    && tooLong.errors.includes('topic_too_long') && calls.length === 0);

calls = mockReads();
const routedContext = await handleMCPRequest({
    jsonrpc: '2.0', id: 9, method: 'tools/call',
    params: { name: 'session_context', arguments: { host: 'chatgpt' } }
}, env);
check('session_context facade is registered and routed without registry or usage writes',
    JSON.parse(routedContext.data.result.content[0].text).contract_version === SESSION_CONTEXT_CONTRACT_VERSION
    && calls.length === 7 && calls.every(call => call.method === 'GET'));
check('direct session context facade returns structured JSON',
    JSON.parse(await handleSessionContext('session_context', {}, env)).status === 'READY');

calls = mockReads();
const invalidContextHost = await handleMCPRequest({
    jsonrpc: '2.0', id: 10, method: 'tools/call',
    params: { name: 'session_context', arguments: { host: 'unknown' } }
}, env);
check('new facade rejects invalid host at existing schema guard',
    invalidContextHost.data.result.content[0].text.includes('DISPATCH_GUARD_REJECT')
    && calls.length === 0);

console.log('\nP2 Session Bootstrap + Session Context contracts: ' + passed + ' passed, 0 failed.');
