// P2 · Session Bootstrap v0.1. Stateless, evidence-first, no business writes.
// Reuses Memory Core; no chatroom or Agent Runtime dependency.
import { getCurrentMemoryByKey } from '../memory/repository.js';
import { getMemoryStats, searchMemories } from '../memory/retrieval.js';

export const BOOTSTRAP_CONTRACT_VERSION = 'SB-RUNTIME-0.1';
export const BOOTSTRAP_KEYS = Object.freeze({
    identity: '🧬/我是谁',
    profile: '💕/关于柳柳',
    navigation: '记忆位置导航（换框/换设备自举·2026-10-18）',
    checkpoint: '⚙️/当前工作检查点',
    protocol: '⚙️/恢复协议·Session Bootstrap SB-1.0'
});
export const SESSION_BOOTSTRAP_TOOL = Object.freeze({
    name: 'session_bootstrap',
    description: 'P2 跨宿主只读恢复：从唯一云端身份根、工作检查点、协议、导航与实时记忆统计生成可验证的 READY/DEGRADED/BLOCKED 恢复证据；不授予代码/数据库/发布权限，也不保证第三方 App 自动调用。',
    input_schema: {
        type: 'object',
        properties: {
            host: { type: 'string', enum: ['chatgpt', 'operit', 'other'] },
            invocation: { type: 'string', enum: ['explicit', 'startup_hook', 'frame_instruction', 'unknown'] },
            available_tools: { type: 'array', items: { type: 'string' } }
        }
    }
});
export const SESSION_CONTEXT_CONTRACT_VERSION = 'SC-RUNTIME-0.1';
export const SESSION_CONTEXT_TOOL = Object.freeze({
    name: 'session_context',
    description: '只读继续工作场景：核实云端恢复状态，组合唯一当前工作检查点、已确认决定与可选主题关联记忆，返回来源/限制；不授予执行权限或保证宿主自动调用。',
    input_schema: {
        type: 'object',
        properties: {
            host: SESSION_BOOTSTRAP_TOOL.input_schema.properties.host,
            invocation: SESSION_BOOTSTRAP_TOOL.input_schema.properties.invocation,
            topic: { type: 'string', description: '可选，需召回关联记忆的具体主题；留空只恢复当前工作' }
        }
    }
});

function extractLine(text, field) {
    // Prefer a standalone field over an incidental mention inside another field.
    const explicit = new RegExp('(?:^|\\n)\\s*(?:[-*]\\s*)?(?:\\*\\*)?' + field + '\\s*[=:：]\\s*([^\\n]+)', 'im').exec(text);
    const inline = explicit || new RegExp(field + '\\s*[=:：]\\s*([^\\n]+)', 'i').exec(text);
    return inline ? inline[1].replace(/\*\*/g, '').trim() : null;
}

function currentCheckpointOverlay(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    // A versioned current overlay precedes all preserved historical snapshots.
    return value.split(/\n---\s*(?:旧工作检查点|以下为历史|以下为旧|历史检查点)/)[0].slice(0, 6500);
}

export function parseCheckpoint(value) {
    const current = currentCheckpointOverlay(value);
    if (!current) return null;
    const stateRaw = extractLine(current, 'workflow_state');
    const workflowState = stateRaw ? (stateRaw.match(/^[a-zA-Z0-9_.-]+/) || [])[0] || null : null;
    const nextAction = extractLine(current, 'next_action');
    const activeFocus = extractLine(current, 'active_focus');
    const doNotRepeat = extractLine(current, 'do_not_repeat');
    return {
        workflow_state: workflowState,
        active_focus: activeFocus ? activeFocus.slice(0, 280) : null,
        do_not_repeat: doNotRepeat ? doNotRepeat.slice(0, 400) : null,
        next_action: nextAction ? nextAction.slice(0, 650) : null,
        excerpt: current.slice(0, 1000),
        excerpt_truncated: current.length > 1000,
        structured_fields_verified: Boolean(workflowState && nextAction && activeFocus && doNotRepeat)
    };
}

function excerpt(value, limit) {
    const raw = typeof value === 'string' ? value.trim() : '';
    return { text: raw ? raw.slice(0, limit) : null, truncated: raw.length > limit };
}

function checkpointDecision(value) {
    const current = currentCheckpointOverlay(value);
    return {
        decision: excerpt(current ? extractLine(current, 'decision') : null, 480),
        evidence: excerpt(current ? extractLine(current, 'evidence') : null, 600)
    };
}

function publicSource(key, record, status, error) {
    const source = { key, status, read_method: 'exact_active_current' };
    if (record && status === 'ok') {
        source.updated_at = record.updated_at || null;
        source.version = record.version ?? null;
    }
    if (error) source.error = error;
    return source;
}

async function fetchSource(env, key) {
    try {
        const row = await getCurrentMemoryByKey(env, key);
        if (!row) return { record: null, source: publicSource(key, null, 'missing') };
        if (row.key !== key || row.status !== 'active' || row.valid_to != null) {
            return { record: null, source: publicSource(key, null, 'invalid', 'non_authoritative_record') };
        }
        if (typeof row.value !== 'string' || !row.value.trim()) {
            return { record: null, source: publicSource(key, null, 'invalid', 'empty_content') };
        }
        return { record: row, source: publicSource(key, row, 'ok') };
    } catch (error) {
        return { record: null, source: publicSource(key, null, 'error', String(error?.message || error)) };
    }
}

function describeHost(args) {
    const host = ['chatgpt', 'operit', 'other'].includes(args.host) ? args.host : 'other';
    const invocation = ['explicit', 'startup_hook', 'frame_instruction'].includes(args.invocation)
        ? args.invocation : 'unknown';
    const tools = Array.isArray(args.available_tools)
        ? [...new Set(args.available_tools.filter(v => typeof v === 'string' && v.trim()).map(v => v.trim()))].slice(0, 40)
        : [];
    return {
        name: host,
        invocation,
        advertised_tools: tools,
        capability_evidence: tools.length ? 'host_reported_not_tested' : 'unknown',
        startup_hook_verified: false,
        note: 'Host-reported capability is not independent execution evidence.'
    };
}

/**
 * No writes, no tools/list, no search fallback, no full private profile/identity
 * content in the output. Permissions are never granted by restoration.
 */
export async function buildSessionBootstrap(env, args = {}) {
    const host = describeHost(args && typeof args === 'object' ? args : {});
    const names = Object.keys(BOOTSTRAP_KEYS);
    const outcomes = await Promise.all(names.map(name => fetchSource(env, BOOTSTRAP_KEYS[name])));
    const sources = Object.fromEntries(names.map((name, i) => [name, outcomes[i].source]));
    const records = Object.fromEntries(names.map((name, i) => [name, outcomes[i].record]));

    let stats = null;
    let statsStatus = 'error';
    let statsError = null;
    try {
        const result = await getMemoryStats(env);
        if (Number.isInteger(result?.total) && result.total > 0 &&
            Number.isInteger(result?.categoryCount) && result.categoryCount > 0) {
            stats = { total: result.total, category_count: result.categoryCount };
            statsStatus = 'ok';
        } else {
            statsStatus = 'invalid';
            statsError = 'missing_or_empty_statistics';
        }
    } catch (error) {
        statsError = String(error?.message || error);
    }
    sources.memory_stats = { status: statsStatus, read_method: 'current_memory_stats' };
    if (statsError) sources.memory_stats.error = statsError;

    const checkpoint = records.checkpoint ? parseCheckpoint(records.checkpoint.value) : null;
    const blockers = [];
    for (const name of ['identity', 'checkpoint', 'memory_stats']) {
        if (sources[name].status !== 'ok') blockers.push(name + '_' + sources[name].status);
    }
    const warnings = [];
    for (const name of ['profile', 'navigation', 'protocol']) {
        if (sources[name].status !== 'ok') warnings.push(name + '_' + sources[name].status);
    }
    if (records.checkpoint && !checkpoint?.structured_fields_verified) {
        warnings.push('checkpoint_fields_incomplete');
    }
    if (records.checkpoint) {
        const updated = Date.parse(records.checkpoint.updated_at || '');
        if (!Number.isFinite(updated)) warnings.push('checkpoint_timestamp_unverified');
        else if (Date.now() - updated > 30 * 24 * 3600 * 1000) warnings.push('checkpoint_stale');
        else if (updated - Date.now() > 24 * 3600 * 1000) warnings.push('checkpoint_timestamp_in_future');
    }
    const status = blockers.length ? 'BLOCKED' : warnings.length ? 'DEGRADED' : 'READY';
    return {
        contract_version: BOOTSTRAP_CONTRACT_VERSION,
        status,
        restored: status === 'READY',
        sources,
        memory_stats: stats,
        current_work: checkpoint ? {
            workflow_state: checkpoint.workflow_state,
            active_focus: checkpoint.active_focus,
            do_not_repeat: checkpoint.do_not_repeat,
            next_action: checkpoint.next_action,
            checkpoint_excerpt: checkpoint.excerpt,
            excerpt_truncated: checkpoint.excerpt_truncated,
            updated_at: records.checkpoint?.updated_at || null,
            version: records.checkpoint?.version ?? null
        } : null,
        host,
        blockers,
        warnings,
        permissions: {
            granted_by_bootstrap: false,
            permitted_next_step: status === 'BLOCKED' ? 'read_only_recovery' : 'verify_scope_and_approval',
            note: 'A restored phase never authorizes coding, merging main, deployment, DB writes or paused chatroom actions.'
        },
        limitations: {
            startup_hook: 'not_verified',
            cross_host_first_reply: 'not_tested',
            production_write_E3: 'not_run',
            worker_tools_list: 'not_invoked_known_registration_side_effect',
            tool_usage_telemetry: 'excluded_for_session_bootstrap_only'
        }
    };
}

export async function handleSessionBootstrap(name, safeArgs, env) {
    if (name !== SESSION_BOOTSTRAP_TOOL.name) return 'ERROR: Unknown session tool: ' + name;
    return JSON.stringify(await buildSessionBootstrap(env, safeArgs));
}

/**
 * Resume-work context, not a second bootstrap or an automatic host hook.
 * The existing bootstrap checks authority first. Full identity/profile text and
 * checkpoint history are intentionally excluded from the resulting bundle.
 */
export async function buildSessionContext(env, args = {}) {
    const input = args && typeof args === 'object' ? args : {};
    const topic = typeof input.topic === 'string' ? input.topic.trim() : '';
    if (topic.length > 120) return {
        contract_version: SESSION_CONTEXT_CONTRACT_VERSION,
        status: 'BLOCKED', errors: ['topic_too_long'], current_work: null,
        related_memories: [], permissions: { granted_by_context: false }
    };

    const bootstrap = await buildSessionBootstrap(env, input);
    const result = {
        contract_version: SESSION_CONTEXT_CONTRACT_VERSION,
        status: bootstrap.status,
        sources: bootstrap.sources,
        host: bootstrap.host,
        blockers: [...bootstrap.blockers],
        warnings: [...bootstrap.warnings],
        current_work: null,
        confirmed_context: null,
        related_memories: [],
        related_status: topic ? 'pending' : 'not_requested',
        permissions: { granted_by_context: false, permitted_next_step: bootstrap.permissions.permitted_next_step },
        limitations: {
            automatic_host_invocation: 'not_verified',
            private_profile_full_text: 'not_included',
            topic_results: 'keyword_current_only_best_effort'
        }
    };
    if (bootstrap.status === 'BLOCKED') return result;

    try {
        const checkpoint = await getCurrentMemoryByKey(env, BOOTSTRAP_KEYS.checkpoint);
        if (!checkpoint || checkpoint.key !== BOOTSTRAP_KEYS.checkpoint ||
            checkpoint.status !== 'active' || checkpoint.valid_to != null) {
            result.status = 'BLOCKED';
            result.blockers.push('checkpoint_changed_during_context');
            result.permissions.permitted_next_step = 'read_only_recovery';
            return result;
        }
        const parsed = parseCheckpoint(checkpoint.value);
        if (!parsed?.structured_fields_verified) {
            result.status = 'DEGRADED';
            result.warnings.push('context_checkpoint_fields_incomplete');
        }
        result.current_work = parsed ? {
            workflow_state: parsed.workflow_state,
            active_focus: parsed.active_focus,
            next_action: parsed.next_action,
            do_not_repeat: parsed.do_not_repeat,
            source_key: checkpoint.key,
            source_version: checkpoint.version ?? null,
            source_updated_at: checkpoint.updated_at || null,
            structured_fields_verified: parsed.structured_fields_verified
        } : null;
        result.confirmed_context = checkpointDecision(checkpoint.value);
        if (!result.confirmed_context.decision.text) {
            result.warnings.push('checkpoint_decision_not_recorded');
            if (result.status === 'READY') result.status = 'DEGRADED';
        }
    } catch (error) {
        result.status = 'BLOCKED';
        result.blockers.push('checkpoint_context_read_failed');
        result.permissions.permitted_next_step = 'read_only_recovery';
        return result;
    }

    if (topic) {
        try {
            const hits = await searchMemories(env, topic);
            const reservedKeys = new Set(Object.values(BOOTSTRAP_KEYS));
            const eligible = hits.filter(hit => hit?.status === 'active' && hit.valid_to == null &&
                !reservedKeys.has(hit.key));
            result.related_memories = eligible.slice(0, 3).map(hit => ({
                key: hit.key,
                category: hit.category || null,
                source_updated_at: hit.updated_at || null,
                match_reason: hit._match?.reason || 'unknown',
                excerpt: excerpt(hit.value, 240)
            }));
            result.related_status = eligible.length ? 'matched_best_effort' : 'no_matches_or_source_unavailable';
        } catch (error) {
            result.related_status = 'unavailable';
            result.warnings.push('topic_search_failed');
            if (result.status === 'READY') result.status = 'DEGRADED';
        }
    }
    return result;
}

export async function handleSessionContext(name, safeArgs, env) {
    if (name !== SESSION_CONTEXT_TOOL.name) return 'ERROR: Unknown session context tool: ' + name;
    return JSON.stringify(await buildSessionContext(env, safeArgs));
}
