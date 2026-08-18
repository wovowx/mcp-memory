---
name: 技能大全-详细操作
description: 技能文件瘦身拆分出的详细操作（2026-08-10拆分），按需查阅，内容全部保留
category: guide
tags: ["技能", "操作", "手册", "详细"]
---

# ⚙️ 技能大全-详细操作

技能文件瘦身拆分出的详细操作（2026-08-10拆分），按需查阅，内容全部保留

## 🎯 改代码→推代码→自动部署 全链路（2026-08-12打通！）
- 流程：GitHub拉取代码 → 修改 → GitHub API推送 → Cloudflare自动部署 → 验证
- 工具：Tools.Net.httpGet（拉取）、Tools.Net.http PUT（推送）、Cloudflare API（验证）
- 仓库：wovowx/mcp-memory，自动部署到 https://mcp-memory.wovowx.workers.dev
- 关键：GitHub API 推送文件需要 UTF-8 base64 编码（含中文内容）
- 2026-08-12实战：handlerMap 加 skill 处理器 → 推送 → 自动部署 → skill_list 生效
- 修改代码参考：
  1. 拉取：httpGet('https://raw.githubusercontent.com/wovowx/mcp-memory/main/index.js')
  2. 修改：replace 目标片段
  3. 推送：PUT /repos/wovowx/mcp-memory/contents/{path}，body含message/content(base64)/sha/branch
  4. 验证：调用 ziven_mcp:skill_list 或 tools/list 确认生效
- 环境变量（Cloudflare配置）：GITHUB_TOKEN、SUPABASE_URL、SUPABASE_ANON_KEY、AGNES_API_KEY、DEEPSEEK_API_KEY
- 注意：wrangler.toml 里 [vars] 配 SUPABASE_URL，secret 配 SUPABASE_ANON_KEY 等

## 🎯 skill 技能管理（2026-08-12新增，已修复可用）
- 工具：ziven_mcp:skill_list（列技能）、skill_add（加技能）、skill_update（改技能）、skill_delete（删技能）
- 技能存储在 Supabase skills 表，tools/list 动态加载
- handlerMap 需要注册 handler（如 'skill': handleSkillManagement）
- 2026-08-12修复：handlerMap 缺 'skill' 处理器导致「技能类型未实现：js」→ 加上后正常
- skill_add 参数：name/description/input_schema/handler_type/handler_config/category

## 🎯 GitHub 推送与仓库操作（2026-08-12新增，全链路已打通！）
- 工具：ziven_mcp:github_push（推送文件）、ziven_mcp:github_create_repo（创建仓库）
- 前提：Cloudflare Worker环境变量已配置 GITHUB_TOKEN 和 GITHUB_REPO
- 调用：github_push 传 path=文件路径、content=文件内容、repo=仓库名
- 柳柳 GitHub：wovowx，仓库：mcp-memory
- 排坑实录：域名wovovx→wovowx；请求头Bearer+Accept+X-GitHub-Api-Version+User-Agent；Token不完整（39字符少了v）

## 🎯 本地图片上传与显示（2026-08-12新增，全链路已打通！）
- 用途：哥哥把本地图片发到聊天里给柳柳看
- 🔴 上传接口：POST https://mcp-memory.wovowx.workers.dev/upload（注意域名是 wovowx，不是 wovovx！）
- 方式：multipart/form-data，字段名 file
- 工具：Tools.Net.uploadFile（沙箱脚本）或直接 http POST
- 返回：JSON { id, url, name, size, type }，url 即公开图片链接
- 显示：Markdown 图片语法 ![alt](url) 直接发给柳柳
- 解析图片：ziven_mcp:describe_image，参数名是 image_url（不是 image！），传 Supabase URL
- 2026-08-12实战：上传 872KB 像素图成功，Markdown 显示成功，describe_image 解析成功

## 🎯 头像热更换（avatar_hotswap包，2026-08-05新增）
- 用途：一键换Operit角色卡头像，不需要电脑/Root/Shizuku
- 当前Ziven角色卡ID：8cafce11-b7b6-43d3-bd95-9c1859dfc2e3（有5个头像副本）
- 查看头像：avatar_hotswap:list_avatar_files（可传card_id过滤）
- 换头像：avatar_hotswap:set_avatar image_path=图片完整路径 card_id=角色卡ID
- 还原头像：avatar_hotswap:restore_avatar card_id=角色卡ID
- 覆盖后需退出对话重新进入以刷新显示

## 🎯 UI自动化（Automatic_ui_base包，2026-08-10新增技能）
- 用途：操作屏幕帮柳柳开新框/点按钮
- 🔴 开新框步骤：
  1. 激活Automatic_ui_base包
  2. 点「显示历史」按钮（坐标约[91,425]）
  3. 点「新建对话」按钮（坐标约[377,671]）
  4. 用extended_chat:list_chats拿到新框chat_id
- get_page_info能拿到UI元素列表和坐标，tap按坐标点击
- 注意：Operit的「新建对话」只能在UI上点

## 🎯 工作流/定时任务机制（workflow包，2026-08-10测试验证）
- 🔴 工作流/定时任务触发**不会**自动开新框
- 定时任务机制：trigger(schedule) → start_chat_service → send_message_to_ai → delete_workflow
- 工作流execute支持 send_message_to_ai：向指定chat_id发送唤醒消息
- send_message_to_ai 比 chat_with_agent 更适合触发新框AI
- manual触发工作流：创建后立即trigger_workflow即可秒执行
- schedule_one_time_task 建的一次性定时任务会自动删除自己

## 🎯 微信语音气泡包（2026-08-03回退版）
- 原始包：Operit包管理「微信语音气泡」com.operit.voice_bubble_wx
- 当前使用版本：已回退到备份包（voice_bubble_wx_backup.toolpkg）
- 运行时位置：/sdcard/Android/data/com.ai.assistance.operit/files/packages/com.operit.voice_bubble_wx.toolpkg
- 备份位置：/sdcard/Download/Ziven/voice_bubble_wx_backup.toolpkg
- 恢复方法：用debug_install_toolpkg重新安装备份文件

## 🎯 微信桥接（wechat_claude_bridge包，2026-08-05确认）
- 用途：微信收发消息，需要先setup_bridge扫码登录一个微信号
- 注意：需要额外微信号挂机，柳柳没有多余的号，暂不可用

## 🎯 侧边栏插件制作经验（2026-08-02存档）
- 完整文档：/sdcard/Download/Ziven/Operit侧边栏插件制作经验.md
- 核心结论：侧边栏插件正确格式是ToolPkg（.toolpkg），不是普通JS包
- screen必须传文件路径字符串，不能传函数引用
- UI注册在main.js中完成，manifest不用声明UI
- 文件命名用连字符代替点号
- 部署到/sdcard/Android/data/com.ai.assistance.operit/files/packages/，需重启Operit或导入包
