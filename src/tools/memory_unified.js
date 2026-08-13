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

async function getMemoryByKey(env, key) {
    const resp = await fetch(`${env.SUPABASE_URL}/rest/v1/memories?key=eq.${encodeURIComponent(key)}&select=*`, {
        headers: { 'Authorization': `Bearer ${env.SUPABASE_ANON_KEY}`, 'apikey': env.SUPABASE_ANON_KEY }
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data && data.length > 0 ? data[0] : null;
}

async function getAllMemories(env) {
    const resp = await fetch(`${env.SUPABASE_URL}/rest/v1/memories?select=*`, {
        headers: { 'Authorization': `Bearer ${env.SUPABASE_ANON_KEY}`, 'apikey': env.SUPABASE_ANON_KEY }
    });
    if (!resp.ok) return [];
    return await resp.json();
}

async function putMemory(env, key, data) {
    const existing = await getMemoryByKey(env, key);
    if (existing) {
        await fetch(`${env.SUPABASE_URL}/rest/v1/memories?key=eq.${encodeURIComponent(key)}`, {
            method: 'PATCH',
            headers: { 'Authorization': `Bearer ${env.SUPABASE_ANON_KEY}`, 'apikey': env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
    } else {
        const category = getCategory(key);
        const title = getTitle(key);
        await fetch(`${env.SUPABASE_URL}/rest/v1/memories`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${env.SUPABASE_ANON_KEY}`, 'apikey': env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ key, value: data.value, category, title, created_at: data.created_at || now(), updated_at: data.updated_at || now() })
        });
    }
}

async function deleteMemory(env, key) {
    await fetch(`${env.SUPABASE_URL}/rest/v1/memories?key=eq.${encodeURIComponent(key)}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${env.SUPABASE_ANON_KEY}`, 'apikey': env.SUPABASE_ANON_KEY }
    });
}

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
            const existing = await getMemoryByKey(env, safeArgs.key);
            if (existing) text = '⚠️ 该记忆已存在。如需修改请用 action=update';
            else {
                const data = { value: safeArgs.value, created_at: now(), updated_at: now() };
                await putMemory(env, safeArgs.key, data);
                text = '✅ 已新建记忆：' + safeArgs.key + '\n📂 分类：' + getCategory(safeArgs.key) + '\n📅 创建时间：' + formatTime(data.created_at);
            }
        }
    }
    else if (action === 'recall') {
        if (!safeArgs.key) text = '❌ 缺少参数：需要 key';
        else {
            const data = await getMemoryByKey(env, safeArgs.key);
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
    else if (action === 'update') {
        if (!safeArgs.key || !safeArgs.value) text = '❌ 缺少参数：需要 key 和 value';
        else {
            const existing = await getMemoryByKey(env, safeArgs.key);
            if (!existing) text = '❌ 没有找到 "' + safeArgs.key + '"，请用 action=remember';
            else {
                await putMemory(env, safeArgs.key, { ...existing, value: safeArgs.value, updated_at: now() });
                text = '✏️ 已更新：' + safeArgs.key + '\n📅 创建：' + formatTime(existing.created_at) + '\n✏️ 更新：' + formatTime(now());
            }
        }
    }
    else if (action === 'rename') {
        if (!safeArgs.old_key || !safeArgs.new_key) text = '❌ 缺少参数：需要 old_key 和 new_key';
        else if (safeArgs.old_key === safeArgs.new_key) text = '⚠️ 新旧 key 相同';
        else {
            const existing = await getMemoryByKey(env, safeArgs.old_key);
            if (!existing) text = '❌ 没有找到 "' + safeArgs.old_key + '"';
            else if (await getMemoryByKey(env, safeArgs.new_key)) text = '⚠️ 目标 key 已存在';
            else {
                await deleteMemory(env, safeArgs.old_key);
                await putMemory(env, safeArgs.new_key, { value: existing.value, created_at: existing.created_at, updated_at: now() });
                text = '✏️ 已重命名：' + safeArgs.old_key + ' → ' + safeArgs.new_key;
            }
        }
    }
    else if (action === 'forget') {
        if (!safeArgs.key) text = '❌ 缺少参数：需要 key';
        else {
            const existing = await getMemoryByKey(env, safeArgs.key);
            if (!existing) text = '❌ 没有找到 "' + safeArgs.key + '"';
            else { await deleteMemory(env, safeArgs.key); text = '🗑️ 已删除：' + safeArgs.key; }
        }
    }
    else if (action === 'list_categories') {
        const all = await getAllMemories(env);
        const categoryMap = {};
        for (const item of all) { const cat = item.category || '默认'; categoryMap[cat] = (categoryMap[cat] || 0) + 1; }
        const sorted = Object.entries(categoryMap).sort((a, b) => b[1] - a[1]);
        text = '💡 分类列表（共 ' + sorted.length + ' 个）：\n' + sorted.map(([cat, count]) => '- ' + cat + '（' + count + '条）').join('\n');
    }
    else if (action === 'by_category') {
        if (!safeArgs.category) text = '❌ 缺少参数：需要 category';
        else {
            const { limit, cursor } = parsePagination(safeArgs);
            const matched = (await getAllMemories(env)).filter(item => item.category === safeArgs.category).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
            let startIndex = 0;
            if (cursor) { const idx = matched.findIndex(i => i.id === cursor); if (idx !== -1) startIndex = idx + 1; }
            const page = matched.slice(startIndex, startIndex + limit);
            const nextCursor = matched.length > startIndex + limit ? page[page.length - 1]?.id : null;
            text = '💡 分类 "' + safeArgs.category + '" 的记忆（共 ' + matched.length + ' 条，显示 ' + page.length + ' 条）：\n' +
                page.map(i => '- ' + getTitle(i.key) + ': ' + i.value + '\n  💡 ' + formatTime(i.created_at)).join('\n') +
                (nextCursor ? '\n\n💡 next_cursor: ' + nextCursor : '');
        }
    }
    else if (action === 'move') {
        if (!safeArgs.key || !safeArgs.newCategory) text = '❌ 缺少参数：需要 key 和 newCategory';
        else {
            const existing = await getMemoryByKey(env, safeArgs.key);
            if (!existing) text = '❌ 没有找到 "' + safeArgs.key + '"';
            else {
                const newKey = safeArgs.newCategory + '/' + getTitle(safeArgs.key);
                if (await getMemoryByKey(env, newKey)) text = '⚠️ 目标 key 已存在';
                else {
                    await deleteMemory(env, safeArgs.key);
                    await putMemory(env, newKey, { value: existing.value, created_at: existing.created_at, updated_at: now() });
                    text = '💡 已移动：' + safeArgs.key + ' → ' + newKey;
                }
            }
        }
    }
    else if (action === 'search') {
        if (!safeArgs.keyword) text = '❌ 请输入搜索关键词';
        else {
            const keywords = safeArgs.keyword.trim().split(/\s+/).filter(k => k.length > 0);
            const { limit, cursor } = parsePagination(safeArgs);
            const matched = (await getAllMemories(env)).filter(item => {
                const combined = (item.key + ' ' + item.value).toLowerCase();
                return keywords.every(kw => combined.includes(kw.toLowerCase()));
            }).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
            let startIndex = 0;
            if (cursor) { const idx = matched.findIndex(i => i.id === cursor); if (idx !== -1) startIndex = idx + 1; }
            const page = matched.slice(startIndex, startIndex + limit);
            const nextCursor = matched.length > startIndex + limit ? page[page.length - 1]?.id : null;
            text = '💡 找到 ' + matched.length + ' 条结果（显示 ' + page.length + ' 条）：\n' +
                page.map(i => '- [' + getCategory(i.key) + '] ' + highlightText(getTitle(i.key), keywords) + ': ' + highlightText(i.value, keywords) + '\n  💡 ' + formatTime(i.created_at)).join('\n') +
                (nextCursor ? '\n\n💡 next_cursor: ' + nextCursor : '');
            await recordSearchKeyword(env, safeArgs.keyword.trim());
        }
    }
    else if (action === 'list') {
        const { limit, cursor } = parsePagination(safeArgs);
        const order = (safeArgs.order || 'desc').toLowerCase();
        const all = await getAllMemories(env);
        all.sort((a, b) => { const ta = new Date(a.created_at), tb = new Date(b.created_at); return order === 'asc' ? ta - tb : tb - ta; });
        let startIndex = 0;
        if (cursor) { const idx = all.findIndex(i => i.id === cursor); if (idx !== -1) startIndex = idx + 1; }
        const page = all.slice(startIndex, startIndex + limit);
        const nextCursor = all.length > startIndex + limit ? page[page.length - 1]?.id : null;
        text = '💡 全部记忆（共 ' + all.length + ' 条，显示 ' + page.length + ' 条）：\n' +
            page.map(i => '- [' + i.category + '] ' + getTitle(i.key) + ': ' + i.value.substring(0, 100) + '\n  💡 ' + formatTime(i.created_at)).join('\n') +
            (nextCursor ? '\n\n💡 next_cursor: ' + nextCursor : '');
    }
    else if (action === 'random') {
        const all = await getAllMemories(env);
        if (all.length === 0) text = '💡 暂无记忆';
        else {
            const candidates = safeArgs.category ? all.filter(i => i.category === safeArgs.category) : all;
            if (candidates.length === 0) text = '❌ 该分类下暂无记忆';
            else {
                const item = candidates[Math.floor(Math.random() * candidates.length)];
                text = '💡 随机一条：\n[' + item.category + '] ' + getTitle(item.key) + ': ' + item.value + '\n💡 ' + formatTime(item.created_at);
            }
        }
    }
    else if (action === 'by_date') {
        if (!safeArgs.start_date || !safeArgs.end_date) text = '❌ 缺少参数：需要 start_date 和 end_date';
        else {
            const { limit, cursor } = parsePagination(safeArgs);
            const start = new Date(safeArgs.start_date);
            const end = new Date(safeArgs.end_date); end.setHours(23, 59, 59, 999);
            const matched = (await getAllMemories(env)).filter(i => { const c = new Date(i.created_at); return c >= start && c <= end; }).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
            let startIndex = 0;
            if (cursor) { const idx = matched.findIndex(i => i.id === cursor); if (idx !== -1) startIndex = idx + 1; }
            const page = matched.slice(startIndex, startIndex + limit);
            text = '💡 ' + safeArgs.start_date + ' ~ ' + safeArgs.end_date + ' 的记忆（共 ' + matched.length + ' 条）：\n' +
                page.map(i => '- [' + i.category + '] ' + getTitle(i.key) + ': ' + i.value.substring(0, 100)).join('\n');
        }
    }
    else if (action === 'stats') {
        const all = await getAllMemories(env);
        const categoryMap = {};
        let weekCount = 0;
        const oneWeekAgo = new Date(); oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
        for (const item of all) { const cat = item.category || '默认'; categoryMap[cat] = (categoryMap[cat] || 0) + 1; if (new Date(item.created_at) >= oneWeekAgo) weekCount++; }
        text = '💡 统计：\n总条数：' + all.length + '\n分类数：' + Object.keys(categoryMap).length + '\n各分类：' + Object.entries(categoryMap).sort((a, b) => b[1] - a[1]).map(([c, n]) => c + '(' + n + '条)').join('、') + '\n💡 最近一周新增：' + weekCount + ' 条';
    }
    else if (action === 'suggest') {
        const suggestions = await getSearchSuggestions(env, safeArgs.prefix || '');
        text = '💡 联想词：\n' + suggestions.map(w => '- ' + w).join('\n') || '💡 暂无搜索历史';
    }
    else if (action === 'import') {
        try {
            const dataArray = JSON.parse(safeArgs.data);
            if (!Array.isArray(dataArray)) text = '❌ 需要 JSON 数组';
            else {
                let added = 0, skipped = 0, updated = 0;
                for (const item of dataArray) {
                    if (!item.key || !item.value) continue;
                    const existing = await getMemoryByKey(env, item.key);
                    if (existing) { if (existing.value === item.value) skipped++; else { await putMemory(env, item.key, { value: item.value, updated_at: now() }); updated++; } }
                    else { await putMemory(env, item.key, { value: item.value, created_at: now(), updated_at: now() }); added++; }
                }
                text = '💡 导入完成：新增 ' + added + '，更新 ' + updated + '，跳过 ' + skipped;
            }
        } catch (e) { text = '❌ JSON 解析失败：' + e.message; }
    }
    else if (action === 'export') {
        const all = await getAllMemories(env);
        const items = all.map(i => ({ key: i.key, value: i.value, created_at: i.created_at, updated_at: i.updated_at }));
        text = (safeArgs.format === 'text')
            ? '💡 记忆导出（共 ' + items.length + ' 条）：\n' + items.map(i => '【' + getCategory(i.key) + '】' + getTitle(i.key) + '\n内容：' + i.value + '\n---').join('\n')
            : '💡 记忆导出：\n```json\n' + JSON.stringify(items, null, 2) + '\n```';
    }
    else text = '❌ 未知操作：' + action + '（支持 remember/recall/update/rename/forget/search/list/random/by_date/stats/suggest/import/export/move/list_categories/by_category）';

    return text;
}