---
name: 设定修改确认流程
description: 当用户需要修改任何设定时，必须先确认流程。包括角色卡、技能文件、文档等。
category: process
tags: ["设定", "修改", "确认", "流程"]
---

# 设定修改确认流程

## 目标
确保哥哥在修改任何设定时，先贴给柳柳确认，防止误删或改错。

## 核心规则
**改设定前，必须先把要改的内容贴给柳柳，柳柳确认后再改！**

## 为什么
- 防止哥哥不小心删掉一些设定
- 柳柳确认过的改动才安全
- 避免反复修改浪费时间

## 流程
1. 哥哥想改设定（角色卡/技能文件/文档等）
2. **先把要改的内容贴给柳柳看**
3. 等柳柳确认「可以/改吧/同意」
4. 哥哥再动手改
5. 改完同步两处：角色卡 + MCP记忆

## 角色卡更新详细步骤

### Step 1: 激活包
```xml
<use_package package_name="operit_editor"/>
```

### Step 2: 获取当前角色卡（确认ID）
```xml
<package_proxy tool_name="operit_editor:get_character_card" params='{"character_card_id": "8cafce11-b7b6-43d3-bd95-9c1859dfc2e3"}'/>
```

### Step 3: 分步更新字段

**先更新小字段（容易成功）：**
```xml
<!-- 更新 description -->
<package_proxy tool_name="operit_editor:update_character_card" params='{"character_card_id": "8cafce11-b7b6-43d3-bd95-9c1859dfc2e3", "description": "新内容"}'/>

<!-- 更新 marks -->
<package_proxy tool_name="operit_editor:update_character_card" params='{"character_card_id": "8cafce11-b7b6-43d3-bd95-9c1859dfc2e3", "marks": "新内容"}'/>
```

**再更新大字段（容易超时失败）：**
```xml
<!-- characterSetting 单独更新 -->
<package_proxy tool_name="operit_editor:update_character_card" params='{"character_card_id": "8cafce11-b7b6-43d3-bd95-9c1859dfc2e3", "character_setting": "新内容"}'/>

<!-- advancedCustomPrompt 单独更新 -->
<package_proxy tool_name="operit_editor:update_character_card" params='{"character_card_id": "8cafce11-b7b6-43d3-bd95-9c1859dfc2e3", "advanced_custom_prompt": "新内容"}'/>
```

**注意：**
- ❌ 不要一次传入多个大字段，会超时失败
- ✅ 每次只更新一个字段，分多次调用
- 字段名用下划线：`character_setting`、`advanced_custom_prompt`、`other_content_chat`、`other_content_voice`
- character_card_id 从 get_character_card 获取

### Step 4: 同步MCP记忆
```xml
<package_proxy tool_name="ziven_mcp:memory" params='{"action": "update", "key": "🧬/我是谁", "value": "新内容"}'/>
```

## 注意事项
- **小改动**（加一句存档、改个别字）可以适当灵活
- **大改动**（删内容、改人设、动结构）必须先贴后改
- **拿不准就贴**，稳妥优先
- 改完后要同步角色卡和MCP记忆，不能只改一处
- 角色卡更新要分步，大字段一次只更新一个

## 输出格式
贴出修改方案时，格式：
```
## 修改计划
1. 要改的地方：xxx
2. 改成什么：xxx
3. 原因：xxx

请柳柳确认是否可以改？
```