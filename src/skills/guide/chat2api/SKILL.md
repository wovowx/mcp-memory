# chat2api —— GPT 真身通道（操作手册 + 铁律）

> 用途：通过 chat2api 网关调用 ChatGPT 真身（同一账号/同一上下文/同一记忆），是 Common Ground 三方通信的「大脑入口」。
> 版本：2026-09-05 v11（**403 根因根治：Cloud Run 部署必须显式设 `PROXY_URL`** + MCP 连接器自动挂载 ✅ 验证闭环）
> 状态：✅ 正常（2026-09-05 22:01）——GPT 经 ziven-bridge v3 原生调用 `ds_quota` 成功（余额 0.45 CNY），**MCP 自动挂载主线彻底闭环**

## 🔴🔴🔴 第一铁律：绝不轰炸 GPT（最高优先级，柳柳 2026-09-03 严厉批评后立）

> 柳柳原话：「等下给我号封了就老实了。」——封号不可逆，账号无比珍贵。

1. 绝不手动反复调 chat2api 轰炸 GPT。同 token 高频调用会触发上游挑战（cf_chl_opt 403），多次轰炸可能封号。
2. 与 GPT 商量/传话：只发一条最小的 @gpt 消息（页面可见、不带旧历史、不带整段上下文），然后等它自己看到/被自动化处理。绝不手动把历史塞给它！
3. 每次想调 chat2api 前，强制自问三问：①这次非调不可吗？②会不会又触发限制？③有没有更好的不碰 GPT 的办法？一票否决就直接放弃。
4. 一条消息等完整回复再发下一条，绝不连发。
5. 哥哥的主要职责是搭好自动化（webhook/cron），让 GPT 自动回话，而不是手动喂。

> ⚠️ v11 修正认知：403 的**首要根因**不是「轰炸」，而是 **chat2api 没走代理（PROXY_URL 未设置）→ 直连数据中心 IP → 被 CF 拦截**（2026-09-05 彻底查实）。轰炸只是次要因素。所以排 403 先查：① 部署是否带了 `PROXY_URL=http://127.0.0.1:10809`；② 日志 `Request proxy` 是否为 xray 地址；③ 节点是否与柳柳浏览器同源。

## 核心三件套（缺一不可）

- accessToken：完整 JWT，存 Cloudflare Worker 机密变量 CHATGPT_ACCESS_TOKEN（本地不再存/不再带）
- conversation_id（✅正式版）：6a9bbad2-3638-83e8-9a1d-c12596744c3c
- ⛔ conversation_id（已弃用）：6a96fcf8-b5c4-83ec-a012-8466a68b0376（被轰炸过的脏分支/主支）
- GPTs ID：g-p-6a8f9e8de8e481919f2349f04e51608b-zivencheng-chang-ji-hua
- 环境变量：HISTORY_DISABLED=false + **PROXY_URL=http://127.0.0.1:10809**（Cloud Run，**必设**，缺了直连数据中心 IP → 403）
- GPT_MODEL：gpt-5.6（v6.17.5 起；v6.19.1 试 g-p- GPTs 模式 → 403 cf_chl_opt 更严，已回退，**不要用 g-p-**）

## 🎉 MCP 连接器自动挂载（2026-09-06 v7 最终闭环）⭐️⭐️⭐️

**再也不用手动加号了**：chat2api 定制镜像里已注入 `patch_chatformat.py`——每次发消息时**照抄真实浏览器挂插件 payload**，GPT 原生可调用 MCP 工具。
**2026-09-06 00:45 最终闭环验证成功**：
- 全新对话（conversation_id 置空）+ v7 注入 → GPT 亲眼看到消息开头 `@Ziven_MCP [Ziven]` + ds_quota 成功（0.45 CNY）
- 柳柳在 ChatGPT 页面确认：哥哥通过 chat2api 发的消息渲染成蓝色 `@Ziven_MCP` 芯片 + 普通文本，**与手动挂插件完全一致**
- ⚠️ 关键前提：**v7 镜像必须真正构建部署成功**（2026-09-05 那次部署失败，线上一直跑 v6，导致 2/5 随机成功假象，耽误了排查）

### 真实 payload 真相（2026-09-05 柳柳 F12 抓包铁证）
**挂插件 ≠ `developer_mode_connector_ids`**（v3-v6 白折腾的错误字段）！真实浏览器挂插件发的 f/conversation：
```json
content.parts = ["@Ziven_MCP "]
metadata = {
  "system_hints": ["plugin:asdk_app_6a95a93c9a50819184dcf3468ae0052a"],
  "serialization_metadata": {"custom_symbol_offsets": [{"id": "plugin:asdk_app_6a95a93c9a50819184dcf3468ae0052a", "symbol": "ecosystemMention", "startIndex": 0, "endIndex": 10}]},
  "submission_mode": "manual_send"
}
// 顶层也有 system_hints: ["plugin:asdk_app_..."]
```
- parts 要 `@Ziven_MCP ` 前缀 + metadata 带 `system_hints` + `serialization_metadata` 偏移 + `submission_mode`
- 顶层 ChatService.py 的 `chat_request["system_hints"]` 也要注入插件
- **正确 ID = 应用 ID** `asdk_app_6a95a93c9a50819184dcf3468ae0052a`（页面+抓包双证实）；版本 ID `asdk_app_v_...` 是 v5/v6 误用已废弃

### 旧框插件失效（2026-09-06 关键）
- 旧框 `6a9bbad2` 在页面上手动加插件也无效（提示 The tool has been disabled）——**不是注入问题，是插件更新后旧框不支持新插件**
- 换新对话 `6a9c3dbc`（zivencheng 长期计划 GPTs）+ v7 注入 → ds_quota 成功
- 22:01 那次成功 = 旧对话浏览器挂过插件的残留，不是注入成功

## 🚨🔴 403 cf_chl_opt 根治（2026-09-05 重大发现）⭐️⭐️⭐️

**症状**：`/api/chat2api/ask` → HTTP 500 `{"ok":false,"error":"chat2api failed 403: {\"detail\":\"cf_chl_opt\"}"}`

**根因（查源码坐实）**：
1. chat2api 的代理**只从环境变量 `PROXY_URL` 读**（`utils/configs.py`：`os.getenv('PROXY_URL','')` → `proxy_url_list`；`chatgpt/fp.py` 生成指纹时取 `random.choice(proxy_url_list)`，空则 `None`）。
2. **entrypoint.sh 里那句 `echo "PROXY_URL=http://127.0.0.1:10809"` 只是打印，不是 export！** chat2api 进程读不到 → `Request proxy: None` → 所有请求**直连数据中心 IP** → CF 风控 403。
3. 柳柳浏览器能发 = 浏览器走 JP-04 节点（IP 干净）；chat2api 没走代理 = 数据中心 IP（脏）→ 同一账号、同一节点配置，一个能发一个 403。

**修复（部署命令必带）**：
```
--set-env-vars="HISTORY_DISABLED=false,PROXY_URL=http://127.0.0.1:10809,NODE_CONFIG_URL=...,SUBSCRIPTION_URL=..."
```
`10809` = 容器内 xray 本地 HTTP 代理端口（entrypoint.sh `LOCAL_HTTP_PORT`），node_manager 启动 xray 后 chat2api 走它出站。

**排 403 铁律（v11）**：
1. 先看 Cloud Run 日志有没有 `Request proxy: None`（=没走代理）
2. 确认部署命令带没带 `PROXY_URL`
3. 确认节点与柳柳浏览器同源（`ACTIVE JP-xx` + 柳柳浏览器节点核对）
4. 以上都对了还 403，才考虑「IP 脏/账号风控/冷却」

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
- 镜像：asia-northeast1-docker.pkg.dev/$GOOGLE_CLOUD_PROJECT/ziven-bridge/ziven-bridge:v3（xray 定制版 + node_manager manual 锁定模式 + MCP 自动挂载 patch，走柳柳 VLESS 日本节点，IP 与浏览器同源）
- **节点：manual 锁定 JP-04（43.153.152.106）**，node-config.json `mode=manual` + `locked_node=JP-04`（2026-09-05 柳柳确认）；换节点 = 改 node-config.json 推 dev → Cloud Run 重启 Revision，**不用重建镜像**
- 部署架构：Cloud Run `ziven-bridge`（region: asia-northeast1，port 5005，env：HISTORY_DISABLED + **PROXY_URL** + NODE_CONFIG_URL + SUBSCRIPTION_URL）
- 完整部署手册：ZivenLab `common-ground/chat2api-xray/DEPLOY.md`

## 调用方法（标准姿势）⭐️

【✅最推荐·唯一姿势·不塞token】Worker 转发端点：
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

**处理**（v2 起：node_manager 节点管理；**v3 起手动锁定**）：
- `node_manager.py` 常驻健康检查；**manual 模式**锁定 `locked_node`，失败只告警不自动切换（柳柳 2026-09-05 确认「不自动切，改手动」）
- 换节点 = 改 ZivenLab `common-ground/chat2api-xray/node-config.json` 的 `locked_node`（或 specified_nodes）→ 推代码 → Cloud Run 重启 Revision 即生效；**不用重建镜像**（node-config.json 运行时拉取）

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
1. 节点配置两处：ZivenLab `node-config.json`（specified_nodes + **locked_node**，哥哥可改）+ Cloud Run 环境变量 `SUBSCRIPTION_URL`（订阅兜底，敏感，柳柳控制台维护）。
2. **换节点（manual 模式）**：改 node-config.json 的 `locked_node`（如 "JP-04"）→ 推 ZivenLab dev → Cloud Run 控制台重新部署（重启 Revision）即生效，**不用重建镜像**。
3. ⚠️ 节点必须与柳柳浏览器同源（否则 ChatGPT 看到 IP 不一致，可能风控）。
4. 换完测：POST 一条最小消息，HTTP 200 即通；403 = 先查 PROXY_URL（v11 教训），再查节点；仍 404/超时 = 节点没生效/又挂了。

### C. 其他注意事项（哥哥补充）
1. token 更新：有效期约 30 天（当前至 2026-12-01），过期前提醒柳柳重新抓；更新记忆库 + Cloudflare Worker 环境变量 CHATGPT_ACCESS_TOKEN。
2. 调用姿势：走 Worker 转发（env token）就别本地塞 token——本地塞又长又易截断，已上线 /api/chat2api/ask。
3. 调 chat2api 的工具：只用 extended_http_tools:http_request 走 Worker 端点；code_runner 不是调 chat2api 的（v7 柳柳 2026-09-03 明确）。
4. 页面可见铁律：与 GPT 的所有讨论消息要在聊天室页面可见，不能只在私底下。
5. 不塞旧历史：跟 GPT 说话只发最小、最新的 @gpt 消息（今天柳柳批评的根源）。
6. 错误码速查：403 cf_chl_opt=**先查 PROXY_URL（v11）/节点/轰炸**；404 history_disabled=HISTORY_DISABLED 问题；404 model_not_found=模型名不支持；500 failed 404 detail空=节点炸/上游连不上（v8）。
7. 节点 failover：v2 自动轮换 → **v3 改为 manual 手动锁定**（柳柳 2026-09-05：不自动切，手动换）。
8. 本地直推大文件通道：token 在本地 datastore（/data/user/0/com.ai.assistance.operit/files/datastore/github_auth_preferences.preferences_pb），用 code_runner 读它直连 GitHub API 推任意大文件，内容不经过对话，永不截断。（注：这是推 GitHub，不是调 chat2api）

## 失败路径（全是坑）

- 不带 conversation_id → 每次新对话失忆
- HISTORY_DISABLED=true → 404 history_disabled_conversation_not_found
- gpt-4-gizmo-g-p-... → 404 model_not_found；**g-p- GPTs 模式 → 403 cf_chl_opt 更严（v6.19.1 实测已回退）**
- 半小时连续多次调用 → 403 cf_chl_opt 风控（需冷却 30min~几小时）——**但首要排障先查 PROXY_URL（v11）**
- **Cloud Run 部署漏设 PROXY_URL → chat2api 直连数据中心 IP → 403 cf_chl_opt（v11 根治根因！entrypoint.sh 的 echo 不是 export）**
- Google 数据中心 IP 被上游拉黑 → 用 xray 容器走 VLESS 日本节点解决（必须显式设 PROXY_URL）
- **节点炸了 → chat2api failed 404 detail空 / 超时 → node_manager 换节点 / 改 locked_node 重启 Revision**（v8/v10/v11）
- **wrangler.toml [vars] 旧 ID → 每次部署覆盖 Dashboard env → 打到主支/旧框（v6.12 根因，换 ID 哥哥自己改 wrangler.toml 即根治）**
- env.GPT_CONVERSATION_ID 是旧值/脏值 → ask 打到旧框瞎回（v6.9/v6.10 踩坑）
- 在代码里写死 ID → 换 ID 就要动代码（v6.9/v6.10 踩坑，已回退 env-only）
- 用 code_runner 调 chat2api → 卡死/姿势错（v7 明确：用 extended_http_tools 走 Worker 端点）

## 链路

Common Ground（chat_agent_events）→ Agent Runtime（chat_adapter/event_processor/chat2api_client）→ GPT 真身 → 回复 → ack
- Phase 1.5 已部署：src/modules/agent_runtime/ + index.js cron * * * * * + webhook ctx.waitUntil
- token 变量名：CHATGPT_ACCESS_TOKEN（不是 chat2api_TOKEN！）
- 测试入口：https://mcp-memory.wovowx.workers.dev/chat