// L5 v0.4: bounded, anonymized health scene contracts with synthetic PostgREST.
import assert from 'node:assert/strict';
import { BOOTSTRAP_CORE_KEYS } from '../src/modules/memory/layer_mapper.js';
import { handleMemoryHealthCheck } from '../src/modules/memory/health_check.js';
import { handleMemoryTool } from '../src/tools/memory_unified.js';
import { readMemoryHealthMetadataSample } from '../src/modules/memory/repository.js';
import { withMemoryTypeSchema } from '../src/utils/helpers.js';

const originalFetch = globalThis.fetch;
const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: 'synthetic-token' };
const columns = 'id,key,category,type,status,valid_to,updated_at,version,source_ref';
let calls = [];
let passed = 0;
const check = (name, test) => { assert.ok(test, name); passed++; console.log('  ✅ ' + name); };
const row = (id, key, type = null) => ({
    id, key, category: '⚙️', type, status: 'active', valid_to: null,
    updated_at: '2026-11-01T00:00:00Z', version: 1, source_ref: null,
    value: 'NEVER_EXPOSE_THIS_PRIVATE_VALUE'
});

const core = BOOTSTRAP_CORE_KEYS.map((key, index) => row('core' + index, key, index === 0 ? 'agreement' : null));
const responses = [
    ...core.map(x => [x]),
    [core[0], row('work', '⚙️/sensitive-private-work-key')],
    [row('relationship1', '💕/sensitive-private-relationship-key'), row('relationship2', '💕/private-second-key')],
    [row('older1', '📦/private-old-1'), row('older2', '📦/private-old-2'), row('older3', '📦/private-old-3')]
];

function makeFetch({ failureAt = -1, invalidAt = -1, oversizedAt = -1 } = {}) {
    calls = [];
    return async (url, init = {}) => {
        const u = new URL(url);
        calls.push({ url: u, method: init.method || 'GET', init });
        const index = calls.length - 1;
        if (index === failureAt) return { ok: false, status: 503, json: async () => ({}) };
        return {
            ok: true, status: 200,
            json: async () => invalidAt === index ? { error: 'private-invalid-shape' }
                : oversizedAt === index ? Array.from({ length: 4 }, (_, i) => row('extra' + i, '⚙️/private-extra-key'))
                    : responses[index] || []
        };
    };
}

try {
    console.log('\n[L5 memory health scenario contracts]');
    globalThis.fetch = () => { throw new Error('demo_must_not_use_network'); };
    const demo = await handleMemoryTool('memory', { action: 'health_check' }, env);
    check('default scene produces a human-readable synthetic report', demo.includes('[health_status=OK]')
        && demo.includes('固定合成数据演示') && demo.includes('Core')
        && demo.includes('Reflection') && demo.includes('只读'));
    check('demo never leaks synthetic IDs, keys or source references',
        !demo.includes('demo-core') && !demo.includes('🧬/我是谁')
        && !demo.includes('synthetic:core') && !demo.includes('demo-reflection'));

    calls = [];
    const rejected = await handleMemoryTool('memory', { action: 'health_check', mode: 'sample' }, env);
    check('real metadata mode is gated by explicit per-run confirmation',
        rejected.includes('CONSENT_REQUIRED') && calls.length === 0);
    check('invalid mode is rejected without access',
        (await handleMemoryHealthCheck({ mode: 'full_scan' }, env)).includes('INVALID_MODE'));

    globalThis.fetch = makeFetch();
    const result = await handleMemoryTool('memory',
        { action: 'health_check', mode: 'sample', metadata_read_confirmed: true }, env);
    check('authorized sample has eight fixed SELECTs, twelve rows and eleven unique',
        calls.length === 8 && result.includes('读取 12 行；去重后 11 条'));
    check('sample uses only GETs on memories and excludes all private values',
        calls.every(({ url, method }) => method === 'GET'
            && url.pathname === '/rest/v1/memories' && url.searchParams.get('select') === columns
            && !url.searchParams.get('select').includes('value')));
    globalThis.fetch = makeFetch();
    const projected = await readMemoryHealthMetadataSample(env);
    check('repository strips any unrequested private response fields before mapping',
        projected.rows.length === 12
        && projected.rows.every(x => !Object.prototype.hasOwnProperty.call(x, 'value')));
    check('five exact Core keys, two work, two relationship and three oldest sampled',
        calls.slice(0, 5).every((x, i) => x.url.searchParams.get('key') === 'eq.' + BOOTSTRAP_CORE_KEYS[i]
            && x.url.searchParams.get('limit') === '1')
        && calls[5].url.searchParams.get('category') === 'like.⚙️%'
        && calls[5].url.searchParams.get('limit') === '2'
        && calls[6].url.searchParams.get('category') === 'like.💕%'
        && calls[6].url.searchParams.get('limit') === '2'
        && calls[7].url.searchParams.get('order') === 'updated_at.asc'
        && calls[7].url.searchParams.get('limit') === '3');
    check('real sample report is anonymous and does not claim full coverage',
        result.includes('不是全库盘点') && result.includes('Reflection 未检查')
        && !result.includes('sensitive-private') && !result.includes('NEVER_EXPOSE')
        && !result.includes('core0') && !result.includes('source_ref'));
    check('real sample gives anonymous per-row explanation and Core uncertainties',
        result.includes('匿名逐条说明') && result.includes('样本 01')
        && result.includes('Core 启动候选待核验：5 条'));
    check('real sample never upgrades Core without body-readable evidence',
        result.includes('Core 0') && result.includes('正文'));

    globalThis.fetch = makeFetch({ failureAt: 6 });
    const partial = await handleMemoryHealthCheck({ mode: 'sample', metadata_read_confirmed: true }, env);
    check('partial HTTP failure is explicit and stops further queries',
        partial.includes('[health_status=PARTIAL]') && partial.includes('http_error')
        && calls.length === 7 && !partial.includes('private'));
    globalThis.fetch = makeFetch({ failureAt: 0 });
    const error = await handleMemoryHealthCheck({ mode: 'sample', metadata_read_confirmed: true }, env);
    check('first-query HTTP failure is ERROR, never EMPTY', error.includes('[health_status=ERROR]')
        && !error.includes('[health_status=OK]') && calls.length === 1);
    globalThis.fetch = makeFetch({ invalidAt: 2 });
    const malformed = await handleMemoryHealthCheck({ mode: 'sample', metadata_read_confirmed: true }, env);
    check('malformed PostgREST body stops with partial and no private text',
        malformed.includes('[health_status=PARTIAL]') && malformed.includes('invalid_response_shape')
        && calls.length === 3 && !malformed.includes('private-invalid'));
    globalThis.fetch = makeFetch({ oversizedAt: 5 });
    const oversized = await handleMemoryHealthCheck({ mode: 'sample', metadata_read_confirmed: true }, env);
    check('server ignoring a limit cannot expand or silently trust the sample',
        oversized.includes('[health_status=PARTIAL]') && oversized.includes('invalid_response_shape')
        && calls.length === 6 && !oversized.includes('private-extra'));
    const registered = {
        type: 'object', required: ['action'],
        properties: { action: { type: 'string', enum: ['recall', 'remember'] } }
    };
    const exposed = withMemoryTypeSchema(registered);
    check('shared facade schema adds health_check without mutating old enums',
        exposed.properties.action.enum.includes('health_check')
        && exposed.properties.mode.enum.join(',') === 'demo,sample'
        && exposed.properties.metadata_read_confirmed.type === 'boolean'
        && registered.properties.action.enum.length === 2
        && exposed.required.join(',') === 'action');
    check('no write/usage request was ever issued', calls.every(({ method }) => method === 'GET'));
    console.log(`✅ L5 memory health contracts: ${passed} passed, 0 failed`);
} finally {
    globalThis.fetch = originalFetch;
}
