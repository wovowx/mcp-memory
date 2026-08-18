---
name: image-upload
description: 本地图片上传与显示完整步骤
---

# 图片上传技能

## 目标
将本地图片上传到 Supabase Storage 并获取公开访问链接。

## 适用场景
- 需要发送图片给用户
- 存储图片用于后续处理
- 创建表情包或头像

## 工作流程（SOP）
1. **准备图片**：确保图片在设备上的完整路径
2. **上传图片**：POST 到 `https://mcp-memory.wovowx.workers.dev/upload`
3. **获取返回**：接收 JSON 响应 `{ id, url, name, size, type }`
4. **显示图片**：使用 Markdown 语法 `![](url)` 显示

## 注意事项
- 域名是 wovowx 不是 wovovx
- 图片大小限制：最大 50MB
- 不支持 exe、msdownload、html、javascript 类型

## 输出格式
返回上传结果