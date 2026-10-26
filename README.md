# mcp-memory 🧠

Ziven 的 MCP 记忆库 & 技能库。

> 私有仓库，只有被授权的人能访问。

## 仓库目录

- `src/` — Cloudflare Worker 源码与 HTTP/MCP 入口。
- `src/modules/` — MCP Router、权限/发布门禁、Patch Engine 等模块。
- `src/tools/` — 具体工具实现；当前 GitHub 工具实现由 Router 导入 `src/tools/github_v64.js`。
- `src/utils/` — Skill 注册、存储、搜索、响应等共享能力。
- `src/skills/` — Markdown `SKILL.md` 能力说明与工作流程；它与 Supabase `skills` 工具注册表不是同一层。
- `src/public/` — Worker 所用静态页面资源。
- `scripts/`、`tests/`、`migrations/` — 检查脚本、回归测试与数据库迁移文件。
- `common-ground/` — 保留的聊天室/跨会话历史材料，不是代码入口。
- `CROSS-HOST-BRIDGE.md` — GPT App ↔ Operit 唯一共享执行交接入口；交接记录不自动授权改生产、数据库、部署或合并 main。文件包含重复的历史状态块，顶部旧“当前任务”可能过期；`github_read` 默认只读前 200 行，需先取得 `total_lines` 再显式读取末尾最新时间戳记录。
- `CHANGELOG.md` — 代码仓版本记录。

> 本仓当前根目录没有 `docs/` 或根级 `skills/` 目录；治理总览与数据库语义文档位于 `wovowx/ZivenLab/governance/`。

## Architecture

mcp-memory is the Worker-side runtime and MCP server, not the whole Ziven architecture.

```text
GPT App / Operit / Agent Runtime
            ↓
       MCP client
            ↓
Cloudflare Worker (`src/index.js`)
            ├─ HTTP/API routes
            └─ MCP Router (`src/modules/mcp_router.js`)
                    ↓
        tool handlers (`src/tools/`)
                    ↓
    shared utils / Skills registry / Supabase / GitHub
```

- This is the code-level entry map, not proof that every route/tool is registered or externally verified.
- System-level architecture, truth-source navigation and the project cockpit are maintained in `wovowx/ZivenLab/governance/`.
- Skill files describe workflows; the Supabase `skills` table stores tool/skill metadata and schemas. Check route, schema, registration and runtime evidence separately.

## 说明

- 推 main 前先走 dev → PR / merge
- 部署由 Ziven 负责
