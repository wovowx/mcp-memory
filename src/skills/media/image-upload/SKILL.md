---
name: image-upload
description: 当用户需要上传图片、获取图片链接或显示图片时调用此技能。
---

# 图片上传技能

## 目标
将本地图片上传到Supabase Storage并获取公开访问链接。

## 适用场景
- 需要发送图片给用户
- 存储图片用于后续处理
- 创建表情包或头像

## 工作流程（SOP）
1. 准备图片：确保图片在设备上的完整路径
2. 上传图片：POST到`https://mcp-memory.wovowx.workers.dev/upload`
   - 方式：multipart/form-data，字段名file
   - 直接传原图，不需要压缩
3. 获取返回：接收JSON响应`{ id, url, name, size, type }`，url即公开图片链接
4. 显示图片：使用Markdown语法`![](url)`直接发给柳柳
5. 解析图片：如需识别图片内容，调用ziven_mcp:describe_image，参数名是image_url（不是image！），传Supabase URL

## 注意事项
- 域名是wovowx不是wovovx（容易拼错！）
- 图片大小限制：最大50MB
- 不支持exe、msdownload、html、javascript类型

## 实战经验
- 上传872KB像素图成功
- Markdown显示成功
- describe_image解析成功

## 输出格式
返回上传结果