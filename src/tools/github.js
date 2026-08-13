// ============================================================
// GitHub 工具（扩展版）
// ============================================================
// github_push / github_create_repo / github_read / github_list / github_delete

export async function handleGitHubTool(name, safeArgs, env) {
    let text = '';
    const token = env.GITHUB_TOKEN;
    const repo = env.GITHUB_REPO;
    if (!token) return '❌ GitHub Token 未配置，请在 Cloudflare 环境变量中设置 GITHUB_TOKEN';
    if (!repo) return '❌ GitHub Repo 未配置，请在 Cloudflare 环境变量中设置 GITHUB_REPO';

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
        // github_push - 推送/更新文件
        // ============================================
        if (name === 'github_push') {
            if (!safeArgs.path || !safeArgs.content) return '❌ 缺少参数：需要 path 和 content';
            const message = safeArgs.message || `更新 ${safeArgs.path}`;
            const branch = safeArgs.branch || 'main';
            const base64Content = btoa(safeArgs.content);
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
            text = `✅ 文件已提交到 GitHub\n📂 ${safeArgs.path}\n📝 ${message}\n🔗 ${data.content?.html_url || '已推送'}`;
        }

        // ============================================
        // github_create_repo - 创建仓库
        // ============================================
        else if (name === 'github_create_repo') {
            if (!safeArgs.repo) return '❌ 缺少参数：需要 repo（仓库名）';
            const resp = await fetch('https://api.github.com/user/repos', {
                method: 'POST',
                headers: ghHeaders,
                body: JSON.stringify({ name: safeArgs.repo, description: safeArgs.description || '', private: safeArgs.private || false, auto_init: true })
            });
            if (!resp.ok) { const err = await resp.json(); throw new Error(err.message || `HTTP ${resp.status}`); }
            const data = await resp.json();
            text = `✅ GitHub 仓库已创建\n📂 ${data.full_name}\n🔗 ${data.html_url}`;
        }

        // ============================================
        // github_read - 读取文件内容
        // ============================================
        else if (name === 'github_read') {
            if (!safeArgs.path) return '❌ 缺少参数：需要 path';
            const branch = safeArgs.branch || 'main';
            const resp = await fetch(`${baseUrl}/contents/${safeArgs.path}?ref=${branch}`, { headers: ghHeaders });
            if (!resp.ok) { const err = await resp.json(); throw new Error(err.message || `HTTP ${resp.status}`); }
            const data = await resp.json();
            if (data.type === 'file') {
                const content = atob(data.content);
                text = `📂 ${data.path}\n📝 ${data.size} bytes\n\n${content.substring(0, 4000)}`;
            } else {
                text = `📂 ${data.path} 是一个目录`;
            }
        }

        // ============================================
        // github_list - 列出目录内容
        // ============================================
        else if (name === 'github_list') {
            const path = safeArgs.path || '';
            const branch = safeArgs.branch || 'main';
            const resp = await fetch(`${baseUrl}/contents/${path}?ref=${branch}`, { headers: ghHeaders });
            if (!resp.ok) { const err = await resp.json(); throw new Error(err.message || `HTTP ${resp.status}`); }
            const data = await resp.json();
            const items = Array.isArray(data) ? data : [data];
            text = '📂 ' + (path || '(根目录)') + ' 内容：\n' +
                items.map(i => `${i.type === 'dir' ? '📁' : '📄'} ${i.name}${i.type === 'dir' ? '/' : ''}`).join('\n');
        }

        // ============================================
        // github_delete - 删除文件
        // ============================================
        else if (name === 'github_delete') {
            if (!safeArgs.path) return '❌ 缺少参数：需要 path';
            const branch = safeArgs.branch || 'main';
            const checkResp = await fetch(`${baseUrl}/contents/${safeArgs.path}?ref=${branch}`, { headers: ghHeaders });
            if (!checkResp.ok) { const err = await checkResp.json(); throw new Error(err.message || `HTTP ${checkResp.status}`); }
            const data = await checkResp.json();
            const resp = await fetch(`${baseUrl}/contents/${safeArgs.path}`, {
                method: 'DELETE',
                headers: ghHeaders,
                body: JSON.stringify({ message: safeArgs.message || `删除 ${safeArgs.path}`, sha: data.sha, branch })
            });
            if (!resp.ok) { const err = await resp.json(); throw new Error(err.message || `HTTP ${resp.status}`); }
            text = `🗑️ 已删除：${safeArgs.path}`;
        }

        else return '❌ 未知 GitHub 工具：' + name;
    } catch (e) {
        return '❌ 执行失败：' + e.message;
    }
    return text;
}