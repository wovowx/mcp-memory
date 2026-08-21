---
name: deploy
description: 当用户需要修改代码、推送GitHub、创建PR、Cloudflare部署或开发MCP工具时调用此技能。
category: deploy
tags: ["部署", "GitHub", "Cloudflare", "MCP", "分支", "PR"]
---

# 部署技能（合并版）

## 目标
实现从代码修改到Cloudflare自动部署的完整闭环，包含分支管理、GitHub推送和MCP工具开发。

## 适用场景
- 修改MCP Worker代码并部署
- 更新技能文件或配置文件
- 新增/修改MCP工具
- 创建分支或PR
- 需要推送代码时
- 解决Cloudflare部署问题

## 🔴 分支规则（硬性）
- **默认：dev分支**
- 读skill：github:get_file_content 加 ref=dev
- 推送：先推dev，测试通过后合并到main
- 等柳柳确认后才能推main

## 工作流程（SOP）

### 第1步：了解需求
1. 听完柳柳的需求
2. 列出自己准备怎么做的计划
3. 如果有任何问题或不确定，立刻询问柳柳
4. 等柳柳确认后开始执行

### 第2步：改dev（铁律！）
1. **所有代码改动必须先推dev分支**
2. 在dev上改完所有文件（src/tools/*.js 或 src/index.js）
3. 每改完一个步骤，自己检查一遍
4. **绝对禁止直接推main**（除非是SKILL.md纯文档且柳柳同意）

### 第3步：推送到GitHub
- 使用github:create_or_update_file推送单个文件，指定branch=dev
- 或使用github:patch_file_in_repo做差异更新，指定branch=dev
- 分支：先推dev，再创建PR合并到main

### 第4步：Cloudflare自动部署
- 推送到main后自动触发
- 只监听main分支
- 验证：用github:get_file_content加ref=dev读dev分支验证

## 分支管理
1. 只保留main和dev两个分支
2. 不新建多余分支
3. 功能完成后立即删除临时分支
4. **dev和main必须保持一致**

## Git操作参考
- 创建分支：github:create_branch(from_branch=main, new_branch=dev)
- 推送到dev：使用github:create_or_update_file指定branch=dev
- 合并到main：通过PR
- GitHub API没有移动文件接口，移动=新路径PUT+旧路径DELETE
- 限流：匿名60次/小时，带token 5000次/小时

## github:get_file_content 用法
- 读main分支：传 owner/repo/path
- 读其他分支：加 ref 参数，如 ref="dev"
- 示例：github:get_file_content(owner=wovowx, repo=mcp-memory, path=src/skills/..., ref=dev)

## Cloudflare部署配置
### wrangler.toml要点
- 顶层添加`find_additional_modules = true`
- globs写`**/*.js`（base_dir默认src/）
- 构建命令：`npx wrangler deploy --no-bundle`

### 环境变量（Cloudflare控制台配置）
- GITHUB_TOKEN / SUPABASE_URL / SUPABASE_ANON_KEY / AGNES_API_KEY / DEEPSEEK_API_KEY

## 注意事项
- 中文编码：GitHub API推送需要UTF-8 base64编码
- btoa不支持中文，需用TextEncoder转UTF-8
- 推一次main = 触发一次Cloudflare部署
- 改完每个步骤要自己检查一遍
- **改设定前必须先贴方案给柳柳确认**

## 输出格式
返回分支状态、PR链接和部署结果