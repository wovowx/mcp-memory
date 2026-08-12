// ============================================================
// 分类管理工具（Supabase 版）
// ============================================================
// @ts-nocheck
import { getCategory, getTitle, formatTime, now, parsePagination } from '../utils/helpers.js';
// ============================================================
// Supabase 操作函数
// ============================================================
async function getAllMemories(env) {
    const supabaseUrl = env.SUPABASE_URL;
    const supabaseKey = env.SUPABASE_ANON_KEY;
    
    const resp = await fetch(`${supabaseUrl}/rest/v1/memories?select=*`, {
        headers: {
            'Authorization': `Bearer ${supabaseKey}`,
            'apikey': supabaseKey
        }
    });
    if (!resp.ok) return [];
    return await resp.json();
}
async function getMemoryByKey(env, key) {
    const supabaseUrl = env.SUPABASE_URL;
    const supabaseKey = env.SUPABASE_ANON_KEY;
    
    const resp = await fetch(`${supabaseUrl}/rest/v1/memories?key=eq.${encodeURIComponent(key)}&select=*`, {
        headers: {
            'Authorization': `Bearer ${supabaseKey}`,
            'apikey': supabaseKey
        }
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data && data.length > 0 ? data[0] : null;
}
async function deleteMemory(env, key) {
    const supabaseUrl = env.SUPABASE_URL;
    const supabaseKey = env.SUPABASE_ANON_KEY;
    
    await fetch(`${supabaseUrl}/rest/v1/memories?key=eq.${encodeURIComponent(key)}`, {
        method: 'DELETE',
        headers: {
            'Authorization': `Bearer ${supabaseKey}`,
            'apikey': supabaseKey
        }
    });
}
async function putMemory(env, key, data) {
    const supabaseUrl = env.SUPABASE_URL;
    const supabaseKey = env.SUPABASE_ANON_KEY;
    
    const existing = await getMemoryByKey(env, key);
    if (existing) {
        await fetch(`${supabaseUrl}/rest/v1/memories?key=eq.${encodeURIComponent(key)}`, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${supabaseKey}`,
                'apikey': supabaseKey,
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
                'Authorization': `Bearer ${supabaseKey}`,
                'apikey': supabaseKey,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                key: key,
                value: data.value,
                category: category,
                title: title,
                created_at: data.created_at || new Date().toISOString(),
                updated_at: data.updated_at || new Date().toISOString()
            })
        });
    }
}
// ============================================================
// 工具处理器
// ============================================================
export async function handleCategoryTool(name, safeArgs, env) {
    let text = '';
    // ============================================================
    // list_categories
    // ============================================================
    if (name === 'list_categories') {
        const all = await getAllMemories(env);
        if (all.length === 0) {
            text = '������ 暂无记忆，还没有分类';
        } else {
            const categoryMap = {};
            for (const item of all) {
                const cat = item.category || '默认';
                categoryMap[cat] = (categoryMap[cat] || 0) + 1;
            }
            const sorted = Object.entries(categoryMap).sort((a, b) => b[1] - a[1]);
            let lines = '������ 分类列表（共 ' + sorted.length + ' 个分类）：\n';
            for (const [cat, count] of sorted) {
                lines += '- ' + cat + '（' + count + '条）\n';
            }
            text = lines;
        }
    }
    // ============================================================
    // recall_by_category
    // ============================================================
    else if (name === 'recall_by_category') {
        if (!safeArgs.category) {
            text = '❌ 缺少参数：需要 category';
        } else {
            const { limit, cursor } = parsePagination(safeArgs);
            const all = await getAllMemories(env);
            const matched = all.filter(item => item.category === safeArgs.category);
            if (matched.length === 0) {
                text = '������ 分类 "' + safeArgs.category + '" 下暂无记忆';
            } else {
                matched.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
                let startIndex = 0;
                if (cursor) {
                    const idx = matched.findIndex(item => item.id === cursor);
                    if (idx !== -1) startIndex = idx + 1;
                }
                const page = matched.slice(startIndex, startIndex + limit);
                const nextCursor = matched.length > startIndex + limit ? page[page.length - 1]?.id : null;
                if (page.length === 0) {
                    text = '������ 没有更多记忆了';
                } else {
                    let lines = '������ 分类 "' + safeArgs.category + '" 的记忆（共 ' + matched.length + ' 条，显示 ' + page.length + ' 条）：\n';
                    for (const item of page) {
                        const title = getTitle(item.key);
                        const time = String(formatTime(item.created_at) || '未知');
                        lines += '- ' + title + ': ' + item.value + '\n  ������ ' + time + '\n';
                    }
                    if (nextCursor) {
                        lines += '\n������ next_cursor: ' + nextCursor + '（继续翻页请传此值）';
                    }
                    text = lines;
                }
            }
        }
    }
    // ============================================================
    // move_category
    // ============================================================
    else if (name === 'move_category') {
        if (!safeArgs.key || !safeArgs.newCategory) {
            text = '❌ 缺少参数：需要 key 和 newCategory';
        } else {
            const existing = await getMemoryByKey(env, safeArgs.key);
            if (!existing) {
                text = '❌ 没有找到 "' + safeArgs.key + '"';
            } else {
                const newKey = safeArgs.newCategory + '/' + getTitle(safeArgs.key);
                const duplicate = await getMemoryByKey(env, newKey);
                if (duplicate) {
                    text = '⚠️ 目标 key "' + newKey + '" 已存在，请先处理冲突';
                } else {
                    await deleteMemory(env, safeArgs.key);
                    const data = {
                        value: existing.value,
                        created_at: existing.created_at,
                        updated_at: new Date().toISOString()
                    };
                    await putMemory(env, newKey, data);
                    const created = String(formatTime(existing.created_at) || '未知');
                    const updated = String(formatTime(new Date().toISOString()) || '未知');
                    text = '������ 已移动：' + safeArgs.key + ' → ' + newKey + '\n������ 分类：' + existing.category + ' → ' + safeArgs.newCategory + '\n������ 创建：' + created + '\n✏️ 更新：' + updated;
                }
            }
        }
    }
    return text;
}