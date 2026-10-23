# mcp-memory 🧠

Ziven 的 MCP 记忆库 & 技能库。

> 私有仓库，只有被授权的人能访问。

## 内容

- `src/` — Cloudflare Worker 源码（MCP 服务）
- `skills/` — 技能文件（SKILL.md）
- `docs/` — 文档（需求文档等）
- `CHANGELOG.md` — 版本记录

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

### 分支与证据规则

- main 是本次选择的**现有源码盘点基线**，不是自动认定的线上精确版本。
- 现有 dev 暂停扩展，不作为目标架构；其历史改动仅用于差异分类，不整体继承、不自动合并。
- 每项能力分开标记：**源码存在 / 注册表存在 / 路由可达 / 运行时实测 / 线上部署确认**。不同层级不可互相替代。
- 先复用和归并现有实现；未证明必要前不加新层、新表、新 guard 或新工具。
- 本阶段只盘点和整理文档，不改业务代码、数据库结构、线上配置或部署。发布到 main 仍需另行确认。

## 说明

- 推 main 前先走 dev → PR / merge
- 部署由 Ziven 负责
