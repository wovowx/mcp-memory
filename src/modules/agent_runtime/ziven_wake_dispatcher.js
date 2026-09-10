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
// v1.2 (2026-09-09)：M1.2 v2（柳柳+GZ 讨论收敛）——唤醒时注入 Recovery Package（trigger/delta/knowledge），Ziven 醒来即可补看漏掉的消息；受通道预算裁剪
// ============================================================
import { resolveAgentContext } from './context_resolver.js'; // M1.2 v2
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

// M1.2 v2（柳柳+GZ 讨论收敛）：Ziven 唤醒通道 [AGENT_CONTEXT] 预算（字符）
// 预算内优先 trigger/summary/decisions，delta 从最近消息放起，不足则丢弃更早（不刷屏）
const ZIVEN_CONTEXT_BUDGET = 3000;

// Ziven Adapter：把 Resolver 统一产物裁剪为 Ziven 通道可承载的恢复包
// 顺序：trigger（谁@我）→ knowledge（已沉淀摘要/决定）→ delta（漏看原文）→ cursor
function formatContextBlock(resolved) {
    if (!resolved || resolved.error) return '';
    const parts = [];
    const trig = resolved.trigger_context;
    if (trig) {
        parts.push('trigger: ' + JSON.stringify({ author: trig.author, content: trig.content ? String(trig.content).slice(0, 200) : null }));
    }
    const know = resolved.knowledge_context;
    if (know) {
        if (know.summary) parts.push('summary: ' + String(know.summary).slice(0, 300));
        if (Array.isArray(know.decisions) && know.decisions.length > 0) parts.push('decisions: ' + JSON.stringify(know.decisions).slice(0, 500));
        if (Array.isArray(know.open_questions) && know.open_questions.length > 0) parts.push('open_questions: ' + JSON.stringify(know.open_questions).slice(0, 300));
    }
    // delta：预算内尽量多放，超预算逐条丢（从旧到新保留最近）
    let budget = ZIVEN_CONTEXT_BUDGET - parts.join('\n').length - 60;
    const deltaLines = [];
    const msgs = (resolved.delta_context && resolved.delta_context.messages) || [];
    for (let i = msgs.length - 1; i >= 0; i--) {
        const m = msgs[i];
        const line = '[' + m.author + '] ' + String(m.content || '').slice(0, 300);
        if (budget - line.length < 0) break;
        deltaLines.unshift(line);
        budget -= line.length;
    }
    if (deltaLines.length > 0) {
        parts.push('delta (' + deltaLines.length + '条):');
        parts.push(deltaLines.join('\n'));
    }
    if (resolved.delta_context && resolved.delta_context.continuation_available) {
        parts.push('(还有更早消息未包含——如需要可请求继续)');
    }
    const st = resolved.state;
    if (st) parts.push('cursor: ' + JSON.stringify({ last_consumed: st.last_consumed_message_id, first_contact: st.is_first_contact }));
    if (parts.length === 0) return '';
    return '[AGENT_CONTEXT]\n' + parts.join('\n') + '\n[/AGENT_CONTEXT]\n';
}

// 构造唤醒 payload：event_id/thread_id/message_id 必须带上（GPT #846 强调）
// ExternalChatHttpRequest 字段（ExternalChatModels.kt）：request_id/message/group/timeout_ms/stop_after/stream/response_mode/callback_url
// 事件溯源信息编码进 message 前缀（Operit 侧 Ziven 醒来后据此定位事件），response_mode=async_callback
async function buildWakePayload(env, event) {
    const threadId = event.payload?.thread_id || null;
    const sourceMessageId = event.payload?.source_message_id || event.message_id || null;
    const preview = event.payload?.content_preview || '';
    // M1.2 v2：Resolver 恢复包（失败不阻塞唤醒——拿不到上下文也要叫醒，只是少信息）
    let contextBlock = '';
    if (threadId) {
        try {
            const resolved = await resolveAgentContext(env, 'ziven', threadId);
            contextBlock = formatContextBlock(resolved);
        } catch (e) {
            console.error('[ziven_wake] context resolve 失败: ' + e.message);
        }
    }
    // 消息前缀：把事件溯源 ID 带给 Ziven（防多事件 ack 错乱）
    const prefix = `[cg-event] event=${event.event_id} thread=${threadId || ''} msg=${sourceMessageId || ''}\n`;
    // M1-b C（GPT #895）：唤醒处理协议固定写入 payload（软约束辅助，硬约束在 ack 服务端校验）
    const replyGuarantee = `\n[处理要求] 1. 处理完成后必须通过 chat_send 回复原 thread（thread_id=${threadId || ''}） 2. 回复成功后再 ack 本事件 3. 如无法回复到聊天室，不允许 ack success（M1-b 回复可见性硬规则）`;
    return {
        request_id: event.event_id,
        message: prefix + contextBlock + preview + replyGuarantee,
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
    const payload = await buildWakePayload(env, event);
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

// 构造 ntfy 推送：聊天室事件 → ntfy 频道（柳柳拍板 2026-09-10，替代隧道作为唤醒通道）
// 不依赖 Operit 隧道/公网入站，Operit 侧主动订阅即可收到（类似微信桥接 ws_receiver）
async function wakeViaNtfy(env, event) {
    const topic = env.NTFY_TOPIC || 'ziven-arch-test';
    const base = env.NTFY_BASE || 'https://ntfy.sh';
    const threadId = event.payload?.thread_id || null;
    const sourceMessageId = event.payload?.source_message_id || event.message_id || null;
    const preview = (event.payload?.content_preview || '').slice(0, 400);
    const body = `[cg-event] event=${event.event_id} thread=${threadId || ''} msg=${sourceMessageId || ''}\n${preview}`;
    const resp = await fetch(`${base}/${encodeURIComponent(topic)}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'text/plain',
            'Title': '聊天室 @ziven',
            'Priority': 'high',
            'Tags': 'ziven-wake'
        },
        body
    });
    if (!resp.ok) throw new Error('ntfy 推送失败 HTTP ' + resp.status);
    return { status: resp.status };
}

// 主入口：M1-a 每轮调度（scheduled() 调用）
// 流程：find → claim(原子) → delivering → POST → delivered / 失败重投或死信
export async function dispatchZivenWake(env) {
    const target = await resolveWakeTarget(env);
    // 即使隧道目标未配置，也继续（ntfy 通道不依赖隧道）
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
            // 2. 标记 delivering → 推送
            await markDelivering(env, event.event_id).catch(() => {});
            // 2b. ntfy 推送（柳柳拍板：即发即回主通道）——先推 ntfy，隧道作为辅助（若配置）
            let ntfyResult = null;
            try {
                ntfyResult = await wakeViaNtfy(env, event);
            } catch (e) {
                console.error('[ziven_wake] ntfy 推送失败 ' + event.event_id + ': ' + e.message);
            }
            try {
                if (target.baseUrl && target.token) {
                    const wake = await wakeOperit(env, event, target);
                    // 3. Operit 收到 → delivered
                    await markDelivered(env, event.event_id);
                    results.push({ event_id: event.event_id, action: 'delivered', http: wake.status, ntfy: ntfyResult?.status });
                } else {
                    // 隧道未配置：ntfy 已推送，标记 delivered（避免重复推送）
                    await markDelivered(env, event.event_id);
                    results.push({ event_id: event.event_id, action: 'ntfy_only', ntfy: ntfyResult?.status });
                }
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