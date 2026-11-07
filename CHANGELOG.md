# Changelog

所有重要变更将记录在此文件中。

## [v6.53.1] - 2026-11-07（GitHub 新文件上传 · Cloudflare Redirect 兼容修复候选，仅 dev）

### 柳柳实际会得到什么
- 修正 v6.53.0 上线后 E3 实测发现的第二个 `github_push` 兼容问题：Cloudflare Workers 原生 `fetch` 不支持 `redirect: 'error'`，因此上传新文件时仍在读取 Supabase URL 处报 `CONTENT_FETCH_FAILED/Invalid redirect value`。将该选项改为 Workers 支持的 `redirect: 'manual'`，并保留 `!response.ok` 拒绝 3xx/失败响应，禁止自动跳转到其他地址。
- GitHub Contents 合同从 51 增至 53 项：模拟 Workers 对 `error` redirect 选项抛错、验证合法 `manual`、验证 302 被拒且绝不写 GitHub；Router 合同同步更新成 `manual`，确保整体 220 项合同可通过。

### 验收与发布边界
- 本版只涉及 `src/modules/github/contents.js`、两个回归测试、版本号和本记录，不修改工具名称/Schema、数据库、Secrets、生产配置、聊天室或 Operit 设备。v6.53.0 已上线且 Worker #547 经 `verify_main` 证实；v6.53.1 当前仅准备 dev 候选，**未获得单独 main/Cloudflare 发布同意前不合并**。
- 如获批准按 dev→PR→rebase→main→Worker `verify_main` 执行，线上再次调用 `github_push` 创建 M1 新文件到 dev，再做 GitHub 回读和 E1/E2；真实 Operit E3 仍需宿主侧后续测试。回滚基线 v6.53.0、main `489001d477e6c6ddeadccf590c631d57ccbb7ca8`、Worker #547。私人云端工作检查点不自动改写。

---

## [v6.53.0] - 2026-11-07（L3 纠错应用与 GitHub 新文件上传修复）

### 柳柳实际会得到什么
- **L3 v0.3 可追溯学习前置能力**：在已有 Reflection 原子能力中复用 `evaluateCorrectionTrail`、`planLearningPreflight` 和 `compareLearningTrials`，把真实错误、反馈、恢复路径挂接成可检查来源；仅对已有审批的 active lesson 在当前工具确实可用时给出任务前建议；提供同任务/同工具能力下的前后对照。候选仍是 `pending`，不会自行晋升、执行或假称跨新框已学会。`reflection_preview --preflight` 可只读预览。
- **修复 GitHub 新文件创建**：`github_push(content_url=自有 Supabase 存储地址)` 原本因 Worker 的 `fetch` 调用丢失 receiver 而返回 `CONTENT_FETCH_FAILED/Illegal invocation`，本版把 `pushFileFromStorage` 的存储读取改成已在同模块使用的 `.call(globalThis,...)`，恢复现有合法上传路径；新增严格模拟原生 `fetch` receiver 的回归，避免再次出现“已有工具却用不了”。**发布后仍须实际再试一次 `github_push` 才能确认生产路径修好。**

### 验收范围与边界
- 代码净变更在本版发布准备前为 8 路径：现有 `reflection.js`、预览脚本、master-router、Reflection 测试/候选、GitHub Contents 一行调用修复与回归、跨宿主 Bridge。仅再更新 `package.json` 和本 CHANGELOG 完成版本化。没有新 MCP 工具名、Schema、依赖、数据库结构、Secrets、持久日志开关或聊天室改动；不会自动安装 Operit 适配器。
- E1/E2：`npm run check`、`npm run test:reflection`（69/69）、`npm run test:github-contents`（51/51）、`npm run test:contracts`（220/220）、`npm run test:bootstrap`（56/56）、`npm run test:memory-core`（120/120）、`python3 tests/learning/run_learning_tests.py`（11工件）在隔离工作树运行验证。dev 代码候选 `a5b0e9b4017ca81e31fdfe260a62d7a17a5becf3` 的 GitHub Actions [learning-regression #42334055883](https://github.com/wovowx/mcp-memory/actions/runs/42334055883) 已 `completed/success`；版本化提交之后应再次按最终 SHA 校验 CI。
- 真实跨新框选路、自动 preflight、完整五源 Operit 恢复仍是 E3 `NOT_VERIFIED`。本版 main 发布仅在柳柳 2026-11-07 明确回复“发布吧”后按 PR/rebase/Worker 自动部署执行。**发布前**不称上线；**部署后**必须读 PR/main 与 `cloudflare_deploy_status(verify_main=true)`，单独证明 `DEPLOY_VERIFIED`。
- 回滚基线为 v6.52.0、main `1633ae16009597edca1c29232ec2f8c0ee348b1d`、Worker #546。若发布导致异常，在获得相应许可后从该确定基线恢复；不删除数据库或历史证据。云端唯一 `⚙️/当前工作检查点` 本次没有单独写入授权，故保持 v213，不把发布自动扩大为私人记忆更新。

---

## [v6.52.0] - 2026-11-07（dev 候选 · L3 工具选择纠错与行为证据）

### 柳柳实际会得到什么
- 将「在 ChatGPT 误选通用 GitHub connector 编辑 ZivenLab/dev 遇 403，误判全局 GitHub 无权限；之后经 Ziven MCP github_edit 成功」这个真实教训沉淀到现有 `master-router` + `github-use-guide`。下一次对 Ziven 仓库作 dev 已有文件编辑时，先核验宿主实际暴露的 Ziven MCP 工具，优先 `github_edit` 的 dry_run→写入→`github_read` 回验；一个连接器的 403 不直接解释成 GitHub 全局无权，也不立即要求柳柳修改 token。未暴露合法工具或未经 main 许可时照实止步。
- L3 `reflection.js` 增添可复用的纯 `evaluateBehaviorObservation`：比较预期与提供的观察结果，分 `PASS/FAIL/NOT_VERIFIED/INVALID`，但永远标明宿主未获独立验证，不把自报/合成记录当 E3。
- 增加 `tests/learning/learning_github_tool_route_001.json` 来源与反证候选（状态 `pending`，不自动晋升），以及 T1 正常选路、T2 连接器 403、T3 真无工具、T4 禁止 main 直写、T5 无提示新框的五场景与负例回归。恢复「通用修改已有文件」的原有路由行，保证专用规则不吞旧路径。

### 验收、风险与回滚
- 独立临时 clone 的 E1/E2：`npm run check` exit0（46 个 JS 语法/本地 import）、`npm run test:reflection` 44/44 exit0、`python3 tests/learning/run_learning_tests.py` 11 工件 exit0、`npm run test:contracts` 220/220 exit0；最后一次 router 微调后 reflection 44/44 exit0。代码及版本候选提交 `f10b36b30649e8e4d21cdd56e9a2cd602994b829` 的官方 GitHub Actions [learning-regression #42259882773](https://github.com/wovowx/mcp-memory/actions/runs/42259882773) 经 GitHub Actions 官方只读 API 返回 `completed/success`（独立于本地执行）。后续若 dev 再变化，以对应新 HEAD 状态为准；E3 仍未验证。
- **现处 dev 候选，不代表已发布到 ChatGPT/Operit 宿主或 Worker。** 由于宿主实际工具选择不受 Worker JS 强制拦截，本次 E1/E2 只能证明文本/合成合同；真正 E3 要发布后在新框、无柳柳工具提醒条件下观察实际调用行为。没有 E3 就保留 `pending`，不承诺从此永不犯错。
- 此版本不增加公开 MCP tools、依赖、持久日志、DB/schema 或私人记忆写入；不更改聊天室/Agent Runtime，不碰 Secrets。**需要柳柳在看到本版收益、净 diff、测试与回滚单后另行同意 dev→main，才能触发 Cloudflare Worker 自动部署。**
- 如 E3 失败，按真实轨迹调整对应宿主的启动/路由入口；如需回退，恢复 v6.51.0 的相关 Skill、Reflection、测试和版本记录，保留候选错误证据供追溯。

---

## [v6.51.0] - 2026-11-06（L5 记忆体检完整场景入口）

### 这版要真正交付给柳柳什么
- 只需使用现有 `memory(action=health_check)`，不必自己串联数据库、映射器和解释函数，即可获得中文体检报告。默认 `mode=demo` 用固定合成数据，不读取任何真实记忆；报告包括 Core/Long-term/Reflection/Archive/待确认候选计数、待核验核心、匿名逐条解释和来源疑点，不宣称「有效状态=事实可信」。
- `mode=sample` 仅为未来经柳柳逐次同意后的真实元数据体检预留；必须显式 `metadata_read_confirmed=true`，最多8次固定查询、12返回行、精确 SELECT `id,key,category,type,status,valid_to,updated_at,version,source_ref`，不查询 `value`、事件或其他表；按 Core 5、工作2、相处2、较早3的已有模式采样。错误/异常返回 ERROR/PARTIAL，永不当作没有记忆；报告只包含汇总和固定匿名说明。
- 场景编排放在独立 `src/modules/memory/health_check.js`，基础元数据-only 读取放到现有 `repository.js`，保留 `memory_unified.js` 的薄入口与现有纯 mapper/explainer。不需要生产存储上传；沿用同一 `withMemoryTypeSchema` 对外暴露新 action 和可选参数，旧 action 和 Supabase skills 注册表原样保留。体检调用跳过 `usage_count` 自动写入；不自动改动、移动、归档任何记忆。

### 验收与生产边界
- 增加独立 `tests/memory_health_contract_test.mjs` 17 个场景合同、`test:memory-health` 脚本和 CI 步骤，覆盖 demo 零读、逐次确认门槛、限制预算、明确 select 和 GET-only、去重、错误/部分成功、匿名输出、异常响应字段剥离、无 usage 写入；扩展 Router tools/list/dispatch 合同。仍需以最终 dev HEAD CI 为准，不能把本地 Mock 等同线上 E3。
- 本版也包含下方 L5 v0.3 已验证的中文解释器。**柳柳已在完整 v6.51.0 发布单后单独同意本版 dev→main/Cloudflare 发布；实际部署状态须以 PR merge、main SHA 和 Worker `verify_main` 独立核验为准。** 真实 sample 本轮未执行，不重复使用 v0.2 的一次性读取授权；首次生产 E3 / ChatGPT 与 Operit 宿主工具刷新另需独立验收。聊天室/唤醒、数据库 Schema/真实记忆、生产 Secret、持久日志费用配置均不改。

### L5 v0.3 · 原有中文可信度解释报告（随候选保留）

### 柳柳能得到什么
- 合成记忆体检示例现在除了机器状态，还能以中文解释「当前有效只是状态」「性质未标注不等于 fact」「未见结构化来源引用不等于原记忆无来源」「agreement 确认依据尚未核验」「Core 正文可读性未经证实」。不产生真实性分数，也不声称模型已知道用户真实来源。
- 对已发布的 `mapMemoryMetadata` 判定不改动，只新增 `explainMemoryLayerRow(mapped)` 纯只读解释函数，在 `memory-layer:preview` 固定合成 fixture 输出中**增量附加** `explanations`；旧 `memory_rows`、`reflection_candidates` 和字段合同保持原样。

### 测试与授权范围
- 柳柳已经看过解释报告原型并回复「好」，仅批准 dev 代码、治理文档、合成 E1/E2；没有批准 PR/main/Worker 新版本或更改 DB/私人记忆。
- 合同测试扩展「来源缺失/存在≠真实证明、type null、agreement 未核验、Core 输入侧正文标记与宿主 E3 区别、Archive 状态边界、卡片不复制 raw id/key/source_ref、unknown issue 安全降级、determinism/no-write/无网络」。GitHub Actions 独立完成后按 dev HEAD 记录真实结果，不提前宣称生产验收。
- 不新增数据库字段、公开 MCP 工具、依赖、私人元数据抽样、Schema、召回排序或 ChatGPT/Operit 宿主启动逻辑；生产仍 **v6.50.0 / Worker #544**。正式语义版本号留待下一张完整发布单经柳柳独立确认。

---

## [v6.50.0] - 2026-11-06（记忆分层只读预览与发布后状态交接）

### 柳柳能得到什么
- 一份可解释的记忆视图建议：输入**合成元数据**，按证据把记录建议为 Core、Long-term、Archive 或待确认；单独对 Reflection 候选给出只读建议。每条保留理由、来源与疑点，重复 key 只提示不合并。
- 这版只为将来整理真实记忆和记忆星球准备可靠规则，**现在不会盘点真实记忆、不会自动分层、不会改变实际召回**；示例报告可离线运行 `npm run memory-layer:preview` 查看。

### 本次同时发布的恢复交接纪律
- `src/skills/deploy/SKILL.md` 从 v6.6.8 升至 v6.6.9：Worker 部署 `VERIFIED` 与「唯一工作检查点已同步并回读」分开判定。仅在本次已获柳柳明确同意后，更新 `⚙️/当前工作检查点`，完整保留历史，使用只读 `session_context(include_core=false)` 验证 next_action；不修改其他私人记忆，不要求 Operit 付费测试。
- `CROSS-HOST-BRIDGE.md` 追加本轮 E1/E2、CI、授权边界和跨宿主交接。Cloudflare 部署命名仍保持现有构建配置；Worker #编号不等于本仓 semver，后续若调整显示名称先另行讨论。

### 实施、兼容与严格边界
- 新增 `src/modules/memory/layer_mapper.js` 纯函数、合成 fixture、离线预览及 E2 合同回归；复用从 Session Bootstrap 提取的 `src/modules/session/keys.js` 精确五源常量（旧 `bootstrap.js` 仍按原路径 re-export，避免两份漂移）。仅按现有六维元数据独立判断，不把 Category=📦 误作 Archive，不把 `agreement` 推断为 Core，不把反思候选混入普通记忆，也不把 active/current 当成事实真实性证明。
- 保留五个精确启动 Core key；若元数据无法证明正文可读，仅标 `UNCERTAIN`，不自动注入。非当前记录可以建议历史视图，但不搬迁、不恢复、不删除。所有建议都是 `review_only`、`writes_executed=false`。
- 不添加 MCP 公开工具或变更现有 Facade/Schema、Cloudflare 日志、数据库、Supabase 真实数据、skills registry、依赖、聊天室/唤醒。`tests/memory_layer_mapper_contract_test.mjs` 使用合成数据，校验只读、无网络、状态矛盾、来源缺口、重复 key、不修改输入；纳入既有 learning-regression CI。历史 recall/history/Session Core 不受本切片逻辑调用。

### 授权与验收状态
- 柳柳先验收方案 A 并批准 `mcp-memory/dev` 合成只读编码及 E1/E2；随后哥哥按实际 main...dev 净11文件、版本收益、CI、风险、费用与回滚单独提出 v6.50.0 正式发布及发布后唯一工作检查点同步申请，柳柳明确回复「同意」。授权仅包括这11文件的 dev→main PR/rebase/Cloudflare 自动部署，以及部署确认后仅更新 `⚙️/当前工作检查点` 并回读；**不授权真实私人记忆分层盘点、其他私人记忆/数据库写入、聊天室/唤醒改造或持久日志启用**。发布结果仍需实际 PR/main/Worker/交接证据，不因批准提前标记为已发布。
- 回滚参考为生产 v6.49.0 / main `74951419f1b05117fda96124d8e85ee463243a6c` / Cloudflare Worker #543 deployment `c47c9f5c`。本版不更改持久日志默认关闭策略。

---

## [v6.49.0] - 2026-11-06（M1 请求级关联诊断 · 已发布 Worker #543）

> 状态补正：经柳柳逐版本授权，PR #336 已合并，main `74951419f1b05117fda96124d8e85ee463243a6c`、Cloudflare Worker #543 / deployment `c47c9f5c` 已 VERIFIED。下方「当时尚未批准」是开发候选阶段的历史原文，不代表该版本仍未发布。

### 柳柳能得到什么
- `cloudflare_logs_query` 将有能力把 Worker 已收到的 `memory(recall|history)`、`session_context`、`session_bootstrap` 与同一 Cloudflare invocation 关联，呈现脱敏工具类别和最近处理阶段。只看时间相近不算关联证据；没有证据保持 null/UNKNOWN。
- `arrived` 只说明已进入 Worker，`response_formed` 只说明服务端 MCP 响应已构造（不等于业务成功或 HTTP 2xx），`server_error` 只代表外层未捕获异常。若宿主在发送前拦截，Worker 没日志不能证明具体阻断位置。
- **柳柳新增的费用约束（2026-11-06 已确认）**：持久化 Workers Logs 默认关闭。临时排查优先使用 Cloudflare Live 实时日志（不保存历史）；只有需要 `cloudflare_logs_query` 查询历史、按 requestId/traceId 关联时，才通过受控版本发布临时打开存储，复现后再关闭。关闭时不能查询新产生的历史日志，也不会抹掉以前仍在保留期内的事件。

### 最小改动与兼容
- `src/index.js` 的 `/mcp` POST 入口仅为上述四个固定场景输出最多两条结构化日志；每条仅含 `marker/tool_kind/phase` 三个固定枚举，不记录 key、arguments、response、`include_core`、JSON-RPC id、Headers、Token、会话或身份正文；诊断记录失败不影响原业务响应。
- `src/tools/cf_proxy.js` 保留原工具名、Schema、时间窗、结果上限与官方 Cloudflare endpoint。内部有限 3x 事件读取（最多150）容纳同次 invocation + 两阶段日志，严格用同 Worker 的合法 requestId/traceId 关联并拒绝跨请求、冲突类别/阶段；增加安全的 `mcp_tool_kind/mcp_phase` 可空字段。只有精确 marker 和两项合法枚举可从日志 `source` 内部提取，原始 source 永不输出。
- `wrangler.toml` 将 `[observability] enabled=false` 作为待发布的默认值；原 `invocation_logs=true/head_sampling_rate=1` 仅作临时开启存储时的明确采集配置，平时因 `enabled=false` 不会持久采集。打开/关闭存储都需显式发布，不能把改 dev 当作改线上；Live 不需要开启持久化开关。原固定枚举 `console.log` 可在已连接的 Live 中观测，但不会因此自动保存历史。
- 不增加依赖、工具、数据库表、Token 或新的 tracing 服务；不触碰聊天室、Cron、唤醒和私人 Core。已有 `status_code` 无可信证据时继续 null。

### 授权与验证边界
- 柳柳验收 Roadmap v1.74 的最小方案 A 并回复「好」，仅批准 dev 代码及合成 E1/E2；**未批准 PR、main、Worker 部署或私人 Core 真实 E3**。
- 柳柳再次确认 v6.49.0 的「默认关闭存储→优先 Live→必要时临时开启历史存储」原型，并授权改 dev/回归；**这不是修改生产 v6.48.0 的许可**。生产 v6.48.0 仍保留已发布的 100% Workers Logs 采样，直至单独获准发布本版。
- `tests/router_registry_contract_test.mjs` 扩展固定枚举日志、严格关联、跨请求/伪造 source/全零追踪 ID、冲突结果及不泄密 Mock；保持现有检索/恢复/文件/发布合同。正式 CI 须以 dev 最终 HEAD 的 GitHub Actions 独立确证；本段不预先宣称线上 E3。
- 回滚参考：已发布 v6.48.0 / main `a788a77d3400d1e7a76729bcc9ed740a00bf5220` / Worker #542 deployment `891473d4`。未来如需发布，必须再向柳柳提交版本收益、准确 diff、CI、费用与自动部署影响并取得独立授权。

---

## [v6.48.0] - 2026-11-06（Cloudflare 日志事件分类与安全字段映射 · 已发布 Worker #542）

> 状态补正：经柳柳逐版本授权，PR #335 已合并，main 当时 `a788a77d3400d1e7a76729bcc9ed740a00bf5220`、Cloudflare Worker #542 / deployment `891473d4` 已 VERIFIED。下方候选期授权说明保留历史语境，不是当前发布状态。

### 用户实际收益
- 已上线的 `cloudflare_logs_query` 能查询到 Workers Logs，但 E3 返回的三条事件中 `method/path/status_code=null`。新增事件类型 `event_kind=http|scheduled|runtime_log|other|unknown`，优先区分 HTTP、每分钟 Cron、普通运行日志，避免把 cron 当成 MCP 请求。
- 对可信 HTTP 调用，采用 Cloudflare 官方结构化 `$metadata.trigger/url/statusCode/type` 和 `$workers.eventType/event.request/outcome` 等固定白名单提取 HTTP method、仅 `/mcp` 或 `/` 路径及真实 HTTP 状态。缺失/相互冲突时仍保持 `null`，不推断「POST /mcp」或 HTTP 200。只针对真实事件验证后才能判断效果，不能把合成结果当作生产 E3。

### 改动、兼容和安全
- 仅调整 `src/tools/cf_proxy.js` 的 `sanitizeLogEvent` 与几个纯解析辅助函数；保留原 `cloudflare_logs_query` 名称、MCP 输入 Schema、Cloudflare telemetry/query 固定端点、已有 Token/认证、短时间窗、限量、读-only 注解和调用方式。
- 已有输出字段不删除/不改类型，新增一项受控枚举 `event_kind`；`status_code` 只从官方 `$metadata.statusCode` 取，runtime outcome `ok` 不能伪造 HTTP 200，错误/成功判断来自严格白名单字段。
- 不读取或返回原始 `source`、`$workers.event` 内容、Headers、Cookie、Token、正文、完整 URL/查询参数；`/other` 路径、冲突值、跨 Worker 事件拒绝或留空；保持 `status_filter=error` 的原有语义。
- 本版不改 `wrangler.toml` 当前已生效的 100% Workers Logs 采样与存储设置、不改 Secrets、Cloudflare Token、DB/记忆/skills registry、暂停聊天室/唤醒、部署链路或新的 MCP 工具注册。

### 开发授权与验收
- 柳柳验收 Roadmap v1.69 的「先分类、再安全映射」技术原型，明确回复「好」，允许 dev 代码和 E1/E2；**不是**批准 v6.48.0 PR/main/Worker 自动部署。
- `tests/router_registry_contract_test.mjs` 扩展完全合成 Mock，覆盖官方 fetch、scheduled/cron、运行日志、queue/other、unknown、trigger、嵌套 request、HTTP 状态码缺失、冲突值 fail-closed、恶意查询串和 source 不泄露、旧 fixture 兼容；代码+测试 HEAD `23d204a03367b118f948d871ec6ce91048c9a182` / [Actions #42187250709](https://github.com/wovowx/mcp-memory/actions/runs/42187250709) **SUCCESS**；Router/Registry **207/207**、Memory Core 120/120、Session/Core 56/56、Reflection 35/35、JS 43 文件 check PASS。版本及 Bridge 最终 HEAD 将再次验证。
- 真实日志 E3 需要本版经**独立版本发布批准**后才能由生产 API 确认。即使查询返回 `event_kind=http` 和 `POST /mcp`，仍需同一 trace/request ID 才能精确关联某一次 MCP 调用；不宣称已解决 OpenAI 安全拦截原因。
- 回滚基线：生产 v6.47.0 main `bedaa2b2dd0e71a3a52cc43af9b4b906ed253a82` / Worker #541 deployment `42551af3`，未主动修改生产。要发布需重新报告最新 dev/main 差异、CI、回滚信息并经柳柳明确同意。

---
## [v6.47.0] - 2026-11-06（Workers Logs 持久化配置 · 已发布 PR #334 / Worker #541 VERIFIED；以下 dev 候选措辞为当时历史快照）

### 用户收益与原因
- 让已上线的 `cloudflare_logs_query` 能读取 **Workers Logs 历史存储事件**，而不仅能成功调用查询 API 却收到 `EMPTY`。在新工具 v6.46.0 的宿主 E3 中，ChatGPT 工具发现和实际查询成功，但两次最近15分钟查询均为 `EMPTY`（0 条），期间发起了一次虚构 key 的正常 `memory(recall)` 控制请求；尚不能断定是存储未开、采样或查询字段不匹配。
- `wrangler.toml` 原先没有显式的 Workers Logs 存储/Invocation 设置。Cloudflare 官方 Query Builder 文档给出 `[observability] enabled=true` 和 `[observability.logs] invocation_logs=true`；本候选另将 `head_sampling_rate=1` 显式定为 100% 采样，便于短时间请求关联。只有未来经柳柳单独批准并部署后，该设置才可能影响生产日志。

### 变更与验收边界
- **只改 dev** 的 `wrangler.toml`（增加可回退的显式日志采集设置）和 `tests/router_registry_contract_test.mjs`（不联网、读取配置文件，验证唯一日志块/100% 采样、原 cron 保留、无 Secrets 写入），以及本版本号/CHANGELOG/Bridge。没有更改真实 Worker 的 Dashboard 设置或 Token。
- GitHub Actions 精确最终 HEAD CI 在后续桥接记录中回读；本轮先前纯配置+合同测试 SHA `2cf764793e1ced948a878105b9fce549299f8f37` / [CI #42183329820](https://github.com/wovowx/mcp-memory/actions/runs/42183329820) `SUCCESS`。不能把合成 E1/E2 叫作真实 logs E3；也不保证 EMPTY 的唯一原因就是存储开关。
- **生产影响与风险**：一旦被未来独立版本许可合入 `main`，Cloudflare Git 集成会重新部署 Worker，开始持久保存调用日志；这与此前仅看 Live Tail 不同，会产生存储用量及可能的费用，也涉及运行元数据留存。Cloudflare Workers Logs 计费/保留按账户计划及未来政策而异；生产是否启用与采样率应让柳柳明确验收。
- 回滚基线为正式发布的 `v6.46.0` / main `2c94f0444ee5d56c39739beca73abd7496921610` / Worker #540 deployment `f710f2b7`。不直接 push/main、不创建自动部署、不开生产日志、不读取真实正文或私密日志、不改 DB/skills registry/聊天室/密钥。

---
## [v6.46.0] - 2026-11-06（Cloudflare Observability · 已发布 PR #333 / Worker #540 VERIFIED；以下 dev 文字为发布前快照）

### 柳柳能得到什么
- 哥哥以后可以直接通过 Ziven MCP 的 `cloudflare_logs_query` 查看 `mcp-memory` 最近 1–60 分钟**已经存储的** Worker 日志元数据，省去反复要求柳柳人工打开 Cloudflare Live 截图。默认 15 分钟、最多返回 20 条；查询上限 50 条，支持已取回事件中的 `all|error` 过滤。
- 当前只有工具代码和合成 Mock 已完成；**真实 Token 是否具备新版权限、Workers Logs 是否启用持久化均未 E3 验证**。实时 Live Tail 不是该 API 的历史存储查询；没有日志并不能证明请求没到达 Worker。

### 实现与边界
- 复用 `src/tools/cf_proxy.js` 的 Bearer Header 原子方法；在该文件增加固定账户变量 `CLOUDFLARE_ACCOUNT_ID` 和 `CLOUDFLARE_API_TOKEN` 的受限场景入口 `handleCloudflareLogsQuery`，仅访问官方 `POST /accounts/{account_id}/workers/observability/telemetry/query` 临时查询 API，`dry=true`，`view=events`，服务器筛选 + 本地再次验证 `$metadata.service=mcp-memory`。
- `src/modules/mcp_router.js` 通过 tools/list 的静态定义和同一 dispatch Schema 合法开放工具，`readOnlyHint=true`、`destructiveHint=false`、`openWorldHint=true`，并**排除技能 usage 自动打点**，保持整个调用真正只读；没有把旧的多权限 `cf_proxy` 暴露给宿主。
- 输出仅含时间、Worker 名、可识别的 HTTP method、限于 `/mcp` 或 `/` 的路径、有限 HTTP status、outcome 和不敏感追踪 ID；不返回原始日志 message/source/headers/body、查询参数、密钥或完整 URL。错误状态明确 `OK|EMPTY|UNAVAILABLE|ERROR`，不伪造统计或网络行为。
- 不改现有 Cloudflare Token 内容/权限、Wrangler Observability 配置、Supabase Schema/skills registry、真实业务记忆、聊天室、唤醒、生产 Worker 或 main。

### E1/E2/部署许可
- `tests/router_registry_contract_test.mjs` 增加纯 Mock：固定 API 范围、只读请求、15 分钟窗口、限量、局部/服务端双层 Worker 筛选、机密字段脱敏、空结果/403/500/坏 JSON/错误事件处理、公开 tools/list Schema+Annotations、旧工具隐藏、dispatchGuard 及无 usage/registry 写。
- 复用原有 `learning-regression` GitHub Actions 及 `npm run check`；本版最终 DEV HEAD 和对应 CI 在交接时精确记录。**dev E1/E2 不等于已经能从 ChatGPT 调用**。
- 柳柳同意日志自查工具化方向、更新 Cloudflare Token 权限并要求哥哥推进开发，但未逐版本批准 v6.46.0 的 PR/main/自动部署。正式发布前须说明本版可感知收益、净 diff/测试、Worker 影响及 v6.45.0 回滚参考并等待明确授权。

## [v6.45.0] - 2026-11-06（L4 Archive v0.1 · 已发布 PR #332 / Worker #538 VERIFIED）

### 用户收益与实现
- Ziven 对已知完整记忆 key 可以按需查过去的版本和事件，明确区分当前有效、软删除和其他非当前记录，历史仅用来解释过去，不自动恢复成事实。
- 复用 `src/modules/memory/repository.js:getMemoryHistoryByKey/getMemoryEvents` 与 `src/tools/memory_unified.js:handleMemoryTool(history)`；没有新数据库表或平行 Archive 工具。历史读取结果明确 `history_status=OK|EMPTY|PARTIAL|ERROR`，保留 record ID、version、source_ref、记录时间和旧/新值片段。缺失事件、损坏返回、来源或 `new_value` 不再被伪装成完整历史。
- 扩展 `src/utils/helpers.js:withMemoryTypeSchema` 公开 memory 的 `history` action，工具发现与 dispatch 使用同一 Schema；`src/modules/mcp_router.js` 添加可发现说明，未修改 Supabase skills registry；`src/skills/guide/记忆管理/SKILL.md` 添加按精确 key 追溯与证据缺口纪律。

### E1/E2、兼容与授权边界
- 扩展既有 Router/Registry 与 Memory Core synthetic 回归：检查 tools/list 与 dispatch 一致、旧 action 保留、注册表无需写入、旧/新事件值兼容、deleted 历史可见、证据 gap、records ERROR、events PARTIAL、只 GET 不写业务表、普通 current-only 路径不退化。复用现有 CI，无新测试框架或 MCP 工具。
- 柳柳已确认 L4 v0.1 A 方案并批准 dev 编码与隔离测试；**没有批准 PR/main/Cloudflare 发布**。生产仍 v6.44.0 / Worker #537，宿主工具元数据需要在正式获准发布后再验收/必要时刷新。源代码/Mock CI 不能冒充真实宿主 E3。
- 不修改数据库 Schema/实际记忆、skills 注册表、聊天室、唤醒、密钥、Operit 或 Pages；无真实私人历史读取。普通 recall/search/Core 仍 current-only。`memory` 工具现有 usage 计数副作用不在本切片改动范围内；只承诺历史仓储 GET-only。

## [v6.44.0] - 2026-11-06（L3 Reflection v0.1 · 已发布 PR #331 / Worker #537 VERIFIED）

### 新能力与用户收益
- 从「记录教训」进化到「候选反思有证据、有状态、可审核」：复用现有 `tests/learning/*.json`，区分学习工件的 `status=candidate` 与反思成熟度 `pending/validated/rejected/deferred`。未验证或有未处理反例的内容不生成晋升提案。
- `src/modules/reflection.js` 提供无副作用 `validateCandidate`、`decideCandidate`、`previewPromotion`、`evaluateReflectionCandidates`。validated 且具备可追溯来源/验证引用时仅输出 `ready_for_review` 预览，`approval_required=true`、`executed=false`；不写 Memory/Skill/Workflow，不新增 MCP 工具。
- 新增合成候选 `tests/learning/learning_reflection_candidate_001.json`；`npm run reflection:preview -- <artifact.json>` 可读取候选并查看惰性建议。不把合成数据或来源字符串当作真实证明。

### E1/E2 与范围边界
- 新增 `tests/reflection_contract_test.mjs` 与 `npm run test:reflection`，检查缺来源、无效状态/目标、缺支持证据、缺验证引用、反证未处理、pending/rejected/deferred 禁止晋升、重复 ID 不重复预览、未修改输入和零网络/数据库写入；同时扫描全部带 reflection 的 learning 工件，确保后续新候选进入 CI。该步骤已纳入 `.github/workflows/learning-regression.yml`；精确最终 SHA 的 CI 结果另行回读。
- 只改 `mcp-memory/dev`：不新增数据库表/字段/依赖、自动反思调度或 MCP Facade；未写生产记忆、Skill 注册表、聊天室；未创建 PR/合 main/部署 Worker。合成 E1/E2 只证明状态合同，**不等于真实 Agent 已学会或宿主 E3 通过**。下一次正式发布须柳柳根据本版本收益、净 diff/CI、回滚与部署影响单独批准。

## [v6.43.0] - 2026-11-06（Memory Retrieval Reliability + Memory Type + Session Core v0.2 · dev 候选）

### Added
- 扩展现有 \`session_context\` 的可选 \`include_core:boolean\`，默认 false；仅显式 opt-in 返回 CORE-0.2 五个权威来源块，旧 \`session_bootstrap\` 与旧 \`session_context\` 摘要调用不泄露私人全文。
- 复用同一份五源只读快照，避免 Bootstrap 与 Context 重复读取检查点；完整提取当前检查点覆盖段，历史覆盖层不进入 Core。
- Core 采用 24,000 Unicode code points 完整块预算：身份/当前工作优先，其次主档、协议、导航，topic 摘要最后；预算不足整块省略并给出来源/原因/补读边界，不硬切内容。
- 检索可靠性：主记忆源读取失败返回 ERROR，不再伪装成零结果；别名索引失败返回 PARTIAL 并保留直接命中；统计失败明确报错，不显示假零值。
- 新增 16 条合成查询的固定检索基准，检查直接召回、负例误命中、过期记录排除、关联来源准确性与 GET-only；相对冻结基线只允许不退化。仅用合成数据，不读取真实用户记忆。

### Regression and authorization boundary
- E1/E2 合同覆盖旧调用兼容、tools/list Schema 与 dispatch 校验、五源单次 GET、完整块与历史排除、Unicode code points、末尾限制、预算降级、topic 预算、缺失/错误与零写入；Memory Core 覆盖类型写入/保留/历史快照/导入导出；检索基准覆盖 16 条合成查询。最终候选 SHA 与 CI 记录见本节更新后的验证证据。
- 仅 \`mcp-memory/dev\` 候选；不改 Supabase registry、数据库 Schema、真实业务记忆、聊天室/唤醒、main 或 Worker 部署。ChatGPT/Operit 实际接收与冷启动仍需后续分别验收。

## [v6.42.0] - 2026-11-06（Memory Type Write Contract · 纳入 v6.43.0 累积发布）

### Added
- `memory` 工具增加可选顶层 `type` enum：`fact/quote/inference/agreement`。Worker 代码层共享 helper 同时扩展 tools/list 对外 Schema 与 dispatchGuard 校验，不写 Supabase skills 注册表、不修改数据库 Schema。
- `remember` 仅在明确传入合法 type 时持久化；旧宿主省略时保持 SQL NULL。`update` 仅在显式传入时修改 type，省略时不发送 type 字段；`type=null` 不作为清除指令。
- 显式修改 type 时，沿用 `memory_events.old_value/new_value` JSONB 保存 `{value,type}` 新旧快照；History 同时兼容旧 string 与新 object 事件。Recall/Search 对 NULL 显示“未标注”，未知历史值显式显示“未知类型”，不再把缺失 type 伪装成 fact。
- Memory Transfer 导入/导出保留合法 type；旧导出缺少 type 或为 NULL 时不清除目标记录已有类型，新建记录保持未标注；拒绝未知枚举值。
- Memory Management Skill 改为顶层 type 规则：agreement 必须由柳柳明确确认，inference 明示不确定性；不再要求把 type 写在 value 内，也不再默认 agreement。

### Regression and authorization boundary
- 新增 Router Schema/dispatch 与 Memory Core 的 Mock 合同，覆盖 optional enum、非法枚举零写入、typed/untyped remember、update 保留/显式修改、NULL/未知类型展示、legacy/new history snapshots、transfer import/export。
- 候选代码仅写入 `mcp-memory/dev`；E1/E2 最终累计候选验证统一记录在 v6.43.0 发布证据中。所有测试使用隔离 Mock/synthetic 数据，不写真实记忆。
- 不修改 Supabase skills 注册表或数据库 Schema，不批量重标历史数据；不改 main、不创建 PR、不部署 Worker；E3 NOT RUN。Skill loader 仍从 main 读取，因此 dev Skill 候选需随未来获批发布才会在线生效。


## [v6.41.0] - 2026-11-05（Memory Association v0.1 · 已发布：main 5e4cf739 / Worker #535 VERIFIED）

### Added
- 在原 `searchMemories` 中复用已有有效态仓储与关键词/别名/CJK fallback 检索：直接结果后最多补3条一跳关联，优先显式 `related_memory_ids`，再按共享业务 `entities` 补齐；去重、保留直接命中排序、排除非当前记录和仅通用称谓造成的误关联。无直接命中不凭空生成关联，不做时序/情绪猜测。
- 关联结果保留旧 `_match.reason`，追加来源 `related_from_key`、共享实体 `matched_terms`；现有 `memory.search` Facade 在结果中显示来源和共同实体，不新增工具、Schema、数据库字段或依赖。

### Regression and authorization boundary
- 柳柳已明确同意 `v0.1` 需求/文字原型；已先更新整体架构 v1.12 与 Roadmap v1.34。本地 `npm run check`、Memory Core 69/69、Router/Patch 162/162、Session/Context 36/36、learning 9 个工件均 PASS；精确最终 `dev` SHA 的远端 CI 与线上 E3 将独立回读，未取证前标 PENDING/NOT RUN。
- 仅授权 `dev` 实施与回归。**未授权** PR、`main` 合并、Cloudflare Worker 部署、生产 DB/schema、聊天室/唤醒、Operit 卡、Web/Pages/DNS、密钥或付费测试。下一次 main 发布须另报精确版本/变更/CI/影响并获柳柳同意。

## [v6.40.1] - 2026-11-05（MCP Tool Discovery Read-only · 已发布：main c9324b4f / Worker #534 VERIFIED）

### Fixed
- `tools/list` 不再调用隐式的 `syncChatTools(env)`，防止 ChatGPT/其他宿主刷新工具清单时因聊天室 Skill 缺项而向生产注册表 POST。该请求现在只读取已有技能清单，并在结果中补充独立静态 `session_bootstrap` / `session_context` 工具定义；不会写 `skills`、usage、记忆或聊天室数据。
- 保留原已注册工具的名称/Schema/路由，保留原有 `tools/call` 显式聊天室分派和 `syncChatTools` 行为（未修改任何聊天室业务工具）。未注册的聊天室工具不会再由**发现请求**自动创建；如其缺项，属于暂停领域的独立治理事项，不在本次修复范围内。

### Regression and authorization boundary
- 柳柳明确批准在 `dev` 做这一最小只读发现切片；整体架构 v1.9、Roadmap v1.30 已先于代码更新。本地 `npm run check` exit0，Router/Registry/Patch **162/162**（新增5项：零写入、保留已注册聊天工具、缺项不补注册、重复发现稳定、两个静态恢复入口唯一）、Session/Context36/36、GitHub Contents50、Memory Core60、Search20、Webhook/Agnes114、Learning9工件 PASS。全部为离线 E1/E2，GitHub CI 与真实宿主刷新 E3 以最终 dev SHA 另行验证。
- **发布证据**：main `c9324b4f2e4013ed1e7edcd455bb40450a5b8dfe`；Cloudflare Worker #534 / deployment `a4994702`，`verify_main=VERIFIED`。发布未包含宿主插件刷新、生产 DB/schema、聊天室 handler/Agent 唤醒、Operit 卡、Pages/Web 或密钥操作。

## [v6.40.0] - 2026-11-05（Session Context v0.1 · dev 发行候选，尚未申请 main 发布）

> 下方为正式发布前原始测试快照；后经柳柳逐版本批准，v6.40.0 已由 PR #327 squash 合 main=f48f92c24867836079440d2e2118f9b2e7d16056，Worker #533 / cc0abc9d verify_main=VERIFIED，显式 session_context 线上 E3 返回 SC-RUNTIME-0.1/READY。发布全证据见 Bridge，旧「未部署」表述仅作历史保存。

### Added
- 新增只读 MCP 场景工具 session_context（contract_version=SC-RUNTIME-0.1）。在现有 MCP 激活前提下复用 Session Bootstrap 对权威身份/检查点来源与状态的核验，再精确读取唯一当前检查点的工作阶段、下一步、禁止重复、decision/evidence 有界摘要；仅在提供有效 topic 时调用 Memory Core 检索最多3条当前有效关联记忆，附来源、match_reason、截断标志；不把历史覆盖层、关联线索、缺失决定当成柳柳的当前决定。
- 与 session_bootstrap 保持工具名、Schema、READY/DEGRADED/BLOCKED 状态和隐私契约互不替换；新增场景不输出私人主档全文、不自动授予执行权限，不探测 Worker tools/list、不会写业务记忆或增加 usage_count。新入口可用不代表第三方宿主会自动调用。
- 仅修改 src/modules/session/bootstrap.js、src/modules/mcp_router.js 与 tests/session_bootstrap_contract_test.mjs 三个既有代码/测试文件，复用 Memory Core repository/retrieval，不新建存储/路由架构、不改聊天室、唤醒、数据库 schema、Operit 卡或 Pages。

### Regression / boundary
- 在已批准的整体架构 v1.7 与 Roadmap v1.27 先行定义原型后仅于 dev 实现；本地 npm run check exit0、Session Bootstrap+Context 36/36、Router/Registry/Patch 157/157、GitHub Contents50/50、Memory Core60/60、Search History20/20、Webhook/Agnes114/114、Learning9工件 PASS。额外误调用一个不存在的 release_guard_test.mjs 返回 MODULE_NOT_FOUND，不计入真实回归；现有 Release Guard 行为受 Router/CI 覆盖。
- 三文件 dev 代码提交 SHA 61ae5b1edc602088e2ade09ce88bc1135818cbca 的 GitHub Actions [42011251463](https://github.com/wovowx/mcp-memory/actions/runs/42011251463) completed SUCCESS，validate 全部步骤通过；后续 package/CHANGELOG/Bridge 的最终候选 HEAD 需单独核实 CI，不能继承该 Run。
- 线上 E3 NOT RUN：主线目前仍为 v6.39.1 Worker #532 VERIFIED；新功能尚未部署、未获柳柳逐版本 main 发布批准。真实 host 初次自动触发、私人身份全文装载和 P2 严格恢复缺口均不是本版已验证效果。

## [v6.39.1] - 2026-11-05（Text Skill Read-only Routing · 已发布 Worker #532 VERIFIED）

### Fixed
- 修复非聊天室文本 Skill 在 `tools/list` 可见、但 `tools/call` 报 `handler type not implemented: text` 的实际缺陷（例如 `master-router`）。仅在既有动态分发的 `handler_type=text` 分支添加只读 SKILL.md 加载；原有 JS/MCP 工具、Schema、Facade、权限门槛与聊天室调用路径不变。
- 复用既有 GitHub Contents `getContent` 原子读取，从已发布 `mcp-memory/main` 取得安全 `src/skills/**/SKILL.md` 的完整 UTF-8 正文，避免公共 `github_read` 默认 12000 字符限制截断；限制文件类型/路径与大小，缺文件/解码错误/跨目录路径返回明确失败，不执行 Markdown 指令本身。
- 纯文本 Skill 读取不触发 `usage_count` 自动写入；其他业务工具的已有使用统计保持原行为。

### Regression / release boundary
- 本地实际运行 `npm run check` exit 0；Router/Registry/Patch 157/157、GitHub Contents 50、Memory Core 60、Search History 20、Session Bootstrap 21、Webhook/Agnes 114、learning 9 工件全部通过（隔离 Mock/E1/E2，不等于真实线上 E3）。远端 dev 两个代码文件与本地已按精确 Git SHA fetch + diff=0 核对；版本候选 SHA `8a6b668aff2ca338bb151599993cf9a0706f2482` 的 GitHub Actions learning-regression [run 42005920662](https://github.com/wovowx/mcp-memory/actions/runs/42005920662) **SUCCESS**，`validate` Job E1/各项 E2/学习工件均成功。此后若仅更新本段 CHANGELOG，最终文档 HEAD 的 CI 仍须重新确认，不提前继承成功。
- 相对已部署的 v6.39.0 主线，业务变更仅 `src/modules/mcp_router.js` 与 `tests/router_registry_contract_test.mjs`；候选随版本正常更新 `package.json` 与 `CHANGELOG.md`，另外含既有 `CROSS-HOST-BRIDGE.md` 纯交接文档。无新增数据库迁移/服务或操作工具，未触及生产 DB/schema、聊天室/唤醒、角色卡、Pages。
- **发布前历史快照（已被本条覆盖）**：当时仅 dev 候选，需要逐版本授权。此后柳柳单独批准 v6.39.1 的精确 premerge 恢复引用、squash main、Cloudflare 自动部署和只读 E3；PR [#326](https://github.com/wovowx/mcp-memory/pull/326) merged，main=e0b0fc43690d543d5ddda754b08b57f55cf22037，Worker deployment 26774ef7/#532 verify_main=VERIFIED，现场 master_router 返回 TEXT_SKILL_LOADED 完整正文，main Actions 42007801917 SUCCESS。此项已收口，不是当前待审批任务。

## [v6.39.0] - 2026-11-05（P2 Session Bootstrap v0.1；已获柳柳逐版本批准并部署 Worker #531 VERIFIED）

### Added
- `src/modules/session/bootstrap.js`：无状态 Session Bootstrap 场景能力，复用 Memory Core current-only repository 与 retrieval stats，精确读取 `🧬/我是谁`、`💕/关于柳柳`、记忆位置导航、`⚙️/当前工作检查点`、SB-1.0。标准化返回 `SB-RUNTIME-0.1` 与 `READY|DEGRADED|BLOCKED`、来源证据、实际记忆统计、最新检查点的 workflow_state/next_action、宿主能力申报可信度及权限边界；不返回私人身份/主档全文，不授权任何业务写入。
- `src/modules/mcp_router.js` 最小接线：新增静态 `session_bootstrap` 工具名及固定 schema、工具调用分发与 tools/list 静态声明，无新增 skills 表行或 Registry 业务写入；仅该入口跳过 `autoIncrementUsage`。其本体不调用 Worker `tools/list`；当前已知 tools/list→syncChatTools 注册副作用仍存在，本版不改聊天室代码。
- 既有 `src/skills/process/huan-kuang-liu-cheng/SKILL.md` 加入 ChatGPT/Operit 宿主适配：可调用新入口时获取恢复证据，仍需宿主加载完整 persona 并核对权限；入口未暴露时回退 SB-FRAME-1.0 逐项精确读取。只有已独立证实的 startup hook 能声称自动冷启动，MCP 不能单方控制第三方 App。

### Regression and limits
- 新增 `tests/session_bootstrap_contract_test.mjs` **21 项合同** + `npm run test:bootstrap`；将 E2 Bootstrap 步骤接入现有 GitHub Actions CI。涵盖最新/历史快照、active_focus/next_action/do_not_repeat 工作状态字段、超过30天陈旧或无效时间戳的降级、精确 key、身份或 checkpoint 缺失、stats 失败、辅助来源缺失、异常、schema 拒绝、仅发 GET、不探测 tools/list、不自动 usage 写入、不泄露私人身份/主档全文、不擅自授予权限。
- 源码测试 `mcp-memory/dev` SHA `94da9ef205a9de5765e75c01140f0de3245f575b` 的 learning-regression `41977307272` SUCCESS：E1/全部 E2（P2 19/19，Router/Patch 154/154、其余回归）通过；最终候选 SHA 与 CI 需版本化完成后独立回读。
- 真实 ChatGPT/Operit 首轮自动触发、插件工具刷新、实际 MCP endpoint / 生产数据读取、完整人格装载及跨宿主首轮一致性 **E3 NOT RUN**；本版没有推 main / 部署 Worker。过去 A6/A7 的限定证据不能迁移为本版 E3。
- 本轮不触碰聊天室、唤醒链、Agent Runtime、生产数据库/schema 或权限配置；对外开放、发布与 Cloudflare 自动部署需要柳柳逐版本另行批准。

## [v6.38.0] - 2026-11-05（P1 Domain Boundaries，dev 发布候选，未合 main）
### Refactored
- GitHub Branch/PR 统一收敛到 `src/modules/github/branch_pr.js`：分支 ref 创建、精确 SHA 恢复、普通同步、PR 创建/读取/关闭/合并、`github_merge_to_main` 复合流程与「仅 merged=true 且 dev→main 才允许同步 dev」门禁。保持工具入口、Schema、允许仓库校验、返回字符串和旧测试导出 `restoreBranchReference` 不变。
- `github_apply_patch` 已批准 proposal 的多步执行改由 `src/modules/patch_workflow.js` 编排，原子 patch 校验/target policy 继续复用 `src/modules/patch_engine.js`；保留 claim、HTTP/部分成功/未知状态及 rollback_sha 等既有语义。
- `src/tools/github_v64.js` 保留稳定对外 Facade、GitHub Contents 适配、注册及认证/发布门禁，将 Branch/PR 与 Patch 的内部流程委托领域模块；未变更 `src/modules/mcp_router.js`、Memory Core、聊天室/Agent 唤醒或 Supabase schema。

### Regression
- 在既有 GitHub Contents 测试增加 Branch/PR 独立模块工具名与拒绝缺参的合同；在 Router/Patch 测试增加 Patch workflow 在网络调用前拒绝无 proposal_id、main 分支和未授权仓库的合同。
- 集成后 dev 源码 SHA `158cdc036f48f80ca86730a03a6a087e3fd36cd0` 对应 GitHub Actions learning-regression `41971350369` **SUCCESS**：E1 static/import；E2 GitHub Contents、Webhook/Agnes、Memory60、Search20、Release Guard、Learning artifacts、Router/Registry/Patch 154/154 PASS。正式发布候选最终 SHA 与 CI 另行回读。
- E3 真实 GitHub PR/ref 合并、生产 Supabase Patch 写入与部署行为 **NOT RUN**。本版本尚未获柳柳逐版本 main 发布批准；不自动合并或触发 Cloudflare 部署。


## [v6.37.0] - 2026-11-05
### P0 Core Modules Recovery（恢复已完成但被历史 dev ref 移动遮蔽的开发切片）
- 恢复 Memory Core 四模块（repository、lifecycle、retrieval、transfer）和 memory/category/data 工具 Facade，保留原有工具名和调用契约，修复失败与部分写入结果的传播。
- 将 Agnes Provider、文件 Storage、受限 DDL Parser、Cloudflare Worker Status 和 Patch Engine 已完成的领域实现接回现有工具入口。未改聊天室与 Agent 唤醒逻辑。
- 在 mcp_router.js 中恢复非聊天室工具的 Schema/工具列表声明、create_patch_proposal 使用统计与未注册 supabase_ 前缀拦截，保留原有 Chat 分派路径。
- 复原发布守门、部分辅助模块与相关恢复/部署 Skill；保留 v6.36.2 GitHub Contents、PR metadata fail-closed 合并保护和 dev exact-SHA 恢复入口。未改变 Cloudflare 生产数据库或 Supabase schema。

### Regression（发布候选，尚未合 main）
- 恢复/扩展 Memory Core、Router/Registry/Patch、Search History、Webhook/Agnes、GitHub Contents 合同及 CI 工作流。非聊天室 Router 的七项既有失败已修复，测试未删除或跳过。
- 恢复代码 dev SHA `d298162cca89c938d15a8f63b3c9dbb609830d61` 对应 GitHub Actions run `41967030788` SUCCESS；仅追加交接文档后的 dev SHA `d2a48a7591ac46c9ac914acd3a9f8c11d126b57a` 对应 run `41967483491` SUCCESS。v6.37.0 候选自身的 CI 以实际最终 SHA 为准，独立回读后报告。
- 此处的证据属于 E1 静态与 E2 Mock/合同；真实 Supabase、Agnes、Cloudflare、GitHub PR/ref 等端点 E3 NOT RUN，线上部署 NOT DONE。
- 恢复前 dev `512519efbdbb828a9881447fd4c2e218d04fb8a1` 已保护在 `recovery/p0-preintegration-20261105`；更早 dev `4aa0cd0360466743ca8ace7a79841efc0cdcc205` 仍可按 SHA 读，但暂未建立独立 ref。P0 只集成指定领域，不声称历史 432 个独有提交全部恢复。


## [v6.36.2] - 2026-11-05
### Fixed（Branch/PR 自动同步保护）
- 仅在从 GitHub PR metadata 确认 PR 已合并且 head.ref=dev、base.ref=main 时，才允许合并后同步 dev。
- scoped release、hotfix、其他 head/base、PR metadata 读取失败/解析失败/字段不完整、未确认 merged=true 或 main SHA 无效时均 fail closed，不移动 dev。
- 两个合并入口统一传递 PR 编号并执行同一守门逻辑；工具名、Schema 与既有调用入口保持不变。

### Regression
- 将 11 项 Branch/PR auto-sync 合同测试纳入 main 已有的 GitHub Contents contract 测试入口；不修改 CI workflow。
- 候选 PR #322 的 CI run #831（`41947439304`，代码/测试 SHA `81c54096a18d76925ab7600769a728fe822967e1`）：learning-regression 全部步骤 SUCCESS；E1 `npm run check` PASS；E2 GitHub Contents contracts、webhook regression 与 learning artifacts 均 SUCCESS。
- 上述 CI 后仅追加本 CHANGELOG 验证记录；源码与测试未变，最终 PR head 将再次执行完整 CI。真实 GitHub PR/ref auto-sync E3：NOT RUN。

## [v6.36.1] - 2026-11-04
### Fixed
- 修复 Cloudflare Worker 中 GitHub Contents 请求调用全局 fetch 时丢失 receiver 导致的 `Illegal invocation`。
- 为 `github_sync_branch` 增加仅限 `dev` 的精确 SHA 恢复模式：校验目标 commit、预期当前 HEAD，并在更新后回读验证；普通分支同步路径保持不变。
### Regression
- 新增 fetch receiver 与 dev 精确恢复的契约测试；CI 结果将在发布验证后补录。

## [v6.36.0] - 2026-11-04
### Changed（GitHub Contents 领域收敛）
- 新增 `src/modules/github/contents.js`：集中 GitHub Contents 原子操作与 push/edit/delete/copy/move 工作流；保留既有工具入口、Schema 和非 Contents GitHub 能力。
- 非发布写入 fallback 统一到 `dev`：push、delete、copy.target_branch、move.source_branch/target_branch；copy.source_branch 只读来源仍默认 `main`。
- Router 写保护与 Release Guard 的写入 fallback 均与 handler 对齐；push/edit/delete/copy target/move source+target 默认 `dev`，显式写入 `main` 仍然拒绝。

### Fixed（完整性与部分成功语义）
- push 仅将 HTTP 404 视为目标不存在；其他读取错误中止写入。
- push/copy/edit 使用 SHA 或精确内容回读验证，支持零字节文件和有界重试。
- move 对截断目录树采用保守枚举；无法证明清单完整时不开始写入。源文件变化或步骤失败时保留源并报告部分结果。
- 保持既有工具名、参数 Schema 与 copy/move 成功响应字段兼容。

### Regression
- GitHub Actions run #794 (`41798715712`): all jobs SUCCESS.
- E1 `npm run check`: PASS; GitHub Contents contracts: 31/31; webhook/router regression: 106/106; learning artifact regression: PASS.
- These are static/mock contract and regression checks; real GitHub endpoint E3 has not been run.

## [v6.35.0] - 2026-10-26
### Fixed / Changed（MCP 路由、记忆与工具契约收敛）

- 发布定位：本版本收敛路由与工具契约，作为后续「一本好书式架构」整理的可靠性基线；不代表整体架构升级已经完成。
- 恢复有边界的工具参数 schema 子集校验（type、enum、required、properties、items、minimum、maximum），由 Router dispatch guard 统一拦截无效参数；不宣称完整 JSON Schema 支持。
- 修复记忆写入与 rename/move/delete/import 的失败结果传播；HTTP、网络或部分写入失败不再误报成功，联想空结果有稳定兜底。
- 补齐文件查询/更新/删除和 skill 注册表写操作的响应校验，避免零行更新、部分失败或 HTTP 错误被误报为成功。
- 恢复 GitHub delete/copy/move/sync 的 main 写保护，并避免门禁拒绝、工具失败及 skill 管理操作被记为成功 usage_count。
- 移除 helpers.js 中无调用方的重复 buildErrorResponse 导出，保留其余辅助函数。

### Regression evidence
- `npm run check`: exit 0（31 个 JavaScript 文件语法与 import 路径检查通过）。
- `node tests/webhook_idempotency_test.mjs`: exit 0，104 通过 / 0 失败。
- `tests/release_multirepo_dev.mjs`: 6/6 通过。

## [v6.34.0] - 2026-10-17
### Added（CF API 代理工具 cf_proxy · 柳柳2026-10-17拍板）
- 新增 MCP 工具 `cf_proxy`：用 Worker 环境变量 `CLOUDFLARE_API_TOKEN` 代调 Cloudflare API（只执行、不暴露 token 明文）
- 用法：`cf_proxy(method, endpoint, body)` → 查账号/查 zone/建固定隧道/配 DNS/拿隧道 token 全自动
- 文件：`src/tools/cf_proxy.js`（新增）+ `src/modules/mcp_router.js`（handlerMap + 路由注册）
- 背景：配合 wovowx.win named tunnel（方案B 根治 Ziven 唤醒断链）；也用于前端网页/API 网关
- 发布版本 v6.34.0（2026-10-17）

## [v6.33.1] - 2026-10-16
### Changed（chat2api 发给 GPT 的 Ziven_MCP 工具头默认关闭 · 柳柳拍板）
- event_processor.js buildSystemPrompt：Ziven_MCP 工具能力头默认不注入（方案A：GPT 改走外包写代码，不连 MCP 调工具）
- 代码一字未删，用 env 开关 `GPT_MCP_HEAD=true` 控制——想用随时在 Cloudflare 配 env 恢复注入
- 修改用条件展开（spread）+ 保留行为规范/协同写代码流程原样

### Changed（记忆管理 skill 加「临时克制模式」· 柳柳2026-10-16同意）
- src/skills/guide/记忆管理/SKILL.md（v6.33.0）：记忆框架落地前临时克制——不乱造新分类/不存进度/暂缓主动存，只存真正需长期记住的

## [v6.32.15] - 2026-09-10
### Fixed（聊天室发一条显示两条）
- 根因：乐观占位替换要求内容逐字节相等才移除，带提及的内容经处理后不一致 → 占位未删 → 双显
- 修复：放宽为同作者未确认占位即替换

## [v6.32.14] - 2026-09-10

### Fixed（聊天室输入框遮挡根治 · 不依赖 dvh 支持）
- **根因（柳柳三连验证收敛）**：CSS `100dvh` 是较新单位，夸克/老 Chrome 不支持 → 回退 `100%`（布局视口高度）比可视区高 → 输入框（body 底部）被工具栏截在屏幕外。这不是键盘问题，是**浏览器视口适配**问题
- **修复（治本）**：JS 用 `visualViewport.height`（移动浏览器全支持）把 html/body 高度**精确强制为可视视口高度**——工具栏变化、键盘弹出时 resize 自动重新适配，输入框永远在可视区底部
- 保留：body/.app overflow:hidden（不随滚动跑）、messages 内部滚动、interactive-widget=resizes-content（键盘兜底）、focusin 预触发
- **最终架构**：CSS 负责聊天布局（grid+flex 结构），JS 负责把 body 高度钉死在可视区——双配合，跨浏览器稳定

## [v6.32.13] - 2026-09-10

### Fixed（聊天室输入框跟随页面滚动 · 柳柳报）
- **根因**：v6.32.12 把 body 改成了 `overflow-y:auto`——整个页面可滚动，输入框（.app 一部分）跟着滚走
- **修复**：body 和 .app 改回 `overflow:hidden`（页面锁定不滚），消息区 .messages 保留内部 `overflow-y:auto`（消息在内部滚）→ 输入框焊死在底部
- 同时修复过程中误删 body 样式块（background 渐变等）已恢复完整
- **正确结构**：body 不滚 + 消息区内部滚 + 输入框固定底部（聊天 App 标准布局）

## [v6.32.12] - 2026-09-10

### Fixed（聊天室输入框键盘遮挡 · 柳柳报）
- **根因**：chat.html 无键盘弹出处理——页面 `height:100%` 固定 + 只靠 `env(safe-area-inset-bottom)`（普通浏览器地址栏模式下≈0），键盘弹出时页面不避让 → 底部输入框被键盘盖住
- **修复**：① viewport meta 加 `interactive-widget=resizes-content`（Chrome/Edge 键盘弹出时自动 resize）；② 加 visualViewport resize 监听 JS（所有现代移动浏览器兜底：键盘弹出时自动把 composer 滚进可视区，含 focusin 预触发）
- 之前「好/坏」反复是因为页面从没处理过键盘场景，与缓存无关

## [v6.32.12] - 2026-09-10

### Fixed（聊天室输入框不可见 · 柳柳报）
- **根因①（柳柳指出）**：chat.html 用 `height:100%` + `overflow:hidden`——手机浏览器工具栏/地址栏占掉部分可视高度后，100% 超出可视区，且 overflow:hidden 禁止滚动 → 底部 composer 直接跑出屏幕外，**不打开键盘也看不到输入框**（这不是键盘问题，视口高度适配错误）
- **根因②**：键盘弹出时也无处理（safe-area-inset-bottom 在普通浏览器≈0），键盘盖住输入框
- **修复**：① `html,body` 及 `.app` 高度改 `100dvh`（动态视口高度，工具栏显示/隐藏自适应）；② body 改 `overflow-x:hidden;overflow-y:auto`（滚动兜底）；③ viewport meta 加 `interactive-widget=resizes-content`（键盘自动 resize）；④ visualViewport resize 监听 JS（键盘弹出时滚 composer 进可视区，含 focusin 预触发）

## [v6.32.11] - 2026-09-10

### Changed（help 输出增强 · skill 文件路径直接可见）
- **help() 清单每条 skill 直接贴 file_path**（柳柳 2026-09-10 点出：查 skill 不该多一步查表）——场景清单、完整工具清单、help(工具名) 单工具详情三处都拼上 `📄 路径`，有 file_path 的显示、没有的不显示
- 数据源未变（getEnabledSkills 本来就返回 file_path），只把字段拼进格式化输出——**不改行为，只改可见性**，哥哥找 skill 从「help→查表→读」三步缩成「help→读」两步

## [v6.32.10] - 2026-09-09

### Added（database.js Table Change Guard 工具化 · 数据库治理第三批）
- **create_table 强制 necessity**（柳柳 2026-09-09 铁律）：建表前必须过现有表 + 证明必要性，不传 necessity 直接拒绝（TABLE_CHANGE_GUARD_REQUIRED），并自动列出现有 21 张表
- **schema_dump action**：从 OpenAPI definitions 自动生成全表结构快照（md/json 格式），供 generated-schema.md 同步，不再逐张手摸
- 目的：把「加表/改表必须过现有表信息」从文档规则变成工具硬约束（Table Change Guard，与 release_guard 同思想）

## [v6.32.9] - 2026-09-09

### Changed（cloudflare 工具官方日志化 · 部署自愈增强）
- **cloudflare_deploy_status(verify_main=true) 增强**：DEPLOY_UNVERIFIED 时自动查官方 Builds（Git 集成构建）→ 构建 success 提示等传播 / 构建 fail 自动返回日志尾部（SyntaxError 文件:行号）——部署后一把梭，失败直接给根因
- **token 统一支持 env.cloudflare_key**（cfut_ user token，Builds API 专用；工具读 cloudflare_key || CLOUDFLARE_API_TOKEN）
- **deploy skill v6.6.4**：记录自动部署机制（Cloudflare Git 集成 push→main 自动构建部署，wrangler deploy --no-bundle）+ 官方日志权威化（不再依赖本地 node --check——script 模式漏 ESM 错误，v6.32.5-7 教训）

## [v6.32.0] - 2026-09-07

### Changed（github_move 默认目标改为 dev · 防误碰 main）
- **github_move 默认 target_branch 从 `main` 改为 `dev`**（柳柳 2026-09-07：别默认 main，危险！搬动走 dev，确认后再 merge main）
- **目标=main 的警告加强**：明确「默认应 target_branch=dev 搬动，确认后再 merge main；除非明确需要直接改 main（如文档仓打通），否则拒绝」
- source_branch 默认仍为 main（搬动源常是 main 当前版，合理）

## [v6.31.0] - 2026-09-07

### Added（知识洁癖自检内嵌 · 把「开智」变成每次必经）
- **master-router 步骤 2** 加「改文档/记忆/规则/项目文件前 → 知识洁癖自检（neat-freak 铁律）」：改前全仓 grep 看同一事实散在哪/哪个是现役 → 改完再 grep 确认无新旧并存；遵循「先减后加」「同一事实一个权威版本」
- **deploy skill release checklist** 加「本次改动涉及已有文档/事实 → 已做知识洁癖自检」硬闸门
- 目的：洁癖从「临时读 skill」变成「每次必经的自动一步」，覆盖哥哥所有改文档/发布场景

## [v6.30.0] - 2026-09-07

### Added（neat-freak 洁癖 skill 上传 · 知识治理收尾）
- 将本地 neat-freak skill（knowledge-governance）上传至 `src/skills/neat-freak/`（SKILL.md 15KB + references/ 4 件 + scripts/audit-inventory.sh）
- 用途：文件/文档/规则/记忆/工作区与代码真实运行态收敛，让下个会话从「唯一现役答案」开始
- 目的：把「洁癖开智」从临时读包变成常驻 skill，支撑聊天室文档治理等知识收尾场景
- （evals/ 测试资产未上传——是验证资产非运行时依赖，如需归档另行处理）

## [v6.29.0] - 2026-09-07

### Added（github_move 工具 · 递归移动文件/目录）
- 新增 `github_move` MCP 工具：移动/搬移 GitHub 文件或目录（内容不经 Agent 上下文，MCP 服务端内部搬运，复用 github_copy 的 size 校验）
- **源是目录** → 自动递归收集全部文件（git/trees recursive）→ 逐个 copy（size 校验）→ **全部成功后才删除源**（保证不丢，杜绝「搬一半源没了」）
- **任何一步失败** → 不删任何源，返回已复制清单（源保持完整可重试）
- 白名单校验（source+target 都过 GITHUB_ALLOWED_REPOS）+ target=main 警示 + overwrite 保护，与 github_copy 同级安全
- 注册进 GITHUB_TOOL_DEFS → 部署后 `github_auto_sync` 自动注册进 Supabase
- 目的：为聊天室项目目录整合（common-ground/architecture/xray/mvp 收进一个 chatroom/）提供一键搬移能力，替代手动 copy+delete

## [v6.17.0] - 2026-09-05

### Changed（发布流程硬约束化 · PR #131 标题重复转 Runtime Guard）
- **merge 策略默认化**：github_merge_to_main / github_merge_pull_request 的 merge_method 默认改为 rebase（不传不再走 merge → 标题不再重复）
- **merge 必须显式说明**：显式 merge 必须带 commit_title + merge_reason（hotfix/emergency/history-preserve），否则拒绝（MERGE_REQUIRES_COMMIT_TITLE / MERGE_REQUIRES_REASON）——核心修复是「不允许发布策略含糊」（GPT #749）
- **deploy verification 引入**：cloudflare_deploy_status 新增 verify_main=true 参数——自动对比 main HEAD commit vs 最新部署版本，返回 VERIFIED / DEPLOY_UNVERIFIED
- **Capability Guide 增加**：新增 code-runner-guide（本地执行能力）、database-capability-guide（数据库能力，不绑定 Supabase）
- **部署后必查（柳柳铁律）**：deploy skill 第 6 步 → merge 后 sleep 45s → verify_main 确认；DEPLOY_UNVERIFIED 必须查部署日志分析（?deployment_id / ?include=details）
- skill 同步：deploy v6.5.1 / github-use-guide v6.5.3

## [v6.17.6] - 2026-09-05

### Changed（浏览器挂插件通道 · GPT 原生 MCP 突破）
- chat2api skill 增加浏览器挂插件通道说明，记录新 conversation_id + GPT_MODEL 配置方式
- 验证 GPT App 挂载 MCP 插件后可通过原生 MCP 调用工具（ds_quota / github_read），无需文本标记 parser（整体验证结论，后续版本记录）
- 为后续 MCP 协同写代码流程提供真实 Capability Path

## [v6.17.5] - 2026-09-05

### Changed（GPT_MODEL 切换 gpt-5.6）
- GPT_MODEL 调整为 gpt-5.6，对接浏览器挂插件新对话模型（柳柳建议）

## [v6.17.4] - 2026-09-05

### Changed（GPT_MODEL 格式调整）
- GPT_MODEL 改为 gpt-4o-g-p- 格式，避免免费账号触发 gpt-4 拦截

## [v6.17.3] - 2026-09-05

### Changed（浏览器挂插件通道配置接入）
- wrangler 配置切换至新 conversation_id
- chat2api_client 支持从环境变量读取 GPT_MODEL

## [v6.17.2] - 2026-09-05

### Added（create_patch_proposal）
- mcp_router 增加 create_patch_proposal 工具
- 支持 GPT 在读取代码后提交结构化修改提案，而不是直接写入

## [v6.17.1] - 2026-09-05

### Added（Patch Engine MVP）
- 新增 patch_engine.js，实现 structured patch validate/apply 核心流程
- 增加 github_apply_patch 工具，支持受控 Patch 应用流程

## [v6.16.1] - 2026-09-05

### Added（Level 2 · Permission Guard MVP）
- patch_proposals 表（Supabase）：proposal 全生命周期 proposed→reviewed→approved→applied，含 evidence/risk/reviewer/approver/rollback_sha
- permission_guard.js：checkCapabilityAccess 四维校验（Capability+Target+Decision+Evidence）—— read 免费 / write 必须 approved proposal / main 永禁 / 非 dev deny / evidence 必填 / risk 分级（low=proposal / medium=+review / high=+柳柳确认）
- executeTool 接入 guard：GPT 发 github_push/merge 必须先过检查（受控对象硬闸门）
- 单测 10/10 通过（permission_guard）；负向验证 #735（无 proposal push → missing_proposal 拒绝，tool_source=permission_guard）
- README Architecture Proposal #448de374 全流程闭环：proposed→approved（ziven review+liuliu 确认）→applied（ziven 推 dev）

## [v6.16.0] - 2026-09-05

### Added（Permission Guard MVP 前置）
- patch_proposals 表建表 + README Architecture 提案入库（id=448de374）

## [v6.15.0] - 2026-09-05

### Changed（Level 2 Step 1 · MCP-only 强制）
- github_read 移除 Worker 内本地实现（fetch GitHub），强制走 MCP dispatcher → tool_source=mcp 铁证（#729）
- GPT 基于真实 README 内容产出 2 条 Patch Proposal（Level 2 Step 1 通关）

## [v6.14.6] - 2026-09-05

### Changed（GPT 认知壁垒突破）
- buildSystemPrompt 强化：明确「文本标记就是调用方式，Worker 是你的执行手，不需要持有工具入口」+ 列出已挂载工具名 + 禁止先询问可用性
- 效果：GPT #723 输出 echo 标记 → #725 ds_quota（tool_source=mcp）→ Capability Invoked 稳定可复现

## [v6.14.5] - 2026-09-05

### Fixed（parser 截断容错）
- extractJsonObject 滑动截断 + 补右花括号：chat2api 网关截断复杂 JSON 尾巴时的容错（7/7 单测通过）
- parser 对「解释文本+工具块混合/缺闭合」容错（#707/#709 实测）

## [v6.14.4] - 2026-09-05

### Changed（parser 失败明确标记）
- 解析失败不再伪装 echo：明确输出 __parse_error__ 标记（GPT #737/#739 诊断一致性）

## [v6.14.3] - 2026-09-05

### Added（部署日志增强 · 柳柳要求）
- deploy-status 端点增强：?deployment_id 查单次部署日志 / ?include=details 批量详情
- 部署排查 SOP 沉淀（v6.14.1 部署失败根因：反斜杠字面量损坏）

## [v6.14.2] - 2026-09-05

### Fixed（构建失败 10021 修复）
- extractJsonObject 反斜杠字面量 '\' 在传输中被损坏成非法 token → 改用 charCodeAt(0)===92 判断（#335 恢复部署）

## [v6.14.1] - 2026-09-05

### Fixed（parseToolCalls 鲁棒性 · Level 2 Step 1 实测暴露）
- extractJsonObject 智能提取：brace 配对 + 字符串感知（跳过字符串内 {} 与转义），忽略前置解释文本
- 完整标记内部也走 extractJsonObject（标记内夹文本也鲁棒）
- 无闭合标记容错改用 extractJsonObject（不再假设标记从行首开始）
- 修复 GPT 输出「解释文本+工具块混合/缺闭合」时 fallback echo（#707/#709 实测）

## [v6.14.0] - 2026-09-05

### Added（工具循环拆两段 B 方案 · 异步结论队列）
- 事件1（工具执行）：第一轮 chat2api → 工具调用 → Worker 执行 → audit/trace 落库 → 排结论任务 → 秒级 ack 闭环
- 结论任务（独立）：scheduled 扫 agent_tool_conclusions 表 pending → 独立 25s 预算生成自然语言结论 → sendMessage 写回
- 新表 agent_tool_conclusions（status: pending→processing→done/failed，重试×3 兜底）
- runToolLoop 返回 pendingConclusion 标记：pendingConclusion 时本事件不落库（结论异步写回）

## [v6.13.1] - 2026-09-05

### Fixed（chat2api tools 有损修复）
- 不再传 tools 参数（能力注入改回 prompt 文本，绕开 chat2api 网关截断原生 tool_call 问题 #695/#697）
- parseToolCalls 加容错：不完整标记自动补全、裸 JSON 保守解析（6/6 单测通过）
- capabilityTrace 加 injection_mode 标注真实注入方式

## [v6.13.0] - 2026-09-05

### Fixed（工具循环 wall-clock 预算管理）
- runToolLoop 加 27s 总预算（剩 3s 落库+ack），第一轮 22s、第二轮 8s
- 预算不足直接兜底（不再请求第二轮），保证落库+ack 在预算内
- capability_trace 提前到工具执行后立即落库（不等最终答复）
- chat2api_client 超时可配置（timeoutMs）

## [v6.12.1] - 2026-09-05

### Fixed（工具循环稳定性）
- chat2api 加 30s 超时（fetchWithTimeout AbortController）
- 工具循环第二轮失败用工具结果摘要兜底（不让事件烂在 processing）

## [v6.12.0] - 2026-09-05

### Added（Level 1 Capability Injection MVP）
- chat2api_client 支持 OpenAI tools 参数（MCP 能力以结构化工具声明注入）
- event_processor buildSystemPrompt/runToolLoop 把 MCP read 工具转 function schema 每轮传入
- capability_trace（discovered/filtered/injected/invoked/tool_source）落 agent_tool_calls 审计表
- GPT #691 审查补三点：payload trace、invoked/result 追踪、tools schema 是能力源 prompt 辅助

## [v6.10.2] - 2026-09-04

### Fixed（发布纪律修正 · 柳柳发现标题重复）
- 修正发布流程：合 main 必须 `merge_method=rebase`（不用默认 merge，否则 GitHub 把 commit_title 写两遍 → 标题重复）
- deploy skill v6.4.2：自检清单加「合并用 rebase + commit_title」，常见坑加「merge 不用 rebase → 标题×2」
- CHANGELOG 与线上对齐：v6.10.0（构建失败）→ v6.10.1（线上）→ v6.10.2（本次文档修正）

## [v6.10.1] - 2026-09-04

### Fixed（Release Guard 构建修复 · 已上线）
- release_guard.js v1.2.1：自测块 `typeof process` 防御（Cloudflare Worker 无 Node process，直接引用 process.argv 导致构建失败 code 10021）
- 线上当前运行版本（已验证 RELEASE_GUARD 真实拦截未版本化 push main）

## [v6.10.0] - 2026-09-04

### Added（Release Guard 入口接入 · Runtime 硬闸门）※ 本版构建失败，已由 v6.10.1 取代
- release_guard.js v1.2 落地为入口层硬闸门：src/index.js github_ 分支前置校验（不动 45KB github_v64.js）
  - github_push / github_merge_to_main / github_merge_pull_request 到 main 全部硬拦截
  - 未版本化发布 → ⛔ RELEASE_GUARD 阻断，不依赖记性（柳柳「放在角色卡也没用」→ 系统强制）
  - unknown repo 拒绝 / release policy 配置化 / docs 正则收紧 / repo normalize（GPT #528/#530 review）
- deploy skill v6.4.1：新增「本地与大文件操作」经验沉淀
  - linux 通道 = Shizuku 逃生通道（android 读本地失败时用 environment=linux + /sdcard/...）
  - 大文件禁止手写整份重推（45KB 必漏段，42643/45950 教训）
  - 卡死在单文件先找更优接入点，不绕圈子

### Changed
- 接入策略：release_guard 不改 github_v64.js（45KB 整文件替换风险高），改为小文件入口层加前置闸

### Fixed
- 大文件卡死循环：github_v64.js 重建漏段 → 用 github_copy 恢复干净原版，改走 index.js 入口接入

## [v6.9.0] - 2026-09-04

### Added
- 发布纪律（Release Discipline）双仓版本模型
  - mcp-memory（代码仓）→ 语义化版本 vX.Y.Z
  - ZivenLab（文档仓）→ 知识快照 docs-YYYY.MM
- change batch 概念：多个相关 commit 形成可交付主题才定版本
- release_owner 字段：明确谁判断「这批构不构成版本」
- 驾驶舱新增「发布与版本状态」章节
- ZivenLab 新建 common-ground/CHANGELOG.md（docs-2026.09 baseline）

### Changed
- deploy skill v6.4.0：发布纪律版，release checklist 硬闸门（不过不推 main）
- github-use-guide v6.5.0：Git 纪律版，deploy/github-use-guide 分层

### Fixed
- 历史 PR 无版本化问题：为当前状态建立基线快照，不回溯伪造版本

## [v6.8.0] - 2026-09-04

### Added（Event Runtime Reliability Phase1）
- delivery_status 事件生命周期状态机（created/claimed/delivering/delivered/processing/acked/failed）
- watchdog 独立模块：自动释放卡死 stuck claim，15min 超时保守策略
- retry×3 进 dead_letter 路径
- agent claim isolation（claimed_by 责任绑定，防多 Agent 错配）

### Fixed
- 事件所有权模型错误：chat_adapter.js 硬编码 gpt，ziven 事件无消费链（Phase2 解决消费链）
- 4 条历史 stuck claim 事件被 watchdog 自动释放（运行验证通过）

