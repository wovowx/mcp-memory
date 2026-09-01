// ============================================================
// Worker 入口（优化版v5 - MCP 兼容版 + Chatroom v6.4）
// ============================================================
// v5 变更（2026-08-31）：MCP 兼容性改造（方案A·最小手术）
//  1. 移除 hasCalledHelp 模块级全局守卫（跨客户端状态污染）
//  2. initialize 做协议版本协商
//  3. 处理 notifications/initialized（notification 回 202 空响应）
//  4. CORS 补齐 Authorization/Accept/MCP-Session-Id
//  5. 保留无状态 POST 应答（stateless 模式），GET 兼容 SSE
// v6.3 变更（2026-09-01）：自动注册兜底（passiveSyncGithubTool）
//  业务层（memory/skills/Supabase/GitHub）一行未动
// v6.4 变更（2026-09-01）：Common Ground 聊天室（柳提出页面需求 + GPT写页面 + Ziven接入）
//  1. 新增 /chat 页面路由（读 src/public/chat.html）
//  2. 新增 /api/chat/* REST API（threads/messages/events）
//  3. 新增 tools/chat.js（含 mentions 解析 + Agent Event 生成，同 GPT agent_events.py 规则）
// @ts-nocheck
import { buildErrorResponse, jsonResponse } from './utils/response.js';
import { uploadFileToSupabase } from './utils/storage.js';
import { getEnabledSkills, getSkillByName, addSkill, updateSkill, deleteSkill } from './utils/skills.js';
import { handleMemoryTool } from './tools/memory_unified.js';
import { handleDataTool } from './tools/data.js';
import { handleAITool } from './tools/ai.js';
import { handleGitHubTool, GITHUB_TOOL_DEFS } from './tools/github.js';
import { handleDatabaseTool } from './tools/database.js';
import { handleCategoryTool } from './tools/category.js';
import handleKnowledgeSkill from './tools/knowledge.js';
import { handleIncrementUsage } from './tools/increment_usage.js';
import { handleDeleteBranch } from './tools/delete_branch.js';
import { handleChatRequest } from './tools/chat.js';

const handlerMap = {
    'memory': handleMemoryTool,
    'category': handleCategoryTool,
    'data': handleDataTool,
    'ai': handleAITool,
    'github': handleGitHubTool,
    'database': handleDatabaseTool,
    'knowledge': handleKnowledgeSkill,
    'skill': handleSkillManagement,
    'increment_usage': handleIncrementUsage,
    'delete_branch': handleDeleteBranch
};

// 支持的 MCP 协议版本（协商用）
const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2024-11-05', '2025-03-26'];
const DEFAULT_PROTOCOL_VERSION = '2025-06-18';

// KV缓存（模拟实现）
const skillCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5分钟

async function getCachedSkills(env) {
    const now = Date.now();
    const cached = skillCache.get('skills');
    if (cached && (now - cached.time) < CACHE_TTL) {
        return cached.skills;
    }
    const skills = await getEnabledSkills(env);
    skillCache.set('skills', { skills, time: now });
    return skills;
}

async function invalidateCache() {
    skillCache.clear();
}

// ============================================================
// passiveSyncGithubTool - 每次调用 github_* 工具时顺带检查注册（v6.3）
// 只补缺失（新增），不覆盖已有；发现缺失自动注册并提醒哥哥复核
// 用不变量避免每次查表：只查「被调用的这个工具」是否注册
// ============================================================
async function passiveSyncGithubTool(env, name) {
    try {
        const existing = await getSkillByName(env, name);
        if (existing) return null; // 已注册，无事
        const def = GITHUB_TOOL_DEFS.find(d => d.name === name);
        if (!def) return null; // 代码里也没有该定义，交给 handler 判断
        const ok = await addSkill(env, {
            name: def.name,
            description: def.description,
            input_schema: def.input_schema,
            handler_type: 'js',
            handler_config: { handler: def.handler || 'github' },
            category: def.category || 'GitHub',
            tags: def.tags || []
        });
        await invalidateCache();
        return ok
            ? '⚠️ 已自动注册新工具：' + name + '——哥哥有空检查一下 schema 是否正确（自动注册只补缺，不覆盖）'
            : '⚠️ 自动注册失败：' + name;
    } catch (e) {
        return '⚠️ 自动注册检查出错：' + e.message;
    }
}
