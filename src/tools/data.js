// ============================================================
// 数据导入/导出工具（兼容入口，复用 Memory Core transfer）
// ============================================================
import { getCategory, getTitle, formatTime } from '../utils/helpers.js';
import { importMemories, getExportableMemories } from '../modules/memory/transfer.js';

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
                    // Legacy data facade historically skipped malformed rows silently.
                    const result = await importMemories(env, dataArray, { invalidAsFailed: false });
                    text = '💡 导入完成：新增 ' + result.added + ' 条，更新 ' + result.updated +
                        ' 条，跳过 ' + result.skipped + ' 条（数据相同）' +
                        (result.failed ? '，失败 ' + result.failed + ' 条' : '');
                }
            } catch (e) {
                text = '❌ JSON 解析失败：' + e.message;
            }
        }
    } else if (name === 'export') {
        const format = (safeArgs.format || 'json').toLowerCase();
        const items = await getExportableMemories(env);
        if (items.length === 0) {
            text = '💡 暂无记忆可导出';
        } else if (format === 'text') {
            let lines = '💡 记忆导出（共 ' + items.length + ' 条）：\n\n';
            for (const item of items) {
                const category = getCategory(item.key);
                const title = getTitle(item.key);
                lines += '【' + category + '】' + title + '\n内容：' + item.value +
                    '\n创建：' + formatTime(item.created_at) +
                    '\n更新：' + formatTime(item.updated_at) + '\n---\n';
            }
            text = lines;
        } else {
            text = '💡 记忆导出（JSON 格式）：\n```json\n' +
                JSON.stringify(items, null, 2) + '\n```';
        }
    }
    return text;
}
