// Memory Transfer — 记忆导入/导出的共享用例
// 统一导入计数、写入结果判定与导出有效性过滤；不直接处理 HTTP/MCP 文案。

import { getMemoryByKey, getCurrentMemories } from './repository.js';
import { putMemory } from './lifecycle.js';
import { now, isMemoryType } from '../../utils/helpers.js';

export async function importMemories(env, items, options = {}) {
    if (!Array.isArray(items)) {
        return { ok: false, code: 'invalid_data', added: 0, updated: 0, skipped: 0, failed: 0 };
    }

    const invalidAsFailed = options.invalidAsFailed === true;
    let added = 0;
    let updated = 0;
    let skipped = 0;
    let failed = 0;

    for (const item of items) {
        if (!item?.key || !item?.value) {
            if (invalidAsFailed) failed++;
            continue;
        }

        const hasType = item.type !== undefined && item.type !== null && item.type !== '';
        if (hasType && !isMemoryType(item.type)) {
            if (invalidAsFailed) failed++;
            else skipped++;
            continue;
        }

        let existing;
        try {
            existing = await getMemoryByKey(env, item.key);
        } catch (error) {
            failed++;
            continue;
        }

        if (existing) {
            if (existing.value === item.value && (!hasType || existing.type === item.type)) {
                skipped++;
                continue;
            }
            const updateData = { value: item.value, updated_at: now() };
            if (hasType) updateData.type = item.type;
            const result = await putMemory(env, item.key, updateData);
            if (result?.ok) updated++;
            else failed++;
        } else {
            const result = await putMemory(env, item.key, {
                value: item.value,
                created_at: item.created_at || now(),
                updated_at: now(),
                ...(hasType ? { type: item.type } : {})
            });
            if (result?.ok) added++;
            else failed++;
        }
    }

    return { ok: failed === 0, added, updated, skipped, failed };
}

/**
 * Export only active/current memories. Both the unified memory action and the
 * legacy data tool must use the same effective-record filter and field shape.
 */
export async function getExportableMemories(env) {
    const current = await getCurrentMemories(env);
    return current.map(item => ({
            key: item.key,
            value: item.value,
            created_at: item.created_at,
            updated_at: item.updated_at
        }));
}
