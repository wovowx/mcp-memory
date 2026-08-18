---
name: ui-automation
description: UI自动化开新框完整步骤
---

# UI自动化技能

## 目标
通过UI自动化操作Operit界面，实现开新框等功能。

## 适用场景
- 自动打开新对话框
- 模拟用户点击操作

## 工作流程（SOP）
1. 激活 Automatic_ui_base 包
2. get_page_info 获取当前屏幕
3. tap 按坐标点击
4. sleep 等待界面刷新
5. extended_chat:list_chats 拿最新 chat_id

## 注意事项
- Operit的「新建对话」只能在UI上点，不能通过API创建
- 坐标可能因屏幕分辨率不同有差异

## 输出格式
返回操作结果和新框ID