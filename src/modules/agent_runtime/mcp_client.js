// ============================================================
// mcp_client.js — Agent Runtime 的 MCP Client（纯协议层）
// MVP：Agent Runtime 接入 MCP Capability Path（P2.1）
// 职责：只做 MCP 协议交互（initialize / tools/list / tools/call）
//       不做权限判断、不做工具分类、不掺业务逻辑（权限在 Guard 层）
// v1.1 (2026-09-04)：修复 v1 手写 base64 导致的 URL 错字(folkes.dev)与 jsonrc 错字
// ============================================================

// Worker MCP endpoint（stateless POST 模式，无 session 维护）
const DEFAULT_MCP_URL = 'https://mcp-memory.wovowx.workers.dev/mcp';
const REQUEST_TIMEOUT_MS = 15000;

// 通用 JSON-RPC 请求（MCP 协议层）
async function mcpRequest(env, body) {
    const url = env.MCP_URL || DEFAULT_MCP_URL;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify(body),
            signal: controller.signal
        });
        if (!resp.ok) {
            const text = await resp.text().catch(() => '');
            throw new Error('MCP HTTP ' + resp.status + ': ' + text.slice(0, 200));
        }
        const data = await resp.json();
        if (data?.error) throw new Error('MCP error: ' + (data.error.message || JSON.stringify(data.error)).slice(0, 300));
        return data?.result ?? data;
    } finally {
        clearTimeout(timer);
    }
}

// MCP initialize（协议协商）
export async function mcpInitialize(env) {
    return await mcpRequest(env, {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 'common-ground-agent-runtime', version: '0.1.0' }
        }
    });
}

// MCP tools/list（发现 Worker skills 表全量工具）
export async function mcpListTools(env) {
    const result = await mcpRequest(env, {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {}
    });
    return result?.tools || [];
}

// MCP tools/call（执行一个工具）
export async function mcpCallTool(env, name, args = {}) {
    const result = await mcpRequest(env, {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name, arguments: args }
    });
    return result;
}

// 获取 MCP 工具发现结果（带轻量缓存：单次调用内存缓存，避免每次 GPT 回复都重复走网络）
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
