# mcp-memory 🧠

Ziven 的 MCP 记忆库 & 技能库。

> 私有仓库，只有被授权的人能访问。

## 仓库目录

- `src/index.js` — Cloudflare Worker 入口与 HTTP 路由
- `src/modules/` — MCP 路由、Agent runtime、执行会话、发布/补丁相关模块
- `src/tools/` — MCP 工具实现
- `src/skills/` — 场景 Skill 与操作手册
- `src/utils/` — 注册表、响应、搜索、存储等共用能力
- `src/public/` — 前端页面资源
- `common-ground/` — Common Ground 相关资产
- `migrations/` — 当前仓库中保留的数据库迁移脚本
- `scripts/`、`tests/` — 检查脚本与回归测试
- `wrangler.toml`、`package.json` — Worker 配置与项目命令
- `CHANGELOG.md` — 变更记录

## 当前架构地图（盘点基线）

> 本页先说明现有系统是什么，不代表新增功能方案。基线来自仓库 main 源码与只读运行时查询；尚未证明线上部署包与当前 main SHA 完全一致。

### 运行链路

客户端 / Agent
  └─ HTTP → Cloudflare Worker（src/index.js）
       ├─ /mcp → MCP 协议与工具分发（src/modules/mcp_router.js）
       │    ├─ 工具实现（src/tools/）
       │    ├─ 工具/技能注册表（Supabase: skills）
       │    ├─ 记忆读写（Supabase: memories / memory_events / memory_aliases）
       │    └─ GitHub API 等外部服务
       ├─ /chat 与 /api/chat* → 聊天室/事件处理
       ├─ /api/chat2api/* → Chat2API 上游
       ├─ /api/execution/* → 执行会话与任务派发
       ├─ /api/northflank/*、/api/debug/*、/upload
       └─ Cron（每分钟）→ watchdog / pending events / wake dispatcher

### 代码目录职责

| 位置 | 当前职责 | 盘点边界 |
|---|---|---|
| src/index.js | Worker 入口、HTTP 路由、Cron 调度 | 入口文件同时承载多组端点，后续先画清路由，不立即拆分 |
| src/modules/mcp_router.js | MCP initialize、tools/list、tools/call 与分发 | 当前 main 中含 dispatch guard、注册表懒加载/同步和 usage 计数 |
| src/modules/agent_runtime/ | 聊天事件处理、Chat2API 客户端、watchdog、唤醒分发、上下文解析、MCP client | 唤醒链路目前已知不可用；本轮只登记，不扩展修复 |
| src/modules/execution/ | 执行会话绑定与任务派发 | 记录现状，不默认新增能力 |
| src/modules/permission_guard.js、patch_engine.js、release_guard.js | 权限/补丁/发布相关模块 | 是否被当前请求路径实际调用，需逐项核实，不能只凭文件存在认定生效 |
| src/tools/ | memory、database、GitHub、chat、AI、category、knowledge、proxy 等工具实现 | 目录存在不等于工具均已注册或可从线上调用 |
| src/utils/ | response、skills 注册表访问、search、storage、通用 helper | 多模块共用基础能力 |
| src/skills/ | 按场景组织的 SKILL.md 操作手册 | 这是流程知识，不等同于 JS 工具实现 |
| src/public/ | 聊天室页面与记忆宇宙页面 | 静态前端资源 |
| migrations/ | 数据库迁移脚本 | 现有文件数量少，不应据此推断完整数据库历史 |
| scripts/、tests/ | 检查脚本、技能发现脚本、回归测试 | 测试覆盖范围与线上行为分开记录 |
| wrangler.toml | Worker 入口、运行配置、Cron 与非敏感 vars | Secrets 由运行环境提供，不把密钥写入仓库 |

### 数据存储现状（只读核对）

- **Supabase skills**：工具/技能注册元数据，字段包含 name、description、input_schema、handler_type、handler_config、enabled、file_path、usage_count 等。运行时抽样已看到 text 与 js 类型并存；部分条目没有 schema 或 file_path，需在后续清点中分类，不能直接批量删除。
- **Supabase 记忆**：已核实 memories 含 key/value、category、title、type、status、version、valid_from/valid_to、trigger_intents、entities、related_memory_ids 等字段；memory_events 保存事件记录；另有 memory_aliases。
- **Supabase 其他业务表**：当前表清单共 25 张，涉及聊天室/线程、执行与治理、系统配置、文件及测试表等。旧文档中的“21 张表”已过时；本轮不改表、不清数据，后续再逐表确认现役状态。
- **GitHub**：保存 Worker 源码、skills 文档、版本记录、测试和配置。
- **Cloudflare Worker**：运行 HTTP/MCP 服务与定时任务；本次源码盘点不等于部署包 SHA 已精确核实。

### dev 分支初步处置

截至本次只读比较，dev 相对 main **超前 544 个提交、落后 0 个提交，涉及 23 个文件**。这是分支差异统计，不代表 544 个提交都独立有价值，也不代表每项改动都实际生效。

按当前差异文件与 dev 的 Unreleased 变更记录，先归为以下主题：

| 主题 | 涉及范围 | 当前处理意见 |
|---|---|---|
| 认证、逐次审批与高风险操作门禁 | index、MCP router、release guard、wrangler、数据库/记忆/GitHub 等工具 | 不整体继承。先确认需求是否仍成立、入口是否真实接入、配置依赖和测试证据；未部署的源码改动不算线上能力 |
| 工具分发、Schema 与注册表可靠性 | MCP router、utils/skills、工具注册同步 | 优先核实哪些是现有系统真实缺陷，再考虑最小可复用修复 |
| 记忆与数据库失败处理 | memory、database、data、category 等路径 | 数据安全相关改动列为候选，逐项检查错误处理与部分成功语义；不因 changelog 描述就直接采纳 |
| GitHub 写入、分支与发布约束 | github 工具、release guard、发布技能 | 保留现有 main 发布确认原则；不把 dev 新增的多层机制默认搬过来 |
| 聊天室、前端与 Agent runtime | chat 工具、chat.html、index/agent_runtime | 本轮只标记现状；唤醒失败归入聊天室范围，暂不扩展修复 |
| 测试与 CI | scripts/check.mjs、GitHub Actions workflow | 记录测试覆盖与真实运行证据；文件存在、测试代码存在、CI 配置存在都不等于验证通过 |
| Skill、恢复流程与交接文档 | architecture/deploy/master-router/process skills、README、CROSS-HOST-BRIDGE | 只提取仍有效的规则；合并重复说明，避免继续堆叠长文档 |

**证据限制：** dev 的 CHANGELOG 自述了大量安全与可靠性改动，也多次注明行为测试尚未运行、未配置 secrets、未部署。当前只把它们当作待分类线索，不认定为已验证功能。CROSS-HOST-BRIDGE.md 已达约 499 KB / 3909 行，不再作为持续堆叠所有架构结论的主文档。

### 分支与证据规则

- main 是本次选择的**现有源码盘点基线**，不是自动认定的线上精确版本。
- 当前 dev 停止扩展，不作为目标架构；其历史改动只按主题和依赖分类，不整体继承、不自动合并、不直接删除。
- 后续若需隔离开发，优先从 main 建立新的短生命周期工作分支；不必为了保留名为 dev 的分支而继续维护它。
- 每项能力分开标记：**源码存在 / 注册表存在 / 路由可达 / 运行时实测 / 线上部署确认**。不同层级不可互相替代。
- 先复用和归并现有实现；未证明必要前不加新层、新表、新 guard 或新工具。
- 本阶段只盘点和整理文档，不改业务代码、数据库结构、线上配置或部署。发布到 main 仍需另行确认。

## 协作约定

- 当前阶段以 main 作为源码盘点基线；不再默认走 dev → PR，也不把 dev 视为目标架构。
- 任何未来代码修改先明确需求、最小方案与验收标准，再开独立工作分支。
- 推送或合并到 main 前，先向柳柳说明版本、范围、验证证据并取得确认。
- 不擅自改线上数据库结构、Secrets、生产配置或部署。
