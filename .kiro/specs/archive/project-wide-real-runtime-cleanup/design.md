# Project-wide Real Runtime Cleanup Design

## 总体策略

本 spec 不是继续补 UI，而是建立项目级“反 mock”改造主线。所有命中项先进入 ledger，再按业务链路分组实施。

核心设计原则：

1. **先分级，再修复**：致命假实现优先；透明占位允许保留但必须规范化。
2. **单一事实源**：Provider/model/session/admin runtime 不再多处各存一份。
3. **真实边界优先**：需要上游调用的地方，必须走 adapter/runtime；未实现返回 unsupported。
4. **持久化优先**：用户创建、配置、导入、运行历史等业务状态必须可恢复。
5. **删除旧入口优先于维护双轨**：旧 ModelPicker/ProviderConfig 等分叉入口应迁移或下线。

## 新增目录与文件

```text
.kiro/specs/project-wide-real-runtime-cleanup/
  requirements.md
  design.md
  tasks.md                # 用户审查 spec 后生成

packages/studio/src/api/lib/mock-debt-ledger.ts
packages/studio/src/api/routes/runtime-capabilities.ts
packages/studio/src/components/runtime/UnsupportedCapability.tsx
packages/studio/src/lib/runtime-capabilities.ts
```

`mock-debt-ledger.ts` 用于开发期/管理端展示，不替代任务清单，但要成为审计事实源。

## Mock Debt Ledger

### 数据结构

```ts
type MockDebtStatus =
  | "must-replace"
  | "transparent-placeholder"
  | "internal-demo"
  | "confirmed-real"
  | "test-only";

interface MockDebtItem {
  id: string;
  module: string;
  files: string[];
  currentBehavior: string;
  userRisk: "critical" | "high" | "medium" | "low";
  status: MockDebtStatus;
  targetBehavior: string;
  ownerSpec: string;
  verification: string[];
}
```

### 初始条目

Ledger 初始录入以下组：

1. `provider-runtime`
2. `platform-integrations`
3. `runtime-model-pool`
4. `session-chat-runtime`
5. `legacy-model-ui`
6. `book-chat-history`
7. `pipeline-runs`
8. `monitor-status`
9. `agent-config-service`
10. `admin-users`
11. `writing-modes-apply`
12. `writing-tools-health`
13. `ai-complete-streaming`
14. `tool-usage-example`
15. `transparent-admin-placeholders`
16. `core-missing-file-sentinel`
17. `cli-production-source`

## 架构分组

```text
Project-wide cleanup
├── A. AI Runtime Group
│   ├── Provider runtime store
│   ├── Platform account store
│   ├── Adapter registry
│   ├── Runtime model pool
│   ├── Session chat runtime
│   └── Legacy model UI migration/removal
├── B. Studio Runtime State Group
│   ├── Book chat history persistence
│   ├── Pipeline run store
│   ├── Monitor runtime status
│   ├── Agent config persistence
│   └── Admin users persistence / placeholder downgrade
├── C. Writing UX Group
│   ├── Writing modes prompt-preview vs execute
│   ├── Workspace apply callbacks
│   ├── Hook application persistence
│   └── Health dashboard real metrics / unknown state
├── D. Demo/Placeholder Governance
│   ├── UnsupportedCapability component
│   ├── ToolUsageExample removal/isolation
│   └── Transparent placeholder registry
└── E. Audit & Verification
    ├── Static scan
    ├── Route behavior tests
    ├── Store reinitialization tests
    └── Final residual mock report
```

## A. AI Runtime Group

This group absorbs `.kiro/specs/real-provider-model-runtime/`.

### Provider Runtime Store

新增持久化 store：

```text
provider-runtime-store.ts
  loadState()
  saveState()
  createProvider()
  updateProvider()
  deleteProvider()
  listProviders()
  upsertModels()
  patchModel()
  importPlatformAccount()
  listPlatformAccounts()
```

先使用运行时 JSON 文件，路径由现有 runtime storage resolver 提供；后续可迁移 SQLite。

要求：

- 写入失败不更新 UI 为成功。
- API Key / credentialJson 只存在 store，API view 脱敏。
- JSON parse 失败时不覆盖旧文件。

### Adapter Registry

```ts
interface RuntimeAdapter {
  listModels(ref: RuntimeProviderRef): Promise<ListModelsResult>;
  testModel(input: TestModelInput): Promise<TestModelResult>;
  generate(input: GenerateInput): Promise<GenerateResult>;
}
```

Adapter：

- `openai-compatible`
- `anthropic-compatible`
- `codex-platform`
- `kiro-platform`

未实现方法返回 `unsupported`，不返回 success。

### Runtime Model Pool

`/api/providers/models` 从 runtime store 构建：

```ts
interface RuntimeModelPoolEntry {
  modelId: string;
  providerId: string;
  providerName: string;
  modelName: string;
  source: "detected" | "builtin-platform" | "manual" | "seed";
  contextWindow: number;
  maxOutputTokens: number;
  lastTestStatus: "untested" | "success" | "error" | "unsupported";
  capabilities: Record<string, boolean>;
}
```

只返回 enabled provider + enabled model + 基本可用凭据/账号。

### Session Chat Runtime

`session-chat-service.ts` 改造：

```text
message received
  -> load session
  -> validate provider/model in model pool
  -> llmRuntime.generate()
  -> success: append upstream assistant content
  -> failure: send error envelope, no fake assistant
```

删除 `buildAssistantReply()`。

### Legacy Model UI

`components/Model/ModelPicker.tsx` 与 `ProviderConfig.tsx` 两种处理二选一：

1. 删除入口，统一跳转 app-next AI Provider 设置。
2. 重写为统一模型池客户端，不再读 IndexedDB `provider-config`。

推荐：删除或隐藏旧入口，避免双轨配置继续污染。

## B. Studio Runtime State Group

### Book Chat History

`routes/chat.ts` 当前回复调用是真 LLM，但 message history 是内存 Map。设计选项：

- 若保留为正式轻量 chat：使用 session/message repository 持久化。
- 若降级为辅助面板：UI 明确“当前进程临时历史”，刷新/重启会丢失。

推荐：并入正式 session store，不再维护第二套 chat history。

### Pipeline Run Store

当前 `pipelineRuns` 是 temporary in-memory implementation。

设计：

- 短期：API 响应增加 `persistence: "process-memory"`，UI 标注“当前进程”。
- 正式：将 pipeline run/stage/event 写入 runStore 或 SQLite。

推荐：复用现有 `RunStore` 事实流，废弃 pipeline route 内部 Map。

### Monitor Runtime Status

当前 `/api/monitor/status` 固定 stopped，WS 未订阅事件。

设计：

- 如果有 daemon runtime：接 daemon store/event emitter。
- 如果无 daemon runtime：返回 501 unsupported。
- WS 未订阅真实事件前，不展示实时监控已接入。

### Agent Config Service

当前配置和资源使用全内存。

设计：

- Agent config 写入 runtime config file。
- Resource usage 从真实 worktree/container/run stores 读取。
- Port allocation 使用 `net` 尝试 listen 检测端口；分配记录持久化或明确 best-effort。

### Admin Users

当前 `initialUsers` + `users[]` 内存 CRUD。

设计选项：

1. 若项目需要用户系统：SQLite users table。
2. 若本地单用户工具：移除用户 CRUD，显示“本地单用户模式”。

推荐：当前阶段降级为透明占位，避免伪用户管理。

## C. Writing UX Group

### Writing Modes API

`writing-modes.ts` 多数 endpoint 只返回 prompt。设计：

- Prompt 预览 endpoint：命名/响应明确 `promptPreview`。
- 执行 endpoint：调用 LLM 并返回 generated text。
- UI 根据 endpoint 类型显示“复制 prompt / 执行生成”。

不要让“generate”命名只返回 prompt。

### Workspace Apply Callbacks

`WorkspacePage.tsx` 中 `noop` 用于：

- `InlineWritePanel.onAccept`
- `DialogueGenerator.onInsert`
- `VariantCompare.onAccept`
- `OutlineBrancher.onSelectBranch`

设计：

- 如果当前选中章节已绑定编辑器/文件：写回 editor state 或章节文件。
- 如果无法定位写入目标：禁用 accept/insert/select，并显示原因。

### Hook Application

`handleApplyHook` 当前空实现。

设计：

- `GeneratedHookOption` 应写入 `pending_hooks.md` 或结构化 hooks repository。
- 成功后刷新 hook 列表。
- 失败时显示错误。

### Health Dashboard

`/api/books/:bookId/health` 固定指标必须替换。

设计：

- 可真实计算的：章节数、字数、日进度、已知敏感词数量、已知冲突数量。
- 暂不能计算的：返回 `unknown`，UI 显示“未接入”。
- 禁止固定 `consistencyScore: 100`。

## D. Demo/Placeholder Governance

### UnsupportedCapability

新增统一组件：

```tsx
<UnsupportedCapability
  title="容器运行时未接入"
  reason="当前没有可验证的 Docker/兼容运行时 adapter"
  status="planned"
/>
```

用于 Container、Worktree terminal、platform account future actions、Cline import 等透明占位。

### API unsupported response

```json
{
  "error": "Capability unsupported",
  "code": "unsupported",
  "capability": "monitor.websocket.events",
  "status": "planned"
}
```

HTTP：501 或 422。

### ToolUsageExample

处理方式：

- 移到 storybook/demo-only 目录，或删除。
- 生产 bundle 主入口不得引用。
- 如果保留，文件名和 UI 必须明确 demo/mock。

### Simulated streaming

`/api/ai/complete` 当前完整 LLM 后切片。处理方式：

- 短期：响应标注 `streamSource: "chunked-buffer"`。
- 长期：接 `chatCompletionStream` 或 provider 原生 stream。

## E. Audit & Verification

### Static Scan

新增脚本或测试：扫描生产源码高风险词：

- `mock`, `fake`, `stub`, `dummy`
- `noop`
- `TODO`
- `后续接入`, `尚未接入`, `暂未`
- `buildAssistantReply`
- `PROVIDERS.flatMap`
- `accountsByPlatform`
- `temporary implementation`

扫描结果不要求为零，但每个命中必须在 ledger 中。

### Route Behavior Tests

- unsupported route 返回 501/422，不返回 success。
- 假成功路径被移除。
- 内存态 route 要么持久化，要么响应/文案标注 process-memory。

### Store Reinitialization Tests

- Provider store 重新实例化后数据仍存在。
- Platform account 重新实例化后数据仍存在。
- Agent config 重新实例化后数据仍存在。
- Admin users 如果保留 CRUD，重新实例化后数据仍存在。

### UI Tests

- 未接入按钮 disabled。
- 模型选择来自模型池。
- 写作模式 accept/insert 不再 noop；或 disabled。
- Health unknown 不显示固定满分。

## 实施阶段建议

### Phase 1：登记与门禁

- 建 mock debt ledger。
- 标注旧 spec 和现有 mock 清单。
- 加静态扫描脚本。

### Phase 2：AI Runtime 修复

- Provider/platform/model/session 统一真实化。
- 删除/迁移旧 ModelPicker/ProviderConfig。

### Phase 3：Studio Runtime 修复

- Chat history、pipeline、monitor、agent config、admin users。

### Phase 4：Writing UX 修复

- Prompt preview 与真实 generate 分离。
- Workspace apply callbacks 落地。
- Health dashboard 去固定假指标。

### Phase 5：透明占位治理

- UnsupportedCapability。
- API unsupported response。
- Demo-only 隔离。

## 完成定义

本 spec 完成时必须满足：

1. 所有已知 mock/占位/内存实现都在 ledger 中。
2. 所有致命项都已真实修复或降级为透明占位。
3. 不存在用户可点击后假成功的 mock 功能。
4. 需要持久化的业务数据不再只存在内存。
5. 需要真实调用的功能不再本地模拟成功。
6. 全项目静态扫描输出已作为验收附录，剩余项均有状态说明。
7. 相关测试覆盖真实边界或 unsupported 行为。
