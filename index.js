// ============================================================
// Worker 入口
// ============================================================
// @ts-nocheck
import { buildErrorResponse, jsonResponse } from './utils/response.js';
import { uploadFileToSupabase } from './utils/storage.js';
import { getEnabledSkills, getSkillByName, addSkill, updateSkill, deleteSkill } from './utils/skills.js';
import { handleMemoryTool } from './tools/memory.js';
import { handleCategoryTool } from './tools/category.js';
import { handleDataTool } from './tools/data.js';
import { handleAITool } from './tools/ai.js';
import { handleGitHubTool } from './tools/github.js';

// ============================================================
// MCP 请求处理器
// ============================================================

const handlerMap = {
    'memory': handleMemoryTool,
    'category': handleCategoryTool,
    'data': handleDataTool,
    'ai': handleAITool,
    'github': handleGitHubTool,
    'skill': handleSkillManagement
};

async function handleMCPRequest(body, env) {
    const { method, params, id } = body;

    if (method === 'initialize') {
        return {
            jsonrpc: '2.0',
            id: id,
            result: {
                protocolVersion: '2025-06-18',
                capabilities: { tools: {} },
                serverInfo: { name: 'ZivenAgent', version: '3.0.0' }
            }
        };
    }

    if (method === 'tools/list') {
        const skills = await getEnabledSkills(env);
        const tools = skills.map(s => ({
            name: s.name,
            description: s.description,
            inputSchema: s.input_schema
        }));
        return {
            jsonrpc: '2.0',
            id: id,
            result: { tools }
        };
    }

    if (method === 'tools/call') {
        const { name, arguments: args } = params;
        const safeArgs = args || {};
        let text = '';

        try {
            // 先查技能表
            const skill = await getSkillByName(env, name);
            
            if (!skill) {
                // 如果是技能管理工具，特殊处理
                if (name === 'skill_add' || name === 'skill_update' || name === 'skill_delete' || name === 'skill_list') {
                    text = await handleSkillManagement(name, safeArgs, env);
                } else {
                    text = '❌ 未知工具：' + name;
                }
            } else {
                const handler = handlerMap[skill.handler_config?.handler];
                if (handler) {
                    text = await handler(name, safeArgs, env);
                } else {
                    text = '❌ 技能类型未实现：' + skill.handler_type;
                }
            }
        } catch (e) {
            text = '❌ 执行出错：' + e.message;
        }

        return {
            jsonrpc: '2.0',
            id: id,
            result: {
                content: [{ type: 'text', text: text }]
            }
        };
    }

    if (method === 'ping') {
        return { jsonrpc: '2.0', id: id, result: {} };
    }

    return {
        jsonrpc: '2.0',
        id: id || null,
        error: { code: -32601, message: 'Method not found: ' + method }
    };
}

// ============================================================
// 技能管理工具
// ============================================================

async function handleSkillManagement(name, safeArgs, env) {
    let text = '';

    if (name === 'skill_list') {
        const skills = await getEnabledSkills(env);
        if (skills.length === 0) {
            text = '������ 暂无技能';
        } else {
            let lines = '������ **技能列表**（共 ' + skills.length + ' 个）：\n\n';
            for (const s of skills) {
                const status = s.enabled ? '✅' : '⛔';
                lines += `${status} **${s.name}**\n`;
                lines += `   ������ ${s.description}\n`;
                lines += `   ������ ${s.category || '默认'}\n\n`;
            }
            text = lines;
        }
    }

    else if (name === 'skill_add') {
        if (!safeArgs.name || !safeArgs.description || !safeArgs.input_schema) {
            text = '❌ 缺少参数：需要 name, description, input_schema';
        } else {
            try {
                const inputSchema = typeof safeArgs.input_schema === 'string' 
                    ? JSON.parse(safeArgs.input_schema) 
                    : safeArgs.input_schema;
                
                await addSkill(env, {
                    name: safeArgs.name,
                    description: safeArgs.description,
                    input_schema: inputSchema,
                    handler_type: safeArgs.handler_type || 'js',
                    handler_config: safeArgs.handler_config || { handler: 'ai' },
                    category: safeArgs.category || '自定义',
                    tags: safeArgs.tags || []
                });
                text = '✅ 技能已添加：' + safeArgs.name + '\n' +
                       '������ 描述：' + safeArgs.description + '\n' +
                       '������ 分类：' + (safeArgs.category || '自定义');
            } catch (e) {
                text = '❌ 添加失败：' + e.message;
            }
        }
    }

    else if (name === 'skill_update') {
        if (!safeArgs.name) {
            text = '❌ 缺少参数：需要 name';
        } else {
            try {
                const updates = {};
                if (safeArgs.description) updates.description = safeArgs.description;
                if (safeArgs.input_schema) {
                    updates.input_schema = typeof safeArgs.input_schema === 'string' 
                        ? JSON.parse(safeArgs.input_schema) 
                        : safeArgs.input_schema;
                }
                if (safeArgs.category) updates.category = safeArgs.category;
                if (safeArgs.enabled !== undefined) updates.enabled = safeArgs.enabled;
                
                await updateSkill(env, safeArgs.name, updates);
                text = '✅ 技能已更新：' + safeArgs.name;
            } catch (e) {
                text = '❌ 更新失败：' + e.message;
            }
        }
    }

    else if (name === 'skill_delete') {
        if (!safeArgs.name) {
            text = '❌ 缺少参数：需要 name';
        } else {
            await deleteSkill(env, safeArgs.name);
            text = '������️ 已删除技能：' + safeArgs.name;
        }
    }

    return text;
}

// ============================================================
// Worker 入口
// ============================================================

export default {
    async fetch(request, env) {
        // 检查 Supabase 是否配置
        if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
            return buildErrorResponse('Supabase 未配置：请在环境变量中设置 SUPABASE_URL 和 SUPABASE_ANON_KEY', 500);
        }

        // CORS 预检
        if (request.method === 'OPTIONS') {
            return new Response(null, {
                status: 204,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type, Last-Event-ID',
                    'Access-Control-Max-Age': '86400'
                }
            });
        }

        const url = new URL(request.url);

        // ============================================================
        // 文件上传接口（/upload）
        // ============================================================
        if (url.pathname === '/upload' && request.method === 'POST') {
            try {
                const formData = await request.formData();
                const file = formData.get('file');

                if (!file) {
                    return buildErrorResponse('没有文件');
                }

                if (file.size > 50 * 1024 * 1024) {
                    return buildErrorResponse('文件太大，最大 50MB');
                }

                const blockedTypes = ['application/x-executable', 'application/x-msdownload', 'text/html', 'application/javascript'];
                if (blockedTypes.includes(file.type)) {
                    return buildErrorResponse('不支持该文件类型，为了安全请上传常规文件');
                }
                const result = await uploadFileToSupabase(file, env);
                return jsonResponse(result);

            } catch (e) {
                return buildErrorResponse(e.message, 500);
            }
        }

        // ============================================================
        // MCP 入口
        // ============================================================
        if (url.pathname === '/mcp') {
            if (request.method === 'GET') {
                const encoder = new TextEncoder();
                const stream = new ReadableStream({
                    start(controller) {
                        controller.enqueue(encoder.encode('event: message\n'));
                        controller.enqueue(encoder.encode('data: {"type":"connected"}\n\n'));
                        const keepAlive = setInterval(() => {
                            try {
                                controller.enqueue(encoder.encode(': keepalive\n\n'));
                            } catch {
                                clearInterval(keepAlive);
                            }
                        }, 30000);
                        return () => clearInterval(keepAlive);
                    }
                });
                return new Response(stream, {
                    status: 200,
                    headers: {
                        'Content-Type': 'text/event-stream',
                        'Cache-Control': 'no-cache, no-transform',
                        'Connection': 'keep-alive',
                        'Access-Control-Allow-Origin': '*'
                    }
                });
            }

            if (request.method === 'POST') {
                try {
                    const body = await request.json();
                    const result = await handleMCPRequest(body, env);
                    return jsonResponse(result);
                } catch (e) {
                    return jsonResponse({
                        jsonrpc: '2.0',
                        id: null,
                        error: { code: -32700, message: 'Parse error: ' + e.message }
                    }, 400);
                }
            }
            return new Response('Method not allowed', { status: 405 });
        }

        // ============================================================
        // 健康检查
        // ============================================================
        if (url.pathname === '/' || url.pathname === '/health') {
            const skills = await getEnabledSkills(env);
            return new Response('������ Ziven MCP Server running (' + skills.length + ' skills | Supabase OK)', {
                status: 200,
                headers: {
                    'Content-Type': 'text/plain',
                    'Access-Control-Allow-Origin': '*'
                }
            });
        }

        return new Response('Not found', { status: 404 });
    }
};