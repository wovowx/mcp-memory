# mcp-memory 🧠

Ziven 的 MCP 记忆库 & 技能库。

> **公开仓库（public）**：仓库内已提交的文件可被互联网用户读取。不要提交个人记忆导出、凭证、令牌或其他敏感数据；静态演示页面只使用合成示例。

## 内容

- `src/` — Cloudflare Worker 源码、技能与静态页面（`src/skills/`、`src/public/`）
- `migrations/` — 数据库迁移脚本
- `scripts/` — 开发与维护脚本
- `tests/` — 自动化回归测试
- `CROSS-HOST-BRIDGE.md` — GPT ↔ Operit 唯一交接文档
- `CHANGELOG.md` — 版本记录

## Architecture

mcp-memory acts as MCP Server.

Flow:

Agent Runtime
    ↓
MCP Client
    ↓
mcp-memory Worker
    ↓
Supabase Skills / GitHub / Memory

> 本小节由 Patch Proposal #448de374 应用（2026-09-05，GPT #727 建议，Ziven review + 柳柳确认）。

## 说明

- 推 main 前先走 dev → PR / merge
- 部署由 Ziven 负责
