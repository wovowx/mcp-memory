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

// Reusable header primitive: credentials remain inside the Worker.
// Never expose the generated header or token in tool output.
export function cloudflareBearerHeaders(token) {
    return { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
}

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
    const headers = cloudflareBearerHeaders(token);
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

 
// Scenario-level read-only Cloudflare Workers Observability query.
// Reuse the cf_proxy credential/header primitive; NEVER expose arbitrary API
// endpoints, token names, raw log lines, headers, bodies or account mutations.
const LOG_WORKER = 'mcp-memory';
const LOG_ARGS = new Set(['minutes', 'limit', 'status_filter']);

export const CLOUDFLARE_LOGS_QUERY_TOOL = Object.freeze({
    name: 'cloudflare_logs_query',
    description: '查询 mcp-memory 最近 1-60 分钟已存储的 Cloudflare Workers 请求日志，只显示脱敏元数据。与 Live Tail 不同；查询为空不能证明请求未到达。',
    input_schema: {
        type: 'object',
        properties: {
            minutes: { type: 'integer', minimum: 1, maximum: 60, description: '最近多少分钟，默认15' },
            limit: { type: 'integer', minimum: 1, maximum: 50, description: '最大返回条数，默认20' },
            status_filter: { type: 'string', enum: ['all', 'error'], description: '默认all；error 仅过滤已读取的有限事件' }
        },
        additionalProperties: false
    },
    annotations: { title: 'Cloudflare Logs (read-only)', readOnlyHint: true,
        destructiveHint: false, idempotentHint: true, openWorldHint: true }
});

function logResponse(status, reason, extra = {}) {
    return JSON.stringify({
        status, reason, worker: LOG_WORKER,
        coverage: 'stored_logs_only_sampling_and_retention_unverified',
        ...extra
    });
}
function logId(value) {
    return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value) ? value : null;
}
function logTime(value) {
    if (typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value)) {
        const n = Date.parse(value);
        return Number.isFinite(n) ? new Date(n).toISOString() : null;
    }
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
        const ms = value < 100000000000 ? value * 1000 : value;
        return Number.isFinite(new Date(ms).getTime()) ? new Date(ms).toISOString() : null;
    }
    return null;
}
function logStatus(value) {
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isInteger(n) && n >= 100 && n <= 599 ? n : null;
}
function logMethod(value) {
    return typeof value === 'string' && /^(GET|POST|PATCH|PUT|DELETE|OPTIONS|HEAD)$/.test(value)
        ? value : null;
}
function logPath(value) {
    if (typeof value !== 'string') return null;
    try {
        const p = new URL(value, 'https://worker.invalid').pathname;
        return p === '/mcp' || p === '/' ? p : null;
    } catch { return null; }
}
// Cloudflare's trigger is an invocation label, not a raw URL to forward.
// Only a single, anchored HTTP method and path/HTTPS URL counts as evidence.
function parseLogHttpTrigger(value) {
    if (typeof value !== 'string') return null;
    const match = /^(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD) (\/\S*|https:\/\/\S+)$/.exec(value);
    return match ? { method: match[1], path: match[2] } : null;
}
function logObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
// Preserve ambiguity: disagreeing or disallowed paths never become fabricated /mcp.
function verifiedLogValue(candidates, validator, strict = false) {
    const nonempty = candidates.filter(x => typeof x === 'string' && x.length > 0);
    const values = nonempty.map(validator);
    if (strict && values.some(x => x === null)) return null;
    const known = values.filter(x => x !== null);
    return known.length && known.every(x => x === known[0]) ? known[0] : null;
}
function classifyLogKind(meta, workers, req, workerReq, trigger) {
    const type = meta.type;
    if (type === 'cf-worker-log') return 'runtime_log';
    const eventType = workers.eventType;
    const hasHttpData = Boolean(trigger) ||
        (typeof meta.method === 'string' && typeof meta.url === 'string') ||
        (typeof req.method === 'string' && typeof req.url === 'string') ||
        (typeof workerReq.method === 'string' && typeof workerReq.url === 'string');
    const nonFetch = ['scheduled', 'cron', 'alarm', 'queue', 'email', 'tail',
        'rpc', 'jsrpc', 'websocket', 'workflow'].includes(eventType);
    if (nonFetch) {
        // Cloudflare may include contextual fields for non-fetch invocations;
        // do not reinterpret a scheduled/queue event as an HTTP request.
        return hasHttpData ? 'unknown' : (eventType === 'scheduled' || eventType === 'cron' ? 'scheduled' : 'other');
    }
    if (eventType === 'fetch') return 'http';
    if (hasHttpData) return 'http';
    if (type === 'cf-worker-event') return 'unknown';
    return 'unknown';
}
function sanitizeLogEvent(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const meta = logObject(raw.$metadata);
    // Server filter plus local verification, always fail closed across Workers.
    if (meta.service !== LOG_WORKER) return null;
    const workers = logObject(raw.$workers);
    const workerReq = logObject(logObject(workers.event).request);
    const req = logObject(raw.request); // legacy synthetic and compatible adapters
    const trigger = parseLogHttpTrigger(meta.trigger);
    const kind = classifyLogKind(meta, workers, req, workerReq, trigger);
    const http = kind === 'http';
    const method = http ? verifiedLogValue([
        meta.method, workerReq.method, req.method, trigger?.method
    ], logMethod) : null;
    const path = http ? verifiedLogValue([
        meta.url, workerReq.url, req.url, trigger?.path
    ], logPath, true) : null;
    // Only documented HTTP statusCode; runtime 'ok' cannot fabricate HTTP 200.
    const status = http ? logStatus(meta.statusCode) : null;
    const level = typeof meta.level === 'string' ? meta.level.toLowerCase() : null;
    const workerOutcome = typeof workers.outcome === 'string' ? workers.outcome : null;
    const error = Boolean(meta.error) || meta.spanStatus === 'error' ||
        level === 'error' || ['exception', 'exceededCpu', 'exceededMemory'].includes(workerOutcome) ||
        (status !== null && status >= 500);
    const ok = workerOutcome === 'ok' || meta.spanStatus === 'ok' ||
        (status !== null && status >= 200 && status < 400);
    return {
        timestamp: logTime(meta.startTime ?? meta.timestamp ?? raw.timestamp),
        worker: LOG_WORKER,
        event_kind: kind,
        method,
        path,
        status_code: status,
        outcome: error ? 'error' : (ok ? 'ok' : 'unknown'),
        trace_id: logId(meta.requestId ?? meta.traceId ?? workers.requestId ?? workers.traceId ?? meta.rayId)
        // Never return the raw $workers.event, source, messages or headers.
    };
}

// fetchImpl and nowMs are injectable only for deterministic synthetic E2.
export async function handleCloudflareLogsQuery(args = {}, env = {}, fetchImpl = fetch, nowMs = Date.now()) {
    if (!args || typeof args !== 'object' || Array.isArray(args) ||
        Object.keys(args).some(k => !LOG_ARGS.has(k))) {
        return logResponse('ERROR', 'invalid_arguments');
    }
    const minutes = args.minutes === undefined ? 15 : args.minutes;
    const limit = args.limit === undefined ? 20 : args.limit;
    const filter = args.status_filter === undefined ? 'all' : args.status_filter;
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 60 ||
        !Number.isInteger(limit) || limit < 1 || limit > 50 ||
        !['all', 'error'].includes(filter)) {
        return logResponse('ERROR', 'invalid_arguments');
    }
    const token = env.CLOUDFLARE_API_TOKEN, account = env.CLOUDFLARE_ACCOUNT_ID;
    if (typeof token !== 'string' || !token || !logId(account)) {
        return logResponse('UNAVAILABLE', 'credentials_not_configured');
    }
    if (!Number.isFinite(nowMs) || nowMs <= 0) return logResponse('ERROR', 'invalid_time');
    const end = Math.floor(nowMs);
    const body = {
        queryId: 'ziven-logs-temporary', timeframe: { from: end - minutes * 60000, to: end },
        view: 'events', limit, dry: true,
        parameters: {
            datasets: [], filterCombination: 'and',
            filters: [{ key: '$metadata.service', operation: 'eq', type: 'string', value: LOG_WORKER }]
        }
    };
    let response;
    try {
        response = await fetchImpl(
            CF_API_BASE + 'accounts/' + encodeURIComponent(account) + '/workers/observability/telemetry/query',
            { method: 'POST', headers: cloudflareBearerHeaders(token), body: JSON.stringify(body) }
        );
    } catch { return logResponse('ERROR', 'network_failure'); }
    if (!response?.ok) {
        const status = Number.isInteger(response?.status) ? response.status : null;
        if (status === 401 || status === 403) return logResponse('UNAVAILABLE', 'token_permission_or_auth');
        if (status === 404) return logResponse('UNAVAILABLE', 'endpoint_or_storage_unavailable');
        return logResponse('ERROR', 'cloudflare_http_failure', { http_status: status });
    }
    let data;
    try { data = await response.json(); }
    catch { return logResponse('ERROR', 'invalid_json'); }
    if (!data || typeof data !== 'object') return logResponse('ERROR', 'invalid_response_shape');
    if (data.success === false) return logResponse('ERROR', 'cloudflare_query_rejected');
    const group = data.result?.events;
    if (!Array.isArray(group?.events)) return logResponse('ERROR', 'invalid_response_shape');
    const parsed = group.events.map(sanitizeLogEvent);
    if (parsed.some(e => e === null)) return logResponse('ERROR', 'unverifiable_worker_scope');
    const selection = filter === 'error' ? parsed.filter(e => e.outcome === 'error') : parsed;
    selection.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
    const events = selection.slice(0, limit);
    return logResponse(events.length ? 'OK' : 'EMPTY',
        events.length ? 'events_found' : 'no_matching_events_in_limited_result', {
            queried_minutes: minutes, requested_limit: limit, status_filter: filter,
            fetched_count: group.events.length,
            reported_count: Number.isFinite(group.count) && group.count >= 0 ? group.count : null,
            events
        });
}

