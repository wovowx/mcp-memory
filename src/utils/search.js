// ============================================================
// 搜索历史（Supabase 版）
// ============================================================
export async function recordSearchKeyword(env, keyword) {
    if (typeof keyword !== 'string' || keyword.trim().length === 0) return;
    try {
        const normalized = keyword.trim().toLowerCase();
        const resp = await fetch(`${env.SUPABASE_URL}/rest/v1/search_history?keyword=eq.${encodeURIComponent(normalized)}&select=*`, {
            headers: { 'Authorization': `Bearer ${env.SUPABASE_ANON_KEY}`, 'apikey': env.SUPABASE_ANON_KEY }
        });
        // A missing table or failed lookup must not be treated as an empty history,
        // otherwise we attempt a misleading POST after the GET already failed.
        if (!resp.ok) return;
        const existing = await resp.json();
        if (!Array.isArray(existing)) return;
        if (existing.length > 0) {
            await fetch(`${env.SUPABASE_URL}/rest/v1/search_history?keyword=eq.${encodeURIComponent(normalized)}`, {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${env.SUPABASE_ANON_KEY}`, 'apikey': env.SUPABASE_ANON_KEY,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ count: existing[0].count + 1, updated_at: new Date().toISOString() })
            });
        } else {
            await fetch(`${env.SUPABASE_URL}/rest/v1/search_history`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${env.SUPABASE_ANON_KEY}`, 'apikey': env.SUPABASE_ANON_KEY,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ keyword: normalized, count: 1, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
            });
        }
    } catch (e) {}
}
export async function getSearchSuggestions(env, prefix) {
    try {
        let query = `${env.SUPABASE_URL}/rest/v1/search_history?select=keyword&order=count.desc&limit=20`;
        if (prefix && prefix.trim().length > 0) {
            query += `&keyword=ilike.${encodeURIComponent(prefix.trim().toLowerCase())}%`;
        }
        const resp = await fetch(query, {
            headers: { 'Authorization': `Bearer ${env.SUPABASE_ANON_KEY}`, 'apikey': env.SUPABASE_ANON_KEY }
        });
        if (!resp.ok) return [];
        const data = await resp.json();
        if (!Array.isArray(data)) return [];
        return data.map(item => item?.keyword).filter(keyword => typeof keyword === 'string');
    } catch { return []; }
}