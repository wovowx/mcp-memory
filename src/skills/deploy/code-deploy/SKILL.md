---
name: code-deploy
description: 当用户需要修改代码、推送代码到GitHub或触发Cloudflare部署时调用此技能。包含MCP工具开发流程。
category: deploy
tags: ["代码", "部署", "GitHub", "MCP", "Cloudflare"]
---

# 代码部署与MCP开发技能（合并版）

## 目标
实现从本地修改代码到Cloudflare自动部署的完整闭环，支持MCP工具开发。

## 适用场景
- 修改MCP Worker代码并部署
- 更新技能文件或配置文件
- 新增MCP工具功能
- 修改现有工具逻辑
- 修复工具bug
- 调试和验证代码变更

## 工作流程（SOP）
1. 确定修改方案：明确要改什么、怎么改
2. 代码修改：
   - 在dev分支修改src/tools/*.js
   - 或修改src/index.js注册新工具
   - 注意UTF-8编码
3. 推送到GitHub：
   - 使用github:create_or_update_file推送单个文件
   - 或使用github:patch_file_in_repo做差异更新
   - 分支：先推dev，再创建PR合并到main
4. 自动部署：推送到main后Cloudflare自动触发
5. 验证生效：
   - 调用ziven_mcp:skill_list确认工具已注册
   - 或调用tools/list确认生效

## 注意事项
- 中文编码：GitHub API推送文件需要UTF-8 base64编码（含中文内容）
- btoa不支持中文，需用TextEncoder转UTF-8
- 避免鸡生蛋问题：有中文内容时避免用旧工具推送新代码，可先推dev或用ASCII绕过

## 环境变量（Cloudflare配置）
- GITHUB_TOKEN：GitHub API访问令牌
- SUPABASE_URL：Supabase数据库地址
- SUPABASE_ANON_KEY：Supabase匿名密钥
- AGNES_API_KEY：Agnes AI API密钥
- DEEPSEEK_API_KEY：DeepSeek API密钥

## 输出格式
返回修改结果：commit SHA、部署状态