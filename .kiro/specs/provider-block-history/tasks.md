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

## 步骤 2：改 OpenAI Chat / DeepSeek adapter

- [ ] 2.1 `toOpenAiMessages()` 支持 ConversationItem 输入
  - assistant message 带 reasoning block → 输出 `reasoning_content` 字段
  - 保持向后兼容（仍接受旧 RuntimeChatMessage）
- [ ] 2.2 流式解析 `consumeStream()` 保存 `delta.reasoning_content`
  - 新增 `reasoningContent` 累加器
  - 返回结果中包含 reasoning block
- [ ] 2.3 非流式解析保存 `message.reasoning_content`
- [ ] 2.4 单元测试：DeepSeek thinking + tool call 多轮往返

## 步骤 3：改 Anthropic adapter

- [ ] 3.1 `parseAnthropicResponse()` 保存 thinking/redacted_thinking block
- [ ] 3.2 `toAnthropicMessages()` 回传 thinking/redacted_thinking block
- [ ] 3.3 流式解析 `consumeAnthropicStream()` 保存 thinking block
  - `content_block_start type=thinking` → 新建 thinking block
  - `content_block_delta type=thinking_delta` → 追加
  - `content_block_stop` → 固化
- [ ] 3.4 单元测试：Claude extended thinking + tool use 往返

## 步骤 4：新建 Responses adapter

- [ ] 4.1 `OpenAiCompatibleAdapter.generate()` 当 `apiMode === "responses"` 时走 `/responses`
- [ ] 4.2 请求体使用 Responses 格式：`{ model, input: ResponseItem[], tools, reasoning, stream }`
- [ ] 4.3 SSE 解析：`response.output_item.done` / `response.output_text.delta` / `response.reasoning_text.delta`
- [ ] 4.4 返回结果转为 ConversationItem（含 reasoning block）
- [ ] 4.5 单元测试：Responses 格式请求/响应

## 步骤 5：改 session-chat-service

- [ ] 5.1 `executeRuntimeTurn()` 输入改为 ConversationItem[]
- [ ] 5.2 tool call 结果存为 ConversationItem（含 tool_result block）
- [ ] 5.3 assistant 响应存为 ConversationItem（含所有 block）
- [ ] 5.4 向后兼容：旧 session 消息自动 upgrade

## 步骤 6：流式解析按 block 存

- [ ] 6.1 agent-turn-runtime 的 streaming 回调按 block 类型分发
- [ ] 6.2 前端 ws-envelope-reducer 支持 reasoning_delta 事件
- [ ] 6.3 MessageItem 渲染 reasoning block（折叠/展开）

## 步骤 7：Provider 能力声明

- [ ] 7.1 `ManagedProvider` 类型加 `capabilities: ProviderCapabilities`
- [ ] 7.2 provider 创建/编辑时自动推断 capabilities
- [ ] 7.3 NarratorStatusBar 按 capabilities 条件显示推理强度/Fast Mode
- [ ] 7.4 runtime 按 capabilities.reasoningPolicy 决定是否回传 reasoning
