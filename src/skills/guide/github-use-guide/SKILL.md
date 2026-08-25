---
name: github-use-guide
description: 当哥哥需要操作 GitHub（推送、合并、PR、检查分支差异等）时调用。提供工具对照表和标准流程，防止推 main 出错、分支分叉。
category: guide
tags: ["GitHub", "推送", "PR", "合并", "分支", "deploy"]
---

# GitHub 使用指南（2026-08-25 定）

## 定位
这是哥哥操作 GitHub 的总纲。凡是要碰 GitHub，先读这个，再决定用哪个工具、走什么流程。

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
- 绝不直接 github_push 到 main（除非是 SKILL.md 纯文档且柳柳同意）
- 要推 main 先想想：能不能走 dev → PR → merge？
- github_push 的 main 警告是提示，不是许可，要停一下再确认

### 2. 不轻易删分支
- 删分支是万不得已的最后手段（历史分叉实在无法解决时才考虑）
- 优先用 github_compare_branches 看差异，能解就解
- 删 dev 重建 = 丢掉 dev 上所有未合并代码，务必先确认没有任何重要东西没同步

### 3. 推 main 前先 compare
- 任何「要合 main」的动作之前，先 github_compare_branches(base=main, head=dev)
- ahead_by 太大 / status=diverged → 先回 dev 处理，再合
- 目的：提前发现冲突，别推到一半才炸

## 标准流程：改完推 main（一次成功版）
1. 在 dev 分支改代码（github_push branch=dev）
2. 自测/确认
3. github_compare_branches(base=main, head=dev) → 确认可合
4. 创建 PR：github:create_pull_request(base=main, head=dev, title=含版本号)
5. 合并 PR：github:merge_pull_request(pull_number) → 一次部署
6. 验证 main（get_file_content / get_repository）
7. 有废弃 PR 卡住 → github_close_pull_request 关掉再继续

## 常见问题
- **PR 冲突**：先回 dev 对齐，或对比分支找差异，不要硬合
- **分支分叉太深**：先 compare 评估；必要时（万不得已）删分支重建，但先备份重要内容
- **工具没出现在 help**：可能没在 skills 表注册（Worker 有代码但表没记录）；补 supabase skills 插入

## 最近使用记录
- 2026-08-25：创建。背景：推 main 翻车（手动改 main 导致分叉、PR 卡死），柳柳教删分支重建；沉淀为指南。

## 输出格式
返回所使用的 GitHub 操作结果