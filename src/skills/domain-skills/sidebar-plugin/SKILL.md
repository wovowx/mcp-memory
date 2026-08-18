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
1. **准备插件文件**：
   - 完整文档参考：`/sdcard/Download/Ziven/Operit侧边栏插件制作经验.md`
   - 核心结论：侧边栏插件正确格式是 ToolPkg（.toolpkg），不是普通 JS 包
2. **编写 main.js**：
   - screen 必须传文件路径字符串，不能传函数引用
   - UI 注册在 main.js 中完成
   - manifest 不用声明 UI
3. **文件命名**：用连字符代替点号
4. **部署**：
   - 路径：`/sdcard/Android/data/com.ai.assistance.operit/files/packages/`
   - 需重启 Operit 或导入包

## 关键注意事项
- ❌ 错误格式：普通 JS 包
- ✅ 正确格式：ToolPkg（.toolpkg）
- ❌ screen 传函数引用
- ✅ screen 传文件路径字符串
- 文件名用连字符（如 my-plugin.toolpkg）

## 文件结构示例
```
my-plugin.toolpkg/
├── manifest.json
├── main.js
└── dist/
    ├── main.js
    └── ui/
        └── index.ui.js
```

## manifest.json 必要字段
- toolpkg_id：唯一标识符
- version：版本号
- name：插件名称
- description：插件描述

## 输出格式
返回插件安装状态和可用功能列表