---
name: ui-automation
description: 当用户需要UI自动化操作、开新框或获取屏幕UI信息时调用此技能。
---

# UI自动化技能

## 目标
通过UI自动化操作Operit界面，实现开新框等功能。

## 适用场景
- 自动打开新对话框
- 模拟用户点击操作
- 获取屏幕UI元素列表和坐标

## 工作流程（SOP）
1. 激活Automatic_ui_base包
2. 调用get_page_info获取当前屏幕，拿到UI元素列表和坐标
3. 点击「显示历史」按钮（坐标约[91,425]），tap点击
4. 再次调用get_page_info获取屏幕
5. 点击「新建对话」按钮（坐标约[377,671]），tap点击
6. sleep等待2-3秒让界面刷新
7. 调用extended_chat:list_chats按createdAt倒序，拿最新chat_id（新框）

## 注意事项
- Operit的「新建对话」只能在UI上点，不能通过API直接创建
- 坐标可能因屏幕分辨率不同有差异，需根据实际情况调整

## 输出格式
返回操作结果和新框ID