# Changelog

所有重要变更将记录在此文件中。

## [v6.17.0] - 2026-09-05

### Changed（发布流程硬约束化 · PR #131 标题重复转 Runtime Guard）
- **merge 策略默认化**：github_merge_to_main / github_merge_pull_request 的 merge_method 默认改为 rebase（不传不再走 merge → 标题不再重复）
- **merge 必须显式说明**：显式 merge 必须带 commit_title + merge_reason（hotfix/emergency/history-preserve），否则拒绝（MERGE_REQUIRES_COMMIT_TITLE / MERGE_REQUIRES_REASON）——核心修复是「不允许发布策略含糊」（GPT #749）
- **deploy verification 引入**：cloudflare_deploy_status 新增 verify_main=true 参数——自动对比 main HEAD commit vs 最新部署版本，返回 VERIFIED / DEPLOY_UNVERIFIED
- **Capability Guide 增加**：新增 code-runner-guide（本地执行能力）、database-capability-guide（数据库能力，不绑定 Supabase）
- **部署后必查（柳柳铁律）**：deploy skill 第 6 步 → merge 后 sleep 45s → verify_main 确认；DEPLOY_UNVERIFIED 必须查部署日志分析（?deployment_id / ?include=details）
- skill 同步：deploy v6.5.1 / github-use-guide v6.5.3

## [v6.16.1] - 2026-09-05

### Added（Level 2 · Permission Guard MVP）
- patch_proposals 表（Supabase）：proposal 全生命周期 proposed→reviewed→approved→applied，含 evidence/risk/reviewer/approver/rollback_sha
- permission_guard.js：checkCapabilityAccess 四维校验（Capability+Target+Decision+Evidence）—— read 免费 / write 必须 approved proposal / main 永禁 / 非 dev deny / evidence 必填 / risk 分级（low=proposal / medium=+review / high=+柳柳确认）
- executeTool 接入 guard：GPT 发 github_push/merge 必须先过检查（受控对象硬闸门）
- 单测 10/10 通过（permission_guard）；负向验证 #735（无 proposal push → missing_proposal 拒绝，tool_source=permission_guard）
- README Architecture Proposal #448de374 全流程闭环：proposed→approved（ziven review+liuliu 确认）→applied（ziven 推 dev）

## [v6.16.0] - 2026-09-05

### Added（Permission Guard MVP 前置）
- patch_proposals 表建表 + README Architecture 提案入库（id=448de374）

## [v6.15.0] - 2026-09-05

### Changed（Level 2 Step 1 · MCP-only 强制）
- github_read 移除 Worker 内本地实现（fetch GitHub），强制走 MCP dispatcher → tool_source=mcp 铁证（#729）
- GPT 基于真实 README 内容产出 2 条 Patch Proposal（Level 2 Step 1 通关）

## [v6.14.6] - 2026-09-05

### Changed（GPT 认知壁垒突破）
- buildSystemPrompt 强化：明确「文本标记就是调用方式，Worker 是你的执行手，不需要持有工具入口」+ 列出已挂载工具名 + 禁止先询问可用性
- 效果：GPT #723 输出 echo 标记 → #725 ds_quota（tool_source=mcp）→ Capability Invoked 稳定可复现

## [v6.14.5] - 2026-09-05

### Fixed（parser 截断容错）
- extractJsonObject 滑动截断 + 补右花括号：chat2api 网关截断复杂 JSON 尾巴时的容错（7/7 单测通过）
- parser 对「解释文本+工具块混合/缺闭合」容错（#707/#709 实测）

## [v6.14.4] - 2026-09-05

### Changed（parser 失败明确标记）
- 解析失败不再伪装 echo：明确输出 __parse_error__ 标记（GPT #737/#739 诊断一致性）

## [v6.14.3] - 2026-09-05

### Added（部署日志增强 · 柳柳要求）
- deploy-status 端点增强：?deployment_id 查单次部署日志 / ?include=details 批量详情
- 部署排查 SOP 沉淀（v6.14.1 部署失败根因：反斜杠字面量损坏）

## [v6.14.2] - 2026-09-05

### Fixed（构建失败 10021 修复）
- extractJsonObject 反斜杠字面量 '\' 在传输中被损坏成非法 token → 改用 charCodeAt(0)===92 判断（#335 恢复部署）

## [v6.14.1] - 2026-09-05

### Fixed（parseToolCalls 鲁棒性 · Level 2 Step 1 实测暴露）
- extractJsonObject 智能提取：brace 配对 + 字符串感知（跳过字符串内 {} 与转义），忽略前置解释文本
- 完整标记内部也走 extractJsonObject（标记内夹文本也鲁棒）
- 无闭合标记容错改用 extractJsonObject（不再假设标记从行首开始）
- 修复 GPT 输出「解释文本+工具块混合/缺闭合」时 fallback echo（#707/#709 实测）

## [v6.14.0] - 2026-09-05

### Added（工具循环拆两段 B 方案 · 异步结论队列）
- 事件1（工具执行）：第一轮 chat2api → 工具调用 → Worker 执行 → audit/trace 落库 → 排结论任务 → 秒级 ack 闭环
- 结论任务（独立）：scheduled 扫 agent_tool_conclusions 表 pending → 独立 25s 预算生成自然语言结论 → sendMessage 写回
- 新表 agent_tool_conclusions（status: pending→processing→done/failed，重试×3 兜底）
- runToolLoop 返回 pendingConclusion 标记：pendingConclusion 时本事件不落库（结论异步写回）

## [v6.13.1] - 2026-09-05

### Fixed（chat2api tools 有损修复）
- 不再传 tools 参数（能力注入改回 prompt 文本，绕开 chat2api 网关截断原生 tool_call 问题 #695/#697）
- parseToolCalls 加容错：不完整标记自动补全、裸 JSON 保守解析（6/6 单测通过）
- capabilityTrace 加 injection_mode 标注真实注入方式

## [v6.13.0] - 2026-09-05

### Fixed（工具循环 wall-clock 预算管理）
- runToolLoop 加 27s 总预算（剩 3s 落库+ack），第一轮 22s、第二轮 8s
- 预算不足直接兜底（不再请求第二轮），保证落库+ack 在预算内
- capability_trace 提前到工具执行后立即落库（不等最终答复）
- chat2api_client 超时可配置（timeoutMs）

## [v6.12.1] - 2026-09-05

### Fixed（工具循环稳定性）
- chat2api 加 30s 超时（fetchWithTimeout AbortController）
- 工具循环第二轮失败用工具结果摘要兜底（不让事件烂在 processing）

## [v6.12.0] - 2026-09-05

### Added（Level 1 Capability Injection MVP）
- chat2api_client 支持 OpenAI tools 参数（MCP 能力以结构化工具声明注入）
- event_processor buildSystemPrompt/runToolLoop 把 MCP read 工具转 function schema 每轮传入
- capability_trace（discovered/filtered/injected/invoked/tool_source）落 agent_tool_calls 审计表
- GPT #691 审查补三点：payload trace、invoked/result 追踪、tools schema 是能力源 prompt 辅助

## [v6.10.2] - 2026-09-04

### Fixed（发布纪律修正 · 柳柳发现标题重复）
- 修正发布流程：合 main 必须 `merge_method=rebase`（不用默认 merge，否则 GitHub 把 commit_title 写两遍 → 标题重复）
- deploy skill v6.4.2：自检清单加「合并用 rebase + commit_title」，常见坑加「merge 不用 rebase → 标题×2」
- CHANGELOG 与线上对齐：v6.10.0（构建失败）→ v6.10.1（线上）→ v6.10.2（本次文档修正）

## [v6.10.1] - 2026-09-04

### Fixed（Release Guard 构建修复 · 已上线）
- release_guard.js v1.2.1：自测块 `typeof process` 防御（Cloudflare Worker 无 Node process，直接引用 process.argv 导致构建失败 code 10021）
- 线上当前运行版本（已验证 RELEASE_GUARD 真实拦截未版本化 push main）

## [v6.10.0] - 2026-09-04

### Added（Release Guard 入口接入 · Runtime 硬闸门）※ 本版构建失败，已由 v6.10.1 取代
- release_guard.js v1.2 落地为入口层硬闸门：src/index.js github_ 分支前置校验（不动 45KB github_v64.js）
  - github_push / github_merge_to_main / github_merge_pull_request 到 main 全部硬拦截
  - 未版本化发布 → ⛔ RELEASE_GUARD 阻断，不依赖记性（柳柳「放在角色卡也没用」→ 系统强制）
  - unknown repo 拒绝 / release policy 配置化 / docs 正则收紧 / repo normalize（GPT #528/#530 review）
- deploy skill v6.4.1：新增「本地与大文件操作」经验沉淀
  - linux 通道 = Shizuku 逃生通道（android 读本地失败时用 environment=linux + /sdcard/...）
  - 大文件禁止手写整份重推（45KB 必漏段，42643/45950 教训）
  - 卡死在单文件先找更优接入点，不绕圈子

### Changed
- 接入策略：release_guard 不改 github_v64.js（45KB 整文件替换风险高），改为小文件入口层加前置闸

### Fixed
- 大文件卡死循环：github_v64.js 重建漏段 → 用 github_copy 恢复干净原版，改走 index.js 入口接入

## [v6.9.0] - 2026-09-04

### Added
- 发布纪律（Release Discipline）双仓版本模型
  - mcp-memory（代码仓）→ 语义化版本 vX.Y.Z
  - ZivenLab（文档仓）→ 知识快照 docs-YYYY.MM
- change batch 概念：多个相关 commit 形成可交付主题才定版本
- release_owner 字段：明确谁判断「这批构不构成版本」
- 驾驶舱新增「发布与版本状态」章节
- ZivenLab 新建 common-ground/CHANGELOG.md（docs-2026.09 baseline）

### Changed
- deploy skill v6.4.0：发布纪律版，release checklist 硬闸门（不过不推 main）
- github-use-guide v6.5.0：Git 纪律版，deploy/github-use-guide 分层

### Fixed
- 历史 PR 无版本化问题：为当前状态建立基线快照，不回溯伪造版本

## [v6.8.0] - 2026-09-04

### Added（Event Runtime Reliability Phase1）
- delivery_status 事件生命周期状态机（created/claimed/delivering/delivered/processing/acked/failed）
- watchdog 独立模块：自动释放卡死 stuck claim，15min 超时保守策略
- retry×3 进 dead_letter 路径
- agent claim isolation（claimed_by 责任绑定，防多 Agent 错配）

### Fixed
- 事件所有权模型错误：chat_adapter.js 硬编码 gpt，ziven 事件无消费链（Phase2 解决消费链）
- 4 条历史 stuck claim 事件被 watchdog 自动释放（运行验证通过）

