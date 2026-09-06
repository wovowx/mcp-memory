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
function buildWakePayload(event) {
    const threadId = event.payload?.thread_id || null;
    const sourceMessageId = event.payload?.source_message_id || event.message_id || null;
    const preview = event.payload?.content_preview || '';
    return {
        event_id: event.event_id,
        thread_id: threadId,
        message_id: event.message_id || null,
        source_message_id: sourceMessageId,
        agent: 'ziven',
        intent_node: 'WINDOW',
        content: preview,
        response_mode: 'async_callback',
        metadata: {
            source: 'common-ground',
            created_at: event.created_at
        }
    };
}

// POST Operit 外部 HTTP 服务（8094 经隧道公网暴露），触发 Ziven 唤醒
async function wakeOperit(env, event) {
    const baseUrl = (env.OPERIT_BASE_URL || '').replace(/\/+$/, '');
    const token = env.OPERIT_BEARER_TOKEN || '';
    if (!baseUrl || !token) {
        throw new Error('OPERIT_BASE_URL / OPERIT_BEARER_TOKEN 未配置，无法唤醒 Ziven');
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
    // 未配置唤醒目标 → 跳过（不炸调度器），日志提示
    if (!env.OPERIT_BASE_URL || !env.OPERIT_BEARER_TOKEN) {
        console.log('[ziven_wake] 跳过：OPERIT_BASE_URL/OPERIT_BEARER_TOKEN 未配置');
        return { ok: true, skipped_reason: 'operit_not_configured', scanned: 0, results: [] };
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
                const wake = await wakeOperit(env, event);
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