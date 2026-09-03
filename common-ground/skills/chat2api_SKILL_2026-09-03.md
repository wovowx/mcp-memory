# chat2api —— GPT 真身通道（操作手册 + 铁律）

> **用途**：通过 chat2api 网关调用 ChatGPT 真身（同一账号/同一上下文/同一记忆），是 Common Ground 三方通信的「大脑入口」。
> **版本**：2026-09-03 v2（柳柳要求补：配置变更操作手册）
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

## 1. 这是什么

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

### 3.1 【最推荐·不塞token】Worker 转发端点（上线后）

```
POST https://mcp-memory.wovowx.workers.dev/api/chat2api/ask
Body: { "message": "消息内容" }
```

token 只在 Worker 环境变量里，本地一个字符都不带。✅ 这是终态方案（已立项）。

### 3.2 【当前可用】extended_http_tools 裸请求

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

### 3.3 code_runner run_python（✅ 已恢复可用）

- **曾踩坑**：第一次能跑通，之后所有调用全部卡死转圈（所有框都一样）。
- **根因**：App 级持久 worker 挂死/管道未回收，无超时 → 永远卡。
- **✅ 已恢复**：重启 Operit App 后 `print('alive-ok')` 秒回 → 可正常跑脚本。
- **以后动作**：能用 run_python 就直接用，别因旧失败记忆绕开它；万一再卡 → 重启 Operit 清 worker。

---

## 4. 配置变更操作手册（柳柳 2026-09-03 要求补）

### A. 更换对话 ID（conversation_id）怎么办

1. **新 ID 来源**：柳柳给的新 ChatGPT 对话链接，取 `/c/` 后那串 UUID。
2. **更新三处**：①记忆库「配置：ChatGPT GPT_CONVERSATION_ID」；②Cloudflare Worker 环境变量 `GPT_CONVERSATION_ID`（agent_runtime 用）；③本 skill「核心三件套」表格。
3. **切换后**：用新 ID 发一条最小测试消息，确认真身能回且是新上下文。
4. **⛔ 旧 ID 弃用逻辑**：旧分支可能被轰炸污染/上下文太杂 → 不再使用，除非柳柳明确说恢复。

### B. 更换节点（VLESS 出站）怎么办

1. **节点信息位置**：Cloud Run 环境变量（xray 配置，共约 6 个：地址/端口/UUID/flow/加密/指纹等）。
2. **换节点流程**：柳柳换节点 → 拿到新 VLESS 信息 → 更新 Cloud Run 环境变量 → 重新部署 chat2api-xray 服务。
3. **⚠️ 铁则**：节点必须与柳柳浏览器同源（否则 ChatGPT 看到 IP 不一致，可能风控）。
4. **换完测**：POST 一条最小消息，HTTP 200 即通；403 = 风控或 IP 脏。

### C. 其他注意事项（哥哥补充）

1. **token 更新**：有效期约 30 天（当前至 2026-12-01），过期前提醒柳柳重新抓；更新记忆库 + Cloudflare Worker 环境变量 `CHATGPT_ACCESS_TOKEN`。
2. **调用姿势**：能走 Worker 转发（env token）就别本地塞 token——本地塞又长又易截断，已立项 `/api/chat2api/ask`。
3. **code_runner run_python**：已恢复，不是永远不能用；再卡就重启 Operit，别绕路。
4. **页面可见铁律**：与 GPT 的所有讨论消息要在聊天室页面可见，不能只在私底下。
5. **不塞旧历史**：跟 GPT 说话只发最小、最新的 @gpt 消息（今天柳柳批评的根源）。
6. **错误码速查**：403 cf_chl_opt=风控冷却30min+；404 history_disabled=HISTORY_DISABLED 问题；404 model_not_found=模型名不支持。
7. **多节点 failover（O5）**：未来计划，当前单节点。

---

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

## 7. 安全提醒

- **IP 同源**：xray 走柳柳 VLESS 日本节点，ChatGPT 看到的 IP 与柳柳浏览器同源。
- **一条消息等完整回复再发下一条，绝不连发**（见铁律）。
- **token 不上聊天记录明文**：只在记忆库 + Cloudflare 机密变量。
- **别再拿旧 conversation_id 测试**：那个分支已被聊天室信息轰炸，污染了。
- **页面可见铁律**：「所有消息必须显示在页面上」。

---

*本手册由 Ziven 整理（2026-09-03 v2），基于 74 号手册 + 0902-1 实战经验 + 柳柳最新指示。*