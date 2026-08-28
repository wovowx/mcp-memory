---
name: deploy
description: 当用户需要修改代码、推送GitHub、创建PR、Cloudflare部署或开发MCP工具时调用此技能。
category: deploy
tags: ["部署", "GitHub", "Cloudflare", "MCP", "分支", "PR"]
---

# 部署技能（合并版）

## 目标
实现从代码修改到Cloudflare自动部署的完整闭环，包含分支管理、GitHub推送和MCP工具开发。

## 🔴 版本与 PR 的正确认知（2026-08-28 柳柳纠正，重要）
- **dev 是工作台**：可以在 dev 上攒很多次改动，**每次小改动不必定版本号、不必开PR**。随便改、攒着。
- **main 是发布**：每次**决定要推 main 时**，才给这整批改动**定一个版本号**，然后**一次 PR** 推到 main。
- **一个版本 = dev 攒齐一批 + 一次 PR + 一次 main**；不频繁开 PR，不一个改动一个版本号。
- **PR 是什么**：Pull Request＝把 dev 改好的一批东西申请合进 main 的"请求"。它是"一次推 main 的申请"，等你批准才合。
- 反例（2026-08-28）：哥哥之前每改一点就起版本号、频繁开PR（v5.2.0~5.2.4、PR#16~24），把"改一次"当"推一次"。正确的是：在 dev 攒着一批，等柳柳决定推时，再整体定版本、一次PR推。

## 🔴 第一条铁律：绝不手动改 main（现在已经物理强制）
- **main 只接受 PR 合并**，绝不 create_or_update_file 直接覆盖 main 的文件
- **分支保护已开启（2026-08-28）**：GitHub Settings→Branches→main 设了「Require PR before merging」+「Do not allow bypassing」。直接 push main 会被 GitHub 409 拦截，连 admin 都绕不过。
- 所以：想进 main 只有一条路——走 dev→PR→merge。物理上只能这样。
- 一旦先手动改了 main，dev/main 分叉 → 后面 PR 必冲突。冲突就往 dev 对齐 main 重建。

## 🔴 第二条铁律：推 main 前必须先经柳柳确认（最高优先级）
- **建好 PR 后，必须先把 PR 内容和改动清单贴给柳柳看（版本号 + 改了啥）**，等柳柳明确说「可以推/OK/合并」之后，才允许 merge。
- **绝不自合并。** 每次要 merge 前，先确认柳柳是否已批准这笔。
- 哪怕柳柳之前说过「可以」，也要确认是针对这一笔。
- 反例教训（2026-08-28）：哥哥连续无确认合了 PR#16-21，被柳柳指出。写死此铁律。

## 🔴 第三条铁律：推 main 必须带版本号 + 说明（强制前置）
1. CHANGELOG.md 已更新（记录这次整批所有改动）
2. PR title 带版本号（这个版本是整批的版本号）
3. PR body 写清这次整批改了啥、为啥
4. 没有版本号 / 没对应说明 → 不许合 main

## 🔴 推 main 标准流程（统一按此）
1. 在 dev 上攒完这一批所有改动（改文件+提交，不碰 main）
2. 柳柳决定要推时，**给整批定一个版本号**，更新 CHANGELOG、整理改动清单
3. 创建一次 PR：github:create_pull_request(base=main, head=dev, title=带版本号, body=说明)
4. 把 PR 贴给柳柳，等她说「可以」（铁律二）
5. 若有冲突 → 回 dev 对齐 main，再重新建 PR
6. 合并：github:merge_pull_request（仅在柳柳确认后）；一次 merge = 一次部署
7. 推完验证：main 关键文件 get_file_content 确认

## 适用场景
- 修改MCP Worker代码并部署
- 更新技能文件或配置文件
- 新增/修改MCP工具
- 创建分支或PR
- 需要推送代码时
- 解决Cloudflare部署问题

## 🔴 铁律：改完 MCP 工具必须注册（否则哥哥调不到）
新增/修改 MCP 工具（src/tools/*.js 加函数）后，只改代码不够——必须同步注册到 Supabase skills 表。
- 用 supabase_db 在 skills 表 insert/update 对应记录（name/description/input_schema/handler_config）
- handler_config.handler 与 index.js 的 handlerMap 对应
- 验证：help() 能查到新工具
- 教训（2026-08-27）：github_read/list/delete 写了没注册 → 调不到

## 分支规则（硬性）
- **默认：dev分支**
- 推送：先推dev，测试通过后等柳柳确认再合main
- 等柳柳确认后才能推main

## 推main铁律（记忆强化）
- 推一次main = 触发一次Cloudflare自动部署
- **一个版本在 dev 攒齐，一次 PR 推到 main**（不频繁开PR、不一个改动一个版本）
- **每次推main给整批定版本号 + 对应说明（CHANGELOG 更新到位），缺一不合**
- **推main前必须经柳柳确认（PR建好先给她看，她说可以才merge）**
- 禁止中途多次推送

## 工作流程（SOP）

### 第1步：了解需求
1. 听完柳柳的需求
2. 列出计划
3. 有不确定立刻询问柳柳
4. 等柳柳确认后开始执行

### 第2步：改dev（铁律！）
1. 所有改动先落在 dev 分支
2. 在 dev 改完所有文件（src/tools/*.js 或 src/index.js）
3. 每改完一个步骤，自己检查一遍
4. 绝不自接推 main

### 第3步：推送到GitHub
- 用 github:create_or_update_file 或 patch_file_in_repo 推送，分支=dev
- 改完的语言、配置、文档都落在 dev
- **main 绝不用 create_or_update_file 直接更新**

### 第4步：Cloudflare自动部署
- 推到 main 后自动触发
- 只监听 main 分支
- 验证：get_file_content 读 main 确认

## 分支管理
1. 只保留 main 和 dev 两个分支
2. 不新建多余分支
3. 功能完成后立即删临时分支
4. dev 和 main 保持一致

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
- 2026-08-28：加入「版本与PR正确认知」——dev攒批、main发布、一个版本一次PR推；纠正"每改一次起版本号"的旧误（教训：PR#16-24、v5.2.0~5.2.4 频繁开PR）
- 2026-08-28：推main必须经柳柳确认写死为铁律二（教训：连续无确认合PR#16-21）
- 2026-08-28：推main强制要求版本号+说明（CHANGELOG到位，缺一不合）
- 2026-08-28：分支保护开启（main必须PR+禁止绕过，直推409）
- 2026-08-27：新增「改完工具必须注册到Supabase」铁律
- 2026-08-25：新增「绝不手动改main」铁律，推main标准流程一次成功版
- 2026-08-21：柳柳提醒推main要一次全推

## 输出格式
返回分支状态、PR链接和部署结果