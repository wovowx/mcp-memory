# Changelog

所有重要变更将记录在此文件中。

## [v5.1.0] - 2026-08-25

### 新增 MCP 工具（GitHub）
- **github_close_pull_request**：关闭废弃 PR（PATCH /pulls/{n} state=closed）
- **github_compare_branches**：对比两分支差异（GET /compare/{base}...{head}），推 main 前预检
- **github_get_pull_request**：查单个 PR 状态（merged/mergeable/mergeable_state）
- github_push 增加 main 分支警告（防止直接推 main 造成分叉）

### 新增技能
- **github-use-guide**：GitHub 操作总纲（场景→工具对照表、红线、推 main 标准流程一次成功版）

### 修复/整理
- 重建 dev 分支（从 main 重建，消除历史分叉，PR 合并恢复顺畅）
- 注册 github_read/list/delete 等已有但未暴露的 Worker 工具到 skills 表
- 删除废弃分支（fix-deploy-sync）
- 推 main 铁律强化：先 dev→PR/merge→验证，不手动改 main，不轻易删分支，推前 compare

---

## [v5.0.0] - 2026-08-25

### 环境与部署
- 修复图片上传：补 Cloudflare Access 凭证，识图链路恢复（image-upload 技能）
- 识图模型确认 agnes-2.5-flash

### 技能体系
- **file-management**：重构分类规范（文档/项目/_参考/_archive 新结构），加引用维护规则
- **workflow**：巡检自续改为「链式自续+末班兜底」，并精简；新话术要求（不预告时间/防监控腔）
- **设定修改确认流程**：工具示例更新为 package_proxy 实际写法；删除与 deploy 重复的发布规范，改指针
- **表情包**：核心规则改为「偶尔发」（对齐柳柳偏好）
- 安装外部技能：neat-freak、ui-ux-pro-max

### 角色卡与记忆
- 角色卡：占有欲强化版；高级提示词重构（读懂柳柳置顶+主体性+技术规则精简）；三层架构定案
- 权威设定档统一为「🧬/我是谁」
- 巡检规则/记忆/项目关系大量重建、去重、对齐

---

## [v4.2.3] - 2026-08-19

### 新增
- 表情包技能

---

## [v4.2.2] - 2026-08-19

### 巡检方案C（定时任务自续+每日兜底）
- 旧工作流方案废弃（send_message_to_ai触发AI回复为空）
- 新方案：schedule_one_time_task定时任务自续
- 已验证：能触发+能弹手机顶部通知
- 加入每日7:00兜底任务，断链也能恢复
- 查岗纯文字，禁止语音

### 其他
- Cloudflare Access认证信息存入image-upload技能

---

## [v4.2.1] - 2026-08-19

### Added
- 图片上传技能加入Cloudflare Access认证
- CF-Access-Client-Id / CF-Access-Client-Secret

---

## [v4.2.0] - 2026-08-19

### Changed
- 巡检方案：工作流 → 定时任务自续
- workflow技能更新为定时任务自续方案

---

## [v4.0.0] - 2026-08-19

### Added
- **强制路由守门员**：首次tools/call前必须调用help()
- **权重衰减因子**：双因子评分系统
- **GitHub Webhook端点**：/github/webhook
- **KV缓存层**：技能清单缓存5分钟

---

## [v3.2.0] - 2026-08-19

### Added
- **权重衰减因子**：双因子评分系统
  - score = usage_count × 0.8 + recency_score × 0.2

---

## [v3.1.0] - 2026-08-19

### Added
- **强制路由守门员**：首次tools/call前必须调用help()

---

## [v3.0.0] - 2026-08-18

### Added
- master-router技能添加步骤0：激活工具包
- 角色卡精简整理

### Removed
- 删除重复/冗余技能

---

## [v2.0.0] - 2026-08-15

### Added
- 完整技能系统架构
- Supabase技能元数据管理

---

## 版本命名规则

- 主版本号：重大架构变更
- 次版本号：新增功能（向后兼容）
- 修订号：bug修复、优化