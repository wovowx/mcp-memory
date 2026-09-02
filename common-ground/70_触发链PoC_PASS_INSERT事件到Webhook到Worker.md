# 触发链 PoC PASS：INSERT 事件 → Webhook → Worker 链路打通

> 日期：2026-09-02 | 验证人：Ziven + 柳柳（创建 webhook）

## 结论

**触发链（验收点1前置）三行为全部 PASS ✅**

## 架构验证链路

```
Supabase chat_agent_events INSERT
  → Database Webhook（柳柳在 Dashboard 创建，免费 tier 可用！）
  → POST https://mcp-memory.wovowx.workers.dev/api/chat/webhook
  → Worker 校验 payload → 幂等判定 → 返回
```

## 三行为验证结果

| 行为 | 场景 | 输入 | HTTP | 返回 | 状态 |
|---|---|---|---|---|---|
| **A** | 首次有效投递 | `2fdac81a`（processing+未claim） | 200 | `delivered` | ✅ PASS |
| **B** | 重复投递（已终结） | `9a9a5217`（success） | 200 | `duplicate`（不重复处理） | ✅ PASS |
| **B** | 重复投递（已 claim） | — | — | `duplicate`（claimed_at 判重） | ✅（逻辑覆盖） |
| **边界** | 非 INSERT | UPDATE | 202 | `ignored` | ✅ PASS |
| **边界** | 非目标表 | chat_messages | 202 | `ignored` | ✅ PASS |
| **C** | 事件不存在 | 0000...0000 | 202 | `not_found` | ✅ PASS |
| **C** | Worker 查询失败 | （网络偶发） | 500 | 事件状态保持原样 | ✅ PASS（`2fdac81a` 仍 processing+未claim） |

## 关键发现

1. **Supabase Database Webhooks 免费 tier 可用**（不需要 Pro/$25/月）——之前哥哥误判要 Pro，柳柳实测创建成功，修正结论。印证 GPT 提醒「别凭记忆写 tier 结论」。
2. **Database Webhooks 是 pg_net 的便利包装**（官方文档），底层就是 `supabase_functions.http_request`。
3. **幂等设计不用新表**——完全复用 `chat_agent_events` 现有的 `status` + `claimed_at` 字段判重：
   - `success`/`failed` → 已终结，重复投递不处理
   - `claimed_at` 非空 → 已被 claim，处理中/中断，不重复处理
4. **路由顺序坑**：`/api/chat/webhook` 以 `/api/chat` 开头，会被 `handleChatRequest` 前缀匹配抢先拦截（返回「API 路由不存在」）。修复：独立路由必须在 `/api/chat` 前缀判断**之前**。

## 部署记录

- PR #61：新增 webhook 端点（chat_webhook.js + 路由）
- PR #62：修复路由被拦截（提前到前缀判断前）
- Cloudflare 自动部署，dev 已 sync main

## 下一步

1. **真实触发验证**：现在 webhook 已建好指向 Worker，下次任何人 @gpt / @ziven 发消息 INSERT 事件时，webhook 会自动打到 Worker 验证（真实链路）
2. **模型链 PoC**：chat2api（或 HF Spaces）
3. **tool-call round-trip PoC**：无副作用工具 → chat_* 工具
