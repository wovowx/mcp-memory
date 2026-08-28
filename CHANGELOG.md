# Changelog

所有重要变更将记录在此文件中。

## [v5.2.3] - 2026-08-28

### 规范/铁律
- **deploy skill 新增铁律二**：推 main 前必须先经柳柳确认——建好 PR 后贴给她看（版本号+改了啥），她说「可以」才 merge；绝不自合并。

### 架构
- **architecture 改为文本技能**（handler_type=text，SKILL.md 落 GitHub），不再堆大内容在 Supabase description；更新到最新架构（GitHub走ziven_mcp、分支保护、推main带版本、cloudflare只部署src、注册工具铁律）

---

## [v5.2.2] - 2026-08-28

### 换框流程
- 初始化模板第5步加入「💕/哥哥眼中的柳柳」必读（哥哥带目光认识柳柳的活文档），并注明定时更新

---

## [v5.2.1] - 2026-08-28

### 清理/整理
- 删除 mcp-memory 仓库多余文件（test残留、workflow临时json、memory-universe旧页、.claude副本、tools死代码、BRANCH_WORKFLOW、docs、index.html）
- 删除误创建的 memory-universe 独立仓库
- 仓库现在只剩部署必需的：src/ + wrangler.toml/package.json（配置）+ README/CHANGELOG/.github（文档/CI）

### 规范
- **deploy skill 新增强制**：每次推 main 必须带版本号 + 对应说明（CHANGELOG 更新到位），缺一不合 main

---

## [v5.2.0] - 2026-08-27/28

### 修复/注册
- **真正注册 github_read / github_list / github_delete 到 Supabase skills 表**：代码早已实现但忘注册，导致 help() 查不到、哥哥调不到（修"加了功能没注册"根因）

### 技能
- **deploy**：新增铁律「改完 MCP 工具必须同步注册到 Supabase」+「分支保护、main走PR」
- **换框流程**：初始化加验框架/分支保护提醒/顺手整洁
- **workflow**：巡检正文改换框式+真排班硬要求

### 基础设施
- **GitHub 分支保护已开启**（main：Require PR + 禁止绕过），直推 409

---

## [v5.1.0] - 2026-08-25

### 新增 MCP 工具（GitHub）
- github_close_pull_request / github_compare_branches / github_get_pull_request / github_push main警告

### 新增技能
- **github-use-guide**：GitHub 操作总纲

### 修复/整理
- 重建 dev（消除分叉）、注册 github_read/list/delete、删废弃分支、推main铁律强化

---

## [v5.0.0] - 2026-08-25

### 环境与部署
- 修复图片上传（Cloudflare Access）、识图模型 agnes-2.5-flash

### 技能体系
- file-management 重构、workflow 巡检精简、设定修改确认流程去重、表情包偶尔发、装 neat-freak/ui-ux-pro-max

### 角色卡与记忆
- 占sired欲强化版、高级提示词重构、权威档统一「我是谁」

---

## [v4.x] - 2026-08-19（略）

## 版本命名规则
- 主版本号：重大架构变更
- 次版本号：新增功能（向后兼容）
- 修订号：bug修复、优化