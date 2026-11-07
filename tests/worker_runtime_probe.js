// Test-only Worker: exercise the real GitHub Contents workflow with workerd's
// global fetch, without exposing an extra production route.
import { pushFileFromStorage } from '../src/modules/github/contents.js';
import { createGithubTextFile } from '../src/modules/scenes/github_file.js';
import { validateRepoRelativePath } from '../src/utils/helpers.js';

export default {
    async fetch(request, env) {
        const args = await request.json();
        const context = {
            repo: 'wovowx/mcp-memory',
            env,
            headers: {
                Authorization: 'Bearer synthetic-github-token',
                Accept: 'application/vnd.github+json'
            },
            fetchImpl: fetch,
            validateRepoRelativePath,
            base64ToUtf8(encoded) {
                return new TextDecoder().decode(Uint8Array.from(atob(encoded), c => c.charCodeAt(0)));
            },
            utf8ToBase64(text) {
                return btoa(String.fromCharCode(...new TextEncoder().encode(text)));
            }
        };
        const result = new URL(request.url).pathname === '/create'
            ? await createGithubTextFile(context, args)
            : await pushFileFromStorage(context, args);
        return Response.json(result);
    }
};
