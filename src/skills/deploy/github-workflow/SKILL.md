---
name: github-workflow
description: 当用户需要了解GitHub分支工作流、创建PR或合并代码时调用此技能。
---

# GitHub分支工作流技能

## 目标
规范代码开发流程，确保Cloudflare自动部署稳定可靠。

## 适用场景
- 修改Worker代码
- 添加新工具或技能
- 修复bug

## 工作流程（SOP）
1. 开发分支：所有代码改动先在dev分支进行
2. 测试验证：在dev分支测试无误后，准备合并
3. 创建PR：从dev创建Pull Request到main
4. 合并代码：通过PR合并到main（触发Cloudflare自动部署）
5. 验证部署：检查Cloudflare Worker是否成功更新

## 注意事项
- Cloudflare自动部署只监听main分支
- 直接在main修改会导致每次提交都触发部署
- 使用dev分支可以避免不必要的部署
- 合并前确保代码已通过测试

## Git操作参考
- 创建分支：github:create_branch(from_branch=main, new_branch=dev)
- 推送到dev：使用github:create_or_update_file指定branch=dev
- 合并到main：通过PR合并
- 注意：GitHub API没有移动文件接口，移动=新路径PUT+旧路径DELETE
- 限流：匿名60次/小时，带token 5000次/小时

## 输出格式
返回分支状态和PR链接