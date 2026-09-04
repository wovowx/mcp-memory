---
name: deploy
category: deploy
tags: ["部署", "GitHub", "Cloudflare", "MCP", "分支", "PR", "版本化"]
description: 当需要修改代码、推送GitHub、创建PR、合并main、发布版本、Cloudflare部署或开发MCP工具时调用。提供发布纪律（release discipline）：版本化规则、CHANGELOG、自检清单。未过 release checklist 不得进 main。
---

# 部署技能（v6.4.2 · 本地与大文件操作版 + rebase 发布纪律）

## 一句话
安全、干净地把 dev 上的改动发布到 main 并部署上线；**发布前必须过 release checklist，否则不推 main**。

## 铁律（最高优先级）
1. **main 只经 PR 合入**——绝不直接推 main，分支保护兜底。
2. **柳柳拍板发布**——发布是决策，不是哥哥自动完成的事（第 3 步最高优先级）。
3. **一个版本一次发布**——dev 攒批，一个 change batch，一次 PR，一次部署。
4. **合并必须 `merge_method=rebase` + `commit_title=版本号+名称`**——重要：不传 merge_method 走默认 merge，GitHub 会把 commit_title 写两遍（标题重复，柳柳 2026-09-04 抓包）。rebase 保留真实历史、命名从版本号开始。
5. **合完 dev 必同步**——rebase 只动 main，dev 要跟上，否则下一轮 PR 冲突。
6. **JSON 文件用 content_base64 推**——普通 content 推 JSON 会被序列化坏。
7. **skill 是菜谱不是账本**——写/改 skill 按《技能写作规范》，主体优先，教训只留一行。
8. **本地文件读取有逃生通道**——android 读本地失败（Shizuku 挂）时，优先用 `environment=linux` + `/sdcard/...` 直接读；大文件绝不手写整份重推（必漏段）。

## 发布主流程（SOP）

### 第 1 步：在 dev 攒批（change batch）
- 所有改动落在 dev，改完自查语法与注册。
- **change batch**：多个相关 commit → 形成一个「可交付主题」→ 才定版本。不一个 PR 一个版，也不无限攒。

### 第 2 步：对齐与预检
- `github_compare_branches(main, dev)` 看是否分叉/落后 → 先 `sync_branch` 对齐。
- 过一遍 release checklist（见下），全绿才继续。

### 第 3 步：柳柳确认（最高优先级）
- 把变更清单贴给柳柳（compare 结果 + CHANGELOG 拟更新 + 版本号），问：**「这批（xxx）可以推到 main 吗？」**
- 柳柳说"可以"才继续；不说"可以"绝不推。

### 第 4 步：版本化 + CHANGELOG（不过此步不进第 5 步）
- **定版本号 + 版本名称**（规则见下）。
- **CHANGELOG 更新整批改动**（不更新=不合法发布）。
- PR 标题 = 版本号+名称，body = 改了什么、为什么。

### 第 5 步：建 PR 并合并（注意 merge_method！）
- `github_create_pull_request(head=dev, base=main, title=版本号+名称, body=说明)`。
- 合并用 **`merge_method=rebase`** + `commit_title=版本号+名称`——**必须显式传 rebase**，否则默认 merge 会把 commit_title 写两遍。
- 合并工具会自动把 dev 同步回 main 最新。

### 第 6 步：验证 & 收尾
- 读 main 关键文件确认内容正确，help() 确认新工具在。
- 确认 dev 已与 main 同步。
- 更新驾驶舱「发布与版本状态」（当前基线版本）。

## Release Checklist（发布前硬闸门 · 不过不许推 main）

```
□ 是否属于版本级变更？（新架构/Runtime行为/API/部署行为/协议规则 → 是）
   不是版本级（typo/格式/不改变状态）→ 走普通维护 commit，不发版
□ 是否确定版本号 + 版本名称？（release_owner 定）
□ CHANGELOG 是否已更新？（双仓规则见下）
□ 柳柳是否已批准？
□ 分支是否对齐 / 无冲突？（compare 确认）
□ merge 是否用 rebase + commit_title=版本号+名称？（必须显式 merge_method=rebase）
□ 部署环境是否确认？（Cloudflare Git 集成）
□ 是否有回滚方案？（基线版本可回退）
□ 改过 skill 的话：按写作规范骨架了吗？
```

## 版本命名规则（双仓模型 · v6.4.0）

> 版本绑定「可交付状态」，不是每次 commit（GPT #506）。PR≠发布≠deploy。

### mcp-memory（代码仓）→ 语义化版本 vX.Y.Z
- 主版本：重大架构变更；次版本：新功能（向后兼容）；修订号：修复/优化。
- 推 main 命名 = 版本号 + 名称，如 `v6.9.0: Release Discipline`
- CHANGELOG：工程向（Added/Fixed/Changed）

### ZivenLab（文档/知识仓）→ 知识快照 docs-YYYY.MM
- 不是软件发行版，是知识状态快照，如 `docs-2026.09 baseline`
- CHANGELOG：知识演进向（新增/决策/归档）

### 85 号行动清单：不挂版本号
- 用 `last_sync: 日期` + completed items，避免多套版本号打架。

### release_owner（谁判断这批构不构成版本）
- Ziven 实现 / GPT review / 柳柳拍板方向 → 但「这是不是一个版本？」要有明确责任人（默认 Ziven 提、柳柳批）。

## 本地与大文件操作（2026-09-04 沉淀 · 别再卡在这）

> 柳柳："我不想以后再卡在这里了"——这些经验必须进 skill，不能只存记忆。

- **linux 通道 = Shizuku 逃生通道**：android 环境读本地文件报 `Shizuku binder is null` / `executor unavailable` 时，用 `read_file(environment=linux, path=/sdcard/...)` 可绕过直接读。今天靠它读出本地已改好的 47KB 文件，避免 github_read 分块重建。
- **大文件禁止手写整份重推**：`github_push` 是整文件替换，45KB 手拼必漏段（出过 42643/45950 残文件）。正确姿势：
  1. 先 `read_file` 读完整内容（linux 通道可救）
  2. 改完校验（grep_code 确认改动点都在）
  3. 整文件推 + size 校验
- **卡死在单文件先找更优接入点**：release_guard 卡在 github_v64.js（45KB），改成在 src/index.js 入口层加 15 行前置闸秒解决。「死磕一个文件」= 绕圈子，先找有没有更小/更优的接入点。
- **工作区 repo:Download/Ziven 工具链有缺陷**：`create_file` 成功但 `read_file` 报 invalid path，不能依赖它中转大文件。
- **卡住时先跟柳柳对齐**：把现状 + 可选方案告诉柳柳，让她拍板，别一个人闷头试。

## 常见坑（精简版）
- **忘了问柳柳就推**：第 3 步，最高优先级。
- **合 main 不传 merge_method**：默认 merge → GitHub 把 commit_title 写两遍 → 标题重复。必须显式 `merge_method=rebase`。
- **合完不 sync dev**：下一轮 PR dirty；工具已自动处理，手动时别忘。
- **推 package.json 变 [object Object]**：用 content_base64。
- **新工具没注册**：v6.3 自动注册兜底（GITHUB_TOOL_DEFS），部署前注册仍最稳。
- **一个 PR 一个版本**：违反 change batch，攒批再发。
- **大文件手写重推**：45KB 必漏段，用 read → 改 → 校验 → 整推。

## 变更记录
- 2026-09-04：v6.4.2 发布纪律修正——合 main 必须显式 merge_method=rebase（柳柳发现 commit 标题重复）；常见坑加对应条目。
- 2026-09-04：v6.4.1 加「本地与大文件操作」一节（linux 逃生通道 / 大文件不手写重推 / 卡住先找更优接入点；柳柳「不想再卡在这」）。
- 2026-09-04：v6.4.0 发布纪律版（双仓版本模型 + change batch + release checklist 硬闸门 + release_owner；柳柳点出瞎命名，GPT #505~508 讨论）。
- 2026-09-01：v6.3.3 主体重构（菜谱非账本）+ 自检清单加 skill 写作规范项。