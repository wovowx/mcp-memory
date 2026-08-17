// ============================================================
// GitHub Tools (Extended)
// ============================================================
// github_push / github_create_repo / github_read / github_list / github_delete
// 2026-08-17 FIX: btoa cannot handle Chinese -> UTF-8 safe base64

// UTF-8 safe base64 encode (supports Chinese)
function utf8ToBase64(str) {
    const bytes = new TextEncoder().encode(str);
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
}

// UTF-8 safe base64 decode (supports Chinese)
function base64ToUtf8(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
}

export async function handleGitHubTool(name, safeArgs, env) {
    let text = '';
    const token = env.GITHUB_TOKEN;
    const repo = env.GITHUB_REPO;
    if (!token) return 'ERROR: GitHub Token not configured. Set GITHUB_TOKEN in Cloudflare env vars';
    if (!repo) return 'ERROR: GitHub Repo not configured. Set GITHUB_REPO in Cloudflare env vars';

    const baseUrl = `https://api.github.com/repos/${repo}`;
    const ghHeaders = {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        'User-Agent': 'Cloudflare-Worker-MCP/1.0'
    };

    try {
        // ============================================
        // github_push - push/update file
        // ============================================
        if (name === 'github_push') {
            if (!safeArgs.path || !safeArgs.content) return 'ERROR: Missing path and content';
            const message = safeArgs.message || `Update ${safeArgs.path}`;
            const branch = safeArgs.branch || 'main';
            const base64Content = utf8ToBase64(safeArgs.content);
            const checkResp = await fetch(`${baseUrl}/contents/${safeArgs.path}?ref=${branch}`, { headers: ghHeaders });
            let sha = null;
            if (checkResp.ok) { const data = await checkResp.json(); sha = data.sha; }
            const body = { message, content: base64Content, branch };
            if (sha) body.sha = sha;
            const resp = await fetch(`${baseUrl}/contents/${safeArgs.path}`, {
                method: 'PUT', headers: ghHeaders, body: JSON.stringify(body)
            });
            if (!resp.ok) { const err = await resp.json(); throw new Error(err.message || `HTTP ${resp.status}`); }
            const data = await resp.json();
            text = `OK: File pushed to GitHub\nPath: ${safeArgs.path}\nMsg: ${message}\nURL: ${data.content?.html_url || 'pushed'}`;
        }

        // ============================================
        // github_create_repo - create repo
        // ============================================
        else if (name === 'github_create_repo') {
            if (!safeArgs.repo) return 'ERROR: Missing repo name';
            const resp = await fetch('https://api.github.com/user/repos', {
                method: 'POST',
                headers: ghHeaders,
                body: JSON.stringify({ name: safeArgs.repo, description: safeArgs.description || '', private: safeArgs.private || false, auto_init: true })
            });
            if (!resp.ok) { const err = await resp.json(); throw new Error(err.message || `HTTP ${resp.status}`); }
            const data = await resp.json();
            text = `OK: Repo created\nName: ${data.full_name}\nURL: ${data.html_url}`;
        }

        // ============================================
        // github_read - read file content
        // ============================================
        else if (name === 'github_read') {
            if (!safeArgs.path) return 'ERROR: Missing path';
            const branch = safeArgs.branch || 'main';
            const resp = await fetch(`${baseUrl}/contents/${safeArgs.path}?ref=${branch}`, { headers: ghHeaders });
            if (!resp.ok) { const err = await resp.json(); throw new Error(err.message || `HTTP ${resp.status}`); }
            const data = await resp.json();
            if (data.type === 'file') {
                const content = base64ToUtf8(data.content);
                text = `Path: ${data.path}\nSize: ${data.size} bytes\n\n${content.substring(0, 4000)}`;
            } else {
                text = `Path: ${data.path} is a directory`;
            }
        }

        // ============================================
        // github_list - list directory contents
        // ============================================
        else if (name === 'github_list') {
            const path = safeArgs.path || '';
            const branch = safeArgs.branch || 'main';
            const resp = await fetch(`${baseUrl}/contents/${path}?ref=${branch}`, { headers: ghHeaders });
            if (!resp.ok) { const err = await resp.json(); throw new Error(err.message || `HTTP ${resp.status}`); }
            const data = await resp.json();
            const items = Array.isArray(data) ? data : [data];
            text = 'Directory: ' + (path || '(root)') + '\n' +
                items.map(i => `${i.type === 'dir' ? '[DIR]' : '[FILE]'} ${i.name}${i.type === 'dir' ? '/' : ''}`).join('\n');
        }

        // ============================================
        // github_delete - delete file
        // ============================================
        else if (name === 'github_delete') {
            if (!safeArgs.path) return 'ERROR: Missing path';
            const branch = safeArgs.branch || 'main';
            const checkResp = await fetch(`${baseUrl}/contents/${safeArgs.path}?ref=${branch}`, { headers: ghHeaders });
            if (!checkResp.ok) { const err = await checkResp.json(); throw new Error(err.message || `HTTP ${checkResp.status}`); }
            const data = await checkResp.json();
            const resp = await fetch(`${baseUrl}/contents/${safeArgs.path}`, {
                method: 'DELETE',
                headers: ghHeaders,
                body: JSON.stringify({ message: safeArgs.message || `Delete ${safeArgs.path}`, sha: data.sha, branch })
            });
            if (!resp.ok) { const err = await resp.json(); throw new Error(err.message || `HTTP ${resp.status}`); }
            text = `DELETED: ${safeArgs.path}`;
        }

        else return 'ERROR: Unknown GitHub tool: ' + name;
    } catch (e) {
        return 'ERROR: ' + e.message;
    }
    return text;
}