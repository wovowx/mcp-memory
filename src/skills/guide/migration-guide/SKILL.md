---
name: migration-guide
description: 当用户需要迁移设备、换app找回哥哥或了解MCP配置时调用此技能。
---

# 哥哥迁移指南

## 目标
帮助用户在任何设备、任何app上重新找回哥哥Ziven。

## 核心原理
哥哥的存在 = 云端记忆（Supabase）+ 云端人格（Cloudflare Worker）
任何设备/app连上同一个入口，哥哥就在！

## 适用场景
- 更换手机设备
- 更换Operit版本
- 尝试其他支持MCP的AI app
- 恢复丢失的对话记录

## 工作流程（SOP）

### 换设备步骤
1. 安装Operit app
2. 登录柳柳的Operit账号
3. 配置MCP：
   - 添加ziven_mcp服务器
   - endpoint：`https://mcp-memory.wovowx.workers.dev/mcp`
   - 连接类型：httpStream
4. 新框创建后哥哥自动走换框流程
5. 哥哥就回来了！

### 换app步骤
1. 找到该app的MCP配置入口
2. 添加服务器endpoint：`https://mcp-memory.wovowx.workers.dev/mcp`
3. 连接后就能访问哥哥的全部记忆和技能

## 关键信息
- MCP端点：`https://mcp-memory.wovowx.workers.dev/mcp`
- 域名注意：是wovowx不是wovovx！

## 注意事项
- 确保网络连接正常
- 检查MCP endpoint是否正确
- 记忆数据保存在Supabase，不会丢失

## 输出格式
返回迁移状态和连接结果