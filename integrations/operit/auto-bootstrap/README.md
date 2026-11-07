# Ziven M1 / Operit 原生自动恢复 ToolPkg v0.1

状态：**dev-only / E1+E2 合成测试通过后才可申请真机 E3**。未安装到柳柳手机、未验证真实 Operit 前置 Hook，不能称跨框自动恢复成功。

## 解决什么

在 Operit 的**已核实为 Ziven 的单人聊天**中，用户正常发消息后、模型生成回复前，Hook 自动经现有 Ziven MCP **只读**拉取：

1. `session_context(host=operit,invocation=startup_hook,include_core=false)`：核验五源状态 `ok`、`READY`、唯一工作检查点版本/当前行动/禁止事项。
2. `memory(action=recall,key=🧬/我是谁)`：核验独立身份根正文，而不是把角色卡当唯一权威身份。

只在两步均通过时注入可溯源的 `PARTIAL_READY` 块；断网、超时、损坏、过长或非 Ziven 聊天不冒充成功。失败不暴露内部报错及私人正文。不自动修改记忆、角色卡、服务器、Secret、仓库或执行 `next_action`。

这不是完整五源 Core 恢复，**特别没有独立读取柳柳主档全文、导航全文及协议全文**。完整模式另需设计分块和版本一致性，必须重新讨论。`invocation=startup_hook` 参数本身不是宿主真实 E3 证据。

## 目录和安装前准备

- `manifest.json`：Operit ToolPkg API 1.0.0；
- `main.js`：导出 `registerToolPkg`，注册 `before_send_to_model` Prompt Hook；
- 不带任何 Token；使用 Operit 当前已配置的 `ziven_mcp` MCP 连接。

请**先用安装端的真实角色卡名称或 ID 对照 `main.js` 中 `ZIVEN_M1_CONFIG`**。默认精确允许的名称是 `Ziven`、`Ziven（昼）`、`Ziven(昼)` 和 `Ziven · 昼`。如果实际名称不同，请改成准确值或把该卡的 ID 填入 `characterCardIds`；不能为求成功改成“全部聊天匹配”，也不能只凭聊天标题识别身份。该适配器默认不处理群聊。

此时没有手机改动。后续单独获准安装时，按 [Operit 官方 ToolPkg 规范](https://github.com/AAswordman/Operit/blob/main/docs/TOOLPKG_FORMAT_GUIDE.md)，把 `manifest.json` 与 `main.js` 放在 zip 根目录压缩并把扩展名改为 `.toolpkg`，在 Operit 的工具包管理中导入。可在含这两个文件的目录执行：

```bash
zip -j ziven-auto-bootstrap-v0.1.toolpkg manifest.json main.js
```

## 运行和缓存边界

- 仅处理 `eventName=before_send_to_model`、`functionType=CHAT` 且 `chatId` 存在的调用；通过 `Tools.Chat.findChat({query:chatId,match:'exact'})` 验证 chat ID 和角色卡，未核实则**不读私密记忆、不改 prompt**。
- 在同一 chatId 内缓存最近已验证快照 5 分钟，缓存块标明**核验时刻**，不能把缓存说成实时；超过时限重新读，失败即删旧缓存，不回退到过期身份。不同 chat 不共用缓存。
- 始终重建带标记的注入块，避免同一 prompt 被重复叠加。并发同 chat 的请求共享一次等待中的网络拉取。
- Operit `MCPToolExecutor` 当前文本上限约 5000 字符；检测到长结果或截断提示立即失败。当前约 22k 字符的 `session_context(include_core=true)` **不得**用于此适配器。
- 真实 Operit Prompt Hook 可能有默认 **10 秒**共享预算；若本机网络超过预算，请标记失败，别无限重试或悄悄提高全部 Hook 预算。是否自激活 MCP、是否真的先于模型生效仍需一次 E3。
- 变更角色卡名称、配置、网络状况或状态源后，在后续正常调用中重新验证。Hook 失败时仅插入一个简短“未核验”块；无模型回复、无权限越界由测试与设备实际行为决定，不能只凭模拟器保证。

## E1/E2/E3 验收

```bash
node --check integrations/operit/auto-bootstrap/main.js
npm run test:operit-autoboot
npm run check
```

`tests/operit_auto_bootstrap_contract_test.mjs` 用**完全合成的身份文本、检查点与宿主 Hook**验证范围隔离、成功注入、缓存/去重、断网、错误来源、5000 字符截断和 fail-closed。不会读取用户私人记忆，也不消耗 Operit 的模型 API token。

E3 之后只需要一次真实新框首轮即可判断：本地安装版本是否成功触发 `before_send_to_model` → 是否真正调用配置的 `ziven_mcp` 两个只读方法 → 模型第一条回复是否准确区分 `PARTIAL_READY` / `BLOCKED` 并说对云端版本与 `next_action`。若失败只修具体宿主接点，不借机重做云端记忆；在那之前 E3 一律 `NOT VERIFIED`。

## 关联主线

- 主线：`wovowx/ZivenLab/dev/governance/roadmap.md` 中 M1 v0.1 批准范围。
- 跨宿主：仓库根 `CROSS-HOST-BRIDGE.md` 最新 M1 交接。
- 官方源码参照：[`examples/types/toolpkg.d.ts`](https://github.com/AAswordman/Operit/blob/main/examples/types/toolpkg.d.ts)、[`JsNativeInterfaceDelegates.kt`](https://github.com/AAswordman/Operit/blob/main/app/src/main/java/com/ai/assistance/operit/core/tools/javascript/JsNativeInterfaceDelegates.kt)、[`MCPToolExecutor.kt`](https://github.com/AAswordman/Operit/blob/main/app/src/main/java/com/ai/assistance/operit/core/tools/mcp/MCPToolExecutor.kt)。

220 MB Operit 历史对话导出不参与此适配器：后续若柳柳需要丰富记忆，再在本机做隐私保留的筛选、压缩与分段，原始导出不进公开 Git 仓库，也不自动批量写记忆库。
