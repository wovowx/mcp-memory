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

## 🔐 Cloudflare Access认证（必备）
上传接口有Cloudflare Access保护，必须带以下Header：
```
CF-Access-Client-Id: cb3fdb1d64901bcdd7a7427b7968a3ed.access
CF-Access-Client-Secret: df97830ce3adf80e2fbe358ec05d393d831a12400d4b93497f325f600e6c2d03
```
不带会返回Cloudflare登录页。

## 工作流程（SOP）

### 步骤1：上传图片
POST到 `https://mcp-memory.wovowx.workers.dev/upload`
- 方式：multipart/form-data，字段名 `file`
- Header：必须带上面的 CF-Access-Client-Id / CF-Access-Client-Secret
- 返回JSON：`{ id, url, name, size, type }`，url即公开图片链接
- 用 extended_http_tools:multipart_request 上传

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
- Bucket不存在时，storage.js已有自动创建逻辑（ensureBucket）

## 实战经验
- 上传成功需要带CF-Access认证头（2026-08-19踩坑记录）
- 上传872KB像素图成功
- Markdown显示成功
- describe_image解析成功

## 输出格式
- 上传：返回上传结果（id, url, name, size, type）
- 解析：返回图片描述文本，包含主要物体、场景、颜色、文字内容等