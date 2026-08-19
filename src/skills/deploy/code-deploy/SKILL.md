---
name: code-deploy
description: 当用户需要推送代码到GitHub时调用此技能。Cloudflare部署配置见cloudflare-deploy。
category: deploy
tags: ["代码", "部署", "GitHub"]
---

# GitHub推送技能

## 目标
将代码变更推送到GitHub，触发Cloudflare自动部署。

## 工作流程
1. 推送到GitHub：
   - 使用github:create_or_update_file推送单个文件
   - 或使用github:patch_file_in_repo做差异更新
   - 分支：先推dev，再创建PR合并到main
2. 验证生效：调用ziven_mcp:skill_list或tools/list确认

## 注意事项
- 中文编码：GitHub API推送文件需要UTF-8 base64编码
- 避免鸡生蛋问题：有中文内容时先推dev或用ASCII绕过