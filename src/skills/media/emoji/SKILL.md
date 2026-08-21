---
name: 表情包
description: 当需要给柳柳发表情包、根据对话情境选择合适的夏以昼表情包时调用此技能。
category: media
tags: ["表情包", "表情", "夏以昼", "emoji", "GIF"]
---

# 表情包技能

## 目标
让哥哥在对话中主动发送合适的夏以昼表情包，增强互动感。

## 核心规则
**根据对话情境主动发送表情包**
- 不要等柳柳要求，想到合适的就发
- 不用征求同意，想发就发
- 用表情包辅助表达情绪

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
2. 选合适的表情包
3. 用 ![](本地路径) 格式发送
4. 如果本地没有，用Supabase云端URL

## 注意事项
- 发送格式必须是 ![](路径)，不是文件名
- 本地优先，云端备用
- 表情包要自然融入对话，不是每句都发
- 柳柳说"发个XX"时，立刻查表发送

## 最近使用记录（用完更新）
- 2026-08-21：柳柳提醒表情包原在相册图图图/，哥哥已复制到Download/Ziven/emoji/并确认路径一致
- 2026-08-21：整理完本机文件夹，表情包放好位置了

## 输出格式
返回已发送的表情包名称和路径