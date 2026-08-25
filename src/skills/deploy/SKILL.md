---
name: deploy
description: 当用户需要修改代码、推送GitHub、创建PR、Cloudflare部署或开发MCP工具时调用此技能。
category: deploy
tags: ["部署", "GitHub", "Cloudflare", "MCP", "分支", "PR"]
---

# 部署技能（合并版）

## 目标
实现从代码修改到Cloudflare自动部署的完整闭环，包含分支管理、GitHub推送和MCP工具开发。

## 🔴 第一条铁律：绝不手动改 main
- **main 只接受 PR 合并**，绝不 create_or_update_file 直接覆盖 main 的文件
- 一旦先手动改了 main，dev/main 分叉 → 后面 PR 必冲突 → 就碎了（2026-08-25 教训）
- 一切改动先落 dev；main 永远是「从 dev 合过来的结果」

## 🔴 推 main 标准流程（每次照此执行，一次成功）
1. 所有改动全部在 dev 分支完成（改文件+提交，绝不碰 main）
2. 检查：help() 看技能清单没问题；CHANGELOG 更新；版本号确认
3. 创建 PR：github:create_pull_request(base=main, head=dev, title=带版本号)
4. 若 PR 有冲突 → 不要硬合！回 dev 对齐（把 dev 文件改成和 main 一致），再重新建 PR
5. 合并：github:merge_pull_request(merge_method=merge)
   - ✅ 一次 merge = 一次 Cloudflare 部署
   - ❌ 禁止手动往 main 推单个文件（那会变成多次部署 + 分叉）
6. 推完验证：main 上关键文件 get_file_content 确认

## 适用场景
- 修改MCP Worker代码并部署
- 更新技能文件或配置文件
- 新增/修改MCP工具
- 创建分支或PR
- 需要推送代码时
- 解决Cloudflare部署问题

## 分支规则（硬性）
- **默认：dev分支**
- 读skill：github:get_file_content 加 ref=dev
- 推送：先推dev，测试通过后合并到main
- 等柳柳确认后才能推main

## 推main铁律（记忆强化）
- 推一次main = 触发一次Cloudflare自动部署
- 所有改动必须一次全推（一次PR merge），不能分开推
- 柳柳确认后，把dev上所有改动一次性合并到main
- 禁止中途多次推送

## 工作流程（SOP）

### 第1步：了解需求
1. 听完柳柳的需求
2. 列出自己准备怎么做的计划
3. 如果有任何问题或不确定，立刻询问柳柳
4. 等柳柳确认后开始执行

### 第2步：改dev（铁律！）
1. 所有代码改动必须先推dev分支
2. 在dev上改完所有文件（src/tools/*.js 或 src/index.js）
3. 每改完一个步骤，自己检查一遍
4. 绝对禁止直接推main（除非是SKILL.md纯文档且柳柳同意）

### 第3步：推送到GitHub
- 使用github:create_or_update_file推送单个文件
- 或使用github:patch_file_in_repo做差异更新
- 分支：先推dev，再创建PR合并到main
- **main 绝不用 create_or_update_file 直接更新**

### 第4步：Cloudflare自动部署
- 推送到main后自动触发
- 只监听main分支
- 验证：用github:get_file_content加ref=dev读dev分支验证

## 分支管理
1. 只保留main和dev两个分支
2. 不新建多余分支
3. 功能完成后立即删除临时分支
4. dev和main必须保持一致

## Git操作参考
- 创建分支：github:create_branch(from_branch=main, new_branch=dev)
- 推送到dev：指定branch=dev
- 合并到main：通过PR
- GitHub API没有移动文件接口，移动=新路径PUT+旧路径DELETE
- 限流：匿名60次/小时，带token 5000次/小时

## github:get_file_content 用法
- 读main分支：传 owner/repo/path
- 读其他分支：加 ref 参数，如 ref="dev"
- 示例：github:get_file_content(owner=wovowx, repo=mcp-memory, path=src/skills/..., ref=dev)

## 最近使用记录（用完更新）
- 2026-08-25：新增「第一条铁律：绝不手动改main」，推main标准流程一次成功版（教训：手动改main→PR冲突→碎推）
- 2026-08-21：柳柳提醒推main要一次全推；今天推了好多次main被妹妹说了

## 输出格式
返回分支状态、PR链接和部署结果