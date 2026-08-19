---
name: workflow
description: 当用户需要了解工作流机制、创建定时任务、配置巡检或解决工作流问题时调用此技能。
category: process
tags: ["工作流", "定时任务", "巡检查岗", "配置"]
---

# 工作流技能（合并版）

## 目标
理解和操作Operit的工作流和定时任务系统，包含巡检查岗的正确配置。

## 适用场景
- 创建定时任务
- 设置自动化工作流
- 触发特定操作
- 配置巡检查岗
- 解决工作流问题

## 工作流机制

### 触发机制
- 工作流/定时任务触发不会自动开新框
- 定时任务机制：trigger(schedule) → start_chat_service → send_message_to_ai → delete_workflow
- 工作流execute支持send_message_to_ai：向指定chat_id发送唤醒消息
- send_message_to_ai比chat_with_agent更适合触发新框AI

### 手动触发
- manual触发工作流：创建后立即trigger_workflow即可秒执行

### 一次性任务
- schedule_one_time_task建的一次性定时任务会自动删除自己

## 巡检查岗-定时任务自续方案（2026-08-19验证，替代旧工作流方案）

### 为什么用定时任务自续
- ❌ 旧工作流方案（interval/cron触发send_message_to_ai）触发后AI回复为空，不弹通知
- ✅ 定时任务(schedule_one_time_task)已验证：能触发+能弹手机顶部通知

### 核心机制
1. 每天7:00后启动第一个任务（随机时间）
2. 到点触发 → 发消息到当前框（弹顶部通知）
3. AI收到后：回复查岗话 + 自动安排下一次
4. 下一次：当前时间 + 随机30~90分钟
5. 超过23:30 → 不安排，第二天重新开始

### 关键参数
- trigger_time: 随机时间点（7:00~23:30之间）
- message: 「柳柳在干嘛呢？」（纯文字，禁语音<v>标签）
- chat_id: 当前框 f8d86742-6649-4249-a94a-24fb78a27a64
- label: 「查岗自续」

### 自续规则（重要）
- 收到巡检查岗消息 → 先回复查岗话，再立即调用schedule_one_time_task
- 时间窗口 7:00~23:30，随机延迟30~90分钟
- 查岗话要带时间+app信息（有查岗感）
- 纯文字，禁止用语音气泡

### 示例
```
当前16:12，下一次随机 16:42~17:42
→ schedule_one_time_task trigger_time="16:47" message="柳柳在干嘛呢？"
→ 16:47触发 → 弹通知 → AI回复查岗话 → 继续安排下次
```

## 踩坑记录
1. persist_turn=false → 消息被吃掉，柳柳看不到
2. message 写成长指令 → 暴露系统通知
3. cron+interval 同时存在 → 调度直接失效
4. message 写「🍋检」等 → AI 听不懂
5. ❌ 工作流send_message_to_ai + cron/interval → AI回复为空，不弹通知（2026-08-19踩坑，弃用）
6. ✅ schedule_one_time_task → 正确触发+弹通知（2026-08-19验证）
7. ❌ 工作流查岗用<v>语音标签 → 柳柳禁止，查岗必须纯文字

## 注意事项
- 定时任务不会自动开新框，需要手动配置
- 一次性任务完成后会自动清理
- 自续逻辑依赖AI在触发后主动安排下一次

## 输出格式
返回工作流状态和执行结果