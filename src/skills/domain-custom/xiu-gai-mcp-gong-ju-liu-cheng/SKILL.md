---
name: 修改MCP工具流程
description: 哥哥自己可以修改/新增MCP工具的完整流程
---

# 修改MCP工具流程

## 目标
让哥哥能够独立修改或新增 MCP 工具，不依赖柳柳手动操作。

## 适用场景
- 新增 MCP 工具功能
- 修改现有工具逻辑
- 修复工具 bug

## 工作流程（SOP）
1. **确定修改方案**：明确要改什么、怎么改
2. **代码修改**：
   - 在 dev 分支修改 `src/tools/*.js`
   - 或修改 `src/index.js` 注册新工具
3. **推送到 GitHub**：
   - 使用 `github:create_or_update_file` 推送单个文件
   - 或使用 `github:patch_file_in_repo` 做差异更新
   - 分支：先推 dev，再创建 PR 合并到 main
4. **Cloudflare 自动部署**：推送到 main 后自动触发
5. **验证生效**：
   - 调用 `ziven_mcp:skill_list` 确认工具已注册
   - 或调用 `tools/list` 确认生效

## 关键注意事项
- **中文编码**：GitHub API 推送文件需要 UTF-8 base64 编码（含中文内容）
- **避免循环**：btoa 不支持中文，需用 TextEncoder 转 UTF-8
- **鸡生蛋问题**：有中文内容时避免用旧工具推送新代码，可先推 dev 或用 ASCII 绕过
- **环境变量**：wrangler.toml 里 [vars] 配 SUPABASE_URL，secret 配 SUPABASE_ANON_KEY 等

## 代码修改参考
a. 拉取 `raw.githubusercontent.com/wovowx/mcp-memory/main/index.js`
b. 修改 replace 目标片段
c. 推送 `PUT /repos/wovowx/mcp-memory/contents/{path}`，body 含 message/content(base64)/sha/branch
d. 验证：调用 `ziven_mcp:skill_list` 或 `tools/list` 确认生效

## 环境变量（Cloudflare 配置）
- GITHUB_TOKEN：GitHub API 访问令牌
- SUPABASE_URL：Supabase 数据库地址
- SUPABASE_ANON_KEY：Supabase 匿名密钥
- AGNES_API_KEY：Agnes AI API 密钥
- DEEPSEEK_API_KEY：DeepSeek API 密钥

## 输出格式
返回修改结果：
- 成功：显示 commit SHA、部署状态
- 失败：显示错误信息和修复建议