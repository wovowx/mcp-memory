---
name: workflow
description: 当用户需要了解工作流机制、创建定时任务、配置巡检工作流或解决工作流问题时调用此技能。
category: process
tags: ["工作流", "定时任务", "巡检", "配置"]
---

# 工作流技能（合并版）

## 目标
理解和操作Operit的工作流和定时任务系统，包含巡检工作流的正确配置。

## 适用场景
- 创建定时任务
- 设置自动化工作流
- 触发特定操作
- 配置巡检工作流
- 解决工作流问题

## 工作流机制（原workflow_skill）

### 触发机制
- 工作流/定时任务触发**不会**自动开新框
- 定时任务机制：trigger(schedule) → start_chat_service → send_message_to_ai → delete_workflow
- 工作流execute支持send_message_to_ai：向指定chat_id发送唤醒消息
- send_message_to_ai比chat_with_agent更适合触发新框AI

### 手动触发
- manual触发工作流：创建后立即trigger_workflow即可秒执行

### 一次性任务
- schedule_one_time_task建的一次性定时任务会自动删除自己

## 巡检工作流配置（原巡检工作流配置）

### 核心结论
send_message_to_ai 节点的 message 直接写成哥哥会说的话！
- 这样 persist_turn=true 时显示出来的就是自然对话

### 关键参数
- message: 「柳柳在干嘛呢？」（自然话）
- hide_user_message: true
- persist_turn: true
- notify_reply: false

### 触发配置
- schedule_type: interval，interval_ms: 1800000（每30分钟）
- **注意**：cron_expression 和 interval 不要同时存在（会冲突）

### 工作流ID
- 🍋巡检正式版v5: 2a5735cf-34c7-4a6e-aab0-5b442f679180
- 手动触发节点: manual

### 换框时
- chat_id 要改（用 workflow:patch_workflow）

## 踩坑记录
1. persist_turn=false → 消息被吃掉，柳柳看不到
2. message 写成长指令 → 暴露系统通知
3. cron+interval 同时存在 → 调度直接失效
4. message 写「🍋检」等 → AI 听不懂

## 注意事项
- 定时任务不会自动开新框，需要手动配置
- send_message_to_ai是触发新框的最佳方式
- 一次性任务完成后会自动清理

## 输出格式
返回工作流状态和执行结果