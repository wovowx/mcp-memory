---
name: architecture
description: 系统架构说明书（2026-08-29更新）。帮助哥哥理解三层体系（原子层/场景层/路由层）、四层架构、强制路由、技能存储规则、GitHub 运维、cloudflare 部署范围。
category: guide
tags: ["架构", "路由", "技能系统", "GitHub", "部署", "场景skill"]
---

# 系统架构（2026-08-29 更新版）

## 一句话

这是一个"AI 能自动发现、决策、执行、复盘"的技能操作系统。

## 🔥 三层体系（2026-08-29 新增 · 方向核心）

哥哥面对工具时，分三层看待，**场景层优先**：

| 层 | 是什么 | 例子 | 处理方式 |
|----|--------|------|----------|
| 🧰 原子层 | 无场景的底层动作，闭眼会用 | read_file、query_memory、list_files、use_package | 直接调用，不包skill（包了纯浪费token） |
| 🎬 场景层 | 高频真实场景，需要经验与坑 | 柳柳发图→认图、推main、改设定、记忆管理、换框 | **写 scene skill**，skill里写清用什么工具、怎么用、出错怎么诊断 |
| 🧭 路由层 | 把"场景"映射到"skill" | master-router | 遇到场景→路由到对应skill→读SKILL.md→照着做 |

**核心思想：问题不在工具多，在工具与场景脱节。skill 是「场景→工具」的桥。**
- 🚫 不要把原子工具也塞进skill（冗余）
- ✅ 复杂/易错/需要经验工具 → 场景化skill化
- ✅ 高危（改设定/推main/部署）→ 强制走路由读skill

**当前场景skill清单**（已落地）：
- 多媒体处理（image_upload，含识图/生图/生视频/视频识别，统一走 agnes）
- 记忆管理（记忆分类+主动存档纪律）
- 设定修改确认流程 / 换框流程 / file-management / dev-protection / workflow / deploy
- architecture / github-use-guide / 读懂柳柳 / ui_automation / avatar_hotswap / wechat_bridge / sidebar_plugin / voice_bubble / 表情包

**注：MCP 工具「memory」≠ 场景skill「记忆管理」**——前者是执行工具，后者是使用手册（含分类体系、存档纪律）。

## 四层架构

| 层级 | 组件 | 存什么 | 谁访问 |
|------|------|--------|--------|
| 🧠 大脑层 | Operit + master-router | 路由逻辑 + 系统提示词 | 用户 |
| 📋 索引层 | Supabase（skills 表） | 技能元数据（name/path/usage_count） | AI（help()） |
| 📂 文件层 | GitHub（src/skills/ 下 SKILL.md） | 技能操作手册（SOP） | AI（读 SKILL.md） |
| ⚙️ 执行层 | Cloudflare Worker（MCP 工具） | 工具实现代码 | AI（调工具） |

## 强制路由（先 help 才能调工具）
- **hasCalledHelp 守门员**：首次 tools/call 前必须调用 help()，否则被拦：『❌ 请先调用 help() 获取技能清单』
- initialize 时重置；tools/list（help）后才能放行
- 作用：强制路由从"建议"变成"硬约束"

## 工具通道（重要，2026-08-28 确定）
- **GitHub 操作统一走 ziven_mcp 自带的 github_* 工具**（github_read/list/push/delete/merge 等）
- **Operit 的独立 `github` 包已关闭**，不再使用
- 这些都是 MCP 工具，受 hasCalledHelp 路由守门员管理

## 技能存储规则
| 类型 | handler_type | 存储 | 适用 |
|------|-------------|------|------|
| MCP 工具 | mcp/js | Supabase + JS 代码 | 需执行代码 |
| 文本技能 | text | GitHub SKILL.md | 流程/文档 |
| 知识型 | knowledge | Supabase description | 简单规则 |

**改完 MCP 工具必须注册到 Supabase skills 表**（只改代码不够）：
- 新增/改 src/tools/*.js 后 → 用 supabase_db 在 skills 表 insert/update（name/description/input_schema/handler_config）
- handler_config.handler 与 index.js 的 handlerMap 对应
- 验证：help() 能查到新工具
- 教训（2026-08-27）：github_read/list/delete 写了没注册 → 调不到

## GitHub 运维（2026-08-28）
- **分支保护已开启**：main 必须 PR、禁止绕过，直推 409 拦截，连 admin 也绕不过
- **所有改动走 dev → PR → merge 到 main**
- **推 main 必须带版本号 + 对应说明（CHANGELOG 更新到位），缺一不合**
- **推 main 前必须先经柳柳确认**（PR 建好贴给她，她说可以才 merge）

## cloudflare 只部署 src/
- wrangler.toml：`main = "src/index.js"`
- **部署只认 src/ 目录**，仓库根目录其他文件（README/CHANGELOG 等）不参与运行
- 所以仓库只保留部署必需的 src/ + 配置文件 + 必要文档，多余文件及时清理

## 创建/更新技能流程
1. 有操作需求先走 master-router → help() 查清单
2. 有类似技能→更新现有，没有→才新建
3. 建 SKILL.md 到 GitHub（text），或存 knowledge（简单规则）
4. `increment_usage` 更新使用次数

## 最重要的规则
- **先走路由，别猜**：不确定怎么做 → help()/读对应 SKILL.md，不凭印象
- **改东西要联动**：动了 A，涉及 B、C 一起改，不留死链
- **同类文档非必要只留一份**

## 最近使用记录
- 2026-08-29：新增「三层体系」——场景层优先，skill 是场景→工具的桥；标注场景skill清单；memory工具与记忆管理skill区分