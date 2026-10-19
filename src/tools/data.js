// ============================================================
// 数据导入/导出工具（Supabase 版）
// ============================================================
import { getCategory, getTitle, formatTime, generateId, now } from '../utils/helpers.js';
import { getMemoryByKey, getAllMemories, putMemory } from './memory_unified.js';


export async function handleDataTool(name, safeArgs, env) {
    let text = '';
    if (name === 'import') {
        if (!safeArgs.data) {
            text = '❌ 缺少参数：需要 data（JSON 数组）';
        } else {
            try {
                const dataArray = JSON.parse(safeArgs.data);
                if (!Array.isArray(dataArray)) {
                    text = '❌ 数据格式错误：需要 JSON 数组';
                } else {
                    let added = 0, skipped = 0, updated = 0;
                    for (const item of dataArray) {
                        if (!item.key || !item.value) continue;
                        const existing = await getMemoryByKey(env, item.key);
                        if (existing) {
                            if (existing.value === item.value) { skipped++; }
                            else { const data = { value: item.value, updated_at: now() }; await putMemory(env, item.key, data); updated++; }
                        } else {
                            const data = { value: item.value, created_at: item.created_at || now(), updated_at: now() };
                            await putMemory(env, item.key, data); added++;
                        }
                    }
                    text = '💡 导入完成：新增 ' + added + ' 条，更新 ' + updated + ' 条，跳过 ' + skipped + ' 条（数据相同）';
                }
            } catch (e) {
                text = '❌ JSON 解析失败：' + e.message;
            }
        }
    } else if (name === 'export') {
        const format = (safeArgs.format || 'json').toLowerCase();
        const all = await getAllMemories(env);
        // 只导出当前有效记录（软删除的 status=deleted 不导出）
        const active = Array.isArray(all) ? all.filter(i => i.status === 'active' && (i.valid_to == null)) : [];
        if (active.length === 0) {
            text = '💡 暂无记忆可导出';
        } else {
            const items = active.map(item => ({ key: item.key, value: item.value, created_at: item.created_at, updated_at: item.updated_at }));
            if (format === 'text') {
                let lines = '💡 记忆导出（共 ' + items.length + ' 条）：\n\n';
                for (const item of items) {
                    const category = getCategory(item.key);
                    const title = getTitle(item.key);
                    lines += '【' + category + '】' + title + '\n内容：' + item.value + '\n创建：' + formatTime(item.created_at) + '\n更新：' + formatTime(item.updated_at) + '\n---\n';
                }
                text = lines;
            } else {
                text = '💡 记忆导出（JSON 格式）：\n```json\n' + JSON.stringify(items, null, 2) + '\n```';
            }
        }
    }
    return text;
}