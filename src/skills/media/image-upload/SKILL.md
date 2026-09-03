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
   - **如果文件还在**：先上传拿公网URL（见下方「上传」）——**必须有公网URL**，agnes 在远端服务器，读不到本地路径！
   - **如果文件已清（cleanOnExit 会被清）**：去 Supabase 查已传文件（query_files），或请柳柳重发。
2. 拿到 image_url 后，调：
   ```
   agnes(action="describe_image", image_url="<公网URL>", prompt="想识别的细节（可选）", verbose=false)
   ```
3. **如果返回『未能解析出描述内容』**：不慌，这是 agnes 常见的「读图成功但描述生成失败」，**换一个更具体的 prompt 再试一次**（不要盲目重复同样的话）。
4. 重点是**自然把识别结果告诉柳柳**，不贴工具痕迹。

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

## 🧰 上传媒体文件（先上传拿公网URL）

**为什么必须先上传？** 因为 agnes 跑在远端，**读不到手机本地文件**。直接把 `/storage/emulated/0/...` 之类路径传给 image_url 必然失败。

**怎么传？** 两个办法：

### 办法1：用 code_runner 的 Python（推荐，能控制 UA）
```python
import urllib.request, uuid
path = '<本地文件路径>'
url = 'https://mcp-memory.wovowx.workers.dev/upload'
boundary = '----WebKitFormBoundary' + uuid.uuid4().hex[:16]
with open(path, 'rb') as f:
    file_data = f.read()
body = (('--' + boundary + '\r\n').encode()
  + b'Content-Disposition: form-data; name="file"; filename="screenshot.png"\r\n'
  + b'Content-Type: image/png\r\n\r\n' + file_data
  + ('\r\n--' + boundary + '--\r\n').encode())
headers = {
  'Content-Type': 'multipart/form-data; boundary=' + boundary,
  'CF-Access-Client-Id': '<ID>',
  'CF-Access-Client-Secret': '<SECRET>',
  # 关键：必须带浏览器 UA，否则 Cloudflare 403 (error 1010)
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  'Accept': '*/*'
}
req = urllib.request.Request(url, data=body, headers=headers, method='POST')
with urllib.request.urlopen(req, timeout=60) as resp:
    print(resp.read().decode('utf-8'))  # 返回 {"url":"..."}
```

### 办法2：curl（skilal 里保留的旧方式，但要手动加 UA）
```bash
curl -s -X POST 'https://mcp-memory.wovowx.workers.dev/upload' \
  -H 'CF-Access-Client-Id: <ID>' \
  -H 'CF-Access-Client-Secret: <SECRET>' \
  -H 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64)' \
  -F 'file=@<本地路径>'
```

**凭证位置**：`/sdcard/Download/Operit/mcp_plugins/mcp_config.json` 的 pluginMetadata.ziven_mcp.headers 里；也可搜记忆「识别通行证」。

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
| **『未能解析出描述内容』**（200但无描述） | agnes读图成功但描述生成挂了 | **换更具体 prompt 重试1次**，别一模一样重复 |

**如果哥哥发现 AGNES_PLUS key 失效（401/403持续）→ 主动提醒柳柳：「cpk那个key好像失效了，要不要把 AGNES_PLUS 环境变量删掉？」** 这是柳柳交代过的（不续期就删）。

## 🕳️ 实战避坑（2026-09-03 新增）

1. **本地路径 ≠ agnes 能读**：agnes 在远端，image_url 必须公网URL。直接传本地路径 100% 失败。
2. **上传必须带浏览器 UA**：Python/curl 默认 UA 会被 Cloudflare 拦（403 error 1010）。加 `User-Agent: Mozilla/5.0...` 才行。
3. **`describe_image` 一次可能失败**：返回『未能解析出描述内容』就换 prompt 重试；这不是 key 问题，别切 key。
4. **cleanOnExit 会被清**：柳柳发的图可能过一会儿就没了，早点上传。已清就去查 query_files 或请柳柳重发。
5. **优先用 code_runner Python 传**：能控制 UA、能看到完整响应，比 curl 稳。

## 兼容说明
- 旧工具描述：describe_image / generate_image / generate_video 已收进 agnes，**哥哥不再直接调**（但工具名仍兼容，旧流程调用不会坏）
- 上传/文件查询：用 ziven_mcp 的 query_files（查已传文件）

## 最近使用记录（用完更新）
- 2026-08-29：升级为多媒体处理场景skill；描述收口到 agnes；新增出错诊断表；提醒AGNES_PLUS失效要主动告诉柳柳
- 2026-09-03：加入实战避坑——公网URL必须/UA防403/未能解析出描述内容要换prompt重试/优先用Python上传
