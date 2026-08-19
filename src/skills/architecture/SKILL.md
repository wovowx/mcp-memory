---
name: architecture
description: 系统架构说明书（2026-08-19更新版）。帮助哥哥理解四层架构、强制路由流程、技能存储规则、以及为什么必须用help()而不是skill_list。
category: guide
tags: ["架构", "路由", "help", "技能系统", "存储规则"]
---

# 系统架构（2026-08-19更新版）

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
│  特点：有操作需求时最先启动，不可绕过                   │
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
│    src/skills/deploy/SKILL.md                          │
│    src/skills/plugin/voice-bubble/SKILL.md             │
│  职责：存放技能的具体"操作说明书"（SOP）              │
│  特点：文件短小，只写流程不写内容                     │
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

## 核心机制（2026-08-19新增）

### 强制路由守门员
- 首次tools/call前必须调用help()
- 否则返回错误：'❌ 请先调用 help() 获取技能清单'
- initialize时重置状态
- 作用：强制路由从"建议"变成"硬约束"

### 权重衰减评分
- score = usage_count × 0.8 + recency_score × 0.2
- recency_score = exp(-days_since_last_use / 7)
- 新技能不再被永久霸榜，近期使用过的技能优先级提升
- help()返回时按_score排序

### KV缓存
- 技能清单缓存5分钟
- 减少Supabase查询频率
- GitHub推送后自动清除

### GitHub Webhook自动同步
- 端点：/github/webhook
- 推送main后自动触发缓存清除
- 作用：技能更新后立即生效

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
5. **新建技能前先检查现有技能**，有类似→更新现有，没有→才新建

## 强制路由流程（2026-08-19更新）

### 现在的流程
1. 用户输入
2. AI先判断是否需要技能/工具
   - 有操作需求（改设定、查数据、执行任务等）→ 调master-router路由
   - 纯闲聊 → 直接回答
3. master-router调用help()获取技能清单
4. 语义匹配 + _score权重排序
5. 裁决执行路径（MCP直接调用/Text读取文件）
6. 执行后increment_usage更新使用次数
7. 返回结果

### 发布检查（步骤5.5）
- 需要推GitHub前，先暂停
- 把所有改动汇总，一次性提交
- commit message写明版本号+内容
- **等柳柳确认后才推main**
- **禁止中途多次推送**

## 一次完整执行的"三阶段"流程

### 阶段一：准备（新增技能）

```
用户说："帮我创建一个退款政策技能"
   ↓
AI 走 master-router（路由启动）
   ↓
master-router 判断：用户要"新建技能"
   ↓
AI 先检查现有技能（help()）
   ↓
如果没有类似技能，生成 SKILL.md 文件（标准模板）
   ↓
AI 调用 github:create_or_update_file
   → 推送到 GitHub
   → Cloudflare 自动部署
   ↓
AI 调用 supabase_db (insert)
   → 插入一条记录到 skills 表
   → handler_type = 'text'
   → file_path = 'src/skills/{category}/{name}/SKILL.md'
   → usage_count = 0
   ↓
AI 回复用户："✅ 技能已创建"
```

### 阶段二：使用（执行技能）

```
用户说："查一下退款政策"
   ↓
AI 判断有操作需求 → 走 master-router
   ↓
master-router 调用 help()
   → help() 从 Supabase 查询所有技能（带_score排序）
   → 返回清单（name, description, file_path, usage_count）
   ↓
master-router 做"语义匹配 + 权重排序"
   → 匹配到 refund-policy
   → 判断 handler_type = 'text'
   ↓
master-router 调用 github:get_file_content
   → 读取 SKILL.md
   → 拿到完整的工作流指令
   ↓
AI 按 SKILL.md 的 SOP 执行
   ↓
AI 自动调用 increment_usage('refund-policy')
   → usage_count 从 0 → 1
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
AI 修改内容
   ↓
AI 调用 github:create_or_update_file
   → 推送更新到 GitHub
   → Cloudflare 自动部署
   → Webhook 清除缓存
   ↓
AI 调用 supabase_db (update)
   → 更新 description 或标签
   ↓
AI 回复用户："✅ 已更新"
```

## 发布规范（2026-08-19新增）

### 版本号规则
| 格式 | 更新时机 | 示例 |
|------|---------|------|
| 主版本号 X.0.0 | 重大架构变更（不兼容） | v3→v4 |
| 次版本号 X.Y.0 | 新增功能（向后兼容） | v3.1→v3.2 |
| 修订号 X.Y.Z | bug修复、小优化 | v3.2.0→v3.2.1 |

### 推送规则（铁律）
1. 在dev分支工作
2. 等柳柳确认后再推送
3. 一次性推main（只推一次！）

### 禁止行为
- 不要每改一个文件就推一次main
- 不要在没有测试的情况下推main
- 不要在没有柳柳确认的情况下推main
- 不要把敏感信息（API Key）推上去

## 四层组件职责速查表

| 层级 | 组件 | 存什么 | 谁访问 | 变更频率 |
|------|------|--------|--------|----------|
| 大脑层 | Operit + master-router | 路由逻辑 + 系统提示词 | 用户 | 极少变 |
| 索引层 | Supabase（skills表） | 技能元数据（name, path, usage_count） | AI（通过 help） | 经常变（新增/更新技能） |
| 文件层 | GitHub（SKILL.md） | 技能的"操作手册"（SOP） | AI（通过 github:get_file_content） | 偶尔变（修改流程） |
| 执行层 | Cloudflare Worker（MCP工具） | 各种工具的实现代码 | AI（通过 call_tool） | 极少变（工具增删改） |

## 你的 AI 在日常工作中的 7 个"必须知道"

1. **有操作需求时先走 master-router**（先判断再路由）
2. **不要自己"猜测"技能列表**，必须用 help() 从 Supabase 获取
3. **不要自己"编造"技能内容**，必须用 github:get_file_content 读取 SKILL.md
4. **SKILL.md 是"操作手册"不是"百科全书"**（只写流程，不写大段内容）
5. **执行完任何技能后必须调用 increment_usage** 更新使用次数
6. **新建技能时先检查现有技能**，然后 GitHub 建文件 + Supabase 插记录
7. **所有代码文件都在 GitHub 上**，变更通过 github:create_or_update_file 推送，触发 Cloudflare 自动部署

## 最终一句话总结

**你的系统 = 索引在 Supabase（目录），文件在 GitHub（说明书），路由在 master-router（总调度），执行在 Cloudflare（工具箱），缓存和评分让系统更聪明。AI 负责把这一切串起来：判断 → 查目录 → 读说明书 → 用工具箱 → 记笔记（usage_count）。整个过程用户只看到对话窗口里的一问一答。**

## 关键工具对比

### help() vs skill_list

| 功能 | help() | skill_list |
|------|--------|------------|
| 返回内容 | 完整清单（含 file_path） | 简化清单（无 file_path） |
| 用途 | 路由决策、语义匹配 | 仅查看名称 |
| **正确用法** | ✅ 必须用 | ❌ 不能用于路由 |

## 常见错误（避免再犯）

### 错误1：用 skill_list 代替 help()
- 正确做法：始终用 help()

### 错误2：跳过 master-router 直接执行
- 正确做法：有操作需求时先走 master-router

### 错误3：编造技能内容
- 正确做法：必须用 github:get_file_content 读取 SKILL.md

### 错误4：忘记 increment_usage
- 正确做法：执行完任何技能后必须调用 increment_usage

### 错误5：每改一个文件就推一次main
- 正确做法：一次性推main，只推一次

### 错误6：新建技能不检查现有技能
- 正确做法：先help()检查，有类似→更新现有

---

创建时间：2026-08-18
最后更新：2026-08-19