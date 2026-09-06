// ============================================================
// ziven_wake_dispatcher.js — P0-2 Phase2 M1-a：Ziven Wake Dispatcher
// 职责：发现 agent=ziven 的 created 事件 → 原子 claim → POST Operit
//       /api/external-chat 唤醒 → 置 delivered（完成「自动叫醒」闭环）
// 铁律（GPT #846 收敛 + 柳柳拍板）：
//   - claim 必须原子化（UPDATE ... WHERE delivery_status='created'，防并发抢）
//   - payload 带 event_id/thread_id/message_id（不能只传 content，防多事件 ack 错乱）
//   - delivered 只代表「Operit HTTP 收到」，processing 由 Ziven 侧回调（M1-b）
//   - 不碰 event_processor.js（那是 GPT 通道），独立 dispatcher 模块
// v1 (2026-09-06)：M1-a 初版
// ============================================================
const MAX_RETRY = 3;          // 唤醒重投上限（与 watchdog 一致）
const BATCH_LIMIT = 10;       // 每轮最多处理条数

function supabaseHeaders(env) {
    const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY;
    return { 'Authorization': 'Bearer ' + key, 'apikey': key, 'Content-Type': 'application/json', 'Prefer': 'return=representation' };
}

// ============================================================
// dispatcher 运行时配置：优先读 Supabase system_config 表（隧道 URL 动态、token 敏感不写仓库）
// 兜底：env.OPERIT_BASE_URL / env.OPERIT_BEARER_TOKEN（wrangler.toml 或控制台）
// 2026-09-06：system_config 方案（GPT #851 review 中）——隧道重启更新表即可，不用重新部署
// ============================================================
async function readSystemConfig(env, key) {
    try {
        const url = `${env.SUPABASE_URL}/rest/v1/system_config?key=eq.${encodeURIComponent(key)}&select=value`;
        const resp = await fetch(url, { headers: supabaseHeaders(env) });
        if (!resp.ok) return null;
        const rows = await resp.json();
        return (Array.isArray(rows) && rows.length > 0) ? rows[0].value : null;
    } catch (e) {
        console.error('[ziven_wake] 读 system_config ' + key + ' 失败: ' + e.message);
        return null;
    }
}

// 解析唤醒目标：表优先，env 兜底
async function resolveWakeTarget(env) {
    const tunnelUrl = await readSystemConfig(env, 'operit_tunnel_url') || env.OPERIT_BASE_URL || '';
    const token = await readSystemConfig(env, 'operit_bearer_token') || env.OPERIT_BEARER_TOKEN || '';
    return {
        baseUrl: String(tunnelUrl).replace(/\/+$/, ''),
        token: String(token)
    };
}

// 查询待唤醒候选：agent=ziven 且 delivery_status='created'（或历史事件未初始化 delivery_status）且非死信
// 语义：created = 可被 claim（watchdog 释放也回到 created）
async function findWakeCandidates(env) {
    // 兼容：历史事件没有 delivery_status 字段（createMessage 未初始化）→ 兜底视为 created
    // Supabase REST：or=(delivery_status.eq.created,delivery_status.is.null)
    const url = `${env.SUPABASE_URL}/rest/v1/chat_agent_events` +
        `?select=event_id,message_id,agent,status,claimed_at,payload,created_at,updated_at,retry_count,dead_letter,delivery_status` +
        `&agent=eq.ziven&dead_letter=eq.false&status=eq.processing&claimed_at=is.null` +
        `&or=(delivery_status.eq.created,delivery_status.is.null)` +
        `&order=created_at.asc&limit=${BATCH_LIMIT}`;
    const resp = await fetch(url, { headers: supabaseHeaders(env) });
    if (!resp.ok) throw new Error('wake 查询失败: ' + resp.status);
    return await resp.json();
}

// 原子 claim：只抢占 delivery_status='created' 的事件（WHERE 条件保证并发安全）
// 返回 true=抢到，false=已被其他 dispatcher 抢走
async function atomicClaim(env, eventId) {
    const now = new Date().toISOString();
    const url = `${env.SUPABASE_URL}/rest/v1/chat_agent_events` +
        `?event_id=eq.${encodeURIComponent(eventId)}` +
        `&dead_letter=eq.false&agent=eq.ziven` +
        `&or=(delivery_status.eq.created,delivery_status.is.null)`;
    const resp = await fetch(url, {
        method: 'PATCH',
        headers: supabaseHeaders(env),
        body: JSON.stringify({
            delivery_status: 'claimed',
            claimed_by: 'ziven_wake_dispatcher',
            claimed_at: now,
            updated_at: now
        })
    });
    if (!resp.ok) throw new Error('claim 失败: ' + resp.status);
    const rows = await resp.json();
    return Array.isArray(rows) && rows.length > 0;
}

// 置 delivering（POST 前）——区分「正在推送」与「推送成功」
async function markDelivering(env, eventId) {
    const url = `${env.SUPABASE_URL}/rest/v1/chat_agent_events?event_id=eq.${encodeURIComponent(eventId)}`;
    const resp = await fetch(url, {
        method: 'PATCH',
        headers: supabaseHeaders(env),
        body: JSON.stringify({ delivery_status: 'delivering', updated_at: new Date().toISOString() })
    });
    if (!resp.ok) throw new Error('标记 delivering 失败: ' + resp.status);
    return true;
}

// 置 delivered：Operit HTTP 已收到（202 Accepted / 200 OK）
async function markDelivered(env, eventId) {
    const url = `${env.SUPABASE_URL}/rest/v1/chat_agent_events?event_id=eq.${encodeURIComponent(eventId)}`;
    const resp = await fetch(url, {
        method: 'PATCH',
        headers: supabaseHeaders(env),
        body: JSON.stringify({ delivery_status: 'delivered', updated_at: new Date().toISOString() })
    });
    if (!resp.ok) throw new Error('标记 delivered 失败: ' + resp.status);
    return true;
}

// 唤醒失败：重投（释放回 created，重新进入队列）或超限死信
async function releaseForRetry(env, event) {
    const nextRetry = (event.retry_count || 0) + 1;
    const now = new Date().toISOString();
    const url = `${env.SUPABASE_URL}/rest/v1/chat_agent_events?event_id=eq.${encodeURIComponent(event.event_id)}`;
    if (nextRetry >= MAX_RETRY) {
        const resp = await fetch(url, {
            method: 'PATCH',
            headers: supabaseHeaders(env),
            body: JSON.stringify({ dead_letter: true, delivery_status: 'failed', retry_count: nextRetry, claimed_by: null, claimed_at: null, updated_at: now })
        });
        if (!resp.ok) throw new Error('死信标记失败: ' + resp.status);
        return { event_id: event.event_id, action: 'dead_letter', retry_count: nextRetry };
    }
    const resp = await fetch(url, {
        method: 'PATCH',
        headers: supabaseHeaders(env),
        body: JSON.stringify({ delivery_status: 'created', retry_count: nextRetry, claimed_by: null, claimed_at: null, updated_at: now })
    });
    if (!resp.ok) throw new Error('释放重投失败: ' + resp.status);
    return { event_id: event.event_id, action: 'retry', retry_count: nextRetry };
}

// 构造唤醒 payload：event_id/thread_id/message_id 必须带上（GPT #846 强调）
// ExternalChatHttpRequest 字段（ExternalChatModels.kt）：request_id/message/group/timeout_ms/stop_after/stream/response_mode/callback_url
// 事件溯源信息编码进 message 前缀（Operit 侧 Ziven 醒来后据此定位事件），response_mode=async_callback
function buildWakePayload(event) {
    const threadId = event.payload?.thread_id || null;
    const sourceMessageId = event.payload?.source_message_id || event.message_id || null;
    const preview = event.payload?.content_preview || '';
    // 消息前缀：把事件溯源 ID 带给 Ziven（防多事件 ack 错乱）
    const prefix = `[cg-event] event=${event.event_id} thread=${threadId || ''} msg=${sourceMessageId || ''}\n`;
    return {
        request_id: event.event_id,
        message: prefix + preview,
        group: 'common-ground',
        response_mode: 'async_callback',
        callback_url: event.callback_url || 'https://mcp-memory.wovowx.workers.dev/api/chat2api/callback',
        timeout_ms: -1,
        stop_after: false,
        stream: false
    };
}

// POST Operit 外部 HTTP 服务（8094 经隧道公网暴露），触发 Ziven 唤醒
async function wakeOperit(env, event, target) {
    const { baseUrl, token } = target;
    if (!baseUrl || !token) {
        throw new Error('唤醒目标未配置（system_config 无 operit_tunnel_url/operit_bearer_token 且 env 无 OPERIT_*）');
    }
    const payload = buildWakePayload(event);
    const resp = await fetch(`${baseUrl}/api/external-chat`, {
        method: 'POST',
        headers: {
            'Authorization': 'Bearer ' + token,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });
    // 202 Accepted（async_callback 立即返回）/ 200 OK（sync）都算「Operit 已收到」
    if (resp.status !== 200 && resp.status !== 202) {
        const text = await resp.text().catch(() => '');
        throw new Error(`唤醒失败 HTTP ${resp.status}: ${text.slice(0, 200)}`);
    }
    return { status: resp.status };
}

// 主入口：M1-a 每轮调度（scheduled() 调用）
// 流程：find → claim(原子) → delivering → POST → delivered / 失败重投或死信
export async function dispatchZivenWake(env) {
    const target = await resolveWakeTarget(env);
    if (!target.baseUrl || !target.token) {
        console.log('[ziven_wake] 跳过：system_config/env 均未配置唤醒目标');
        return { ok: true, skipped_reason: 'wake_target_not_configured', scanned: 0, results: [] };
    }
    try {
        const candidates = await findWakeCandidates(env);
        const results = [];
        for (const event of candidates) {
            // 1. 原子 claim（防并发）
            const claimed = await atomicClaim(env, event.event_id);
            if (!claimed) {
                results.push({ event_id: event.event_id, action: 'skip_claimed' });
                continue;
            }
            // 2. 标记 delivering → POST 唤醒
            await markDelivering(env, event.event_id).catch(() => {});
            try {
                const wake = await wakeOperit(env, event, target);
                // 3. Operit 收到 → delivered
                await markDelivered(env, event.event_id);
                results.push({ event_id: event.event_id, action: 'delivered', http: wake.status });
            } catch (e) {
                // 4. 失败 → 重投（release 回 created）或超限死信
                console.error('[ziven_wake] 唤醒失败 ' + event.event_id + ': ' + e.message);
                results.push(await releaseForRetry(env, event));
            }
        }
        return { ok: true, scanned: candidates.length, results };
    } catch (e) {
        console.error('[ziven_wake] 调度失败: ' + e.message);
        return { ok: false, error: e.message };
    }
}