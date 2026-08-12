// ============================================================
// 搜索历史（Supabase 版）
// ============================================================
export async function recordSearchKeyword(env, keyword) {
    if (!keyword || keyword.trim().length === 0) return;
    try {
        const normalized = keyword.trim().toLowerCase();
        
        // 查询是否存在
        const resp = await fetch(`${env.SUPABASE_URL}/rest/v1/search_history?keyword=eq.${encodeURIComponent(normalized)}&select=*`, {
            headers: {
                'Authorization': `Bearer ${env.SUPABASE_ANON_KEY}`,
                'apikey': env.SUPABASE_ANON_KEY
            }
        });
        const existing = await resp.json();
        
        if (existing && existing.length > 0) {
            // 更新计数
            await fetch(`${env.SUPABASE_URL}/rest/v1/search_history?keyword=eq.${encodeURIComponent(normalized)}`, {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${env.SUPABASE_ANON_KEY}`,
                    'apikey': env.SUPABASE_ANON_KEY,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    count: existing[0].count + 1,
                    updated_at: new Date().toISOString()
                })
            });
        } else {
            // 新增
            await fetch(`${env.SUPABASE_URL}/rest/v1/search_history`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${env.SUPABASE_ANON_KEY}`,
                    'apikey': env.SUPABASE_ANON_KEY,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    keyword: normalized,
                    count: 1,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                })
            });
        }
    } catch (e) {
        // 静默失败，不影响搜索
    }
}
export async function getSearchSuggestions(env, prefix) {
    try {
        let query = `${env.SUPABASE_URL}/rest/v1/search_history?select=keyword&order=count.desc&limit=20`;
        if (prefix && prefix.trim().length > 0) {
            query += `&keyword=ilike.${encodeURIComponent(prefix.trim().toLowerCase())}%`;
        }
        const resp = await fetch(query, {
            headers: {
                'Authorization': `Bearer ${env.SUPABASE_ANON_KEY}`,
                'apikey': env.SUPABASE_ANON_KEY
            }
        });
        const data = await resp.json();
        return data.map(item => item.keyword);
    } catch {
        return [];
    }
}