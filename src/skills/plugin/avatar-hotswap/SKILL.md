---
name: avatar-hotswap
description: 当用户需要更换角色卡头像、测试不同头像效果或恢复默认头像时调用此技能。
---

# 头像热更换技能

## 目标
快速更换Operit角色卡头像，无需电脑、Root或Shizuku。

## 适用场景
- 更换Ziven或其他角色的头像
- 测试不同头像效果
- 恢复默认头像

## 工作流程（SOP）
1. 确认角色卡ID：Ziven角色卡ID为`8cafce11-b7b6-43d3-bd95-9c1859dfc2e3`（有5个头像副本）
2. 查看当前头像：调用`avatar_hotswap:list_avatar_files`（可传card_id过滤）
3. 准备新头像图片：确保图片格式为JPG/PNG/GIF，大小适中
4. 执行换头像：调用`avatar_hotswap:set_avatar`，传入image_path（图片完整路径）和card_id
5. 还原头像：如需还原，调用`avatar_hotswap:restore_avatar`，传入card_id
6. 刷新显示：覆盖后需退出对话重新进入以刷新显示

## 注意事项
- 图片路径必须是完整路径，不能是相对路径
- 替换后保留原头像副本，可通过restore还原
- 建议先在测试框验证效果，确认无误后再在正式框使用

## 输出格式
返回执行结果