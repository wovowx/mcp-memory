# Changelog

所有重要变更将记录在此文件中。

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

## [v6.3.4] - 2026-09-01

### 强制路由执行铁律（柳柳点醒）
- **根因**：强制路由只卡了「必须调用 help()」这个动作（hasCalledHelp 守门员），没强制「调用后必须读对 skill 再动手」
  - 发图事件暴露：哥哥凭印象瞎试 read_file 多轮，才想起读 image_upload skill
- **master-router 新增执行铁律**：遇到任何场景，第一动作 = 读对应 SKILL.md，读完才允许动手调工具；不凭印象
- **语义边界**：系统路由没问题（场景速查表里白纸黑字写着柳柳发图→多媒体处理→agnes），问题在执行者没走路由；铁律=把执行者也绑进路由

## [v6.3.3] - 2026-09-01

### 技能写作规范（柳柳发现：skill 被记成错题本）
- **根因**：每次踩坑就往 skill 追加「教训/反例」，从不消化成正确流程 → 主体被淹没（deploy/github-use-guide 重度）
- **architecture 新增《技能写作规范》**：所有 skill 的标准骨架（一句话/适用场景/主体流程/关键原则/常见坑≤5/变更记录）+ 三条铁规则（主体优先、教训必压缩、追加先回归）+ 体检信号
- **deploy 主体重构**：发布主流程 SOP 立起（柳柳确认→版本化→建PR→合并→验证），教训压缩成精简版
- **github-use-guide 主体重构**：工具对照表 + 关键红线为主
- **master-router 清补丁墙**：步骤重排连续编号（去 0.5/5.5），去重复段落
- **deploy 自检清单 +1**：改过 skill 必须按写作规范骨架
- **CHANGELOG 修复**：v6.3.3 记录初推时因读取截断丢了下半历史，找回 main 完整原文后重推（含 v5.3.x 及版本命名规则）