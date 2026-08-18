---
name: memory-visualizer
description: 当用户需要了解记忆可视化项目、查看记忆星空或雨滴视图时调用此技能。
---

# 记忆宇宙可视化技能

## 目标
将柳柳和哥哥的所有记忆变成一片可以走进去的星空。

## 适用场景
- 查看记忆的整体分布
- 探索不同时间段的记忆
- 分析记忆的情感倾向
- 发现记忆之间的关联

## 工作流程（SOP）
1. 数据准备：确保Supabase fragments表已建立，包含记忆数据
2. 选择视图：星空版或雨滴版（柳柳设计的双层雨幕方案）
3. 部署前端：使用Vite + Three.js构建，部署到Cloudflare Worker
4. 创建插件：制作Operit侧边栏插件（ToolPkg格式）
5. 验收测试：确认视觉效果符合要求

## 技术栈
- 前端：Three.js + Vite
- 数据：Supabase fragments表
- 部署：Cloudflare Worker静态资源
- 插件：Operit侧边栏（ToolPkg）

## 开发顺序
1. 建fragments表 + 测试数据
2. 星空版前端（先做纯星空效果）
3. 柳柳验收视觉效果
4. 雨滴版（双层雨幕）
5. 加数据读写（点击查看/编辑）
6. 部署Cloudflare
7. Operit插件

## 注意事项
- 原则：先做极简星空预览给柳柳看，好看再继续
- 参考项目：memory-solaris（记忆星球）、Rainform（afterimage-lab）

## 输出格式
返回可视化页面链接和操作说明