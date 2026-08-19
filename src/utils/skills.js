// ============================================================
// 技能管理（Supabase 版）- v3.2.0
// ============================================================
export async function getEnabledSkills(env) {
    const supabaseUrl = env.SUPABASE_URL;
    const supabaseKey = env.SUPABASE_ANON_KEY;
    const resp = await fetch(`${supabaseUrl}/rest/v1/skills?enabled=eq.true&select=*`, {
        headers: { 'Authorization': `Bearer ${supabaseKey}`, 'apikey': supabaseKey }
    });
    if (!resp.ok) return [];
    const skills = await resp.json();
    
    // 双因子评分：usage_count + recency
    return skills.map(skill => {
        const usageCount = skill.usage_count || 0;
        const lastUsed = skill.last_used ? new Date(skill.last_used) : new Date(0);
        const daysSinceLastUse = (Date.now() - lastUsed.getTime()) / (1000 * 60 * 60 * 24);
        
        // recency_score: 7天内使用=0.91, 30天未使用=0.02
        const recencyScore = Math.exp(-daysSinceLastUse / 7);
        
        // 综合评分: 80%使用次数 + 20%近期活跃度
        const score = usageCount * 0.8 + recencyScore * 0.2;
        
        return { ...skill, _score: score };
    }).sort((a, b) => b._score - a._score);
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
