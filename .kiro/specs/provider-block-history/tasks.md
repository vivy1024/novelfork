# Provider Block History — 任务清单

## 步骤 1：新建 ConversationBlock 类型

- [ ] 1.1 创建 `packages/studio/src/shared/conversation-blocks.ts`
  - ConversationBlock union type（text/tool_use/tool_result/reasoning/thinking/redacted_thinking/summary）
  - ConversationItem interface（id/role/blocks + content/toolCalls getter）
  - upgradeMessage()：RuntimeChatMessage → ConversationItem
  - downgradeItem()：ConversationItem → RuntimeChatMessage
  - extractTextContent()：从 blocks 提取纯文本
  - extractToolCalls()：从 blocks 提取 tool calls
- [ ] 1.2 单元测试：upgrade/downgrade 往返一致性

## 步骤 2：改 session-chat-service（已部分完成）

- [x] 2.1 adapter 拆分为 5 个独立协议（provider-protocol-adapters-v2 已完成）
- [x] 2.2 流式解析保存 reasoning_content（已完成）
- [x] 2.3 Anthropic thinking block 保存/回传（已完成）
- [ ] 2.4 session-chat-service 的 tool call 结果存为完整 ConversationItem
- [ ] 2.5 向后兼容：旧 session 消息自动 upgrade

## 步骤 3：工具卡片渲染修复

- [ ] 3.1 排查 ToolCall.input 数据丢失问题
  - 后端 ToolCall 接口有 input/output/status/duration 字段
  - 前端 ConversationToolCall 需要 input/output/status/durationMs
  - 确认 WebSocket 消息中 toolCalls 是否包含完整 input 对象
- [ ] 3.2 修复 Glob 工具卡片展开只显示 pattern 不显示完整路径
  - extractGrepPattern 提取 pattern 字段
  - 但 Glob 的 input 是 { pattern: "**/*", path: "..." }
  - 需要在 SearchExpanded 中同时显示 pattern 和 path
- [ ] 3.3 修复"请求调用工具 Glob。"被当作文本渲染
  - 这是 pending 状态的工具调用描述，不应该作为 assistant content 输出
  - 排查 agent-turn-runtime 是否把工具调用描述写入了 content 字段
- [ ] 3.4 修复工具卡片重复（pending + complete 两个卡片）
  - 应该只有一个卡片，状态从 pending → running → success/error 变化
  - 排查 ws-envelope-reducer 是否正确合并同一 tool call 的状态更新
- [ ] 3.5 修复 duration → durationMs 字段映射
  - 后端发 duration（秒或毫秒？），前端需要 durationMs
- [ ] 3.6 确保工具卡片展开后显示完整 output（结果内容）

## 步骤 4：流式渲染顺序修复

- [ ] 4.1 确保工具调用卡片在文本之前渲染（工具先执行，结果后输出）
- [ ] 4.2 流式文本应该逐字显示，不是一口气全部渲染
- [ ] 4.3 排查 WebSocket 消息是否正确按顺序发送 tool_call → text_delta

## 步骤 5：Provider 能力声明（已部分完成）

- [x] 5.1 ProviderProtocol 类型替代 compatibility + apiMode（已完成）
- [x] 5.2 inferProtocol 自动推断（已完成）
- [ ] 5.3 NarratorStatusBar 按 protocol 条件显示推理强度/Fast Mode
- [ ] 5.4 runtime 按 reasoningPolicy 决定是否回传 reasoning
