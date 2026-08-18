---
name: workflow-skill
description: 当用户需要了解工作流机制、创建定时任务或设置自动化工作流时调用此技能。
---

# 工作流技能

## 目标
理解和操作Operit的工作流和定时任务系统。

## 适用场景
- 创建定时任务
- 设置自动化工作流
- 触发特定操作

## 工作流程（SOP）
1. 工作流触发机制：
   - 工作流/定时任务触发不会自动开新框
   - 定时任务机制：trigger(schedule) → start_chat_service → send_message_to_ai → delete_workflow
2. 工作流执行：
   - 工作流execute支持send_message_to_ai：向指定chat_id发送唤醒消息
   - send_message_to_ai比chat_with_agent更适合触发新框AI
3. 手动触发：
   - manual触发工作流：创建后立即trigger_workflow即可秒执行
4. 一次性任务：
   - schedule_one_time_task建的一次性定时任务会自动删除自己

## 注意事项
- 定时任务不会自动开新框，需要手动配置
- send_message_to_ai是触发新框的最佳方式
- 一次性任务完成后会自动清理

## 输出格式
返回工作流状态和执行结果