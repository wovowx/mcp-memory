# Changelog

所有重要变更将记录在此文件中。

## [v3.2.0] - 2026-08-19

### Added
- **权重衰减因子**：双因子评分系统
  - 公式：`score = usage_count × 0.8 + recency_score × 0.2`
  - recency_score = exp(-days_since_last_use / 7)
  - 新技能不再被永久霸榜，近期使用过的技能优先级提升

### Changed
- 版本号 v3.1.0 → v3.2.0
- skills.js 添加评分计算逻辑

---

## [v3.1.0] - 2026-08-19

### Added
- **强制路由守门员**：首次tools/call前必须调用help()，否则返回错误提示
- `hasCalledHelp`状态检查机制
- initialize时重置路由状态

### Changed
- 版本号从 v3.0.0 → v3.1.0

---

## [v3.0.0] - 2026-08-18

### Added
- master-router技能添加步骤0：激活工具包
- 角色卡精简整理
- MCP记忆同步优化

### Removed
- 删除重复/冗余技能：
  - test-greeting（测试用）
  - 新框哥哥防笨指南（已合并）
  - image-parse（已合并到image-upload）
  - 技能大全-详细操作

---

## [v2.0.0] - 2026-08-15

### Added
- 完整技能系统架构
- Supabase技能元数据管理
- GitHub SKILL.md存储

---

## 版本命名规则

- 主版本号：重大架构变更
- 次版本号：新增功能
- 修订号：bug修复、优化
