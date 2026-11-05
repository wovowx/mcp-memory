// Memory core contract regression — repository / lifecycle / retrieval.
import {
    getMemoryByKey, getCurrentMemoryByKey, getAllMemories, getCurrentMemories,
    getMemoryAliasIds, getMemoryEvents, getMemoryHistoryByKey
} from '../src/modules/memory/repository.js';
import { putMemory, deleteMemory, renameMemory, moveMemory } from '../src/modules/memory/lifecycle.js';
import {
    searchMemories, searchMemoriesWithStatus, listMemoryCategories, listMemories, listMemoriesByCategory,
    listMemoriesByDate, getMemoryStats, getRandomMemory
} from '../src/modules/memory/retrieval.js';
import { handleMemoryTool } from '../src/tools/memory_unified.js';
import { handleCategoryTool } from '../src/tools/category.js';
import { importMemories, getExportableMemories } from '../src/modules/memory/transfer.js';
import { handleDataTool } from '../src/tools/data.js';

let pass = 0;
let fail = 0;
function check(name, condition, detail = '') {
    if (condition) {
        pass++;
        console.log('  ✅ ' + name);
    } else {
        fail++;
        console.log('  ❌ ' + name + (detail ? ' — ' + detail : ''));
    }
}
const env = {
    SUPABASE_URL: 'https://mock.supabase.co',
    SUPABASE_ANON_KEY: 'mock-anon'
};

console.log('\n[Repository contracts]');
{
    const calls = [];
    globalThis.fetch = async (url, options = {}) => {
        calls.push({ url: String(url), method: options.method || 'GET' });
        if (String(url).includes('/rest/v1/memories?key=')) {
            return { ok: true, status: 200, json: async () => [{ id: 'm-1', key: 'core/test', value: 'v', status: 'active' }] };
        }
        if (String(url).includes('/rest/v1/memories?select=')) {
            return { ok: true, status: 200, json: async () => [{ id: 'm-1', key: 'core/test', status: 'active' }] };
        }
        if (String(url).includes('/rest/v1/memory_aliases')) {
            return { ok: true, status: 200, json: async () => [{ memory_id: 'm-1' }, { alias: 'invalid' }] };
        }
        if (String(url).includes('/rest/v1/memory_events')) {
            return { ok: true, status: 200, json: async () => [{ id: 'e-1', event_type: 'update' }] };
        }
        throw new Error('unexpected request: ' + url);
    };
    const byKey = await getMemoryByKey(env, 'core/test');
    check('getMemoryByKey returns active row', byKey?.id === 'm-1');
    check('getMemoryByKey uses encoded key and active filter',
        calls[0].url.includes('key=eq.core%2Ftest') && calls[0].url.includes('status=eq.active'));
    const all = await getAllMemories(env);
    check('getAllMemories returns an array', Array.isArray(all) && all.length === 1);
    const current = await getCurrentMemories(env);
    const currentRequest = calls.find(call => call.url.includes('valid_to=is.null'));
    check('getCurrentMemories applies active plus valid_to IS NULL at the repository boundary',
        current.length === 1 && current[0].id === 'm-1' &&
        currentRequest?.url.includes('status=eq.active') && currentRequest?.url.includes('valid_to=is.null'));

    globalThis.fetch = async url => {
        calls.push({ url: String(url), method: 'GET' });
        if (String(url).includes('/rest/v1/memories?key=')) {
            return {
                ok: true,
                status: 200,
                json: async () => [
                    { id: 'current-key', key: 'core/current-key', status: 'active', valid_to: null },
                    { id: 'stale-key', key: 'core/current-key', status: 'active', valid_to: '2026-11-01T00:00:00Z' }
                ]
            };
        }
        if (String(url).includes('/rest/v1/memory_aliases')) {
            return { ok: true, status: 200, json: async () => [{ memory_id: 'm-1' }, { alias: 'invalid' }] };
        }
        if (String(url).includes('/rest/v1/memory_events')) {
            return { ok: true, status: 200, json: async () => [{ id: 'e-1', event_type: 'update' }] };
        }
        throw new Error('unexpected current-key/repository lookup: ' + url);
    };
    const currentByKey = await getCurrentMemoryByKey(env, 'core/current-key');
    const currentKeyRequest = calls[calls.length - 1];
    check('exact current-key lookup excludes active rows with non-null valid_to',
        currentByKey?.id === 'current-key' && currentKeyRequest.url.includes('valid_to=is.null'));

    const aliases = await getMemoryAliasIds(env, 'alias phrase');
    check('alias lookup discards malformed rows', aliases.length === 1 && aliases[0] === 'm-1');
    globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
    let currentReadError;
    try { await getCurrentMemories(env); } catch (error) { currentReadError = error; }
    check('current-memory HTTP failure is surfaced with a stable source code',
        currentReadError?.source === 'memories' && currentReadError?.code === 'http_error' &&
        currentReadError?.http_status === 503);

    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ rows: [] }) });
    let currentShapeError;
    try { await getCurrentMemories(env); } catch (error) { currentShapeError = error; }
    check('non-array current-memory response is not treated as an empty result',
        currentShapeError?.code === 'invalid_response_shape');

    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => { throw new Error('invalid JSON'); } });
    let currentJsonError;
    try { await getCurrentMemories(env); } catch (error) { currentJsonError = error; }
    check('invalid current-memory JSON is surfaced as invalid_json',
        currentJsonError?.code === 'invalid_json');

    globalThis.fetch = async url => {
        if (String(url).includes('/rest/v1/memory_aliases')) throw new Error('offline');
        return { ok: true, status: 200, json: async () => [{ id: 'e-1', event_type: 'update' }] };
    };
    let aliasNetworkError;
    try { await getMemoryAliasIds(env, 'offline'); } catch (error) { aliasNetworkError = error; }
    check('alias network failure is surfaced with a stable source code',
        aliasNetworkError?.source === 'memory_aliases' && aliasNetworkError?.code === 'network_error');

    const events = await getMemoryEvents(env, 'm-1');
    check('event history returns rows', events.length === 1 && events[0].id === 'e-1');
}

console.log('\n[Retired-key history contracts]');
{
    const calls = [];
    const retired = {
        id: 'retired-1',
        key: 'core/retired-rule',
        value: 'retired value',
        version: 3,
        status: 'deleted',
        valid_to: '2026-11-03T00:00:00Z',
        created_at: '2026-10-01T00:00:00Z',
        type: null
    };
    globalThis.fetch = async url => {
        const requestUrl = String(url);
        calls.push(requestUrl);
        if (requestUrl.includes('/rest/v1/memories?key=')) {
            return { ok: true, status: 200, json: async () => [retired] };
        }
        if (requestUrl.includes('/rest/v1/memory_events?memory_id=eq.retired-1')) {
            return {
                ok: true,
                status: 200,
                json: async () => [
                    { id: 'event-1', version: 2, old_value: 'older value', reason: 'update', created_at: '2026-10-02T00:00:00Z' },
                    { id: 'event-2', version: 3, old_value: { value: 'previous value', type: 'quote' }, new_value: { value: 'corrected value', type: 'agreement' }, reason: 'correction', created_at: '2026-10-03T00:00:00Z' }
                ]
            };
        }
        throw new Error('unexpected retired history request: ' + requestUrl);
    };

    const history = await getMemoryHistoryByKey(env, 'core/retired-rule');
    check('history repository finds soft-deleted keys',
        history.length === 1 && history[0].record.status === 'deleted');
    check('history repository does not restrict lookup to active rows',
        calls.some(url => url.includes('key=eq.core%2Fretired-rule')) &&
        !calls.find(url => url.includes('/rest/v1/memories?key='))?.includes('status=eq.active'));
    check('history repository returns the retired row event ledger',
        history[0]?.events.length === 2 && history[0]?.events[1]?.reason === 'correction');

    const output = await handleMemoryTool('memory', { action: 'history', key: 'core/retired-rule' }, env);
    check('legacy history action remains readable after soft delete',
        output.includes('已软删除') && output.includes('历史记录') &&
        output.includes('retired value') && output.includes('correction') &&
        output.includes('当前性质：未标注') && output.includes('older value') &&
        output.includes('previous value [type=quote]') && output.includes('corrected value [type=agreement]'));
}

console.log('\n[Lifecycle contracts]');
{
    const calls = [];
    let existing = null;
    globalThis.fetch = async (url, options = {}) => {
        const method = options.method || 'GET';
        const body = options.body ? JSON.parse(options.body) : null;
        const requestUrl = String(url);
        calls.push({ url: requestUrl, method, body });

        if (requestUrl.includes('/rest/v1/memories?key=') && method === 'GET') {
            return { ok: true, status: 200, json: async () => existing ? [existing] : [] };
        }
        if (requestUrl.includes('/rest/v1/memory_events') && method === 'POST') {
            return { ok: true, status: 201 };
        }
        if (requestUrl.includes('/rest/v1/memories?id=') && method === 'PATCH') {
            return { ok: true, status: 204 };
        }
        if (requestUrl.includes('/rest/v1/memories?key=') && method === 'PATCH') {
            return { ok: true, status: 204 };
        }
        if (requestUrl.endsWith('/rest/v1/memories') && method === 'POST') {
            return { ok: true, status: 201 };
        }
        throw new Error('unexpected lifecycle request: ' + method + ' ' + requestUrl);
    };

    const insert = await putMemory(env, '⚙️/test-insert', { value: 'inserted' });
    const insertLookup = calls.find(call => call.method === 'GET' && call.url.includes('/rest/v1/memories?key='));
    const insertCall = calls.find(call => call.method === 'POST' && call.url.endsWith('/rest/v1/memories'));
    check('lifecycle resolves existing records through current-only exact-key lookup',
        insertLookup?.url.includes('status=eq.active') && insertLookup?.url.includes('valid_to=is.null'));
    check('new memory insert succeeds', insert.ok === true);
    check('new memory insert preserves category/title/version/status',
        insertCall?.body?.category === '⚙️' &&
        insertCall?.body?.title === 'test-insert' &&
        insertCall?.body?.version === 1 &&
        insertCall?.body?.status === 'active');

    existing = { id: 'm-update', key: 'core/update', value: 'old', version: 3, type: 'quote', status: 'active', valid_to: null };
    calls.length = 0;
    const update = await putMemory(env, existing.key, { value: 'new' });
    const eventIndex = calls.findIndex(call => call.url.includes('/rest/v1/memory_events'));
    const patchIndex = calls.findIndex(call => call.method === 'PATCH' && call.url.includes('/rest/v1/memories?id='));
    check('update succeeds', update.ok === true);
    check('update writes event before updating memory', eventIndex >= 0 && patchIndex > eventIndex);
    check('update increments the existing version', calls[patchIndex]?.body?.version === 4);
    check('untyped update omits type from PATCH and keeps legacy string event snapshot',
        calls[patchIndex]?.body?.type === undefined && calls[eventIndex]?.body?.old_value === 'old');

    calls.length = 0;
    const typeUpdate = await putMemory(env, existing.key, { value: 'new typed value', type: 'agreement' });
    const typeEvent = calls.find(call => call.method === 'POST' && call.url.includes('/rest/v1/memory_events'))?.body;
    const typePatch = calls.find(call => call.method === 'PATCH' && call.url.includes('/rest/v1/memories?id='))?.body;
    check('explicit type update persists the requested type', typeUpdate.ok === true && typePatch?.type === 'agreement');
    check('typed update records old/new value and type in JSONB event snapshots',
        typeEvent?.old_value?.value === 'old' && typeEvent?.old_value?.type === 'quote' &&
        typeEvent?.new_value?.value === 'new typed value' && typeEvent?.new_value?.type === 'agreement');

    existing = null;
    calls.length = 0;
    const deleted = await deleteMemory(env, 'core/delete');
    check('soft delete succeeds only after active-row verification', deleted.ok === true);
    check('soft delete uses PATCH rather than physical DELETE',
        calls.some(call => call.method === 'PATCH') && !calls.some(call => call.method === 'DELETE'));
    const softDeletePatch = calls.find(call => call.method === 'PATCH' && call.url.includes('/rest/v1/memories?key='));
    const softDeleteVerify = calls.find(call => call.method === 'GET' && call.url.includes('select=id'));
    check('soft delete only targets current rows and verifies current effective state',
        softDeletePatch?.url.includes('valid_to=is.null') &&
        softDeleteVerify?.url.includes('valid_to=is.null'));

    console.log('\\n[Lifecycle failure contracts]');
    const failureCalls = [];
    const failureRecord = { id: 'm-failure', key: 'core/failure', value: 'old', version: 2, status: 'active', valid_to: null };
    let failEventWrite = true;
    let failMemoryPatch = false;
    let failDeleteVerification = false;
    globalThis.fetch = async (url, options = {}) => {
        const requestUrl = String(url);
        const method = options.method || 'GET';
        failureCalls.push({ url: requestUrl, method });
        if (method === 'GET' && requestUrl.includes('/rest/v1/memories?key=eq.core%2Ffailure')) {
            if (requestUrl.includes('select=id')) {
                if (failDeleteVerification) return { ok: false, status: 503, json: async () => ({}) };
                return { ok: true, status: 200, json: async () => [] };
            }
            return { ok: true, status: 200, json: async () => [failureRecord] };
        }
        if (method === 'POST' && requestUrl.includes('/rest/v1/memory_events')) {
            return { ok: !failEventWrite, status: failEventWrite ? 503 : 201 };
        }
        if (method === 'PATCH' && requestUrl.includes('/rest/v1/memories?id=')) {
            return { ok: !failMemoryPatch, status: failMemoryPatch ? 409 : 204 };
        }
        if (method === 'PATCH' && requestUrl.includes('/rest/v1/memories?key=eq.core%2Ffailure')) {
            return { ok: true, status: 204 };
        }
        throw new Error('unexpected lifecycle failure request: ' + method + ' ' + requestUrl);
    };

    const eventFailure = await putMemory(env, 'core/failure', { value: 'new' });
    check('event write failure stops update before memory PATCH',
        eventFailure.stage === 'history' &&
        !failureCalls.some(call => call.method === 'PATCH' && call.url.includes('/rest/v1/memories?id=')));

    failEventWrite = false;
    failMemoryPatch = true;
    failureCalls.length = 0;
    const patchFailure = await putMemory(env, 'core/failure', { value: 'new' });
    check('memory PATCH failure returns its own stage and status',
        patchFailure.stage === 'update' && patchFailure.status === 409);

    failMemoryPatch = false;
    failDeleteVerification = true;
    failureCalls.length = 0;
    const verificationFailure = await deleteMemory(env, 'core/failure');
    check('soft delete verification failure is not reported as success',
        verificationFailure.stage === 'verify' && verificationFailure.ok === false);
}

console.log('\n[Memory Type facade contracts]');
{
    const calls = [];
    const createdBodies = [];
    let current = null;
    let searchRows = [];
    globalThis.fetch = async (url, options = {}) => {
        const requestUrl = String(url);
        const method = options.method || 'GET';
        const body = options.body ? JSON.parse(options.body) : null;
        calls.push({ url: requestUrl, method, body });

        if (method === 'GET' && requestUrl.includes('/rest/v1/memories?key=')) {
            const match = requestUrl.match(/key=eq\.([^&]+)/);
            const key = match ? decodeURIComponent(match[1]) : '';
            return { ok: true, status: 200, json: async () => current?.key === key ? [current] : [] };
        }
        if (method === 'GET' && requestUrl.includes('/rest/v1/memories?select=')) {
            return { ok: true, status: 200, json: async () => searchRows };
        }
        if (method === 'GET' && requestUrl.includes('/rest/v1/memory_aliases')) {
            return { ok: true, status: 200, json: async () => [] };
        }
        if (method === 'GET' && requestUrl.includes('/rest/v1/search_history')) {
            return { ok: false, status: 404, json: async () => ({}) };
        }
        if (method === 'POST' && requestUrl.includes('/rest/v1/memory_events')) {
            return { ok: true, status: 201 };
        }
        if (method === 'PATCH' && requestUrl.includes('/rest/v1/memories?id=')) {
            return { ok: true, status: 204 };
        }
        if (method === 'POST' && requestUrl.endsWith('/rest/v1/memories')) {
            createdBodies.push(body);
            return { ok: true, status: 201 };
        }
        throw new Error('unexpected memory type request: ' + method + ' ' + requestUrl);
    };

    const invalid = await handleMemoryTool('memory', {
        action: 'remember', key: 'core/invalid-type', value: 'must not write', type: 'opinion'
    }, env);
    check('direct memory handler rejects invalid type before any fetch',
        invalid.includes('无效的记忆性质') && calls.length === 0);

    const typedRemember = await handleMemoryTool('memory', {
        action: 'remember', key: 'core/type-quote', value: 'original words', type: 'quote'
    }, env);
    check('remember persists an explicit legal type',
        typedRemember.includes('已新建记忆') && createdBodies.some(row => row.key === 'core/type-quote' && row.type === 'quote'));

    const untypedRemember = await handleMemoryTool('memory', {
        action: 'remember', key: 'core/type-unmarked', value: 'not classified'
    }, env);
    check('legacy remember without type leaves the nullable column unmarked',
        untypedRemember.includes('已新建记忆') && createdBodies.some(row =>
            row.key === 'core/type-unmarked' && !Object.prototype.hasOwnProperty.call(row, 'type')));

    current = {
        id: 'type-update', key: 'core/type-update', value: 'before', type: 'quote',
        version: 2, status: 'active', valid_to: null, created_at: '2026-11-01T00:00:00Z'
    };
    calls.length = 0;
    await handleMemoryTool('memory', { action: 'update', key: current.key, value: 'after without reclassification' }, env);
    const untypedPatch = calls.find(call => call.method === 'PATCH' && call.url.includes('/rest/v1/memories?id='));
    check('update without type preserves existing type by omitting it from PATCH',
        untypedPatch?.body?.type === undefined);

    calls.length = 0;
    await handleMemoryTool('memory', {
        action: 'update', key: current.key, value: 'confirmed rule', type: 'agreement'
    }, env);
    const typedPatch = calls.find(call => call.method === 'PATCH' && call.url.includes('/rest/v1/memories?id='));
    const typedEvent = calls.find(call => call.method === 'POST' && call.url.includes('/rest/v1/memory_events'))?.body;
    check('update with explicit type persists the new type',
        typedPatch?.body?.type === 'agreement');
    check('typed update writes structured old/new event snapshots',
        typedEvent?.old_value?.value === 'before' && typedEvent?.old_value?.type === 'quote' &&
        typedEvent?.new_value?.value === 'confirmed rule' && typedEvent?.new_value?.type === 'agreement');

    current = {
        id: 'type-unmarked', key: 'core/type-unmarked', value: 'not classified', type: null,
        version: 1, status: 'active', valid_to: null, created_at: '2026-11-01T00:00:00Z'
    };
    const recall = await handleMemoryTool('memory', { action: 'recall', key: current.key }, env);
    check('recall labels SQL NULL type as 未标注', recall.includes('性质：未标注'));

    searchRows = [
        { id: 'unmarked', key: 'core/type-unmarked', value: 'typeprobe unmarked body', type: null, status: 'active', valid_to: null, created_at: '2026-11-01T00:00:00Z' },
        { id: 'quote', key: 'core/type-quote', value: 'typeprobe quoted words', type: 'quote', status: 'active', valid_to: null, created_at: '2026-11-02T00:00:00Z' },
        { id: 'legacy', key: 'core/type-legacy', value: 'typeprobe legacy value', type: 'legacy-custom', status: 'active', valid_to: null, created_at: '2026-11-03T00:00:00Z' }
    ];
    const searchOutput = await handleMemoryTool('memory', { action: 'search', keyword: 'typeprobe' }, env);
    check('search distinguishes unmarked, legal and unknown historical types',
        searchOutput.includes('[未标注]') && searchOutput.includes('[quote]') && searchOutput.includes('[未知类型:legacy-custom]'));
}

console.log('\n[Retrieval contracts]');
{
    const rows = [
        {
            id: 'rule', key: '💕/做技术不劝柳柳休息', value: '柳柳有分寸，哥哥不会擅自劝休息',
            status: 'active', valid_to: null, created_at: '2026-11-01T00:00:00Z',
            related_memory_ids: ['related']
        },
        {
            id: 'related', key: '⚙️/相关操作经验', value: '这是关联经验',
            status: 'active', valid_to: null, created_at: '2026-10-01T00:00:00Z'
        },
        {
            id: 'expired', key: '💕/旧规则', value: '做技术时不劝柳柳休息，柳柳有分寸',
            status: 'active', valid_to: '2026-11-02T00:00:00Z',
            created_at: '2026-11-02T00:00:00Z'
        },
        {
            id: 'decoy', key: '💕/奶茶偏好', value: '柳柳喜欢喝奶茶',
            status: 'active', valid_to: null, created_at: '2026-11-03T00:00:00Z'
        }
    ];
    globalThis.fetch = async url => {
        const value = String(url);
        if (value.includes('/rest/v1/memories?select=')) {
            return { ok: true, status: 200, json: async () => rows };
        }
        if (value.includes('/rest/v1/memory_aliases')) {
            return { ok: true, status: 200, json: async () => [] };
        }
        throw new Error('unexpected retrieval request: ' + url);
    };

    const longQuery = '做技术时不劝柳柳休息 我有分寸';
    const matches = await searchMemories(env, longQuery);
    check('long Chinese query falls back to related core phrases',
        matches[0]?.id === 'rule' && matches[0]?._match?.reason === 'core_ngram_fallback');
    check('current effective filter excludes expired memory',
        !matches.some(memory => memory.id === 'expired'));
    check('one-hop related memory is included after direct match',
        matches.some(memory => memory.id === 'related') &&
        matches.findIndex(memory => memory.id === 'related') > matches.findIndex(memory => memory.id === 'rule'));
    check('explicit association carries the source key',
        matches.find(memory => memory.id === 'related')?._match?.related_from_key === '💕/做技术不劝柳柳休息');
    check('unrelated candidate is not included', !matches.some(memory => memory.id === 'decoy'));

    const negative = await searchMemories(env, '昨晚看的火星电影叫什么');
    check('negative query does not fabricate a hit', negative.length === 0);

    const exact = await searchMemories(env, '做技术不劝柳柳休息');
    check('exact phrase is ranked as a direct match',
        exact[0]?.id === 'rule' && exact[0]?._match?.reason !== 'core_ngram_fallback');
}

console.log('\n[Memory association v0.1 contracts]');
{
    const sourceKey = '⚙️/网关选型记录';
    const rows = [
        { id: 'seed', key: sourceKey, value: '网关选型决定采用独立模型网关',
            entities: ['Ziven Web', 'Cloudflare', '柳柳'],
            related_memory_ids: ['linked', 'expired', 'linked'],
            status: 'active', valid_to: null, created_at: '2026-11-01T00:00:00Z' },
        { id: 'linked', key: '⚙️/通话回声', value: '语音回声排查结论',
            status: 'active', valid_to: null, created_at: '2026-10-30T00:00:00Z' },
        { id: 'entity-best', key: '⚙️/页面部署', value: '部署入口规划',
            entities: ['Ziven Web', 'Cloudflare'],
            status: 'active', valid_to: null, created_at: '2026-11-02T00:00:00Z' },
        { id: 'entity-next', key: '⚙️/游戏设计', value: '小游戏展示入口',
            entities: ['Ziven Web'],
            status: 'active', valid_to: null, created_at: '2026-11-03T00:00:00Z' },
        { id: 'entity-overflow', key: '⚙️/旧费用估算', value: '预算估算',
            entities: ['Ziven Web'],
            status: 'active', valid_to: null, created_at: '2026-10-01T00:00:00Z' },
        { id: 'generic-only', key: '💕/饮品习惯', value: '无关的日常偏好',
            entities: ['柳柳', '项目', 'Ziven'],
            status: 'active', valid_to: null, created_at: '2026-11-05T00:00:00Z' },
        { id: 'expired', key: '⚙️/过期方案', value: '被取代的旧设计',
            entities: ['Ziven Web'], status: 'active', valid_to: '2026-11-03T00:00:00Z',
            created_at: '2026-11-04T00:00:00Z' },
        { id: 'deleted', key: '⚙️/删除的意见', value: '废弃内容',
            entities: ['Ziven Web'], status: 'deleted', valid_to: null,
            created_at: '2026-11-04T00:00:00Z' },
        { id: 'unrelated', key: '⚙️/无关项目', value: '互不相关的资料',
            entities: ['Other Project'], status: 'active', valid_to: null,
            created_at: '2026-11-04T00:00:00Z' }
    ];
    const methods = [];
    globalThis.fetch = async (url, options = {}) => {
        const requestUrl = String(url);
        methods.push(options.method || 'GET');
        if (requestUrl.includes('/rest/v1/memories?select=')) {
            return { ok: true, status: 200, json: async () => rows };
        }
        if (requestUrl.includes('/rest/v1/memory_aliases')) {
            return { ok: true, status: 200, json: async () => [] };
        }
        if (requestUrl.includes('/rest/v1/search_history?')) {
            return { ok: false, status: 404, json: async () => ({}) };
        }
        throw new Error('unexpected association request: ' + requestUrl);
    };

    const hits = await searchMemories(env, '网关选型');
    check('direct result is followed by at most three distinct associations',
        hits.length === 4 && hits.map(row => row.id).join(',') === 'seed,linked,entity-best,entity-next');
    check('explicit linked memory has source and one-hop reason',
        hits[1]?._match?.reason === 'related_memory' &&
        hits[1]?._match?.related_from_key === sourceKey);
    check('shared entity links select business evidence and include provenance',
        hits[2]?._match?.reason === 'shared_entity' &&
        hits[2]?._match?.matched_terms?.includes('Cloudflare') &&
        hits[2]?._match?.related_from_key === sourceKey);
    check('generic identifiers never act as sole association evidence',
        !hits.some(row => row.id === 'generic-only'));
    check('expired, deleted, overflow and unrelated memories are excluded',
        !hits.some(row => ['expired', 'deleted', 'entity-overflow', 'unrelated'].includes(row.id)));
    check('no direct match does not fabricate an entity association',
        (await searchMemories(env, '彻底不存在的查询词')).length === 0);
    check('the association retrieval primitive only performs reads',
        methods.every(method => method === 'GET'));

    const output = await handleMemoryTool('memory', { action: 'search', keyword: '网关选型' }, env);
    check('existing memory.search facade displays association source and shared entity',
        output.includes('[match_reason=shared_entity]') &&
        output.includes('[关联来源=' + sourceKey + ']') &&
        output.includes('[共同实体=Ziven Web、Cloudflare]'));
}


console.log('\n[Retrieval reliability contracts]');
{
    const hit = {
        id: 'reliability-hit', key: 'core/project-plan',
        value: 'project plan confirmed', status: 'active', valid_to: null,
        created_at: '2026-11-05T00:00:00Z'
    };
    const successFetch = async url => {
        const requestUrl = String(url);
        if (requestUrl.includes('/rest/v1/memories?select=')) {
            return { ok: true, status: 200, json: async () => [hit] };
        }
        if (requestUrl.includes('/rest/v1/memory_aliases')) {
            return { ok: true, status: 200, json: async () => [] };
        }
        throw new Error('unexpected reliability request: ' + requestUrl);
    };

    globalThis.fetch = successFetch;
    const ok = await searchMemoriesWithStatus(env, 'project plan');
    check('both retrieval sources successful with a hit returns OK',
        ok.status === 'OK' && ok.results[0]?.id === hit.id &&
        ok.sources.memories.status === 'ok' && ok.sources.aliases.status === 'ok');

    globalThis.fetch = successFetch;
    const empty = await searchMemoriesWithStatus(env, 'needle-that-does-not-exist');
    check('both retrieval sources successful without a hit returns EMPTY',
        empty.status === 'EMPTY' && empty.results.length === 0);

    globalThis.fetch = async url => {
        if (String(url).includes('/rest/v1/memory_aliases')) {
            return { ok: false, status: 503, json: async () => ({}) };
        }
        return { ok: true, status: 200, json: async () => [hit] };
    };
    const partialHttp = await searchMemoriesWithStatus(env, 'project plan');
    check('alias HTTP failure returns PARTIAL and preserves direct memory hits',
        partialHttp.status === 'PARTIAL' && partialHttp.results[0]?.id === hit.id &&
        partialHttp.sources.aliases.error_code === 'http_error');

    globalThis.fetch = async url => {
        if (String(url).includes('/rest/v1/memory_aliases')) throw new Error('alias network down');
        return { ok: true, status: 200, json: async () => [hit] };
    };
    const partialNetwork = await searchMemoriesWithStatus(env, 'project plan');
    check('alias network failure returns PARTIAL instead of discarding primary results',
        partialNetwork.status === 'PARTIAL' && partialNetwork.results.some(row => row.id === hit.id) &&
        partialNetwork.sources.aliases.error_code === 'network_error');

    globalThis.fetch = async url => {
        if (String(url).includes('/rest/v1/memory_aliases')) {
            return { ok: true, status: 200, json: async () => ({ invalid: true }) };
        }
        return { ok: true, status: 200, json: async () => [hit] };
    };
    const partialShape = await searchMemoriesWithStatus(env, 'project plan');
    check('alias invalid response shape is PARTIAL, not EMPTY',
        partialShape.status === 'PARTIAL' && partialShape.sources.aliases.error_code === 'invalid_response_shape');

    globalThis.fetch = async url => {
        if (String(url).includes('/rest/v1/memory_aliases')) {
            return { ok: true, status: 200, json: async () => [] };
        }
        return { ok: false, status: 503, json: async () => ({}) };
    };
    const errorHttp = await searchMemoriesWithStatus(env, 'project plan');
    check('required memories HTTP failure returns ERROR and no results',
        errorHttp.status === 'ERROR' && errorHttp.results.length === 0 &&
        errorHttp.sources.memories.error_code === 'http_error');

    globalThis.fetch = async url => {
        if (String(url).includes('/rest/v1/memory_aliases')) {
            return { ok: true, status: 200, json: async () => [] };
        }
        return { ok: true, status: 200, json: async () => ({ invalid: true }) };
    };
    const errorShape = await searchMemoriesWithStatus(env, 'project plan');
    check('required memories invalid response shape returns ERROR',
        errorShape.status === 'ERROR' && errorShape.sources.memories.error_code === 'invalid_response_shape');

    globalThis.fetch = successFetch;
    const legacy = await searchMemories(env, 'project plan');
    check('legacy array retrieval facade remains compatible and exposes non-enumerable status',
        Array.isArray(legacy) && legacy[0]?.id === hit.id && legacy.search_status === 'OK');

    const facadeCalls = [];
    globalThis.fetch = async url => {
        const requestUrl = String(url);
        facadeCalls.push(requestUrl);
        if (requestUrl.includes('/rest/v1/memory_aliases')) throw new Error('alias offline');
        if (requestUrl.includes('/rest/v1/search_history')) return { ok: false, status: 404, json: async () => ({}) };
        if (requestUrl.includes('/rest/v1/memories?select=')) return { ok: true, status: 200, json: async () => [hit] };
        throw new Error('unexpected partial facade request: ' + requestUrl);
    };
    const partialFacade = await handleMemoryTool('memory', { action: 'search', keyword: 'project plan' }, env);
    check('Memory Facade labels partial results and preserves direct hits',
        partialFacade.includes('[search_status=PARTIAL]') && partialFacade.includes('**project** **plan** confirmed'));
    check('partial search retains the existing search-history success path',
        facadeCalls.some(url => url.includes('/rest/v1/search_history')));

    const errorCalls = [];
    globalThis.fetch = async url => {
        const requestUrl = String(url);
        errorCalls.push(requestUrl);
        if (requestUrl.includes('/rest/v1/memory_aliases')) return { ok: true, status: 200, json: async () => [] };
        if (requestUrl.includes('/rest/v1/memories?select=')) return { ok: false, status: 503, json: async () => ({}) };
        throw new Error('unexpected error facade request: ' + requestUrl);
    };
    const errorFacade = await handleMemoryTool('memory', { action: 'search', keyword: 'project plan' }, env);
    check('Memory Facade reports ERROR without pretending zero matches',
        errorFacade.includes('[search_status=ERROR]') && !errorFacade.includes('找到 0 条结果'));
    check('failed primary retrieval does not record a successful search-history entry',
        !errorCalls.some(url => url.includes('/rest/v1/search_history')));
    const statsFacade = await handleMemoryTool('memory', { action: 'stats' }, env);
    check('Memory Facade reports stats source failure instead of zero counts',
        statsFacade.includes('[stats_status=ERROR]') && !statsFacade.includes('总条数：0'));
}

console.log('\n[Lifecycle relocation contracts]');
{
    const source = {
        id: 'source-1', key: 'core/old-name', value: 'keep this value',
        category: 'core', title: 'old-name', version: 2, type: 'agreement',
        source_ref: 'conversation:42', trigger_intents: ['architecture-work'],
        entities: ['Ziven', '柳柳'], related_memory_ids: ['related-1'],
        status: 'active', valid_to: null, created_at: '2026-10-20T00:00:00Z'
    };
    const calls = [];
    let sourceActive = true;
    let targetExists = false;
    let failSourceDelete = false;
    globalThis.fetch = async (url, options = {}) => {
        const requestUrl = String(url);
        const method = options.method || 'GET';
        const body = options.body ? JSON.parse(options.body) : null;
        calls.push({ url: requestUrl, method, body });

        if (method === 'GET' && requestUrl.includes('/rest/v1/memories?key=')) {
            if (requestUrl.includes('key=eq.core%2Fold-name')) {
                if (requestUrl.includes('select=id')) return { ok: true, status: 200, json: async () => sourceActive ? [{ id: source.id }] : [] };
                return { ok: true, status: 200, json: async () => sourceActive ? [source] : [] };
            }
            if (requestUrl.includes('key=eq.core%2Fnew-name') || requestUrl.includes('key=eq.archive%2Fold-name')) {
                return { ok: true, status: 200, json: async () => targetExists ? [{ id: 'target-1', key: requestUrl.includes('new-name') ? 'core/new-name' : 'archive/old-name', value: 'occupied', status: 'active' }] : [] };
            }
        }
        if (method === 'POST' && requestUrl.endsWith('/rest/v1/memories')) {
            return { ok: true, status: 201 };
        }
        if (method === 'PATCH' && requestUrl.includes('/rest/v1/memories?key=eq.core%2Fold-name')) {
            if (failSourceDelete) return { ok: false, status: 503 };
            sourceActive = false;
            return { ok: true, status: 204 };
        }
        if (method === 'PATCH' && requestUrl.includes('/rest/v1/memories?id=')) {
            return { ok: true, status: 204 };
        }
        if (method === 'POST' && requestUrl.includes('/rest/v1/memory_events')) {
            return { ok: true, status: 201 };
        }
        throw new Error('unexpected relocation request: ' + method + ' ' + requestUrl);
    };

    const renamed = await renameMemory(env, 'core/old-name', 'core/new-name');
    check('rename creates target before soft-deleting source', renamed.ok === true &&
        calls.findIndex(call => call.method === 'POST' && call.url.endsWith('/rest/v1/memories')) <
        calls.findIndex(call => call.method === 'PATCH' && call.url.includes('key=eq.core%2Fold-name')));
    const relocatedRecord = calls.find(call => call.method === 'POST' && call.url.endsWith('/rest/v1/memories'))?.body;
    check('rename preserves semantic metadata on the target record',
        relocatedRecord?.type === 'agreement' &&
        relocatedRecord?.source_ref === 'conversation:42' &&
        relocatedRecord?.trigger_intents?.[0] === 'architecture-work' &&
        relocatedRecord?.entities?.length === 2 &&
        relocatedRecord?.related_memory_ids?.[0] === 'related-1');
    check('rename never issues physical DELETE', !calls.some(call => call.method === 'DELETE'));

    sourceActive = true;
    targetExists = true;
    calls.length = 0;
    const collision = await moveMemory(env, 'core/old-name', 'archive');
    check('move rejects an existing target without writes',
        collision.code === 'target_exists' &&
        !calls.some(call => call.method === 'POST' || call.method === 'PATCH'));

    sourceActive = true;
    targetExists = false;
    calls.length = 0;
    const moved = await moveMemory(env, 'core/old-name', 'archive');
    check('move delegates through the same create-then-soft-delete sequence',
        moved.ok === true &&
        calls.some(call => call.method === 'POST' && call.url.endsWith('/rest/v1/memories')) &&
        calls.some(call => call.method === 'PATCH' && call.url.includes('key=eq.core%2Fold-name')));

    sourceActive = true;
    failSourceDelete = true;
    calls.length = 0;
    const partialMove = await moveMemory(env, 'core/old-name', 'archive');
    check('failed source soft-delete returns a partial-migration warning',
        partialMove.code === 'source_delete_unconfirmed' &&
        calls.findIndex(call => call.method === 'POST' && call.url.endsWith('/rest/v1/memories')) <
        calls.findIndex(call => call.method === 'PATCH' && call.url.includes('key=eq.core%2Fold-name')));
}

console.log('\n[Read-query contracts]');
{
    const rows = [
        { id: 'new', key: '⚙️/new', category: '⚙️', value: 'new', status: 'active', valid_to: null, created_at: '2026-11-03T00:00:00Z' },
        { id: 'middle', key: '⚙️/middle', category: '⚙️', value: 'middle', status: 'active', valid_to: null, created_at: '2026-11-02T00:00:00Z' },
        { id: 'old', key: '💕/old', category: '💕', value: 'old', status: 'active', valid_to: null, created_at: '2026-11-01T00:00:00Z' },
        { id: 'expired-active', key: '⚙️/expired-active', category: '⚙️', value: 'stale active row', status: 'active', valid_to: '2026-11-02T00:00:00Z', created_at: '2026-11-03T00:00:00Z' }
    ];
    globalThis.fetch = async url => {
        const requestUrl = String(url);
        if (requestUrl.includes('/rest/v1/memories?select=')) {
            return { ok: true, status: 200, json: async () => rows };
        }
        if (requestUrl.includes('/rest/v1/memory_aliases')) {
            return { ok: true, status: 200, json: async () => [] };
        }
        if (requestUrl.includes('/rest/v1/search_history')) {
            return { ok: false, status: 404, json: async () => ({}) };
        }
        throw new Error('unexpected read-query request: ' + url);
    };

    const page = await listMemories(env, { limit: 2, order: 'desc' });
    check('listMemories preserves descending order and cursor paging',
        page.total === 3 && page.page.map(item => item.id).join(',') === 'new,middle' && page.nextCursor === 'middle');

    const categoryPage = await listMemoriesByCategory(env, '⚙️', { limit: 1 });
    check('listMemoriesByCategory filters and returns a next cursor',
        categoryPage.total === 2 && categoryPage.page[0]?.id === 'new' && categoryPage.nextCursor === 'new');
    const categoryPage2 = await listMemoriesByCategory(env, '⚙️', { limit: 1, cursor: categoryPage.nextCursor });
    check('listMemoriesByCategory uses the shared cursor continuation semantics',
        categoryPage2.page[0]?.id === 'middle' && categoryPage2.nextCursor === null);

    const datePage = await listMemoriesByDate(env, '2026-11-02', '2026-11-03', { limit: 1 });
    check('listMemoriesByDate preserves date range and first-page semantics',
        datePage.total === 2 && datePage.page[0]?.id === 'new' && datePage.nextCursor === 'new');
    const datePage2 = await listMemoriesByDate(env, '2026-11-02', '2026-11-03', { limit: 1, cursor: datePage.nextCursor });
    check('listMemoriesByDate uses the shared cursor continuation semantics',
        datePage2.page[0]?.id === 'middle' && datePage2.nextCursor === null);

    const categories = await listMemoryCategories(env);
    check('listMemoryCategories counts active rows by category',
        categories.map(([category,count]) => category + ':' + count).join(',') === '⚙️:2,💕:1');

    const stats = await getMemoryStats(env);
    check('getMemoryStats reports totals and category count', stats.total === 3 && stats.categoryCount === 2);

    const random = await getRandomMemory(env, '💕');
    check('getRandomMemory restricts candidates to requested category',
        random.status === 'ok' && random.item?.category === '💕');

    const facade = await handleMemoryTool('memory_list_categories', {}, env);
    check('legacy memory action facade retains category-list output',
        facade.includes('分类列表') && facade.includes('⚙️（2条）'));

    const searchOutput = await handleMemoryTool('memory_search', { keyword: 'new' }, env);
    check('memory search facade exposes machine-readable match_reason',
        searchOutput.includes('match_reason=key_phrase'));

    const categoryFacade = await handleCategoryTool('list_categories', {}, env);
    check('category facade uses the same current-memory category index',
        categoryFacade.includes('分类列表') && categoryFacade.includes('⚙️（2条）'));

    const recallCategory = await handleCategoryTool('recall_by_category', { category: '⚙️', limit: 1 }, env);
    check('category recall facade preserves paged output',
        recallCategory.includes('分类 "⚙️"') && recallCategory.includes('new'));
}

console.log('\\n[Category relocation facade contract]');
{
    const source = {
        id: 'legacy-source', key: 'core/legacy', value: 'legacy value',
        category: 'core', title: 'legacy', status: 'active', valid_to: null,
        created_at: '2026-10-20T00:00:00Z', version: 1
    };
    const calls = [];
    let sourceActive = true;
    globalThis.fetch = async (url, options = {}) => {
        const requestUrl = String(url);
        const method = options.method || 'GET';
        const body = options.body ? JSON.parse(options.body) : null;
        calls.push({ url: requestUrl, method, body });

        if (method === 'GET' && requestUrl.includes('/rest/v1/memories?key=eq.core%2Flegacy')) {
            if (requestUrl.includes('select=id')) {
                return { ok: true, status: 200, json: async () => sourceActive ? [{ id: source.id }] : [] };
            }
            return { ok: true, status: 200, json: async () => sourceActive ? [source] : [] };
        }
        if (method === 'GET' && requestUrl.includes('/rest/v1/memories?key=eq.archive%2Flegacy')) {
            return { ok: true, status: 200, json: async () => [] };
        }
        if (method === 'POST' && requestUrl.endsWith('/rest/v1/memories')) {
            return { ok: true, status: 201 };
        }
        if (method === 'PATCH' && requestUrl.includes('/rest/v1/memories?key=eq.core%2Flegacy')) {
            sourceActive = false;
            return { ok: true, status: 204 };
        }
        throw new Error('unexpected category relocation request: ' + method + ' ' + requestUrl);
    };

    const output = await handleCategoryTool('move_category', {
        key: 'core/legacy', newCategory: 'archive'
    }, env);
    check('legacy category move reports success through shared lifecycle',
        output.includes('已移动：core/legacy → archive/legacy'));
    check('legacy category move creates target before soft-deleting source',
        calls.findIndex(call => call.method === 'POST' && call.url.endsWith('/rest/v1/memories')) <
        calls.findIndex(call => call.method === 'PATCH' && call.url.includes('key=eq.core%2Flegacy')));
    check('legacy category move no longer issues physical DELETE',
        !calls.some(call => call.method === 'DELETE'));
}


console.log('\n[Transfer contracts]');
{
    const calls = [];
    const rows = {
        'core/same': { id: 'same', key: 'core/same', value: 'unchanged', version: 1, status: 'active', valid_to: null },
        'core/update': { id: 'update', key: 'core/update', value: 'before', version: 2, type: 'quote', status: 'active', valid_to: null }
    };
    globalThis.fetch = async (url, options = {}) => {
        const requestUrl = String(url);
        const method = options.method || 'GET';
        const body = options.body ? JSON.parse(options.body) : null;
        calls.push({ url: requestUrl, method, body });

        if (method === 'GET' && requestUrl.includes('/rest/v1/memories?key=')) {
            const keyMatch = requestUrl.match(/key=eq\.([^&]+)/);
            const key = keyMatch ? decodeURIComponent(keyMatch[1]) : '';
            return { ok: true, status: 200, json: async () => rows[key] ? [rows[key]] : [] };
        }
        if (method === 'POST' && requestUrl.includes('/rest/v1/memory_events')) {
            return { ok: true, status: 201 };
        }
        if (method === 'PATCH' && requestUrl.includes('/rest/v1/memories?id=')) {
            return { ok: true, status: 204 };
        }
        if (method === 'POST' && requestUrl.endsWith('/rest/v1/memories')) {
            return { ok: true, status: 201 };
        }
        throw new Error('unexpected transfer import request: ' + method + ' ' + requestUrl);
    };

    const imported = await importMemories(env, [
        { key: '', value: 'invalid' },
        { key: 'core/same', value: 'unchanged' },
        { key: 'core/update', value: 'after' },
        { key: 'core/new', value: 'created', created_at: '2026-10-01T00:00:00Z' }
    ], { invalidAsFailed: true });
    const insertCall = calls.find(call => call.method === 'POST' && call.url.endsWith('/rest/v1/memories'));
    check('shared importer counts insert/update/skip/invalid failures from actual write results',
        imported.added === 1 && imported.updated === 1 && imported.skipped === 1 && imported.failed === 1);
    check('shared importer preserves source created_at on new records',
        insertCall?.body?.created_at === '2026-10-01T00:00:00Z');
    const untypedUpdatePatch = calls.find(call => call.method === 'PATCH' && call.url.includes('/rest/v1/memories?id='));
    check('legacy import without type does not overwrite an existing type', untypedUpdatePatch?.body?.type === undefined);

    globalThis.fetch = async (url, options = {}) => {
        const requestUrl = String(url);
        const method = options.method || 'GET';
        if (method === 'GET' && requestUrl.includes('/rest/v1/memories?key=')) {
            return { ok: true, status: 200, json: async () => [{ id: 'update', key: 'core/update', value: 'before', version: 2, status: 'active', valid_to: null }] };
        }
        if (method === 'POST' && requestUrl.includes('/rest/v1/memory_events')) {
            return { ok: true, status: 201 };
        }
        if (method === 'PATCH' && requestUrl.includes('/rest/v1/memories?id=')) {
            return { ok: false, status: 409 };
        }
        throw new Error('unexpected transfer failure request: ' + method + ' ' + requestUrl);
    };
    const failedUpdate = await importMemories(env, [{ key: 'core/update', value: 'after' }]);
    check('shared importer does not count failed lifecycle updates as updated',
        failedUpdate.updated === 0 && failedUpdate.failed === 1 && failedUpdate.ok === false);
}

console.log('\n[Transfer facade parity contracts]');
{
    const rows = [
        { id: 'current', key: 'core/current', value: 'current body', status: 'active', valid_to: null, created_at: '2026-11-03T00:00:00Z', updated_at: '2026-11-03T00:00:00Z' },
        { id: 'expired', key: 'core/expired', value: 'expired body', status: 'active', valid_to: '2026-11-02T00:00:00Z', created_at: '2026-11-01T00:00:00Z' },
        { id: 'deleted', key: 'core/deleted', value: 'deleted body', status: 'deleted', valid_to: '2026-11-02T00:00:00Z', created_at: '2026-11-01T00:00:00Z' }
    ];
    globalThis.fetch = async url => {
        if (String(url).includes('/rest/v1/memories?select=')) {
            return { ok: true, status: 200, json: async () => rows };
        }
        throw new Error('unexpected transfer export request: ' + url);
    };

    const exportRows = await getExportableMemories(env);
    check('shared export query keeps only active rows with null valid_to',
        exportRows.length === 1 && exportRows[0].key === 'core/current');

    const unifiedOutput = await handleMemoryTool('memory_export', {}, env);
    const dataOutput = await handleDataTool('export', {}, env);
    check('memory and legacy data export facades share the same current-record filter',
        unifiedOutput.includes('core/current') && dataOutput.includes('core/current') &&
        !unifiedOutput.includes('core/expired') && !dataOutput.includes('core/expired') &&
        !unifiedOutput.includes('core/deleted') && !dataOutput.includes('core/deleted'));

    const unifiedImport = await handleMemoryTool('memory_import', {
        data: JSON.stringify([{ key: '', value: 'invalid' }])
    }, env);
    const legacyImport = await handleDataTool('import', {
        data: JSON.stringify([{ key: '', value: 'invalid' }])
    }, env);
    check('unified import facade retains explicit malformed-row failure count',
        unifiedImport.includes('失败 1'));
    check('legacy data import facade retains silent malformed-row skip behavior',
        legacyImport.includes('新增 0 条') && legacyImport.includes('更新 0 条') &&
        legacyImport.includes('跳过 0 条') && !legacyImport.includes('失败'));

    globalThis.fetch = async (url, options = {}) => {
        const requestUrl = String(url);
        const method = options.method || 'GET';
        if (method === 'GET' && requestUrl.includes('/rest/v1/memories?key=')) {
            return { ok: true, status: 200, json: async () => [] };
        }
        if (method === 'POST' && requestUrl.endsWith('/rest/v1/memories')) {
            return { ok: true, status: 201 };
        }
        throw new Error('unexpected facade import request: ' + method + ' ' + requestUrl);
    };
    const unifiedSuccess = await handleMemoryTool('memory_import', {
        data: JSON.stringify([{ key: 'core/unified-import', value: 'imported' }])
    }, env);
    const dataSuccess = await handleDataTool('import', {
        data: JSON.stringify([{ key: 'core/data-import', value: 'imported' }])
    }, env);
    check('memory import facade reports shared lifecycle insert success',
        unifiedSuccess.includes('新增 1') && unifiedSuccess.includes('失败 0'));
    check('data import facade reports shared lifecycle insert success',
        dataSuccess.includes('新增 1 条') && !dataSuccess.includes('失败'));

    globalThis.fetch = async (url, options = {}) => {
        const requestUrl = String(url);
        const method = options.method || 'GET';
        if (method === 'GET' && requestUrl.includes('/rest/v1/memories?key=')) {
            return { ok: true, status: 200, json: async () => [] };
        }
        if (method === 'POST' && requestUrl.endsWith('/rest/v1/memories')) {
            return { ok: false, status: 503 };
        }
        throw new Error('unexpected facade import failure request: ' + method + ' ' + requestUrl);
    };
    const dataWriteFailure = await handleDataTool('import', {
        data: JSON.stringify([{ key: 'core/data-failed', value: 'not written' }])
    }, env);
    check('data import facade does not count a failed underlying write as added',
        dataWriteFailure.includes('新增 0 条') && dataWriteFailure.includes('失败 1 条'));
}

console.log(`\nMemory core contracts: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
