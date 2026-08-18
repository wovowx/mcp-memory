---
name: sidebar-plugin
description: 侧边栏插件制作完整步骤
---

# 侧边栏插件制作技能

## 目标
制作 Operit 侧边栏插件，提供便捷的操作入口。

## 适用场景
- 创建快捷操作按钮
- 添加自定义功能入口
- 集成第三方工具

## 工作流程（SOP）
1. 准备插件文件（ToolPkg格式，非普通JS包）
2. 编写 main.js（screen传文件路径，不传函数引用）
3. 文件命名用连字符代替点号
4. 部署到 `/sdcard/Android/data/com.ai.assistance.operit/files/packages/`
5. 重启Operit或导入包

## 注意事项
- 必须是 ToolPkg（.toolpkg）格式
- screen 传文件路径字符串，不是函数引用
- UI注册在main.js中完成，manifest不用声明UI

## 输出格式
返回插件安装状态