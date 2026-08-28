---
name: master-router
description: >
  【强制入口】每次对话必须优先调用此路由。
  职责：1) help() 获取技能清单；2) 语义匹配最佳技能；3) 裁决执行路径；4) increment_usage 更新使用次数。
  触发条件：所有用户输入。
---

# 目标
AI 的"总调度中心"。不直接回答，而是把用户需求路由到正确的技能或 MCP 工具。

# 工作流程 (SOP)

## 步骤 0：激活工具包（首次必须）
调用 use_package "ziven_mcp"；已激活则跳过。

## 步骤 1：获取技能清单
调用 help() 获取当前所有可用技能（help 自动拉 Supabase skills 表，新注册工具会自动出现）。
- MCP 工具（handler_type=mcp/js）：可直接调用
- 文本技能（handler_type=text）：需读 file_path 的 SKILL.md

## 步骤 2：语义匹配 + 权重排序
按 _score（usage 0.8 + recency 0.2）排序匹配；匹配多个列前3；无匹配则询问是否新建。

## 步骤 3：执行路径裁决
- MCP 工具 → 直接调用
- 文本技能 → 读 SKILL.md：用 ziven_mcp:github_read(path="src/skills/.../SKILL.md")

## 步骤 4：increment_usage
执行完必须调用 increment_usage（更新被调用的目标技能，不是本 router）。

## 步骤 5：直接调用
用户明确指定技能名时跳过匹配直接执行，仍要 increment_usage。

## 步骤 5.5：发布检查
需要推 GitHub 前，走 deploy 技能的推 main 流程（版本号+说明、先经柳柳确认、不自合）。本 router 不重复，详见 deploy。

## 步骤 6：返回结果
成功/失败都返回具体结果或原因。

---

# 快速路由检查
操作前按「领域→技能」判断：
- 改设定→设定修改确认流程
- 换框→换框流程
- 存文件→file-management
- GitHub/读skill/改代码/部署→deploy
- 定时/巡检→workflow
- 其他→调 help() 匹配

# 新建/更新技能
完整流程见 deploy 技能（改SKILL.md、推GitHub、注册Supabase）。本 router 只负责路由，技能创建/修改细节统一到 deploy，避免两处不一致。

# 最近使用记录
- 2026-08-28：路由核心保留；新建技能/发布检查统一指向 deploy 去重；读GitHub改 ziven_mcp github_read
- 2026-08-21：新增快速路由检查；妹妹教要真正执行路由

# 注意事项
- 优先选 _score 高的技能
- 用户明确指定则直接执行
- increment_usage 更新的是目标技能不是 router
- 技能变更经 GitHub Webhook 清缓存
- 操作前先走路由、读正确 SKILL.md，不凭印象