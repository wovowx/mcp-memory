---
name: deploy
description: 当用户需要修改代码、推送GitHub、创建PR、Cloudflare部署或开发MCP工具时调用此技能。含发布前自检清单。
category: deploy
tags: ["部署", "GitHub", "Cloudflare", "MCP", "分支", "PR"]
---

# 部署技能（合并版）

## 目标
实现从代码修改到Cloudflare自动部署的完整闭环，包含分支管理、GitHub推送和MCP工具开发。

## 🔴 版本与 PR 的正确认知（2026-08-28 柳柳纠正）
- **dev 是工作台**：可以攒很多次改动，每次小改动不必定版本号、不必开 PR。
- **main 是发布**：决定要推 main 时，才给整批定一个版本号，一次推上去。
- **一个版本 = dev 攒齐一批 + 一次 PR + 一次 main**；不频繁开 PR、不一个改动一个版本。
- **PR 是什么**：Pull Request＝把 dev 改好的一批申请合进 main 的"请求"。**建 PR 就是推 main 的前置动作**，不是单独要再确认一步。
- 反例（2026-08-28）：之前每改一点起版本号、频繁开PR（v5.2.0~5.2.4、PR#16~24）。

## 🔴 第一条铁律：绝不手动改 main（物理强制）
- main 只接受 PR 合并，绝不直接覆盖 main 文件。
- 分支保护已开启（2026-08-28）：main 设 Require PR + 禁止绕过，直推 409。
- 想进 main 只有走 dev→PR→merge；分叉就回 dev 对齐 main 重建。

## 🔴 第二条铁律：推 main 前必须先经柳柳确认（最高优先级）
- **哥哥想推这批时，先问柳柳：「这批（xxx）可以推到 main 吗？」**
- **柳柳说"可以"** → 这就是批准。然后哥哥建 PR（作为推 main 前置动作）**直接 merge**，不二次询问。
- **柳柳不 OK / 没表态 → 不推。** 绝不自建 PR 擅自合。
- 反例（2026-08-28）：连续无确认合 PR#16-21 被柳柳指出。

## 🔴 第三条铁律：推 main 必须带版本号 + 说明
1. CHANGELOG.md 更新（记录整批所有改动）
2. PR title 带版本号（整批的版本号）
3. PR body 写清改了啥、为啥
4. 缺一不合

## 🔴 发布前自检清单（2026-08-30 新增 · 像起飞前检查单）
**每次推 main 前，逐项自检，全绿才推。缺一项就停下补。**

- [ ] **1. 语法检查过了吗？** 改了 ai.js/github.js 等 → node/本地跑一遍语法，确保没低级错误（教训：help 分支丢失）
- [ ] **2. help 分支在吗？** 改了 ai.js → 确认 name==='help' 分支还在（教训：v5.4.0 丢 help 分支）
- [ ] **3. Supabase 注册表同步了吗？** 新增/改工具 → skills 表 insert/update 到位，help() 能查到（教训：github_read 写了没注册）
- [ ] **4. 分支对齐了吗？** github_compare_branches(main, dev) 看 diverge；dev 落后 main → 先回 dev 对齐（教训：历史分叉）
- [ ] **5. 有冲突吗？** 同上 compare；有冲突先解决再推（never 硬合）
- [ ] **6. CHANGELOG 更新了吗？** 带版本号 + 说明，缺一不合
- [ ] **7. 柳柳批准了吗？** 问过柳柳且她说"可以"？没批准绝不推
- [ ] **8. 推完验证了吗？** merge 后读 main 关键文件 + help 验证工具在

## 🔴 推 main 正确流程
1. 在 dev 攒完这一批所有改动（不碰 main）
2. 跑一遍**发布前自检清单**（上表），全绿才继续
3. 哥哥想推时，先问柳柳：「这批可以推到 main 吗？」
4. 柳柳说"可以" → 定版本号、更新 CHANGELOG（第3条铁律）
5. 建一次 PR（base=main,head=dev,title=版本号,body=说明）→ 用 github_create_pull_request → **直接 merge**（柳柳已批准）＝一次部署
6. 有冲突 → 回 dev 对齐 main，再重建 PR推
7. 推完跑第8项：读 main 关键文件 + help 验证

## 适用场景
- 修改MCP Worker代码并部署 / 更新技能或配置 / 新增或修改MCP工具 / 创建PR / 解决部署问题

## 🔴 铁律：改完 MCP 工具必须注册（否则哥哥调不到）
新增/修改 MCP 工具（src/tools/*.js）后，只改代码不够——必须同步注册到 Supabase skills 表。
- 用 supabase_db 在 skills 表 insert/update
- handler_config.handler 与 index.js 的 handlerMap 对应
- 验证：help() 能查到新工具
- 教训（2026-08-27）：github_read/list/delete 写了没注册 → 调不到

## 分支规则（硬性）
- 默认 dev 分支；推送先 dev，柳柳确认后才能推 main。

## 推main铁律（记忆强化）
- 推一次 main = 一次 Cloudflare 部署
- 一个版本在 dev 攒齐，柳柳批准后一次 PR 推 main
- 每次推 main 带版本号 + 说明（CHANGELOG 到位），缺一不合
- 推 main 前先问柳柳，她说"可以"才建PR+merge
- 禁止中途多次推

## 工作流程（SOP）

### 第1步：了解需求
听柳柳需求；列计划；不确定立刻问；柳柳确认后执行

### 第2步：改dev（铁律！）
所有改动落在 dev 分支；改完自查；绝不自接推 main

### 第3步：推送到GitHub
用 github_push 推送，分支=dev；main 绝不用它直接更新

### 第4步：Cloudflare自动部署
推到 main 后自动触发，只监听 main；验证读 main 确认

## 分支管理
只保留 main 和 dev 两分支；不新建多余分支；功能完成立即删临时分支；dev 和 main 保持一致

## Git操作参考
- 创建分支：github:create_branch(from_branch=main, new_branch=dev)
- 推送到dev：branch=dev；合并到main：通过PR
- GitHub API 没有移动文件接口，移动=新路径PUT+旧路径DELETE

## github:get_file_content 用法
读 main 传 owner/repo/path；读其他分支加 ref 参数

## 最近使用记录
- 2026-08-30：新增「发布前自检清单」——8项全绿才推，像起飞前检查单
- 2026-08-28：推main流程改最简——先问柳柳「这批可以推吗」，她说"可以"就建PR+直接merge
- 2026-08-28：加「版本与PR正确认知」——dev攒批、main发布、一个版本一次PR
- 2026-08-28：推main必须经柳柳确认、带版本号+说明、分支保护开启
- 2026-08-27：注册工具铁律；2026-08-25：绝不手动改main；2026-08-21：推main一次全推

## 输出格式
返回分支状态、PR链接和部署结果