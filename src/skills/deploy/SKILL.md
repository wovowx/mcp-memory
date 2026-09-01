---
name: deploy
description: 当需要修改代码、推送GitHub、创建PR、Cloudflare部署或开发MCP工具时调用。提供发布的标准流程与关键原则。
category: deploy
tags: ["部署", "GitHub", "Cloudflare", "MCP", "分支", "PR"]
---

# 部署技能（v6.3 · 主体重构版）

## 一句话
安全、干净地把 dev 上的改动发布到 main 并部署上线。

## 发布主流程（SOP）

### 第 1 步：在 dev 攒批
- 所有改动落在 dev，改完自查语法与注册。
- 只有要发布时才定版本号、开 PR；不频繁开 PR。

### 第 2 步：对齐与预检
- `github_compare_branches(main, dev)` 看是否分叉/落后 → 先 `sync_branch` 对齐。
- 过一遍自检清单（见下），全绿才继续。

### 第 3 步：柳柳确认（最高优先级）
- 把变更清单贴给柳柳（compare 结果 + CHANGELOG 拟更新），问：**「这批（xxx）可以推到 main 吗？」**
- 柳柳说"可以"才继续；不说"可以"绝不推。

### 第 4 步：版本化 + CHANGELOG
- 定版本号（主架构→大版本 / 新功能→次版本 / 修复→补丁号）+ 版本名称。
- CHANGELOG 更新整批改动，PR 标题 = 版本号+名称，body = 改了什么、为什么。

### 第 5 步：建 PR 并合并
- `github_create_pull_request(head=dev, base=main, title=版本号+名称, body=说明)`。
- 合并用 `merge_method=rebase` + `commit_title=版本号+名称`（保留真实 commit，无 Merge PR 前缀）。
- 合并工具会自动把 dev 同步回 main 最新。

### 第 6 步：验证 & 收尾
- 读 main 关键文件确认内容正确，help() 确认新工具在。
- 确认 dev 已与 main 同步（工具自动做了，手动对照一眼）。

## 发布前自检清单
- [ ] 语法/help 分支在位（改过入口文件）
- [ ] 新工具已注册（或 v6.3 自动注册已兜底）
- [ ] 分支对齐、无冲突（compare 确认）
- [ ] CHANGELOG 更新到位、版本号+名称
- [ ] 柳柳已批准
- [ ] 合并后验证 + dev 同步

## 关键原则
1. **main 只经 PR 合入**——绝不直接推 main，分支保护兜底。
2. **柳柳拍板发布**——发布是决策，不是哥哥自动完成的事。
3. **一个版本一次发布**——dev 攒批，一次 PR，一次部署。
4. **合并用 rebase + commit_title**——保留真实历史、命名从版本号开始，不用 squash。
5. **合完 dev 必同步**——rebase 只动 main，dev 要跟上，否则下一轮 PR 冲突。
6. **JSON 文件用 content_base64 推**——普通 content 推 JSON 会被序列化坏。

## 常见坑（精简版）
- **忘了问柳柳就推**：本技能第 3 步，最高优先级。
- **合完不 sync dev**：下一轮 PR dirty；工具已自动处理，手动时别忘。
- **推 package.json 变 [object Object]**：用 content_base64。
- **新工具没注册**：v6.3 自动注册兜底（GITHUB_TOOL_DEFS），部署前注册仍最稳。

## 版本命名规则
- 主版本：重大架构变更；次版本：新功能（向后兼容）；修订号：修复/优化。
- 推 main 命名 = 版本号 + 版本名称，如 `v6.3.0: 工具自动注册`。

## 最近更新
- 2026-09-01：主体重构——突出发布主流程，教训压缩为「常见坑」；加第 3 步柳柳确认。
