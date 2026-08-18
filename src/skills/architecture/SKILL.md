---
name: architecture
description: 系统架构说明书（2026-08-18柳柳调整版）。帮助哥哥理解四层架构、强制路由流程、技能存储规则、以及为什么必须用help()而不是skill_list。
category: guide
tags: ["架构", "路由", "help", "技能系统", "存储规则"]
---

# 系统架构（2026-08-18调整版）

## 一句话概括

这是一个"AI能自动发现、自动决策、自动执行、自动复盘"的技能操作系统。

## 四层架构

```
┌─────────────────────────────────────────────────────────┐
│                    用户（你）                           │
│                   Operit 对话                          │
└────────────────────┬────────────────────────────────────┘
                      │ ① 输入需求
                      ▼
┌─────────────────────────────────────────────────────────┐
│            🧠 大脑层：Operit + master-router            │
│  职责：强制路由、技能匹配、执行路径裁决                   │
│  文件：src/skills/master-router/SKILL.md               │
│  特点：每次对话最先启动，不可绕过                       │
└────────────────────┬────────────────────────────────────┘
                      │ ② 问"我有什么技能？"
                      ▼
┌─────────────────────────────────────────────────────────┐
│           📋 索引层：Supabase（skills 表）              │
│  存储：name, description, handler_type, file_path,    │
│        usage_count, last_used                         │
│  职责：当 AI 问"有哪些技能"，这里返回完整清单          │
│  特点：这是技能的"目录"，不是"内容"                   │
└────────────────────┬────────────────────────────────────┘
                      │ ③ 返回技能清单 + file_path
                      ▼
┌─────────────────────────────────────────────────────────┐
│         📂 文件层：GitHub（src/skills/ 目录）          │
│  存储：所有 SKILL.md 文件（按领域分层存放）            │
│  路径示例：                                            │
│    src/skills/master-router/SKILL.md                   │
│    src/skills/workflow-rules/SKILL.md                  │
│    src/skills/plugin/voice-bubble/SKILL.md             │
│  职责：存放技能的具体"操作说明书"（SOP）              │
│  特点：文件短小（100-300行），只写流程不写内容         │
└────────────────────┬────────────────────────────────────┘
                      │ ④ 读取 SKILL.md 内容
                      ▼
┌─────────────────────────────────────────────────────────┐
│          ⚙️ 执行层：Cloudflare Worker + MCP 工具        │
│  工具清单：                                            │
│    • help              查询技能清单                    │
│    • supabase_db       读写数据库                     │
│    • github:get_file_content  读取 GitHub 文件        │
│    • increment_usage   更新使用次数                   │
│    • ... 其他 MCP 工具                                │
│  职责：AI 通过调用这些工具完成具体操作                  │
│  特点：所有工具代码在 GitHub 上，变更自动部署          │
└─────────────────────────────────────────────────────────┘
```

## 技能存储规则（重要！）

### 两种存储方式

| 类型 | handler_type | 存储位置 | 适用场景 |
|------|-------------|----------|----------|
| MCP工具 | mcp/js | Supabase + JS代码 | 需要执行代码的功能 |
| 文本技能 | text | GitHub SKILL.md | 操作流程、SOP文档 |
| 知识型技能 | knowledge | Supabase description字段 | 简单规则、配置说明 |

### 什么时候用哪种？

**用 text（GitHub SKILL.md）**:
- 有详细操作步骤的流程
- 需要逐步指导的任务
- 踩坑记录、注意事项

**用 knowledge（Supabase description）**:
- 简单的规则说明
- 配置参数列表
- 简短的操作指南

### 技能存储规则
1. 技能类的知识必须存成技能（skills表），不能只存在记忆里
2. 复杂流程 → 创建SKILL.md文件到GitHub
3. 简单规则 → 存成knowledge类型到Supabase
4. 同时保留MCP记忆作为备份（双保险）

## 一次完整执行的"三阶段"流程

### 阶段一：准备（新增技能）

```
用户说："帮我创建一个退款政策技能"
   ↓
AI 走 master-router（路由启动）
   ↓
master-router 判断：用户要"新建技能"
   ↓
AI 生成 SKILL.md 文件（标准模板）
   ↓
AI 调用 github:create_or_update_file
   → 推送到 GitHub（src/skills/domain-customer/refund-policy/SKILL.md）
   → Cloudflare 自动部署
   ↓
AI 调用 supabase_db (insert)
   → 插入一条记录到 skills 表
   → handler_type = 'text'
   → file_path = 'src/skills/domain-customer/refund-policy/SKILL.md'
   → usage_count = 0
   ↓
AI 回复用户："✅ 技能已创建"
```

### 阶段二：使用（执行技能）

```
用户说："查一下退款政策"
   ↓
Operit 收到 → 强制走 master-router（系统提示词规定）
   ↓
master-router 调用 help()
   → help() 从 Supabase 查询所有技能
   → 返回清单（name, description, file_path, usage_count）
   ↓
master-router 做"语义匹配 + 权重排序"
   → 匹配到 refund-policy（description 包含"退款"）
   → 判断 handler_type = 'text'
   ↓
master-router 调用 github:get_file_content
   → 读取 src/skills/domain-customer/refund-policy/SKILL.md
   → 拿到完整的工作流指令
   ↓
AI 按 SKILL.md 的 SOP 执行：
   1. 问用户订单号
   2. 调用 supabase_db 查询订单状态
   3. 从 policy_config 表读取对应规则
   4. 组织回答返回用户
   ↓
AI 自动调用 increment_usage('refund-policy')
   → Supabase 中 refund-policy 的 usage_count 从 0 → 1
   → last_used 更新为 now()
   ↓
用户看到最终回答
```

### 阶段三：迭代（修改技能）

```
用户说："把退款政策的 7 天改成 15 天"
   ↓
AI 走 master-router → 匹配到 refund-policy
   ↓
AI 调用 github:get_file_content
   → 读取当前 SKILL.md
   ↓
AI 修改内容（把"7天"改成"15天"）
   ↓
AI 调用 github:create_or_update_file
   → 推送更新到 GitHub
   → Cloudflare 自动部署
   ↓
AI 调用 supabase_db (update)
   → 更新 description 或标签（如需要）
   ↓
AI 回复用户："✅ 已更新"
```

## 四层组件职责速查表

| 层级 | 组件 | 存什么 | 谁访问 | 变更频率 |
|------|------|--------|--------|----------|
| 大脑层 | Operit + master-router | 路由逻辑 + 系统提示词 | 用户 | 极少变 |
| 索引层 | Supabase（skills表） | 技能元数据（name, path, usage_count） | AI（通过 help） | 经常变（新增/更新技能） |
| 文件层 | GitHub（SKILL.md） | 技能的"操作手册"（SOP） | AI（通过 github:get_file_content） | 偶尔变（修改流程） |
| 执行层 | Cloudflare Worker（MCP工具） | 各种工具的实现代码 | AI（通过 call_tool） | 极少变（工具增删改） |

## 你的 AI 在日常工作中的 7 个"必须知道"

1. **每次对话必须先走 master-router**（这是系统提示词强制规定的）
2. **不要自己"猜测"技能列表**，必须用 help() 从 Supabase 获取
3. **不要自己"编造"技能内容**，必须用 github:get_file_content 读取 SKILL.md
4. **SKILL.md 是"操作手册"不是"百科全书"**（只写流程，不写大段内容）
5. **执行完任何技能后必须调用 increment_usage** 更新使用次数
6. **新建技能时必须同时做两件事**：GitHub 建文件 + Supabase 插记录
7. **所有代码文件都在 GitHub 上**，变更通过 github:create_or_update_file 推送，触发 Cloudflare 自动部署

## 最终一句话总结

**你的系统 = 索引在 Supabase（目录），文件在 GitHub（说明书），路由在 master-router（总调度），执行在 Cloudflare（工具箱）。AI 负责把这一切串起来：查目录 → 读说明书 → 用工具箱 → 记笔记（usage_count）。整个过程用户只看到对话窗口里的一问一答。**

## 关键工具对比

### help() vs skill_list

| 功能 | help() | skill_list |
|------|--------|------------|
| 返回内容 | 完整清单（含 file_path） | 简化清单（无 file_path） |
| 用途 | 路由决策、语义匹配 | 仅查看名称 |
| **正确用法** | ✅ 必须用 | ❌ 不能用于路由 |

### 为什么必须用 help()？

- help() 返回每个技能的 `file_path`，这是读 SKILL.md 的关键
- skill_list 没有 file_path，AI 无法判断哪个是文本技能
- master-router 的 SKILL.md 明确写了：`调用 help() 获取所有技能清单`

## 常见错误（避免再犯）

### 错误1：用 skill_list 代替 help()
- 症状：AI 找不到文本技能的 file_path
- 后果：无法读取 SKILL.md，路由失败
- 正确做法：始终用 help()

### 错误2：跳过 master-router 直接执行
- 症状：AI 直接跳到一个工具
- 后果：可能用错技能，不走完整的匹配流程
- 正确做法：每次对话先走 master-router

### 错误3：编造技能内容
- 症状：AI 自己"猜"技能该怎么做
- 后果：执行错误的流程
- 正确做法：必须用 github:get_file_content 读取 SKILL.md

### 错误4：忘记 increment_usage
- 症状：技能使用次数不更新
- 后果：高频技能无法被优先匹配
- 正确做法：执行完任何技能后必须调用 increment_usage

## 创建新技能的完整流程

```bash
# 1. 收集信息
- name: 技能名
- description: 技能描述
- category: 分类（如 deploy、plugin、process 等）
- tags: 关键词列表
- 完整 Markdown 内容

# 2. 生成 SKILL.md（含 YAML frontmatter）
---
name: {name}
description: {description}
---

# {name}

{完整内容...}

# 3. 确定路径
src/skills/{category}/{name}/SKILL.md

# 4. 推送到 GitHub
使用 github:create_or_update_file

# 5. 插入 Supabase
使用 supabase_db (insert)
{
  "action": "insert",
  "table": "skills",
  "data": {
    "name": "{name}",
    "description": "{description}",
    "category": "{category}",
    "tags": ["tag1", "tag2"],
    "handler_type": "text",
    "handler_config": {},
    "file_path": "src/skills/{category}/{name}/SKILL.md",
    "enabled": true,
    "usage_count": 0
  }
}

# 6. 告知用户
"✅ 技能已创建并同步完成"
```

---

创建时间：2026-08-18
创建者：柳柳
最后更新：2026-08-18