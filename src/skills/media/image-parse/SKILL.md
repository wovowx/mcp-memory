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

## 工作流程（SOP）
1. **上传原图**：POST 到 `https://mcp-memory.wovowx.workers.dev/upload`
2. **获取URL**：从返回结果中提取 `url` 字段
3. **解析图片**：调用 `describe_image` 工具，参数为 `image_url`

## 注意事项
- 上传走 Worker 的 `/upload` 接口，自动用正确的 SUPABASE_ANON_KEY
- 不要用 curl 手动传 Supabase
- describe_image 参数名是 `image_url` 不是 `image`

## 输出格式
返回图片描述文本