# Changelog

所有重要变更将记录在此文件中。

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