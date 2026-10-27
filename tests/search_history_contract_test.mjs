// Isolated contract tests for src/utils/search.js. All network calls are mocked.
import { recordSearchKeyword, getSearchSuggestions } from '../src/utils/search.js';

const env = { SUPABASE_URL: 'https://mock.supabase.co', SUPABASE_ANON_KEY: 'mock-anon-key' };
const originalFetch = globalThis.fetch;
let calls = [];
let pass = 0;
let fail = 0;

function check(name, condition) {
    if (condition) {
        pass++;
        console.log('  ✅ ' + name);
    } else {
        fail++;
        console.log('  ❌ ' + name);
    }
}

function response(status, payload) {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => payload,
        text: async () => JSON.stringify(payload)
    };
}

function invalidJsonResponse(status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => { throw new Error('mock invalid JSON'); },
        text: async () => 'not-json'
    };
}

function mockSequence(...steps) {
    calls = [];
    const queue = [...steps];
    globalThis.fetch = async (url, options = {}) => {
        const request = {
            url: String(url),
            method: (options.method || 'GET').toUpperCase(),
            body: options.body ? JSON.parse(options.body) : undefined
        };
        calls.push(request);
        if (!queue.length) throw new Error('unexpected extra fetch: ' + request.url);
        const next = queue.shift();
        if (next instanceof Error) throw next;
        return next;
    };
}

try {
    // recordSearchKeyword: normalize input and never write after a failed lookup.
    mockSequence();
    await recordSearchKeyword(env, '   ');
    check('空白关键词不发请求', calls.length === 0);

    mockSequence();
    await recordSearchKeyword(env, null);
    check('空值关键词不发请求', calls.length === 0);

    mockSequence(response(200, [{ keyword: 'alpha beta', count: 2 }]), response(204, null));
    await recordSearchKeyword(env, '  ALPHA BETA ');
    check('历史查询关键词 trim/lowercase', calls[0]?.url.includes('keyword=eq.alpha%20beta'));
    check('已有历史走 PATCH 且 count 加一', calls.length === 2 && calls[1].method === 'PATCH' && calls[1].body.count === 3);

    mockSequence(response(200, []), response(201, []));
    await recordSearchKeyword(env, '  NeW-Key ');
    check('无历史走 POST 并规范化关键词', calls.length === 2 && calls[1].method === 'POST' && calls[1].body.keyword === 'new-key' && calls[1].body.count === 1);

    mockSequence(response(404, { message: 'search_history missing' }));
    await recordSearchKeyword(env, 'alpha');
    check('GET 404 不继续 PATCH/POST', calls.length === 1);

    mockSequence(response(500, [{ keyword: 'alpha', count: 4 }]));
    await recordSearchKeyword(env, 'alpha');
    check('GET 500 即使返回数组也不当成有效历史', calls.length === 1);

    mockSequence(new Error('mock network down'));
    let recordRejected = false;
    try { await recordSearchKeyword(env, 'alpha'); } catch { recordRejected = true; }
    check('查询网络失败被隔离且不追加写请求', !recordRejected && calls.length === 1);

    mockSequence(invalidJsonResponse(200));
    recordRejected = false;
    try { await recordSearchKeyword(env, 'alpha'); } catch { recordRejected = true; }
    check('查询 JSON 解析失败被隔离且不追加写请求', !recordRejected && calls.length === 1);

    mockSequence(response(200, [{ keyword: 'alpha', count: 1 }]), response(500, { message: 'patch failed' }));
    recordRejected = false;
    try { await recordSearchKeyword(env, 'alpha'); } catch { recordRejected = true; }
    check('PATCH 非 2xx 不抛错且不触发额外请求', !recordRejected && calls.length === 2 && calls[1].method === 'PATCH');

    mockSequence(response(200, []), response(500, { message: 'post failed' }));
    recordRejected = false;
    try { await recordSearchKeyword(env, 'alpha'); } catch { recordRejected = true; }
    check('POST 非 2xx 不抛错且不触发额外请求', !recordRejected && calls.length === 2 && calls[1].method === 'POST');

    // getSearchSuggestions: respect response status, payload shape, normalization and limit.
    mockSequence(response(200, [{ keyword: 'alpha' }, { keyword: 'alpine' }]));
    const suggestions = await getSearchSuggestions(env, '  ALP ');
    check('建议结果返回关键词列表', Array.isArray(suggestions) && suggestions.join(',') === 'alpha,alpine');
    check('建议查询固定 limit=20 且 prefix trim/lowercase', calls.length === 1 && calls[0].url.includes('limit=20') && calls[0].url.includes('keyword=ilike.alp%'));

    mockSequence(response(200, [{ keyword: 'alpha' }]));
    await getSearchSuggestions(env, '   ');
    check('空白 prefix 不追加过滤条件', calls.length === 1 && calls[0].url.includes('limit=20') && !calls[0].url.includes('&keyword='));

    mockSequence(response(404, [{ keyword: 'must-not-leak' }]));
    const missingTableSuggestions = await getSearchSuggestions(env, 'a');
    check('建议查询 404 即使返回数组也返回空列表', Array.isArray(missingTableSuggestions) && missingTableSuggestions.length === 0);

    mockSequence(response(500, [{ keyword: 'must-not-leak' }]));
    const serverErrorSuggestions = await getSearchSuggestions(env, 'a');
    check('建议查询 500 不读取错误状态下的数组', Array.isArray(serverErrorSuggestions) && serverErrorSuggestions.length === 0);

    mockSequence(response(200, { message: 'malformed shape' }));
    const malformedSuggestions = await getSearchSuggestions(env, 'a');
    check('非数组 JSON 建议载荷返回空列表', Array.isArray(malformedSuggestions) && malformedSuggestions.length === 0);

    mockSequence(invalidJsonResponse(200));
    const invalidSuggestions = await getSearchSuggestions(env, 'a');
    check('建议 JSON 解析失败返回空列表', Array.isArray(invalidSuggestions) && invalidSuggestions.length === 0);

    mockSequence(new Error('mock suggestion network down'));
    const networkSuggestions = await getSearchSuggestions(env, 'a');
    check('建议网络失败返回空列表', Array.isArray(networkSuggestions) && networkSuggestions.length === 0);

    check('全部测试请求均指向隔离 mock origin', calls.every(call => call.url.startsWith('https://mock.supabase.co/')));
} finally {
    globalThis.fetch = originalFetch;
}

console.log('===== ' + pass + ' 通过 / ' + fail + ' 失败 =====');
process.exit(fail ? 1 : 0);