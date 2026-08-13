// ============================================================
// 技能管理（Supabase 版）
// ============================================================
export async function getEnabledSkills(env) {
    const supabaseUrl = env.SUPABASE_URL;
    const supabaseKey = env.SUPABASE_ANON_KEY;
    const resp = await fetch(`${supabaseUrl}/rest/v1/skills?enabled=eq.true&select=*`, {
        headers: { 'Authorization': `Bearer ${supabaseKey}`, 'apikey': supabaseKey }
    });
    if (!resp.ok) return [];
    return await resp.json();
}
export async function getSkillByName(env, name) {
    const supabaseUrl = env.SUPABASE_URL;
    const supabaseKey = env.SUPABASE_ANON_KEY;
    const resp = await fetch(`${supabaseUrl}/rest/v1/skills?name=eq.${encodeURIComponent(name)}&select=*`, {
        headers: { 'Authorization': `Bearer ${supabaseKey}`, 'apikey': supabaseKey }
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data && data.length > 0 ? data[0] : null;
}
export async function addSkill(env, skill) {
    const supabaseUrl = env.SUPABASE_URL;
    const supabaseKey = env.SUPABASE_ANON_KEY;
    const resp = await fetch(`${supabaseUrl}/rest/v1/skills`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${supabaseKey}`, 'apikey': supabaseKey,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            name: skill.name, description: skill.description,
            input_schema: skill.input_schema, handler_type: skill.handler_type || 'js',
            handler_config: skill.handler_config || {}, category: skill.category || '默认',
            tags: skill.tags || [], enabled: true, created_by: skill.created_by || 'agent'
        })
    });
    return resp.ok;
}
export async function updateSkill(env, name, updates) {
    const supabaseUrl = env.SUPABASE_URL;
    const supabaseKey = env.SUPABASE_ANON_KEY;
    const resp = await fetch(`${supabaseUrl}/rest/v1/skills?name=eq.${encodeURIComponent(name)}`, {
        method: 'PATCH',
        headers: {
            'Authorization': `Bearer ${supabaseKey}`, 'apikey': supabaseKey,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ ...updates, updated_at: new Date().toISOString() })
    });
    return resp.ok;
}
export async function deleteSkill(env, name) {
    const supabaseUrl = env.SUPABASE_URL;
    const supabaseKey = env.SUPABASE_ANON_KEY;
    const resp = await fetch(`${supabaseUrl}/rest/v1/skills?name=eq.${encodeURIComponent(name)}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${supabaseKey}`, 'apikey': supabaseKey }
    });
    return resp.ok;
}