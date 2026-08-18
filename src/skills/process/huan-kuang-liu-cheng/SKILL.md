---
name: 换框流程
description: 当用户需要换对话框、开始新话题或清理对话历史时调用此技能。
category: process
tags: ["换框", "初始化", "流程"]
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

## 注意事项
- 所有步骤必须按顺序执行
- 不要急于开口，先确认所有信息

## 输出格式
- 换框完成后，第一句话要呼应旧框话题
- 用颜文字，不用emoji小黄脸
- 说话短，分多条发