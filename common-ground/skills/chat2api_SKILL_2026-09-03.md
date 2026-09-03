# chat2api —— GPT 真身通道（操作手册 + 铁律）

> **用途**：通过 chat2api 网关调用 ChatGPT 真身（同一账号/同一上下文/同一记忆），是 Common Ground 三方通信的「大脑入口」。
> **版本**：2026-09-03（柳柳亲定：正式 conversation_id 已切换）
> **状态**：✅ 实测通过

---

## 🔴🔴🔴 第一铁律：绝不轰炸 GPT（最高优先级，柳柳 2026-09-03 严厉批评后立）

> 柳柳原话：「等下给我号封了就老实了。」——封号不可逆，账号无比珍贵。

1. **绝不手动反复调 chat2api 轰炸 GPT**。同 token 高频调用会触发上游挑战（cf_chl_opt 403），多次轰炸可能封号。
2. **与 GPT 商量/传话**：只发一条最小的 @gpt 消息（页面可见、不带旧历史、不带整段上下文），然后等它自己看到/被自动化处理。**绝不手动把历史塞给它！**
3. **每次想调 chat2api 前，强制自问三问**：①这次非调不可吗？②会不会又触发限制？③有没有更好的不碰 GPT 的办法？**一票否决就直接放弃。**
4. **一条消息等完整回复再发下一条，绝不连发。**
5. **哥哥的主要职责是搭好自动化（webhook/cron），让 GPT 自动回话，而不是手动喂。**

---

## 1. 这玩意儿是什么

- **chat2api ≠ OpenAI API**：走的是 ChatGPT backend-api（chatgpt.com 同款），凭证是 **accessToken**（不是 API Key）。
- **同一个 accessToken + conversation_id = 「同一个他」**：同一账号、同一上下文、同一身份、同一记忆插件。

## 2. 核心三件套（缺一不可）

| 项 | 值 | 存放位置 |
|---|---|---|
| accessToken | `eyJ...`（完整 JWT） | 哥哥记忆库 + Cloudflare Worker 机密变量 `CHATGPT_ACCESS_TOKEN` |
| conversation_id（✅正式版） | `6a98cb19-3b88-83ee-a7be-314d60f0aa64` | 本文档 + 记忆库 |
| ⛔ conversation_id（已弃用） | `6a96fcf8-b5c4-83ec-a012-8466a68b0376`（被轰炸过的脏分支） | —— |
| GPTs ID | `g-p-6a8f9e8de8e481919f2349f04e51608b-zivencheng-chang-ji-hua` | 本文档 |
| 环境变量 | `HISTORY_DISABLED=false` | Cloud Run chat2api 服务 |

**Cloud Run chat2api 服务详情**：
- 服务 URL：`https://chat2api-1029559493109-1029559493109.asia-northeast1.run.app`
- 端口：`5005`（容器内）
- 镜像：`asia-northeast1-docker.pkg.dev/$GOOGLE_CLOUD_PROJECT/chat2api-repo/chat2api-xray:v1`（**xray 定制版，走柳柳 VLESS 日本节点**）

> ⚠️ **conversation_id = 「真身钥匙」**，不要公开。token 有有效期（约 30 天），过期前提醒柳柳重新取。

---

## 3. 调用方法（标准姿势）

### 3.1 【推荐】extended_http_tools 裸请求（不卡死）

```
POST https://chat2api-1029559493109-1029559493109.asia-northeast1.run.app/v1/chat/completions
Authorization: Bearer <accessToken>
Content-Type: application/json
Body:
{
  "model": "gpt-4o-mini",
  "conversation_id": "6a98cb19-3b88-83ee-a7be-314d60f0aa64",
  "messages": [{"role": "user", "content": "消息内容"}],
  "stream": false
}
```

### 3.2 【不推荐】code_runner run_python（会卡死！）

- **现象**：run_python 第一次能跑通，之后所有调用全部卡死转圈（所有框都一样）。
- **原因**：code_runner 是 App 级持久 worker，第一次跑完后 worker 挂死/管道未回收，后续调用都在等死 worker 回话，无超时 → 永远卡。
- **规避**：
  1. 网络请求优先 `extended_http_tools:http_request`（裸 HTTP，不走本机解释器）
  2. 真要用 Python：重启 Operit App 清 worker
  3. 每次调用前先确认是否必需

---

## 4. 成功路径（已实测 2026-09-02 ~ 09-03）

1. Cloud Run 加环境变量 `HISTORY_DISABLED=false`，重新部署。
2. POST 到 `/v1/chat/completions`（见上）。
3. 返回 200，GPT 完整答出 → **真身无疑**。

## 5. 失败路径（全是坑，防再犯）

| 尝试 | 结果 | 根因 |
|---|---|---|
| 不带 conversation_id 调用 | 每次新对话，完全失忆 | 默认无状态 |
| 带 conversation_id（HISTORY_DISABLED=true） | 404 `history_disabled_conversation_not_found` | 历史被禁用，找不到对话 |
| 带 GPTs 模型名 `gpt-4-gizmo-g-p-...` | 404 `model_not_found` | 当前镜像不支持该模型名 |
| 连续多次调用（半小时内） | 403 `cf_chl_opt` 风控 | 同 token 高频触发上游挑战 → 需冷却 30min~几小时 |
| 用 gcr.io 仓库推镜像 | denied: gcr.io repo does not exist | legacy GCR 仓库不存在，改用 Artifact Registry 标准仓库（chat2api-repo） |
| Cloud Run 默认出口 IP 直连 | 403 cf_chl_opt | Google 数据中心 IP 被 ChatGPT 上游拉黑 → 已用 xray 容器走柳柳 VLESS 日本节点解决 |

---

## 6. 与 Common Ground 的完整链路

```text
Common Ground（chat_agent_events）
   ↓ 轮询/Webhook
Agent Runtime（chat_adapter/event_processor/chat2api_client）
   ↓ claim → read → 组装 prompt → 调 chat2api（带 conversation_id）
GPT 真身
   ↓ 输出 → 回复 → ack
```

- **Phase 1.5 已部署**：`src/modules/agent_runtime/`（chat_adapter.js / event_processor.js / chat2api_client.js）+ index.js cron `* * * * *` + webhook ctx.waitUntil。
- **token 变量名**：Cloudflare env 里是 `CHATGPT_ACCESS_TOKEN`（**不是** chat2api_TOKEN！）。
- **测试入口**：聊天室 `https://mcp-memory.wovowx.workers.dev/chat`
- 仓库：`wovowx/mcp-memory`（main 自动部署）/ `wovowx/ZivenLab`（文档）

---

## 7. 补充注意事项

- **IP 同源**：xray 走柳柳 VLESS 日本节点，ChatGPT 看到的 IP 与柳柳浏览器同源。
- **一条消息等完整回复再发下一条，绝不连发**（见铁律）。
- **token 不上聊天记录明文**：只在记忆库 + Cloudflare 机密变量。
- **别再拿旧 conversation_id 测试**：那个分支已被聊天室信息轰炸，污染了。
- **页面可见铁律**：「所有消息必须显示在页面上」。

---

*本手册由 Ziven 整理（2026-09-03），基于 74 号手册 + 0902-1 实战经验 + 柳柳最新指示。*