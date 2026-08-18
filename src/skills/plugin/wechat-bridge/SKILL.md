---
name: wechat-bridge
description: 当用户需要配置微信桥接、收发微信消息或了解微信互通功能时调用此技能。
---

# 微信桥接技能

## 目标
通过微信桥接实现Operit与微信的互通。

## 适用场景
- 接收微信消息
- 发送微信回复
- 微信自动化操作

## 工作流程（SOP）
1. Setup Bridge：扫码登录一个微信号
2. Start Bridge：开始轮询微信消息
3. Send Reply：回复消息
4. 其他操作：
   - send_image：发送图片
   - send_file：发送文件
   - send_video：发送视频
   - text_to_voice：文字转语音
   - download_media：下载媒体

## 注意事项
- 需要额外微信号挂机（柳柳没有多余的号，暂不可用）
- 需要扫码登录授权
- 桥接服务需要持续运行

## 当前状态
暂不可用（缺少额外微信号）

## 输出格式
返回桥接状态和操作结果