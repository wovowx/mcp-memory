// P2 Session Bootstrap contract tests — no real Supabase, GitHub or chatroom access.
import assert from 'node:assert/strict';
import {
    BOOTSTRAP_KEYS, BOOTSTRAP_CONTRACT_VERSION, SESSION_BOOTSTRAP_TOOL,
    parseCheckpoint, buildSessionBootstrap, handleSessionBootstrap,
    SESSION_CONTEXT_TOOL, SESSION_CONTEXT_CONTRACT_VERSION,
    SESSION_CORE_CONTRACT_VERSION, SESSION_CORE_BUDGET_CODE_POINTS,
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
        if (target.pathname.endsWith('/rest/v1/skills')) {
            if (options.failSkills) return { ok: false, status: 503, json: async () => [] };
            return { ok: true, status: 200, json: async () => options.skillRows || [] };
        }
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
    && failedStats.blockers.includes('memory_stats_error'));

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


calls = mockReads();
const discovered = await handleMCPRequest({ jsonrpc: '2.0', id: 11, method: 'tools/list' }, env);
const discoveredContext = discovered.data.result.tools.find(tool => tool.name === 'session_context');
check('tools/list exposes the optional Core flag from the same canonical tool schema',
    discoveredContext?.inputSchema?.properties?.include_core?.type === 'boolean'
    && !discoveredContext.inputSchema.required?.includes('include_core')
    && calls.length === 1 && calls.every(call => call.method === 'GET'));

calls = mockReads();
const invalidCoreFlag = await handleMCPRequest({
    jsonrpc: '2.0', id: 12, method: 'tools/call',
    params: { name: 'session_context', arguments: { include_core: 'true' } }
}, env);
check('dispatch rejects a non-boolean Core opt-in before any memory read',
    invalidCoreFlag.data.result.content[0].text.includes('DISPATCH_GUARD_REJECT')
    && calls.length === 0);

calls = mockReads();
const routedCore = await handleMCPRequest({
    jsonrpc: '2.0', id: 13, method: 'tools/call',
    params: { name: 'session_context', arguments: { host: 'chatgpt', include_core: true } }
}, env);
const routedCoreData = JSON.parse(routedCore.data.result.content[0].text);
check('MCP dispatch returns explicitly requested Core without usage or registry writes',
    routedCoreData.core_contract_version === SESSION_CORE_CONTRACT_VERSION
    && routedCoreData.core.complete === true && calls.length === 6
    && calls.every(call => call.method === 'GET' && !call.url.includes('/rest/v1/skills')));

console.log('\n[Session Context resume-work contracts]');
check('new session context has a separate stable tool and compatible host schema',
    SESSION_CONTEXT_TOOL.name === 'session_context'
    && SESSION_CONTEXT_TOOL.input_schema.properties.host === SESSION_BOOTSTRAP_TOOL.input_schema.properties.host
    && SESSION_CONTEXT_TOOL.input_schema.properties.topic.type === 'string'
    && SESSION_CONTEXT_TOOL.input_schema.properties.include_core.type === 'boolean'
    && !SESSION_CONTEXT_TOOL.input_schema.required?.includes('include_core'));

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
    calls.length === 6 && calls.every(call => call.method === 'GET'
        && call.url.includes('/rest/v1/memories') && !call.url.includes('/skills')));
check('legacy session_context output does not gain unrequested L3 data',
    !Object.hasOwn(context, 'learning_preflight')
    && SESSION_CONTEXT_TOOL.input_schema.properties.learning_task?.properties?.description?.type === 'string'
    && !SESSION_CONTEXT_TOOL.input_schema.properties.learning_task?.required?.includes('description')
    && !SESSION_CONTEXT_TOOL.input_schema.required?.includes('learning_task'));

console.log('\n[Session Context optional L3 preflight contracts]');
const learningTask = { intent: 'create-github-file', entities: ['GitHub'],
    repo: 'wovowx/mcp-memory', branch: 'dev' };
const approvedLesson = {
    status: 'active', test_id: 'synthetic-approved', lesson_key: 'lesson-synthetic',
    reflection: { candidate_id: 'synthetic-approved', validation_state: 'validated',
        source_refs: ['synthetic:test'] },
    application: {
        intent_any: ['create-github-file'], entity_any: ['GitHub'],
        preferred_tool: 'github_create_file', steps: ['check', 'write', 'verify'],
        approval_ref: 'synthetic:approval', allowed_repos: ['wovowx/mcp-memory'],
        allowed_branches: ['dev']
    }
};
const taskArgs = { host: 'chatgpt', available_tools: ['github_create_file'], learning_task: learningTask };
calls = mockReads({ skillRows: [{ enabled: true, handler_config: { learning: approvedLesson } }] });
const advised = await buildSessionContext(env, taskArgs);
check('approved lesson is advised through real session_context without dispatch',
    advised.status === 'READY' && advised.learning_preflight.status === 'READY'
    && advised.learning_preflight.recommended_tool === 'github_create_file'
    && advised.learning_preflight.approval_ref === 'synthetic:approval'
    && advised.learning_preflight.advisory_only === true
    && advised.learning_preflight.executed === false && advised.learning_preflight.host_verified === false
    && advised.learning_preflight.approval_evidence === 'registry_claim_not_independently_verified'
    && calls.length === 7 && calls.every(call => call.method === 'GET'));
check('only existing enabled Skills GET is added and old work data remains intact',
    calls.filter(call => call.url.includes('/rest/v1/skills')).length === 1
    && advised.current_work.next_action === context.current_work.next_action
    && !JSON.stringify(advised).includes('PRIVATE_IDENTITY_MUST_NOT_LEAK'));

calls = mockReads({ skillRows: [{ enabled: true,
    handler_config: { learning: { ...approvedLesson, status: 'candidate' } } }] });
const pendingAdvice = await buildSessionContext(env, taskArgs);
check('registered candidate stays PENDING_REVIEW even if Skill is enabled',
    pendingAdvice.learning_preflight.status === 'PENDING_REVIEW'
    && !pendingAdvice.learning_preflight.recommended_tool && calls.length === 7);

calls = mockReads({ skillRows: [{ handler_config: { learning: {
    ...approvedLesson, application: { ...approvedLesson.application, approval_ref: '' }
} } }] });
check('active label without explicit approval reference cannot guide tools',
    (await buildSessionContext(env, taskArgs)).learning_preflight.status === 'PENDING_REVIEW');

calls = mockReads({ skillRows: [
    { handler_config: { learning: approvedLesson } },
    { handler_config: { learning: { ...approvedLesson, test_id: 'second-active' } } }
] });
check('two active matching routes are CONFLICT, never arbitrarily ranked by usage',
    (await buildSessionContext(env, taskArgs)).learning_preflight.status === 'CONFLICT');

calls = mockReads({ skillRows: [{ handler_config: { learning: approvedLesson } }] });
check('unexposed preferred tool stays UNAVAILABLE rather than assumed callable',
    (await buildSessionContext(env, { ...taskArgs, available_tools: [] }))
        .learning_preflight.status === 'UNAVAILABLE');
check('main stays BLOCKED despite matching approved lesson and advertised capability',
    (await buildSessionContext(env, { ...taskArgs,
        learning_task: { ...learningTask, branch: 'main' } }))
        .learning_preflight.reason === 'main_out_of_scope');

calls = mockReads({ failSkills: true });
const registryUnavailable = await buildSessionContext(env, taskArgs);
check('Skill read failure isolates advisory UNAVAILABLE and preserves READY restoration',
    registryUnavailable.status === 'READY'
    && registryUnavailable.learning_preflight.reason === 'skill_registry_unavailable'
    && registryUnavailable.current_work.next_action === '验证恢复接口'
    && calls.every(call => call.method === 'GET'));

calls = mockReads();
const invalidLearning = await buildSessionContext(env, { ...taskArgs,
    learning_task: { intent: 'create-github-file', repo: 'wovowx/mcp-memory', branch: 'dev' } });
check('malformed learning task is INVALID and does not read Skills',
    invalidLearning.learning_preflight.status === 'INVALID'
    && calls.length === 6);

calls = mockReads({ missingKey: BOOTSTRAP_KEYS.identity });
const blockedLearning = await buildSessionContext(env, taskArgs);
check('missing authoritative identity blocks L3 without even consulting Skills',
    blockedLearning.status === 'BLOCKED'
    && blockedLearning.learning_preflight.reason === 'authority_restoration_blocked'
    && calls.length === 6);

calls = mockReads({ skillRows: [{ handler_config: { learning: approvedLesson } }] });
const routedLearning = await handleMCPRequest({ jsonrpc: '2.0', id: 91,
    method: 'tools/call', params: { name: 'session_context', arguments: taskArgs } }, env);
check('published MCP schema accepts nested learning_task through existing dispatch gate',
    JSON.parse(routedLearning.data.result.content[0].text).learning_preflight?.status === 'READY'
    && calls.every(call => call.method === 'GET'));

console.log('\n[L3 v0.4 natural task text through existing session_context entry]');
const naturalArgs = { ...taskArgs, learning_task: {
    description: '哥哥，帮我在 dev 仓库新建一个配置文件',
    repo: 'wovowx/mcp-memory', branch: 'dev'
} };
calls = mockReads({ skillRows: [{ handler_config: { learning: approvedLesson } }] });
const naturalAdvice = await buildSessionContext(env, naturalArgs);
check('natural-language creation reaches the same reviewed lesson without manual entities',
    naturalAdvice.learning_preflight.status === 'READY'
    && naturalAdvice.learning_preflight.canonical_intent === 'github.file.create'
    && naturalAdvice.learning_preflight.recommended_tool === 'github_create_file'
    && naturalAdvice.learning_preflight.advisory_only
    && !naturalAdvice.learning_preflight.executed && !naturalAdvice.learning_preflight.host_verified
    && calls.length === 7 && calls.every(call => call.method === 'GET'));
calls = mockReads({ skillRows: [{ handler_config: { learning: approvedLesson } }] });
check('natural task and legacy canonical-equivalent intent can coexist',
    (await buildSessionContext(env, { ...naturalArgs, learning_task: {
        ...naturalArgs.learning_task, intent: 'create-github-file'
    } })).learning_preflight.status === 'READY');
calls = mockReads();
check('contradictory structured intent is rejected before registry access',
    (await buildSessionContext(env, { ...naturalArgs, learning_task: {
        ...naturalArgs.learning_task, intent: 'github.file.edit'
    } })).learning_preflight.status === 'AMBIGUOUS' && calls.length === 6);
calls = mockReads({ skillRows: [{ handler_config: { learning: { ...approvedLesson, status: 'candidate' } } }] });
check('natural text cannot activate a pending lesson',
    (await buildSessionContext(env, naturalArgs)).learning_preflight.status === 'PENDING_REVIEW');
calls = mockReads();
const ambiguousText = await buildSessionContext(env, { ...naturalArgs, learning_task: {
    ...naturalArgs.learning_task, description: '在 GitHub 新建并修改一个文件'
} });
check('ambiguous task never reads skills or returns an executable tool',
    ambiguousText.learning_preflight.status === 'AMBIGUOUS' && calls.length === 6
    && !ambiguousText.learning_preflight.recommended_tool);
calls = mockReads();
const informationalText = await buildSessionContext(env, { ...naturalArgs, learning_task: {
    ...naturalArgs.learning_task, description: '如何在 Github 创建文件？'
} });
check('asking a question does not falsely trigger a file write recommendation',
    informationalText.learning_preflight.status === 'NO_MATCH' && calls.length === 6);
calls = mockReads();
const missingScope = await buildSessionContext(env, { ...naturalArgs, learning_task: {
    description: '在 GitHub 新建一个文件'
} });
check('natural task without repo/branch explicitly needs scope and never guesses permission',
    missingScope.learning_preflight.status === 'NEEDS_SCOPE' && calls.length === 6);
calls = mockReads({ missingKey: BOOTSTRAP_KEYS.identity });
check('authoritative recovery BLOCKED outranks natural language classification',
    (await buildSessionContext(env, { ...naturalArgs, learning_task: {
        description: '怎么在 GitHub 新建文件？'
    } })).learning_preflight.reason === 'authority_restoration_blocked' && calls.length === 6);
calls = mockReads({ skillRows: [{ handler_config: { learning: approvedLesson } }] });
check('main branch remains blocked for a natural-language task',
    (await buildSessionContext(env, { ...naturalArgs, learning_task: {
        ...naturalArgs.learning_task, branch: 'main'
    } })).learning_preflight.reason === 'main_out_of_scope');
calls = mockReads({ skillRows: [{ handler_config: { learning: approvedLesson } }] });
const routedNatural = await handleMCPRequest({ jsonrpc: '2.0', id: 92,
    method: 'tools/call', params: { name: 'session_context', arguments: naturalArgs } }, env);
check('MCP dispatch accepts the natural description without a new tool or write',
    JSON.parse(routedNatural.data.result.content[0].text).learning_preflight?.status === 'READY'
    && calls.every(call => call.method === 'GET'));

const relatedRows = Array.from({ length: 4 }, (_, i) => ({
    id: 'related-' + i, key: '项目笔记/' + i, value: '项目笔记已确认 ' + 'X'.repeat(260) + i,
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
    calls.length === 8 && calls.every(call => call.method === 'GET')
    && calls.some(call => call.url.includes('/rest/v1/memory_aliases')));

calls = mockReads({ missingKey: BOOTSTRAP_KEYS.identity });
const contextBlocked = await buildSessionContext(env, { topic: '项目笔记' });
check('missing identity blocks context before optional retrieval',
    contextBlocked.status === 'BLOCKED' && contextBlocked.current_work === null
    && contextBlocked.related_memories.length === 0 && calls.length === 6);

calls = mockReads();
const singleSnapshot = await buildSessionContext(env);
const checkpointReads = calls.filter(call => call.url.includes('key=eq.' + encodeURIComponent(BOOTSTRAP_KEYS.checkpoint)));
check('context reuses the bootstrap checkpoint snapshot without a second read window',
    singleSnapshot.status === 'READY' && checkpointReads.length === 1 && calls.length === 6);

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
const noMatchesContext = await buildSessionContext(env, { topic: 'needle-not-in-memory' });
check('successful topic search with no matches is distinct from source failure',
    noMatchesContext.status === 'READY' && noMatchesContext.related_status === 'no_matches'
    && noMatchesContext.related_sources?.memories?.status === 'ok'
    && noMatchesContext.related_sources?.aliases?.status === 'ok');

calls = mockReads({ failMemorySearch: true });
const memoryUnavailable = await buildSessionContext(env, { topic: '项目笔记' });
check('required topic memory-source failure degrades context as unavailable',
    memoryUnavailable.status === 'DEGRADED' && memoryUnavailable.related_status === 'unavailable'
    && memoryUnavailable.related_sources?.memories?.error_code === 'http_error'
    && memoryUnavailable.related_memories.length === 0);

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
    && calls.length === 6 && calls.every(call => call.method === 'GET'));
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


console.log('\n[Session Core v0.2 contracts]');
calls = mockReads();
const coreContext = await buildSessionContext(env, { host: 'chatgpt', include_core: true });
const coreBlocks = coreContext.core.blocks;
check('explicit Core opt-in returns all five complete canonical source blocks',
    coreContext.status === 'READY' && coreContext.core_contract_version === SESSION_CORE_CONTRACT_VERSION
    && coreContext.core.contract_version === SESSION_CORE_CONTRACT_VERSION
    && coreContext.core.status === 'READY' && coreContext.core.complete === true
    && coreContext.core.critical_complete === true
    && Object.values(coreBlocks).every(block => block.complete && typeof block.content === 'string'));
check('Core blocks carry exact source key, version, update time and full-record scope',
    coreBlocks.identity.source_key === BOOTSTRAP_KEYS.identity
    && coreBlocks.identity.source_version === 4
    && coreBlocks.identity.source_updated_at === allRecords[BOOTSTRAP_KEYS.identity].updated_at
    && coreBlocks.profile.content === sourceValues.profile
    && coreBlocks.navigation.content === sourceValues.navigation
    && coreBlocks.protocol.content === sourceValues.protocol
    && coreBlocks.identity.scope === 'full_record');
check('Core checkpoint contains the complete current overlay but excludes preserved history',
    coreBlocks.checkpoint.scope === 'current_overlay'
    && coreBlocks.checkpoint.content === currentText.split(/\n---\s*(?:旧工作检查点|以下为历史|以下为旧|历史检查点)/)[0]
    && !coreBlocks.checkpoint.content.includes('OLD_STATE'));
check('Core uses one GET per exact source plus one stats read and performs no writes',
    calls.length === 6 && calls.every(call => call.method === 'GET')
    && Object.values(BOOTSTRAP_KEYS).every(key =>
        calls.filter(call => call.url.includes('key=eq.' + encodeURIComponent(key))).length === 1));
const expectedCorePoints = Object.values(coreBlocks).reduce((sum, block) =>
    sum + (block.complete ? Array.from(block.content).length : 0), 0);
check('Core budget counts Unicode code points and preserves complete source blocks',
    coreContext.core.budget.unit === 'unicode_code_points'
    && coreContext.core.budget.limit_code_points === SESSION_CORE_BUDGET_CODE_POINTS
    && coreContext.core.budget.source_content_code_points === expectedCorePoints
    && coreContext.core.budget.used_code_points === expectedCorePoints
    && coreContext.core.budget.remaining_code_points === SESSION_CORE_BUDGET_CODE_POINTS - expectedCorePoints);
const serializedCoreBytes = Buffer.byteLength(JSON.stringify(coreContext), 'utf8');
check('final serialized Core response size is measured separately and stays bounded',
    serializedCoreBytes > 0 && serializedCoreBytes < 256 * 1024);

calls = mockReads();
const defaultCoreOff = await buildSessionContext(env);
check('legacy context calls do not return Core contract or private full source text',
    !Object.hasOwn(defaultCoreOff, 'core') && !Object.hasOwn(defaultCoreOff, 'core_contract_version')
    && !JSON.stringify(defaultCoreOff).includes('PRIVATE_IDENTITY_MUST_NOT_LEAK')
    && !JSON.stringify(defaultCoreOff).includes('PRIVATE_PROFILE_MUST_NOT_LEAK'));

const unicodeIdentity = '👩‍💻A中';
calls = mockReads({ overrides: { [BOOTSTRAP_KEYS.identity]: {
    ...allRecords[BOOTSTRAP_KEYS.identity], value: unicodeIdentity
} } });
const unicodeCore = await buildSessionContext(env, { include_core: true });
check('Unicode code-point budget does not confuse surrogate-pair string length',
    unicodeCore.core.blocks.identity.content_code_points === Array.from(unicodeIdentity).length
    && unicodeCore.core.budget.source_content_code_points ===
        Object.values(unicodeCore.core.blocks).reduce((sum, block) =>
            sum + (block.complete ? Array.from(block.content).length : 0), 0));

const longCurrentCheckpoint = [
    '【long current checkpoint】',
    'workflow_state: CORE_LONG_CHECKPOINT',
    'active_focus: preserve the current work focus',
    'next_action: verify the full current overlay',
    'decision: keep the approved boundary',
    'evidence: synthetic long checkpoint fixture',
    '正文'.repeat(3600),
    '- do_not_repeat: 不得推 main；不得写数据库；必须保留完整末尾限制',
    '--- 旧工作检查点（仅历史） ---',
    'workflow_state: HISTORICAL_MUST_NOT_LOAD'
].join('\n');
calls = mockReads({ overrides: { [BOOTSTRAP_KEYS.checkpoint]: {
    ...allRecords[BOOTSTRAP_KEYS.checkpoint], value: longCurrentCheckpoint
} } });
const longCheckpointCore = await buildSessionContext(env, { include_core: true });
check('long current checkpoint is not truncated before trailing do_not_repeat boundaries',
    longCheckpointCore.core.blocks.checkpoint.complete
    && longCheckpointCore.core.blocks.checkpoint.content.includes('不得推 main')
    && !longCheckpointCore.core.blocks.checkpoint.content.includes('HISTORICAL_MUST_NOT_LOAD')
    && parseCheckpoint(longCurrentCheckpoint).do_not_repeat.includes('不得推 main'));

calls = mockReads({ overrides: {
    [BOOTSTRAP_KEYS.identity]: { ...allRecords[BOOTSTRAP_KEYS.identity], value: 'I'.repeat(23900) }
} });
const budgetLimited = await buildSessionContext(env, { include_core: true });
check('budget overflow omits whole lower-priority blocks and prevents dependent action',
    budgetLimited.core.status === 'DEGRADED' && budgetLimited.core.complete === false
    && budgetLimited.core.blocks.identity.complete === true
    && budgetLimited.core.blocks.checkpoint.complete === false
    && budgetLimited.core.blocks.checkpoint.omitted_reason === 'budget_exceeded'
    && budgetLimited.core.blocks.profile.omitted_reason === 'higher_priority_block_did_not_fit'
    && budgetLimited.permissions.permitted_next_step === 'read_only_recovery');

calls = mockReads({ missingKey: BOOTSTRAP_KEYS.profile });
const missingProfileCore = await buildSessionContext(env, { include_core: true });
check('missing optional profile source is explicit DEGRADED, not fabricated',
    missingProfileCore.status === 'DEGRADED' && missingProfileCore.core.status === 'DEGRADED'
    && missingProfileCore.core.blocks.profile.complete === false
    && missingProfileCore.core.blocks.profile.omitted_reason === 'source_missing'
    && missingProfileCore.core.blocks.identity.complete && missingProfileCore.core.blocks.checkpoint.complete);

calls = mockReads({ missingKey: BOOTSTRAP_KEYS.identity });
const missingIdentityCore = await buildSessionContext(env, { include_core: true });
check('missing critical identity source blocks Core and keeps recovery read-only',
    missingIdentityCore.status === 'BLOCKED' && missingIdentityCore.core.status === 'BLOCKED'
    && missingIdentityCore.core.blocks.identity.omitted_reason === 'source_missing'
    && missingIdentityCore.permissions.permitted_next_step === 'read_only_recovery');

calls = mockReads({ overrides: { [BOOTSTRAP_KEYS.checkpoint]: {
    ...allRecords[BOOTSTRAP_KEYS.checkpoint], value: '--- 旧工作检查点（仅历史） ---\nworkflow_state: HISTORICAL_ONLY'
} } });
const emptyCurrentCheckpoint = await buildSessionContext(env, { include_core: true });
check('empty current checkpoint overlay is BLOCKED rather than replaced by history',
    emptyCurrentCheckpoint.status === 'BLOCKED'
    && emptyCurrentCheckpoint.core.blocks.checkpoint.omitted_reason === 'empty_current_overlay');

calls = mockReads({ relatedRows });
const topicCore = await buildSessionContext(env, { topic: '项目笔记', include_core: true });
check('optional topic results are appended after Core and charged to remaining code-point budget',
    topicCore.related_status === 'matched_best_effort'
    && topicCore.related_memories.length === 3
    && topicCore.core.budget.topic_results_included === 3
    && topicCore.core.budget.topic_results_code_points ===
        topicCore.related_memories.reduce((sum, hit) => sum + Array.from(hit.excerpt.text || '').length, 0)
    && topicCore.core.budget.used_code_points ===
        topicCore.core.budget.source_content_code_points + topicCore.core.budget.topic_results_code_points);

calls = mockReads({ relatedRows, overrides: {
    [BOOTSTRAP_KEYS.identity]: { ...allRecords[BOOTSTRAP_KEYS.identity], value: 'I'.repeat(23900) }
} });
const topicBudgetOmitted = await buildSessionContext(env, { topic: '项目笔记', include_core: true });
check('topic results are omitted rather than displacing higher-priority Core blocks',
    topicBudgetOmitted.related_status === 'budget_omitted'
    && topicBudgetOmitted.related_memories.length === 0
    && topicBudgetOmitted.core.budget.topic_results_omitted === 3
    && topicBudgetOmitted.core.blocks.identity.complete === true);


console.log('\nP2 Session Bootstrap + Session Context + Core contracts: ' + passed + ' passed, 0 failed.');

