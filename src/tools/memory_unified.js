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

export async function getMemoryByKey(env, key) {
    const resp = await fetch(`${env.SUPABASE_URL}/rest/v1/memories?key=eq.${encodeURIComponent(key)}&status=eq.active&select=*`, {
        headers: { 'Authorization': `Bearer ${env.SUPABASE_ANON_KEY}`, 'apikey': env.SUPABASE_ANON_KEY }
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data && data.length > 0 ? data[0] : null;
}

export async function getAllMemories(env) {
    const resp = await fetch(`${env.SUPABASE_URL}/rest/v1/memories?select=*&status=eq.active`, {
        headers: { 'Authorization': `Bearer ${env.SUPABASE_ANON_KEY}`, 'apikey': env.SUPABASE_ANON_KEY }
    });
    if (!resp.ok) return [];
    return await resp.json();
}

// v6.39.0 防副本闸门：同一事实只有一个权威版本（柳柳 2026-10-20 治本 · 巡检规则双副本根因）
// 若写入「不带分类前缀」的 key，而已存在「标题同名/带前缀」的权威档 → 返回权威 key（应重定向更新，不新建默认分类副本）
export async function findAuthoritativeKey(env, key) {
    if (!key || key.includes('/')) return null;
    const all = await getAllMemories(env);
    const hit = all.find(m => m.key && m.key.includes('/') && getTitle(m.key) === key && m.status === 'active');
    return hit ? hit.key : null;
}

export async function putMemory(env, key, data) {
    const existing = await getMemoryByKey(env, key);
    if (existing) {
        // 先确保历史事件写入成功，再更新当前值；失败时返回明确阶段。
        const nowTs = now();
        const oldVersion = existing.version || 1;
        const eventResp = await fetch(`${env.SUPABASE_URL}/rest/v1/memory_events`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${env.SUPABASE_ANON_KEY}`, 'apikey': env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ memory_id: existing.id, event_type: 'update', version: oldVersion, old_value: existing.value, actor: 'agent', reason: 'memory update (version chain)' })
        });
        if (!eventResp.ok) return { ok: false, stage: 'history', status: eventResp.status, error: 'history event write failed' };
        const updateResp = await fetch(`${env.SUPABASE_URL}/rest/v1/memories?id=eq.${existing.id}`, {
            method: 'PATCH',
            headers: { 'Authorization': `Bearer ${env.SUPABASE_ANON_KEY}`, 'apikey': env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ value: data.value, version: oldVersion + 1, status: 'active', updated_at: data.updated_at || nowTs })
        });
        if (!updateResp.ok) return { ok: false, stage: 'update', status: updateResp.status, error: 'memory update failed' };
    } else {
        const category = getCategory(key);
        const title = getTitle(key);
        const insertResp = await fetch(`${env.SUPABASE_URL}/rest/v1/memories`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${env.SUPABASE_ANON_KEY}`, 'apikey': env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ key, value: data.value, category, title, created_at: data.created_at || now(), updated_at: data.updated_at || now(), version: 1, valid_from: now(), status: 'active' })
        });
        if (!insertResp.ok) return { ok: false, stage: 'insert', status: insertResp.status, error: 'memory insert failed' };
    }
    return { ok: true };
}

async function deleteMemory(env, key) {
    // v6.38.2 软删修复：因 memory_events 为 append-only(禁 UPDATE/DELETE)，memories 物理 DELETE 会触发清理链被拒→整个删除回滚(forget假成功bug)。
    // 改为 UPDATE status='deleted'+valid_to=now() 软删：getMemoryByKey 过滤 status=active 自动隐藏 deleted 行，且删除留痕(合双时间轴/抗污染设计)。
    await fetch(`${env.SUPABASE_URL}/rest/v1/memories?key=eq.${encodeURIComponent(key)}&status=eq.active`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${env.SUPABASE_ANON_KEY}`, 'apikey': env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'deleted', valid_to: new Date().toISOString(), updated_at: new Date().toISOString() })
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
    else if (action === 'history') {
        if (!safeArgs.key) text = '❌ 缺少参数：需要 key';
        else {
            const m = await getMemoryByKey(env, safeArgs.key);
            if (!m) text = '❌ 没有找到 "' + safeArgs.key + '"';
            else {
                try {
                    const hh = { 'Authorization': 'Bearer ' + env.SUPABASE_ANON_KEY, 'apikey': env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' };
                    const resp = await fetch(env.SUPABASE_URL + '/rest/v1/memory_events?memory_id=eq.' + m.id + '&select=*&order=created_at.asc', { headers: hh });
                    const evs = await resp.json();
                    if (!Array.isArray(evs) || evs.length === 0) text = '💡 ' + safeArgs.key + '（当前 v' + (m.version || 1) + '，暂无历史版本）';
                    else text = '📜 ' + safeArgs.key + ' 历史版本（当前 v' + (m.version || 1) + '，共 ' + evs.length + ' 次更新）：\n' + evs.map(function (e) { return '- [v' + e.version + '] ' + formatTime(e.created_at) + ' ' + (e.reason || 'update') + '：' + String(e.old_value || '').substring(0, 80); }).join('\n') + '\n💡 当前值：' + String(m.value || '').substring(0, 120);
                } catch (e) { text = '❌ 查历史失败：' + e.message; }
            }
        }
    }
    else if (action === 'update') {
        if (!safeArgs.key || !safeArgs.value) text = '❌ 缺少参数：需要 key 和 value';
        else {
            const existing = await getMemoryByKey(env, safeArgs.key);
            if (existing) {
                await putMemory(env, safeArgs.key, { ...existing, value: safeArgs.value, updated_at: now() });
                text = '✏️ 已更新：' + safeArgs.key + '\n📅 创建：' + formatTime(existing.created_at) + '\n✏️ 更新：' + formatTime(now());
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
            // 多钥匙检索：先查别名表拿到关联记忆 id 集
            const aliasResp = await fetch(`${env.SUPABASE_URL}/rest/v1/memory_aliases?select=memory_id&alias=ilike.%25${encodeURIComponent(safeArgs.keyword.trim())}%25`, {
                headers: { 'Authorization': `Bearer ${env.SUPABASE_ANON_KEY}`, 'apikey': env.SUPABASE_ANON_KEY }
            });
            const aliasIds = aliasResp.ok ? (await aliasResp.json()).map(a => a.memory_id) : [];
            const matchedRaw = (await getAllMemories(env)).filter(item => {
                // 当前有效判定：只检索 status='active' AND valid_to IS NULL
                const isCurrent = item.status === 'active' && (item.valid_to == null);
                const combined = (item.key + ' ' + item.value).toLowerCase();
                const kwHit = keywords.every(kw => combined.includes(kw.toLowerCase()));
                // v6.43.0 情境唤醒：关键词命中 或 trigger_intents/entities 意图标签命中 或 别名命中
                const trigArr = item.trigger_intents || [];
                const entArr = item.entities || [];
                const kwLow = safeArgs.keyword.trim().toLowerCase();
                const ctxHit = (Array.isArray(trigArr) && trigArr.some(t => String(t).toLowerCase().includes(kwLow))) ||
                               (Array.isArray(entArr) && entArr.some(e => String(e).toLowerCase() === kwLow));
                return isCurrent && (kwHit || ctxHit || aliasIds.includes(item.id));
            });
            // 一跳关联扩散：命中记忆的 related_memory_ids 也带入（限一跳，防联想链失控）
            const matchedIds = new Set(matchedRaw.map(i => i.id));
            const allMem = await getAllMemories(env);
            const relatedAdded = [];
            for (const hit of matchedRaw) {
                const relIds = hit.related_memory_ids || [];
                if (Array.isArray(relIds)) {
                    for (const rid of relIds) {
                        if (!matchedIds.has(rid)) {
                            const rel = allMem.find(m => m.id === rid && m.status === 'active' && (m.valid_to == null));
                            if (rel) { relatedAdded.push(rel); matchedIds.add(rid); }
                        }
                    }
                }
            }
            const matched = matchedRaw.concat(relatedAdded).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
            let startIndex = 0;
            if (cursor) { const idx = matched.findIndex(i => i.id === cursor); if (idx !== -1) startIndex = idx + 1; }
            const page = matched.slice(startIndex, startIndex + limit);
            const nextCursor = matched.length > startIndex + limit ? page[page.length - 1]?.id : null;
            text = '💡 找到 ' + matched.length + ' 条结果（显示 ' + page.length + ' 条）：\n' +
                page.map(i => '- [' + getCategory(i.key) + '][' + (i.type || 'fact') + '] ' + highlightText(getTitle(i.key), keywords) + ': ' + highlightText(i.value, keywords) + '\n  💡 ' + formatTime(i.created_at)).join('\n') +
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
        text = suggestions.length
            ? '💡 联想词：\n' + suggestions.map(w => '- ' + w).join('\n')
            : '💡 暂无搜索历史';
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