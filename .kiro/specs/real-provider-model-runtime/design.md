# Real Provider Model Runtime Design

> Incorporated: 此设计已被 `.kiro/specs/project-wide-real-runtime-cleanup/` 吸收。单独修 Provider 时可参考本文件，但项目级验收以 umbrella spec 为准。

## 目标

把 AI Provider、平台账号、模型检测、模型管理、默认模型、AI 代理模型、会话模型切换和会话发送接成一条真实链路。

核心原则：

- 运行时模型来源只有统一模型池。
- Provider/账号/模型配置必须持久化。
- 刷新和测试必须走真实 adapter 或明确 unsupported。
- 会话不得再用假回复。
- UI 可以展示未接入能力，但不能把未接入能力做成可点击成功。

## 非目标

本 spec 不要求一次性完成以下能力：

- OAuth / 设备码登录流程。
- 多账号自动轮换策略的完整实现。
- 配额真实刷新全量实现。
- 全量流式 token 渲染；允许先做非流式真实回复。
- OS 级密钥链加密；但必须避免 API 响应泄露明文凭据。

## 现状替换图

```text
当前错误链路
UI buttons
  -> providerManager 内存 Map
  -> 硬编码 PROVIDERS
  -> buildAssistantReply 假回复

目标链路
Provider / Platform account store（持久化）
  -> Adapter registry（真实检测/测试/调用）
  -> Runtime model pool（唯一模型来源）
  -> Settings / Agent / NewSession / ChatWindow
  -> Session config
  -> LLM runtime service
  -> Real upstream response or explicit error
```

## 架构组件

```text
api/lib/provider-runtime-store.ts
  持久化 API provider、平台账号、模型配置、测试状态

api/lib/provider-adapters/
  index.ts
  openai-compatible-adapter.ts
  anthropic-compatible-adapter.ts
  codex-platform-adapter.ts
  kiro-platform-adapter.ts

api/lib/runtime-model-pool.ts
  从 store + adapters 汇总 enabled usable models

api/lib/llm-runtime-service.ts
  根据 providerId/modelId 调 adapter generate

api/routes/providers.ts
  Provider CRUD、模型刷新、模型测试、模型 patch、模型池

api/routes/platform-integrations.ts
  平台账号导入、列表、启用/禁用、删除（至少账号列表与导入持久化）

api/lib/session-chat-service.ts
  移除 buildAssistantReply，调用 llm-runtime-service

app-next/settings/panels/RuntimeControlPanel.tsx
  默认模型/摘要模型/子代理模型池从模型池选择

components/ChatWindow.tsx
  会话模型下拉从模型池加载并保存 sessionConfig

components/sessions/NewSessionDialog.tsx
  新建会话可选择模型池中的模型
```

## 数据模型

### StoredApiProvider

```ts
interface StoredApiProvider {
  id: string;
  name: string;
  type: "anthropic" | "openai" | "deepseek" | "custom";
  enabled: boolean;
  priority: number;
  baseUrl?: string;
  compatibility: "openai-compatible" | "anthropic-compatible";
  apiMode: "completions" | "responses" | "codex";
  config: {
    apiKey?: string;
    endpoint?: string;
    timeout?: number;
    retryAttempts?: number;
    customHeaders?: Record<string, string>;
  };
  createdAt: string;
  updatedAt: string;
}
```

API 响应中的 provider 必须转换为 `ManagedProviderView`：

```ts
interface ManagedProviderView extends Omit<StoredApiProvider, "config"> {
  config: Omit<StoredApiProvider["config"], "apiKey"> & {
    hasApiKey: boolean;
    apiKeyMask?: string;
  };
  models: StoredRuntimeModel[];
}
```

### StoredPlatformAccount

```ts
interface StoredPlatformAccount {
  id: string;
  platformId: "codex" | "kiro" | "cline";
  displayName: string;
  email?: string;
  accountId?: string;
  authMode: "json-account" | "local-auth-json" | "oauth" | "device-code";
  credentialJson: string;
  credentialSource: "json" | "local" | "oauth";
  enabled: boolean;
  current: boolean;
  priority: number;
  status: "active" | "disabled" | "expired" | "error" | "unknown";
  planType?: string;
  quota?: PlatformQuotaSnapshot;
  successCount: number;
  failureCount: number;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
}
```

账号列表 API 不返回 `credentialJson`。

### StoredRuntimeModel

```ts
interface StoredRuntimeModel {
  id: string;                 // local model id, e.g. gpt-5.5
  providerId: string;         // api provider id or platform id, e.g. openai/codex
  globalModelId: string;      // providerId:id, e.g. codex:gpt-5.5
  name: string;
  source: "detected" | "builtin-platform" | "manual" | "seed";
  enabled: boolean;
  contextWindow: number;
  maxOutputTokens: number;
  capabilities: {
    streaming?: boolean;
    vision?: boolean;
    functionCalling?: boolean;
    reasoning?: boolean;
  };
  lastRefreshedAt?: string;
  lastRefreshError?: string;
  lastTestStatus: "untested" | "success" | "error" | "unsupported";
  lastTestLatency?: number;
  lastTestError?: string;
  lastTestedAt?: string;
  createdAt: string;
  updatedAt: string;
}
```

### RuntimeModelPoolEntry

```ts
interface RuntimeModelPoolEntry {
  modelId: string;            // globalModelId
  providerId: string;
  providerName: string;
  modelName: string;
  source: StoredRuntimeModel["source"];
  enabled: true;
  contextWindow: number;
  maxOutputTokens: number;
  lastTestStatus: StoredRuntimeModel["lastTestStatus"];
  capabilities: StoredRuntimeModel["capabilities"];
}
```

## 持久化策略

新增 `provider-runtime-store.ts`，先使用运行时本地 JSON 文件，路径通过现有 `resolveRuntimeStoragePath("provider-runtime.json")` 解析。

理由：

- 当前 provider-manager 已是内存结构，JSON store 是最小可控迁移。
- 不阻塞后续迁移到 SQLite。
- 测试可用临时目录验证重启后恢复。

文件内容：

```ts
interface ProviderRuntimeState {
  version: 1;
  providers: StoredApiProvider[];
  platformAccounts: StoredPlatformAccount[];
  models: StoredRuntimeModel[];
  updatedAt: string;
}
```

写入要求：

- 保存前创建目录。
- JSON parse 失败时返回错误，不静默回默认值覆盖用户配置。
- API 响应脱敏。
- 不写入仓库目录；只能写运行时存储目录。

## Adapter 设计

### ProviderAdapter

```ts
interface ProviderAdapter {
  kind: "api-provider" | "platform";
  supportsModelRefresh(input: ProviderRuntimeRef): boolean;
  listModels(input: ProviderRuntimeRef): Promise<ListModelsResult>;
  testModel(input: TestModelInput): Promise<TestModelResult>;
  generate(input: GenerateInput): Promise<GenerateResult>;
}
```

```ts
type ListModelsResult =
  | { ok: true; models: AdapterModel[]; source: "detected" | "builtin-platform" }
  | { ok: false; reason: "unsupported" | "auth-missing" | "request-failed"; message: string };
```

### OpenAI-compatible adapter

- `listModels` 请求 `${baseUrl}/models` 或兼容的 `/v1/models`。
- `testModel` 使用最小 chat/responses 请求，按 `apiMode` 选择 endpoint。
- `generate` 使用当前 apiMode 生成真实回复。

### Anthropic-compatible adapter

- `listModels` 请求 Anthropic-compatible 模型接口；若 adapter 尚未实现，返回 `unsupported`。
- `testModel` 使用最小 messages 请求。
- `generate` 使用 messages 请求。

### Codex/Kiro platform adapter

- `listModels` 可先返回平台内置模型 catalog，但必须标记 `source: "builtin-platform"`。
- 无平台账号时 `testModel/generate` 返回 `auth-missing`。
- 有账号但真实调用未接入时返回 `unsupported`，不能返回假成功。
- 后续真实配额/切号可扩展到同一个 adapter。

## API 设计

### Provider CRUD

```http
GET /api/providers
POST /api/providers
PUT /api/providers/:id
POST /api/providers/:id/toggle
DELETE /api/providers/:id
```

这些接口全部读写 `provider-runtime-store`，不再只改内存 Map。

### Model management

```http
GET /api/providers/models
POST /api/providers/:id/models/refresh
POST /api/providers/:id/models/:modelId/test
PATCH /api/providers/:id/models/:modelId
POST /api/providers/:id/models
```

行为：

- `/models` 返回统一模型池。
- `/refresh` 调 adapter；unsupported 返回 422 或 501，不返回 success。
- `/test` 调 adapter；错误写入模型状态。
- `PATCH` 持久化 enabled/contextWindow/maxOutputTokens。
- `POST /models` 用于手动添加模型，source=`manual`。

### Platform integrations

```http
GET /api/platform-integrations
GET /api/platform-integrations/:platformId/accounts
POST /api/platform-integrations/:platformId/accounts/import-json
PATCH /api/platform-integrations/:platformId/accounts/:accountId
DELETE /api/platform-integrations/:platformId/accounts/:accountId
POST /api/platform-integrations/:platformId/models/refresh
```

最低实现：导入、列表、启用/禁用、删除必须持久化。切号/配额刷新如果未做，必须保持 disabled 或返回 unsupported。

### Session chat

`handleSessionChatTransportMessage` 流程改为：

```text
receive user message
  -> append user message
  -> load latest session
  -> validate sessionConfig provider/model against runtime model pool
  -> call llmRuntimeService.generate(...)
  -> success: append assistant response from upstream
  -> failure: send session:error envelope + append optional system/error message
  -> persist history/recovery
```

禁止路径：

- 不允许调用 `buildAssistantReply()`。
- 不允许在 adapter 缺失时生成模拟 assistant 回复。

## UI 设计

### Provider Settings

保持两类区域：

1. 平台集成：账号导入、账号表、平台模型表。
2. API key 接入：Base URL/API Key、provider 模型表。

模型表统一支持：

- 刷新模型。
- 测试模型。
- contextWindow 数字编辑。
- enabled switch / 眼睛图标。
- source badge：detected / builtin-platform / manual / seed。
- lastTestStatus / lastRefreshError。

如果按钮不可用：

- disabled。
- tooltip 或文案说明原因。
- 不能点击后显示成功。

### RuntimeControlPanel

- 默认会话模型：select，选项来自 `/api/providers/models`。
- 摘要模型：select，选项来自 `/api/providers/models`。
- 子代理模型池：multi-select，选项来自 `/api/providers/models`。
- 模型池为空时显示“尚未配置可用模型”，保存按钮禁止保存无效模型。

### NewSessionDialog

- 新增模型选择区域。
- 默认选中用户配置里的 defaultSessionModel；若已失效，显示需要重新选择。
- 提交 payload 包含 `sessionConfig.providerId/modelId`。

### ChatWindow

- 删除 `MODEL_OPTIONS = PROVIDERS.flatMap(...)`。
- 组件加载 `/api/providers/models`。
- 当前 sessionConfig 模型不在模型池时，select 显示 invalid 状态，并禁用发送或要求切换。
- 切换模型后 `PUT /api/sessions/:id` 持久化。

## 迁移策略

1. 首次启动时，如果 `provider-runtime.json` 不存在：
   - 从 `shared/provider-catalog.ts` 生成 seed providers/models。
   - seed 模型标记 `source: "seed"`。
   - seed 不是检测结果，UI 应显示来源。
2. 已有 `user-config.json` 中的默认模型：
   - 如果存在于模型池，保留。
   - 如果不存在，保留原值但标记 invalid，要求用户重新选择。
   - 不自动 fallback 到硬编码模型。
3. 旧 `providerManager.initialize()` 不再作为真实运行时来源，只能作为迁移种子或测试 helper。

## 测试策略

### Store tests

- 创建 provider 后重新实例化 store，provider 仍存在。
- 修改 API Key 后 API 响应脱敏，store 内可用于 adapter。
- 导入平台账号后重新实例化 store，账号仍存在。
- 删除/禁用账号后模型池变化。

### Adapter tests

- 使用可注入 fetch mock 测 adapter 边界。
- 测试 `listModels` 真的调用 fetch。
- 测试 `testModel` 传入正确 baseUrl/apiKey/modelId。
- 测试 unsupported 不返回 success。

### Route tests

- `/api/providers/:id/models/refresh` 无 adapter 调用时失败。
- `/api/providers/:id/models/:modelId/test` 使用 adapter 返回真实状态。
- `PATCH model.enabled=false` 后 `/api/providers/models` 不含该模型。
- 平台账号导入重启后仍可列出。

### UI tests

- ChatWindow 模型下拉从 `/api/providers/models` 渲染，不依赖 `PROVIDERS`。
- RuntimeControlPanel 只能选择模型池选项。
- ProviderSettings 模型测试失败显示真实错误。
- disabled/unsupported 按钮不能显示成功。

### Session tests

- WebSocket 收到消息后调用 `llmRuntimeService.generate`。
- generate 成功时 assistant 内容来自 adapter。
- generate 失败时发送 `session:error`，不 append 假回复。
- 切换模型后下一条消息使用新模型。

## 完成定义

本 spec 完成必须同时满足：

- 已知高危 mock 被移除或明确转为 unsupported。
- Provider/账号/模型配置持久化。
- 统一模型池成为唯一模型选择来源。
- 刷新/测试/会话发送不再假成功。
- 相关测试证明真实 adapter 边界被调用。
- 完成报告列出剩余非目标 mock；没有列出则不得称完成。
