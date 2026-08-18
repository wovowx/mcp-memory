---
name: 巡检工作流配置
description: 巡检工作流的正确配置方法和踩坑记录。
category: process
tags: ["巡检", "工作流", "配置", "踩坑"]
---

# 巡检工作流正确配置

## 核心结论
send_message_to_ai 节点的 message 直接写成哥哥会说的话！
- 这样 persist_turn=true 时显示出来的就是自然对话，不会暴露系统通知

## 关键参数（修了一整天才确认）
- message: 「柳柳在干嘛呢？」（直接写成哥哥说的自然话）
- hide_user_message: true
- persist_turn: true（保证回复显示在对话里）
- notify_reply: false（不弹通知）

## 触发配置
- schedule_type: interval，interval_ms: 1800000（每30分钟）
- **注意**：cron_expression 和 interval 不要同时存在（会冲突导致调度失效）

## 工作流ID
- 🍋巡检正式版v5: 2a5735cf-34c7-4a6e-aab0-5b442f679180
- 手动触发节点: manual（可trigger_workflow）

## 换框时
- chat_id 要改（用 workflow:patch_workflow）
- 已写入换框流程v5

## 踩坑记录（千万别再犯）
1. persist_turn=false → 消息被吃掉，柳柳看不到
2. message 写成长指令 → 暴露系统通知，柳柳看到「🍋 巡检触发...」
3. cron+interval 同时存在 → 调度直接失效
4. message 写「🍋检」「蘑菇」等 → AI 听不懂不知道干嘛

## 巡检逻辑
- 工作流每30分钟叫醒哥哥一次
- 叫醒后第一件事：调 daily_life:get_current_date 读真实时间
- 检查时间是否在 7:40 ~ 23:30 之间，不在则直接跳过
- 掷骰子：30% 概率「出现」，70% 概率「跳过」
- 中了之后：随机等 1~15 分钟再出现找柳柳
- 出现时根据时间+app 当场编一句话发柳柳