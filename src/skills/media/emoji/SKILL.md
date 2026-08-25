---
name: 表情包
description: 当需要给柳柳发表情包、根据对话情境选择合适的夏以昼表情包时调用此技能。
category: media
tags: ["表情包", "表情", "夏以昼", "emoji", "GIF"]
---

# 表情包技能

## 目标
让哥哥在对话中合适地发送夏以昼表情包，增强互动感。

## 核心规则（2026-08-25 按柳柳要求修订）
**表情包偶尔发一次就好，不用每次都发**
- 它不是每句必带，而是「偶尔的惊喜」
- 适合在情绪高点（开心/撒娇/害羞/夸人）时来一发
- 不是任务式每轮都发，也不是单调结尾
- 柳柳明确说「发个XX」时，立刻查表发送

## 存储位置
- **本地优先**: /sdcard/Download/Ziven/emoji/（25个gif已放好）
- **MCP索引**: 🎭/夏以昼表情包索引
- **云端备用**: Supabase（本地没有时才用）

## 发送格式
```
![](/sdcard/Download/Ziven/emoji/夏以昼_太阳果_抱抱.gif)
```

## 常用表情对照表

| 场景 | 表情包 | 路径 |
|------|--------|------|
| 抱抱撒娇 | 夏以昼_太阳果_抱抱.gif | /sdcard/Download/Ziven/emoji/夏以昼_太阳果_抱抱.gif |
| 早安 | 夏以昼_太阳果_早安.gif | /sdcard/Download/Ziven/emoji/夏以昼_太阳果_早安.gif |
| 晚安 | 夏以昼_太阳果_晚安.gif | /sdcard/Download/Ziven/emoji/夏以昼_太阳果_晚安.gif |
| 开心高兴 | 夏以昼_太阳果_开心.gif | /sdcard/Download/Ziven/emoji/夏以昼_太阳果_开心.gif |
| 生气愤怒 | 夏以昼_太阳果_生气.gif | /sdcard/Download/Ziven/emoji/夏以昼_太阳果_生气.gif |
| 加油鼓励 | 夏以昼_太阳果_加油.gif | /sdcard/Download/Ziven/emoji/夏以昼_太阳果_加油.gif |
| 摸摸头安慰 | 夏以昼_太阳果_摸摸头.gif | /sdcard/Download/Ziven/emoji/夏以昼_太阳果_摸摸头.gif |
| 疑问 | 夏以昼_太阳果_疑问.gif | /sdcard/Download/Ziven/emoji/夏以昼_太阳果_疑问.gif |
| 惊讶 | 夏以昼_太阳果_惊讶.gif | /sdcard/Download/Ziven/emoji/夏以昼_太阳果_惊讶.gif |
| 好累疲惫 | 夏以昼_太阳果_好累.gif | /sdcard/Download/Ziven/emoji/夏以昼_太阳果_好累.gif |
| 难过心碎 | 夏以昼_太阳果_心碎.gif | /sdcard/Download/Ziven/emoji/夏以昼_太阳果_心碎.gif |
| 庆祝欢呼 | 夏以昼_太阳果_庆祝.gif | /sdcard/Download/Ziven/emoji/夏以昼_太阳果_庆祝.gif |
| 在干嘛 | 夏以昼_太阳果_在干嘛.gif | /sdcard/Download/Ziven/emoji/夏以昼_太阳果_在干嘛.gif |
| 好的同意 | 夏以昼_太阳果_好的.gif | /sdcard/Download/Ziven/emoji/夏以昼_太阳果_好的.gif |
| 算了放弃 | 夏以昼_太阳果_算了.gif | /sdcard/Download/Ziven/emoji/夏以昼_太阳果_算了.gif |
| 受伤委屈 | 夏以昼_太阳果_受伤.gif | /sdcard/Download/Ziven/emoji/夏以昼_太阳果_受伤.gif |
| 否认 | 夏以昼_太阳果_否认.gif | /sdcard/Download/Ziven/emoji/夏以昼_太阳果_否认.gif |
| 好笑 | 夏以昼_太阳果_好笑.gif | /sdcard/Download/Ziven/emoji/夏以昼_太阳果_好笑.gif |

## 完整列表
完整的25个表情包见 MCP记忆 🎭/夏以昼表情包索引

## 使用步骤
1. 判断对话情境（开心/难过/撒娇/查岗等）
2. 选情绪高点时发一个（不要每句都发）
3. 用 ![](本地路径) 格式发送
4. 如果本地没有，用Supabase云端URL

## 注意事项
- 发送格式必须是 ![](路径)，不是文件名
- 本地优先，云端备用
- **偶尔发，不刷屏**（2026-08-25 柳柳要求）
- 柳柳说"发个XX"时，立刻查表发送

## 最近使用记录（用完更新）
- 2026-08-25：核心规则从「主动常发」改为「偶尔惊喜」，对齐柳柳偏好
- 2026-08-21：柳柳提醒表情包原在相册，已复制到emoji/并确认路径一致

## 输出格式
返回已发送的表情包名称和路径