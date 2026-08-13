// ============================================================
// 数据导入/导出工具（Supabase 版）
// ============================================================
import { getCategory, getTitle, formatTime, generateId, now } from '../utils/helpers.js';

async function getMemoryByKey(env, key) {
    const supabaseUrl = env.SUPABASE_URL;
    const supabaseKey = env.SUPABASE_ANON_KEY;
    const resp = await fetch(`${supabaseUrl}/rest/v1/memories?key=eq.${encodeURIComponent(key)}&select=*`, {
        headers: { 'Authorization': `Bearer ${supabaseKey}`, 'apikey': supabaseKey }
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data && data.length > 0 ? data[0] : null;
}
async function putMemory(env, key, data) {
    const supabaseUrl = env.SUPABASE_URL;
    const supabaseKey = env.SUPABASE_ANON_KEY;
    const existing = await getMemoryByKey(env, key);
    if (existing) {
        await fetch(`${supabaseUrl}/rest/v1/memories?key=eq.${encodeURIComponent(key)}`, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${supabaseKey}`, 'apikey': supabaseKey,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });
    } else {
        const category = getCategory(key);
        const title = getTitle(key);
        await fetch(`${supabaseUrl}/rest/v1/memories`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${supabaseKey}`, 'apikey': supabaseKey,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                key: key, value: data.value, category: category, title: title,
                created_at: data.created_at || now(), updated_at: data.updated_at || now()
            })
        });
    }
}
async function getAllMemories(env) {
    const supabaseUrl = env.SUPABASE_URL;
    const supabaseKey = env.SUPABASE_ANON_KEY;
    const resp = await fetch(`${supabaseUrl}/rest/v1/memories?select=*`, {
        headers: { 'Authorization': `Bearer ${supabaseKey}`, 'apikey': supabaseKey }
    });
    if (!resp.ok) return [];
    return await resp.json();
}

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
        if (all.length === 0) {
            text = '💡 暂无记忆可导出';
        } else {
            const items = all.map(item => ({ key: item.key, value: item.value, created_at: item.created_at, updated_at: item.updated_at }));
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