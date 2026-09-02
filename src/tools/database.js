// ============================================================
// 通用 Supabase 数据库工具（统一版 v2）
// ============================================================
// 用法：supabase_db(action, table, data, filters, ...)
// action: query/insert/update/delete/tables/exec
// v2 新增：create_table / drop_table（自动建表/删表，走 exec_sql RPC）

import { buildErrorResponse, jsonResponse } from '../utils/response.js';

export async function handleDatabaseTool(name, safeArgs, env) {
    const supabaseUrl = env.SUPABASE_URL;
    const supabaseKey = env.SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseKey) return '❌ Supabase 未配置';

    const headers = {
        'Authorization': `Bearer ${supabaseKey}`,
        'apikey': supabaseKey,
        'Content-Type': 'application/json'
    };

    try {
        // 兼容旧名称：supabase_query/supabase_insert 等也映射到对应 action
        const actionMap = {
            'supabase_query': 'query',
            'supabase_insert': 'insert',
            'supabase_update': 'update',
            'supabase_delete': 'delete',
            'supabase_tables': 'tables',
            'supabase_exec': 'exec'
        };
        const action = actionMap[name] || safeArgs.action || 'query';

        // ============================================
        // query - 查询任意表
        // ============================================
        if (action === 'query') {
            if (!safeArgs.table) return '❌ 缺少参数：需要 table（表名）';
            
            let url = `${supabaseUrl}/rest/v1/${safeArgs.table}?select=${safeArgs.select || '*'}`;
            
            if (safeArgs.filters && typeof safeArgs.filters === 'object') {
                for (const [col, val] of Object.entries(safeArgs.filters)) {
                    if (Array.isArray(val)) {
                        url += `&${col}=in.(${val.map(v => `"${v}"`).join(',')})`;
                    } else if (typeof val === 'string' && val.startsWith('like.')) {
                        url += `&${col}=like.${encodeURIComponent(val.substring(5))}`;
                    } else if (typeof val === 'string' && val.startsWith('gt.')) {
                        url += `&${col}=gt.${val.substring(3)}`;
                    } else if (typeof val === 'string' && val.startsWith('lt.')) {
                        url += `&${col}=lt.${val.substring(3)}`;
                    } else {
                        url += `&${col}=eq.${encodeURIComponent(val)}`;
                    }
                }
            }
            
            if (safeArgs.order) url += `&order=${safeArgs.order}`;
            if (safeArgs.limit) url += `&limit=${safeArgs.limit}`;
            if (safeArgs.offset) url += `&offset=${safeArgs.offset}`;
            
            const resp = await fetch(url, { headers });
            if (!resp.ok) {
                const errText = await resp.text();
                return `❌ 查询失败 (${resp.status}): ${errText}`;
            }
            const data = await resp.json();
            return '✅ 查询结果：\n```json\n' + JSON.stringify(data, null, 2).substring(0, 4000) + '\n```';
        }

        // ============================================
        // insert - 插入数据
        // ============================================
        if (action === 'insert') {
            if (!safeArgs.table || !safeArgs.data) return '❌ 缺少参数：需要 table 和 data';
            const body = typeof safeArgs.data === 'string' ? JSON.parse(safeArgs.data) : safeArgs.data;
            const resp = await fetch(`${supabaseUrl}/rest/v1/${safeArgs.table}`, {
                method: 'POST',
                headers: { ...headers, 'Prefer': 'return=representation' },
                body: JSON.stringify(body)
            });
            if (!resp.ok) {
                const errText = await resp.text();
                return `❌ 插入失败 (${resp.status}): ${errText}`;
            }
            const data = await resp.json();
            return '✅ 插入成功：\n```json\n' + JSON.stringify(data, null, 2).substring(0, 2000) + '\n```';
        }

        // ============================================
        // update - 更新数据
        // ============================================
        if (action === 'update') {
            if (!safeArgs.table || !safeArgs.data || !safeArgs.filters) return '❌ 缺少参数：需要 table, data, filters';
            const body = typeof safeArgs.data === 'string' ? JSON.parse(safeArgs.data) : safeArgs.data;
            let url = `${supabaseUrl}/rest/v1/${safeArgs.table}?`;
            for (const [col, val] of Object.entries(safeArgs.filters)) {
                url += `${col}=eq.${encodeURIComponent(val)}&`;
            }
            const resp = await fetch(url, {
                method: 'PATCH',
                headers: { ...headers, 'Prefer': 'return=representation' },
                body: JSON.stringify(body)
            });
            if (!resp.ok) {
                const errText = await resp.text();
                return `❌ 更新失败 (${resp.status}): ${errText}`;
            }
            const data = await resp.json();
            return '✅ 更新成功：\n```json\n' + JSON.stringify(data, null, 2).substring(0, 2000) + '\n```';
        }

        // ============================================
        // delete - 删除数据
        // ============================================
        if (action === 'delete') {
            if (!safeArgs.table || !safeArgs.filters) return '❌ 缺少参数：需要 table 和 filters';
            let url = `${supabaseUrl}/rest/v1/${safeArgs.table}?`;
            for (const [col, val] of Object.entries(safeArgs.filters)) {
                url += `${col}=eq.${encodeURIComponent(val)}&`;
            }
            const resp = await fetch(url, {
                method: 'DELETE',
                headers
            });
            if (!resp.ok) {
                const errText = await resp.text();
                return `❌ 删除失败 (${resp.status}): ${errText}`;
            }
            return '✅ 删除成功';
        }

        // ============================================
        // tables - 列出所有表
        // ============================================
        if (action === 'tables') {
            const resp = await fetch(`${supabaseUrl}/rest/v1/`, { headers });
            if (!resp.ok) {
                const errText = await resp.text();
                return `❌ 查询表失败 (${resp.status}): ${errText}`;
            }
            const data = await resp.json();
            const tables = (data.definitions && Object.keys(data.definitions)) || [];
            return '📋 数据库表列表（' + tables.length + ' 个）：\n' + tables.map(t => '- ' + t).join('\n');
        }

        // ============================================
        // exec - 执行 SQL（需要 exec_sql RPC，v2 支持空响应）
        // ============================================
        if (action === 'exec') {
            if (!safeArgs.sql) return '❌ 缺少参数：需要 sql';
            const resp = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ sql: safeArgs.sql })
            });
            if (!resp.ok) {
                const errText = await resp.text();
                return `❌ SQL执行失败 (${resp.status}): ${errText}`;
            }
            // exec_sql 返回 void（204 空体）时不再 JSON.parse，直接返回成功
            const raw = await resp.text();
            if (!raw) return '✅ SQL执行成功（无返回体，DDL 已完成）';
            try {
                const data = JSON.parse(raw);
                return '✅ SQL执行结果：\n```json\n' + JSON.stringify(data, null, 2).substring(0, 4000) + '\n```';
            } catch {
                return '✅ SQL执行成功：\n' + raw;
            }
        }

        // ============================================
        // create_table - 创建表（v2 新增，走 exec_sql RPC）
        // 用法：{ action:'create_table', table:'my_table', columns:'id uuid primary key, name text not null', rls:false }
        // ============================================
        if (action === 'create_table' || action === 'createTable' || name === 'supabase_schema_create') {
            if (!safeArgs.table) return '❌ 缺少参数：需要 table（表名）';
            if (!safeArgs.columns) return '❌ 缺少参数：需要 columns（逗号分隔的列定义）';
            let sql = `CREATE TABLE IF NOT EXISTS public.${safeArgs.table} (${safeArgs.columns})`;
            if (safeArgs.rls !== false) {
                sql += `;\nALTER TABLE public.${safeArgs.table} ENABLE ROW LEVEL SECURITY`;
            }
            const resp = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ sql })
            });
            if (!resp.ok) {
                const errText = await resp.text();
                return `❌ 建表失败 (${resp.status}): ${errText}`;
            }
            const raw = await resp.text();
            return raw ? `✅ 建表成功：${safeArgs.table}（${raw}）` : `✅ 建表成功：${safeArgs.table}`;
        }

        // ============================================
        // drop_table - 删除表（v2 新增，走 exec_sql RPC）
        // 用法：{ action:'drop_table', table:'my_table' }
        // ============================================
        if (action === 'drop_table' || action === 'dropTable') {
            if (!safeArgs.table) return '❌ 缺少参数：需要 table（表名）';
            const sql = `DROP TABLE IF EXISTS public.${safeArgs.table} CASCADE`;
            const resp = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ sql })
            });
            if (!resp.ok) {
                const errText = await resp.text();
                return `❌ 删表失败 (${resp.status}): ${errText}`;
            }
            const raw = await resp.text();
            return raw ? `✅ 删表成功：${safeArgs.table}（${raw}）` : `✅ 删表成功：${safeArgs.table}`;
        }

        return '❌ 未知操作：' + action + '（支持 query/insert/update/delete/tables/exec/create_table/drop_table）';
    } catch (e) {
        return '❌ 执行出错：' + e.message;
    }
}