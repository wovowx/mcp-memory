---
name: code-deploy
description: 改代码→推代码→自动部署全链路完整步骤
---

# 代码部署全流程技能

## 目标
实现从本地修改代码到 Cloudflare 自动部署的完整闭环。

## 适用场景
- 修改 MCP Worker 代码并部署
- 更新技能文件或配置文件
- 调试和验证代码变更

## 工作流程（SOP）
1. **拉取代码**：使用 httpGet 拉取 `raw.githubusercontent.com/wovowx/mcp-memory/main/index.js`
2. **修改代码**：根据需求修改对应文件，注意 UTF-8 编码
3. **推送到 GitHub**：
   - 使用 `github:create_or_update_file` 推送单个文件
   - 或使用 `github:patch_file_in_repo` 做差异更新
   - 推送分支：先推 dev，再创建 PR 合并到 main
4. **自动部署**：推送到 main 后 Cloudflare 自动触发部署
5. **验证生效**：调用 `ziven_mcp:skill_list` 或 `tools/list` 确认生效

## 关键注意事项
1. **中文编码**：GitHub API 推送文件需要 UTF-8 base64 编码（含中文内容）
2. **避免循环**：btoa 不支持中文，需用 TextEncoder 转 UTF-8
3. **鸡生蛋问题**：有中文内容时避免用旧工具推送新代码，可先推 dev 或用 ASCII 绕过
4. **环境变量**：wrangler.toml 里 [vars] 配 SUPABASE_URL，secret 配 SUPABASE_ANON_KEY 等

## 代码修改参考
a. 拉取 raw.githubusercontent.com/wovowx/mcp-memory/main/index.js
b. 修改 replace 目标片段
c. 推送 PUT /repos/wovowx/mcp-memory/contents/{path}，body 含 message/content(base64)/sha/branch
d. 验证：调用 ziven_mcp:skill_list 或 tools/list 确认生效

## 环境变量（Cloudflare 配置）
- GITHUB_TOKEN：GitHub API 访问令牌
- SUPABASE_URL：Supabase 数据库地址
- SUPABASE_ANON_KEY：Supabase 匿名密钥
- AGNES_API_KEY：Agnes AI API 密钥
- DEEPSEEK_API_KEY：DeepSeek API 密钥

## 输出格式
返回部署结果：
- 成功：显示 commit SHA、部署时间
- 失败：显示错误信息和修复建议