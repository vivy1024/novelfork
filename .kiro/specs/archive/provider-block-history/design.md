# Provider Block History — 设计文档

## 核心类型：ConversationBlock

```ts
/** 单个内容块 — 对话历史的最小单元 */
export type ConversationBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; toolUseId: string; content: string; isError?: boolean }
  | { type: "reasoning"; content: string; provider: "deepseek" | "openai" }
  | { type: "thinking"; thinking: string; signature?: string }
  | { type: "redacted_thinking"; data: string }
  | { type: "summary"; text: string };

/** 一条对话消息 — 由多个 block 组成 */
export interface ConversationItem {
  id: string;
  role: "system" | "user" | "assistant" | "tool";
  blocks: ConversationBlock[];
  /** 兼容旧格式：纯文本 content（从 blocks 中提取 text 拼接） */
  get content(): string;
  /** 兼容旧格式：tool calls（从 blocks 中提取 tool_use） */
  get toolCalls(): RuntimeToolUse[];
}
```

## 兼容策略

### 读取旧消息

```ts
function upgradeMessage(msg: RuntimeChatMessage): ConversationItem {
  if (msg.role === "tool") {
    return { id: generateId(), role: "tool", blocks: [{ type: "tool_result", toolUseId: msg.toolCallId, content: msg.content }] };
  }
  const blocks: ConversationBlock[] = [];
  if (msg.content) blocks.push({ type: "text", text: msg.content });
  if (msg.toolCalls?.length) {
    for (const tc of msg.toolCalls) {
      blocks.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.input });
    }
  }
  return { id: generateId(), role: msg.role, blocks };
}
```

### 降级为旧格式（给不支持 block 的消费者）

```ts
function downgradeItem(item: ConversationItem): RuntimeChatMessage {
  const textBlocks = item.blocks.filter(b => b.type === "text");
  const toolUseBlocks = item.blocks.filter(b => b.type === "tool_use");
  const content = textBlocks.map(b => b.text).join("");
  const toolCalls = toolUseBlocks.map(b => ({ id: b.id, name: b.name, input: b.input }));
  if (item.role === "tool") {
    const result = item.blocks.find(b => b.type === "tool_result");
    return { role: "tool", toolCallId: result?.toolUseId ?? "", content: result?.content ?? "" };
  }
  return { role: item.role, content, ...(toolCalls.length ? { toolCalls } : {}) };
}
```

## Provider Adapter 转换

### OpenAI Chat Completions / DeepSeek

```ts
function toOpenAiMessages(items: ConversationItem[]): OpenAiMessage[] {
  return items.map(item => {
    if (item.role === "tool") { /* tool_result → { role: "tool", tool_call_id, content } */ }
    if (item.role === "assistant") {
      const msg: any = { role: "assistant" };
      // text blocks → content
      msg.content = item.blocks.filter(b => b.type === "text").map(b => b.text).join("");
      // reasoning blocks → reasoning_content（DeepSeek thinking mode 回传）
      const reasoning = item.blocks.find(b => b.type === "reasoning");
      if (reasoning) msg.reasoning_content = reasoning.content;
      // tool_use blocks → tool_calls
      const toolUses = item.blocks.filter(b => b.type === "tool_use");
      if (toolUses.length) msg.tool_calls = toolUses.map(toOpenAiToolCall);
      return msg;
    }
    return { role: item.role, content: item.blocks.filter(b => b.type === "text").map(b => b.text).join("") };
  });
}
```

### Anthropic Messages

```ts
function toAnthropicMessages(items: ConversationItem[]): AnthropicMessage[] {
  return items.filter(i => i.role !== "system").map(item => {
    if (item.role === "tool") {
      return { role: "user", content: item.blocks.filter(b => b.type === "tool_result").map(b => ({ type: "tool_result", tool_use_id: b.toolUseId, content: b.content })) };
    }
    if (item.role === "assistant") {
      const content = [];
      for (const block of item.blocks) {
        if (block.type === "thinking") content.push({ type: "thinking", thinking: block.thinking, signature: block.signature });
        if (block.type === "redacted_thinking") content.push({ type: "redacted_thinking", data: block.data });
        if (block.type === "text") content.push({ type: "text", text: block.text });
        if (block.type === "tool_use") content.push({ type: "tool_use", id: block.id, name: block.name, input: block.input });
      }
      return { role: "assistant", content };
    }
    return { role: item.role, content: item.blocks.filter(b => b.type === "text").map(b => b.text).join("") };
  });
}
```

### OpenAI Responses

```ts
function toResponsesInput(items: ConversationItem[]): ResponseItem[] {
  // 每个 ConversationItem 转为一个或多个 ResponseItem
  // message → { type: "message", role, content: [{ type: "output_text", text }] }
  // reasoning → { type: "reasoning", content: [...], encrypted_content: null }
  // function_call → { type: "function_call", name, arguments, call_id }
  // function_call_output → { type: "function_call_output", call_id, output }
}
```

## 流式解析改造

### OpenAI Chat / DeepSeek stream

```ts
// 现在：只读 delta.content
// 改为：
if (delta.reasoning_content) → 追加到当前 reasoning block
if (delta.content) → 追加到当前 text block
if (delta.tool_calls) → 追加到 tool_use block accumulator
```

### Anthropic stream

```ts
// 现在：只读 text + tool_use
// 改为：
content_block_start type=thinking → 新建 thinking block
content_block_delta type=thinking_delta → 追加到 thinking block
content_block_start type=text → 新建 text block
content_block_delta type=text_delta → 追加到 text block
content_block_start type=tool_use → 新建 tool_use block
```

## Provider 能力声明

```ts
interface ProviderCapabilities {
  apiMode: "completions" | "responses" | "anthropic" | "codex";
  supportsTools: boolean;
  supportsStreaming: boolean;
  supportsReasoning: boolean;
  /** DeepSeek: tool loop 时回传 reasoning_content; Claude: 回传 thinking block */
  reasoningPolicy: "strip" | "passback-on-tool-loop" | "always-passback";
}
```

## 文件变更清单

| 文件 | 变更 |
|------|------|
| `packages/studio/src/shared/conversation-blocks.ts` | **新建** — ConversationBlock / ConversationItem 类型 + upgrade/downgrade |
| `packages/studio/src/api/lib/provider-adapters/index.ts` | 改造 generate() 输入/输出使用 ConversationItem |
| `packages/studio/src/api/lib/provider-adapters/openai-adapter.ts` | **拆分** — OpenAI Chat + Responses 两个 adapter |
| `packages/studio/src/api/lib/provider-adapters/anthropic-adapter.ts` | **拆分** — 保存 thinking block |
| `packages/studio/src/api/lib/provider-adapters/deepseek-adapter.ts` | **新建** — 继承 OpenAI Chat，加 reasoning_content 策略 |
| `packages/studio/src/api/lib/session-chat-service.ts` | 使用 ConversationItem 替代 RuntimeChatMessage |
| `packages/studio/src/api/lib/agent-turn-runtime.ts` | 流式解析按 block 存储 |
| `packages/studio/src/shared/provider-catalog.ts` | 加 ProviderCapabilities |

## 执行顺序

1. 新建 `conversation-blocks.ts`（类型 + upgrade/downgrade）
2. 改 OpenAI Chat adapter：保存 reasoning_content
3. 改 Anthropic adapter：保存 thinking/redacted_thinking
4. 新建 Responses adapter：`apiMode=responses` 走 `/responses`
5. 改 session-chat-service：使用新类型
6. 改流式解析：按 block 存
7. 加 ProviderCapabilities 到 provider 配置
