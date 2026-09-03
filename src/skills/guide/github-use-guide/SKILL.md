---
name: github-use-guide
description: 当需要操作 GitHub（推送、合并、PR、检查分支差异等）时调用。提供工具对照表和大文件推送规范。
category: guide
tags: ["GitHub", "推送", "PR", "合并", "分支", "deploy", "大文件"]
---

# GitHub 使用指南（v6.4 · 主体重构版 + 大文件推送）

## 一句话
日常 GitHub 操作的工具对照表 + 关键红线 + 大文件推送规范；发布流程见 deploy 技能。

## 工具对照表

| 我想做什么 | 用什么 |
|---|---|
| 推文件到分支 | github_push(path, content, branch) · JSON 用 content_base64 |
| 推大文件（>16KB 或内容复杂） | 见下方「大文件推送规范」 |
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

## 大文件推送规范（v6.4 新增 · 2026-09-03 实战验证）

### 核心原则：内容搬运不构造，能用 github_push 绝不依赖 code_runner

**踩坑教训**（2026-09-03）：手写超长 content 给 github_push 会因转义错误炸掉 MCP 服务；code_runner 的 App 级 worker 会挂死。两者都不是必选项。

### 标准流程（按内容量分级）

**1. 内容 < 16KB（日常文件）**
- 直接用 github_push content 原样传。
- 内容里有引号/反斜杠别手动转义，原样贴。

**2. 内容 ≥ 16KB 或内容复杂（含大量中文/模板字符串）**
- 第一步：把文件写到本地（create_file），或从 GitHub API 拉下来存本地。
- 第二步：**read_file 读本地完整内容**（这个工具永不休眠不卡）。
- 第三步：把读到的完整内容原样作为 github_push 的 content 推送。
- 全程是「搬运」不是「构造」，不手写转义。

### 关键红线
1. **main 只经 PR 合入**——绝不直接 github_push 到 main。
2. **分叉先 sync 再开发**——sync_branch 不删重建；推 main 前先 compare。
3. **合完 main 必 sync dev**——v6.3.2 合并工具自动做；手动流程记得补。
4. **JSON 用 content_base64**——普通 content 推 JSON 会变 [object Object]。
5. **code_runner 不是推送必需品**——只有「需要生成/修改内容后再推」才用；纯搬运用 read_file。
6. **超长手写 content 会炸 MCP**——宁可分步 read_file 搬运，不手构造。
7. **注册表以代码 GITHUB_TOOL_DEFS 为真相源**——表只是缓存。

## 常见坑
- **分叉了还硬推/硬合**：先 sync_branch 对齐再开发。
- **合完忘 sync dev**：下一轮 PR dirty，工具自动做但别依赖记忆。
- **code_runner 卡死**：App 级 worker 挂死，重启 Operit 恢复；纯推文件时绕开它。
- **其他情况 → 走 deploy 发布流程**（先问柳柳、版本化）。

## 使用原则
- 日常操作 → 查本表；发布 → 走 deploy 技能（柳柳确认 + 版本化）。
- 不确定怎么做 → help() 或读对应 SKILL.md，不凭印象。

## 变更记录
- 2026-09-03：v6.4 新增「大文件推送规范」（read_file → github_push 搬运法；code_runner 去依赖）。
- 2026-09-01：主体重构——工具表 + 红线为主，去错题本化；术语统一、补常见坑。