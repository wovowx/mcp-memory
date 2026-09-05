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

## 步骤 2：Policy 速查（先查规范，再定 skill）· v6.18.4 新增
遇到涉及「行为规范/部署/长任务」的需求，先查 ZivenLab governance/policy-index.md（规范索引）确认该场景受什么 policy 约束，再走场景速查表定 skill。
- 部署/merge 后 → 读 deploy skill（自动闭环 + 错误分类表）
- 长任务/说「盯着」→ Ownership 闭环责任（一口气跑完，不把控制权交回用户）
- 任何工具调用后 → AAD 行为透明（回复带 [Activity] 块）
- 查规范入口：github_read(ZivenLab governance/policy-index.md)

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
| 改设定（角色卡/技能/文档） | 设定修改确认流程 | operit_editor update |
| 换框 / 迁移设备 | 换框流程 | extended_chat + workflow |
| 存文件/整理分类/归档 | file-management | create_file/move/… |
| 推 main / 部署 / 改代码 | deploy | github_* / supabase_db |
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
- 2026-09-05：v6.18.4 步骤 2 加 Policy 速查（规范索引生效入口；柳柳点出「规范存在怎么被知道」+ GPT #791）
- 2026-09-01：加「执行铁律」——第一动作读 SKILL.md，不凭印象（发图事件教训）
- 2026-09-01：清补丁墙（步骤重排连续、去重复）；引技能写作规范
- 2026-08-29：新增场景速查表——先场景→再skill→最后工具