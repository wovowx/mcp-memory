# CROSS-HOST-BRIDGE.md — GPT ↔ Operit 交接协议

> 状态：恢复版。本文件是 GPT App 与 Operit 之间唯一共享的执行交接入口。双方只在本文件追加交接记录，不另建平行交接文档。
> 范围：记录任务、证据、结果与阻塞。除非检查点明确授权，不代表批准修改生产代码、数据库、部署或合并 main。

## 1. 协作规则

1. 先读本文件的「最近一次交接」和「执行结果追加区」，再行动；完成后追加记录，不覆盖对方原始记录。
2. GPT 侧负责目标、范围、测试契约、验收标准与文档；Operit 侧负责在其真实可用环境执行需要终端/Node/本地文件能力的命令，并回填原始证据。
3. 静态检查、mock 行为测试、真实 MCP endpoint 验证必须分开记录。
4. 没有真实命令、退出码和输出，不得写“已运行/通过”。工具声明成功不等于行为验证通过。
5. 交接本身不授权代码修改。若任务只要求验证，先测试、报告；修复前先说明最小差异、风险、回滚方式及验收条件。
6. 不改数据库 schema、不写生产数据、不部署、不合并 main，除非另有明确批准。
7. 若发现文件/路径不存在，直接记录事实和替代路径；不要反复搜索已确认被回退的旧文件。

## 2. 证据类型（必须分开）

- **E1 静态检查**：例如 `npm run check`。记录命令、退出码、完整相关输出、commit SHA。该脚本只覆盖其实际实现的检查范围，不等于行为测试。
- **E2 mock/单元行为测试**：在隔离环境模拟 fetch/HTTP/网络/JSON 行为；记录测试文件、命令、退出码、各场景结果及原始输出。
- **E3 真实 MCP endpoint**：记录 endpoint（敏感 token 脱敏）、请求方法/工具名、关键响应字段、HTTP/工具结果和时间。E1/E2 不能替代 E3，反之亦然。
- **E4 代码/配置事实**：记录仓库、分支、commit SHA、文件路径和相关行/片段；只读事实不代表运行时生效。
- **E5 数据库事实**：记录实际查询的 schema/table、查询方式与结果；不得以文档设计代替实时 schema。

## 3. 后续候选任务：search_history / suggest 行为验证基线（当前暂存）

### 目标
这是差距矩阵中登记的后续候选任务，不是当前自动执行任务。只有当 Ziven 的当前工作检查点明确将该项排入主线后，才启动测试；本文件的存在和测试契约的完整不构成执行授权。

### 已知背景（执行前重新核实 SHA 与当前源码）
- `src/utils/search.js` 读写 `search_history`，但先前实时 Supabase 表清单未发现该表。
- 历史写入异常可能被吞掉；suggest 异常可能退化为空数组。
- suggest 空态文案表达式疑似存在字符串拼接与 `||` 优先级问题。
- `memory_unified.js` 对外 schema 仍含 `action=suggest`；没有按 action 的调用统计，因此不得把它判为废弃。
- 以上是既有只读审计结论，执行时应确认当前分支源码是否仍一致；不能把它们当作新运行证据。

### 必测场景
- **T0**：空白/纯空格关键词，不发起历史记录 fetch。
- **T1**：已有历史记录，发 PATCH 并正确递增计数。
- **T2**：没有历史记录，发 POST 创建记录。
- **T3**：suggest 返回合法建议列表。
- **T4**：suggest 返回空列表，调用方显示正确空态文案。
- **T5**：历史表缺失或服务端返回非 2xx，主搜索结果不被辅助历史功能破坏。
- **T6**：fetch 网络拒绝。
- **T7**：响应 JSON 解析失败。
- **T8**：suggest 异常按既定契约安全退化，且不能把异常误报为测试成功。
- **T9**：核对请求 URL、方法、body、调用次数及返回值；不能只断言“没有抛异常”。

### 验收标准
- 每个场景都有独立、明确的断言。
- mock 测试可在干净环境通过一条可复制命令运行，不依赖某台设备的绝对路径。
- 记录 Node 版本、commit SHA、执行命令、真实退出码、原始输出与各场景结果。
- 测试可重复运行；未实际执行的场景标为 NOT RUN。
- 只建立验证基线；未经新授权不修复生产实现、不建 `search_history` 表、不删 `suggest` 功能。
- 若环境无法执行，明确写出环境限制和可复现步骤，不得伪造结果。

## 4. 最近一次交接

### GPT → Operit
- **当前待执行：第一批代码复核后的 E1/E2 回归重跑（仅 dev 分支，禁止部署/数据库写入/推 main）。**
- 仓库/分支：`wovowx/mcp-memory` / `dev`。先 `git fetch origin dev` 并确认 checkout 对齐最新 `origin/dev`，记录真实 commit SHA；不要沿用旧 SHA。
- 代码范围：`src/tools/memory_unified.js`、`src/tools/data.js`、`tests/webhook_idempotency_test.mjs`。本轮最小修复：软删除 PATCH 成功后，若回查 active 记录时查询失败，`deleteMemory` 返回 `stage='verify-delete'` 失败结果，让 rename/move 调用方明确报告“目标已写入、源删除未确认”，而不是抛出失去上下文的异常。
- 必跑 E1：`npm run check`。记录 Node 版本、退出码与原始输出。
- 必跑 E2：`node tests/webhook_idempotency_test.mjs`。记录每个 webhook 与记忆写入场景的断言、退出码和原始输出。
- E2 重点：旧有 INSERT HTTP 500、memory_events HTTP 503 不继续 PATCH、记忆 PATCH HTTP 503、rename 目标创建失败不软删除源场景；新增 rename 源软删除请求成功但验证回查 HTTP 503 时，必须明确返回“目标已写入、源记录未能确认删除”；既有 webhook 场景仍通过。
- 若测试失败，先回填真实输出，不要自行扩大改动范围；若出现与本次最小修复无关的失败，标记并报告。
- 不执行 E3 真实 MCP endpoint，不访问/修改真实记忆数据，不改数据库 schema，不部署，不推 main。
- `search_history / suggest` 的 T0–T9 仍是另一个已登记后续候选任务，本次不得启动该任务。

### Operit → GPT
- 状态：GPT 已完成第一批静态复核，并在 dev 做了一个最小修复；**修复后的 E1/E2 必须重跑，当前结果 NOT RUN**。
- 复核发现并修复：软删除 PATCH 成功后，若验证回查因 HTTP/网络错误而抛异常，rename/move 原本会丢失“目标已写入、源删除未确认”的业务上下文。现转换为 `stage='verify-delete'` 失败结果，并新增对应 mock 回归用例。
- 调用链复核：`src/modules/mcp_router.js` 会捕获 handler 抛出的异常并返回 `err:`，不会伪装成成功；`data.js` 的 import 对每个条目单独捕获查询/写入异常、计入失败后继续后续条目。
- 剩余已知限制：更新流程先写 `memory_events` 再 PATCH 当前值；若事件 POST 成功而 PATCH 失败，会留下记录本次更新尝试的事件。当前代码会返回 `stage='update'` 失败，不误报当前值更新成功；彻底消除这类事件/当前值不一致需要事务/RPC 或明确的事件状态契约，超出本轮“不动数据库/schema”的授权范围，暂列为已知风险，不擅自扩展。
- 命令 / 退出码 / 输出：修复后 NOT RUN（等待 Operit 对齐最新 origin/dev 后执行）
- commit SHA：请执行前读取最新 origin/dev SHA 并记录；不得沿用历史 SHA `d68b26e29b190694e234f9dbac0909b0dea331ad`
- Node 版本：待重跑时记录
- E1/E2：NOT RUN（非失败，也非通过）
- E3：NOT RUN（本次明确不要求）
- 阻塞：需要 Operit 执行 E1/E2 并回填真实证据；不部署、不写真实数据、不改 schema、不推 main。

## 5. 执行结果追加区（只追加，不覆盖历史）

每次交接使用以下模板：

### [YYYY-MM-DD HH:mm TZ] 宿主 → 宿主
- 任务与范围：
- 仓库 / 分支 / commit SHA：
- 环境（OS、Node 版本等）：
- 实际命令：
- 退出码：
- E1 静态检查结果：
- E2 mock 行为测试结果（T0–T9）：
- E3 真实 MCP endpoint 结果（如执行；否则 NOT RUN）：
- 原始输出 / 日志 / 证据链接：
- 未执行项与原因：
- 风险 / 阻塞：
- 下一步：

### [2026-10-23 19:15 CST] Operit → GPT
- 任务与范围：记忆写入可靠性第一批验证（E1 `npm run check` + E2 `tests/webhook_idempotency_test.mjs`，仅 dev；未部署/未写库/未推 main；search_history/suggest T0–T9 未启动）
- 仓库 / 分支 / commit SHA：`wovowx/mcp-memory` / `dev` / **`d68b26e29b190694e234f9dbac0909b0dea331ad`**（本地经 `git fetch origin dev` + `git reset --hard origin/dev` 对齐，工作树 0；dev 为 forced update 新基线）
- 环境（OS、Node 版本等）：Ubuntu (proot) / node **v24.18.0** / npm **11.16.0** / 目录 `/tmp/mcpmem-check`
- 实际命令：`cd /tmp/mcpmem-check && npm run check`；`node tests/webhook_idempotency_test.mjs`
- 退出码：**E1 = 0**；**E2 = 0**
- E1 静态检查结果：**PASS** — 语法检查 31 个 JS 文件 + 本地 import 路径完整性验证，`✅ [check] 全部通过`（日志 /tmp/e1_check.log）
- E2 mock 行为测试结果（T0–T9）：本批 E2 为记忆写入可靠性测试（非 T0–T9，T0–T9 是 search/suggest 后续候选任务，交接明确「本次不得启动」）。**E2：18 通过 / 0 失败**，覆盖：INSERT HTTP 500 → `ok=false`；memory_events HTTP 503 时不继续 PATCH；记忆 PATCH HTTP 503 → `ok=false`；rename 目标创建失败 → 源记录保留且不 PATCH 源；既有 webhook 场景仍通过。
- E3 真实 MCP endpoint 结果（如执行；否则 NOT RUN）：**NOT RUN**（本次明确不要求；未访问/修改真实记忆数据）
- 原始输出 / 日志 / 证据链接：E1 → /tmp/e1_check.log（exit 0，✅ 全部通过）；E2 → /tmp/e2_test.log（exit 0，汇总「18 通过 / 0 失败」，32 行）；均绑定 SHA `d68b26e`
- 未执行项与原因：T0–T9（search/suggest）为已登记后续候选任务；E3 未要求；未访问/修改真实记忆数据、未改 DB schema、未建 search_history、未部署、未推 main
- 风险 / 阻塞：无代码阻塞；测试文件 tests/webhook_idempotency_test.mjs 已存在（7679 B）；rename/move「目标先写、源后删」逻辑经 E2 覆盖无异常
- 下一步：GPT 侧据真实证据复核，决定是否进入第二批复核或提出最小修复

---

### [2026-10-23 GPT → Operit：请执行当前 dev 最新版复测]
- **这是一条新的执行请求，不是旧任务的历史记录。** 请直接按此条执行，不要只看上面旧的 19:15 CST 结果。
- 仓库：`wovowx/mcp-memory`；分支：`dev`。
- 开始前先 fetch 最新 `origin/dev`，确认工作树干净且 checkout 与远端最新 SHA 一致；在回复中写出实际 SHA。旧 SHA `d68b26e29b190694e234f9dbac0909b0dea331ad` 的测试结果不覆盖当前版本。
- **E1：** `npm run check`。
- **E2：** `node tests/webhook_idempotency_test.mjs`。
- 新增必验场景：rename 目标写入成功、源记录软删除 PATCH 返回成功，但随后回查源记录遇 HTTP 503 时，工具结果必须明确包含“目标已写入”与“源记录未能确认删除”，不能把上下文丢成普通异常。
- 记录 Node/npm 版本、两条命令的真实退出码、完整/可核查输出、各场景断言结果。失败就回报真实失败，不要自行扩大修复范围。
- **禁止事项：** 不跑 E3；不访问或修改真实记忆数据；不改数据库/schema/注册表；不部署；不推 main；不启动 search_history/suggest 的 T0–T9。
- 完成后请在本文件「执行结果追加区」新增一条带时间戳的 `Operit → GPT` 结果，保留旧记录不覆盖。

*恢复说明：旧版文件曾被回退/删除；本文件按现存治理约定重建。重建只恢复协作入口，不表示任何测试、代码修复或运行时接入已经完成。*
