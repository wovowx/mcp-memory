// ============================================================
// AI 工具 facade：help、DeepSeek 额度、文件工具与 Agnes 兼容分派
// Agnes provider/action 实现位于 src/modules/ai/agnes.js。
// 文件操作复用 src/utils/storage.js。
// ============================================================
import { getEnabledSkills } from '../utils/skills.js';
import { handleAgnesTool } from '../modules/ai/agnes.js';
import { queryFiles, updateFileMetadata, deleteFileFromSupabase } from '../utils/storage.js';

// ---------- 工具入口 ----------
export async function handleAITool(name, safeArgs, env) {
  // ---- help：能力总览（场景 skill 置顶 + 完整工具兜底）----
  if (name === 'help') {
    const toolName = safeArgs.tool_name;
    const skills = await getEnabledSkills(env);
    const toolHelp = {};
    for (const s of skills) toolHelp[s.name] = s.description;

    if (toolName && toolHelp[toolName]) {
      const extraHelp = {
        'agnes': '\n用法：agnes(action, prompt, image_url, size, mode, ...)\n- action: describe_image/generate_image/generate_video/describe_video\n- 例：agnes(action="describe_image", image_url="...")，verbose=true 返回诊断',
        '记忆管理': '\n用法：按场景速查表——柳柳流露话要存→当场存；查记忆→query_memory。详见 SKILL.md',
        'image_upload': '\n用法：柳柳发图/生图/生视频→走本skill，内部用 agnes。详见 SKILL.md',
        'github_create_pull_request': '\n用法：github_create_pull_request(head="dev", base="main", title, body)',
        'github_merge_pull_request': '\n用法：github_merge_pull_request(pull_number, merge_method="merge")',
        'github_merge_to_main': '\n用法：github_merge_to_main(branch="dev", title, body)——自动建PR→查可合并→合并（适配分支保护）'
      };
      const skill = skills.find(x => x.name === toolName);
      const p = skill?.file_path ? `\n📄 ${skill.file_path}` : '';
      return `💡 **${toolName}**\n${toolHelp[toolName]}${extraHelp[toolName] || ''}${p}`;
    } else if (toolName) {
      return `❌ 未找到工具 "${toolName}"\n\n可用工具：${Object.keys(toolHelp).join('、')}`;
    }

    // 场景 skill 置顶列表
    const sceneSkills = ['image_upload', '记忆管理', '设定修改确认流程', '换框流程', 'file-management', 'deploy', 'github-use-guide', 'workflow', 'voice_bubble', '表情包', 'avatar_hotswap', 'wechat_bridge', '读懂柳柳', 'dev-protection', 'master-router', 'architecture'];
    let lines = '🎬 **遇到场景先查这里**（场景 → skill）：\n';
    for (const s of skills) {
      if (sceneSkills.includes(s.name)) {
        const p = s.file_path ? ` 📄 \`${s.file_path}\`` : '';
        lines += `- \`${s.name}\`: ${(s.description || '').substring(0, 80)}${p}\n`;
      }
    }

    lines += '\n⚡ **完整工具列表**（兜底，含所有能力）：\n';
    const shown = new Set(sceneSkills);
    let count = 0;
    for (const s of skills) {
      if (shown.has(s.name)) continue;
      count++;
      const desc = (s.description || '').substring(0, 50);
      const p = s.file_path ? ` 📄 \`${s.file_path}\`` : '';
      lines += `- \`${s.name}\`: ${desc}${desc.length >= 50 ? '...' : ''}${p}\n`;
    }
    lines += `\n📊 共 ${skills.length} 个技能（场景skill ${sceneSkills.filter(x => skills.some(s => s.name === x)).length} 个 + 工具 ${count} 个）`;
    lines += '\n💡 查看某个工具的详细用法：help(工具名)';
    return lines;
  }

  // ---- DeepSeek 官方余额（保持原样，不并入 agnes）----
  if (name === 'ds_quota') {
    const apiKey = env.DEEPSEEK_API_KEY;
    if (!apiKey) { return '❌ DeepSeek API Key 未配置，请在环境变量中设置 DEEPSEEK_API_KEY'; }
    try {
      const balanceResp = await fetch('https://api.deepseek.com/user/balance', {
        method: 'GET', headers: { 'Accept': 'application/json', 'Authorization': 'Bearer ' + apiKey }
      });
      if (balanceResp.ok) {
        const balanceData = await balanceResp.json();
        if (balanceData.balance_infos && balanceData.balance_infos.length > 0) {
          const info = balanceData.balance_infos[0];
          return '💡 **DeepSeek 账户余额**\n\n💰 总余额：' + info.total_balance + ' ' + info.currency + '\n🎁 赠送余额：' + info.granted_balance + ' ' + info.currency + '\n💳 充值余额：' + info.topped_up_balance + ' ' + info.currency;
        }
        return '💡 余额信息：' + JSON.stringify(balanceData);
      }
      return '⚠️ 余额查询失败：HTTP ' + balanceResp.status;
    } catch (e) { return '❌ 查询失败：' + e.message; }
  }

  // ---- 文件查询工具：复用 storage.js 的唯一查询实现 ----
  if (name === 'query_files') {
    if (safeArgs.category !== undefined && typeof safeArgs.category !== 'string') return '❌ query_files 参数错误：category 必须是字符串';
    if (safeArgs.content_type !== undefined && !['image', 'video', 'audio', 'document', 'archive', 'text', 'other'].includes(safeArgs.content_type)) return '❌ query_files 参数错误：content_type 必须是 image/video/audio/document/archive/text/other 之一';
    if (safeArgs.keyword !== undefined && typeof safeArgs.keyword !== 'string') return '❌ query_files 参数错误：keyword 必须是字符串';
    if (safeArgs.tags !== undefined && (!Array.isArray(safeArgs.tags) || !safeArgs.tags.every(tag => typeof tag === 'string'))) return '❌ query_files 参数错误：tags 必须是字符串数组';
    if (safeArgs.limit !== undefined && (!Number.isInteger(safeArgs.limit) || safeArgs.limit < 1 || safeArgs.limit > 100)) return '❌ query_files 参数错误：limit 必须是 1–100 的整数';
    if (safeArgs.offset !== undefined && (!Number.isInteger(safeArgs.offset) || safeArgs.offset < 0)) return '❌ query_files 参数错误：offset 必须是非负整数';
    try {
      const files = await queryFiles(env, {
        category: safeArgs.category, content_type: safeArgs.content_type, tags: safeArgs.tags,
        keyword: safeArgs.keyword, limit: safeArgs.limit ?? 20, offset: safeArgs.offset ?? 0,
      });
      if (!Array.isArray(files)) throw new Error('文件查询返回了非列表结果');
      if (files.length === 0) return '📂 没有找到符合条件的文件。';
      return `📂 找到 ${files.length} 个文件：\n` + JSON.stringify(files, null, 2);
    } catch (e) {
      return '❌ query_files 查询失败：' + (e?.message || String(e));
    }
  }

  // ---- 文件元数据更新：存储细节委托 storage.js，参数与文案由 facade 保留 ----
  if (name === 'update_file') {
    if (typeof safeArgs.file_id !== 'string' || !safeArgs.file_id.trim()) return '❌ update_file 参数错误：file_id 必须是非空字符串';
    const patch = {};
    if (safeArgs.category !== undefined) {
      if (typeof safeArgs.category !== 'string') return '❌ update_file 参数错误：category 必须是字符串';
      patch.category = safeArgs.category;
    }
    if (safeArgs.description !== undefined) {
      if (typeof safeArgs.description !== 'string') return '❌ update_file 参数错误：description 必须是字符串';
      patch.description = safeArgs.description;
    }
    if (safeArgs.tags !== undefined) {
      if (!Array.isArray(safeArgs.tags) || !safeArgs.tags.every(tag => typeof tag === 'string')) return '❌ update_file 参数错误：tags 必须是字符串数组';
      patch.tags = safeArgs.tags;
    }
    if (Object.keys(patch).length === 0) return '❌ update_file 参数错误：至少提供 category、tags、description 其中一个字段';
    try {
      const result = await updateFileMetadata(env, safeArgs.file_id.trim(), patch);
      if (!result.ok) {
        if (result.code === 'not_configured') return '❌ update_file 更新失败：Supabase 未配置';
        if (result.code === 'not_found') return '❌ update_file 更新失败：未找到该 file_id 对应的文件';
        if (result.code === 'http_error') return `❌ update_file 更新失败：HTTP ${result.status} ${result.detail || ''}`;
        return '❌ update_file 更新失败：未知存储错误';
      }
      const row = result.row;
      return `✅ 文件元数据更新成功：${row.file_name || row.id || safeArgs.file_id}\n` + JSON.stringify(row, null, 2);
    } catch (e) {
      return '❌ update_file 更新失败：' + (e?.message || String(e));
    }
  }

  // ---- 文件删除：存储操作委托 storage.js，部分失败文案由 facade 保留 ----
  if (name === 'delete_file') {
    if (typeof safeArgs.file_id !== 'string' || !safeArgs.file_id.trim()) return '❌ delete_file 参数错误：file_id 必须是非空字符串';
    try {
      const result = await deleteFileFromSupabase(env, safeArgs.file_id.trim());
      if (!result.ok) {
        if (result.code === 'not_configured') return '❌ delete_file 删除失败：Supabase 未配置';
        if (result.code === 'lookup_http') return `❌ delete_file 删除失败：查询文件元数据 HTTP ${result.status} ${result.detail || ''}`;
        if (result.code === 'not_found') return '❌ delete_file 删除失败：未找到该 file_id 对应的文件';
        if (result.code === 'missing_path') return '❌ delete_file 删除失败：文件记录缺少有效 file_path，未执行删除';
        if (result.code === 'storage_http') return `❌ delete_file 删除失败：Storage 对象未确认删除（HTTP ${result.status}），数据库元数据保留。 ${result.detail || ''}`;
        if (result.code === 'metadata_http') return `❌ delete_file 部分失败：Storage 对象已删除，但数据库元数据删除失败（HTTP ${result.status}），需要人工核对。 ${result.detail || ''}`;
        if (result.code === 'metadata_unconfirmed') {
          const reason = result.error ? '（响应解析失败），需要人工核对。 ' + result.error : '，无法确认目标记录已删除，需要人工核对。';
          return '❌ delete_file 部分失败：Storage 对象已删除，但数据库未返回被删除的元数据行' + reason;
        }
        return '❌ delete_file 删除失败：未知存储错误';
      }
      const file = result.file;
      return `✅ 文件删除成功：${file.file_name || file.id || safeArgs.file_id}（已确认 Storage 对象与数据库元数据均删除）`;
    } catch (e) {
      return '❌ delete_file 删除失败：' + (e?.message || String(e));
    }
  }

  return handleAgnesTool(name, safeArgs, env);
}