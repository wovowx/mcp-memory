---
name: image-upload
description: 当用户需要上传图片、获取图片链接或显示图片时调用此技能。
---

# 图片上传技能（2026-08-24 更新：补 CF Access 凭证）

## 目标
将本地图片上传到 Supabase Storage 并获取公开访问链接，再用 MCP 识图。

## 适用场景
- 需要发送图片给用户 / 识别用户发来的图片
- 存储图片用于后续处理
- 创建表情包或头像

## 工作流程（SOP）
1. 准备图片：确保图片在设备上的完整路径（附件一般在 /sdcard/Download/Operit/cleanOnExit/ 下）
2. 上传图片：POST 到 `https://mcp-memory.wovowx.workers.dev/upload`
   - 方式：multipart/form-data，字段名 file
   - 必须带 Cloudflare Access 凭证头（否则被 302 拦截！）：
```bash
curl -s -X POST 'https://mcp-memory.wovowx.workers.dev/upload' \
  -H 'CF-Access-Client-Id: cb3fdb1d64901bcdd7a7427b7968a3ed.access' \
  -H 'CF-Access-Client-Secret: df97830ce3adf80e2fbe358ec05d393d831a12400d4b93497f325f600e6c2d03' \
  -F 'file=@<本地图片完整路径>'
```
   - 凭证也可从 /sdcard/Download/Operit/mcp_plugins/mcp_config.json 的 pluginMetadata.ziven_mcp.headers 读取
3. 获取返回：接收 JSON 响应 `{ id, url, name, size, type }`，url 即公开图片链接
4. 识别图片：如需解析图片内容，调用 `ziven_mcp:describe_image`，参数名是 `image_url`（不是 image！），传返回的 url；识图模型 agnes-2.5-flash（已配好）

## 注意事项
- 域名是 wovowx 不是 wovovx（容易拼错！）
- 图片大小限制：最大 50MB
- 本地 read_file+intent 识图依赖 Shizuku；Shizuku 挂时走本技能（curl 上传 + describe_image）

## 实战经验
- 2026-08-24：补齐 CF Access 凭证后上传+identify 成功（柳柳午饭卤味拌面）
- 2026-08-13：上线初期上传成功但未带凭证；后续凭证在 mcp_config.json

## 输出格式
返回上传结果与识别文本