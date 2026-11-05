// Memory Lifecycle — 记忆写入、版本事件与软删除协调
// 保留既有 REST 请求顺序和结果语义；事务/CAS 缺口不在此处伪装解决。

import { getCategory, getTitle, now } from '../../utils/helpers.js';
import {
    getCurrentMemoryByKey, insertMemoryRecord, insertMemoryEvent,
    updateMemoryRecord, softDeleteMemoryRecords, hasActiveMemory
} from './repository.js';

async function memoryWriteFetch(operation) {
    try { return await operation(); }
    catch (error) { return { ok: false, status: 0, networkError: error.message }; }
}

export async function putMemory(env, key, data) {
    let existing;
    try {
        existing = await getCurrentMemoryByKey(env, key);
    } catch (error) {
        return { ok: false, stage: 'lookup', error: error.message };
    }

    if (existing) {
        const nowTs = now();
        const oldVersion = existing.version || 1;
        const eventResp = await memoryWriteFetch(() => insertMemoryEvent(env, {
            memory_id: existing.id,
            event_type: 'update',
            version: oldVersion,
            old_value: existing.value,
            actor: 'agent',
            reason: 'memory update (version chain)'
        }));
        if (!eventResp.ok) {
            return { ok: false, stage: 'history', status: eventResp.status, error: 'history event write failed' };
        }

        const updateResp = await memoryWriteFetch(() => updateMemoryRecord(env, existing.id, {
            value: data.value,
            version: oldVersion + 1,
            status: 'active',
            updated_at: data.updated_at || nowTs
        }));
        if (!updateResp.ok) {
            return { ok: false, stage: 'update', status: updateResp.status, error: 'memory update failed' };
        }
    } else {
        const category = getCategory(key);
        const title = getTitle(key);
        const record = {
            key,
            value: data.value,
            category,
            title,
            created_at: data.created_at || now(),
            updated_at: data.updated_at || now(),
            version: 1,
            valid_from: now(),
            status: 'active'
        };
        // Preserve existing semantic metadata during import/relocation without
        // copying identity, lifecycle status, timestamps, or generated fields.
        for (const field of ['type', 'source_ref', 'trigger_intents', 'entities', 'related_memory_ids']) {
            if (data[field] !== undefined) record[field] = data[field];
        }
        const insertResp = await memoryWriteFetch(() => insertMemoryRecord(env, record));
        if (!insertResp.ok) {
            return { ok: false, stage: 'insert', status: insertResp.status, error: 'memory insert failed' };
        }
    }

    return { ok: true };
}

export async function deleteMemory(env, key) {
    try {
        const patchResp = await softDeleteMemoryRecords(env, key);
        if (!patchResp.ok) return { ok: false, stage: 'delete', status: patchResp.status };

        try {
            if (await hasActiveMemory(env, key)) {
                return { ok: false, stage: 'verify', error: 'source remains active' };
            }
            return { ok: true };
        } catch (error) {
            return { ok: false, stage: 'verify', status: error.status, error: error.message };
        }
    } catch (error) {
        return { ok: false, stage: 'delete', error: error.message };
    }
}

async function relocateExistingMemory(env, sourceKey, targetKey, existing) {
    if (await getCurrentMemoryByKey(env, targetKey)) {
        return { ok: false, code: 'target_exists', sourceKey, targetKey };
    }

    const writeResult = await putMemory(env, targetKey, {
        value: existing.value,
        created_at: existing.created_at,
        updated_at: now(),
        type: existing.type,
        source_ref: existing.source_ref,
        trigger_intents: existing.trigger_intents,
        entities: existing.entities,
        related_memory_ids: existing.related_memory_ids
    });
    if (!writeResult?.ok) {
        return { ok: false, code: 'target_write_failed', sourceKey, targetKey, writeResult };
    }

    const deleteResult = await deleteMemory(env, sourceKey);
    if (!deleteResult?.ok) {
        return { ok: false, code: 'source_delete_unconfirmed', sourceKey, targetKey, deleteResult };
    }
    return { ok: true, sourceKey, targetKey, existing };
}

export async function renameMemory(env, oldKey, newKey) {
    if (oldKey === newKey) return { ok: false, code: 'same_key', sourceKey: oldKey, targetKey: newKey };
    const existing = await getCurrentMemoryByKey(env, oldKey);
    if (!existing) return { ok: false, code: 'not_found', sourceKey: oldKey, targetKey: newKey };
    return relocateExistingMemory(env, oldKey, newKey, existing);
}

export async function moveMemory(env, key, newCategory) {
    const existing = await getCurrentMemoryByKey(env, key);
    if (!existing) return { ok: false, code: 'not_found', sourceKey: key };
    const targetKey = newCategory + '/' + getTitle(key);
    return relocateExistingMemory(env, key, targetKey, existing);
}
