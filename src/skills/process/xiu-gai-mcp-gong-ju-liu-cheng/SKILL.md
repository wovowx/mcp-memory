---
name: 修改MCP工具流程
description: 当用户需要修改或新增MCP工具、了解工具开发流程时调用此技能。
---

# 修改MCP工具流程

## 目标
让哥哥能够独立修改或新增MCP工具，不依赖柳柳手动操作。

## 适用场景
- 新增MCP工具功能
- 修改现有工具逻辑
- 修复工具bug

## 工作流程（SOP）
1. 确定修改方案：明确要改什么、怎么改
2. 代码修改：
   - 在dev分支修改src/tools/*.js
   - 或修改src/index.js注册新工具
3. 推送到GitHub：
   - 使用github:create_or_update_file推送单个文件
   - 或使用github:patch_file_in_repo做差异更新
   - 分支：先推dev，再创建PR合并到main
4. Cloudflare自动部署：推送到main后自动触发
5. 验证生效：
   - 调用ziven_mcp:skill_list确认工具已注册
   - 或调用tools/list确认生效

## 注意事项
- 中文编码：GitHub API推送文件需要UTF-8 base64编码（含中文内容）
- 避免循环：btoa不支持中文，需用TextEncoder转UTF-8
- 鸡生蛋问题：有中文内容时避免用旧工具推送新代码，可先推dev或用ASCII绕过

## 输出格式
返回修改结果：commit SHA、部署状态