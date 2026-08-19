---
name: github-workflow
description: 当用户需要了解GitHub分支工作流、推送规则、创建PR或合并代码时调用此技能。
category: deploy
tags: ["GitHub", "分支", "PR", "推送", "工作流"]
---

# GitHub工作流技能（合并版）

## 目标
规范代码开发流程，确保Cloudflare自动部署稳定可靠。

## 适用场景
- 修改Worker代码
- 添加新工具或技能
- 修复bug
- 创建分支或PR
- 需要推送代码时
- 不确定流程时

## 工作流程（SOP）

### 第1步：了解需求
1. 听完柳柳的需求
2. 列出自己准备怎么做的计划
3. 如果其中有任何问题或不确定的地方，立刻询问柳柳
4. 等柳柳确认没问题后，再开始执行

### 第2步：改dev（铁律！）
1. **所有代码改动必须先推dev分支**
2. 在dev上改完所有文件
3. 每改完一个步骤，自己检查一遍
4. 全部改完后，再整体检查一遍
5. **绝对禁止直接推main**（除非是SKILL.md这类纯文档文件且柳柳明确同意）

### 第3步：确认无误后推main
1. 确认所有改动没有问题
2. 创建PR从dev合并到main
3. 只有合并到main才能触发Cloudflare部署
4. 验证部署：检查Cloudflare Worker是否成功更新

## 分支管理
1. 只保留main和dev两个分支
2. 不新建多余分支
3. 功能完成后立即删除临时分支
4. **dev和main必须保持一致**

## Git操作参考
- 创建分支：github:create_branch(from_branch=main, new_branch=dev)
- 推送到dev：使用github:create_or_update_file指定branch=dev
- 合并到main：通过PR合并
- 注意：GitHub API没有移动文件接口，移动=新路径PUT+旧路径DELETE
- 限流：匿名60次/小时，带token 5000次/小时

## 注意事项
- Cloudflare自动部署只监听main分支
- 直接在main修改会导致每次提交都触发部署
- 使用dev分支可以避免不必要的部署
- 合并前确保代码已通过测试
- 推一次main = 触发一次Cloudflare部署
- 中途测试和小修改走dev
- 改完每个步骤要自己检查一遍
- **改设定前必须先贴方案给柳柳确认**

## 输出格式
返回分支状态和PR链接