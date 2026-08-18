---
name: github-workflow
description: GitHub分支工作流约定，用于Cloudflare自动部署
---

# GitHub 分支工作流技能

## 目标
规范代码开发流程，确保Cloudflare自动部署稳定可靠。

## 适用场景
- 修改Worker代码
- 添加新工具或技能
- 修复bug

## 工作流程（SOP）
1. **开发分支**：所有代码改动先在 `dev` 分支进行
2. **测试验证**：在 dev 分支测试无误后，准备合并
3. **创建PR**：从 dev 创建 Pull Request 到 main
4. **合并代码**：通过 PR 合并到 main（触发自动部署）
5. **验证部署**：检查 Cloudflare Worker 是否成功更新

## 关键注意事项
- Cloudflare 自动部署只监听 `main` 分支
- 直接在 main 修改会导致每次提交都触发部署
- 使用 dev 分支可以避免不必要的部署
- 合并前确保代码已通过测试

## Git 操作参考
- 创建分支：`github:create_branch(from_branch=main, new_branch=dev)`
- 推送到 dev：使用 `github:create_or_update_file` 指定 branch=dev
- 合并到 main：通过 PR 合并
- 注意：GitHub API没有移动文件接口，移动=新路径PUT+旧路径DELETE
- 限流：匿名60次/小时，带token 5000次/小时

## 输出格式
返回分支状态和PR链接：
- 成功：显示commit SHA、PR URL
- 失败：显示错误信息和排查建议