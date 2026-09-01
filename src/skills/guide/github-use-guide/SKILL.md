---
name: github-use-guide
description: 当哥哥需要操作 GitHub（推送、合并、PR、检查分支差异等）时调用。提供工具对照表和红线，防止推 main 出错、分支分叉。
category: guide
tags: ["GitHub", "推送", "PR", "合并", "分支", "deploy"]
---

# GitHub 使用指南（2026-09-01 v6.2 同步）

## 定位
这是哥哥操作 GitHub 的总纲：工具对照表 + 红线。推 main 的完整铁律流程见 **deploy 技能**（本指南不重复）。

## 场景→工具对照表

| 我想做什么 | 用什么 |
|---|---|
| 改文件/推文件到分支 | github_push(path, content, branch=dev) |
| 推 JSON 内容（package.json 等） | github_push(path, content_base64=base64编码, branch=dev) —— 普通 content 推 JSON 会被序列化成 [object Object]！ |
| 读文件内容 | github_read(path, branch) |
| 列出目录 | github_list(path, branch) |
| 删文件 | github_delete(path, branch) |
| 创建仓库 | github_create_repo(repo) |
| 建分支（从源分支新建） | github_create_branch(name, from=main) |
| 同步分支（fast-forward，不删重建） | github_sync_branch(name=dev, from=main) |
| 把 dev 一次性合并进 main | github_merge_to_main(branch=dev, commit_title=vX.Y.Z: 名称) |
| 创建 PR | github_create_pull_request(base=main, head=dev) |
| 合并 PR（支持 commit_title） | github_merge_pull_request(pull_number, merge_method=merge/rebase, commit_title=vX.Y.Z: 名称) |
| 关废弃 PR | github_close_pull_request(pull_number) |
| 查单个 PR 状态 | github_get_pull_request(pull_number) |
| 对比两个分支差异 | github_compare_branches(base=main, head=dev) |

## 🔴 红线（不可违）

### 1. main 只接受 PR/merge 合并
- 绝不直接 github_push 到 main
- 要推 main 先走 dev → PR → merge（详见 deploy）

### 2. 分叉根治 = sync_branch，不删重建（2026-09-01 更新）
- **优先用 github_sync_branch(name='dev', from='main')**：直接 fast-forward 对齐，不删分支
- 不用再删 dev 重建（旧做法已废弃）
- github_create_branch 只在「需要新建分支」时用（如从 main 建 dev）

### 3. 推 main 前先 compare
- 任何「要合 main」前先 github_compare_branches(base=main, head=dev)
- 分叉/落后 → 先 sync_branch 对齐 main 再推

### 4. JSON 内容必须用 content_base64（2026-09-01 新增）
- github_push 的 content 参数传 JSON 字符串会被序列化成 [object Object]（构建失败的元凶）
- 推 package.json 等 JSON 文件：先 base64 编码，用 content_base64 参数推送
- 普通 md/js 文件不受影响，用 content 正常推

## 🧭 裸工具按场景走（2026-08-29 收编说明）
- github_* 工具是**原子操作**，对应**真实场景**应优先读场景 skill：
  - 「推 main / 部署」→ 走 **deploy** skill（含版本号、柳柳确认铁律）
  - 「日常 GitHub 操作」→ 走本 guide 对照表 + 红线
- 哥哥不要凭裸工具描述就动手，先判定场景再走对应 skill

## 推 main 完整流程
- **全部铁律与步骤见 deploy 技能**（先问柳柳、带版本号+说明、她OK后建PR+merge）。
- 这里不重复，避免两套真相不一致。

## 常见问题
- **PR 冲突**：先 sync_branch 对齐 main（或对比分支找差异），不要硬合
- **分支分叉**：用 github_sync_branch 直接 fast-forward，不删重建
- **工具没出现在 help**：可能没在 skills 表注册；补 supabase skills 插入（详见 deploy）
- **包名带 github: 前缀**：早期记录用 github:xxx，实际工具名是 github_xxx（下划线）

## 最近使用记录
- 2026-09-01：新增 content_base64 / create_branch / sync_branch / commit_title / rebase 工具对照；分叉红线改为 sync_branch 不删重建
- 2026-08-29：加「裸工具按场景走」收编说明
- 2026-08-28：精简——推 main 流程统一指向 deploy 去重，保留工具对照表+红线
- 2026-08-25：创建。

## 输出格式
返回所使用的 GitHub 操作结果