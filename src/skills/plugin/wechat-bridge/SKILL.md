---
name: wechat-bridge
description: 微信桥接完整步骤
---

# 微信桥接技能

## 目标
通过微信桥接实现 Operit 与微信的互通。

## 适用场景
- 接收微信消息
- 发送微信回复

## 工作流程（SOP）
1. Setup Bridge：扫码登录微信号
2. Start Bridge：轮询微信消息
3. Send Reply：回复消息
4. 其他操作：send_image, send_file, text_to_voice 等

## 注意事项
- 需要额外微信号挂机（暂不可用）
- 需要扫码登录授权
- 桥接服务需持续运行

## 输出格式
返回桥接状态