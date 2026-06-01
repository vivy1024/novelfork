# Provider 协议适配器 v2 — 设计文档

## 核心类型变更

### 新增 `ProviderProtocol`

```ts
export type ProviderProtocol =
  | "completions"      // OpenAI Chat Completions
  | "responses"        // OpenAI Responses API
  | "anthropic"        // Anthropic Messages
  | "codex"            // Codex (Completions + reasoning_effort + service_tier)
  | "claude-code";     // Claude Code (Anthropic + beta + caching)
```

### Provider 接口变更

```ts
export interface Provider {
  id: string;
  name: string;
  type: ProviderType;
  /** 新字段：替代 compatibility + apiMode */
  protocol: ProviderProtocol;
  apiKeyRequired: boolean;
  baseUrl?: string;
  prefix?: string;
  reasoningPolicy?: ProviderReasoningPolicy;
  models: Model[];
  // 废弃但保留兼容读取：
  compatibility?: ProviderCompatibility;  // deprecated
  apiMode?: ProviderApiMode;              // deprecated
}
```

### 自动迁移

```ts
function inferProtocol(provider: LegacyProvider): ProviderProtocol {
  if (provider.compatibility === "anthropic-compatible") return "anthropic";
  if (provider.apiMode === "responses") return "responses";
  if (provider.apiMode === "codex") return "codex";
  return "completions";
}
```

## 5 个 Adapter 类

### 1. CompletionsAdapter

```
端点：/v1/chat/completions（自动尝试 /chat/completions）
认证：Authorization: Bearer <key>
模型列表：GET /v1/models → data[].id
请求体：{ model, messages, tools, tool_choice, stream }
流式：SSE data: { choices[0].delta.content / .tool_calls / .reasoning_content }
```

### 2. ResponsesAdapter

```
端点：/v1/responses
认证：Authorization: Bearer <key>
模型列表：GET /v1/models → data[].id
请求体：{ model, instructions, input: ResponseItem[], tools, reasoning, stream }
流式：SSE response.output_text.delta / response.output_item.done / response.completed
```

### 3. AnthropicAdapter

```
端点：/v1/messages（自动尝试 /messages）
认证：x-api-key: <key>, anthropic-version: 2023-06-01
模型列表：GET /v1/models → data[].id（可选，失败则返回空）
请求体：{ model, system, messages, max_tokens, tools, stream }
流式：SSE content_block_start / content_block_delta / content_block_stop / message_stop
特殊：thinking block 保存/回传
```

### 4. CodexAdapter

```
端点：/v1/chat/completions
认证：Authorization: Bearer <key>
模型列表：GET /v1/models → data[].id
请求体：{ model, messages, tools, stream, reasoning_effort, service_tier }
流式：同 CompletionsAdapter
特殊：reasoning_effort 参数、service_tier: "priority"（Fast Mode）
```

### 5. ClaudeCodeAdapter

```
端点：/v1/messages
认证：x-api-key: <key>, anthropic-version: 2023-06-01, anthropic-beta: prompt-caching-2024-07-31
模型列表：GET /v1/models
请求体：同 AnthropicAdapter + cache_control + server continuations
特殊：prompt caching、extended thinking 完整支持
```

## URL 拼接规则

每个 adapter 有自己的 `resolveEndpoint(baseUrl, path)` 方法：

```ts
// CompletionsAdapter / CodexAdapter
resolveEndpoint(base, "/chat/completions"):
  if base ends with /v1 → base + /chat/completions
  else → try base + /v1/chat/completions, fallback base + /chat/completions

// ResponsesAdapter
resolveEndpoint(base, "/responses"):
  if base ends with /v1 → base + /responses
  else → try base + /v1/responses

// AnthropicAdapter / ClaudeCodeAdapter
resolveEndpoint(base, "/messages"):
  if base ends with /v1 → base + /messages
  else → try base + /v1/messages, fallback base + /messages
```

## 创建供应商 UI

### 协议选择 Modal

点击"+ 添加供应商"弹出 Modal，显示 5 种协议卡片：

| 协议 | Badge 颜色 | 说明 |
|------|-----------|------|
| Anthropic 兼容 | 紫色 | 国产模型优先推荐，工具调用和长上下文更稳定 |
| Completions 兼容 | 绿色 | DeepSeek、国产模型、本地模型 |
| Responses 兼容 | 绿色 | GPT-4o 及更新模型 |
| Codex 中转 | 灰色 | GPT-5.x 系列，支持思维强度 |
| Claude Code | 蓝色 | Claude 官方 API 完整特性 |

选择后进入供应商详情页，protocol 字段已设置。

### 供应商详情页

协议切换用分段选择器（5 选 1），切换时：
- 保留 name、prefix、apiKey、baseUrl
- 自动迁移 provider type
- 重新获取模型列表

## 文件变更清单

| 文件 | 变更 |
|------|------|
| `shared/provider-catalog.ts` | 新增 ProviderProtocol，Provider 加 protocol 字段 |
| `api/lib/provider-adapters/index.ts` | 拆分为 5 个 adapter class |
| `api/lib/provider-adapters/completions.ts` | **新建** |
| `api/lib/provider-adapters/responses.ts` | **新建** |
| `api/lib/provider-adapters/anthropic.ts` | **新建** |
| `api/lib/provider-adapters/codex.ts` | **新建** |
| `api/lib/provider-adapters/claude-code.ts` | **新建** |
| `api/lib/provider-adapters/registry.ts` | **新建** — adapter 注册表 |
| `api/lib/provider-adapters/url-resolver.ts` | **新建** — URL 拼接工具 |
| `api/lib/provider-runtime-store.ts` | 读取时自动迁移 protocol |
| `app-next/settings/providers/` | 协议选择 Modal + 详情页协议切换 |

## 执行顺序

1. 新增 ProviderProtocol 类型 + 自动迁移逻辑
2. 提取 URL 拼接工具（url-resolver.ts）
3. 拆分 CompletionsAdapter（从现有 OpenAiCompatibleAdapter 提取）
4. 拆分 AnthropicAdapter（从现有 AnthropicCompatibleAdapter 提取）
5. 新建 ResponsesAdapter（从现有 sendResponsesRequest 提取）
6. 新建 CodexAdapter（从现有 CodexPlatformAdapter 改造）
7. 新建 ClaudeCodeAdapter（继承 AnthropicAdapter + beta headers）
8. 新建 adapter 注册表（按 protocol 路由）
9. 前端：协议选择 Modal
10. 前端：详情页协议切换分段选择器
