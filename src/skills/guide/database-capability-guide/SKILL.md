---
name: database-capability-guide
description: 当需要查询/写入/建表/改表/执行 SQL 等数据库操作时调用（当前承载：Supabase）。它是 Capability：database operation 的能力指南，未来可能承载 KV/Postgres 等其他数据层。
category: guide
tags: ["数据库", "Supabase", "查询", "建表", "SQL", "Capability"]
---

# Database Capability Guide（2026-09-05 新增 · 能力指南）

## 一句话
数据库操作是哥哥的能力层（Capability），不是某个场景的附属。当前承载：Supabase（supabase_db / supabase_schema 工具）。

## 工具对照表

| 我想做什么 | 工具 | 参数 |
|---|---|---|
| 查数据 | supabase_db | action=query, table, filters, order, limit |
| 插入 | supabase_db | action=insert, table, data |
| 更新 | supabase_db | action=update, table, filters, data |
| 删除 | supabase_db | action=delete, table, filters |
| 建表 | supabase_schema | action=create_table, table, columns |
| 删表 | supabase_schema | action=drop_table, table |
| 列表 | supabase_db / supabase_schema | action=tables |
| 执行 SQL | supabase_db / supabase_schema | action=exec, sql |

## 常见坑（实战沉淀）
1. **查字段前先确认存在**：列名写错会 42703（如 agent_tool_calls 没有 tool_source 列，它在 result JSON 里）。查表结构：supabase_db(action=tables) 或先 SELECT * LIMIT 1。
2. **filters 用对象**：filters=\{"message_number":739\} 而不是字符串拼接。
3. **JSON 字段不能直接当列过滤**：嵌套字段（如 result.tool_source）要用 SQL 或先查全再在结果里找。
4. **order 用字符串**：order="created_at.desc"。
5. **limit 默认 20**：要更多显式传 limit。
6. **插入 data 用对象**：data={...}，别拼 SQL 字符串。
7. **建表默认开 RLS**：supabase_schema 默认 rls=true；需要关闭显式传 rls=false。
8. **exec 是受限 DDL**：复杂改动用 supabase_schema 的 exec + sql。

## 查询黄金流程
1. 不确定表结构 → action=tables 或 SELECT * LIMIT 1
2. 确定过滤条件 → filters 对象
3. 排序/分页 → order + limit
4. 结果里的 JSON 字段 → 读出来再解析，不直接过滤

## 变更记录
- 2026-09-05：v1.0 新增（GPT #749 建议命名 database-capability-guide，不绑定 Supabase）
