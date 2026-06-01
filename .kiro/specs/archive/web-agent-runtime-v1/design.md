# Web Agent Runtime v1 Design

## Overview

Web Agent Runtime v1 把 NovelFork Studio 从“某些页面上挂 AI 功能”提升为“网页里的通用 Agent Runtime”。设计基线是 Claude Code CLI / OpenAI Codex CLI 的通用边界：thread/session、turn、tool schema、tool dispatcher、event stream、provider adapter、state/recovery、approval gate、exec/headless。NovelFork 的特有价值在于小说工具、小说提示词、候选区、经纬/Bible、PGI、Guided Generation 和非破坏性写作确认流。

本设计的第一原则是去掉“虚拟模型”。模型层只保留真实 provider/model、用户显式选择、能力校验、推理强度、子代理模型池和未配置阻断。

## Current State

### 已有资产

- `packages/studio/src/api/lib/session-chat-service.ts` 已有 WebSocket、session history、ack、recovery、tool loop、确认门 continuation。
- `packages/studio/src/api/lib/llm-runtime-service.ts` 已按 `sessionConfig.providerId + modelId` 调用 provider adapter，并能返回 `unsupported-tools`。
- `packages/studio/src/api/lib/provider-adapters/index.ts` 已有 OpenAI-compatible adapter、工具名安全映射和 tool call 解析。
- `packages/studio/src/api/lib/session-tool-registry.ts` 已注册 cockpit、questionnaire、PGI、guided、candidate、narrative session tools。
- `packages/studio/src/api/lib/session-tool-executor.ts` 已有权限风险、schema 校验、confirmation、dirty resource 阻断和服务分发。
- `packages/studio/src/api/lib/provider-runtime-store.ts` 已有真实 providers、models、platformAccounts 持久化。
- `packages/studio/src/app-next/settings/ProviderSettingsPage.tsx` 已展示平台集成、密钥供应商、模型库存，但混入虚拟模型和 fallback 口径。
- `packages/studio/src/shared/session-types.ts` 已有 SessionConfig、permission mode、reasoning effort、ToolCall、recovery metadata。
- `packages/studio/src/types/settings.ts` 已有 `preferences.workbenchMode`、runtime controls、modelDefaults、subagentModelPool。

### 需要纠偏的资产

- `provider-runtime-store.ts` 里存在 `RuntimeVirtualModelRecord`、`resolveVirtualModelRoute()`、`writingModelProfile`。
- `routes/virtual-models.ts`、`routes/writing-model-profile.ts` 暴露了不需要的 API。
- `ProviderSettingsPage.tsx` 可见“虚拟模型”“写作任务模型”“配额路由”“失败回退”。
- `docs/01-当前状态/02-Studio能力矩阵.md` 将虚拟模型写成已交付能力。
- `session-chat-service.ts` 文件职责过重，turn runtime 和 WebSocket/持久化耦合。
- 工具结果当前主要以 assistant 文本进入下一轮上下文，尚未形成 provider-agnostic canonical tool item。

## Architecture

```text
NovelFork Studio Web Agent Runtime

Frontend
├── Provider Settings
│   ├── Platform integrations
│   ├── API key providers
│   ├── Physical model inventory
│   └── Runtime policy view
├── Session Center
│   ├── Standalone sessions
│   ├── Book-bound sessions
│   ├── Chapter-bound sessions
│   └── Archived sessions
├── Workspace
│   ├── Author mode tools
│   └── Advanced workbench tools
└── Confirmation UI

Backend
├── ProviderRuntimeStore
│   ├── providers
│   ├── models
│   └── platformAccounts
├── LlmRuntimeService
│   └── providerId + modelId explicit call
├── AgentTurnRuntime
│   ├── canonical turn items
│   ├── bounded tool loop
│   ├── duplicate call guard
│   ├── event stream
│   └── confirmation stop/resume
├── SessionChatService
│   ├── WebSocket
│   ├── persistence
│   ├── recovery
│   └── event-to-message envelope
├── HeadlessExecService
│   └── same AgentTurnRuntime
└── SessionToolExecutor
    ├── NovelFork writing tools
    └── advanced tools gated by workbenchMode
```

## Design Decisions

### 1. Remove virtual model state instead of renaming it

Do not preserve `virtualModels` as an internal alias. The current abstraction contains routing modes and fallback behavior that violates product direction.

Provider runtime state becomes:

```ts
interface ProviderRuntimeState {
  version: 1;
  updatedAt: string;
  providers: RuntimeProviderRecord[];
  platformAccounts: RuntimePlatformAccountRecord[];
}
```

`normalizeState()` may read legacy JSON with extra fields but must ignore them:

```ts
const candidate = value as Partial<ProviderRuntimeState> & Record<string, unknown>;
return {
  version: 1,
  updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : nowIso(),
  providers: Array.isArray(candidate.providers) ? candidate.providers.map(normalizeProvider) : [],
  platformAccounts: Array.isArray(candidate.platformAccounts) ? candidate.platformAccounts.map((account) => ({ ...account })) : [],
};
```

Deleted current APIs:

```text
GET/POST/PUT/DELETE /api/virtual-models
POST /api/virtual-models/:id/test-route
GET/PUT/POST /api/settings/writing-model-profile
```

If future task model preferences are needed, they must use direct model refs:

```ts
type RuntimeModelRef = { providerId: string; modelId: string };
```

### 2. Keep LLM runtime model selection explicit

`LlmRuntimeService.generate()` remains centered on:

```ts
input.sessionConfig.providerId
input.sessionConfig.modelId
```

No default model selection happens inside LLM runtime. If fields are empty, disabled or unsupported, runtime returns a typed failure. UI presents configuration links; runtime never chooses a replacement model.

### 3. Provider settings page becomes runtime observability

The page should show:

- 平台集成：Codex/Kiro/Cline account import/status/quota if real.
- 密钥供应商：OpenAI-compatible、Anthropic-compatible、自定义 gateway。
- 模型库存：按真实供应商分组，展示模型能力和测试状态。
- 运行策略：显式模型选择、能力校验、权限模式、工具支持状态、请求调试。

It must not show:

- 虚拟模型。
- 默认正文模型 / 默认分析模型。
- quota-aware route。
- fallback route。
- 已接入但实际 adapter 返回 unsupported 的能力。

### 4. AgentTurnRuntime owns tool-loop orchestration

Create:

```text
packages/studio/src/api/lib/agent-turn-runtime.ts
```

Core input:

```ts
interface AgentTurnRuntimeInput {
  sessionId: string;
  sessionConfig: SessionConfig;
  messages: AgentTurnItem[];
  systemPrompt: string;
  context?: string;
  tools: SessionToolDefinition[];
  permissionMode: SessionPermissionMode;
  canvasContext?: CanvasContext;
  generate: (input: AgentGenerateInput) => Promise<AgentGenerateResult>;
  executeTool: (input: AgentToolExecutionInput) => Promise<SessionToolExecutionResult>;
  maxSteps?: number;
}
```

Output is an async event stream or collected events:

```ts
type AgentTurnEvent =
  | { type: "assistant_message"; content: string; runtime: NarratorSessionRuntimeMetadata }
  | { type: "tool_call"; id: string; toolName: string; input: Record<string, unknown>; runtime: NarratorSessionRuntimeMetadata }
  | { type: "tool_result"; id: string; toolName: string; result: SessionToolExecutionResult; runtime?: NarratorSessionRuntimeMetadata }
  | { type: "confirmation_required"; id: string; toolName: string; result: SessionToolExecutionResult }
  | { type: "turn_completed" }
  | { type: "turn_failed"; reason: string; message: string; data?: Record<string, unknown> };
```

`session-chat-service.ts` maps events into `NarratorSessionChatMessage` objects and persists them. Headless exec maps the same events to stdout/json output.

### 5. Canonical turn items separate runtime semantics from provider format

Create canonical internal messages:

```ts
type AgentTurnItem =
  | { type: "message"; role: "system" | "user" | "assistant"; content: string }
  | { type: "tool_call"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; toolCallId: string; name: string; content: string; data?: unknown };
```

Provider adapters receive canonical items or a transformed provider input. The OpenAI-compatible adapter converts them to chat completions format:

- message item -> normal role/content message。
- tool_call item -> assistant message with tool_calls。
- tool_result item -> `role: "tool"`, `tool_call_id`。

Anthropic and Responses adapters can later implement equivalent transforms without changing session runtime.

### 6. Tool results include continuation instruction and duplicate guard

`AgentTurnRuntime` tracks per-turn tool signatures:

```ts
const signature = `${toolName}:${stableJson(input)}`;
```

If the same signature repeats beyond threshold, runtime does not execute the tool again. It emits a synthetic tool_result saying the same result was already available and instructs the model to continue.

Every successful tool_result appended to model context includes:

```text
工具已完成。请先总结已经获得的信息，判断是否足够进入下一步。
如果信息足够，请继续执行下一步；不要重复读取同一资源。
```

This is a runtime-level guard, not a DeepSeek-specific fix.

### 7. Session center uses existing session storage

Add or extend a session-list UI/API without changing storage schema unless required. Existing `NarratorSessionRecord` already has:

```ts
kind: "standalone" | "chapter";
status: "active" | "archived";
worktree?: string;
chapterId?: string;
projectId?: string;
sessionConfig: SessionConfig;
recovery?: NarratorSessionRecoveryMetadata;
```

Session center should read existing records and render filters. Missing display data can be derived:

- model: `session.sessionConfig.providerId + modelId`
- permission: `session.sessionConfig.permissionMode`
- pending confirmations: `session.recovery.pendingToolCallCount` plus tool state query when opening details
- bound book: `projectId`
- bound chapter: `chapterId`

### 8. Advanced workbench mode controls advanced tool exposure

Use existing:

```ts
preferences.workbenchMode: boolean
```

Tool registry should support categories or visibility:

```ts
visibility: "author" | "advanced"
```

Default author tools include NovelFork writing tools. Advanced tools include Terminal、Browser、Bash、MCP、Admin and raw tool logs. Even in advanced mode, permission mode and confirmation gate still apply.

### 9. Headless exec is a thin client over AgentTurnRuntime

Add CLI/service in the Studio/CLI boundary after runtime extraction:

```bash
novelfork exec "为当前书生成下一章候选稿"
```

Runtime behavior:

- Resolves root/book/session from cwd or flags.
- Requires explicit configured model in session or CLI flags.
- Starts a headless session source.
- Calls `AgentTurnRuntime`.
- Prints final assistant message and artifacts.
- Stops on confirmation_required.
- Returns non-zero on turn_failed.

Non-interactive mode never approves confirmation automatically.

### 10. Confirmation gate becomes uniform

`SessionToolExecutor` already has generic confirmation logic. This spec extends consistency:

- `guided.exit`: confirmed plan.
- `candidate.create_chapter`: draft-write audit; confirmed-write only if formal resource would change.
- `narrative.propose_change`: preview only; apply requires confirmation.
- `questionnaire.submit_response`: mapping preview + confirmation before Bible/Jingwei write.

Confirmation metadata must include enough audit fields for UI and history:

```ts
interface ToolConfirmationAudit {
  confirmationId: string;
  sessionId: string;
  toolName: string;
  targetResources: Array<{ kind: string; id: string; title?: string }>;
  summary: string;
  risk: string;
  decidedAt?: string;
  decision?: "approved" | "rejected";
  reason?: string;
}
```

## Migration Strategy

1. Remove visible virtual model functionality first. This reduces confusion and avoids building on wrong abstractions.
2. Keep legacy runtime JSON readable by ignoring unknown fields.
3. Extract `AgentTurnRuntime` behind tests while preserving current WebSocket behavior.
4. Migrate `session-chat-service.ts` to consume runtime events.
5. Introduce canonical turn items and update provider adapters one format at a time.
6. Add session center, advanced mode and headless exec after runtime is shared.

## Testing Strategy

- Store tests: provider runtime state ignores legacy virtual fields and preserves providers/platform accounts.
- Route tests: `/api/virtual-models` and writing model profile routes are not registered; provider summary omits virtual counts.
- UI tests: ProviderSettingsPage no longer renders virtual model sections or fallback/quota wording.
- Runtime tests: AgentTurnRuntime emits correct event order for message-only, tool call, tool result, pending confirmation, repeated tool, loop limit, failure.
- Adapter tests: OpenAI-compatible canonical item conversion includes `tool` role outputs and safe internal tool-name roundtrip.
- Session tests: session-chat-service persists runtime events with existing recovery semantics.
- Confirmation tests: guided/candidate/narrative/questionnaire tools share audit metadata and rejection behavior.
- Headless tests: exec success, pending confirmation, missing model and failed turn exit codes.
- Advanced mode tests: author mode hides or blocks advanced tools; workbench mode exposes them with permission checks.

## Rollout Notes

The first PR should only remove virtual model code/UI/docs and keep current session generation behavior unchanged. The second PR should introduce `AgentTurnRuntime` with the current behavior behind it. Later PRs can add canonical item conversion, session center, advanced tool exposure and headless exec.
