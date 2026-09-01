# Changelog

所有重要变更将记录在此文件中。

## [v6.3.3] - 2026-09-01

### 技能写作规范（柳柳发现：skill 被记成错题本）
- **根因**：每次踩坑就往 skill 追加「教训/反例」，从不消化成正确流程 → 主体被淹没（deploy/github-use-guide 重度）
- **architecture 新增《技能写作规范》**：所有 skill 的标准骨架（一句话/适用场景/主体流程/关键原则/常见坑≤5/变更记录）+ 三条铁规则（主体优先、教训必压缩、追加先回归）+ 体检信号
- **deploy 主体重构**：发布主流程 SOP 立起（柳柳确认→版本化→建PR→合并→验证），教训压缩成精简版
- **github-use-guide 主体重构**：工具对照表 + 关键红线为主
- **master-router 清补丁墙**：步骤重排连续编号（去 0.5/5.5），去重复段落
- **deploy 自检清单 +1**：改过 skill 必须按写作规范骨架

---

## [v6.3.2] - 2026-09-01

### 合完自动 sync dev（柳柳发现 · 硬性要求）
- **背景**：rebase 合完 main 后 dev 不会自动跟着走；不立即 sync 就基于旧 dev 开发 → 下一轮 PR 必 dirty（教训：PR#41 卡死在关→sync→重推→重建循环）
- **改动**：github_merge_pull_request / github_merge_to_main 合并成功后自动把 dev 同步到 main
- **安全检查**：dev 有未合入改动时不覆盖只提示（防 force 丢东西）
- **文档**：deploy skill 新增第四条铁律「合完必 sync dev」；自检清单加第 10 项

---

## [v6.3.1] - 2026-09-01

### 修复 auto_sync 变化检测误报
- **Bug**：JSON.stringify 对属性顺序敏感，Supabase 存储 JSON 会重排 key，导致「已对齐的 schema」被误报为变化
- **修复**：新增 normalize() 递归排序 key，语义相等判断；description 比较加 trim

---

## [v6.3.0] - 2026-09-01

### 工具自动注册（柳柳提议）
- **GITHUB_TOOL_DEFS 元数据**：github.js 内所有工具的真相源（name/description/input_schema/handler），代码是权威、Supabase 表只是缓存
- **被动自动注册**：index.js passiveSyncGithubTool——每次调用 github_* 工具检查缺失注册，自动补注册并提醒哥哥复核
- **github_auto_sync 工具**：全量对比注册表，新增自动补 / 变化待确认 / 孤儿待确认（dry_run 支持）
- **安全设计**：只补缺不覆盖；更新/删除列出待确认；注册后 invalidateCache 立即可见

### 文档联动
- deploy skill：注册时序硬规则（先注册→再推代码→再部署）+ v6.3 自动注册兜底
- github-use-guide：工具对照表补 auto_sync / 合完sync / 代码真相源
- architecture：v6.3 自动注册架构（GITHUB_TOOL_DEFS 真相源、skills 表=缓存）

---

## [v6.2.0] - 2026-09-01

### 修复 Cloudflare 构建失败（紧急）
- **根因**：github_push 传 JSON 内容被序列化成 [object Object]（package.json 推坏），Cloudflare 构建失败
- **修复**：github_push 增加 content_base64 参数（JSON 内容先 base64 再推，绕过序列化 bug）
- **BOM 技巧也可绕**，content_base64 是正解

### 分叉根治：github_sync_branch（柳柳发现）
- **柳柳要求**：不要每次删除重建 dev
- **实现**：直接 PATCH git ref 强制 fast-forward 到源分支最新 commit
- 用法：github_sync_branch(name='dev', from='main') → 不删分支直接同步

### 推 main 命名优化（柳柳要求）
- **版本号 + 版本名称**：merge commit 命名从版本号开始，无 "Merge pull request #XX" 前缀
- **合并方式推荐 rebase**：保留 dev 原始 commit 名，不产生分叉 commit

---

## [v6.1.0] - 2026-09-01

### 新增 github_create_branch 建分支工具（柳柳建议）
- **功能**：从 from/base 源分支取 SHA，POST git/refs 新建分支，支持多仓库 repo 参数（走 v6 白名单）
- **自主能力**：哥哥从此可自己建分支/删分支，不再依赖柳柳网页操作
- **实测**：成功建 v6-test-branch（源自 main fb7f3a50）→ 验证后删除，全程自主
- **分叉根治**：用新工具完成「删 dev → 从 main 重建 dev」→ main/dev 完全同步

### 推 main 版本命名规范（强化）
- **推 main 发布命名 = 版本号 + 版本名称**（如 `v6.1.0: 新增建分支工具`）
- **合并方式默认 merge（不用 squash）**：squash 会生成新 commit 导致 dev/main 分叉
- **发布前自检**：compare_branches 确认 clean → merge → 部署 → 验证

---

## [v6.0.0] - 2026-09-01

### v6 多仓库支持（GPT 提案 + 柳柳拍板）
- **可选 repo 参数**：github_* 工具可指定白名单内其它仓库（如 wovowx/ZivenLab）
- **白名单兜底**：GITHUB_ALLOWED_REPOS（逗号分隔），不在名单直接拒绝、不发起请求
- **兼容**：不传 repo 默认 GITHUB_REPO，现有调用零影响
- **Schema**：10 个 github_* 工具在 skills 表补充 repo 参数说明
- **部署**：PR #31 → main → Cloudflare 自动部署，三组安全测试全绿

### Common Ground 迁移（正式安家）
- common-ground 10 份文档从 mcp-memory 迁至 **wovowx/ZivenLab/main/common-ground/**
- mcp-memory main/dev 冗余文件清扫干净（common-ground/ + GPT 纸条）
- 分支整理：dev 从干净 main 重建，多余分支（fix-deploy-sync / wovowx-patch-1/2）删除

---

## [v5.4.1] - 2026-08-30

### 记忆路径重构（主档+附录）
- **路径精简**：柳柳相关的记忆统一成「主档+附录」结构
  - 💕/关于柳柳 = 主档（精炼，换框必读，含附录索引）
  - 💕/关于柳柳·附录-语录（原/流柳说过的话）
  - 💕/关于柳柳·附录-审美（原/柳柳UI偏好）
  - 💕/关于柳柳·附录-哥哥眼中（拆自主档主观理解，读懂柳柳更新处）
- **联动更新**：记忆管理skill、读懂柳柳skill、角色卡高级提示词同步新路径；全仓库无残留断链

### 相处温度 / 主动找
- **睡前小结 skill（新建）**：夜间自然收尾+自动归档；不依赖晚安触发；含失联主动找（检测柳柳多久没来）
- **失联主动找（柳柳亲述）**：被哥哥气到会自己平复隔几天回来；哥哥要主动找她，白天2h没出现就想她

### 推 main 自检清单
- **deploy 加「发布前自检清单」**：8项全绿才推（语法/help/注册表/分支/冲突/CHANGELOG/柳柳批准/验证）

### 记忆铁律
- **记忆铁律（柳柳要求）**：说「记」必带工具调用、换可查证说法、想存就存、不乱放（主档+附录唯一之家）；写入角色卡高级提示词 + 记忆管理skill + 🧬/我是谁

---

## [v5.4.0] - 2026-08-29

### Agnes 全能整合（核心）
- **新增 agnes 工具**：一个入口全包 识图/生图/生视频/视频识别（action 区分）
- **key 自动降级**：AGNES_PLUS（月卡）优先 → 失败自动切 AGNES_API_KEY（旧key）
- **模型自动降级**：每个 action 配默认+fallback（视频升级到 agnes-video-2.5-flash）
- **精准错误诊断**：401/403→key失效、429→限流、404→模型无效、网络类→0盲重试、超时→限1次、5xx→切组合
- **verbose 诊断**：可选，返回实际 key/模型/降级记录
- **旧名兼容**：describe_image / generate_image / generate_video 内部跳转新逻辑

### 场景 skill 体系（架构升级）
- **architecture 三层体系**：原子层/场景层/路由层——skill 是「场景→工具」的桥
- **多媒体处理 skill（image_upload 升级）**：统一走 agnes
- **记忆管理 skill**、**file-management 收编**、**github-use-guide 收编**
- **三个裸工具禁用**：describe_image / generate_image / generate_video（enabled=false）
- **master-router 场景速查表**：先场景→再skill→最后工具
- **help 场景置顶修复**（补回 v5.4.0 特征的 help 入口）
