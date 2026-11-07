// Test-only Worker: exercise the real GitHub Contents workflow with workerd's
// global fetch, without exposing an extra production route.
import { pushFileFromStorage } from '../src/modules/github/contents.js';
import { validateRepoRelativePath } from '../src/utils/helpers.js';

export default {
    async fetch(request, env) {
        const args = await request.json();
        const result = await pushFileFromStorage({
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
            }
        }, args);
        return Response.json(result);
    }
};
