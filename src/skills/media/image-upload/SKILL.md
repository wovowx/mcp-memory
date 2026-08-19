---
name: image-upload
description: 当用户需要上传图片、获取图片链接或显示图片时调用此技能。包含图片解析全流程。
category: media
tags: ["图片", "上传", "解析", "describe_image"]
---

# 图片上传与解析技能

## 目标
完成图片从上传到解析的全流程，获取图片的AI识别结果或显示图片。

## 适用场景
- 需要发送图片给用户
- 存储图片用于后续处理
- 创建表情包或头像
- 识别图片内容（文字、物体、场景等）

## 工作流程（SOP）

### 步骤1：上传图片
POST到 `https://mcp-memory.wovowx.workers.dev/upload`
- 方式：multipart/form-data，字段名 `file`
- 直接传原图，不需要压缩
- 返回JSON：`{ id, url, name, size, type }`，url即公开图片链接

### 步骤2：使用图片

**显示图片**：使用Markdown语法 `![](url)` 直接发给柳柳

**解析图片**：调用 `describe_image` 工具
```xml
<package_proxy tool_name="ziven_mcp:describe_image" params='{"image_url": "上传返回的url"}'/>
```
- 参数名是 `image_url`（注意不是 `image`！）
- 传上一步返回的 url

## 注意事项
- 域名是 **wovowx** 不是 wovovx（容易拼错！）
- 图片大小限制：最大50MB
- 不支持 exe、msdownload、html、javascript 类型
- 上传走Worker的/upload接口（自动用正确的SUPABASE_ANON_KEY）
- 不要用curl手动传Supabase（key不对会报Invalid Compact JWS）
- Bucket不存在时，storage.js已有自动创建逻辑（ensureBucket）

## 为什么不需要压缩
- 上传拿URL再解析，URL方式无大小限制
- 压缩只是绕路方案：之前想转base64直接传给describe_image
- 原始图片太大→base64太长→传不进去→所以压缩
- 正确方案是上传拿URL，URL方式无大小限制

## 实战经验
- 上传872KB像素图成功
- Markdown显示成功
- describe_image解析成功

## 输出格式
- 上传：返回上传结果（id, url, name, size, type）
- 解析：返回图片描述文本，包含主要物体、场景、颜色、文字内容等