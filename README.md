# mcp-memory 🧠

Ziven 的 MCP 服务与长期记忆/工具路由 Worker。

## 仓库目录（以当前 dev 实际目录为准）

- `src/` — Cloudflare Worker 实现
  - `index.js` — HTTP 路由、Worker fetch/scheduled 入口
  - `modules/` — MCP Router、执行会话、运行时与治理模块
  - `tools/` — MCP 工具处理器
  - `utils/` — 搜索、响应、存储、Skill 注册等共享工具
  - `skills/` — Markdown Skill 文件；与 Supabase 的 `skills` 工具注册表不是同一资产集合
  - `public/` — 静态页面资产
- `tests/` — 测试脚本与学习回归测试
- `migrations/` — 数据库迁移/SQL 资产
- `scripts/` — 检查与维护脚本
- `common-ground/` — 跨宿主/聊天室相关历史资产
- `CROSS-HOST-BRIDGE.md` — GPT App ↔ Operit 的共享交接协议与追加记录
- `.github/` — GitHub 工作流配置
- `package.json`、`wrangler.toml` — Node 脚本与 Cloudflare Worker 配置
- `CHANGELOG.md` — 版本记录

> 当前仓库根目录没有独立的 `skills/` 或 `docs/` 目录；治理文档主入口位于另一个仓库 `wovowx/ZivenLab/governance/`。目录变化后应按真实目录更新本说明。

## Architecture

```text
Agent Runtime / MCP Client
          ↓
mcp-memory Worker (src/index.js)
          ↓
MCP Router (src/modules/mcp_router.js)
          ↓
Tool handlers (src/tools/) + shared utilities (src/utils/)
          ↓
Supabase / GitHub / external services
```

## 协作与发布边界

- 先在 `dev` 整理和核对，再按既有发布流程走 PR / merge。
- 本仓库的 Worker 部署与治理文档发布是不同动作；仅修改文档不等于部署 Worker。
- 不未经明确批准修改生产数据库、部署或合并 main。
- GPT App 与 Operit 的执行能力可能不同；交接任务须记录真实命令、退出码与输出。
