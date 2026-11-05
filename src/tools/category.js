// ============================================================
// 分类管理工具（Memory Core facade）
// 统一复用记忆仓储、查询与生命周期模块，避免独立 CRUD 路径。
// ============================================================

import { getTitle, formatTime, now } from '../utils/helpers.js';
import { getCurrentMemoryByKey } from '../modules/memory/repository.js';
import { listMemoryCategories, listMemoriesByCategory } from '../modules/memory/retrieval.js';
import { moveMemory } from '../modules/memory/lifecycle.js';

export async function handleCategoryTool(name, safeArgs, env) {
    let text = '';
    if (name === 'list_categories') {
        const sorted = await listMemoryCategories(env);
        if (sorted.length === 0) {
            text = '💡 暂无记忆，还没有分类';
        } else {
            let lines = '💡 分类列表（共 ' + sorted.length + ' 个分类）：\n';
            for (const [category, count] of sorted) lines += '- ' + category + '（' + count + '条）\n';
            text = lines;
        }
    } else if (name === 'recall_by_category') {
        if (!safeArgs.category) {
            text = '❌ 缺少参数：需要 category';
        } else {
            const { total, page, nextCursor } = await listMemoriesByCategory(env, safeArgs.category, safeArgs);
            if (total === 0) {
                text = '💡 分类 "' + safeArgs.category + '" 下暂无记忆';
            } else if (page.length === 0) {
                text = '💡 没有更多记忆了';
            } else {
                let lines = '💡 分类 "' + safeArgs.category + '" 的记忆（共 ' + total + ' 条，显示 ' + page.length + ' 条）：\n';
                for (const item of page) {
                    const title = getTitle(item.key);
                    const time = String(formatTime(item.created_at) || '未知');
                    lines += '- ' + title + ': ' + item.value + '\n  💡 ' + time + '\n';
                }
                if (nextCursor) lines += '\n💡 next_cursor: ' + nextCursor + '（继续翻页请传此值）';
                text = lines;
            }
        }
    } else if (name === 'move_category') {
        if (!safeArgs.key || !safeArgs.newCategory) {
            text = '❌ 缺少参数：需要 key 和 newCategory';
        } else {
            const existing = await getCurrentMemoryByKey(env, safeArgs.key);
            if (!existing) {
                text = '❌ 没有找到 "' + safeArgs.key + '"';
            } else {
                const newKey = safeArgs.newCategory + '/' + getTitle(safeArgs.key);
                const result = await moveMemory(env, safeArgs.key, safeArgs.newCategory);
                if (result.code === 'target_exists') {
                    text = '⚠️ 目标 key "' + newKey + '" 已存在，请先处理冲突';
                } else if (result.code === 'target_write_failed') {
                    text = '❌ 移动失败（目标写入失败），源记录保留：' + safeArgs.key;
                } else if (result.code === 'source_delete_unconfirmed') {
                    text = '⚠️ 目标已写入：' + newKey + '；源记录未能确认删除，请核查源记录：' + safeArgs.key;
                } else if (!result.ok) {
                    text = '❌ 移动失败：' + safeArgs.key;
                } else {
                    const created = String(formatTime(existing.created_at) || '未知');
                    const updated = String(formatTime(now()) || '未知');
                    text = '💡 已移动：' + safeArgs.key + ' → ' + newKey + '\n💡 分类：' + existing.category + ' → ' + safeArgs.newCategory + '\n📅 创建：' + created + '\n✏️ 更新：' + updated;
                }
            }
        }
    }
    return text;
}
