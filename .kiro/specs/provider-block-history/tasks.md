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

- [x] 3.1 排查 ToolCall.input 数据丢失问题
  - buildToolResultCall 已保存 input，前端 toConversationMessages 已映射
- [x] 3.2 修复 Glob 工具卡片展开只显示 pattern 不显示完整路径
  - SearchExpanded 已同时显示 pattern badge 和 path
- [x] 3.3 修复"请求调用工具 Glob。"被当作文本渲染
  - cfcfbb3b: 有 toolCalls 的消息不渲染 content
- [x] 3.4 修复工具卡片重复（pending + complete 两个卡片）
  - cfcfbb3b: message-transforms 合并 tool-result 到 tool-use 消息
- [x] 3.5 修复 duration → durationMs 字段映射
  - 链路完整：executor.durationMs → ToolCall.duration → ConversationToolCall.durationMs
- [x] 3.6 确保工具卡片展开后显示完整 output（结果内容）
  - cfcfbb3b: buildToolResultCall 填充 output，前端映射 toolCall.output

## 步骤 4：流式渲染顺序修复

- [x] 4.1 确保工具调用卡片在文本之前渲染（工具先执行，结果后输出）
  - tool-use 消息 seq 小于 assistant_message，按 seq 排序自然在前
- [x] 4.2 流式文本应该逐字显示，不是一口气全部渲染
  - MessageItem 对 isStreaming 消息使用 AnimatedMarkdown 组件
- [x] 4.3 排查 WebSocket 消息是否正确按顺序发送 tool_call → text_delta
  - 后端按事件顺序广播：tool_call → tool_result → assistant_message

## 步骤 5：Provider 能力声明（已部分完成）

- [x] 5.1 ProviderProtocol 类型替代 compatibility + apiMode（已完成）
- [x] 5.2 inferProtocol 自动推断（已完成）
- [x] 5.3 NarratorStatusBar 按 protocol 条件显示推理强度/Fast Mode
  - RuntimeModelPoolEntry 加 protocol 字段
  - toConversationModelOptions 传递 protocol
  - toConversationStatus 从 selectedModel.protocol 派生 apiMode
  - NarratorStatusBar 用 apiMode === "codex" 控制推理强度/Fast Mode 显示
- [ ] 5.4 runtime 按 reasoningPolicy 决定是否回传 reasoning
