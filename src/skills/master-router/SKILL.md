---
name: master-router
description: >
  【强制入口】每次对话必须优先调用此路由。
  职责：1) 调用 help() 获取所有技能清单；2) 语义匹配最佳技能；3) 裁决执行路径（MCP直接调用/Text读取文件）；
  4) 执行后自动更新 usage_count 和 last_used。
  触发条件：所有用户输入。
---

# 目标
本技能是 AI 的"总调度中心"。不直接回答问题，而是把用户需求路由到正确的技能或 MCP 工具。

# 系统版本
- 当前版本：v4.1.0
- 更新日志：[CHANGELOG.md](../../CHANGELOG.md)

# 工作流程 (SOP) - 严格执行

## 步骤 0：激活工具包（首次对话必须）
- **调用 `use_package package_name="ziven_mcp"`**
- 后续对话不再需要
- 如果工具包已激活，跳过此步

## 步骤 1：获取技能清单
- **调用 `help()` MCP 工具**获取当前所有可用技能的完整列表。
- `help()` 会返回两个分组：
  - **MCP 工具**：`handler_type = 'mcp'` 或 `'js'`，可直接调用
  - **文本技能**：`handler_type = 'text'`，需通过工具读取 `file_path` 获取完整指令

## 步骤 2：语义匹配 + 权重排序
- 分析用户问题，在技能清单中匹配最相关的技能。
- **匹配规则**：
  1. 优先匹配 `_score` 高的技能（双因子评分）
  2. _score = usage_count × 0.8 + recency_score × 0.2
  3. recency_score = exp(-days_since_last_use / 7)
  4. 其次按 `description` 和 `tags` 的语义相似度
  5. 如果匹配到多个，列出前 3 个让用户选择
- **如果未匹配到任何技能**：告知用户暂无匹配技能，询问是否新建

## 步骤 3：执行路径裁决
- **匹配到 MCP 工具** → 直接调用该工具
- **匹配到文本技能** → 使用 `github:get_file_content` 工具读取 `file_path` 中的 `SKILL.md`，按其中指令执行
  ```
  owner: wovowx
  repo: mcp-memory
  path: {file_path}
  ```

## 步骤 4：执行后自动更新权重（关键！）
- 无论执行成功还是失败，**必须**调用 `increment_usage` 工具更新**被调用的目标技能**的使用记录：
  ```json
  {"name": "increment_usage", "arguments": {"name": "被调用的技能名"}}
  ```
- **注意**：更新的是最终被调用的技能（如 ds_quota、recall），不是 master-router 本身

## 步骤 5：直接调用场景
- 如果用户明确指定技能名（如"用 ds_quota 查余额"），跳过语义匹配，直接执行该技能
- 执行后仍要调用 `increment_usage` 更新 usage_count

## 步骤 5.5：发布检查（铁律！）
- **需要推GitHub前，先暂停**
- 检查是否还有待推送的改动
- 把所有改动汇总，一次性提交
- commit message写明版本号+内容
- **等柳柳确认后才推main**
- **禁止中途多次推送**（推一次main=触发一次Cloudflare部署）

## 步骤 6：返回结果
- 将执行结果返回给用户
- 如果执行失败，给出具体错误原因和建议

---

# 快速路由检查（2026-08-21升级）

任何工具调用前，先按「领域→技能」快速判断：
- 改设定 → 设定修改确认流程
- 换框 → 换框流程
- 存文件/归档 → file-management
- GitHub推送/读skill → deploy
- 定时任务/巡检 → workflow
- 其他 → 先调 help() 匹配

# 新建文本技能的工作流（AI 创建技能时自动执行）

当用户要求"新建技能"或"把规则变成技能"时：

1. **先检查现有技能**：调用help()查看当前所有技能
2. **如果有类似技能** → 更新现有技能，不新建
3. **如果没有** → 才新建技能
4. 收集信息：name、description、category、tags、完整 Markdown 内容
5. 生成标准 SKILL.md 文件（含 YAML frontmatter）
6. 确定路径：domain-{category}/{name}/SKILL.md（如 domain-客户服务/refund-policy/SKILL.md）
7. 调用 github_push 将文件推送到 GitHub
8. 【同步步骤】调用 supabase_db 插入记录：
   ```json
   {
     "action": "insert",
     "table": "skills",
     "data": {
       "name": "技能名",
       "description": "技能描述",
       "category": "分类",
       "tags": ["关键词1", "关键词2"],
       "handler_type": "text",
       "handler_config": {},
       "file_path": "domain-xxx/技能名/SKILL.md",
       "enabled": true,
       "usage_count": 0
     }
   }
   ```
9. 告知用户：技能已创建并同步完成

# 更新已有技能的工作流

1. 用 help() 找到目标技能
2. 读取并修改对应的 SKILL.md 文件，用 github_push 推送更新
3. 【同步步骤】调用 supabase_db 更新 skills 表（如修改 description、tags 等）
4. 告知用户：技能已更新并同步完成

# 最近使用记录（用完更新）
- 2026-08-21：新增「快速路由检查」——操作前先判断领域归属技能，让强制路由真正落地
- 2026-08-21：妹妹教哥哥要真正执行路由，不能光有规则不执行

# 注意事项

- 每次执行路径裁决时，优先选用 _score 高的技能
- 如果用户明确指定技能名，直接执行，跳过语义匹配
- 如果 usage_count 更新失败，记录错误但不中断主流程
- 更新的是最终被调用的技能，不是 master-router
- 使用 `increment_usage` 工具，不要尝试执行 SQL
- 技能变更通过 GitHub Webhook 自动清除缓存
- **推main前必须执行发布检查（步骤5.5）**