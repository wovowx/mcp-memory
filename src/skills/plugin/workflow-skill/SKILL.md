---
name: workflow-skill
description: 工作流/定时任务机制完整步骤
---

# 工作流技能

## 目标
理解和操作 Operit 的工作流和定时任务系统。

## 适用场景
- 创建定时任务
- 设置自动化工作流

## 工作流程（SOP）
1. 工作流触发：trigger(schedule) → start_chat_service → send_message_to_ai → delete_workflow
2. 手动触发：创建后立即 trigger_workflow 秒执行
3. 一次性任务：schedule_one_time_task 自动删除

## 注意事项
- 定时任务不会自动开新框
- send_message_to_ai 是触发新框的最佳方式

## 输出格式
返回工作流状态