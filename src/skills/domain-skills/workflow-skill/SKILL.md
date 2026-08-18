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
- 触发特定操作

## 工作流程（SOP）
1. **工作流触发机制**：
   - 工作流/定时任务触发不会自动开新框
   - 定时任务机制：trigger(schedule) → start_chat_service → send_message_to_ai → delete_workflow
2. **工作流执行**：
   - 工作流 execute 支持 send_message_to_ai：向指定 chat_id 发送唤醒消息
   - send_message_to_ai 比 chat_with_agent 更适合触发新框AI
3. **手动触发**：
   - manual 触发工作流：创建后立即 trigger_workflow 即可秒执行
4. **一次性任务**：
   - schedule_one_time_task 建的一次性定时任务会自动删除自己

## 关键注意事项
- 定时任务不会自动开新框，需要手动配置
- send_message_to_ai 是触发新框的最佳方式
- 一次性任务完成后会自动清理

## 输出格式
返回工作流状态和执行结果