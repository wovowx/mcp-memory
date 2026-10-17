// ============================================================
// cf_proxy.js - Cloudflare API 代理工具
// ============================================================
// 作用：让 Ziven（Operit 端）用 Worker 环境变量里的 CLOUDFLARE_API_TOKEN
//       代调 Cloudflare API（只执行、不暴露 token 明文）。
// 柳柳 2026-10-17 拍板：给 Worker 加「自由调用（非查看）CF 环境变量」的方法。
// 安全边界：token 永远在 Worker env 里，只用来发起 CF API 请求，永不回显给 Client。
// 典型场景：查账号 → 查 zone → 建固定隧道 → 配 DNS 记录 → 拿隧道 token。
// ============================================================
const CF_API_BASE = 'https://api.cloudflare.com/client/v4/';

export async function handleCfProxyTool(args, env) {
    const varName = (args.token_var || '').trim();
    // 柳柳 2026-10-17 设计：不传 token_var → 返回全部变量名列表（只列名字，不含值）
    if (!varName) {
        const keys = Object.keys(env).sort();
        return '📋 可用环境变量名（' + keys.length + ' 个，仅名字不含值）：\\n' + keys.join('\\n');
    }
    const token = env[varName];
    if (!token) return '❌ 环境变量中不存在 ' + varName + '（可用 cf_proxy() 列出全部变量名后选对 token_var）';
    const accountId = env.CLOUDFLARE_ACCOUNT_ID || '';
    const method = (args.method || 'GET').toUpperCase();
    let endpoint = (args.endpoint || '').trim();
    if (!endpoint) {
        return '❌ 缺少 endpoint，形如：accounts/{account_id}/tunnels 或 zones?name=wovowx.win 或 accounts\n'
             + '支持占位 {account_id}（env 里若已配 CLOUDFLARE_ACCOUNT_ID 会自动替换）';
    }
    if (accountId) endpoint = endpoint.replace(/\{account_id\}/g, accountId);
    let url = CF_API_BASE + endpoint.replace(/^\/+/, '');
    let body = null;
    if (args.body) {
        try { body = typeof args.body === 'string' ? JSON.parse(args.body) : args.body; }
        catch (e) { return '❌ body 不是合法 JSON: ' + e.message; }
    }
    const headers = { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' };
    try {
        const resp = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
        const text = await resp.text();
        let out;
        try { out = JSON.stringify(JSON.parse(text), null, 2); } catch (e) { out = text; }
        return '✅ CF API ' + method + ' ' + url + '\nHTTP ' + resp.status + '\n' + out;
    } catch (e) {
        return '❌ CF API 调用失败: ' + e.message;
    }
}

export const CF_PROXY_TOOL_DEF = {
    name: 'cf_proxy',
    description: 'CF API 代理：用 Worker 环境变量里的 CF token 代调 Cloudflare API（只执行、不暴露 token）。两种模式：1) 不传 token_var → 返回全部环境变量名列表（仅名字、不含值）；2) 传 token_var(env 变量名)+method+endpoint(+body) → 用对应 token 调 CF API。endpoint 例：accounts、zones?name=xxx.com、accounts/{account_id}/tunnels、accounts/{account_id}/cfd_tunnel（支持占位 {account_id}）。返回 HTTP 状态码+响应体。token_var 不传时不发起请求，仅列名。',
    input_schema: {
        type: 'object',
        properties: {
            token_var: { type: 'string', description: '可选，指定用哪个环境变量的 CF token；不传则返回全部变量名列表（仅名字）' },
            method: { type: 'string', enum: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'], description: 'HTTP 方法，默认 GET' },
            endpoint: { type: 'string', description: 'CF API 路径，如 accounts、zones?name=wovowx.win、accounts/{account_id}/tunnels' },
            body: { type: 'string', description: '可选，请求体 JSON 字符串（POST/PATCH/PUT 用）' }
        },
        required: ['endpoint']
    }
};
