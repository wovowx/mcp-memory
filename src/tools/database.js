// ============================================================
// 通用 Supabase 数据库工具（统一版）
// ============================================================
// 用法：supabase_db(action, table, data, filters, ...)
// action: query/insert/update/delete/tables/exec

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
        // exec - 执行 SQL（需要 service_role 权限）
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
            const data = await resp.json();
            return '✅ SQL执行结果：\n```json\n' + JSON.stringify(data, null, 2).substring(0, 4000) + '\n```';
        }

        return '❌ 未知操作：' + action + '（支持 query/insert/update/delete/tables/exec）';
    } catch (e) {
        return '❌ 执行出错：' + e.message;
    }
}