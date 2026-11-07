// ============================================================
// mcp_router.js — Worker MCP Server 核心实现层（协议 + tool dispatch）
// 从 index.js 抽出（v6.11.2）：避免 mcp_client 与 index 循环依赖，单真相源
// 职责：只做 MCP 协议 + tool dispatch；不做 permission/approval/capability/audit
// ============================================================
import { getEnabledSkills, getSkillByName, addSkill, updateSkill, deleteSkill } from '../utils/skills.js';
import { handleMemoryTool } from '../tools/memory_unified.js';
import { handleDataTool } from '../tools/data.js';
import { handleAITool } from '../tools/ai.js';
import { handleGitHubTool, GITHUB_TOOL_DEFS } from '../tools/github_v64.js';
import { getContent } from './github/contents.js';
import { validateRepoRelativePath, withMemoryTypeSchema } from '../utils/helpers.js';
import { handleDatabaseTool } from '../tools/database.js';
import { handleCategoryTool } from '../tools/category.js';
import handleKnowledgeSkill from '../tools/knowledge.js';
import { handleIncrementUsage } from '../tools/increment_usage.js';
import { handleDeleteBranch } from '../tools/delete_branch.js';
import { handleChatTool, CHAT_TOOL_DEFS } from '../tools/chat_mcp.js';
import { handleCfProxyTool, handleCloudflareLogsQuery, CLOUDFLARE_LOGS_QUERY_TOOL } from '../tools/cf_proxy.js';
import { validateRelease } from './release_guard.js';
import { SESSION_BOOTSTRAP_TOOL, handleSessionBootstrap, SESSION_CONTEXT_TOOL, handleSessionContext } from './session/bootstrap.js';

// Read-only text Skill adapter: reuse the GitHub Contents primitive and return
// the full instructions as data. Never execute Markdown or write usage telemetry.
const TEXT_SKILL_PATH = /^src\/skills\/(?:[\p{L}\p{N}_-]+\/)+SKILL\.md$/u;
const TEXT_SKILL_NAME = /^[\p{L}\p{N}][\p{L}\p{N}_-]{0,79}$/u;
const MAX_TEXT_SKILL_BYTES = 64 * 1024;

function textSkillFailure(code) { return 'TEXT_SKILL_LOAD_FAILED: [' + code + ']'; }

async function loadTextSkill(skill, env) {
    const explicit = skill?.file_path ?? skill?.handler_config?.file_path;
    const path = explicit !== undefined && explicit !== null
        ? explicit
        : (typeof skill?.name === 'string' && TEXT_SKILL_NAME.test(skill.name)
            ? 'src/skills/' + skill.name + '/SKILL.md' : null);
    if (typeof path !== 'string' || !TEXT_SKILL_PATH.test(path) || !validateRepoRelativePath(path).ok) {
        return textSkillFailure('INVALID_SKILL_PATH');
    }
    if (!env.GITHUB_REPO || !env.GITHUB_TOKEN) return textSkillFailure('GITHUB_CONFIG_MISSING');
    const repo = env.GITHUB_REPO;
    const read = await getContent({
        repo, env, fetchImpl: fetch, validateRepoRelativePath,
        headers: {
            Authorization: 'Bearer ' + env.GITHUB_TOKEN,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': 'Cloudflare-Worker-MCP/1.0'
        }
    }, { repo, path, branch: 'main' });
    if (!read.ok) return textSkillFailure(read.code || 'SOURCE_UNAVAILABLE');
    const data = read.data;
    if (data?.type !== 'file' || data.path !== path || data.encoding !== 'base64' ||
        typeof data.content !== 'string' || !data.content.length) {
        return textSkillFailure('INVALID_SOURCE_CONTENT');
    }
    if (Number.isFinite(data.size) && data.size > MAX_TEXT_SKILL_BYTES) {
        return textSkillFailure('CONTENT_TOO_LARGE');
    }
    let content;
    try {
        const encoded = data.content.replace(/\s+/g, '');
        if (!encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
            return textSkillFailure('INVALID_BASE64');
        }
        const binary = atob(encoded);
        if (binary.length > MAX_TEXT_SKILL_BYTES) return textSkillFailure('CONTENT_TOO_LARGE');
        content = new TextDecoder('utf-8', { fatal: true }).decode(
            Uint8Array.from(binary, char => char.charCodeAt(0))
        );
    } catch { return textSkillFailure('CONTENT_DECODE_FAILED'); }
    if (!content.trim()) return textSkillFailure('EMPTY_SKILL');
    return 'TEXT_SKILL_LOADED: ' + skill.name + '\nSource: ' + repo + '@main/' + path + '\n\n' + content;
}

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
    'delete_branch': handleDeleteBranch,
    'chat': handleChatTool,
    'cf_proxy': handleCfProxyTool
};

// ============================================================
// dispatch_tool 网关（P0 · 2026-10-18 Ziven×GPT 讨论 + 业内踩肩）
// 职责：执行前硬门禁——调用信封校验 + 工具注册校验
// 现状（本文件第4行）：只做 dispatch，不做 permission/audit → 这里补第一道缝。
// 原则（GPT 确认）：让非法调用无法执行，不靠 Agent 自觉。
// 最小切片只做两件事（可扩展，后续加 schema/角色权限/副作用策略）：
//   1. 调用信封校验：name 必须为非空字符串
//   2. 工具注册校验：name 必须在已知工具集合内（handlerMap + 动态前缀 + create_patch_proposal），未知拒
// 校验不通过 → 执行前返回结构化错误，绝不进入 handler。
// ============================================================
const KNOWN_HANDLERS = new Set(Object.keys(handlerMap));

function isKnownToolName(name) {
    if (!name || typeof name !== 'string') return false;
    if (KNOWN_HANDLERS.has(name)) return true;                    // handlerMap 直连工具
    if (name === 'create_patch_proposal') return true;            // 专门 handler
    if (name === SESSION_BOOTSTRAP_TOOL.name) return true;       // P2 static read-only scenario
    if (name === SESSION_CONTEXT_TOOL.name) return true;         // resume-work read-only scenario
    if (name === CLOUDFLARE_LOGS_QUERY_TOOL.name) return true;   // fixed, read-only CF query
    // 动态注册的前缀族（其余走 skills 表懒注册）
    if (name.startsWith('github_')) return true;                  // handleGitHubTool
    if (name.startsWith('supabase_')) return null;                // handleDatabaseTool
    if (name.startsWith('memory_')) return true;                  // handleMemoryTool
    if (name.startsWith('database_')) return true;                // handleDatabaseTool
    if (name.startsWith('category_')) return true;                // handleCategoryTool
    if (name.startsWith('skill_')) return true;                   // handleSkillManagement
    return null;                                                  // null=前缀未匹配，需查注册表
}
// v6.35.7 (2026-10-18)：修复——前缀未匹配的工具（如 cloudflare_deploy_status/deploy/chat2api 等
// 走 skills 表动态注册的合法 ziven_mcp 工具）会被误判为 UNKNOWN_TOOL。改为查 getCachedSkills 注册表兜底，
// 与现有懒注册逻辑一致；只有连注册表都没有才真拒绝。验证难度前置，防误伤。
async function isKnownTool(env, name) {
    const prefix = isKnownToolName(name);
    if (prefix === true) return true;
    if (prefix === false) return false;
    try {
        const skills = await getCachedSkills(env);
        return Array.isArray(skills) && skills.some(s => s && s.name === name);
    } catch (e) {
        throw new Error('Skill registry unavailable: ' + e.message);
    }
}
// v6.35.8 (2026-10-18)：从工具注册表取 input_schema（含 required）。
// 对齐"踩肩+不重复造"：直接复用 skills 表/GITHUB_TOOL_DEFS 已有的参数契约，不自己定义。
// 返回 null=查不到 schema（这种情况走信封校验放行，不误伤无 schema 的工具）。
const CREATE_PATCH_PROPOSAL_SCHEMA = {
    type: 'object',
    required: ['target_file', 'change_summary', 'reason'],
    properties: {
        target_file: { type: 'string' },
        change_summary: { type: 'string' },
        reason: { type: 'string' },
        evidence: { type: ['string', 'array'] },
        diff: { type: ['string', 'object'] },
        risk: { type: 'string' },
        old_sha: { type: 'string' }
    }
};

function getToolSchemaOverride(name) {
    if (name === 'github_create_file') return GITHUB_TOOL_DEFS.find(def => def.name === name)?.input_schema || null;
    if (name === SESSION_BOOTSTRAP_TOOL.name) return SESSION_BOOTSTRAP_TOOL.input_schema;
    if (name === SESSION_CONTEXT_TOOL.name) return SESSION_CONTEXT_TOOL.input_schema;
    if (name === CLOUDFLARE_LOGS_QUERY_TOOL.name) return CLOUDFLARE_LOGS_QUERY_TOOL.input_schema;
    return name === 'create_patch_proposal' ? CREATE_PATCH_PROPOSAL_SCHEMA : null;
}

async function getToolSchema(env, name) {
    // P2 static bootstrap uses its own fixed schema; avoid registry probing in recovery.
    const schemaOverride = getToolSchemaOverride(name);
    if (name === SESSION_BOOTSTRAP_TOOL.name || name === SESSION_CONTEXT_TOOL.name || name === CLOUDFLARE_LOGS_QUERY_TOOL.name || name === 'github_create_file') return schemaOverride;
    // 其他工具保留旧注册表及 schema 行为。
    const skills = await getCachedSkills(env);
    const skill = Array.isArray(skills) ? skills.find(s => s && s.name === name) : null;
    if (schemaOverride) return schemaOverride;
    const schema = skill?.input_schema && typeof skill.input_schema === 'object' ? skill.input_schema : null;
    if (name === 'memory') return withMemoryTypeSchema(schema || {});
    return schema;
}
// v6.35.7：dispatchGuard 改 async + 接收 env，前缀未匹配查注册表兜底
// 有边界的 JSON Schema 子集：type / enum / required / properties / items / minimum / maximum。
// 不声称完整实现 JSON Schema；遇到未支持关键字时不据此拒绝调用。
function matchesSchemaType(value, type) {
    if (Array.isArray(type)) return type.some(t => matchesSchemaType(value, t));
    switch (type) {
        case 'object': return value !== null && typeof value === 'object' && !Array.isArray(value);
        case 'array': return Array.isArray(value);
        case 'string': return typeof value === 'string';
        case 'number': return typeof value === 'number' && Number.isFinite(value);
        case 'integer': return typeof value === 'number' && Number.isInteger(value);
        case 'boolean': return typeof value === 'boolean';
        case 'null': return value === null;
        default: return true; // 未支持/未声明的 type 不擅自拒绝，避免误伤旧 schema
    }
}

function schemaValueEquals(a, b) {
    if (a === b) return true;
    if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const aKeys = Object.keys(a), bKeys = Object.keys(b);
    return aKeys.length === bKeys.length && aKeys.every(k => Object.prototype.hasOwnProperty.call(b, k) && schemaValueEquals(a[k], b[k]));
}

export function validateSchemaSubset(schema, value, path = 'arguments') {
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return null;
    if (schema.type !== undefined && !matchesSchemaType(value, schema.type)) {
        return path + ' 类型错误，期望 ' + (Array.isArray(schema.type) ? schema.type.join(' | ') : schema.type);
    }
    if (Array.isArray(schema.enum) && !schema.enum.some(option => schemaValueEquals(value, option))) {
        return path + ' 不在允许的枚举值中';
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        if (typeof schema.minimum === 'number' && value < schema.minimum) return path + ' 小于最小值 ' + schema.minimum;
        if (typeof schema.maximum === 'number' && value > schema.maximum) return path + ' 大于最大值 ' + schema.maximum;
    }
    if (Array.isArray(value) && schema.items && typeof schema.items === 'object') {
        for (let i = 0; i < value.length; i++) {
            const issue = validateSchemaSubset(schema.items, value[i], path + '[' + i + ']');
            if (issue) return issue;
        }
    }
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        if (Array.isArray(schema.required)) {
            const missing = schema.required.filter(key => {
                const v = value[key];
                return v === undefined || v === null || v === '';
            });
            if (missing.length) return path + ' 缺少必需参数: ' + missing.join(', ');
        }
        if (schema.properties && typeof schema.properties === 'object') {
            for (const [key, childSchema] of Object.entries(schema.properties)) {
                if (Object.prototype.hasOwnProperty.call(value, key)) {
                    const issue = validateSchemaSubset(childSchema, value[key], path + '.' + key);
                    if (issue) return issue;
                }
            }
        }
    }
    return null;
}

async function dispatchGuard(env, name, args) {
    // 1. 调用信封校验
    if (!name || typeof name !== 'string') {
        return { allowed: false, code: 'INVALID_TOOL_NAME', reason: 'tool 调用缺少有效 name（可能 tool_name 丢失/污染）', expected: 'name 必须是非空字符串' };
    }
    // 2. 工具注册校验（前缀 + 注册表兜底）
    if (!(await isKnownTool(env, name))) {
        return { allowed: false, code: 'UNKNOWN_TOOL', reason: '未知工具: ' + name, expected: 'name 必须在已注册工具集合内' };
    }
    // 参数信封校验：arguments 必须为对象（可选增强，先最小）
    if (args !== undefined && args !== null && typeof args !== 'object') {
        return { allowed: false, code: 'INVALID_ARGS', reason: 'arguments 必须是对象', expected: 'arguments 为 JSON 对象' };
    }
    // 3. 参数 schema 校验：只执行明确支持的 JSON Schema 子集；schema 缺失时维持兼容放行。
    const schema = await getToolSchema(env, name);
    if (schema) {
        const issue = validateSchemaSubset(schema, args ?? {}, 'arguments');
        if (issue) {
            const isRequired = issue.includes('缺少必需参数:');
            return {
                allowed: false,
                code: isRequired ? 'MISSING_REQUIRED_PARAM' : 'INVALID_ARGS_SCHEMA',
                reason: issue,
                expected: '参数需符合已声明的 schema 子集（required/type/enum/items/minimum/maximum）'
            };
        }
    }
    return { allowed: true };
}

const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2024-11-05', '2025-03-26'];
const DEFAULT_PROTOCOL_VERSION = '2025-06-18';
const skillCache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

async function getCachedSkills(env) {
    const now = Date.now();
    const cached = skillCache.get('skills');
    if (cached && (now - cached.time) < CACHE_TTL) return cached.skills;
    const skills = await getEnabledSkills(env);
    skillCache.set('skills', { skills, time: now });
    return skills;
}

async function invalidateCache() { skillCache.clear(); }

function getExposedInputSchema(skill) {
    const schema = skill?.input_schema && typeof skill.input_schema === 'object' ? skill.input_schema : {};
    const schemaOverride = getToolSchemaOverride(skill?.name);
    if (schemaOverride) return schemaOverride;
    if (skill?.name !== 'supabase_db' && skill?.name !== 'supabase_schema') {
        return skill?.name === 'memory' ? withMemoryTypeSchema(schema) : schema;
    }
    // necessity is enforced by database.js for DDL hidden behind action=exec; expose it to clients without requiring it for read-only actions.
    return {
        ...schema,
        properties: {
            ...(schema.properties && typeof schema.properties === 'object' ? schema.properties : {}),
            necessity: {
                type: 'string',
                description: 'DDL/结构变更时必填：说明为什么现有表或结构不能满足需求；只读 SQL 无需填写。'
            }
        }
    };
}

// release_guard 前置闸：push/merge 到 main 必须版本化；非 main 分支放行
// v6.32.3 (2026-09-08)：FIX rebase 标题失守——rebase 模式 GitHub 保留 dev 原始 commit 标题，
//   只校验 merge 参数 commit_title 没意义（merge 时的 title 不会落到 main 上）。
//   改为：rebase 模式校验源分支 HEAD commit 标题（rebase 后真实出现在 main 上的标题）；
//   merge/squash 模式才校验 commit_title 参数（会真实落到 main）。
async function getPullRequestHeadBranch(env, pullNumber, repo = env.GITHUB_REPO) {
    try {
        const token = env.GITHUB_TOKEN;
        if (!token || !repo || !pullNumber) return '';
        const resp = await fetch(`https://api.github.com/repos/${repo}/pulls/${pullNumber}`, {
            headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json', 'User-Agent': 'ziven-bridge' }
        });
        if (!resp.ok) return '';
        const data = await resp.json();
        return (data.head && data.head.ref) || '';
    } catch (e) { return ''; }
}

async function getBranchHeadCommitTitle(env, branch, repo = env.GITHUB_REPO) {
    try {
        const token = env.GITHUB_TOKEN;
        if (!token || !repo || !branch) return '';
        const resp = await fetch(`https://api.github.com/repos/${repo}/commits/${encodeURIComponent(branch)}`, {
            headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json', 'User-Agent': 'ziven-bridge' }
        });
        if (!resp.ok) return '';
        const data = await resp.json();
        return (data.commit?.message || '').split('\n')[0] || '';
    } catch (e) { return ''; }
}

export async function githubReleaseGuard(name, safeArgs, env) {
    if (name !== 'github_push' && name !== 'github_create_file' && name !== 'github_merge_to_main' && name !== 'github_merge_pull_request' && name !== 'github_edit') {
        return { allowed: true };
    }
    // 多仓库调用按实际目标仓库选择发布策略；未指定目标仓库时兼容默认 GITHUB_REPO。
    const targetRepo = safeArgs.repo || env.GITHUB_REPO;
    // v6.32.5: github_edit 按 push 处理（写操作）——写 dev 放行，写 main 拦（版本化）
    const isPush = name === 'github_push' || name === 'github_create_file' || name === 'github_edit';
    const branch = isPush ? (safeArgs.branch || 'dev') : 'main';
    const action = isPush ? 'push' : 'merge';

    // rebase（默认）模式：merge 标题由源分支 HEAD commit 决定，校验真实标题
    if (!isPush) {
        const mergeMethod = (safeArgs.merge_method || 'rebase');
        if (mergeMethod === 'rebase') {
            let srcBranch = '';
            if (name === 'github_merge_to_main') srcBranch = safeArgs.branch || 'dev';
            else if (name === 'github_merge_pull_request') {
                // v6.34.1 FIX：PR rebase merge 也会真实落库 PR head 分支的原始 commit 标题，必须查真实标题校验
                const prHead = await getPullRequestHeadBranch(env, safeArgs.pull_number, targetRepo);
                if (prHead) {
                    const realTitle = await getBranchHeadCommitTitle(env, prHead, targetRepo);
                    if (realTitle) {
                        return validateRelease({ repo: targetRepo, branch, commitTitle: realTitle, action });
                    }
                }
                // 查不到 PR head / 标题——保守拒绝，不静默放行
                return validateRelease({ repo: targetRepo, branch, commitTitle: safeArgs.commit_title || safeArgs.title || undefined, action });
            }
            const headTitle = await getBranchHeadCommitTitle(env, srcBranch, targetRepo);
            if (headTitle) {
                return validateRelease({ repo: targetRepo, branch, commitTitle: headTitle, action });
            }
            // 查不到 dev HEAD 标题（网络/权限）——fallback 到参数校验，不静默放行
            return validateRelease({ repo: targetRepo, branch, commitTitle: safeArgs.commit_title || safeArgs.title || undefined, action });
        }
    }

    const commitTitle = isPush ? (safeArgs.message || '') : (safeArgs.commit_title || safeArgs.title || undefined);
    return validateRelease({ repo: targetRepo, branch, commitTitle, action });
}

function githubMainWriteGuard(name, args = {}) {
    const isMain = value => String(value || '').toLowerCase() === 'main';
    let protectedBranches = [];
    if (name === 'github_delete') {
        protectedBranches = [args.branch || 'dev'];
    } else if (name === 'github_create_file') {
        protectedBranches = [args.branch || 'dev'];
    } else if (name === 'github_copy') {
        protectedBranches = [args.target_branch || 'dev'];
    } else if (name === 'github_move') {
        const sourceBranch = args.source_branch || 'dev';
        const targetBranch = args.target_branch || 'dev';
        protectedBranches = [sourceBranch, targetBranch];
    } else if (name === 'github_sync_branch') {
        protectedBranches = [args.name || args.branch || 'dev'];
    }
    const blocked = protectedBranches.filter(isMain);
    if (blocked.length) {
        return { allowed: false, reason: '直接写入 main 被禁止；请写入 dev 并按版本化发布流程合并。阻止分支：' + [...new Set(blocked)].join(', ') };
    }
    return { allowed: true };
}

async function passiveSyncGithubTool(env, name) {
    try {
        const existing = await getSkillByName(env, name);
        if (existing) return null;
        const def = GITHUB_TOOL_DEFS.find(d => d.name === name);
        if (!def) return null;
        const ok = await addSkill(env, {
            name: def.name, description: def.description, input_schema: def.input_schema,
            handler_type: 'js', handler_config: { handler: def.handler || 'github' },
            category: def.category || 'GitHub', tags: def.tags || []
        });
        await invalidateCache();
        return ok ? 'auto registered: ' + name : 'auto register fail: ' + name;
    } catch (e) { return 'auto register err: ' + e.message; }
}

async function syncChatTools(env) {
    let changed = false;
    for (const def of CHAT_TOOL_DEFS) {
        const existing = await getSkillByName(env, def.name);
        if (existing) continue;
        const ok = await addSkill(env, {
            name: def.name, description: def.description, input_schema: def.input_schema,
            handler_type: 'js', handler_config: { handler: 'chat' },
            category: 'Common Ground', tags: ['chat', 'common-ground']
        });
        if (ok) changed = true;
    }
    if (changed) await invalidateCache();
}

async function autoIncrementUsage(env, name) {
    // v6.38.0 自动使用打点：工具执行成功后分发层自动+1（②自动技能沉淀数据源修复，不再靠 AI 自觉调 increment_usage）
    if (!name || name === 'increment_usage' || name === SESSION_BOOTSTRAP_TOOL.name || name === SESSION_CONTEXT_TOOL.name || name === CLOUDFLARE_LOGS_QUERY_TOOL.name || ['skill_list', 'skill_add', 'skill_update', 'skill_delete'].includes(name)) return;
    try { await handleIncrementUsage(name, { name }, env); } catch (e) { /* 静默，不污染回复 */ }
}

// Facades do not yet share a structured Result type. Until they do, only
// recognized successful text responses may contribute to skill usage. In
// particular GitHub, Patch and Cloudflare use "ERROR:" instead of "❌".
// Patch can also report an unknown post-write state as PARTIAL. Such a result
// is recovery evidence, not proof of a completed skill use.
// Keeping this check at the common dispatch exit prevents one failure from
// being counted as evidence that the selected tool worked.
export function isSuccessfulToolResult(value) {
    if (typeof value !== 'string') return false;
    const response = value.trimStart();
    const failures = [
        'err:', 'error:', 'error/unknown:', '❌',
        'partial success:', 'partial/unknown:', 'partial:',
        'release_guard:', 'dispatch_guard_reject:', 'main_write_blocked:',
        'unknown tool:', 'handler type not implemented', 'text_skill_load_failed:'
    ];
    const lower = response.toLowerCase();
    return response.length > 0 && !failures.some(prefix => lower.startsWith(prefix));
}

export async function handleMCPRequest(body, env) {
    const { method, params, id } = body || {};
    if (!method) return { ok: false, data: { jsonrpc: '2.0', id: id ?? null, error: { code: -32600, message: 'Invalid Request' } } };
    const isNotification = id === undefined || id === null;
    if (method === 'notifications/initialized' || method.startsWith('notifications/')) return { ok: true, data: null, notification: true };
    if (method === 'initialize') {
        const clientVersion = params?.protocolVersion;
        const negotiated = SUPPORTED_PROTOCOL_VERSIONS.includes(clientVersion) ? clientVersion : DEFAULT_PROTOCOL_VERSION;
        return { ok: true, data: { jsonrpc: '2.0', id, result: { protocolVersion: negotiated, capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'ZivenAgent', version: '6.5.0' } } } };
    }
    if (method === 'tools/list') {
        // Discovery must be side-effect-free: never register paused chat tools
        // (or write any registry rows) merely because a host refreshes its list.
        const skills = await getCachedSkills(env);
        const tools = skills.map(s => ({
            name: s.name,
            description: s.name === SESSION_CONTEXT_TOOL.name
                ? SESSION_CONTEXT_TOOL.description
                : s.name === 'memory'
                ? [s.description, 'history：提供按完整 key 的显式只读历史查询；旧版本和事件账本不会被恢复为当前有效记忆。',
                    'health_check：记忆体检场景；默认 demo 合成预览，sample 仅在柳柳本次明确授权后元数据只读。']
                    .filter(Boolean).join('\n')
                : s.description,
            inputSchema: getExposedInputSchema(s)
        }));
        // New scene is discoverable without a skills-table write. Existing
        // registered tool metadata is still authoritative when present.
        const createFile = GITHUB_TOOL_DEFS.find(def => def.name === 'github_create_file');
        if (createFile && !tools.some(tool => tool.name === createFile.name)) {
            tools.push({ name: createFile.name, description: createFile.description, inputSchema: createFile.input_schema });
        }
        // Recovery workflows remain discoverable without registry writes.
        if (!tools.some(tool => tool.name === SESSION_BOOTSTRAP_TOOL.name)) {
            tools.push({ name: SESSION_BOOTSTRAP_TOOL.name, description: SESSION_BOOTSTRAP_TOOL.description, inputSchema: SESSION_BOOTSTRAP_TOOL.input_schema });
        }
        if (!tools.some(tool => tool.name === SESSION_CONTEXT_TOOL.name)) {
            tools.push({ name: SESSION_CONTEXT_TOOL.name, description: SESSION_CONTEXT_TOOL.description, inputSchema: SESSION_CONTEXT_TOOL.input_schema });
        }
        // Explicit read-only scene, NOT the existing unrestricted cf_proxy.
        // tools/list remains discovery-only; never writes to skills registry.
        if (!tools.some(tool => tool.name === CLOUDFLARE_LOGS_QUERY_TOOL.name)) {
            tools.push({ name: CLOUDFLARE_LOGS_QUERY_TOOL.name, description: CLOUDFLARE_LOGS_QUERY_TOOL.description,
                inputSchema: CLOUDFLARE_LOGS_QUERY_TOOL.input_schema, annotations: CLOUDFLARE_LOGS_QUERY_TOOL.annotations });
        }
        return { ok: true, data: { jsonrpc: '2.0', id, result: { tools } } };
    }
    if (method === 'tools/call') {
        const { name, arguments: args } = params || {};
        const safeArgs = args || {};
        // dispatch_tool 网关：执行前硬门禁（P0 · 2026-10-18，v6.35.7 async+注册表兜底）
        let guard;
        try {
            guard = await dispatchGuard(env, name, safeArgs);
        } catch (e) {
            // 注册表/Schema 查询失败是基础设施故障，不得误报 UNKNOWN_TOOL，也不得进入 handler。
            return { ok: true, data: { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: 'DISPATCH_GUARD_REJECT: [TOOL_REGISTRY_UNAVAILABLE] ' + e.message + ' Expected: 注册表查询成功后再执行工具' }] } } };
        }
        if (!guard.allowed) {
            return { ok: true, data: { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: 'DISPATCH_GUARD_REJECT: [' + guard.code + '] ' + guard.reason + ' Expected: ' + guard.expected }] } } };
        }
        let text = '';
        let readOnlyTextSkill = false;
        try {
            // 专用 handler 保留，但统一在下方 toolOk 中核对结果和使用统计。
            if (name === 'create_patch_proposal') {
                text = await handleCreatePatchProposal(safeArgs, env);
            } else if (name === SESSION_BOOTSTRAP_TOOL.name) {
                text = await handleSessionBootstrap(name, safeArgs, env);
            } else if (name === SESSION_CONTEXT_TOOL.name) {
                text = await handleSessionContext(name, safeArgs, env);
            } else if (name === CLOUDFLARE_LOGS_QUERY_TOOL.name) {
                text = await handleCloudflareLogsQuery(safeArgs, env);
            } else if (name?.startsWith('supabase_')) {
                text = await handleDatabaseTool(name, safeArgs, env);
                await invalidateCache();
            } else if (name === 'memory' || name?.startsWith('memory_')) {
                text = await handleMemoryTool(name, safeArgs, env);
            } else if (name?.startsWith('github_')) {
                const mainGuard = githubMainWriteGuard(name, safeArgs);
                if (!mainGuard.allowed) {
                    text = 'MAIN_WRITE_BLOCKED: ' + mainGuard.reason;
                } else {
                    const syncNote = name === 'github_create_file' ? null : await passiveSyncGithubTool(env, name);
                    const guard = await githubReleaseGuard(name, safeArgs, env);
                    if (!guard.allowed) {
                        text = 'RELEASE_GUARD: ' + guard.reason + ' Expected: ' + guard.expected;
                    } else {
                        text = await handleGitHubTool(name, safeArgs, env);
                    }
                    if (syncNote) text += '\n\n' + syncNote;
                }
            } else if (name === 'cf_proxy') {
                // v6.34.0：CF API 代理——用 env.CLOUDFLARE_API_TOKEN 代调 Cloudflare API（只执行不暴露）
                text = await handleCfProxyTool(safeArgs, env);
            } else if (CHAT_TOOL_DEFS.some(d => d.name === name)) {
                await syncChatTools(env);
                text = await handleChatTool(name, safeArgs, env);
            } else {
                const skill = await getSkillByName(env, name);
                if (!skill) {
                    if (name === 'skill_add' || name === 'skill_update' || name === 'skill_delete' || name === 'skill_list') {
                        text = await handleSkillManagement(name, safeArgs, env);
                        await invalidateCache();
                    } else if (name === 'increment_usage') {
                        text = await handleIncrementUsage(name, safeArgs, env);
                    } else if (name === 'create_patch_proposal') {
                        text = await handleCreatePatchProposal(safeArgs, env);
                    } else text = 'unknown tool: ' + name;
                } else {
                    if (skill.handler_type === 'text') {
                        readOnlyTextSkill = true;
                        text = await loadTextSkill(skill, env);
                    } else {
                        const handler = handlerMap[skill.handler_config?.handler];
                        if (handler) text = await handler(name, safeArgs, env);
                        else text = 'handler type not implemented: ' + skill.handler_type;
                    }
                }
            }
        } catch (e) { text = 'err: ' + e.message; }
        const toolOk = isSuccessfulToolResult(text);
        // The metadata-only health report must be a genuinely read-only scene,
        // including usage accounting. Do not create a side-effect on success.
        if (toolOk && !readOnlyTextSkill && !(name === 'memory' && safeArgs.action === 'health_check')) {
            await autoIncrementUsage(env, name);
        }
        return { ok: true, data: { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }] } } };
    }
    if (method === 'ping') return { ok: true, data: { jsonrpc: '2.0', id, result: {} } };
    return { ok: true, data: { jsonrpc: '2.0', id: id ?? null, error: { code: -32601, message: 'Method not found: ' + method } } };
}

async function handleSkillManagement(name, safeArgs, env) {
    let text = '';
    if (name === 'skill_list') {
        const skills = await getEnabledSkills(env);
        if (skills.length === 0) text = 'no skills';
        else { let lines = 'skills (' + skills.length + '):' + '\n\n'; for (const s of skills) { const status = s.enabled ? 'ok' : 'off'; lines += '- ' + s.name + ' (' + status + '): ' + (s.description || '') + '\n'; } text = lines; }
    } else if (name === 'skill_add') {
        if (!safeArgs.name) text = 'err: missing name';
        else { try { const ok = await addSkill(env, { name: safeArgs.name, description: safeArgs.description || '', input_schema: safeArgs.input_schema || {}, handler_type: safeArgs.handler_type || 'js', handler_config: safeArgs.handler_config || {} }); text = ok ? 'added: ' + safeArgs.name : 'err: skill_add write failed: ' + safeArgs.name; } catch (e) { text = 'err: skill_add write failed: ' + safeArgs.name; } }
    } else if (name === 'skill_update') {
        if (!safeArgs.name) text = 'err: missing name';
        else { try { const updates = {}; if (safeArgs.description) updates.description = safeArgs.description; if (safeArgs.input_schema) updates.input_schema = safeArgs.input_schema; if (safeArgs.handler_config) updates.handler_config = safeArgs.handler_config; const ok = await updateSkill(env, safeArgs.name, updates); text = ok ? 'updated: ' + safeArgs.name : 'err: skill_update write failed: ' + safeArgs.name; } catch (e) { text = 'err: skill_update write failed: ' + safeArgs.name; } }
    } else if (name === 'skill_delete') {
        if (!safeArgs.name) text = 'err: missing name';
        else { try { const ok = await deleteSkill(env, safeArgs.name); text = ok ? 'deleted: ' + safeArgs.name : 'err: skill_delete write failed: ' + safeArgs.name; } catch (e) { text = 'err: skill_delete write failed: ' + safeArgs.name; } }
    }
    return text;
}


// ============================================================
// create_patch_proposal - GPT App 通道：读代码后把修改意图写入 patch_proposals
// 2026-09-05 Ziven x GPT #765/#766 —— P2.1.2 Patch Proposal Capability
// ============================================================
async function handleCreatePatchProposal(args, env) {
    const supabaseUrl = env.SUPABASE_URL;
    const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseKey) return '❌ Supabase 未配置';
    const required = ['target_file', 'change_summary', 'reason'];
    for (const f of required) { if (!args[f]) return '❌ 缺少参数: ' + f; }
    const headers = { 'Authorization': 'Bearer ' + supabaseKey, 'apikey': supabaseKey, 'Content-Type': 'application/json' };
    const evidence = Array.isArray(args.evidence) ? args.evidence : (args.evidence ? [args.evidence] : []);
    const diff = (typeof args.diff === 'string') ? args.diff : JSON.stringify(args.diff || {});
    const body = { target: args.target_file, change: args.change_summary, reason: args.reason, diff: diff, evidence: evidence, risk: args.risk || 'low', status: 'proposed', created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    if (args.old_sha) body.rollback_sha = args.old_sha;
    try {
        const resp = await fetch(supabaseUrl + '/rest/v1/patch_proposals', { method: 'POST', headers: { ...headers, 'Prefer': 'return=representation' }, body: JSON.stringify(body) });
        if (!resp.ok) { const errText = await resp.text(); return '❌ 写入失败 (' + resp.status + '): ' + errText; }
        const data = await resp.json();
        const id = Array.isArray(data) ? (data[0] && data[0].id) : (data && data.id);
        return '✅ Patch Proposal 已创建 (id=' + (id || '?') + '\n目标: ' + args.target_file + '\n改动: ' + args.change_summary + '\n状态: proposed（等 Ziven review + 柳柳确认）';
    } catch (e) { return '❌ 创建失败: ' + e.message; }
}
