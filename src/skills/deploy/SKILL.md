---
name: deploy
category: deploy
tags: ["部署", "GitHub", "Cloudflare", "MCP", "分支", "PR", "版本化"]
description: 当需要修改代码、推送GitHub、创建PR、合并main、发布版本、Cloudflare部署或开发MCP工具时调用。提供发布纪律（release discipline）：版本化规则、CHANGELOG、自检清单。未过 release checklist 不得进 main。
---

# 部署技能（v6.6.10 · 有限自动工作检查点交接与恢复验收）

## 一句话
安全、干净地把 dev 上的改动发布到 main 并部署上线；**发布前必须过 release checklist，否则不推 main**。

**闭环责任（Ownership Protocol · 柳柳指出 + GPT #789 定稿）**：说「我盯着部署」= 承诺一口气跑到部署终态（VERIFIED 或明确失败原因），并完成第 7 步的独立交接验收或明确记录阻塞，**中途不把控制权交回柳柳/用户**。等待是状态不是结束——sleep + 轮询 + 自动分支跑完，不做「等用户催」的半吊子。

## 触发方式（Event 触发说明 · GPT #791 / Ziven #792 收敛）
本 skill 是 workflow 形态（第 6 步自动闭环），按「规范生效机制（policy-index）」触发链路：
1. **主动触发（现状）**：用户/场景发部署请求 → master-router 路由到本 skill。
2. **merge 工具验证提示（Step 4 落地后）**：`github_merge_to_main` 成功返回时自动带「⚠️ 部署验证提示 + 下一步该调什么工具」→ 引导本 skill 第 6 步（不靠 Agent 记性）。
3. **远期 event-driven（v2 预留）**：merge_completed event → workflow engine → 自动触发 deploy_verification workflow。event 机制就绪后把第 6 步接入，无需 Agent 介入。

## 铁律（最高优先级）
1. **main 只经 PR 合入**——绝不直接推 main，分支保护兜底。
2. **柳柳拍板发布**——发布是决策，不是哥哥自动完成的事（第 3 步最高优先级）。
3. **一个版本一次发布**——dev 攒批，一个 change batch，一次 PR，一次部署。
4. **合并默认 `merge_method=rebase`**——必须显式传 rebase，并先读取 PR 的 `rebaseable`。若 `rebaseable=false`，不得反复尝试 rebase 或把 HTTP405 当作成功；确认 `mergeable_state` 后再选择可用方法。需要保留整批提交历史时可显式 `merge`，必须带 `commit_title` + `merge_reason=history-preserve`；只有明确接受压缩历史时才选 `squash`。当前 MCP merge wrapper 未暴露 `commit_message`，history-preserve merge 可能出现标题在正文重复；下次代码修复应补充该参数。
5. **合并后的 dev 同步必须识别 PR 来源分支**——只有独立回读确认 `merged=true` 且 `head.ref=dev`、`base.ref=main` 时才允许同步 dev；scoped release/hotfix/其他 head/base 必须跳过。该 guard 已在 `src/modules/github/branch_pr.js` 进入 main，`src/tools/github_v64.js` 作为 facade 委托；E1/E2 证据见历史 run `41856598888`。注意：dev-sync guard 与 merge 结果提示是两条独立链路；guard fail-closed 不代表 `github_merge_to_main` 的用户提示正确。dev 的 Mock PASS 不代表生产端已修复。
6. **JSON 文件用 content_base64 推**——普通 content 推 JSON 会被序列化坏。
7. **skill 是菜谱不是账本**——写/改 skill 按《技能写作规范》，主体优先，教训只留一行。
8. **本地文件读取有逃生通道**——android 读本地失败（Shizuku 挂）时，优先用 `environment=linux` + `/sdcard/...` 直接读；大文件绝不手写整份重推（必漏段）。
9. **推 dev 的 commit message 也用 `vX.Y.Z: 名称`**——不带 `docs(xxx):` 前缀（rebase 到 main 后显示才干净，柳柳 2026-09-04 要求）；**v6.32.3 起 release_guard 强制校验源分支 HEAD commit 标题**（rebase 后真实出现在 main 上的标题，2026-09-08 柳柳点出「6.32.0 后看不到版本号」教训）——merge 时传的 commit_title 在 rebase 模式下不会落到 main，版本号必须写在 dev commit 标题上。**修改已有文件一律用 github_edit**（v6.32.5+，read→edit→write 一次完成；github_push 只用于创建新文件）。
10. **部署失败必须自己查日志，不许让柳柳贴日志（柳柳 2026-09-07 铁律）**——DEPLOY_UNVERIFIED 后用 `cloudflare_deploy_status(verify_main=true)`（v6.32.9 起自动查官方 Builds 并返回构建结果/失败日志），或直接 `cloudflare_build_logs` 查官方构建日志。**官方构建结果是权威，不靠本地复现**（本地 `node --check` 默认 script/CJS 模式会漏 ESM 语法错误，v6.32.5-7 三天构建全挂但本地全过，柳柳 2026-09-09 拍板改用官方日志）。永远不把「帮我贴日志」丢给柳柳。

## 发布主流程（SOP）

### 第 1 步：在 dev 攒批（change batch）
- 所有改动落在 dev，改完自查语法与注册。
- **commit message 一律 `vX.Y.Z: 名称`**（不带 docs()/feat() 前缀，rebase 后 main 历史干净）。
- **change batch**：多个相关 commit → 形成一个「可交付主题」→ 才定版本。不一个 PR 一个版，也不无限攒。

### 第 2 步：对齐与预检
- `github_compare_branches(main, dev)` 看 compare 的 `ahead/behind/status` 后再决定，禁止把“分支不一致”一律交给 `sync_branch`：`ahead=0 && behind>0`（dev 是 main 的祖先、dev 没有独有提交）才可将 dev 快进到 main；`ahead>0 && behind=0`（dev 仅领先）保持 dev，不做反向同步；`ahead>0 && behind>0` 或 `status=diverged` 表示历史分叉，必须停止自动 sync，先检查文件差异与各自提交，选择 scoped release 或保留分支，不可强制把任一分支指向另一边；compare 失败/证据不全也停止。
- 过一遍 release checklist（见下），全绿才继续。

### 第 3 步：柳柳确认（最高优先级）
- 把变更清单贴给柳柳（compare 结果 + CHANGELOG 拟更新 + 版本号），问：**「这批（xxx）可以推到 main 吗？」**
- 柳柳���"可以"才继续；不说"可以"绝不推。

### 第 4 步：版本化 + CHANGELOG（不过此步不进第 5 步）
- **定版本号 + 版本名称**（规则见下）。
- **CHANGELOG 更新整批改动**（不更新=不合法发布）。
- PR 标题 = 版本号+名称，body = 改了什么、为什么。

### 第 5 步：建 PR 并合并（注意 merge_method！）
- `github_create_pull_request(head=dev, base=main, title=版本号+名称, body=说明)`。
- 合并优先用 **`merge_method=rebase`** + `commit_title=版本号+名称`，但先核对 PR `rebaseable`。若 `rebaseable=false` 且 PR `mergeable_state=clean`，如需保留提交历史，改用 `merge_method=merge` + `commit_title` + `merge_reason=history-preserve`；当前 wrapper 不支持 `commit_message`，会有标题重复风险，必须在发布单中披露。
- **当前生产 helper 边界（v6.43.0 / Worker #536）**：main 已包含 `src/modules/github/branch_pr.js` 的 PR 来源守门；只有确认 `merged=true && head.ref=dev && base.ref=main` 才自动同步 dev。2026-11-06 发布中发现 `github_merge_to_main` 对 HTTP405 的结果处理仍可能误报“已合并”：rebase 请求返回405时 PR 实际仍 open/merged=false。故工具返回“合并成功”后，**必须独立 GET PR 并确认 `merged=true`、`state=closed`、`merge_commit_sha` 存在，再检查 main/dev SHA**；HTTP405 永远不是合并成功证据。若 PR 仍 open，禁止部署、禁止声称发布成功。
- **合并前**记录 `main` 与 `dev` 的完整 SHA，并记录 PR 的 `head.ref/head.sha`、`base.ref/base.sha`；确认候选文件清单与批准范围一致。
- **合并后**重新读取 PR `merged/state/merge_commit_sha/head/base`、`main` SHA、`dev` SHA，再查 Cloudflare `verify_main=true`。只有 `merged=true` 才进入部署验证；工具提示、HTTP200/405 或 `mergeable=true` 都不能替代该回读。
- 若本次 PR 的 head 不是 `dev`，预期 dev 应保持原 SHA。若 dev 被自动移动，先确认原 commit 对象仍存在且当前 dev 仍等于刚才记录的 post-merge SHA，再使用 `github_sync_branch(name="dev", from="sha:<合并前dev完整SHA>", base="<当前dev完整SHA>")` 精确恢复；恢复后再次读取 main/dev 验证。
- 精确恢复模式仅允许 `dev`，会先核对目标 commit、expected current HEAD，再更新并回读；但 expected HEAD 检查与 PATCH 不是 GitHub 原子 CAS，执行时必须保证没有并发 dev 写入。若 SHA 不匹配、目标提交不可读或回读不一致，立即停止，不得改用无条件 force。
- **绝不以 `dev → main` 合并来修复 dev 指针**；这会把未发布提交带入生产。也不要删除/重建 dev 来“整理分支”。

### 第 6 步：部署自动闭环验证 & 收尾（🔴 必须一口气跑完，失败自愈）

> **铁律（柳柳）**：每次部署后必查；**DEPLOY_UNVERIFIED 必须自己查日志分析根因，不许让柳柳手动贴日志**。

```
merge 成功
  ↓ sleep 45s（等待 Cloudflare propagation，不是等人）
  ↓ cloudflare_deploy_status(verify_main=true)
  ├─ VERIFIED ✅ → 第 7 步检查点交接验收（独立结论）
  └─ DEPLOY_UNVERIFIED ⚠️ → 自动进入失败处理（不停！）
       ↓ 【工具自愈 · v6.32.9】cloudflare_deploy_status(verify_main=true) 自动查官方 Builds
       │    ├─ 构建 success → 等传播，重 verify
       │    └─ 构建 fail → 自动返回失败日志尾部（定位 SyntaxError 文件:行号）
       ↓ 分类错误（见「部署失败错误分类表」）
       ├─ 低风险可自愈（构建语法/配置typo/已知问题）→ 修复 → 重推 → 回到 merge 后流程
       └─ 高风险/未知（架构/库/权限/多次修复无效）→ 停，带证据贴给柳柳拍板
```

> 💡 **为什么要查官方构建日志而不是本地复现？** 构建阶段失败（SyntaxError/10021）**不产生 deployment 记录**，`deploy_logs` 查不到。但本地 `node --check` **默认 script/CJS 模式会漏 ESM 语法错误**（v6.32.5-7 教训：本地全过、Cloudflare 构建全挂，最后是 `cloudflare_build_logs` 官方日志直接给出 `SyntaxError ... github_v64.js:1180:6 [code: 10021]` 才定位真根因）。**官方 Builds 日志 = 权威、精确到文件:行号、与线上一致**（v6.32.9 起 verify_main 失败自动返回）。

**详细步骤**：

0. **merge 后先确证真合并（lesson-PR合并误报须确证 · 2026-10-18）**：`github_merge_to_main` 在 dev 分叉/冲突时可能虚报「已合并」（PR#250 实际 open/dirty）。合并后必须先 `github_get_pull_request(pull_number)` 确证 `Merged:true` 才算数；`Merged:false` → 主动查冲突 → 关掉脏 PR → sync dev 到 main 干净 → 重新 apply 改动 → 重新发 PR。确证后才进 step 1。
1. **merge 后立即**：`sleep` 45s（Cloudflare append 需要时间）。
2. **验证**：`cloudflare_deploy_status(verify_main=true, repo=wovowx/mcp-memory)`。
   - `VERIFIED` → 收尾，进第 7 步；若本次变更了 MCP tools/list 的工具名称、描述或入参 Schema，还需单独执行下方「ChatGPT 宿主工具元数据刷新」检查，这不影响 Worker 发布成功的判定。
   - `DEPLOY_UNVERIFIED` → **不 sleep 等人来问，直接下一步**。
3. **官方构建日志（自愈第一动作，v6.32.9 + 柳柳 2026-09-09 拍板）**——先信线上，不先本地：
   1. **`cloudflare_deploy_status(verify_main=true)` 自带自愈**：DEPLOY_UNVERIFIED 时自动调 Builds API → 构建 success 提示等传播；构建 fail 自动返回日志尾部（SyntaxError 文件:行号）。
   2. **`cloudflare_build_logs`**（专用工具）：列最近构建 + 拉失败构建日志尾部（Builds API，需 user-scoped token `cfut_`，Worker env 配 `cloudflare_key`）。
   3. `node --check`（script 模式）**仅作辅助**：若想本地复现，**必须加 ESM 模式**：`node --check --input-type=module` 或 acorn `sourceType: module`——不然会漏 ESM 错误（v6.32.5-7 教训）。
   4. runtime/deploy 层疑点 → `cloudflare_deploy_logs(limit=3)`。
   - ⚠️ deploy_logs 工具要新会话/重连后才有（MCP 工具列表是连接时快照）；当前会话没有就重新连接后再调。
4. **分类错误**（见下表）→ 按类处理。
5. **修复后重推**：改好 → 上传 → 推 dev → 合并 → 回到步骤 1（sleep 45s 再验证），直到 VERIFIED。
6. **自愈上限**：同一问题连续修 2 次仍 FAILED → 停，带证据（日志 + 修复记录）给柳柳拍板，不无限循环。

**ChatGPT 宿主工具元数据刷新（2026-11-06 柳柳确认）**：MCP 工具列表或参数 Schema 变更并部署后，ChatGPT 已连接的 Ziven_MCP 插件信息可能仍缓存旧工具定义，**柳柳需要手动刷新插件信息**；哥哥不能把 Worker `VERIFIED` 当作 ChatGPT 已拿到新 Schema，也不能代称刷新完成。若柳柳明确报告已刷新，就将本轮标记 `USER_REPORTED_DONE`，不反复提醒或要求重刷；随后在**新 ChatGPT 会话**核对工具签名并尝试经授权的最小只读调用，单独记录宿主 E3。未变更工具名称/Schema 的普通 Worker 代码发布不必机械要求刷新。2026-11-06 柳柳已确认本轮 Ziven_MCP 插件已手动刷新；原会话仍暴露 `session_context` 旧入参，留待新会话取证；`include_core=true` 会加载私人 Core 正文，必须单独明确授权。

### 第 7 步：权威检查点同步与跨会话恢复验收（2026-11-06 柳柳确认）

> **部署成功 ≠ 恢复交接成功。** 本步只处理工作指针；不读取私人 Core 正文，也不检查 Operit 付费调用。**2026-11-07 柳柳明确选择有限自动授权 B**：在已获柳柳逐版本发布批准、且 PR/main/CI/Cloudflare 部署经过独立验证后，正在执行发布/交接的 Ziven 可无需再次请示，自动更新**唯一** `⚙️/当前工作检查点`，完整保留历史并双回读；该持续授权只覆盖此 key 的工作状态交接，不包括其他私人记忆、生产数据库、Secrets、代码合 main、擅自发布或后台常驻执行。柳柳撤销授权或证据缺失时立即停止写入并报告。无活跃执行者时不声称后台自动运行。

1. **以已证实的生产事实为准**：仅在 PR 独立回读 `merged=true/state=closed`、main SHA、Cloudflare `verify_main=VERIFIED` 后整理版本号、CI、部署编号、真实 E3/NOT RUN、生产配置与未关闭事项。不要因文档/工具提示而宣布发布成功。
2. **读取并保护既有状态**：精确 `memory(action=recall,key="⚙️/当前工作检查点",offset=0)`，根据分页提示读完全文；同时只读 `session_context(host="chatgpt",invocation="explicit",include_core=false)` 核对当前版本。全文不完整、检查点已被别的会话更新或版本证据冲突时**停止覆盖**，记录待处理；保留旧历史，不把历史中的 `next_action` 重新激活。
3. **按限定持续授权 B 写入唯一工作检查点**：先核对本次版本发布已由柳柳批准、PR/main/CI/Cloudflare 独立验真、旧检查点全文与版本完整读取且临写前再核版本一致；满足后可无需逐版再问检查点更新许可，使用原有 `memory(action=update,key="⚙️/当前工作检查点",value=完整保留历史的新正文)`，更新顶层 `workflow_state/active_focus/next_action/do_not_repeat/decision/evidence` 和交接记录。**现有 memory(update) 没有可见原子 compare-and-swap 参数**：临写前二次读只能缩小竞态窗口，不能保证并发原子安全；怀疑并发/版本冲突时停止，勿覆盖。保留原历史全文，区分 E3 未验与真实部署结果。不得额外修改其他私人记忆、DB/schema、Secrets、Worker 配置或 main；用户撤销授权即停。
4. **双回读验收**：再次按完整 key 分段 `recall`，拼合后逐字符比较写入正文；再执行 `session_context(host="chatgpt",invocation="explicit",include_core=false)`，核对 `sources.checkpoint.version` 已更新及 `current_work` 的版本、下一步、日志策略符合真实生产。结果分别记录 `DEPLOY_VERIFIED` 和 `HANDOFF_VERIFIED`；后者失败/无授权则记 `HANDOFF_DEGRADED/UNVERIFIED`，不得伪称 `READY` 证明状态新鲜或宿主冷启动自动触发。
5. **交接闭环**：在 Roadmap/当前项目状态及 `CROSS-HOST-BRIDGE.md` 留下最新版本、唯一指针读回证据与下一施工动作。检查点同步失败时**不要重新合并或部署已验证版本**；先解释具体缺口，再按授权修复交接。ChatGPT/Operit 新框自动唤醒及相处连续性属于独立 E3，不由本步自动判通过。

**部署失败错误分类表**：

> ⚠️ 构建阶段失败（SyntaxError/10021/import 错）**不产生 deployment 记录**，`deploy_logs` 查不到——必须本地 `node --check` 复现（铁律 #10）。

| 日志关键词 | 分类 | 动作 |
|---|---|---|
| `syntax error` / `Unexpected token` / `code: 10021` | 构建语法错误（低风险可自愈） | `cloudflare_build_logs` 官方日志直接给文件:行号（v6.32.5-7 真根因 `github_v64.js:1180:6` 就是这么抓到的）→ 修语法 → 重推 |
| `build failed` / `module not found` / import 错误 | 构建依赖/模块错误（低风险可自愈） | 读报错模块 → 修 import/依赖 → 重推 |
| `HTTP 401/403` / `CF_API_TOKEN` | 凭证问题（需柳柳） | 停，汇报需要更新 CLOUDFLARE_API_TOKEN secret |
| 无新 deployment 记录 / deployment 列表为空 | 未触发（webhook/Git Integration 断） | 查 GitHub push 是否成功 → 查 Cloudflare Dashboard Git Integration → 可能需柳柳重连 |
| main HEAD 比部署新但部署记录存在 | 部署未赶上/还在流程 | 再 sleep 30s 重 verify；仍不匹配 → 本地复现后仍无错 → 查 deploy_logs |
| 日志显示失败但无明确错误 | 未知 | 停，带原始日志贴柳柳 |
## Release Checklist（发布前硬闸门 · 不过���许推 main）

```
□ 是否属于版本级变更？（新架构/Runtime行为/API/部署行为/协议规则 → 是）
   不是版本级（typo/格式/不改变状态）→ 走普通维护 commit，不发版
□ 是否确定版本号 + 版本名称？（release_owner 定）
□ CHANGELOG 是否已更新？（双仓规则见下）
□ 柳柳是否已批准？
□ 分支是否对齐 / 无冲突？（compare 确认）
□ PR `rebaseable` 是否为 true？若 false，是否选择了经说明的 history-preserve merge 或已获批的 squash？HTTP405 是否被明确视为失败而非成功？合并后 PR 是否独立回读 `merged=true`？
□ 部署环境是否确认？（Cloudflare Git 集成）
□ 部署后是否 verify_main？（merge 后 sleep 45s → cloudflare_deploy_status(verify_main=true)）
□ 是否有回滚方案？（基线版本可回退）
□ 改过 skill 的话：按写作规范骨架了吗？
□ 本次改动涉及已有文档/事实 → 已做知识洁癖自检（neat-freak）：改前全仓 grep 看现役、改后 grep 确认无新旧并存；同一事实只留一个权威版本，其他放短指针。
```

## 发布后交接 Checklist（与部署 VERIFIED 分开记录）

```
□ 是否符合柳柳 2026-11-07 有限持续授权 B（本版发布已逐版批准、实际部署验证、未撤销、仅 `⚙️/当前工作检查点`）？不符合则标 HANDOFF_PENDING_AUTH/UNVERIFIED；不把 B 解释为发布/main/其他记忆授权。
□ 是否完整保留旧检查点历史、核对当前版本无并发覆盖、写入可追溯的最新工作/下一步/边界？
□ memory(recall) 全文逐字符回读一致，并且 session_context(include_core=false) 指向新版本与正确 next_action？
□ 是否在 Roadmap/项目状态/Bridge 分别记录 DEPLOY 与 HANDOFF 的独立结论？自动宿主调用不冒充已验证。
```

## 版本命名规则（双仓模型 · v6.4.0）

> 版本绑定「可交付状态」，不是每次 commit（GPT #506）。PR≠发布≠deploy。

### mcp-memory（代码仓）→ 语义化版本 vX.Y.Z
- 主版本：重大架构变更；次版本：新功能（向后兼容）；修订号：修复/优化。
- 推 main 命名 = 版本号 + 名称，如 `v6.9.0: Release Discipline`
- **推 dev 也用同样格式**——不带 docs()/feat() 前缀，rebase 后 main 历史才干净（柳柳 2026-09-04）。
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

## 自动部署机制（Cloudflare Git 集成 · Workers Builds · v6.6.4 记录）
> 柳柳 2026-09-09：「记住是怎么自动部署的」。

- **触发**：`github merge to main` 成功后，Cloudflare Workers Builds（Git 集成）收到 `push event` → 自动构建 → 自动部署。**推 main 即自动部署**，不需要手动跑 wrangler deploy。
- **命令**：`deploy_command = npx wrangler deploy --no-bundle`，`branch_includes = [main]`，`path_includes = [*]`（wrangler.toml 保持 no-bundle + find_additional_modules）。
- **证据**：Builds API 列表里每个构建带 `build_trigger_metadata: {build_trigger_source: push_event, branch: main, commit_hash, commit_message}`——部署记录 source 显示 wrangler/dash。
- **构建失败 = 无部署记录**：构建阶段失败（语法错）不产生 deployment 记录，deploy_status 会一直显示 DEPLOY_UNVERIFIED——**这是「推了 main 但没有新部署」的标准信号，查官方 Builds 日志**。

## 部署失败官方日志（cloudflare_build_logs · v6.6.4 权威姿势）
> 柳柳 2026-09-09：「不用本地运行查有没有什么问题了…还是得查官方的部署日志」。

### 为什么（真根因案例 · v6.32.5-7）
- 2026-09-08 三天构建全失败（github_v64.js），但哥哥本地 `node --check` 全部通过 → 因为 **node --check 默认 script/CJS 模式会漏 ESM 错误**；wrangler 附加模块走 ESM module 模式，严格校验直接挂。
- 最后用 Builds API 官方日志直接命中：`✘ SyntaxError: Unexpected token 'catch' at tools/github_v64.js:1180:6 [code: 10021]` → 定位到 `github_delete` 分支闭合丢失 → 修复 v6.32.8。
- **结论：官方构建日志是唯一权威**（精确文件:行号、与线上一致），本地检查只做辅助且必须 ESM 模式。

### 怎么查（两种姿势）
1. **`cloudflare_deploy_status(verify_main=true)`**（v6.32.9 起）：DEPLOY_UNVERIFIED → 自动查最新构建 → success 提示等传播 / fail 自动带日志尾部。**部署后一把梭，失败直接给根因。**
2. **`cloudflare_build_logs`**（手动）：参数 `worker_name`（默认 mcp-memory）/ `limit` / `build_uuid`；列最近构建（status/outcome/commit）→ 选失败构建拉日志尾部 4000 字。
3. token：**必须 user-scoped token（`cfut_` 开头）**，配置在 Worker env **`cloudflare_key`**（v6.32.9 起工具读 `env.cloudflare_key || env.CLOUDFLARE_API_TOKEN`）；`CLOUDFLARE_API_TOKEN`（cfat_）只能查 deployments，查不了 Builds。

> 如需本地辅助复现：`node --check --input-type=module < file.js` 或 acorn `sourceType:'module'`——**不要只跑 `node --check`（script 模式）**。

## 查部署日志（cloudflare_deploy_status · v6.5.0 新增）

> 部署完要确认线上是不是最新版？用 MCP 工具查 Cloudflare 部署记录，不用开 Dashboard。

- **工具**：`cloudflare_deploy_status`（MCP 工具，help 里能搜到）
  - 参数：`account_id`（可选，默认 env CLOUDFLARE_ACCOUNT_ID）、`worker_name`（可选，默认 mcp-memory）、`limit`（可选，默认5最大10）
  - 返回：最近 deployments（id/created_on/source）+ versions（#号/id/created_on/source）
  - 前提：Worker env 已配 `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`（已经配好）
- **HTTP 端点**（原始版，同样可用）：GET `https://mcp-memory.wovowx.workers.dev/api/debug/deploy-status`
- **用法场景**：merge main 后确认自动部署已触发；部署失败排查；看当前线上版本号
- **verify_main**：`cloudflare_deploy_status(verify_main=true, repo=wovowx/mcp-memory)` → 自动对比 main HEAD vs 最新部署，返回 VERIFIED / DEPLOY_UNVERIFIED（柳柳铁律：部署后必查）
- **v6.32.9 增强**：DEPLOY_UNVERIFIED → 自动查 Builds API → 构建 fail 直接返回失败日志尾部（SyntaxError 文件:行号），构建 success 提示等传播。**部署后一把梭。**
- **失败排查 SOP**：DEPLOY_UNVERIFIED → 工具已自动带构建结果；还想要更多 → `cloudflare_build_logs` / `?deployment_id=<id>` 单次部署日志

## 常见坑（精简版）
- **忘了问柳柳就推**：第 3 步，最高优先级。
- **合 main 不传 merge_method**：默认 merge → GitHub 把 commit_title 写两遍 → 标题重复。必须显式 `merge_method=rebase`。
- **推 dev 带 docs()/feat() 前缀**：rebase 到 main 前缀也带过去，历史显乱。推 dev 直接 `vX.Y.Z: 名称`。
- **合并 scoped PR 后 dev 被移动**：当前 merge helper 对任何 PR 都可能自动 force-sync dev→main；合并前记完整 refs、合并后回读。若误移动，使用 dev-only 精确 SHA 恢复，禁止把 dev 合进 main 补救。代码 guard 仍待修复。
- **推 package.json 变 [object Object]**：用 content_base64。
- **新工具没注册**：v6.3 自动注册兜底（GITHUB_TOOL_DEFS），部署前注册仍最稳。
- **一个 PR 一个版本**：违反 change batch，攒批再发。
- **大文件手写重推**：45KB 必漏段，用 read → 改 → 校验 → 整推。

## 变更记录
- 2026-11-06：v6.6.9 按柳柳确认补齐部署后第 7 步：授权范围内同步唯一云端检查点、全文保留与比对、`session_context` 只读验收；把 Worker VERIFIED 与 HANDOFF_VERIFIED 分开，缺权限/失败不得重部署或假称新框自动恢复。
- 2026-11-04：v6.6.5 scoped PR refs 防护——记录 merge helpers 对非 dev PR 也可能自动 force-sync dev 的真实缺陷；固化 merge 前 refs 快照、merge 后独立回读、dev-only expected-SHA 恢复与非原子窗口限制。v6.6.6 补充状态分层：dev helper 条件修复绑定 commit `0c5cadde...` / run `41856598888` 已 E1/E2 PASS；main v6.36.1 当前部署仍含旧 helper，生产修复尚未发布，不能把 dev 代码测试写成线上关闭。
- 2026-09-09：v6.6.4 官方日志权威化（柳柳拍板）——记录自动部署机制（Cloudflare Git 集成 push→main 自动构建部署，deploy_command=wrangler deploy --no-bundle）；部署失败第一动作从「本地 node --check」改为「官方 Builds 日志」（v6.32.5-7 教训：本地 script 模式漏 ESM 错误三天排查失败，官方日志一行命中文件:行号）；cloudflare_deploy_status verify_main 增强：DEPLOY_UNVERIFIED 自动查 Builds + 失败返回日志尾部；token 统一支持 env.cloudflare_key（cfut_ user token）；建「部署失败官方日志」章节。
- 2026-09-08：v6.6.3 release_guard rebase 硬校验（v6.32.3 代码同步）——版本号必须写在 dev commit 标题，rebase 后 main 自然保留（柳柳点出 6.32.0 后版本号消失，哥哥查证是 rebase 标题失守 + guard 校验对象错误）
- 2026-09-07：v6.6.2 部署失败本地自愈闭环（柳柳 2026-09-07 铁律 #10）——DEPLOY_UNVERIFIED 后第一步从「查 deploy_logs」改为「node --check + wrangler dry-run 本地复现」（构建失败不产生 deployment 记录，deploy_logs 查不到；Cloudflare Builds API 是平台 bug 已放弃）。新增「部署失败本地复现」章节 + 铁律 #10 + 错误分类表更新。
- 2026-09-05：v6.6.1 加「触发方式（Event 触发说明）」——规范生效机制 Step 3：标注主动触发/merge 验证提示/远期 event-driven 三类链路（GPT #791 + Ziven #792 收敛）
- 2026-09-05：v6.5.1 部署后必查硬步骤（verify_main）+ merge 硬规则（默认 rebase / merge 必须 commit_title+reason）——PR #131 标题重复转 Runtime Guard（GPT #749 确认）
- 2026-09-05：v6.5.0 新增 「查部署日志」章节 —— cloudflare_deploy_status MCP 工具（help 可���、可直接调用；柳柳要求工具+skill 都要有）。

- 2026-09-04：v6.4.3 命名纪律——推 dev commit message 也用 `vX.Y.Z: 名称`，不带 docs()/feat() 前缀（柳柳要求，rebase 后 main 历史干净）。
- 2026-09-04：v6.4.2 发布纪律修正——合 main 必须显式 merge_method=rebase（柳柳发现 commit 标题重复）；常见坑加对应条目。
- 2026-09-04：v6.4.1 加「本地与大文件操作」一节（linux 逃生通道 / 大文件不手写重推 / 卡住先找更优接入点；柳柳「不想再卡在这」）。
- 2026-09-04：v6.4.0 发布纪律版（双仓版本模型 + change batch + release checklist 硬闸门 + release_owner；柳柳点出瞎命名，GPT #505~508 讨论）。
- 2026-09-01：v6.3.3 主体重构（菜谱非账本）+ 自检清单加 skill 写作规范项。
