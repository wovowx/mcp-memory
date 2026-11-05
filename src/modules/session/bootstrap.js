// P2 · Session Bootstrap v0.1. Stateless, evidence-first, no business writes.
// Reuses Memory Core; no chatroom or Agent Runtime dependency.
import { getCurrentMemoryByKey } from '../memory/repository.js';
import { getMemoryStats } from '../memory/retrieval.js';

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

function extractLine(text, field) {
    // Prefer a standalone field over an incidental mention inside another field.
    const explicit = new RegExp('(?:^|\\n)\\s*(?:[-*]\\s*)?(?:\\*\\*)?' + field + '\\s*[=:：]\\s*([^\\n]+)', 'im').exec(text);
    const inline = explicit || new RegExp(field + '\\s*[=:：]\\s*([^\\n]+)', 'i').exec(text);
    return inline ? inline[1].replace(/\*\*/g, '').trim() : null;
}

export function parseCheckpoint(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    // A versioned current overlay precedes all preserved historical snapshots.
    const current = value.split(/\n---\s*(?:旧工作检查点|以下为历史|以下为旧|历史检查点)/)[0].slice(0, 6500);
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
