// ============================================================
// cf_proxy.js - Cloudflare API 代理工具
// ============================================================
// 作用：让 Ziven（Operit 端）用 Worker 环境变量里的 CLOUDFLARE_API_TOKEN
//       代调 Cloudflare API（只执行、不暴露 token 明文）。
// 柳柳 2026-10-17 拍板：给 Worker 加「自由调用（非查看）CF 环境变量」的方法。
// 安全边界：token 永远在 Worker env 里，只用来发起 CF API 请求，永不回显给 Client。
// 典型场景：查账号 → 查 zone → 建固定隧道 → 配 DNS 记录 → 拿隧道 token。
// v6.34.1：支持 token_var 指定 env 中的其他 token（如 cloudflare_key），多令牌场景自动回退。
// ============================================================
const CF_API_BASE = 'https://api.cloudflare.com/client/v4/';

export async function handleCfProxyTool(args, env) {
    const varName = (args.token_var || 'CLOUDFLARE_API_TOKEN').trim();
    const token = env[varName] || env.CLOUDFLARE_API_TOKEN || env.cloudflare_key || env.CLOUDFLARE_TOKEN || '';
    if (!token) return '❌ 找不到可用 CF token（尝试 token_var=' + varName + ' / CLOUDFLARE_API_TOKEN / cloudflare_key / CLOUDFLARE_TOKEN）';
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
    description: '用 Cloudflare Worker 环境变量里的 CLOUDFLARE_API_TOKEN 代调 Cloudflare API（只执行、不暴露 token）。参数：method(GET/POST/PATCH/PUT/DELETE，默认GET)、endpoint(如 accounts、zones?name=xxx.com、accounts/{account_id}/tunnels、accounts/{account_id}/cfd_tunnel)、body(JSON，可选)。返回 CF API 的 HTTP 状态码+响应体。',
    input_schema: {
        type: 'object',
        properties: {
            token_var: { type: 'string', description: '可选，指定用哪个环境变量的 CF token（默认 CLOUDFLARE_API_TOKEN，fallback 到 cloudflare_key / CLOUDFLARE_TOKEN）' },
            method: { type: 'string', enum: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'], description: 'HTTP 方法，默认 GET' },
            endpoint: { type: 'string', description: 'CF API 路径，如 accounts、zones?name=wovowx.win、accounts/{account_id}/tunnels' },
            body: { type: 'string', description: '可选，请求体 JSON 字符串（POST/PATCH/PUT 用）' }
        },
        required: ['endpoint']
    }
};
