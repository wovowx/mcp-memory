// ============================================================
// 统一响应格式
// ============================================================
export function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status: status,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
        }
    });
}
export function mcpResponse(result, id) {
    return {
        jsonrpc: '2.0',
        id: id,
        result: {
            content: [{ type: 'text', text: result }]
        }
    };
}
export function mcpError(message, id = null, code = -32601) {
    return {
        jsonrpc: '2.0',
        id: id,
        error: { code: code, message: message }
    };
}
export function buildErrorResponse(message, status = 400) {
    return new Response(JSON.stringify({ error: message }), {
        status: status,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
        }
    });
}