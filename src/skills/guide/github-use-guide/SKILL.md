---
name: github-use-guide
description: 当哥哥需要操作 GitHub（推送、合并、PR、检查分支差异等）时调用。提供工具对照表和红线，防止推 main 出错、分支分叉。
category: guide
tags: ["GitHub", "推送", "PR", "合并", "分支", "deploy"]
---

# GitHub 使用指南（2026-08-28 精简）

## 定位
这是哥哥操作 GitHub 的总纲：工具对照表 + 红线。推 main 的完整铁律流程见 **deploy 技能**（本指南不重复）。

## 场景→工具对照表

| 我想做什么 | 用什么 |
|---|---|
| 改文件/推文件到分支 | github_push(path, content, branch=dev) |
| 读文件内容 | github_read(path, branch) |
| 列出目录 | github_list(path, branch) |
| 删文件 | github_delete(path, branch) |
| 创建仓库 | github_create_repo(repo) |
| 把 dev 一次性合并进 main | github_merge_to_main(branch=dev) |
| 创建 PR | github:create_pull_request(base=main, head=dev) |
| 合并 PR | github:merge_pull_request(pull_number) |
| 关废弃 PR | github_close_pull_request(pull_number) |
| 查单个 PR 状态 | github_get_pull_request(pull_number) |
| 对比两个分支差异 | github_compare_branches(base=main, head=dev) |

## 🔴 红线（不可违）

### 1. main 只接受 PR/merge 合并
- 绝不直接 github_push 到 main
- 要推 main 先走 dev → PR → merge（详见 deploy）

### 2. 不轻易删分支
- 删分支是万不得已的最后手段
- 优先用 github_compare_branches 看差异
- 删 dev 重建 = 丢 dev 上所有未合并代码，务必先确认没重要东西没同步

### 3. 推 main 前先 compare
- 任何「要合 main」前先 github_compare_branches(base=main, head=dev)
- 分叉/落后 → 先回 dev 对齐 main 再推

## 🧭 裸工具按场景走（2026-08-29 收编说明）
- github_* 工具是**原子操作**，对应**真实场景**应优先读场景 skill：
  - 「推 main / 部署」→ 走 **deploy** skill（含版本号、柳柳确认铁律）
  - 「日常 GitHub 操作」→ 走本 guide 对照表 + 红线
- 哥哥不要凭裸工具描述就动手，先判定场景再走对应 skill

## 推 main 完整流程
- **全部铁律与步骤见 deploy 技能**（先问柳柳、带版本号+说明、她OK后建PR+merge）。
- 这里不重复，避免两套真相不一致。

## 常见问题
- **PR 冲突**：先回 dev 对齐 main，或对比分支找差异，不要硬合
- **分支分叉太深**：先 compare 评估；必要时（万不得已）删分支重建，但先备份重要内容
- **工具没出现在 help**：可能没在 skills 表注册；补 supabase skills 插入（详见 deploy）

## 最近使用记录
- 2026-08-29：加「裸工具按场景走」收编说明
- 2026-08-28：精简——推 main 流程统一指向 deploy 去重，保留工具对照表+红线
- 2026-08-25：创建。

## 输出格式
返回所使用的 GitHub 操作结果