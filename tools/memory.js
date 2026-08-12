// ============================================================
// 记忆管理工具（Supabase 版）
// ============================================================
// @ts-nocheck
import {
    getCategory, getTitle, formatTime, generateId, now,
    parsePagination, highlightText, isValidDate
} from '../utils/helpers.js';
import { recordSearchKeyword, getSearchSuggestions } from '../utils/search.js';
// ============================================================
// Supabase 操作函数
// ============================================================
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
                created_at: data.created_at || now(),
                updated_at: data.updated_at || now()
            })
        });
    }
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
// ============================================================
// 工具处理器
// ============================================================
export async function handleMemoryTool(name, safeArgs, env) {
    let text = '';
    // ============================================================
    // remember
    // ============================================================
    if (name === 'remember') {
        if (!safeArgs.key || !safeArgs.value) {
            text = '❌ 缺少参数：需要 key 和 value';
        } else {
            const existing = await getMemoryByKey(env, safeArgs.key);
            if (existing) {
                text = '⚠️ 该记忆已存在。如需修改内容请使用 update，如需修改分类请使用 move_category';
            } else {
                const data = {
                    value: safeArgs.value,
                    created_at: now(),
                    updated_at: now()
                };
                await putMemory(env, safeArgs.key, data);
                const category = getCategory(safeArgs.key);
                text = '✅ 已新建记忆：' + safeArgs.key + '\n������ 分类：' + category + '\n������ 创建时间：' + formatTime(data.created_at);
            }
        }
    }
    // ============================================================
    // recall - 支持分段读取长内容
    // ============================================================
    else if (name === 'recall') {
        if (!safeArgs.key) {
            text = '❌ 缺少参数：需要 key';
        } else {
            const data = await getMemoryByKey(env, safeArgs.key);
            if (!data) {
                text = '❌ 没有找到 "' + safeArgs.key + '"';
            } else {
                const content = data.value;
                const chunkSize = safeArgs.chunk_size || 5000;
                const offset = safeArgs.offset || 0;
                
                // 如果内容长度在限制内，直接返回
                if (content.length <= chunkSize) {
                    text = '������ ' + safeArgs.key + '\n������ 分类：' + data.category + '\n������ 内容：' + content + '\n������ 创建：' + formatTime(data.created_at) + '\n✏️ 更新：' + formatTime(data.updated_at);
                } else {
                    // 分段返回
                    const totalChunks = Math.ceil(content.length / chunkSize);
                    const currentChunk = Math.floor(offset / chunkSize) + 1;
                    const start = offset;
                    const end = Math.min(offset + chunkSize, content.length);
                    const chunk = content.slice(start, end);
                    
                    text = '������ ' + safeArgs.key + '\n������ 分类：' + data.category + '\n������ 创建：' + formatTime(data.created_at) + '\n✏️ 更新：' + formatTime(data.updated_at) + '\n\n������ 内容（第 ' + currentChunk + '/' + totalChunks + ' 段，共 ' + content.length + ' 字符）：\n' + chunk + '\n\n������ 继续读取：recall(key="' + safeArgs.key + '", offset=' + end + ', chunk_size=' + chunkSize + ')';
                }
            }
        }
    }
    // ============================================================
    // update
    // ============================================================
    else if (name === 'update') {
        if (!safeArgs.key || !safeArgs.value) {
            text = '❌ 缺少参数：需要 key 和 value';
        } else {
            const existing = await getMemoryByKey(env, safeArgs.key);
            if (!existing) {
                text = '❌ 没有找到 "' + safeArgs.key + '"，无法更新。如需新建请使用 remember';
            } else {
                const data = {
                    value: safeArgs.value,
                    updated_at: now()
                };
                await putMemory(env, safeArgs.key, { ...existing, ...data });
                text = '✏️ 已更新：' + safeArgs.key + '\n������ 新内容：' + safeArgs.value + '\n������ 创建：' + formatTime(existing.created_at) + '\n✏️ 更新：' + formatTime(now());
            }
        }
    }
    // ============================================================
    // rename
    // ============================================================
    else if (name === 'rename') {
        if (!safeArgs.old_key || !safeArgs.new_key) {
            text = '❌ 缺少参数：需要 old_key 和 new_key';
        } else if (safeArgs.old_key === safeArgs.new_key) {
            text = '⚠️ 新旧 key 相同，无需修改';
        } else {
            const existing = await getMemoryByKey(env, safeArgs.old_key);
            if (!existing) {
                text = '❌ 没有找到 "' + safeArgs.old_key + '"';
            } else {
                const duplicate = await getMemoryByKey(env, safeArgs.new_key);
                if (duplicate) {
                    text = '⚠️ 目标 key "' + safeArgs.new_key + '" 已存在，请先处理冲突';
                } else {
                    await deleteMemory(env, safeArgs.old_key);
                    const data = {
                        value: existing.value,
                        created_at: existing.created_at,
                        updated_at: now()
                    };
                    await putMemory(env, safeArgs.new_key, data);
                    text = '✏️ 已重命名：' + safeArgs.old_key + ' → ' + safeArgs.new_key +
                        '\n������ 内容：' + existing.value +
                        '\n������ 创建：' + formatTime(existing.created_at) +
                        '\n✏️ 更新：' + formatTime(now());
                }
            }
        }
    }
    // ============================================================
    // forget
    // ============================================================
    else if (name === 'forget') {
        if (!safeArgs.key) {
            text = '❌ 缺少参数：需要 key';
        } else {
            const existing = await getMemoryByKey(env, safeArgs.key);
            if (!existing) {
                text = '❌ 没有找到 "' + safeArgs.key + '"';
            } else {
                await deleteMemory(env, safeArgs.key);
                text = '������️ 已删除：' + safeArgs.key + '\n������ 内容：' + existing.value + '\n������ 创建：' + formatTime(existing.created_at);
            }
        }
    }
    // ============================================================
    // list_categories
    // ============================================================
    else if (name === 'list_categories') {
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
                        lines += '- ' + title + ': ' + item.value + '\n  ������ ' + formatTime(item.created_at) + '\n';
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
                        updated_at: now()
                    };
                    await putMemory(env, newKey, data);
                    text = '������ 已移动：' + safeArgs.key + ' → ' + newKey + '\n������ 分类：' + existing.category + ' → ' + safeArgs.newCategory + '\n������ 创建：' + formatTime(existing.created_at) + '\n✏️ 更新：' + formatTime(now());
                }
            }
        }
    }
    // ============================================================
    // search
    // ============================================================
    else if (name === 'search') {
        if (!safeArgs.keyword) {
            text = '❌ 请输入搜索关键词';
        } else {
            const keyword = safeArgs.keyword.trim();
            const keywords = keyword.split(/\s+/).filter(k => k.length > 0);
            const { limit, cursor } = parsePagination(safeArgs);
            const all = await getAllMemories(env);
            const matched = [];
            for (const item of all) {
                const combined = (item.key + ' ' + item.value).toLowerCase();
                const allMatch = keywords.every(kw => combined.includes(kw.toLowerCase()));
                if (allMatch) {
                    matched.push(item);
                }
            }
            matched.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
            let startIndex = 0;
            if (cursor) {
                const idx = matched.findIndex(item => item.id === cursor);
                if (idx !== -1) startIndex = idx + 1;
            }
            const page = matched.slice(startIndex, startIndex + limit);
            const nextCursor = matched.length > startIndex + limit ? page[page.length - 1]?.id : null;
            if (page.length === 0) {
                text = matched.length === 0 ? '������ 没有找到匹配的记忆' : '������ 没有更多匹配结果了';
            } else {
                let lines = '������ 找到 ' + matched.length + ' 条结果（显示 ' + page.length + ' 条）：\n';
                for (const item of page) {
                    const category = getCategory(item.key);
                    const title = getTitle(item.key);
                    let highlightedTitle = highlightText(title, keywords);
                    let highlightedValue = highlightText(item.value, keywords);
                    lines += '- [' + category + '] ' + highlightedTitle + ': ' + highlightedValue + '\n  ������ ' + formatTime(item.created_at) + '\n';
                }
                if (nextCursor) {
                    lines += '\n������ next_cursor: ' + nextCursor + '（继续翻页请传此值）';
                }
                text = lines;
            }
            await recordSearchKeyword(env, keyword);
        }
    }
    // ============================================================
    // recall_all
    // ============================================================
    else if (name === 'recall_all') {
        const { limit, cursor } = parsePagination(safeArgs);
        const order = (safeArgs.order || 'desc').toLowerCase();
        const all = await getAllMemories(env);
        if (all.length === 0) {
            text = '������ 暂无记忆，先存一条吧～';
        } else {
            all.sort((a, b) => {
                const ta = new Date(a.created_at);
                const tb = new Date(b.created_at);
                return order === 'asc' ? ta - tb : tb - ta;
            });
            let startIndex = 0;
            if (cursor) {
                const idx = all.findIndex(item => item.id === cursor);
                if (idx !== -1) startIndex = idx + 1;
            }
            const page = all.slice(startIndex, startIndex + limit);
            const nextCursor = all.length > startIndex + limit ? page[page.length - 1]?.id : null;
            if (page.length === 0) {
                text = '������ 没有更多记忆了';
            } else {
                let lines = '������ 全部记忆（共 ' + all.length + ' 条，显示 ' + page.length + ' 条）：\n';
                for (const item of page) {
                    const category = getCategory(item.key);
                    const title = getTitle(item.key);
                    lines += '- [' + category + '] ' + title + ': ' + item.value + '\n  ������ ' + formatTime(item.created_at) + '\n';
                }
                if (nextCursor) {
                    lines += '\n������ next_cursor: ' + nextCursor + '（继续翻页请传此值）';
                }
                text = lines;
            }
        }
    }
    // ============================================================
    // random
    // ============================================================
    else if (name === 'random') {
        const category = safeArgs.category || null;
        const all = await getAllMemories(env);
        if (all.length === 0) {
            text = '������ 暂无记忆，先存一条吧～';
        } else {
            let candidates = all;
            if (category) {
                candidates = all.filter(item => item.category === category);
                if (candidates.length === 0) {
                    text = '❌ 分类 "' + category + '" 下暂无记忆';
                }
            }
            if (candidates.length > 0) {
                const randomItem = candidates[Math.floor(Math.random() * candidates.length)];
                text = '������ 随机一条：\n[' + randomItem.category + '] ' + getTitle(randomItem.key) + ': ' + randomItem.value + '\n������ ' + formatTime(randomItem.created_at);
            }
        }
    }
    // ============================================================
    // recall_by_date
    // ============================================================
    else if (name === 'recall_by_date') {
        if (!safeArgs.start_date || !safeArgs.end_date) {
            text = '❌ 缺少参数：需要 start_date 和 end_date';
        } else if (!isValidDate(safeArgs.start_date) || !isValidDate(safeArgs.end_date)) {
            text = '❌ 日期格式无效，请使用 YYYY-MM-DD 格式';
        } else {
            const { limit, cursor } = parsePagination(safeArgs);
            const start = new Date(safeArgs.start_date);
            const end = new Date(safeArgs.end_date);
            end.setHours(23, 59, 59, 999);
            const all = await getAllMemories(env);
            const matched = [];
            for (const item of all) {
                const created = new Date(item.created_at);
                if (created >= start && created <= end) {
                    matched.push(item);
                }
            }
            matched.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
            let startIndex = 0;
            if (cursor) {
                const idx = matched.findIndex(item => item.id === cursor);
                if (idx !== -1) startIndex = idx + 1;
            }
            const page = matched.slice(startIndex, startIndex + limit);
            const nextCursor = matched.length > startIndex + limit ? page[page.length - 1]?.id : null;
            if (page.length === 0) {
                text = matched.length === 0 ? '������ 该时间段内没有记忆' : '������ 没有更多结果了';
            } else {
                let lines = '������ ' + safeArgs.start_date + ' ~ ' + safeArgs.end_date + ' 的记忆（共 ' + matched.length + ' 条，显示 ' + page.length + ' 条）：\n';
                for (const item of page) {
                    const category = getCategory(item.key);
                    const title = getTitle(item.key);
                    lines += '- [' + category + '] ' + title + ': ' + item.value + '\n  ������ ' + formatTime(item.created_at) + '\n';
                }
                if (nextCursor) {
                    lines += '\n������ next_cursor: ' + nextCursor + '（继续翻页请传此值）';
                }
                text = lines;
            }
        }
    }
    // ============================================================
    // stats
    // ============================================================
    else if (name === 'stats') {
        const all = await getAllMemories(env);
        if (all.length === 0) {
            text = '������ 统计：\n总条数：0\n暂无记忆，先存一条吧～';
        } else {
            const total = all.length;
            const categoryMap = {};
            let weekCount = 0;
            const oneWeekAgo = new Date();
            oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
            for (const item of all) {
                const cat = item.category || '默认';
                categoryMap[cat] = (categoryMap[cat] || 0) + 1;
                if (new Date(item.created_at) >= oneWeekAgo) {
                    weekCount++;
                }
            }
            const sortedCategories = Object.entries(categoryMap).sort((a, b) => b[1] - a[1]);
            const categoryList = sortedCategories.map(([cat, count]) => cat + '(' + count + '条)').join('、');
            text = '������ 统计：\n' +
                '总条数：' + total + '\n' +
                '分类数：' + sortedCategories.length + '\n' +
                '各分类：' + categoryList + '\n' +
                '������ 最近一周新增：' + weekCount + ' 条';
        }
    }
    // ============================================================
    // suggest
    // ============================================================
    else if (name === 'suggest') {
        const prefix = safeArgs.prefix || '';
        const suggestions = await getSearchSuggestions(env, prefix);
        if (suggestions.length === 0) {
            text = prefix ? '������ 没有匹配的联想词' : '������ 暂无搜索历史，多搜几次就会有联想了～';
        } else {
            let lines = '������ 联想词：\n';
            for (const word of suggestions) {
                lines += '- ' + word + '\n';
            }
            text = lines;
        }
    }
    return text;
}