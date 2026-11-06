// ============================================================
// Memory Repository — 唯一记忆数据访问层
// 只负责 Supabase memories / memory_events / memory_aliases 访问。

import { getTitle } from '../../utils/helpers.js';

function authHeaders(env, extra = {}) {
    return {
        'Authorization': 'Bearer ' + env.SUPABASE_ANON_KEY,
        'apikey': env.SUPABASE_ANON_KEY,
        ...extra
    };
}

export async function getMemoryByKey(env, key) {
    const resp = await fetch(`${env.SUPABASE_URL}/rest/v1/memories?key=eq.${encodeURIComponent(key)}&status=eq.active&select=*`, {
        headers: authHeaders(env)
    });
    if (!resp.ok) throw new Error('memory lookup HTTP ' + resp.status);
    const data = await resp.json();
    return Array.isArray(data) && data.length > 0 ? data[0] : null;
}

export async function getAllMemories(env) {
    const resp = await fetch(`${env.SUPABASE_URL}/rest/v1/memories?select=*&status=eq.active`, {
        headers: authHeaders(env)
    });
    if (!resp.ok) return [];
    const rows = await resp.json();
    return Array.isArray(rows) ? rows : [];
}

export function isCurrentMemory(memory) {
    return memory?.status === 'active' && memory.valid_to == null;
}

export async function getCurrentMemoryByKey(env, key) {
    const resp = await fetch(
        `${env.SUPABASE_URL}/rest/v1/memories?key=eq.${encodeURIComponent(key)}&status=eq.active&valid_to=is.null&select=*`,
        { headers: authHeaders(env) }
    );
    if (!resp.ok) throw new Error('current memory lookup HTTP ' + resp.status);
    const rows = await resp.json();
    const current = Array.isArray(rows) ? rows.filter(isCurrentMemory) : [];
    return current.length > 0 ? current[0] : null;
}

async function readRowsForRetrieval(env, url, source) {
    let response;
    try {
        response = await fetch(url, { headers: authHeaders(env) });
    } catch {
        const error = new Error(source + ' read failed: network_error');
        error.name = 'MemoryRepositoryReadError';
        error.source = source;
        error.code = 'network_error';
        throw error;
    }
    if (!response?.ok) {
        const error = new Error(source + ' read failed: http_error');
        error.name = 'MemoryRepositoryReadError';
        error.source = source;
        error.code = 'http_error';
        error.http_status = Number.isInteger(response?.status) ? response.status : null;
        throw error;
    }
    let rows;
    try {
        rows = await response.json();
    } catch {
        const error = new Error(source + ' read failed: invalid_json');
        error.name = 'MemoryRepositoryReadError';
        error.source = source;
        error.code = 'invalid_json';
        throw error;
    }
    if (!Array.isArray(rows)) {
        const error = new Error(source + ' read failed: invalid_response_shape');
        error.name = 'MemoryRepositoryReadError';
        error.source = source;
        error.code = 'invalid_response_shape';
        throw error;
    }
    return rows;
}

export async function getCurrentMemories(env) {
    const rows = await readRowsForRetrieval(
        env,
        `${env.SUPABASE_URL}/rest/v1/memories?select=*&status=eq.active&valid_to=is.null`,
        'memories'
    );
    return rows.filter(isCurrentMemory);
}

export async function findAuthoritativeKey(env, key) {
    if (!key || key.includes('/')) return null;
    const all = await getCurrentMemories(env);
    const hit = all.find(memory =>
        memory.key && memory.key.includes('/') &&
        getTitle(memory.key) === key &&
        memory.status === 'active'
    );
    return hit ? hit.key : null;
}

export async function getMemoryAliasIds(env, keyword) {
    const rows = await readRowsForRetrieval(
        env,
        `${env.SUPABASE_URL}/rest/v1/memory_aliases?select=memory_id&alias=ilike.%25${encodeURIComponent(keyword)}%25`,
        'memory_aliases'
    );
    return rows.map(row => row?.memory_id).filter(Boolean);
}

// Do not invent an empty history on network, HTTP, JSON or shape failures.
// The same read primitive still serves the existing legacy history path.
function historyReadError(source, code, httpStatus = null) {
    const error = new Error(source + ' history read failed: ' + code);
    error.name = 'MemoryHistoryReadError';
    error.source = source;
    error.code = code;
    error.http_status = httpStatus;
    return error;
}

async function readHistoryRows(env, url, source) {
    let response;
    try { response = await fetch(url, { headers: authHeaders(env) }); }
    catch { throw historyReadError(source, 'network_error'); }
    if (!response?.ok) throw historyReadError(source, 'http_error', response?.status ?? null);
    let rows;
    try { rows = await response.json(); }
    catch { throw historyReadError(source, 'invalid_json'); }
    if (!Array.isArray(rows)) throw historyReadError(source, 'invalid_response_shape');
    return rows;
}

export async function getMemoryEvents(env, memoryId) {
    return readHistoryRows(env,
        `${env.SUPABASE_URL}/rest/v1/memory_events?memory_id=eq.${encodeURIComponent(memoryId)}&select=*&order=created_at.asc`,
        'memory_events');
}

/**
 * History includes retired/expired keys. In tolerantEvents mode an event
 * failure preserves successfully read records but never pretends events=[].
 * Default shape and failure semantics remain compatible with old callers.
 */
export async function getMemoryHistoryByKey(env, key, options = {}) {
    const rows = await readHistoryRows(env,
        `${env.SUPABASE_URL}/rest/v1/memories?key=eq.${encodeURIComponent(key)}&select=*&order=created_at.desc`,
        'memories');
    const matches = rows.filter(row => row?.key === key);
    return Promise.all(matches.map(async record => {
        if (options?.tolerantEvents === true) {
            if (!record.id) {
                return { record, events: null, event_error: { code: 'missing_record_id' } };
            }
            try { return { record, events: await getMemoryEvents(env, record.id), event_error: null }; }
            catch (error) {
                return { record, events: null, event_error: {
                    code: error?.code || 'unknown_error',
                    http_status: error?.http_status ?? null
                } };
            }
        }
        return { record, events: await getMemoryEvents(env, record.id) };
    }));
}

export async function insertMemoryRecord(env, record) {
    return fetch(`${env.SUPABASE_URL}/rest/v1/memories`, {
        method: 'POST',
        headers: authHeaders(env, { 'Content-Type': 'application/json' }),
        body: JSON.stringify(record)
    });
}

export async function insertMemoryEvent(env, event) {
    return fetch(`${env.SUPABASE_URL}/rest/v1/memory_events`, {
        method: 'POST',
        headers: authHeaders(env, { 'Content-Type': 'application/json' }),
        body: JSON.stringify(event)
    });
}

export async function updateMemoryRecord(env, id, data) {
    return fetch(`${env.SUPABASE_URL}/rest/v1/memories?id=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: authHeaders(env, { 'Content-Type': 'application/json' }),
        body: JSON.stringify(data)
    });
}

export async function softDeleteMemoryRecords(env, key) {
    return fetch(
        `${env.SUPABASE_URL}/rest/v1/memories?key=eq.${encodeURIComponent(key)}&status=eq.active&valid_to=is.null`,
        {
            method: 'PATCH',
            headers: authHeaders(env, { 'Content-Type': 'application/json' }),
            body: JSON.stringify({ status: 'deleted', valid_to: new Date().toISOString(), updated_at: new Date().toISOString() })
        }
    );
}

export async function hasActiveMemory(env, key) {
    const resp = await fetch(
        `${env.SUPABASE_URL}/rest/v1/memories?key=eq.${encodeURIComponent(key)}&status=eq.active&valid_to=is.null&select=id`,
        { headers: authHeaders(env) }
    );
    if (!resp.ok) throw new Error('memory delete verification HTTP ' + resp.status);
    const rows = await resp.json();
    return Array.isArray(rows) && rows.length > 0;
}
