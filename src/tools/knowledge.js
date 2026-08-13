// ============================================================
// 知识型技能处理器
// ============================================================
// 当调用 handler_config.handler 为 knowledge 的技能时，返回技能完整描述
// 这样技能文件内容存在Supabase数据库里，调用即返回完整步骤

import { getSkillByName } from '../utils/skills.js';

async function handleKnowledgeSkill(name, safeArgs, env) {
    const skill = await getSkillByName(env, name);
    if (!skill) return '❌ 未找到技能：' + name;
    return '📘 ' + skill.name + '\n\n' + (skill.description || '（无详细内容）');
}

export default handleKnowledgeSkill;