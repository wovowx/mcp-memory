// Real workerd/Miniflare runtime contracts for a small, high-risk Contents slice.
// No production tokens, GitHub writes, Supabase reads, or external requests.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createTestHarness } from 'wrangler';

const originalFetch = globalThis.fetch;
const payload = new TextEncoder().encode('Ziven workerd fixture\n');
const encodedPayload = Buffer.from(payload).toString('base64');
const fixtureUrl = 'https://workerd-fixture.example/storage/v1/object/public/files/sample.txt';
const gitPath = 'tests/workerd-fixture.txt';

let scenario = 'success';
let requests = [];
let githubGetCount = 0;

function fakeResponse(body, status = 200, headers = {}) {
    return new Response(body, { status, headers });
}

async function respondToOutbound(input, init = {}) {
    const request = input instanceof Request ? input : new Request(input, init);
    const { url, method, redirect } = request;
    if (!url.startsWith('https://workerd-fixture.example/') && !url.startsWith('https://api.github.com/')) {
        const hostname = new URL(url).hostname;
        if (hostname === '127.0.0.1' || hostname === 'localhost') return originalFetch(input, init);
        throw new Error('Unexpected outbound request blocked during workerd tests');
    }
    requests.push({ url, method, redirect });
    if (url.startsWith('https://workerd-fixture.example/')) {
        assert.equal(url, fixtureUrl, 'Only the synthetic object URL may be read');
        if (scenario === 'redirect') return fakeResponse(null, 302, { Location: 'https://outside.example/redirect' });
        if (scenario === 'missing-object') return fakeResponse('missing', 404);
        return fakeResponse(payload, 200, { 'Content-Type': 'application/octet-stream' });
    }
    assert.match(url, /^https:\/\/api\.github\.com\/repos\/wovowx\/mcp-memory\/contents\/tests\/workerd-fixture\.txt(?:\?ref=dev)?$/);
    if (scenario === 'github-denied') return Response.json({ message: 'synthetic forbidden' }, { status: 403 });
    if (method === 'PUT') {
        const body = JSON.parse(await request.clone().text());
        assert.equal(body.branch, 'dev');
        assert.equal(body.content, encodedPayload);
        return Response.json({ content: { sha: 'fixture-blob', html_url: 'https://example.invalid/file' }, commit: { sha: 'fixture-commit' } }, { status: 201 });
    }
    githubGetCount++;
    if (githubGetCount === 1) return Response.json({ message: 'not found' }, { status: 404 });
    return Response.json({ sha: 'fixture-blob', size: payload.byteLength, content: encodedPayload }, { status: 200 });
}

const server = createTestHarness({
    workers: [
        {
            configPath: './wrangler.toml',
            vars: { SUPABASE_URL: 'https://workerd-fixture.example' },
            secrets: { SUPABASE_ANON_KEY: 'synthetic-test-only' }
        },
        { configPath: './tests/worker_runtime_probe.wrangler.toml' }
    ]
});

before(async () => {
    globalThis.fetch = respondToOutbound;
    try { await server.listen(); }
    catch (error) { globalThis.fetch = originalFetch; throw error; }
});

after(async () => {
    try { await server.close(); }
    finally { globalThis.fetch = originalFetch; }
});

function resetScenario(name) {
    scenario = name;
    requests = [];
    githubGetCount = 0;
}

async function callProbe(overrides = {}) {
    const response = await server.getWorker('ziven-workerd-probe').fetch('/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo: 'wovowx/mcp-memory', branch: 'dev', path: gitPath,
            content_url: fixtureUrl, ...overrides })
    });
    assert.equal(response.status, 200);
    return response.json();
}

async function callCreate(overrides = {}) {
    const response = await server.getWorker('ziven-workerd-probe').fetch('/create', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo: 'wovowx/mcp-memory', branch: 'dev', path: gitPath,
            content: 'Ziven workerd fixture\n', ...overrides })
    });
    assert.equal(response.status, 200);
    return response.json();
}

test('the actual production entrypoint boots in workerd and answers MCP health', async () => {
    resetScenario('success');
    const response = await server.getWorker('mcp-memory').fetch('/mcp');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { service: 'ZivenAgent', status: 'ok', mcp: '/mcp' });
    assert.equal(requests.length, 0, 'health endpoint must not call external services');
});

test('native Worker fetch accepts the object URL and reaches verified GitHub write', async () => {
    resetScenario('success');
    const result = await callProbe();
    assert.equal(result.ok, true, JSON.stringify({ result, requests }));
    assert.equal(result.size, payload.byteLength);
    assert.equal(result.blobSha, 'fixture-blob');
    assert.deepEqual(requests.map(req => req.method), ['GET', 'GET', 'PUT', 'GET']);
    // The harness's Node outbound proxy does not preserve Request.redirect.
    // The workerd outcome (302 blocked; no GitHub call) is the relevant proof.
});

test('object storage redirect is rejected without contacting GitHub', async () => {
    resetScenario('redirect');
    const result = await callProbe();
    assert.equal(result.ok, false);
    assert.equal(result.code, 'CONTENT_FETCH_FAILED');
    assert.equal(requests.length, 1);
});

test('missing object is not misreported as a successful upload', async () => {
    resetScenario('missing-object');
    const result = await callProbe();
    assert.equal(result.code, 'CONTENT_FETCH_FAILED');
    assert.equal(requests.length, 1);
});

test('GitHub permission failure returns an explicit error and never issues PUT', async () => {
    resetScenario('github-denied');
    const result = await callProbe();
    assert.equal(result.ok, false);
    assert.equal(result.code, 'DESTINATION_CHECK_FAILED');
    assert.deepEqual(requests.map(req => req.method), ['GET', 'GET']);
});

test('main-branch writes are blocked before any network call', async () => {
    resetScenario('success');
    const result = await callProbe({ branch: 'main' });
    assert.equal(result.code, 'MAIN_WRITE_BLOCKED');
    assert.equal(requests.length, 0);
});

test('one-book direct text creation runs in native workerd with verified readback', async () => {
    resetScenario('success');
    const result = await callCreate();
    assert.equal(result.ok, true, JSON.stringify({ result, requests }));
    assert.equal(result.verified, true);
    assert.deepEqual(requests.map(req => req.method), ['GET', 'PUT', 'GET']);
});

test('one-book dry-run and main guard do not write from native workerd', async () => {
    resetScenario('success');
    const preview = await callCreate({ dry_run: true });
    assert.equal(preview.ok, true);
    assert.equal(preview.dryRun, true);
    assert.deepEqual(requests.map(req => req.method), ['GET']);
    resetScenario('success');
    const blocked = await callCreate({ branch: 'main' });
    assert.equal(blocked.code, 'BRANCH_NOT_ALLOWED');
    assert.equal(requests.length, 0);
});
