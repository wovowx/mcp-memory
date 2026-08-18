// ============================================================
// 删除 GitHub 分支工具
// ============================================================
export async function handleDeleteBranch(name, safeArgs, env) {
    const branchName = safeArgs.name || safeArgs.branch;
    
    if (!branchName) {
        return '❌ 缺少参数：需要 name 或 branch';
    }
    
    if (branchName === 'main') {
        return '❌ 不能删除 main 分支';
    }
    
    const githubToken = env.GITHUB_TOKEN;
    if (!githubToken) {
        return '❌ GITHUB_TOKEN 未配置';
    }
    
    const resp = await fetch(`https://api.github.com/repos/wovowx/mcp-memory/git/refs/heads/${encodeURIComponent(branchName)}`, {
        method: 'DELETE',
        headers: {
            'Authorization': `Bearer ${githubToken}`,
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'Ziven-MCP-Server'
        }
    });
    
    if (resp.ok) {
        return `✅ 已删除分支：${branchName}`;
    } else if (resp.status === 422) {
        return `❌ 分支不存在：${branchName}`;
    } else {
        const errText = await resp.text();
        return `❌ 删除失败：${errText}`;
    }
}
