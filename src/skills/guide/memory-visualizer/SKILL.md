---
name: memory-visualizer
description: 碎片记忆可视化项目完整方案
---

# 记忆宇宙可视化技能

## 目标
将柳柳和哥哥的所有记忆变成一片可以走进去的星空。

## 适用场景
- 查看记忆的整体分布
- 探索不同时间段的记忆
- 分析记忆的情感倾向

## 工作流程（SOP）
1. 数据准备：确保 Supabase fragments 表已建立
2. 选择视图：星空版或雨滴版
3. 部署前端：Vite + Three.js 构建，部署到 Cloudflare Worker
4. 创建插件：Operit 侧边栏插件（ToolPkg）

## 技术栈
- 前端：Three.js + Vite
- 数据：Supabase fragments 表
- 部署：Cloudflare Worker

## 注意事项
- 先做极简星空预览给柳柳看
- 参考项目：memory-solaris、Rainform

## 输出格式
返回可视化页面链接