// ============================================================
// 通用 Supabase 数据库工具
// ============================================================
// 支持任意表的增删改查，哥哥自由调用

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
        // ============================================
        // supabase_query - 查询任意表
        // ============================================
        if (name === 'supabase_query') {
            if (!safeArgs.table) return '❌ 缺少参数：需要 table（表名）';
            
            let url = `${supabaseUrl}/rest/v1/${safeArgs.table}?select=${safeArgs.select || '*'}`;
            
            // 支持过滤条件：filters 为 JSON 对象 { column: value }
            if (safeArgs.filters && typeof safeArgs.filters === 'object') {
                for (const [col, val] of Object.entries(safeArgs.filters)) {
                    if (Array.isArray(val)) {
                        // 数组 = in 查询
                        url += `&${col}=in.(${val.map(v => `"${v}"`).join(',')})`;
                    } else if (typeof val === 'string' && val.startsWith('like.')) {
                        // like 模糊查询：like.%关键词%
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
            
            // 排序、分页
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
        // supabase_insert - 插入数据
        // ============================================
        if (name === 'supabase_insert') {
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
        // supabase_update - 更新数据
        // ============================================
        if (name === 'supabase_update') {
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
        // supabase_delete - 删除数据
        // ============================================
        if (name === 'supabase_delete') {
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
        // supabase_exec - 直接执行 SQL（需要service_role权限）
        // ============================================
        if (name === 'supabase_exec') {
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

        // ============================================
        // supabase_tables - 列出所有表
        // ============================================
        if (name === 'supabase_tables') {
            const resp = await fetch(`${supabaseUrl}/rest/v1/`, {
                headers
            });
            if (!resp.ok) {
                const errText = await resp.text();
                return `❌ 查询表失败 (${resp.status}): ${errText}`;
            }
            const data = await resp.json();
            const tables = (data.definitions && Object.keys(data.definitions)) || [];
            return '📋 数据库表列表（' + tables.length + ' 个）：\n' + tables.map(t => '- ' + t).join('\n');
        }

        return '❌ 未知工具：' + name;
    } catch (e) {
        return '❌ 执行出错：' + e.message;
    }
}