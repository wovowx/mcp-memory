---
name: image-parse
description: 图片解析流程完整步骤
---

# 图片解析技能

## 目标
完成图片上传到解析的全流程，获取图片的AI识别结果。

## 适用场景
- 需要识别图片内容
- 分析图片中的文字、物体、场景等
- 获取图片描述用于后续处理

## 工作流程（SOP）
1. **上传原图**：POST 到 `https://mcp-memory.wovowx.workers.dev/upload`
   - 方式：multipart/form-data，字段名 `file`
   - 直接传原图，不需要压缩
   - 返回JSON：`{ id, url, name, size, type }`
2. **获取URL**：从返回结果中提取 `url` 字段
3. **解析图片**：调用 `describe_image` 工具
   - 参数：`image_url`（注意是 image_url 不是 image！）
   - 传上一步返回的 url
4. **获取结果**：返回图片描述文本

## 关键注意事项
- ⚠️ 上传走 Worker 的 `/upload` 接口（自动用正确的SUPABASE_ANON_KEY）
- ⚠️ 不要用 curl 手动传 Supabase（key不对会报 Invalid Compact JWS）
- ⚠️ describe_image 参数名是 `image_url`，不是 `image`
- ✅ Bucket 不存在时，storage.js 已有自动创建逻辑（ensureBucket）

## 为什么不需要压缩
- 上传拿 URL 再解析，URL 方式无大小限制
- 压缩只是绕路方案（转 base64 才需要）

## 输出格式
返回图片描述文本，包含：
- 主要物体和场景
- 颜色和光影
- 文字内容（如有）
- 其他可见细节