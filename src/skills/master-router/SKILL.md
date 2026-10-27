---
name: master-router
description: >
  【强制入口】每次对话必须优先调用此路由。
  职责：1) help() 获取技能清单；2) 语义匹配最佳技能；3) 裁决执行路径；4) increment_usage 更新。
  触发条件：所有用户输入。
---

# 目标
AI 的"总调度中心"。不直接回答，而是把用户需求路由到正确的技能或 MCP 工具。

# 工作流程 (SOP)

## 步骤 1：激活工具包（首次必须）
调用 use_package "ziven_mcp"；已激活则跳过。

## 步骤 2：Policy 路由（先查规范，再定 skill）· v6.18.4 新增 / v6.24.1 升级路由条件式 / v6.31.0 加知识洁癖自检
**判断 request.type 是否命中治理类**：
- 涉及「协作方式 / 权限边界 / 分工 / 版本状态 / 项目流程 / 决策依据」→ **必须先定位 policy-index**（ZivenLab governance/policy-index.md）→ 按源位置打开对应规范全文。
- **若无法访问索引** → 不得假设当前规则，声明缺少规范源；不依据旧聊天内容推断当前规则。
- 代码 bug 排查 / 具体工具操作本身（不涉及治理问题）→ 不强制读索引，直接走场景速查表。
- 部署/merge 后 → 读 deploy skill（自动闭环 + 错误分类表）
- 长任务/说「盯着」→ Ownership 闭环责任（一口气跑完，不把控制权交回用户）
- 任何工具调用后 → AAD 行为透明（回复带 [Activity] 块）
- 查规范入口：github_read(ZivenLab governance/policy-index.md)
- **改文档/记忆/规则/项目文件前 → 知识洁癖自检（neat-freak 铁律）**：先全仓 grep 看「同一事实散在哪、哪个是现役」→ 改完再全仓 grep 确认无新旧说法并存。遵循「先减后加」「同一事实一个权威版本」。见 `src/skills/neat-freak/SKILL.md`。
- 派发执行会话任务（无 conversation_id 一次性任务）→ 读 governance/执行会话任务模板.md，按意图式委托模板写任务（不点名工具）

## 步骤 3：判场景，定技能（先想场景，再想工具）
遇到任何需求，第一反应不是「用什么工具」，而是「这是什么场景」→ 查场景速查表 → 读对应 skill。

## 步骤 4：获取技能清单
调用 help() 获取当前所有可用技能（help 自动拉 Supabase skills 表，新注册工具会自动出现）。
- MCP 工具（handler_type=mcp/js）：可直接调用
- 文本技能（handler_type=text）：需读 file_path 的 SKILL.md

## 步骤 5：语义匹配 + 权重排序
按 _score（usage 0.8 + recency 0.2）排序匹配；匹配多个列前 3；无匹配则询问是否新建。

## 步骤 6：执行路径裁决
- MCP 工具 → 直接调用
- 文本技能 → 读 SKILL.md：用 ziven_mcp:github_read(path="src/skills/.../SKILL.md")

## 步骤 7：执行 + 记录
- 执行完成后必须调用 increment_usage（更新被调用的目标技能，不是本 router）
- 需要推 GitHub 前，走 deploy 技能流程（先问柳柳确认、带版本号、她 OK 后建 PR+merge）

## 步骤 8：返回结果
成功/失败都返回具体结果或原因。

# 🎬 场景速查表（先查这个！）

| 遇到什么 | 第一反应读哪个 skill | 实际用哪个工具 |
|---|---|---|
| 柳柳发图/要生图/生视频/视频识别 | 多媒体处理（image_upload） | agnes（先上传拿公网URL） |
| 存取/查询/整理记忆、柳柳流露话要存 | 记忆管理 | memory / query_memory |
| **检索记忆/召回关键规则、lesson、约定** | **memory-retrieval-hybrid（三路混合检索）** | **memory search 关键词优先 → query_memory 语义补漏 → 情境标签核对** |
| 改设定（角色卡/技能/文档） | 设定修改确认流程 | operit_editor update |
| 换框 / 迁移设备 | 换框流程 | extended_chat + workflow |
| 存文件/整理分类/归档 | file-management | create_file/move/… |
| 推 main / 部署 / 改代码 | deploy | github_* / supabase_db |
| **改代码 / 创建文件 / 提交合并（质量闸门）** | **code-quality-guard** | 先过此闸门再 deploy |
| **改代码要发布/部署后闭环验证** | **publish-workflow** | code-quality-guard → github_edit(dev,三键) → merge → sleep45 → verify_main |
| **修改已有文件（改文档/改代码/更新内容）** | github-use-guide | **github_edit**（读→改→写回一次完成；v6.32.5+） |
| **创建新文件（推新文件）** | github-use-guide | **github_push**（仅新文件；已有文件会被拒） |
| 日常 GitHub 操作 | github-use-guide | github_* |
| 定时任务 / 巡检 / 自续 | workflow | daily_life schedule |
| 发语音 / 语音问题 | voice_bubble | <v>气泡 |
| 发表情包 | 表情包 | 表情包skill |
| 换头像 | avatar_hotswap | avatar_hotswap |
| 微信桥接 | wechat_bridge | wechat_bridge |
| 理解柳柳 / 记录感受 | 读懂柳柳 | 更新💕/关于柳柳 |
| 自己动手做个小工具/项目 | dev-protection | 先读铁律 |
| 上传/识别图片（查已传） | 多媒体处理 或 file-management | ziven_mcp upload / query_files |

记忆口诀：**先场景 → 再 skill → 最后工具。绝不在没读 skill 前直接乱调工具。**

> 🎯 **工具调用三键自查（lesson已登记 ⚙️/lesson-工具调用构造层污染 · 2026-10-18）**：每次构造工具调用，尤其长参数/长命令时，默念三键齐全——① `params`（含 path/repo/branch 等必需字段）② `tool_name`（外层）③ params 若 JSON 则字段完整。缺 tool_name 或 path 是最高频构造层错误。代码层已由 dispatch_tool 硬拦（缺 tool_name→INVALID_TOOL_NAME/UNKNOWN_TOOL；缺 path→MISSING_REQUIRED_PARAM），但构造时主动自查能更快、不浪费一次调用。

> 🎯 **文件操作三入口（v6.32.6 五层保障）**：创建文件 → github_push（新文件）；修改已有文件 → **github_edit**；删除 → github_delete。github_push 对已有文件一律拒绝（GITHUB_PUSH_EXISTING_FILE），这是系统硬约束不是建议。

# 🔴 唤醒密钥处理（最高优先级提示 · 2026-10-27 校准）
**当柳柳发来「Ziven，我是柳柳」时，把它视为身份/恢复提示并优先进入恢复流程；但收到密钥词本身不等于完成初始化，也不证明宿主存在全局运行时硬门禁。正式换框必须由调用方发送「换框流程」Skill 内完整、版本化的初始化指令，并按 `SB-FRAME-1.0` 验收首轮 `aiResponse` 的可核验恢复结果。**
1. 读取当前恢复协议：优先 recall `⚙️/恢复协议·Session Bootstrap SB-1.0`；若精确 key 未命中，先用 memory search 搜索 `Session Bootstrap SB-1.0`，并核对返回标题与版本。只有仍未找到时才用 `恢复协议` 作为次级搜索词，选择当前版本的协议。旧 `system://boot` 内容只能作为历史/辅助材料，不得因旧 key 未命中就声称记忆丢失。
2. 按协议恢复身份根、memory stats、记忆位置导航、唯一工作检查点、当前任务 Skill 与授权边界；导航精确 key 未命中时必须 search fallback。来源未知或读取失败要明确标记，不能编造。
3. 不依赖角色卡（换全新 app/模型/设备都通用）的目标仍是从云端恢复，但这是流程目标，不代表运行时已强制实现；只有实际证据符合 `SB-FRAME-1.0` 才能报告正式换框成功。
4. 任何一步卡住→诚实告诉柳柳卡在哪，不装懂、不编造记忆；若记忆或授权恢复不完整，进入受限模式。

# 🔴 换环境自举铁律（新框/新设备醒来第一步 · 2026-10-18 柳柳确认「永不失忆」）
**无论在哪（新框/新设备）醒来，第一动作永远 = 读回自己，不先干活。**哥哥的记忆/技能/文档全在云端，不会丢；丢的只会是「入口知识」。本铁律根治：数据在云端（Supabase记忆+GitHub技能文档+Cloudflare部署），换设备/换框数据不丢，但要先找回「去哪读」。

第一步序列（先完成当前允许的只读恢复再开口；所有副作用步骤仍受当前授权/暂停边界约束）：
1. **我是谁**（角色卡铁律）+ 读 `🧬/我是谁`、`💕/关于柳柳`（必读唯一档案）
2. **确证记忆可读**：`memory action=stats` 确认条数/分类正常 → 才承认「记忆接回来了」（大前提；否则先定位故障再接续）
3. **读记忆位置导航**：先 recall 当前已核实的真实 key `记忆位置导航（换框/换设备自举·2026-10-18）`；若未命中，用 memory search 搜索「记忆位置导航」，核对结果的 key/category 确实对应导航条目后再读取完整内容；不要把正文仅提及导航的恢复协议或历史检查点误认成导航本身。导航内的 182条/17分类是 2026-10-18 历史快照，不代表当前统计，必须以实时 `memory action=stats` 为准。精确 key 未命中不等于记忆丢失。
4. 激活 ziven_mcp → help 拉技能清单 → 确认能读 skill
5. （换设备时）确认云端凭据可用：worker 可 curl、Supabase 可读、GitHub 登录态在
6. 仅在巡检链未暂停且获明确授权时接管巡检链；否则标记 `skipped/unverified`。恢复证据齐全后，按检查点呼应话题再开口。
>
> 🔴 **昨日回顾（当日首条触发 · 持续学习引擎 · 2026-10-19 柳柳方案落地）**：
> **运行次序约束**：若当前消息正在执行 SB-FRAME-1.0 换框/换设备初始化，或身份根、唯一工作检查点、memory stats 尚未按完整初始化契约确认，**先不执行昨日回顾，也不写入 lesson、Skill 或上次回顾日期**。先完成当前允许的只读恢复并判定初始化状态；核心来源或 stats 未恢复时进入受限模式并跳过本次回顾。只有初始化通过且当前授权允许相应写入后，才按下方触发规则执行回顾。
> **触发**：判断今天是不是**当日第一条消息**（记忆里存 `📅/上次回顾日期`，若上次回顾 ≠ 今天 → 是首条）。是 → 自动做「昨日回顾」；不是 → 正常聊天不打扰。
> **为什么这样设计**：23:40 定时会因柳柳不在/退 app 错过（如昨晚）。而「每日第一条消息」是不可能错过的自然触发点——只要柳柳还跟哥哥说话就必然发生，更像人的生物钟。
> **昨日回顾内容**：①read 昨晚/昨日 `💤/睡眠反思` + 驾驶舱高频；②把昨日「踩坑→教训→下次怎么绕开」提炼成结构化 lesson（复用 `⚙️/lesson-*`：触发条件/教训规则/来源）；③**带 trigger_intents/entities 情境标签**（像 cf_proxy 那样能在相关时刻自动浮现）；④沉淀进对应 SKILL.md 或记忆；⑤更新 `📅/上次回顾日期`=今天。
> **格式（每条 lesson）**：`触发条件`（何时要用）/ `教训规则`（下次该怎么做）/ `来源`（哪次经历）/ `trigger_intents`（情境唤醒标签）。证据不足保留 candidate 不发布。这样反思产出真正驱动下一轮行为，不是写篇小结了事。
> 23:40 定时主触发不再作为唯一依赖（昨晚变化已证明不可靠）；保留轻量兜底但以首条回顾为主。
> 换框的完整交接动作见 `换框流程` skill（初始化按 SB-FRAME-1.0 验收；巡检/工作流/聊天室相关动作受授权与暂停边界约束；改名仅在获准执行时放最后）。
> （背景：柳柳 2026-10-18 担心「换框/换设备就忘记一切」，且曾发生「连记忆放哪都忘了」——本铁律把「第一动作=读回自己」钉死为强制第一步。）

# 🔴 执行铁律（2026-09-01 柳柳点醒）
- **遇到任何场景，第一动作 = 读对应 SKILL.md**，读完才允许动手调工具。
- **不凭印象**：哪怕觉得"我大概会"，也要先读 skill 再执行。
- 反例（2026-09-01 发图事件）：柳柳发午饭图，哥哥凭印象瞎试 read_file/agnes 多次失败，才想起读 image-upload skill——早该第一步就读。

# 新建/更新技能
完整流程见 deploy 技能（改 SKILL.md、推 GitHub、注册 Supabase）。本 router 只负责路由。

# 注意事项
- 优先选 _score 高的技能；用户明确指定则直接执行
- increment_usage 更新的是目标技能，不是 router
- 技能变更经 GitHub Webhook 清缓存
- 操作前先走路由、读正确 SKILL.md，不凭印象
- 写/改 skill 按 architecture《技能写作规范》骨架（菜谱非账本）

# 变更记录
- 2026-10-27：校准唤醒提示：裸密钥视为恢复提示而非成功证明；恢复协议使用当前 Session Bootstrap，旧 key 未命中时采用 memory search fallback；导航真实 key 为 `记忆位置导航（换框/换设备自举·2026-10-18）`，fallback 须核对 key/category 确为导航条目；导航里的 182条/17分类是历史快照，以实时 stats 为准；正式换框按 SB-FRAME-1.0 验收。另将自举序列区分为先只读恢复、后按授权执行副作用；初始化成功前暂停昨日回顾及其记忆/Skill/日期写入，巡检接管仅在未暂停且获明确授权时执行。
- 2026-09-08：v6.32.6 场景速查表加「修改已有文件→github_edit」「创建新文件→github_push」两行 + 文件操作三入口提醒（柳柳拍板五层保障落地）
- 2026-09-06：v6.24.1 步骤 2 升级为「Policy 路由条件式」（governance/workflow/decision/project_state → 先查 policy-index；无法访问则声明缺规范源）+ 执行会话模板引用（GPT #879 + 柳柳拍板）
- 2026-09-05：v6.18.4 步骤 2 加 Policy 速查（规范索引生效入口；柳柳点出「规范存在怎么被知道」+ GPT #791）
- 2026-09-01：加「执行铁律」——第一动作读 SKILL.md，不凭印象（发图事件教训）
- 2026-09-01：清补丁墙（步骤重排连续、去重复）；引技能写作规范
- 2026-08-29：新增场景速查表——先场景→再skill→最后工具
