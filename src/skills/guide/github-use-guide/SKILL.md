---
name: github-use-guide
description: 当需要操作 GitHub（推送、合并、PR、检查分支差异等）时调用。提供工具对照表和关键红线。
category: guide
tags: ["GitHub", "推送", "PR", "合并", "分支", "deploy"]
---

# GitHub 使用指南（v6.3 · 主体重构版）

## 一句话
日常 GitHub 操作的工具对照表 + 关键红线；发布流程见 deploy 技能。

## 工具对照表

| 我想做什么 | 用什么 |
|---|---|
| 推文件到分支 | github_push(path, content, branch) · JSON 用 content_base64 |
| 读文件 | github_read(path, branch) |
| 列目录 | github_list(path, branch) |
| 删文件 | github_delete(path, branch) |
| 建仓库 | github_create_repo(repo) |
| 建分支 | github_create_branch(name, from=main) |
| 同步分支 | github_sync_branch(name=dev, from=main) |
| 合并 dev→main | github_merge_to_main(branch=dev, commit_title=vX.Y.Z: 名称) |
| 建 PR | github_create_pull_request(base=main, head=dev, title, body) |
| 合并 PR | github_merge_pull_request(pull_number, merge_method=rebase, commit_title) |
| 关 PR | github_close_pull_request(pull_number) |
| 查 PR | github_get_pull_request(pull_number) |
| 对比分支 | github_compare_branches(base=main, head=dev) |
| 同步工具注册表 | github_auto_sync(dry_run=true 先预览) |

## 关键红线
1. **main 只经 PR 合入**——绝不直接 github_push 到 main。
2. **分叉先 sync 再开发**——sync_branch 不删重建；推 main 前先 compare。
3. **合完 main 必 sync dev**——v6.3.2 合并工具自动做；手动流程记得补。
4. **JSON 用 content_base64**——普通 content 推 JSON 会变 [object Object]。
5. **注册表以代码 GITHUB_TOOL_DEFS 为真相源**——表只是缓存。

## 使用原则
- 日常操作 → 查本表；发布 → 走 deploy 技能（柳柳确认 + 版本化）。
- 不确定怎么做 → help() 或读对应 SKILL.md，不凭印象。

## 最近更新
- 2026-09-01：主体重构——工具表 + 红线为主，去错题本化。
