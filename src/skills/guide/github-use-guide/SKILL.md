---
name: github-use-guide
description: 当需要操作 GitHub（推送、合并、PR、检查分支差异等）时调用。提供工具对照表、Git 纪律（merge 规范）和大文件推送规范。发布纪律见 deploy skill。
category: guide
tags: ["GitHub", "推送", "PR", "合并", "分支", "deploy", "大文件"]
---

# GitHub 使用指南（v6.5.1 · content_url 大文件通道）

## 一句话
日常 GitHub 操作的工具对照表 + Git 纪律（怎么合并）+ 大文件推送规范；**发布纪律（能不能发布）见 deploy skill，两者分层不混**。

## 分层
- **deploy skill** = 发布纪律：版本化 / CHANGELOG / release checklist / 柳柳确认。
- **github-use-guide** = Git 纪律：PR 格式 / merge method / 分支流程 / commit 规范。
- 每次进 main：先过 deploy 的 release checklist，再按本表执行 merge。

## 工具对照表

| 我想做什么 | 用什么 |
|---|---|
| 推文件到分支 | github_push(path, content, branch) · JSON 用 content_base64 |
| 推大文件（>16KB，如 skill/长文档） | **github_push(path, content_url=公开url, branch)** —— 服务端拉取，不经过上下文 |
| 读文件 | github_read(path, branch) |
| 列目录 | github_list(path, branch) |
| 删文件 | github_delete(path, branch) |
| 建仓库 | github_create_repo(repo) |
| 建分支 | github_create_branch(name, from=main) |
| 同步分支 | github_sync_branch(name=dev, from=main) |
| 对比分支 | github_compare_branches(base=main, head=dev) |
| **合并 dev→main（发布）** | **先过 deploy release checklist → github_merge_to_main(branch=dev, commit_title=版本号+名称)** |
| 建 PR（发布） | github_create_pull_request(base=main, head=dev, title=版本号+名称, body=说明) |
| 合并 PR | github_merge_pull_request(pull_number, merge_method=rebase, commit_title=版本号+名称) |
| 关 PR | github_close_pull_request(pull_number) |
| 查 PR | github_get_pull_request(pull_number) |
| 同步工具注册表 | github_auto_sync(dry_run=true 先预览) |

## 版本化示例（按仓库类型）

### mcp-memory（代码仓）→ 语义化版本
```
commit_title: v6.9.0: Release Discipline
PR title: v6.9.0: Release Discipline
merge_method: rebase
```

### ZivenLab（文档仓）→ 知识快照
```
commit_title: docs-2026.09: 项目驾驶舱与协作协议整理
PR title: docs-2026.09: 项目驾驶舱与协作协议整理
merge_method: rebase
```

## 大文件推送规范（v6.4 新增 · 2026-09-03 实战验证）

### ✅ 首选通道：content_url（v6.11.11 · 2026-09-04 实测通过）

**用法**：先把文件内容放上公开 url（可用 image_upload / 上传通道拿到 url，或任何 http(s) 公开链接），然后：
```
github_push(path="src/...", content_url="https://.../file", branch="dev", message="vX.Y.Z: ...")
```
- Worker 端自动 fetch(url) → 拉取字节 → base64 → PUT → size 校验，**内容完全不经过 Agent 上下文，永不截断**。
- **实测**：151KB 文档端到端成功（155046 bytes 一致，Verified: true）；以前同样体量走 base64 必截断（INPUT_CORRUPT）。
- 与 content / content_base64 **三选一**；小文件（<16KB）继续用 content 即可。

### 备选（旧法，仍可用）：read_file 搬运法

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

## 关键红线
1. **main 只经 PR 合入**——绝不直接 github_push 到 main。
2. **分叉先 sync 再开发**——sync_branch 不删重建；推 main 前先 compare。
3. **合完 main 必 sync dev**——v6.3.2 合并工具自动做；手动流程记得补。
4. **JSON 用 content_base64**——普通 content 推 JSON 会变 [object Object]。
5. **code_runner 不是推送必需品**——只有「需要生成/修改内容后再推」才用；纯搬运用 read_file。
6. **超长手写 content 会炸 MCP**——宁可分步 read_file 搬运，不手构造。
7. **注册表以代码 GITHUB_TOOL_DEFS 为真相源**——表只是缓存。
8. **发布必过 release checklist**——版本化/CHANGELOG/柳柳确认，见 deploy skill。

## 常见坑
- **分叉了还硬推/硬合**：先 sync_branch 对齐再开发。
- **合完忘 sync dev**：下一轮 PR dirty，工具自动做但别依赖记忆。
- **code_runner 卡死**：App 级 worker 挂死，重启 Operit 恢复；纯推文件时绕开它。
- **不版本化就合 main**：违反 deploy release checklist，先定版本+更新 CHANGELOG。
- **其他情况 → 走 deploy 发布流程**（先问柳柳、版本化）。

## 使用原则
- 日常操作 → 查本表；发布 → 走 deploy skill（柳柳确认 + 版本化 + release checklist）。
- 不确定怎么做 → help() 或读对应 SKILL.md，不凭印象。

## 变更记录
- 2026-09-04：v6.5.1 content_url 大文件通道（github_push 新增 content_url 参数，实测 151KB 成功；首选通道）
- 2026-09-04：v6.5.0 Git 纪律版——deploy(github-use-guide) 分层、merge 条目标注 release checklist、版本化示例双仓两种（GPT #505~508）。
- 2026-09-03：v6.4 新增「大文件推送规范」（read_file → github_push 搬运法；code_runner 去依赖）。
- 2026-09-01：主体重构——工具表 + 红线为主，去错题本化。