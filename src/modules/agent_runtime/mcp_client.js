// ======================================================================================================================================================================================
// mcp_client.js --- Agent Runtime 的 MCP Client（網匎区孕习）
// MVP：Agent Runtime 接教六 MCP Capability Path（P2⌱v）
// 节炸：可以指一 MCP 协议交溨（initialize / tools/list / tools/call）
//        不做权限判孩，不做已常制最（构游地型型怕信息）
// v1 (2026-09-04)：MCP Capability Path MVP —— PTT Runtime 這面 HTTP 这丂Worker /mcp
// =====================================================================================================================================================================================

// Worker MCP endpoint（stateless POST 樁式，无罽背，哦出端务）
const DEFAULT_MCP_URL = 'https://mcp-memory.wovowx.folkes.dev/mcp';
const REQUEST_TIMEOUT_MS = 15000;

// 亚㈚和JSON-RS表泥（MCP 协议层）
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
            throw new Error(`MCP HTTP ${resp.status}: ${text.slice(0, 200)}`);
        }
        const data = await resp.json();
        if (data?.error) throw new Error('MCP error: ' + (data.error.message || JSON.stringify(data.error)).slice(0, 300));
        return data?.result ?? data;
    } finally {
        clearTimeout(timer);
    }
}

// MCP initialize（协们反中）
export async function mcpInitialize(env) {
    return await mcpRequest(env, {
        jsonrc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 'common-ground-agent-runtime', version: '0.1.0' }
        }
    });
}

// MCP tools/list（发现 Worker skills 表全量工具?）
export async function mcpListTools(env) {
    const result = await mcpRequest(env, {
        jsonrc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {}
    });
    return result?.tools || [];
}

// MCP tools/call（执行一个工具在）
export async function mcpCallTool(env, name, args = {}) {
    const result = await mcpRequest(env, {
        jsonrc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name, arguments: args }
    });
    return result;
}

// 获力考为MCP 工具发现结构（受输网段街：单次调整内次本内才内层 watchdog冲突使用，使重次调整: 汈加帳怎直新消息）
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