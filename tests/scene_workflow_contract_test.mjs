// E2 end-to-end scene contracts: no real GitHub, Supabase, or private memory.
import assert from 'node:assert/strict';
import { createGithubTextFile, MAX_DIRECT_FILE_BYTES } from '../src/modules/scenes/github_file.js';
import { formatContentsResult } from '../src/modules/github/contents.js';
import { validateRepoRelativePath } from '../src/utils/helpers.js';
import { SESSION_CONTEXT_TOOL } from '../src/modules/session/bootstrap.js';
import { planLearningPreflight } from '../src/modules/reflection.js';
import { GITHUB_TOOL_DEFS, handleGitHubTool } from '../src/tools/github_v64.js';

const base64 = text => Buffer.from(text, 'utf8').toString('base64');
const fromBase64 = encoded => Buffer.from(encoded, 'base64').toString('utf8');
const respond = (data, status = 200) => ({ ok: status >= 200 && status < 300,
    status, json: async () => data });
let passed = 0;
function check(name, condition) { assert.ok(condition, name); console.log('  ✅ ' + name); passed++; }
function context(fetchImpl) {
    return {
        repo: 'wovowx/mcp-memory',
        env: { GITHUB_REPO: 'wovowx/mcp-memory', GITHUB_ALLOWED_REPOS: 'wovowx/ZivenLab' },
        headers: { Authorization: 'Bearer synthetic-token' }, fetchImpl,
        validateRepoRelativePath, utf8ToBase64: base64, base64ToUtf8: fromBase64
    };
}

console.log('\n[One-book: goal → primitive calls → verified text file]');
{
    const content = '柳柳与 Ziven\n新的一页！\n';
    const methods = [];
    let committed = false;
    const ctx = context(async (url, options = {}) => {
        methods.push(options.method || 'GET');
        if (options.method === 'PUT') {
            const body = JSON.parse(options.body);
            check('UTF-8 content is encoded without a target SHA', body.content === base64(content) && !('sha' in body) && body.branch === 'dev');
            committed = true;
            return respond({ commit: { sha: 'commit-one' }, content: { sha: 'blob-one' } }, 201);
        }
        if (!committed) return respond({ message: 'not found' }, 404);
        return respond({ type: 'file', content: base64(content), sha: 'blob-one', size: Buffer.byteLength(content) });
    });
    const created = await createGithubTextFile(ctx, { path: 'docs/ziven.txt', content });
    check('new file is created and verified, not just accepted by GitHub', created.ok && created.verified && created.size === Buffer.byteLength(content));
    check('scene follows existing get→put→verify primitives', methods.join(',') === 'GET,PUT,GET');
    check('public text facade preserves verifiable success', formatContentsResult('github_create_file', created).includes('Verified: true'));
}
{
    const methods = [];
    const ctx = context(async (url, options = {}) => { methods.push(options.method || 'GET'); return respond({ message: 'missing' }, 404); });
    const preview = await createGithubTextFile(ctx, { path: 'docs/new.md', content: '', dry_run: true });
    check('dry-run checks absence but never writes', preview.ok && preview.dryRun && preview.size === 0 && methods.join(',') === 'GET');
    check('dry-run text clearly says no write', formatContentsResult('github_create_file', preview).includes('No write performed'));
    methods.length = 0;
    const main = await createGithubTextFile(ctx, { branch: 'main', path: 'docs/new.md', content: 'x' });
    check('main is blocked before networking', main.code === 'BRANCH_NOT_ALLOWED' && methods.length === 0);
    const unapproved = await createGithubTextFile(ctx, { branch: 'other', path: 'docs/new.md', content: 'x' });
    check('arbitrary branch is not silently authorized', unapproved.code === 'BRANCH_NOT_ALLOWED' && methods.length === 0);
    const deniedRepo = await createGithubTextFile(ctx, { repo: 'elsewhere/unapproved', path: 'docs/new.md', content: 'x' });
    check('unapproved repository blocked', deniedRepo.code === 'REPOSITORY_NOT_ALLOWED' && methods.length === 0);
    const outside = await createGithubTextFile(ctx, { path: '../private', content: 'x' });
    check('path traversal blocked', outside.code === 'INVALID_REPO_PATH' && methods.length === 0);
    const huge = await createGithubTextFile(ctx, { path: 'huge.md', content: 'x'.repeat(MAX_DIRECT_FILE_BYTES + 1) });
    check('large content points to the existing upload path', huge.code === 'CONTENT_TOO_LARGE' && methods.length === 0);
    const missingContent = await createGithubTextFile(ctx, { path: 'huge.md' });
    check('missing content rejected, without writing', missingContent.code === 'CONTENT_REQUIRED' && methods.length === 0);
}
{
    const methods = [];
    const ctx = context(async (url, options = {}) => { methods.push(options.method || 'GET'); return respond({ message: 'permission denied' }, 403); });
    const failed = await createGithubTextFile(ctx, { path: 'docs/new.md', content: 'x' });
    check('failed target lookup is not misread as absence', failed.code === 'TARGET_CHECK_FAILED' && methods.join(',') === 'GET');
    check('tool failure gets explicit ERROR prefix for router success accounting', formatContentsResult('github_create_file', failed).startsWith('ERROR:'));
}
{
    let wrote = false;
    const ctx = context(async (url, options = {}) => {
        if (options.method === 'PUT') { wrote = true; return respond({ commit: { sha: 'commit-two' }, content: { sha: 'blob-two' } }, 201); }
        if (!wrote) return respond({ message: 'missing' }, 404);
        return respond({ type: 'file', content: base64('corrupted'), sha: 'blob-two', size: 9 });
    });
    const partial = await createGithubTextFile(ctx, { path: 'docs/bad.md', content: 'expected' });
    check('verification mismatch is PARTIAL and never claimed OK', !partial.ok && partial.partial && partial.written && partial.verifyCode === 'VERIFY_CONTENT_MISMATCH');
    const formatted = formatContentsResult('github_create_file', partial);
    check('partial result exposes where the write happened', formatted.includes('ERROR: CREATE_VERIFY_FAILED') && formatted.includes('docs/bad.md'));
}
{
    const ctx = context(async () => respond({ sha: 'old', content: base64('old') }));
    const existing = await createGithubTextFile(ctx, { path: 'docs/existing.md', content: 'new' });
    check('existing file never overwritten, even when content differs', existing.code === 'TARGET_EXISTS');
}

console.log('\n[One-book: real tool metadata, recovery and preflight boundaries]');
{
    const definition = GITHUB_TOOL_DEFS.find(tool => tool.name === 'github_create_file');
    check('new scene has one canonical schema and required path/content', definition?.input_schema?.required?.join(',') === 'path,content');
    check('session_context can receive host-advertised tools without asserting verification', SESSION_CONTEXT_TOOL.input_schema.properties.available_tools?.type === 'array');
    const lesson = {
        test_id: 'synthetic-scene', status: 'active', lesson_key: 'lesson-synthetic',
        application: { intent_any: ['create-github-file'], approval_ref: 'synthetic:reviewed',
            preferred_tool: 'github_create_file', steps: ['validate', 'create', 'verify'],
            allowed_repos: ['wovowx/mcp-memory'], allowed_branches: ['dev'] }
    };
    const task = { intent: 'create-github-file', entities: [], available_tools: ['github_create_file'],
        branch: 'dev', repo: 'wovowx/mcp-memory' };
    const guidance = planLearningPreflight(task, [lesson]);
    check('approved synthetic lesson guides selection but does not execute', guidance.status === 'READY' && guidance.recommended_tool === 'github_create_file' && guidance.advisory_only && !guidance.executed && !guidance.host_verified);
    check('missing host capability blocks advice', planLearningPreflight({ ...task, available_tools: [] }, [lesson]).status === 'UNAVAILABLE');
    check('pending evidence never activates a lesson', planLearningPreflight(task, [{ ...lesson, status: 'candidate' }]).status === 'PENDING_REVIEW');
}
{
    const fakeNetwork = () => { throw new Error('Do not call GitHub for invalid target'); };
    const prior = globalThis.fetch;
    globalThis.fetch = fakeNetwork;
    try {
        const noToken = await handleGitHubTool('github_create_file', { path: 'x.txt', content: 'x' }, {
            GITHUB_REPO: 'wovowx/mcp-memory'
        });
        check('public handler missing token fails without calls or false success', noToken.startsWith('ERROR: GitHub Token not configured'));
    } finally { globalThis.fetch = prior; }
}
console.log(`\n[One-book scenes] ${passed}/${passed} passed`);
