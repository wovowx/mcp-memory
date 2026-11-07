// GitHub Contents domain contract tests.
// Run: node tests/github_contents_contract_test.mjs
import assert from 'node:assert/strict';
import {
    getContent, listContents, getTree, putContent, deleteContent, verifyContent,
    pushFileFromStorage, editFileByAnchors, deleteFile, copyFile, movePath
} from '../src/modules/github/contents.js';
import { validateRepoRelativePath } from '../src/utils/helpers.js';
import { GITHUB_TOOL_DEFS, restoreBranchReference, handleGitHubTool } from '../src/tools/github_v64.js';
import { formatContentsResult } from '../src/modules/github/contents.js';
import { BRANCH_PR_TOOL_NAMES, handleBranchPrTool } from '../src/modules/github/branch_pr.js';

const jsonResponse = (payload, status = 200) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload
});
const base64 = value => Buffer.from(value, 'utf8').toString('base64');
const decoded = value => Buffer.from(value, 'base64').toString('utf8');
const file = (content, sha) => ({
    type: 'file',
    content: base64(content),
    sha,
    size: Buffer.byteLength(content, 'utf8')
});
const makeContext = fetchImpl => ({
    repo: 'wovowx/mcp-memory',
    env: {
        GITHUB_REPO: 'wovowx/mcp-memory',
        GITHUB_ALLOWED_REPOS: 'wovowx/ZivenLab',
        SUPABASE_URL: 'https://mock.supabase.co'
    },
    headers: { Authorization: 'Bearer mock-token' },
    fetchImpl,
    validateRepoRelativePath,
    base64ToUtf8: decoded,
    utf8ToBase64: base64,
    findSimilarCandidates: () => 'candidate'
});
let pass = 0;
const check = (name, condition) => {
    assert.equal(Boolean(condition), true, name);
    pass++;
    console.log('  ✅ ' + name);
};

console.log('\n[GitHub Contents primitive contracts]');
{
    const calls = [];
    const ctx = makeContext(async (url, options = {}) => {
        calls.push({ url: String(url), options });
        if (String(url).includes('/missing?')) return jsonResponse({ message: 'not found' }, 404);
        return jsonResponse({ message: 'server error' }, 500);
    });
    const missing = await getContent(ctx, { repo: ctx.repo, path: 'missing', branch: 'dev' });
    const failed = await getContent(ctx, { repo: ctx.repo, path: 'broken', branch: 'dev' });
    check('404 is distinguished from a non-404 API failure', missing.code === 'NOT_FOUND' && missing.status === 404 && failed.code === 'GITHUB_API_ERROR' && failed.status === 500);
    check('content paths and refs are URL encoded', calls[0].url.endsWith('/contents/missing?ref=dev'));
}
{
    const ctx = makeContext(async url => jsonResponse({ sha: 'tree-sha', truncated: true, tree: [{ path: 'a', type: 'blob' }] }));
    const tree = await getTree(ctx, { repo: ctx.repo, ref: 'dev', recursive: true });
    check('tree primitive exposes the truncated flag instead of hiding it', tree.ok && tree.truncated && tree.tree.length === 1);
}
{
    const calls = [];
    const ctx = makeContext(async (url, options = {}) => {
        calls.push({ url: String(url), options });
        return jsonResponse({ commit: { sha: 'commit-1' }, content: { sha: 'blob-1' } });
    });
    const put = await putContent(ctx, { repo: ctx.repo, path: 'a.txt', branch: 'dev', contentBase64: base64('a') });
    check('put primitive serializes branch/content and returns commit+blob SHA', put.ok && put.contentSha === 'blob-1' && JSON.parse(calls[0].options.body).branch === 'dev');
    const denied = await putContent(ctx, { repo: ctx.repo, path: 'a.txt', branch: 'main', contentBase64: base64('a') });
    check('put primitive independently refuses main writes', !denied.ok && denied.code === 'MAIN_WRITE_BLOCKED');
}
{
    let deletedBody;
    const ctx = makeContext(async (url, options = {}) => {
        deletedBody = JSON.parse(options.body);
        return jsonResponse({ commit: { sha: 'delete-commit' } });
    });
    const deleted = await deleteContent(ctx, { repo: ctx.repo, path: 'a.txt', branch: 'dev', sha: 'blob-a' });
    check('delete primitive requires blob SHA and preserves the target branch', deleted.ok && deleted.commitSha === 'delete-commit' && deletedBody.sha === 'blob-a' && deletedBody.branch === 'dev');
    const noSha = await deleteContent(ctx, { repo: ctx.repo, path: 'a.txt', branch: 'dev' });
    check('delete primitive rejects deletion without a blob SHA', !noSha.ok && noSha.code === 'MISSING_BLOB_SHA');
}
{
    const ctx = makeContext(async () => jsonResponse(file('exact', 'blob-exact')));
    const verified = await verifyContent(ctx, { repo: ctx.repo, path: 'a.txt', branch: 'dev', expectedSha: 'blob-exact', expectedContent: 'exact' });
    check('verify primitive can compare both SHA and exact UTF-8 content', verified.ok);
}

console.log('\n[GitHub Contents workflow contracts]');
{
    // Cloudflare's native fetch requires a valid receiver. A bare stored
    // function call can throw "Illegal invocation" before GitHub is touched.
    let boundFetches = 0;
    let committed = false;
    const ctx = makeContext(async function (url, options = {}) {
        if (this !== globalThis) throw new TypeError('Illegal invocation: incorrect this reference');
        const address = String(url);
        if (address.startsWith('https://mock.supabase.co/')) {
            boundFetches++;
            const bytes = new TextEncoder().encode('safe');
            return { ok: true, status: 200, arrayBuffer: async () => bytes.buffer };
        }
        if (address.includes('/contents/bound.txt?ref=dev') && !committed) {
            return jsonResponse({ message: 'not found' }, 404);
        }
        if (address.endsWith('/contents/bound.txt') && options.method === 'PUT') {
            committed = true;
            return jsonResponse({ commit: { sha: 'bound-commit' }, content: { sha: 'bound-blob' } });
        }
        if (address.includes('/contents/bound.txt?ref=dev')) {
            return jsonResponse(file('safe', 'bound-blob'));
        }
        throw new Error('Unexpected request: ' + address);
    });
    const result = await pushFileFromStorage(ctx, {
        path: 'bound.txt',
        content_url: 'https://mock.supabase.co/storage/v1/object/public/files/bound.txt'
    });
    check('push binds native fetch receiver for Supabase content_url (Cloudflare Illegal invocation regression)', result.ok && boundFetches === 1);
}
{
    let putCount = 0;
    let storageFetchCount = 0;
    let putBody;
    const ctx = makeContext(async (url, options = {}) => {
        const address = String(url);
        if (address.startsWith('https://mock.supabase.co/')) {
            storageFetchCount++;
            return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0) };
        }
        if (address.includes('/contents/empty.bin?ref=dev')) {
            if ((options.method || 'GET') === 'GET' && !putCount) return jsonResponse({ message: 'not found' }, 404);
            return jsonResponse({ type: 'file', content: '', sha: 'blob-empty', size: 0 });
        }
        if (address.endsWith('/contents/empty.bin') && options.method === 'PUT') {
            putCount++;
            putBody = JSON.parse(options.body);
            return jsonResponse({ commit: { sha: 'commit-empty' }, content: { sha: 'blob-empty', html_url: 'https://github.com/mock/empty.bin' } });
        }
        throw new Error('Unexpected request: ' + address);
    });
    const pushed = await pushFileFromStorage(ctx, {
        path: 'empty.bin',
        content_url: 'https://mock.supabase.co/storage/v1/object/public/files/empty.bin'
    });
    check('push defaults to dev and supports a legitimate zero-byte file', pushed.ok && pushed.branch === 'dev' && pushed.size === 0 && putBody.branch === 'dev' && putBody.content === '');
    check('push fetches only the exact configured Supabase origin', storageFetchCount === 1);
}
{
    let verifyReads = 0;
    const ctx = makeContext(async (url, options = {}) => {
        const address = String(url);
        if (address.startsWith('https://mock.supabase.co/')) {
            const bytes = new TextEncoder().encode('abc');
            return { ok: true, status: 200, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
        }
        if (address.includes('/contents/retry.txt?ref=dev')) {
            verifyReads++;
            if (verifyReads === 1) return jsonResponse({ message: 'not yet visible' }, 404);
            return jsonResponse({ type: 'file', content: base64('abc'), sha: 'retry-blob', size: 3 });
        }
        if (address.endsWith('/contents/retry.txt') && options.method === 'PUT') {
            return jsonResponse({ commit: { sha: 'retry-commit' }, content: { sha: 'retry-blob' } });
        }
        throw new Error('Unexpected request: ' + address);
    });
    const result = await pushFileFromStorage(ctx, {
        path: 'retry.txt',
        content_url: 'https://mock.supabase.co/storage/v1/object/public/files/retry.txt'
    });
    check('push retries a transient read-after-write 404 and confirms the resulting blob', result.ok && verifyReads === 2);
}
{
    let putCount = 0;
    let storageFetchCount = 0;
    const ctx = makeContext(async url => {
        const address = String(url);
        if (address.startsWith('https://mock.supabase.co/')) {
            storageFetchCount++;
            const bytes = new TextEncoder().encode('content');
            return { ok: true, status: 200, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
        }
        if (address.includes('/contents/new.txt?ref=dev')) return jsonResponse({ message: 'forbidden' }, 500);
        if (address.endsWith('/contents/new.txt')) putCount++;
        return jsonResponse({});
    });
    const result = await pushFileFromStorage(ctx, { path: 'new.txt', content_url: 'https://mock.supabase.co/storage/v1/object/public/files/new.txt' });
    check('push aborts on a destination-check 500; it does not interpret 500 as absence', !result.ok && result.code === 'DESTINATION_CHECK_FAILED' && putCount === 0 && storageFetchCount === 1);
}
{
    let calls = 0;
    const ctx = makeContext(async () => { calls++; return jsonResponse({}); });
    const result = await pushFileFromStorage(ctx, {
        path: 'blocked.txt', branch: 'main',
        content_url: 'https://mock.supabase.co/storage/v1/object/public/files/blocked.txt'
    });
    check('push explicitly rejects main even when called outside the router', !result.ok && result.code === 'MAIN_WRITE_BLOCKED' && calls === 0);
}
{
    const calls = [];
    let putBody;
    const ctx = makeContext(async (url, options = {}) => {
        const address = String(url);
        calls.push({ address, options });
        if (address.includes('/contents/source.txt?ref=main')) return jsonResponse(file('', 'source-empty'));
        if (address.includes('/contents/target.txt?ref=dev') && !putBody) return jsonResponse({ message: 'not found' }, 404);
        if (address.endsWith('/contents/target.txt') && options.method === 'PUT') {
            putBody = JSON.parse(options.body);
            return jsonResponse({ commit: { sha: 'copy-commit' }, content: { sha: 'source-empty' } });
        }
        if (address.includes('/contents/target.txt?ref=dev')) return jsonResponse(file('', 'source-empty'));
        throw new Error('Unexpected request: ' + address);
    });
    const copied = await copyFile(ctx, {
        source_repo: ctx.repo, source_path: 'source.txt',
        target_repo: 'wovowx/ZivenLab', target_path: 'target.txt'
    });
    check('copy defaults source to read-only main and target write to dev; empty content verifies by SHA', copied.ok && copied.sourceBranch === 'main' && copied.targetBranch === 'dev' && copied.size === 0 && putBody.branch === 'dev');
    check('copy performs sequential target verification', calls.filter(call => call.options.method === 'PUT').length === 1);
}
{
    let putCount = 0;
    const ctx = makeContext(async url => {
        const address = String(url);
        if (address.includes('/contents/source.txt?ref=main')) return jsonResponse(file('source', 'source-sha'));
        if (address.includes('/contents/target.txt?ref=dev')) return jsonResponse({ message: 'permission denied' }, 500);
        if (address.endsWith('/contents/target.txt')) putCount++;
        return jsonResponse({});
    });
    const result = await copyFile(ctx, {
        source_repo: ctx.repo, source_path: 'source.txt',
        target_repo: 'wovowx/ZivenLab', target_path: 'target.txt'
    });
    check('copy aborts on target-check 500 without attempting a write', !result.ok && result.code === 'TARGET_CHECK_FAILED' && putCount === 0);
}
{
    const disallowedSource = makeContext(async () => { throw new Error('must not fetch'); });
    const sourceResult = await copyFile(disallowedSource, {
        source_repo: 'someone/private', source_path: 'a', target_repo: disallowedSource.repo, target_path: 'b'
    });
    const targetResult = await copyFile(disallowedSource, {
        source_repo: disallowedSource.repo, source_path: 'a', target_repo: 'someone/private', target_path: 'b'
    });
    check('copy checks both source and target repositories against the allowlist', sourceResult.code === 'REPOSITORY_NOT_ALLOWED' && targetResult.code === 'REPOSITORY_NOT_ALLOWED');
}
{
    let reads = 0;
    let verifyStatus = 500;
    const ctx = makeContext(async (url, options = {}) => {
        const address = String(url);
        if (address.includes('/contents/edit.txt?ref=dev')) {
            reads++;
            if (reads === 1) return jsonResponse(file('before text', 'old-sha'));
            if (options.method === 'GET') return jsonResponse({ message: 'verification unavailable' }, verifyStatus);
        }
        if (address.endsWith('/contents/edit.txt') && options.method === 'PUT') {
            const payload = JSON.parse(options.body);
            check('edit write sends the prior blob SHA to protect against stale writes', payload.sha === 'old-sha' && payload.branch === 'dev');
            return jsonResponse({ commit: { sha: 'edit-commit' }, content: { sha: 'new-sha' } });
        }
        throw new Error('Unexpected request: ' + address);
    });
    const edited = await editFileByAnchors(ctx, { path: 'edit.txt', operations: [{ old: 'before', new: 'after' }] });
    check('edit returns a partial-write status when the PUT succeeded but readback is HTTP 500', !edited.ok && edited.partial && edited.written && edited.code === 'EDIT_VERIFY_FAILED');
}
{
    let deleteBody;
    const ctx = makeContext(async (url, options = {}) => {
        if (String(url).includes('/contents/delete.txt?ref=dev')) return jsonResponse(file('delete me', 'delete-sha'));
        if (String(url).endsWith('/contents/delete.txt') && options.method === 'DELETE') {
            deleteBody = JSON.parse(options.body);
            return jsonResponse({ commit: { sha: 'delete-commit' } });
        }
        throw new Error('Unexpected request: ' + String(url));
    });
    const deleted = await deleteFile(ctx, { path: 'delete.txt' });
    check('delete defaults to dev and uses the current blob SHA', deleted.ok && deleted.branch === 'dev' && deleteBody.branch === 'dev' && deleteBody.sha === 'delete-sha');
    const denied = await deleteFile(ctx, { path: 'delete.txt', branch: 'main' });
    check('delete independently blocks explicit main writes', !denied.ok && denied.code === 'MAIN_WRITE_BLOCKED');
}

console.log('\n[GitHub move safety contracts]');
{
    let directoryReads = 0;
    let sourceFileReads = 0;
    let putCount = 0;
    let deleteCount = 0;
    const ctx = makeContext(async (url, options = {}) => {
        const address = String(url);
        if (address.includes('/git/trees/dev?recursive=1')) {
            return jsonResponse({ truncated: true, tree: [{ path: 'docs/a.txt', type: 'blob' }] });
        }
        if (address.includes('/contents/docs?ref=dev')) {
            directoryReads++;
            return directoryReads === 1
                ? jsonResponse([{ type: 'file', name: 'a.txt', path: 'docs/a.txt' }])
                : jsonResponse([{ type: 'file', name: 'a.txt', path: 'docs/a.txt' }]);
        }
        if (address.includes('/contents/docs/a.txt?ref=dev')) {
            sourceFileReads++;
            return jsonResponse(file('copied snapshot', sourceFileReads <= 1 ? 'source-v1' : 'source-v2'));
        }
        if (address.includes('/contents/archive/a.txt?ref=dev')) {
            return putCount ? jsonResponse(file('copied snapshot', 'source-v1')) : jsonResponse({ message: 'not found' }, 404);
        }
        if (address.endsWith('/contents/archive/a.txt') && options.method === 'PUT') {
            putCount++;
            return jsonResponse({ commit: { sha: 'copy-commit' }, content: { sha: 'source-v1' } });
        }
        if (options.method === 'DELETE') { deleteCount++; return jsonResponse({}); }
        throw new Error('Unexpected request: ' + address);
    });
    const moved = await movePath(ctx, {
        source_repo: ctx.repo, source_path: 'docs',
        target_repo: 'wovowx/ZivenLab', target_path: 'archive'
    });
    check('move detects a truncated recursive tree and falls back to directory traversal', moved.code === 'SOURCE_CHANGED_AFTER_COPY' && moved.copied?.length === 1 && moved.copied[0].source === 'docs/a.txt');
    check('move rechecks source SHA after copy and never deletes a concurrently changed source', sourceFileReads === 2 && deleteCount === 0 && moved.sourcesRemaining.includes('docs/a.txt'));
}
{
    let readsA = 0;
    let readsB = 0;
    let targetWritten = new Set();
    let deletePaths = [];
    const ctx = makeContext(async (url, options = {}) => {
        const address = String(url);
        if (address.includes('/contents/docs?ref=dev')) return jsonResponse([{ type: 'file', path: 'docs/a.txt' }, { type: 'file', path: 'docs/b.txt' }]);
        if (address.includes('/git/trees/dev?recursive=1')) return jsonResponse({
            truncated: false,
            tree: [{ path: 'docs/a.txt', type: 'blob' }, { path: 'docs/b.txt', type: 'blob' }]
        });
        if (address.includes('/contents/docs/a.txt?ref=dev')) { readsA++; return jsonResponse(file('A', 'sha-a')); }
        if (address.includes('/contents/docs/b.txt?ref=dev')) { readsB++; return jsonResponse(file('B', 'sha-b')); }
        if (address.includes('/contents/archive/a.txt?ref=dev')) return targetWritten.has('a') ? jsonResponse(file('A', 'sha-a')) : jsonResponse({},404);
        if (address.includes('/contents/archive/b.txt?ref=dev')) return targetWritten.has('b') ? jsonResponse(file('B', 'sha-b')) : jsonResponse({},404);
        if (options.method === 'PUT' && address.endsWith('/contents/archive/a.txt')) {
            targetWritten.add('a'); return jsonResponse({ commit: { sha: 'ca' }, content: { sha: 'sha-a' } });
        }
        if (options.method === 'PUT' && address.endsWith('/contents/archive/b.txt')) {
            targetWritten.add('b'); return jsonResponse({ commit: { sha: 'cb' }, content: { sha: 'sha-b' } });
        }
        if (address.includes('/contents/docs/a.txt?ref=dev')) return jsonResponse(file('A', 'sha-a'));
        if (address.includes('/contents/docs/b.txt?ref=dev') && options.method !== 'DELETE') return jsonResponse(file('B', 'sha-b'));
        if (options.method === 'DELETE') {
            deletePaths.push(address);
            return deletePaths.length === 1 ? jsonResponse({ commit: { sha: 'da' } }) : jsonResponse({ message: 'delete failed' }, 500);
        }
        throw new Error('Unexpected request: ' + address);
    });
    const moved = await movePath(ctx, {
        source_repo: ctx.repo, source_path: 'docs',
        target_repo: 'wovowx/ZivenLab', target_path: 'archive'
    });
    check('move reports partial source deletion explicitly and stops after the first delete failure', moved.code === 'MOVE_DELETE_PARTIAL' && moved.sourcesDeleted[0] === 'docs/a.txt' && moved.sourcesRemaining[0] === 'docs/b.txt' && deletePaths.length === 2);
}
{
    let calls = 0;
    const ctx = makeContext(async () => { calls++; throw new Error('must not fetch'); });
    const result = await movePath(ctx, {
        source_repo: ctx.repo, source_branch: 'main', source_path: 'docs',
        target_repo: 'wovowx/ZivenLab', target_path: 'archive'
    });
    check('move never deletes from main, including when explicitly requested', !result.ok && result.code === 'SOURCE_MAIN_DELETE_BLOCKED' && calls === 0);
}


console.log('\n[Fetch binding + exact dev ref restore]');
{
    let receiverCorrect = false;
    function fetchWithReceiver() {
        receiverCorrect = this === globalThis;
        return Promise.resolve(jsonResponse(file('ok', 'blob-ok')));
    }
    const ctx = makeContext(fetchWithReceiver);
    await getContent(ctx, { repo: ctx.repo, path: 'ok.txt', branch: 'dev' });
    check('Cloudflare Worker global fetch keeps its required receiver', receiverCorrect);
}
{
    const targetSha = 'aeb6a8ebed19575e587d3c21dde3fb51e3597a84';
    const expectedSha = '5532a3ea52aa71e1362f830b66811abd1242d8fb';
    const calls = [];
    let moved = false;
    const fetchImpl = async (url, options = {}) => {
        const address = String(url);
        calls.push({ address, options });
        if (address.endsWith(`/commits/${targetSha}`)) return jsonResponse({ sha: targetSha });
        if (address.endsWith('/git/ref/heads/dev')) return jsonResponse({ object: { sha: moved ? targetSha : expectedSha } });
        if (address.endsWith('/git/refs/heads/dev') && options.method === 'PATCH') {
            moved = true;
            return jsonResponse({ ref: 'refs/heads/dev' });
        }
        throw new Error('Unexpected request: ' + address);
    };
    const restored = await restoreBranchReference({
        baseUrl: 'https://api.github.com/repos/wovowx/mcp-memory',
        headers: { Authorization: 'Bearer mock' },
        branch: 'dev', targetSha, expectedSha, fetchImpl
    });
    check('exact dev restore checks commit and expected HEAD, then verifies the new ref', restored.ok && restored.previousSha === expectedSha && restored.sha === targetSha && calls.length === 4);
    check('exact dev restore uses force PATCH with only the approved SHA', calls[2].options.method === 'PATCH' && JSON.parse(calls[2].options.body).sha === targetSha && JSON.parse(calls[2].options.body).force === true);
}
{
    let calls = 0;
    const result = await restoreBranchReference({
        baseUrl: 'https://api.github.com/repos/wovowx/mcp-memory', headers: {},
        branch: 'main', targetSha: 'aeb6a8ebed19575e587d3c21dde3fb51e3597a84',
        expectedSha: '5532a3ea52aa71e1362f830b66811abd1242d8fb',
        fetchImpl: async () => { calls++; return jsonResponse({}); }
    });
    check('exact restore categorically refuses main without making a request', !result.ok && result.code === 'BRANCH_NOT_ALLOWED' && calls === 0);
}
{
    const calls = [];
    const result = await restoreBranchReference({
        baseUrl: 'https://api.github.com/repos/wovowx/mcp-memory', headers: {}, branch: 'dev',
        targetSha: 'aeb6a8ebed19575e587d3c21dde3fb51e3597a84',
        expectedSha: '5532a3ea52aa71e1362f830b66811abd1242d8fb',
        fetchImpl: async (url, options = {}) => {
            calls.push({ url: String(url), options });
            if (String(url).endsWith('/commits/aeb6a8ebed19575e587d3c21dde3fb51e3597a84')) return jsonResponse({ sha: 'aeb6a8ebed19575e587d3c21dde3fb51e3597a84' });
            return jsonResponse({ object: { sha: '1111111111111111111111111111111111111111' } });
        }
    });
    check('exact restore rejects a stale expected HEAD before PATCH', !result.ok && result.code === 'HEAD_MISMATCH' && calls.length === 2 && calls.every(call => call.options.method !== 'PATCH'));
}

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

console.log('\n[Facade schema defaults]');
const definition = name => GITHUB_TOOL_DEFS.find(item => item.name === name);
check('github_push schema documents default dev', definition('github_push')?.input_schema?.properties?.branch?.description?.includes('默认dev'));
check('github_delete schema documents default dev', definition('github_delete')?.input_schema?.properties?.branch?.description?.includes('默认dev'));
check('github_copy target schema documents default dev', definition('github_copy')?.input_schema?.properties?.target_branch?.description?.includes('默认dev'));
check('github_move source and target schemas document default dev', definition('github_move')?.input_schema?.properties?.source_branch?.description?.includes('默认dev') && definition('github_move')?.input_schema?.properties?.target_branch?.description?.includes('默认dev'));
const copyOutput = JSON.parse(formatContentsResult('github_copy', { ok: true, sourceRepo: 'a', sourceBranch: 'main', sourcePath: 'a.txt', sourceSize: 3, targetRepo: 'b', targetBranch: 'dev', targetPath: 'b.txt', size: 3, sourceSha: 'blob-a', commitSha: 'commit-b', overwritten: false }));
check('github_copy keeps its established snake_case response fields', copyOutput.success === true && copyOutput.source_repo === 'a' && copyOutput.target_branch === 'dev' && copyOutput.file_sha === 'blob-a');
const moveOutput = JSON.parse(formatContentsResult('github_move', { ok: true, moved: 1, isDirectory: false, sourceRepo: 'a', sourceBranch: 'dev', sourcePath: 'a.txt', targetRepo: 'b', targetBranch: 'dev', targetPath: 'b.txt', verifiedAll: true, files: [{ source: 'a.txt', target: 'b.txt', sha: 'blob-a', size: 3 }] }));
check('github_move keeps its established snake_case response fields', moveOutput.success === true && moveOutput.is_dir === false && moveOutput.verified_all === true && moveOutput.files[0].source === 'a.txt');

console.log('\n[Branch/PR domain boundary contracts]');
// Complete workflows remain behind the stable facade and use a single domain module.
check('Branch/PR domain exposes all eight existing tool routes',
  ['github_merge_to_main', 'github_create_pull_request', 'github_merge_pull_request',
   'github_close_pull_request', 'github_compare_branches', 'github_get_pull_request',
   'github_sync_branch', 'github_create_branch'].every(name => BRANCH_PR_TOOL_NAMES.has(name))
  && BRANCH_PR_TOOL_NAMES.size === 8);
check('Branch/PR module does not claim unrelated Contents/Patch tools',
  !BRANCH_PR_TOOL_NAMES.has('github_push') && !BRANCH_PR_TOOL_NAMES.has('github_apply_patch'));
const branchMissingPr = await handleBranchPrTool('github_merge_pull_request', {}, {
  repo: 'wovowx/mcp-memory', baseUrl: 'https://api.github.com/repos/wovowx/mcp-memory', ghHeaders: {}
});
check('Branch/PR domain rejects missing PR ID before any network call',
  branchMissingPr === 'ERROR: Missing pull_number');

console.log('\n' + pass + ' GitHub Contents checks passed.');
