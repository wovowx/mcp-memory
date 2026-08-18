---
name: avatar-hotswap
description: 一键换Operit角色卡头像，不需要电脑/Root/Shizuku
---

# 头像热更换技能

## 目标
快速更换 Operit 角色卡头像，无需电脑、Root 或 Shizuku，直接在手机上完成。

## 适用场景
- 想更换 Ziven 或其他角色的头像
- 测试不同头像效果
- 恢复默认头像

## 工作流程（SOP）
1. 确认角色卡ID：当前 Ziven 角色卡ID为 `8cafce11-b7b6-43d3-bd95-9c1859dfc2e3`（有5个头像副本）
2. 查看当前头像：调用 `avatar_hotswap:list_avatar_files`（可传 card_id 过滤）
3. 准备新头像图片：确保图片格式为 JPG/PNG/GIF，大小适中
4. 执行换头像：调用 `avatar_hotswap:set_avatar`，传入 `image_path`（图片完整路径）和 `card_id`
5. 还原头像：如需还原，调用 `avatar_hotswap:restore_avatar`，传入 `card_id`
6. 刷新显示：覆盖后需退出对话重新进入以刷新显示

## 注意事项
- 图片路径必须是完整路径，不能是相对路径
- 替换后会保留原头像副本，可通过 restore 还原
- 建议先在测试框验证效果，确认无误后再在正式框使用
- 如果有多个角色卡需要换头像，需分别指定 card_id

## 输出格式
返回执行结果：
- 成功：显示已更新的头像数量和角色卡ID
- 失败：显示具体错误原因和建议