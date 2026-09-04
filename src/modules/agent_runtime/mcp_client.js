// ============================================================
// mcp_client.js — Agent Runtime 的 MCP Client（协议层 + 双 transport）
// MVP：Agent Runtime 接入 MCP Capability Path（P2.1）
// v1.2 (2026-09-04)：
//   修复 Worker 自环回 404(1042)——同 Worker 内不走 HTTP 打自己
//   双模式：env.MCP_URL 存在 → HTTP MCP；否则 → 同进程 handleMCPRequest
//   注意：Guard 仍在 executeTool 前置，本层只负责 transport
// ============================================================
import { handleMCPRequest } from '../mcp_router.js';

// Worker MCP endpoint（仅外部/跨服务场景用 HTTP）
const DEFAULT_MCP_URL = 'https://mcp-memory.wovowx.workers.dev/mcp';
const REQUEST_TIMEOUT_MS = 15000;

// HTTP transport（跨服务真实 MCP Client）
async function httpPost(url, payload) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify(payload),
            signal: controller.signal
        });
        if (!resp.ok) {
            const text = await resp.text().catch(() => '');
            throw new Error('MCP HTTP ' + resp.status + ': ' + text.slice(0, 200));
        }
        return await resp.json();
    } finally {
        clearTimeout(timer);
    }
}

// 统一发送：同 Worker 永远 internal（Cloudflare 禁止自环回），仅显式 MCP_HTTP_TRANSPORT=true 才走 HTTP（跨服务场景）
async function sendMcpRequest(env, payload) {
    // 同进程优先：Worker 内调用自己公网地址会触发平台自环回限制(1042)
    if (env?.MCP_HTTP_TRANSPORT === true || env?.MCP_HTTP_TRANSPORT === 'true') {
        const url = env?.MCP_URL || DEFAULT_MCP_URL;
        return await httpPost(url, payload);
    }
    const res = await handleMCPRequest(payload, env);
    if (res?.ok === false) return { jsonrpc: '2.0', id: payload.id ?? null, error: res.data?.error };
    return res?.data ?? { jsonrpc: '2.0', id: payload.id ?? null, error: { code: -32603, message: 'no data' } };
}

// MCP initialize（协议协商）
export async function mcpInitialize(env) {
    return await sendMcpRequest(env, {
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'common-ground-agent-runtime', version: '0.2.0' } }
    });
}

// MCP tools/list（发现 Worker skills 表全量工具）
export async function mcpListTools(env) {
    const result = await sendMcpRequest(env, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    return result?.result?.tools || [];
}

// MCP tools/call（执行一个工具）
export async function mcpCallTool(env, name, args = {}) {
    const result = await sendMcpRequest(env, {
        jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name, arguments: args }
    });
    // tools/call 成功返回 result.content；错误返回 error
    if (result?.error) throw new Error('MCP error: ' + (result.error.message || JSON.stringify(result.error)).slice(0, 300));
    const text = result?.result?.content?.[0]?.text ?? '';
    return text;
}

// 获取 MCP 工具发现结果（带轻量缓存）
const toolDiscoveryCache = { time: 0, tools: null };
const TOOL_CACHE_TTL_MS = 30 * 1000;

export async function discoverMCPTools(env, force = false) {
    const now = Date.now();
    if (!force && toolDiscoveryCache.tools && (now - toolDiscoveryCache.time) < TOOL_CACHE_TTL_MS) {
        return toolDiscoveryCache.tools;
    }
    const tools = await mcpListTools(env);
    toolDiscoveryCache.tools = tools;
    toolDiscoveryCache.time = now;
    return tools;
}
