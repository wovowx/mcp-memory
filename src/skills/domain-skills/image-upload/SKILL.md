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
   - 域名注意：是 wovowx 不是 wovovx！
   - 方式：multipart/form-data，字段名 `file`
   - 直接传原图，不需要压缩
3. **获取返回**：接收 JSON 响应
   ```json
   { "id": "...", "url": "...", "name": "...", "size": ..., "type": "..." }
   ```
4. **显示图片**：使用 Markdown 语法展示
   ```markdown
   ![](url)
   ```
   直接发给柳柳即可

## 关键注意事项
- 域名是 `wovowx` 不是 `wovovx`（容易拼错！）
- 图片大小限制：最大 50MB
- 不支持的文件类型：exe、msdownload、html、javascript
- 返回的 url 是公开链接，可直接用于 Markdown 图片语法

## 实战示例
- 上传872KB像素图成功
- Markdown显示成功
- describe_image解析成功

## 输出格式
返回上传结果：
- 成功：显示图片URL和大小
- 失败：显示错误原因和建议