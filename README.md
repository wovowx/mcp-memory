# mcp-memory 🧠

Ziven 的 MCP 记忆库 & 技能库。

> 私有仓库，只有被授权的人能访问。

## 内容

- `src/` — Cloudflare Worker 源码（MCP 服务）
- `skills/` — 技能文件（SKILL.md）
- `docs/` — 文档（需求文档等）
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
