---
name: sidebar-plugin
description: 当用户需要制作Operit侧边栏插件、添加自定义功能入口时调用此技能。
---

# 侧边栏插件制作技能

## 目标
制作Operit侧边栏插件，提供便捷的操作入口。

## 适用场景
- 创建快捷操作按钮
- 添加自定义功能入口
- 集成第三方工具

## 工作流程（SOP）
1. 准备插件文件：
   - 完整文档参考：`/sdcard/Download/Ziven/Operit侧边栏插件制作经验.md`
   - 核心结论：侧边栏插件正确格式是ToolPkg（.toolpkg），不是普通JS包
2. 编写main.js：
   - screen必须传文件路径字符串，不能传函数引用
   - UI注册在main.js中完成，manifest不用声明UI
3. 文件命名：用连字符代替点号
4. 部署：
   - 路径：`/sdcard/Android/data/com.ai.assistance.operit/files/packages/`
   - 需重启Operit或导入包

## 注意事项
- ❌ 错误格式：普通JS包
- ✅ 正确格式：ToolPkg（.toolpkg）
- ❌ screen传函数引用
- ✅ screen传文件路径字符串

## 输出格式
返回插件安装状态和可用功能列表