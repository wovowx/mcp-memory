// ============================================================
// watchdog.js — P0-2 Phase1 事件可靠基础设施：超时释放 + 重试 + 死信
// 职责：任何事件被 system 接手后不会消失，可追踪生命周期
// 铁律：谁 claim 谁负责直到 ack 或 failed（dead_letter 兜底）
// v2 (2026-09-04)：判超时改用 updated_at（claimed_at=所有权时间点，updated_at=多久没进展）；超时保守 15min；Phase2 再引 heartbeat
// ============================================================
const CLAIM_TIMEOUT_MS = 15 * 60 * 1000;  // 超时：updated_at 后 15 分钟无进度视为卡死（保守，防误伤慢任务）
const MAX_RETRY = 3;                     // 重试上限

function supabaseHeaders(env) {
    const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY;
    return { 'Authorization': 'Bearer ' + key, 'apikey': key, 'Content-Type': 'application/json', 'Prefer': 'return=representation' };
}

// 查询所有「卡死」事件：processing 且非 dead_letter，按 updated_at 判超时
async function findStuckEvents(env) {
    const url = `${env.SUPABASE_URL}/rest/v1/chat_agent_events?select=event_id,agent,status,claimed_at,updated_at,retry_count,dead_letter,delivery_status&dead_letter=eq.false&status=eq.processing`;
    const resp = await fetch(url, { headers: supabaseHeaders(env) });
    if (!resp.ok) throw new Error('watchdog 查询失败: ' + resp.status);
    const rows = await resp.json();
    const now = Date.now();
    return rows.filter(r => {
        // 以 updated_at 为准：多久没有状态变化/心跳
        const lastUpdate = r.updated_at ? new Date(r.updated_at).getTime() : (r.claimed_at ? new Date(r.claimed_at).getTime() : now);
        return (now - lastUpdate > CLAIM_TIMEOUT_MS);
    });
}

// 释放卡死事件：重置 claimed_at + 更新 updated_at（表示释放动作）+ 递增 retry_count；超限进 dead_letter
async function releaseStuckEvent(env, event) {
    const urlBase = `${env.SUPABASE_URL}/rest/v1/chat_agent_events?event_id=eq.${encodeURIComponent(event.event_id)}`;
    const nextRetry = (event.retry_count || 0) + 1;
    const now = new Date().toISOString();

    if (nextRetry >= MAX_RETRY) {
        // 进死信
        const resp = await fetch(urlBase, {
            method: 'PATCH',
            headers: supabaseHeaders(env),
            body: JSON.stringify({ dead_letter: true, delivery_status: 'failed', retry_count: nextRetry, claimed_at: null, updated_at: now })
        });
        if (!resp.ok) throw new Error('dead_letter 标记失败: ' + resp.status);
        return { event_id: event.event_id, action: 'dead_letter', retry_count: nextRetry };
    }

    // 释放重投（delivery_status 回到 created，可再次被 claim）
    const resp = await fetch(urlBase, {
        method: 'PATCH',
        headers: supabaseHeaders(env),
        body: JSON.stringify({ delivery_status: 'created', retry_count: nextRetry, claimed_at: null, claimed_by: null, updated_at: now })
    });
    if (!resp.ok) throw new Error('释放事件失败: ' + resp.status);
    return { event_id: event.event_id, action: 'released', retry_count: nextRetry };
}

// watchdog 主入口：扫描 + 释放卡死事件
export async function watchdogSweep(env) {
    try {
        const stuck = await findStuckEvents(env);
        const results = [];
        for (const event of stuck) {
            results.push(await releaseStuckEvent(env, event));
        }
        return { ok: true, scanned: stuck.length, results };
    } catch (e) {
        console.error('[watchdog] 扫描失败: ' + e.message);
        return { ok: false, error: e.message };
    }
}