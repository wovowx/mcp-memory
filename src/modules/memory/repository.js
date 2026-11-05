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

export async function getCurrentMemories(env) {
    const resp = await fetch(
        `${env.SUPABASE_URL}/rest/v1/memories?select=*&status=eq.active&valid_to=is.null`,
        { headers: authHeaders(env) }
    );
    if (!resp.ok) return [];
    const rows = await resp.json();
    return Array.isArray(rows) ? rows.filter(isCurrentMemory) : [];
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
    const resp = await fetch(
        `${env.SUPABASE_URL}/rest/v1/memory_aliases?select=memory_id&alias=ilike.%25${encodeURIComponent(keyword)}%25`,
        { headers: authHeaders(env) }
    );
    if (!resp.ok) return [];
    const rows = await resp.json();
    return Array.isArray(rows) ? rows.map(row => row?.memory_id).filter(Boolean) : [];
}

export async function getMemoryEvents(env, memoryId) {
    const resp = await fetch(
        `${env.SUPABASE_URL}/rest/v1/memory_events?memory_id=eq.${encodeURIComponent(memoryId)}&select=*&order=created_at.asc`,
        { headers: authHeaders(env) }
    );
    if (!resp.ok) throw new Error('memory events HTTP ' + resp.status);
    const rows = await resp.json();
    return Array.isArray(rows) ? rows : [];
}

/**
 * History intentionally includes soft-deleted/expired memory rows. A lifecycle
 * operation may move or retire a key, but its event ledger must remain readable.
 */
export async function getMemoryHistoryByKey(env, key) {
    const resp = await fetch(
        `${env.SUPABASE_URL}/rest/v1/memories?key=eq.${encodeURIComponent(key)}&select=*&order=created_at.desc`,
        { headers: authHeaders(env) }
    );
    if (!resp.ok) throw new Error('memory history lookup HTTP ' + resp.status);
    const rows = await resp.json();
    const matches = Array.isArray(rows) ? rows.filter(row => row?.key === key) : [];
    return Promise.all(matches.map(async record => ({
        record,
        events: await getMemoryEvents(env, record.id)
    })));
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
