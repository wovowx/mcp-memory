// ============================================================
// 统一记忆管理工具
// ============================================================
// 用法：memory(action, key, value, ...)
// action: remember/recall/update/rename/forget/search/list/random/by_date/stats/suggest/import/export/move/list_categories/by_category

import {
    getCategory, getTitle, formatTime, generateId, now,
    parsePagination, highlightText, isValidDate
} from '../utils/helpers.js';
import { recordSearchKeyword, getSearchSuggestions } from '../utils/search.js';
import {
    getMemoryByKey, getCurrentMemoryByKey, getAllMemories, findAuthoritativeKey, getMemoryHistoryByKey
} from '../modules/memory/repository.js';
import { putMemory, deleteMemory, renameMemory, moveMemory } from '../modules/memory/lifecycle.js';
import {
    searchMemoriesWithStatus, listMemoryCategories, listMemories, listMemoriesByCategory,
    listMemoriesByDate, getMemoryStats, getRandomMemory
} from '../modules/memory/retrieval.js';
import { importMemories, getExportableMemories } from '../modules/memory/transfer.js';

export { getMemoryByKey, getCurrentMemoryByKey, getAllMemories, findAuthoritativeKey, putMemory };

export async function handleMemoryTool(name, safeArgs, env) {
    // 兼容旧名称：memory_remember → remember 等
    const actionMap = {
        'memory_remember': 'remember', 'memory_recall': 'recall',
        'memory_update': 'update', 'memory_rename': 'rename',
        'memory_forget': 'forget', 'memory_search': 'search',
        'memory_list': 'list', 'memory_random': 'random',
        'memory_by_date': 'by_date', 'memory_stats': 'stats',
        'memory_suggest': 'suggest', 'memory_import': 'import',
        'memory_export': 'export', 'memory_move': 'move',
        'memory_list_categories': 'list_categories', 'memory_by_category': 'by_category'
    };
    const action = actionMap[name] || safeArgs.action || 'recall';
    let text = '';

    if (action === 'remember') {
        if (!safeArgs.key || !safeArgs.value) text = '❌ 缺少参数：需要 key 和 value';
        else {
            const existing = await getCurrentMemoryByKey(env, safeArgs.key);
            if (existing) text = '⚠️ 该记忆已存在。如需修改请用 action=update';
            else {
                const authKey = await findAuthoritativeKey(env, safeArgs.key);
                if (authKey) text = '⚠️ 已有权威档「' + authKey + '」（标题同名）。请用这个完整 key 去 update，别新建默认分类副本（防冗余 · v6.39.0）';
                else {
                    const data = { value: safeArgs.value, created_at: now(), updated_at: now() };
                    const writeResult = await putMemory(env, safeArgs.key, data);
                    if (!writeResult?.ok) text = '❌ 新建记忆失败（' + (writeResult?.stage || 'write') + '）：' + safeArgs.key;
                    else text = '✅ 已新建记忆：' + safeArgs.key + '\n📂 分类：' + getCategory(safeArgs.key) + '\n📅 创建时间：' + formatTime(data.created_at);
                }
            }
        }
    }
    else if (action === 'recall') {
        if (!safeArgs.key) text = '❌ 缺少参数：需要 key';
        else {
            const data = await getCurrentMemoryByKey(env, safeArgs.key);
            if (!data) text = '❌ 没有找到 "' + safeArgs.key + '"';
            else {
                const content = data.value;
                const chunkSize = safeArgs.chunk_size || 5000;
                const offset = safeArgs.offset || 0;
                if (content.length <= chunkSize) {
                    text = '💡 ' + safeArgs.key + '\n📂 分类：' + data.category + '\n📝 内容：' + content + '\n📅 创建：' + formatTime(data.created_at) + '\n✏️ 更新：' + formatTime(data.updated_at);
                } else {
                    const totalChunks = Math.ceil(content.length / chunkSize);
                    const currentChunk = Math.floor(offset / chunkSize) + 1;
                    const start = offset;
                    const end = Math.min(offset + chunkSize, content.length);
                    text = '💡 ' + safeArgs.key + '\n📂 分类：' + data.category + '\n📝 内容（第 ' + currentChunk + '/' + totalChunks + ' 段）：\n' + content.slice(start, end) + '\n\n💡 继续：recall(key="' + safeArgs.key + '", offset=' + end + ', chunk_size=' + chunkSize + ')';
                }
            }
        }
    }
    else if (action === 'history') {
        if (!safeArgs.key) text = '❌ 缺少参数：需要 key';
        else {
            try {
                const histories = await getMemoryHistoryByKey(env, safeArgs.key);
                if (histories.length === 0) {
                    text = '❌ 没有找到 "' + safeArgs.key + '"';
                } else {
                    const sections = histories.map(({ record, events }) => {
                        const current = record.status === 'active' && record.valid_to == null;
                        const state = current ? '当前有效' : (record.status === 'deleted' ? '已软删除' : '非当前有效');
                        const version = record.version || 1;
                        const history = events.length === 0
                            ? '暂无事件记录'
                            : events.map(event =>
                                '- [v' + event.version + '] ' + formatTime(event.created_at) + ' ' +
                                (event.reason || event.event_type || 'update') + '：' +
                                String(event.old_value || '').substring(0, 80)
                            ).join('\n');
                        return '📌 ' + state + '（v' + version + '，事件 ' + events.length + ' 条）\n' +
                            history + '\n💡 记录值：' + String(record.value || '').substring(0, 120);
                    });
                    text = '📜 ' + safeArgs.key + ' 历史记录（' + histories.length + ' 条记录）：\n' + sections.join('\n\n');
                }
            } catch (e) {
                text = '❌ 查历史失败：' + e.message;
            }
        }
    }
    else if (action === 'update') {
        if (!safeArgs.key || !safeArgs.value) text = '❌ 缺少参数：需要 key 和 value';
        else {
            const existing = await getCurrentMemoryByKey(env, safeArgs.key);
            if (existing) {
                const writeResult = await putMemory(env, safeArgs.key, { ...existing, value: safeArgs.value, updated_at: now() });
                if (!writeResult?.ok) text = '❌ 更新失败（' + (writeResult?.stage || 'write') + '）：' + safeArgs.key;
                else text = '✏️ 已更新：' + safeArgs.key + '\n📅 创建：' + formatTime(existing.created_at) + '\n✏️ 更新：' + formatTime(now());
            } else {
                const authKey = await findAuthoritativeKey(env, safeArgs.key);
                if (authKey) text = '⚠️ 没找到「' + safeArgs.key + '」，但已有权威档「' + authKey + '」——请用这个完整 key 更新（防另建副本 · v6.39.0）';
                else text = '❌ 没有找到 "' + safeArgs.key + '"，请用 action=remember';
            }
        }
    }
    else if (action === 'rename') {
        if (!safeArgs.old_key || !safeArgs.new_key) text = '❌ 缺少参数：需要 old_key 和 new_key';
        else if (safeArgs.old_key === safeArgs.new_key) text = '⚠️ 新旧 key 相同';
        else {
            const result = await renameMemory(env, safeArgs.old_key, safeArgs.new_key);
            if (result.code === 'not_found') text = '❌ 没有找到 "' + safeArgs.old_key + '"';
            else if (result.code === 'target_exists') text = '⚠️ 目标 key 已存在';
            else if (result.code === 'target_write_failed') text = '❌ 重命名失败（目标写入失败），源记录保留：' + safeArgs.old_key;
            else if (result.code === 'source_delete_unconfirmed') {
                text = '⚠️ 目标已写入：' + safeArgs.new_key + '；源记录未能确认删除（' + (result.deleteResult?.stage || 'delete') + '），请核查源记录：' + safeArgs.old_key;
            } else {
                text = '✏️ 已重命名：' + safeArgs.old_key + ' → ' + safeArgs.new_key;
            }
        }
    }
    else if (action === 'forget') {
        if (!safeArgs.key) text = '❌ 缺少参数：需要 key';
        else {
            const existing = await getCurrentMemoryByKey(env, safeArgs.key);
            if (!existing) text = '❌ 没有找到 "' + safeArgs.key + '"';
            else {
                const deleteResult = await deleteMemory(env, safeArgs.key);
                text = deleteResult?.ok ? '🗑️ 已删除：' + safeArgs.key : '❌ 删除未能确认（' + (deleteResult?.stage || 'delete') + '）：' + safeArgs.key;
            }
        }
    }
    else if (action === 'list_categories') {
        const categories = await listMemoryCategories(env);
        text = '💡 分类列表（共 ' + categories.length + ' 个）：\n' +
            categories.map(([category, count]) => '- ' + category + '（' + count + '条）').join('\n');
    }
    else if (action === 'by_category') {
        if (!safeArgs.category) text = '❌ 缺少参数：需要 category';
        else {
            const { total, page, nextCursor } = await listMemoriesByCategory(env, safeArgs.category, safeArgs);
            text = '💡 分类 "' + safeArgs.category + '" 的记忆（共 ' + total + ' 条，显示 ' + page.length + ' 条）：\n' +
                page.map(i => '- ' + getTitle(i.key) + ': ' + i.value + '\n  💡 ' + formatTime(i.created_at)).join('\n') +
                (nextCursor ? '\n\n💡 next_cursor: ' + nextCursor : '');
        }
    }
    else if (action === 'move') {
        if (!safeArgs.key || !safeArgs.newCategory) text = '❌ 缺少参数：需要 key 和 newCategory';
        else {
            const result = await moveMemory(env, safeArgs.key, safeArgs.newCategory);
            const newKey = safeArgs.newCategory + '/' + getTitle(safeArgs.key);
            if (result.code === 'not_found') text = '❌ 没有找到 "' + safeArgs.key + '"';
            else if (result.code === 'target_exists') text = '⚠️ 目标 key 已存在';
            else if (result.code === 'target_write_failed') text = '❌ 移动失败（目标写入失败），源记录保留：' + safeArgs.key;
            else if (result.code === 'source_delete_unconfirmed') {
                text = '⚠️ 目标已写入：' + newKey + '；源记录未能确认删除（' + (result.deleteResult?.stage || 'delete') + '），请核查源记录：' + safeArgs.key;
            } else {
                const existing = result.existing;
                text = '💡 已移动：' + safeArgs.key + ' → ' + newKey + '\n💡 分类：' + existing.category + ' → ' + safeArgs.newCategory + '\n📅 创建：' + formatTime(existing.created_at) + '\n✏️ 更新：' + formatTime(now());
            }
        }
    }
    else if (action === 'search') {
        if (!safeArgs.keyword) text = '❌ 请输入搜索关键词';
        else {
            const keywords = safeArgs.keyword.trim().split(/\s+/).filter(k => k.length > 0);
            const { limit, cursor } = parsePagination(safeArgs);
            const matched = await searchMemories(env, safeArgs.keyword.trim());
            let startIndex = 0;
            if (cursor) { const idx = matched.findIndex(i => i.id === cursor); if (idx !== -1) startIndex = idx + 1; }
            const page = matched.slice(startIndex, startIndex + limit);
            const nextCursor = matched.length > startIndex + limit ? page[page.length - 1]?.id : null;
            text = '💡 找到 ' + matched.length + ' 条结果（显示 ' + page.length + ' 条）：\n' +
                page.map(i => '- [' + getCategory(i.key) + '][' + (i.type || 'fact') + '] ' + highlightText(getTitle(i.key), keywords) + ': ' + highlightText(i.value, keywords) +
                    (i._match?.reason ? ' [match_reason=' + i._match.reason + ']' : '') +
                    (i._match?.related_from_key ? ' [关联来源=' + i._match.related_from_key + ']' : '') +
                    (i._match?.reason === 'shared_entity' ? ' [共同实体=' + (i._match.matched_terms || []).join('、') + ']' : '') +
                    '\n  💡 ' + formatTime(i.created_at)).join('\n') +
                (nextCursor ? '\n\n💡 next_cursor: ' + nextCursor : '');
            await recordSearchKeyword(env, safeArgs.keyword.trim());
        }
    }
    else if (action === 'list') {
        const { total, page, nextCursor } = await listMemories(env, safeArgs);
        text = '💡 全部记忆（共 ' + total + ' 条，显示 ' + page.length + ' 条）：\n' +
            page.map(i => '- [' + i.category + '] ' + getTitle(i.key) + ': ' + i.value.substring(0, 100) + '\n  💡 ' + formatTime(i.created_at)).join('\n') +
            (nextCursor ? '\n\n💡 next_cursor: ' + nextCursor : '');
    }
    else if (action === 'random') {
        const result = await getRandomMemory(env, safeArgs.category);
        if (result.status === 'empty') text = '💡 暂无记忆';
        else if (result.status === 'category_empty') text = '❌ 该分类下暂无记忆';
        else {
            const item = result.item;
            text = '💡 随机一条：\n[' + item.category + '] ' + getTitle(item.key) + ': ' + item.value + '\n💡 ' + formatTime(item.created_at);
        }
    }
    else if (action === 'by_date') {
        if (!safeArgs.start_date || !safeArgs.end_date) text = '❌ 缺少参数：需要 start_date 和 end_date';
        else {
            const { total, page } = await listMemoriesByDate(env, safeArgs.start_date, safeArgs.end_date, safeArgs);
            text = '💡 ' + safeArgs.start_date + ' ~ ' + safeArgs.end_date + ' 的记忆（共 ' + total + ' 条）：\n' +
                page.map(i => '- [' + i.category + '] ' + getTitle(i.key) + ': ' + i.value.substring(0, 100)).join('\n');
        }
    }
    else if (action === 'stats') {
        const stats = await getMemoryStats(env);
        text = '💡 统计：\n总条数：' + stats.total + '\n分类数：' + stats.categoryCount +
            '\n各分类：' + stats.categories.map(([category, count]) => category + '(' + count + '条)').join('、') +
            '\n💡 最近一周新增：' + stats.weekCount + ' 条';
    }
    else if (action === 'suggest') {
        const suggestions = await getSearchSuggestions(env, safeArgs.prefix || '');
        text = suggestions.length
            ? '💡 联想词：\n' + suggestions.map(w => '- ' + w).join('\n')
            : '💡 暂无搜索历史';
    }
    else if (action === 'import') {
        try {
            const dataArray = JSON.parse(safeArgs.data);
            if (!Array.isArray(dataArray)) text = '❌ 需要 JSON 数组';
            else {
                const result = await importMemories(env, dataArray, { invalidAsFailed: true });
                text = '💡 导入完成：新增 ' + result.added + '，更新 ' + result.updated + '，跳过 ' + result.skipped + '，失败 ' + result.failed;
            }
        } catch (e) { text = '❌ JSON 解析失败：' + e.message; }
    }
    else if (action === 'export') {
        const items = await getExportableMemories(env);
        const fence = String.fromCharCode(96).repeat(3);
        text = (safeArgs.format === 'text')
            ? '💡 记忆导出（共 ' + items.length + ' 条）：\n' + items.map(i => '【' + getCategory(i.key) + '】' + getTitle(i.key) + '\n内容：' + i.value + '\n---').join('\n')
            : '💡 记忆导出：\n' + fence + 'json\n' + JSON.stringify(items, null, 2) + '\n' + fence;
    }
    else text = '❌ 未知操作：' + action + '（支持 remember/recall/update/rename/forget/search/list/random/by_date/stats/suggest/import/export/move/list_categories/by_category）';

    return text;
}