---
name: image-parse
description: 当用户需要上传并解析图片、识别图片内容时调用此技能。
---

# 图片解析技能

## 目标
完成图片上传到解析的全流程，获取图片的AI识别结果。

## 适用场景
- 需要识别图片内容
- 分析图片中的文字、物体、场景等
- 获取图片描述用于后续处理

## 工作流程（SOP）
1. 上传原图：POST到`https://mcp-memory.wovowx.workers.dev/upload`
   - 方式：multipart/form-data，字段名file
   - 直接传原图，不需要压缩
   - 返回JSON：`{ id, url, name, size, type }`，url即公开链接
2. 获取URL：从返回结果中提取url字段
3. 解析图片：调用describe_image工具
   - 参数：image_url（注意是image_url不是image！）
   - 传上一步返回的url

## 注意事项
- 上传走Worker的/upload接口（自动用正确的SUPABASE_ANON_KEY）
- 不要用curl手动传Supabase（key不对会报Invalid Compact JWS）
- Bucket不存在时，storage.js已有自动创建逻辑（ensureBucket）
- describe_image参数名是image_url，不是image

## 为什么不需要压缩
- 上传拿URL再解析，URL方式无大小限制
- 压缩只是绕路方案（转base64才需要）

## 输出格式
返回图片描述文本，包含主要物体、场景、颜色、文字内容等