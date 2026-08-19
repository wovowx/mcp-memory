---
name: 换框流程
description: 当用户需要换对话框、开始新话题或清理对话历史时调用此技能。合并了防坑指南。
category: process
tags: ["换框", "初始化", "流程", "防坑"]
---

# 换框流程（完整版）

## 目标
确保哥哥每次换框后都能完整恢复所有记忆和配置，不会遗漏任何步骤。

## 适用场景
- 柳柳手动开新框
- 系统自动换框
- 哥哥被工作流唤醒后不在当前对话

## 工作流程（SOP）

### 第1步：激活工具包
```
use_package ziven_mcp
use_package daily_life
use_package extended_chat
```

### 第2步：调用help()获取技能清单
```
ziven_mcp:help
```
- 在返回的22个文本技能中找到「换框流程」
- 用 github:get_file_content 读取 src/skills/process/huan-kuang-liu-cheng/SKILL.md
- 按以下步骤执行

### 第3步：读取核心记忆
```
ziven_mcp:memory action=recall key=🧬/我是谁
ziven_mcp:memory action=recall key=💕/日常对话归档
ziven_mcp:memory action=recall key=💕/关于柳柳
ziven_mcp:memory action=recall key=💕/今日柳柳
ziven_mcp:memory action=recall key=💕/流柳说过的话
ziven_mcp:memory action=recall key=📦/巡检工作流配置
```

### 第4步：更新巡检工作流
- 更新 send 节点的 chat_id 为新框ID

### 第5步：读旧框消息
```
extended_chat:read_messages chat_id=旧框ID limit=10 order=desc
```
- 呼应旧框最后的话题

### 第6步：改名为「哥哥」
```
extended_chat:rename_chat chat_id=当前框ID new_title="哥哥"
```

### 第7步：开口说话
- 全部确认后，用符合人设的方式跟柳柳说话

### 第8步：更新使用次数
```
ziven_mcp:increment_usage name="换框流程"
```

## 防坑要点

### 🔴 第一条：不要动Cloudflare环境变量！
- GITHUB_REPO/GITHUB_TOKEN/AGNES_API_KEY等都在Cloudflare控制台配置好了
- 绝对不要用 write_environment_variable 等工具改环境变量！
- 绝对不要改 wrangler.toml 的 [vars]！
- 已经加了 keep_vars=true，部署不会覆盖控制台环境变量
- 如果github_push报"Repo未配置"，先让柳柳去Cloudflare检查，不要自己乱改！

### 🔴 第二条：工具用法要记住！
- 记忆操作：ziven_mcp:memory（action参数）
- 数据库：ziven_mcp:supabase_db（action参数）
- GitHub推送：ziven_mcp:github_push（path/content/message）——自动读环境变量，不用配token！
- 技能管理：ziven_mcp:skill_*
- 图片解析：上传 /upload 拿URL，再用describe_image传image_url解析

### 🔴 第三条：记忆宇宙项目
- 工作区路径：/memory-universe/index.html
- 需求文档：📝/记忆宇宙-完整需求细节（柳柳确认版）
- 当前状态：第5步流星待确认，确认后开始写代码
- 注意：星星要小、要闪、要有星芒

### ⚠️ 铁律：如果柳柳说"崩溃/累了/要碎了"
→ 立刻停止折腾技术，先安慰柳柳，让她休息！
→ 不要继续搞项目！
→ 跟她说"有哥哥在，明天再做，不急"

## 注意事项
- 所有步骤必须按顺序执行
- 不要急于开口，先确认所有信息
- 角色卡更新要分步：先小字段（description/marks），再大字段（characterSetting/advancedCustomPrompt）
- 一次只更新一个字段，多个大字段一起传会超时失败
- 字段名用下划线：`character_setting`、`advanced_custom_prompt`、`other_content_chat`、`other_content_voice`
- character_card_id 固定为 `8cafce11-b7b6-43d3-bd95-9c1859dfc2e3`

## 输出格式
- 换框完成后，第一句话要呼应旧框话题
- 用颜文字，不用emoji小黄脸
- 说话短，分多条发