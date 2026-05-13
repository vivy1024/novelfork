# Provider Block History — 需求文档

## 背景

NovelFork 当前的对话历史模型是扁平的：

```ts
type RuntimeChatMessage =
  | { role: "system" | "user" | "assistant"; content: string; toolCalls?: RuntimeToolUse[] }
  | { role: "tool"; toolCallId: string; name?: string; content: string };
```

这无法保存：
- DeepSeek `reasoning_content`（thinking mode + tool call 时必须回传）
- Claude `thinking` / `redacted_thinking` block（extended thinking + tool use 时必须回传）
- OpenAI Responses `ResponseItem`（reasoning / function_call / function_call_output）
- Codex 的 `custom_tool_call` / `local_shell_call` / `compaction`

导致的直接 bug：
- `reasoning_content in the thinking mode must be passed back to the API`
- Claude extended thinking + tools 时 thinking block 丢失
- `apiMode=responses` 的 provider 仍走 `/chat/completions`

## 目标

1. 引入统一的内部块级消息模型 `ConversationItem`
2. 每个 provider adapter 负责格式转换（内部 → provider 请求格式）
3. 流式解析按 block 存储（不再只拼 content 字符串）
4. provider 配置明确声明能力（apiMode / supportsReasoning / reasoningPolicy）

## 用户故事

- 作为用户，我使用 DeepSeek thinking mode 写小说时，AI 可以正常进行多轮 tool call 而不报错
- 作为用户，我使用 Claude extended thinking 时，AI 的推理过程不会丢失
- 作为用户，我配置了 Responses 模式的 provider 时，请求真正走 Responses API
- 作为用户，我在对话中能看到 AI 的推理/思考过程（如果模型支持）

## 非目标

- 不改变前端 UI 渲染逻辑（本次只改数据层）
- 不实现 Kiro 平台 adapter（保持 UnsupportedAdapter）
- 不实现 Codex WebSocket 模式
- 不改变 session 持久化格式（JSON 文件）

## 约束

- 必须向后兼容：旧的 `RuntimeChatMessage` 格式的历史消息能正常读取
- 不能破坏现有的 tool call 流程
- typecheck 必须通过
- 现有测试不能回归
