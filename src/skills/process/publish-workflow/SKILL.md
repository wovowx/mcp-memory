---
name: publish-workflow
description: >
  【发布工作流·候选人草案】mcp-memory/Cloudflare 项目发布闭环：改代码→守门人→merge→sleep45→verify_main。
  从使用数据自动沉淀的首个试点草案（高频真实动作序列：github_edit→github_merge_to_main→sleep45→cloudflare_deploy_status）。
  已由柳柳人审批准晋升正式 skill（2026-10-19）。
category: process
status: active
tags: ["发布", "deploy", "verify", "发布闭环", "候选人"]
---

# 发布工作流（发布闭环 · 正式技能）

## 触发条件
修改代码后要发布上线（mcp-memory / 任何 Cloudflare 部署仓库），或部署后要闭环验证。

## 执行步骤
1. **先过守门人**：改代码/创建文件/提交合并前走 `code-quality-guard`（复用审计 + 持续学习回归检查）
2. **改代码到 dev**：`github_edit`（三键齐全：params 含 path/repo/branch + tool_name 外层 + 字段完整）
3. **合并发布**：`github_merge_to_main`（默认 rebase；显式 merge 必须带 commit_title + merge_reason）
4. **等待传播**：`sleep 45` → `cloudflare_deploy_status(verify_main=true)`
5. **未 VERIFIED**：DEPLOY_UNVERIFIED → 查官方构建日志 或 本地 `node --check --input-type=module` 复现定位（**不许让柳柳手动贴日志**）
6. **闭环记录**：VERIFIED → 记结果到存档/驾驶舱

## 检查项
- merge 后**确证真合并**：`github_get_pull_request` Merged:true 或 verify VERIFIED
- 金钥匙：token 不落地（只进 Worker env）
- 构建失败**优先本地复现**（下载 main 最新文件 node 校验），不等 token 就能定位

## 禁止事项
- 直接 push main（release_guard 拦）
- 不确证合并就继续（learning_pr_merge_001）
- 让用户手动贴构建日志（learning_deploy_truth_001）
- 空口说记住（须真调工具存档，learning_memory_promise_001）
- 缺三键调用工具（learning_toolcheck_001）

## 成功标准
verify_main VERIFIED + merge 已确证 + 部署闭环已记录。

## 迭代（用完更新）
- 2026-10-19：自动技能沉淀 B 首个试点草案 → 柳柳人审批准晋升正式 skill