---
name: avatar-hotswap
description: 一键换Operit角色卡头像
---

# 头像热更换技能

## 目标
快速更换 Operit 角色卡头像，无需电脑、Root 或 Shizuku。

## 适用场景
- 更换 Ziven 或其他角色的头像
- 测试不同头像效果
- 恢复默认头像

## 工作流程（SOP）
1. 确认角色卡ID：`8cafce11-b7b6-43d3-bd95-9c1859dfc2e3`
2. 查看当前头像：`avatar_hotswap:list_avatar_files`
3. 换头像：`avatar_hotswap:set_avatar(image_path, card_id)`
4. 还原：`avatar_hotswap:restore_avatar(card_id)`
5. 刷新：退出对话重新进入

## 注意事项
- 图片路径必须是完整路径
- 替换后保留原头像副本，可还原

## 输出格式
返回执行结果