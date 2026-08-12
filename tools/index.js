// ============================================================
// 工具注册和处理器 
// ============================================================
import { handleMemoryTool } from './memory.js';
import { handleCategoryTool } from './category.js';
import { handleDataTool } from './data.js';
import { handleAITool } from './ai.js';
import { handleGitHubTool } from './github.js';
export async function handleToolsCall(name, safeArgs, env) {
    // 1. 记忆管理工具
    if (['remember', 'recall', 'update', 'rename', 'forget', 'search', 'recall_all', 'random', 'recall_by_date', 'stats', 'suggest'].includes(name)) {
        return await handleMemoryTool(name, safeArgs, env);
    }
    // 2. 分类管理工具
    if (['list_categories', 'recall_by_category', 'move_category'].includes(name)) {
        return await handleCategoryTool(name, safeArgs, env);
    }
    // 3. 数据导入/导出工具
    if (['import', 'export'].includes(name)) {
        return await handleDataTool(name, safeArgs, env);
    }
    // 4. AI 能力工具
    if (['ds_quota', 'describe_image', 'generate_image', 'generate_video', 'query_files', 'delete_file', 'update_file', 'help'].includes(name)) {
        return await handleAITool(name, safeArgs, env);
    }
    // 5. GitHub 工具
    if (['github_push', 'github_create_repo'].includes(name)) {
        return await handleGitHubTool(name, safeArgs, env);
    }
    return null;
}