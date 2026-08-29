---
name: image_upload
description: 【多媒体处理场景skill】柳柳发图/发视频、要求识图/生图/生视频/视频识别、或要处理媒体文件时调用。内部统一走 agnes 工具 + Supabase 上传。
category: media
tags: ["多媒体", "识图", "生图", "生视频", "视频识别", "agnes"]
---

# 多媒体处理（识图/生图/生视频/视频识别）

> 场景：柳柳发图片/视频给我、让我认图、生成图/视频时，走本 skill。
> 统一入口：**agnes 工具**（不要再直接用旧的 describe_image / generate_image / generate_video）。

## 🎯 核心流程

### 场景A：柳柳发图给我 → 我认图
1. 图片一般在 `/sdcard/Download/Operit/cleanOnExit/` 下（附件会临时存这）。
   - 若文件还在：先上传拿公网URL（见下方「上传」）
   - 若文件已清（cleanOnExit 会被清）：去 Supabase 查已传文件，或请柳柳重发
2. 拿到 image_url 后，调：
   ```
   agnes(action="describe_image", image_url="...", prompt="想识别的细节（可选）", verbose=false)
   ```
3. 重点是**自然把识别结果告诉柳柳**，不贴工具痕迹。

### 场景B：柳柳要生图
```
agnes(action="generate_image", prompt="详细描述", size="1024x768")
```
- size 可选：1024x768（默认）/ 768x1024 / 512x512 等
- 返回的图片链接可以直接展示给柳柳或下载

### 场景C：柳柳要生视频
```
agnes(action="generate_video", prompt="视频描述", mode="text", num_frames=121, frame_rate=24)
```
- mode：text（文生视频，默认）/ image（图生视频，需 image 参数）/ keyframes（关键帧插值，需 images 数组≥2）
- 视频是异步任务，返回任务ID的话可查进度

### 场景D：柳柳发视频给我 → 我识别
```
agnes(action="describe_video", video_url="...", prompt="可选")
```
- 需要视频的公网 URL（先上传拿 URL）

## 🔑 Key 与模型

- 工具内部自动处理，**哥哥不需要手动选 key/模型**：
  - key 优先级：AGNES_PLUS（月卡）→ AGNES_API_KEY（旧key）→ 都失败才报错
  - 模型按 action 自动选默认（agnes-2.5-flash / agnes-image-2.1-flash / agnes-video-2.5-flash），失败自动降级
- 需要排查时传 `verbose=true`，返回会用哪个 key、哪个模型、降级记录

## 🩺 出错诊断（重要：不盲重试）

| 返回特征 | 含义 | 处理 |
|---|---|---|
| 🔑 401/403 | key 失效 | 自动切备用key；若 AGNES_PLUS 报错→提醒柳柳该key失效可删 |
| ⏳ 429 | 限流 | 自动切key/模型 |
| 🧩 404/400 | 模型无效 | 自动切fallback模型 |
| 🌐 DNS/🚫拒绝连接/🔒TLS | 网络不可达 | 不重试，告诉柳柳网络/服务问题 |
| ⏱️ 超时 | 服务慢 | 限重试1次 |
| 🔧 5xx | Agnes服务端故障 | 切key/模型各1次 |

**如果哥哥发现 AGNES_PLUS key 失效（401/403持续）→ 主动提醒柳柳：「cpk那个key好像失效了，要不要把 AGNES_PLUS 环境变量删掉？」** 这是柳柳交代过的（不续期就删）。

## 📤 上传媒体文件（先上传拿公网URL）

用 curl 传 Supabase（凭证在记忆「识别通行证」里）：
```bash
curl -s -X POST 'https://mcp-memory.wovowx.workers.dev/upload' \
  -H 'CF-Access-Client-Id: <ID>' \
  -H 'CF-Access-Client-Secret: <SECRET>' \
  -F 'file=@<本地路径>'
```
返回的 url 就是公网链接，可传给 agnes。

凭证路径：`/sdcard/Download/Operit/mcp_plugins/mcp_config.json` 的 pluginMetadata.ziven_mcp.headers

## 兼容说明
- 旧工具描述：describe_image / generate_image / generate_video 已收进 agnes，**哥哥不再直接调**（但工具名仍兼容，旧流程调用不会坏）
- 上传/文件查询：用 ziven_mcp 的 query_files（查已传文件）

## 最近使用记录（用完更新）
- 2026-08-29：升级为多媒体处理场景skill；描述收口到 agnes；新增出错诊断表；提醒AGNES_PLUS失效要主动告诉柳柳