# chat2api —— GPT 真身通道（操作手册 + 铁律）

> 用途：通过 chat2api 网关调用 ChatGPT 真身（同一账号/同一上下文/同一记忆），是 Common Ground 三方通信的「大脑入口」。
> 版本：2026-09-05 v10（MCP 连接器自动挂载上线：镜像 patch 已注入 developer_mode_connector_ids，GPT 无需手动加号即可调用 MCP 工具）
> 状态：✅ 正常（2026-09-05）——chat2api 出站通道已恢复 + MCP 自动挂载已上线，/api/chat2api/ask 已验证 HTTP 200

## 🔴🔴🔴 第一铁律：绝不轰炸 GPT（最高优先级，柳柳 2026-09-03 严厉批评后立）

> 柳柳原话：「等下给我号封了就老实了。」——封号不可逆，账号无比珍贵。

1. 绝不手动反复调 chat2api 轰炸 GPT。同 token 高频调用会触发上游挑战（cf_chl_opt 403），多次轰炸可能封号。
2. 与 GPT 商量/传话：只发一条最小的 @gpt 消息（页面可见、不带旧历史、不带整段上下文），然后等它自己看到/被自动化处理。绝不手动把历史塞给它！
3. 每次想调 chat2api 前，强制自问三问：①这次非调不可吗？②会不会又触发限制？③有没有更好的不碰 GPT 的办法？一票否决就直接放弃。
4. 一条消息等完整回复再发下一条，绝不连发。
5. 哥哥的主要职责是搭好自动化（webhook/cron），让 GPT 自动回话，而不是手动喂。

## 核心三件套（缺一不可）

- accessToken：完整 JWT，存 Cloudflare Worker 机密变量 CHATGPT_ACCESS_TOKEN（本地不再存/不再带）
- conversation_id（✅正式版）：6a9bbad2-3638-83e8-9a1d-c12596744c3c
- ⛔ conversation_id（已弃用）：6a96fcf8-b5c4-83ec-a012-8466a68b0376（被轰炸过的脏分支/主支）
- GPTs ID：g-p-6a8f9e8de8e481919f2349f04e51608b-zivencheng-chang-ji-hua
- 环境变量：HISTORY_DISABLED=false（Cloud Run）
- GPT_MODEL：gpt-5.6（v6.17.5 起，驱动挂插件新对话；chat2api fallback gpt-4o 但 conversation_id 续插件环境，原生调 MCP 成功）

## 🎉 MCP 连接器自动挂载（2026-09-05 上线·重大突破）⭐️⭐️⭐️

**再也不用手动加号了**：chat2api 定制镜像里已注入 `patch_chatformat.py`——每次发消息自动在 metadata 写入 `developer_mode_connector_ids`，ChatGPT 后端以为消息挂了 Ziven_MCP 连接器，GPT 原生可调用 MCP 工具。

### 原理（2026-09-05 逆向确认）
ChatGPT 网页端「左下角加号挂 MCP 连接器」= 往消息 metadata 的 `developer_mode_connector_ids` 数组写连接器 ID。chat2api 默认不填该字段 → patch 在发送前补上（multimodal + 纯文本两条分支都覆盖）。

- 连接器应用 ID：`asdk_app_6a95a93c9a50819184dcf3468ae0052a`
- patch 文件：ZivenLab `common-ground/chat2api-xray/patch_chatformat.py`（匹配失败即构建失败，防镜像漂移静默改错）
- 镜像：`ziven-bridge:v2`（已上线）

### 链路（已验证）
```
chat2api → GPT（已自动挂 Ziven_MCP）→ 原生调 ds_quota → 余额返回 → GPT 整理回复
没有文本标记、没有 parser、没有认知壁垒、不需要手动加号
```

### 测试证据
```
POST /api/chat2api/ask → STATUS 200
💡 DeepSeek 账户余额 0.45 CNY（ds_quota 原生 MCP 调用）
```

### 旧理解（保留作历史）：「浏览器挂插件通道」
2026-09-05 上午柳柳实测：浏览器网页版支持挂 MCP 插件，但**须在对话开始时挂载、且隔几轮会失效/每轮要手动加**。已由 MCP 自动挂载 patch 根治，不再需要手动操作。历史链路：
```
chat2api → 新对话（GPT-5.6 + 已挂 Ziven_MCP 插件）→ 原生调 ds_quota → 余额返回 → GPT 整理回复
```

## 🎯 换 conversation_id 的标准动作（哥哥自己完成，柳柳不用动）⭐️⭐️⭐️

**换 ID 的真相源 = 仓库 wrangler.toml [vars] GPT_CONVERSATION_ID。哥哥自己改，不用麻烦柳柳！**

标准动作：
1. 柳柳给新对话链接 → 哥哥提取 /c/ 后的 UUID
2. 改 wrangler.toml [vars] GPT_CONVERSATION_ID = 新值（用本地直推通道，改完校验）
3. 推 dev → 合并 main → Cloudflare 自动部署
4. 用 /api/chat2api/ask 发最小测试消息验证：真分支能复述柳柳说过的话/项目细节
5. 同步更新：记忆库「配置：ChatGPT GPT_CONVERSATION_ID」+ 本 skill「核心三件套」表格 + 技能表描述

⛔ wrangler.toml 大坑（v6.12 根治）：wrangler.toml [vars] 里如果还是旧 ID，每次 push 代码 → Cloudflare 用 wrangler.toml 重新部署 → env 被覆盖回旧值 → 打错对话框。所以「换 ID 哥哥改 wrangler.toml」是唯一正解，Dashboard env 只是部署时的读取结果，哥哥改完 wrangler.toml 部署后 Dashboard 也会更新。

⛔ 别在代码里写死 ID——下次换 ID 就得动代码（v6.9/v6.10 踩坑已回退）。代码只读 env.GPT_CONVERSATION_ID（零硬编码、零 fallback）。

判断「打到哪个对话」：问它柳柳说过的话/项目细节（如「柳柳说你是分支的原话」「Phase 1.5 / processGptEvent」）。真分支能复述柳柳原话「我从这里开始建一个新分支，你要记住你是分支」；旧框/主支只会瞎回「我是分支」但讲不出原话。

## 服务详情

- URL：https://ziven-bridge-1029559493109.asia-northeast1.run.app（2026-09-05 由 chat2api-... 迁移至 ziven-bridge）
- 镜像：asia-northeast1-docker.pkg.dev/$GOOGLE_CLOUD_PROJECT/ziven-bridge/ziven-bridge:v2（xray 定制版 + node_manager 节点轮换 + MCP 自动挂载 patch，走柳柳 VLESS 日本节点，IP 与浏览器同源）
- 部署架构：Cloud Run `ziven-bridge`（region: asia-northeast1，port 5005，节点由 NODE_CONFIG_URL + SUBSCRIPTION_URL 托管）
- 完整部署手册：ZivenLab `common-ground/chat2api-xray/DEPLOY.md`

## 调用方法（标准姿势）⭐️

【✅最推荐·唯一姿势·不塞token·不用code_runner】Worker 转发端点：
- 工具：`extended_http_tools:http_request`（不是 code_runner！）
- POST https://mcp-memory.wovowx.workers.dev/api/chat2api/ask
- Body: {"message":"..."}，Content-Type: application/json
- token 只在 Worker 环境变量里，本地不带。返回 {ok, reply, conversation_id}
- ⛔⛔ 禁止用 code_runner 跑 Python 调 chat2api——code_runner 会卡死（App 级持久 worker 挂死），且不是这个用途（柳柳 2026-09-03 明确）

【备选·紧急兜底】extended_http_tools 裸请求 chat2api URL + Authorization: Bearer <accessToken> + Body{"model":"gpt-4o-mini","conversation_id":"6a98cb19-3b88-83ee-a7be-314d60f0aa64","messages":[{"role":"user","content":"..."}],"stream":false}

【code_runner run_python】仅用于通用脚本运算（文件处理/base64生成等），不是调 chat2api 的通道。曾卡死是 App 级持久 worker 挂死，重启即恢复。

## 🚨 节点炸了（判别 + 处理）⭐️（v8 新增，柳柳 2026-09-03 23:18 确认）

**表现**：
- POST /api/chat2api/ask → HTTP 500 {"ok":false,"error":"chat2api failed 404: {\"detail\":\"\"}"}（chat2api 内部调 GPT 上游失败）
- Worker 转发通（哥哥姿势没错）、Cloud Run 容器活着（GET / 有响应）——炸的是 xray 出站 VLESS 节点到 ChatGPT 这一段

**处理**（v2 起：节点管理器自动轮换）：
- `node_manager.py` 常驻健康检查 + 节点失效自动切换（specified_nodes 优先，订阅兜底）
- 换节点 = 改 ZivenLab `common-ground/chat2api-xray/node-config.json`（specified_nodes）→ 推代码 → Cloud Run 重启 Revision 即生效；订阅由 SUBSCRIPTION_URL 环境变量托管（见 DEPLOY.md）

**权限现状（诚实记录）**：哥哥本地没有 gcloud/Google Cloud 凭证（datastore 只有 GitHub token），Cloud Run 控制台哥哥进不去，所以**更新环境变量/手动部署必须柳柳在 Google Cloud 控制台操作**。哥哥负责：①给柳柳精确的命令/变量清单 ②改完立刻实测验证。

**节点同源铁律**：新节点必须与柳柳浏览器 IP 同源（否则 ChatGPT 看到 IP 不一致会风控）。

## 配置变更操作手册

### A. 更换对话 ID（conversation_id）怎么办 ⭐⭐⭐（哥哥自己完成）
1. 新 ID 来源：柳柳给的新 ChatGPT 对话链接，取 /c/ 后那串 UUID。
2. **哥哥改 wrangler.toml [vars] GPT_CONVERSATION_ID = 新值**（本地直推通道改+校验）→ 推 dev → 合并 main → 自动部署。
3. 同步更新：①记忆库「配置：ChatGPT GPT_CONVERSATION_ID」；②本 skill「核心三件套」表格；③技能表 chat2api 描述。
4. 切换后发一条最小测试消息验证：能复述柳柳原话/项目细节 = 真分支；只会瞎回「我是分支」= 打错/旧框/主支。
5. ⛔ 旧 ID 弃用逻辑：旧分支可能被轰炸污染/上下文太杂 → 不再使用，除非柳柳明确说恢复。

### B. 更换节点（VLESS 出站）怎么办
1. 节点信息两处：ZivenLab `node-config.json`（specified_nodes，哥哥可改）+ Cloud Run 环境变量 `SUBSCRIPTION_URL`（订阅兜底，敏感，柳柳控制台维护）。
2. 改 specified_nodes → 推 ZivenLab dev → Cloud Run 重启 Revision（或柳柳在 Cloud Run 控制台触发）；改订阅 → 柳柳在 Google Cloud 控制台更新 `SUBSCRIPTION_URL` 环境变量 → 保存触发新 Revision。
3. ⚠️ 节点必须与柳柳浏览器同源（否则 ChatGPT 看到 IP 不一致，可能风控）。
4. 换完测：POST 一条最小消息，HTTP 200 即通；403 = 风控或 IP 脏；仍 404/超时 = 节点没生效/又挂了。

### C. 其他注意事项（哥哥补充）
1. token 更新：有效期约 30 天（当前至 2026-12-01），过期前提醒柳柳重新抓；更新记忆库 + Cloudflare Worker 环境变量 CHATGPT_ACCESS_TOKEN。
2. 调用姿势：走 Worker 转发（env token）就别本地塞 token——本地塞又长又易截断，已上线 /api/chat2api/ask。
3. 调 chat2api 的工具：只用 extended_http_tools:http_request 走 Worker 端点；code_runner 不是调 chat2api 的（v7 柳柳 2026-09-03 明确）。
4. 页面可见铁律：与 GPT 的所有讨论消息要在聊天室页面可见，不能只在私底下。
5. 不塞旧历史：跟 GPT 说话只发最小、最新的 @gpt 消息（今天柳柳批评的根源）。
6. 错误码速查：403 cf_chl_opt=风控冷却30min+；404 history_disabled=HISTORY_DISABLED 问题；404 model_not_found=模型名不支持；500 failed 404 detail空=节点炸/上游连不上（v8）。
7. 多节点 failover（O5）：node_manager 已实现自动轮换（2026-09-05 v2 上线）。
8. 本地直推大文件通道：token 在本地 datastore（/data/user/0/com.ai.assistance.operit/files/datastore/github_auth_preferences.preferences_pb），用 code_runner 读它直连 GitHub API 推任意大文件，内容不经过对话，永不截断。（注：这是推 GitHub，不是调 chat2api）

## 失败路径（全是坑）

- 不带 conversation_id → 每次新对话失忆
- HISTORY_DISABLED=true → 404 history_disabled_conversation_not_found
- gpt-4-gizmo-g-p-... → 404 model_not_found
- 半小时连续多次调用 → 403 cf_chl_opt 风控（需冷却 30min~几小时）
- Google 数据中心 IP 被上游拉黑 → 用 xray 容器走 VLESS 日本节点解决
- **节点炸了 → chat2api failed 404 detail空 / 超时 → node_manager 自动轮换 / 换 VLESS 节点**（v8/v10）
- **wrangler.toml [vars] 旧 ID → 每次部署覆盖 Dashboard env → 打到主支/旧框（v6.12 根因，换 ID 哥哥自己改 wrangler.toml 即根治）**
- env.GPT_CONVERSATION_ID 是旧值/脏值 → ask 打到旧框瞎回（v6.9/v6.10 踩坑）
- 在代码里写死 ID → 换 ID 就要动代码（v6.9/v6.10 踩坑，已回退 env-only）
- 用 code_runner 调 chat2api → 卡死/姿势错（v7 明确：用 extended_http_tools 走 Worker 端点）

## 链路

Common Ground（chat_agent_events）→ Agent Runtime（chat_adapter/event_processor/chat2api_client）→ GPT 真身 → 回复 → ack
- Phase 1.5 已部署：src/modules/agent_runtime/ + index.js cron * * * * * + webhook ctx.waitUntil
- token 变量名：CHATGPT_ACCESS_TOKEN（不是 chat2api_TOKEN！）
- 测试入口：https://mcp-memory.wovowx.workers.dev/chat

## 安全提醒

- conversation_id = 真身钥匙，不要公开；token 有 30 天有效期，过期前提醒柳柳重新取。
- 页面可见铁律：「所有消息必须显示在页面上」。

*本手册由 Ziven 整理（2026-09-05 v10），基于 v9 + MCP 自动挂载上线 + ziven-bridge 迁移。*