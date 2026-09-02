// ============================================================
// 触发链 PoC：Supabase Database Webhook 接收端点（v2）
// 2026-09-02 触发链 PoC（零成本、最小改动）
// 目标：验证「INSERT 事件 → Webhook → Worker」链路
// 三行为验证：A 正常到达 / B 重复投递幂等 / C 失败重试不破坏状态
// v2 新增：每次收到请求写审计到 chat_webhook_audit（真实触发可查证）
// 安全设计：默认 dry-run 只读，不改事件状态（真实处理模式后续接 Adapter 时开）
// ============================================================
import { jsonResponse, buildErrorResponse } from '../utils/response.js';

// Supabase Database Webhook 的标准 payload：
// { type: 'INSERT'|'UPDATE'|'DELETE', table, schema, record, old_record }
const TARGET_TABLE = 'chat_agent_events';
const AUDIT_TABLE = 'chat_webhook_audit';

function supabaseHeaders(env) {
    const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY;
    return { 'Authorization': `Bearer ${key}`, 'apikey': key, 'Content-Type': 'application/json' };
}

async function queryEvent(env, eventId) {
    const url = `${env.SUPABASE_URL}/rest/v1/${TARGET_TABLE}?select=event_id,message_id,agent,status,claimed_at,created_at&event_id=eq.${encodeURIComponent(eventId)}`;
    const resp = await fetch(url, { headers: supabaseHeaders(env) });
    if (!resp.ok) throw new Error(`查询事件失败 ${resp.status}: ${await resp.text()}`);
    return resp.json();
}

// v2：写审计——每次收到 webhook 请求都留痕，真实触发可验证
// 审计失败不影响主流程（try/catch 吞掉并 console 记录）
async function writeAudit(env, entry) {
    try {
        const url = `${env.SUPABASE_URL}/rest/v1/${AUDIT_TABLE}`;
        const resp = await fetch(url, {
            method: 'POST',
            headers: supabaseHeaders(env),
            body: JSON.stringify({
                event_id: entry.event_id || '',
                agent: entry.agent || '',
                decision: entry.decision || 'unknown',
                reason: entry.reason || '',
                received_at: entry.received_at || new Date().toISOString()
            })
        });
        if (!resp.ok) {
            console.error(`[webhook-audit] 写入失败 ${resp.status}: ${await resp.text()}`);
        }
    } catch (e) {
        console.error('[webhook-audit] 写入异常（不影响主流程）: ' + e.message);
    }
}

// 校验 payload：必须是 INSERT + chat_agent_events
function validatePayload(payload) {
    if (!payload || typeof payload !== 'object') return { ok: false, reason: 'payload 不是对象' };
    if (payload.type !== 'INSERT') return { ok: false, reason: `只接受 INSERT，收到 ${payload.type || '未知'}` };
    if (payload.table !== TARGET_TABLE) return { ok: false, reason: `只接受 ${TARGET_TABLE}，收到 ${payload.table || '未知'}` };
    const record = payload.record;
    if (!record || !record.event_id) return { ok: false, reason: 'record.event_id 缺失' };
    return { ok: true, record };
}

export async function handleChatWebhook(request, env) {
    let payload;
    try {
        payload = await request.json();
    } catch (e) {
        return buildErrorResponse('无法解析 JSON payload: ' + e.message, 400);
    }

    // A 行为入口：合法 INSERT 到达
    const check = validatePayload(payload);
    if (!check.ok) {
        await writeAudit(env, {
            event_id: payload?.record?.event_id || '',
            agent: payload?.record?.agent || '',
            decision: 'ignored',
            reason: check.reason
        });
        return jsonResponse({ status: 'ignored', reason: check.reason, type: payload?.type, table: payload?.table }, 202);
    }

    const { event_id, agent } = check.record;

    // A 行为：确认事件真实存在于库里
    let rows;
    try {
        rows = await queryEvent(env, event_id);
    } catch (e) {
        // C 行为：Worker 侧查询失败（模拟不可用）——不改事件状态，让 Supabase 重试
        await writeAudit(env, { event_id, agent, decision: 'error', reason: '查询事件失败（可重试）: ' + e.message });
        return buildErrorResponse('查询事件失败（可重试）: ' + e.message, 500);
    }
    if (rows.length === 0) {
        await writeAudit(env, { event_id, agent, decision: 'not_found', reason: '事件在数据库中不存在（可能已被清理）' });
        return jsonResponse({ status: 'not_found', event_id, reason: '事件在数据库中不存在（可能已被清理）' }, 202);
    }
    const event = rows[0];

    // B 行为：幂等判定——事件已 success 或已被 claim，视为重复投递，不重复处理
    if (event.status === 'success' || event.status === 'failed') {
        await writeAudit(env, { event_id, agent: event.agent, decision: 'duplicate', reason: '事件已终结（status=' + event.status + '）' });
        return jsonResponse({
            status: 'duplicate',
            event_id,
            agent: event.agent,
            current_status: event.status,
            reason: '事件已终结，重复投递不重复处理',
            received_at: new Date().toISOString()
        }, 200);
    }
    if (event.claimed_at) {
        await writeAudit(env, { event_id, agent: event.agent, decision: 'duplicate', reason: '事件已 claim（claimed_at=' + event.claimed_at + '）' });
        return jsonResponse({
            status: 'duplicate',
            event_id,
            agent: event.agent,
            current_status: event.status,
            claimed_at: event.claimed_at,
            reason: '事件已被 claim，处理中或处理中中断，重复投递不重复处理',
            received_at: new Date().toISOString()
        }, 200);
    }

    // A 行为完成：事件是 processing + 未 claim = 首次有效投递
    // PoC dry-run：只确认到达，不改事件状态（真实处理由 Adapter claim/read/reply/ack 完成）
    await writeAudit(env, { event_id, agent, decision: 'delivered', reason: '首次有效投递（dry-run，未 claim）' });
    return jsonResponse({
        status: 'delivered',
        event_id,
        agent,
        current_status: event.status,
        reason: '首次有效投递（dry-run 模式，未 claim）',
        received_at: new Date().toISOString(),
        poc: { mode: 'dry-run', validate_a: true, validate_b: true, validate_c: '模拟失败时返回 500，事件状态保持原样' }
    }, 200);
}