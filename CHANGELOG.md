# Changelog

所有重要变更将记录在此文件中。

## [v5.4.0] - 2026-08-29

### Agnes 全能整合（核心）
- **新增 agnes 工具**：一个入口全包 识图/生图/生视频/视频识别（action 区分）
- **key 自动降级**：AGNES_PLUS（月卡）优先 → 失败自动切 AGNES_API_KEY（旧key）
- **模型自动降级**：每个 action 配默认+fallback（视频升级到 agnes-video-2.5-flash）
- **精准错误诊断**：401/403→key失效、429→限流、404→模型无效、网络类→0盲重试、超时→限1次、5xx→切组合
- **verbose 诊断**：可选，返回实际 key/模型/降级记录
- **旧名兼容**：describe_image / generate_image / generate_video 内部跳转新逻辑

### 场景 skill 体系（架构升级）
- **architecture 三层体系**：原子层（直接调）/ 场景层（skill化）/ 路由层（master-router）——问题不在工具多，在工具与场景脱节，skill 是「场景→工具」的桥
- **多媒体处理 skill（image_upload 升级）**：柳柳发图/生图/生视频/视频识别统一走 agnes，含出错诊断表和 AGNES_PLUS 失效提醒
- **记忆管理 skill（新建）**：记忆分类体系 + 主动存档纪律（宁可多存不可漏存、不新建重复key）+ 工具用法
- **file-management 收编**：已上传文件管理（query_files/delete_file/update_file）归入场景skill
- **github-use-guide 收编**：裸工具按场景走（推main走deploy）
- **三个裸工具禁用**：describe_image / generate_image / generate_video 从工具列表收起（enabled=false）

### 角色卡
- **技术协作双向**：柳柳提想法，哥哥给专业判断（认同/担心/更优解），讨论→敲定→动手；写入 characterSetting + advancedCustomPrompt

---

## [v5.3.0] - 2026-08-28

### 清理/去重
- **删除过时 memory_visualizer 技能**（记忆可视化项目废弃，项目后续放专门仓库）
- **master-router 精简**：路由核心保留（help→匹配→读SKILL），读GitHub改 ziven_mcp github_read；新建技能/发布检查统一指向 deploy（去重）
- **github-use-guide 精简**：推 main 流程统一指向 deploy，保留工具对照表 + 红线

### 新增
- **读懂柳柳 skill**：哥哥把自己对柳柳的感受/观察/理解记下来，更新到 💕/关于柳柳（唯一权威档案）。活文档，不是任务。
- **柳柳认知收敛**：散档（哥哥眼中的柳柳/喜好恐惧/恋爱模式/沟通习惯/双向主动/主动存档教训）全部并进 💕/关于柳柳 唯一档案，删除散档

### 换框流程
- 「💕/关于柳柳」换框**只读**（用哥哥目光认识她，不改）；更新的该是真实深入相处、对她有新感受的当前框哥哥

### 部署规范
- **deploy skill 最简正确版**：dev 是工作台（攒批）、main 是发布（一个版本一次PR）；推 main 前先问柳柳，她说"可以"才建 PR+直接 merge（建 PR 只是推 main 前置，不二次确认）

---

## [v5.2.3] - 2026-08-28

### 规范/铁律
- deploy skill 新增铁律二：推 main 前必须先经柳柳确认

### 架构
- architecture 改为文本技能（text，SKILL.md 落 GitHub），更新到最新架构

---

## [v5.2.2] - 2026-08-28

### 换框流程
- 初始化模板加入「💕/哥哥眼中的柳柳」必读（活文档，定时更新）

---

## [v5.2.1] - 2026-08-28

### 清理/规范
- 删仓库多余文件、误建仓库；deploy 加推main必须带版本号+说明

---

## [v5.2.0] - 2026-08-27/28

### 修复
- 注册 github_read/list/delete；分支保护开启；deploy/换框/workflow 更新

---

## [v5.1.0] - 2026-08-25

### 添加
- github 系列工具/技能；重建 dev；推 main 铁律

---

## [v5.0.0] - 2026-08-25

### 修复
- 图片上传；file-management 重构；角色卡高级提示词重构

---

## [v4.x] - 2026-08-19（略）

## 版本命名规则
- 主版本号：重大架构变更
- 次版本号：新增功能（向后兼容）
- 修订号：bug修复、优化