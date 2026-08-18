// ============================================================
// 技能使用次数自增工具
// ============================================================
import { getEnabledSkills, getSkillByName } from '../utils/skills.js';

export async function handleIncrementUsage(name, safeArgs, env) {
    const skillName = safeArgs.name;
    
    if (!skillName) {
        return '❌ 缺少参数：需要 name';
    }
    
    // 先查询当前记录
    const skill = await getSkillByName(env, skillName);
    if (!skill) {
        return '❌ 技能不存在：' + skillName;
    }
    
    // 使用 Supabase RPC 或直接 PATCH 更新
    const supabaseUrl = env.SUPABASE_URL;
    const supabaseKey = env.SUPABASE_ANON_KEY;
    
    // 方法：使用 PATCH 配合 select 返回更新后的值
    const resp = await fetch(`${supabaseUrl}/rest/v1/skills?name=eq.${encodeURIComponent(skillName)}`, {
        method: 'PATCH',
        headers: {
            'Authorization': `Bearer ${supabaseKey}`,
            'apikey': supabaseKey,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
        },
        body: JSON.stringify({
            usage_count: (skill.usage_count || 0) + 1,
            last_used: new Date().toISOString()
        })
    });
    
    if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`更新失败: ${errText}`);
    }
    
    return `✅ 已更新 ${skillName} 的使用次数：${skill.usage_count || 0} → ${(skill.usage_count || 0) + 1}`;
}
