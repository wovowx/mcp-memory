// ============================================================
// GitHub 工具
// ============================================================
export async function handleGitHubTool(name, safeArgs, env) {
    let text = '';
    const token = env.GITHUB_TOKEN;
    const repo = env.GITHUB_REPO;
    if (!token) return '❌ GitHub Token 未配置，请在 Cloudflare 环境变量中设置 GITHUB_TOKEN';
    if (!repo) return '❌ GitHub Repo 未配置，请在 Cloudflare 环境变量中设置 GITHUB_REPO';
    if (name === 'github_push') {
        if (!safeArgs.path || !safeArgs.content) return '❌ 缺少参数：需要 path（文件路径）和 content（文件内容）';
        try {
            const message = safeArgs.message || `更新 ${safeArgs.path}`;
            const branch = safeArgs.branch || 'main';
            const base64Content = btoa(safeArgs.content);
            const checkResp = await fetch(`https://api.github.com/repos/${repo}/contents/${safeArgs.path}?ref=${branch}`, {
                headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'Cloudflare-Worker-MCP/1.0' }
            });
            let sha = null;
            if (checkResp.ok) { const data = await checkResp.json(); sha = data.sha; }
            const body = { message: message, content: base64Content, branch: branch };
            if (sha) body.sha = sha;
            const resp = await fetch(`https://api.github.com/repos/${repo}/contents/${safeArgs.path}`, {
                method: 'PUT',
                headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json', 'User-Agent': 'Cloudflare-Worker-MCP/1.0' },
                body: JSON.stringify(body)
            });
            if (!resp.ok) { const err = await resp.json(); throw new Error(err.message || `HTTP ${resp.status}`); }
            const data = await resp.json();
            text = `✅ 文件已提交到 GitHub\n📂 ${safeArgs.path}\n📝 ${message}\n🔗 ${data.content?.html_url || '已推送'}`;
        } catch (e) { text = '❌ GitHub 推送失败：' + e.message; }
    } else if (name === 'github_create_repo') {
        if (!safeArgs.repo) return '❌ 缺少参数：需要 repo（仓库名）';
        try {
            const description = safeArgs.description || '';
            const privateRepo = safeArgs.private || false;
            const resp = await fetch('https://api.github.com/user/repos', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json', 'User-Agent': 'Cloudflare-Worker-MCP/1.0' },
                body: JSON.stringify({ name: safeArgs.repo, description: description, private: privateRepo, auto_init: true })
            });
            if (!resp.ok) { const err = await resp.json(); throw new Error(err.message || `HTTP ${resp.status}`); }
            const data = await resp.json();
            text = `✅ GitHub 仓库已创建\n📂 ${data.full_name}\n🔗 ${data.html_url}`;
        } catch (e) { text = '❌ 创建仓库失败：' + e.message; }
    }
    return text;
}