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
3. **推送到 GitHub**：使用 `github:create_or_update_file` 推送单个文件
4. **自动部署**：推送到 main 后 Cloudflare 自动触发部署
5. **验证生效**：调用 `ziven_mcp:skill_list` 确认生效

## 注意事项
- 中文编码：GitHub API 推送需要 UTF-8 base64 编码
- btoa 不支持中文，需用 TextEncoder 转 UTF-8
- 避免鸡生蛋问题：有中文内容时先推 dev 绕过

## 输出格式
返回部署结果