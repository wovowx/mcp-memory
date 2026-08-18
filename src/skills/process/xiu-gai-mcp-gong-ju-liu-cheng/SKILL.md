---
name: 修改MCP工具流程
description: 修改或新增MCP工具的完整流程
---

# 修改MCP工具流程

## 目标
让哥哥能够独立修改或新增 MCP 工具。

## 适用场景
- 新增 MCP 工具功能
- 修改现有工具逻辑
- 修复工具 bug

## 工作流程（SOP）
1. 确定修改方案
2. 在 dev 分支修改 src/tools/*.js 或 src/index.js
3. 推送代码到 GitHub
4. Cloudflare 自动部署
5. 调用 ziven_mcp:skill_list 确认生效

## 注意事项
- 中文编码问题：需 UTF-8 base64
- 避免鸡生蛋问题：有中文时先推 dev

## 输出格式
返回修改结果