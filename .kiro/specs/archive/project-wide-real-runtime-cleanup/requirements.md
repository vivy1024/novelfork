# Project-wide Real Runtime Cleanup Requirements

## 背景

本 spec 覆盖全项目生产源码中已发现的 mock、占位、内存态、硬编码、假成功与未接入入口。目标不是一次性把所有未来功能都做满，而是：

1. **用户可见的功能不能是假实现**。
2. **可以保留透明占位，但必须不可误认为已完成**。
3. **需要持久化的业务数据不能只存在内存**。
4. **需要 AI/工具/上游调用的按钮不能用本地模拟冒充成功**。
5. **测试必须验证真实边界，不再只验证 mock 表象**。

本 spec 是 umbrella spec，覆盖并吸收 `.kiro/specs/real-provider-model-runtime/` 的内容。后续如需拆分实施，可以从本 spec 生成分阶段 tasks，但验收口径以本 spec 为准。

## 状态定义

每个命中的功能必须标注以下状态之一：

- **真实完成**：有持久化或真实上游/本地运行时调用，失败时返回真实错误。
- **透明占位**：UI 明确写“待接入/规划中”，按钮 disabled 或接口返回 unsupported。
- **内部辅助**：仅用于测试、示例、开发工具，不能出现在主产品路径。
- **必须移除/重做**：当前会让用户误以为已完成，但实际是 mock、硬编码、内存假实现或假成功。

## 当前 mock/占位清单

### 致命级：必须重做

| 模块 | 文件/入口 | 当前问题 |
|---|---|---|
| Provider runtime | `packages/studio/src/api/lib/provider-manager.ts` | Provider/model 全内存；刷新模型不请求上游；测试模型不打目标模型 |
| Provider routes | `packages/studio/src/api/routes/providers.ts` | Provider CRUD/刷新/测试/禁用都依赖假 providerManager |
| Platform integration | `packages/studio/src/api/routes/platform-integrations.ts` | 平台账号内存数组，JSON 导入重启丢失，不能成为真实模型来源 |
| Model source | `packages/studio/src/shared/provider-catalog.ts` | 静态 catalog 被当运行时真实模型池 |
| Chat model switch | `packages/studio/src/components/ChatWindow.tsx` | 模型下拉硬编码，不来自真实模型池 |
| Session chat | `packages/studio/src/api/lib/session-chat-service.ts` | `buildAssistantReply()` 假回复 |
| Default models | `packages/studio/src/types/settings.ts`, `packages/studio/src/shared/session-types.ts` | 默认模型/摘要模型/子代理模型硬编码 |
| Legacy model UI | `components/Model/ModelPicker.tsx`, `components/Model/ProviderConfig.tsx` | 独立 IndexedDB 配置、硬编码模型、连接测试只检查 key 长度 |
| Book chat history | `packages/studio/src/api/routes/chat.ts` | 消息历史只存在内存 Map |
| Pipeline runs | `packages/studio/src/api/routes/pipeline.ts` | 明确 temporary in-memory implementation |
| Monitor | `packages/studio/src/api/routes/monitor.ts` | 状态固定 stopped，WS 事件订阅 TODO |
| Agent config | `packages/studio/src/api/lib/agent-config-service.ts` | 配置/资源/端口使用只在内存；端口不检测真实占用 |
| Admin users | `packages/studio/src/api/routes/admin.ts` | 用户管理使用 initialUsers + 内存数组 |
| Inline completion streaming | `packages/studio/src/api/routes/ai.ts` | 真实 LLM 后按 4 字切片模拟 streaming |
| Writing modes apply | `app-next/workspace/WorkspacePage.tsx` | 写作模式结果 onAccept/onInsert/onSelectBranch 为 noop |
| Writing tools health | `api/routes/writing-tools.ts` | health 指标固定默认值，像真实评分但其实占位 |
| Tool usage demo | `components/ToolUsageExample.tsx` | `executeToolMock()` 模拟工具执行 |

### 透明占位：允许保留但必须不误导

| 模块 | 文件/入口 | 当前状态 |
|---|---|---|
| Container admin | `components/Admin/ContainerTab.tsx` | 明确未接真实容器后端 |
| Worktree terminal/container | `components/Admin/WorktreesTab.tsx` | 明确不伪造终端/容器能力 |
| Resources 缺失字段 | `components/Admin/ResourcesTab.tsx` | 部分字段缺失时展示待接入 |
| Routines hooks | `app-next/routines/RoutinesNextPage.tsx` | 明确后续接入真实 hooks API |
| Platform account actions | `PlatformIntegrationDetail.tsx`, `PlatformAccountTable.tsx` | 切号/配额刷新/删除 disabled |
| Cline JSON import | `platform-integrations.ts` + UI | 明确后续接入 |

### 低风险/正常机制

| 命中 | 说明 |
|---|---|
| `packages/core/src/**` 的 `(文件尚未创建)` | 缺文件哨兵值，不是 mock 功能 |
| `packages/core/src/utils/config-loader.ts` 的 `noop-model` | `requireApiKey=false` fallback，只能用于非真实调用路径 |
| `packages/cli/src/__tests__`, `packages/core/src/__tests__`, `packages/studio/src/**/*.test.*` | 测试 mock，不计入产品假实现 |

## Requirement 1：建立 mock 状态登记与验收门禁

**User Story:** 作为维护者，我需要所有 mock/占位/内存实现有明确状态，不再被报告为完成功能。

### Acceptance Criteria

1. 新增项目级 mock debt ledger，记录每个命中项的模块、文件、当前状态、目标状态、优先级、处理 spec/task。
2. ledger 必须区分：真实完成、透明占位、内部辅助、必须移除/重做。
3. 所有新任务的 Done Definition 必须声明达到的层级：UI、内存、持久化、真实调用。
4. UI/内存层级不得被勾选为“功能完成”。
5. 完成报告必须列出仍存在的 mock/占位项。
6. 生产源码中新增 `mock/fake/stub/TODO/后续接入/noop` 等高风险词时，必须要么登记，要么说明是测试/透明占位。

## Requirement 2：Provider、平台账号与模型池必须真实化

**User Story:** 作为用户，我配置 Provider 或导入平台账号后，模型应真实检测、可测试、可禁用、可调上下文，并进入统一模型池。

### Acceptance Criteria

1. Provider CRUD、启用/禁用、模型配置必须持久化。
2. API key provider 的模型刷新必须调用真实 adapter；不支持时返回 unsupported，不能假成功。
3. 模型测试必须对目标模型发起真实最小请求。
4. Codex/Kiro JSON 账号导入必须持久化，并成为平台模型来源。
5. 平台账号缺失、禁用或删除后，对应平台模型不得作为可用模型返回。
6. `/api/providers/models` 必须成为唯一运行时模型池。
7. `shared/provider-catalog.ts` 只能作为 seed/template，不能作为真实运行时模型来源。
8. API 响应不得回传明文 API Key 或平台凭据。

## Requirement 3：所有模型选择入口必须去硬编码

**User Story:** 作为用户，我在默认模型、AI 代理、新建会话和会话中切换时，只能选真实可用模型。

### Acceptance Criteria

1. `ChatWindow` 模型下拉必须从 `/api/providers/models` 加载。
2. Runtime settings 中默认会话模型、摘要模型、子代理模型池必须从统一模型池选择。
3. `NewSessionDialog` 新建会话模型必须来自统一模型池。
4. `DEFAULT_SESSION_CONFIG` 不得绑定硬编码 provider/model。
5. `DEFAULT_USER_CONFIG` 不得引用不存在的硬编码模型。
6. 已保存配置引用失效模型时，UI 必须显示 invalid 并要求重选，不能静默 fallback。
7. `components/Model/ModelPicker.tsx`、`ProviderConfig.tsx` 必须删除、迁移或改为统一模型池客户端；不得保留第二套 IndexedDB provider 配置。

## Requirement 4：会话与轻量 Chat 必须使用真实持久化/真实 AI 路径

**User Story:** 作为用户，我发送消息后，回复必须来自真实模型；历史必须按会话/书籍可恢复。

### Acceptance Criteria

1. `session-chat-service` 不得使用 `buildAssistantReply()` 生成假回复。
2. 会话发送必须读取当前 sessionConfig 的 provider/model，并调用真实 LLM runtime。
3. adapter 未接入、模型不可用、凭据缺失时必须返回错误 envelope，不能生成假 assistant 正文。
4. 成功响应必须记录 provider/model/run metadata。
5. 轻量 `/api/chat/:bookId/send` 消息历史必须持久化，或该入口降级为透明临时面板并明确不持久化。
6. `ChatPanel` 必须显示历史持久化状态，不能把内存历史当正式会话历史。

## Requirement 5：Admin 用户、Agent 配置、Pipeline、Monitor 必须消除假状态

**User Story:** 作为用户，我在 Admin 面板看到的用户、配置、运行状态和监控状态必须来自真实存储或真实运行时。

### Acceptance Criteria

1. Admin 用户管理必须持久化，或从 UI 中移除可编辑 CRUD，仅保留透明占位。
2. Agent config 必须持久化；资源使用必须来自真实 runtime 或明确标为估算/未接入。
3. 端口分配必须检查真实端口占用；不能只用内存计数。
4. Pipeline run 状态必须持久化或转为明确“当前进程临时运行状态”。
5. Monitor status 不能固定返回 stopped；必须接 daemon/runtime 状态，或返回 unsupported。
6. Monitor WebSocket 未订阅事件时不得展示为实时日志已接入。
7. Resources/Worktrees/Container 页面可保留透明占位，但所有可点击按钮必须对应真实行为或 disabled。

## Requirement 6：写作模式与写作工具不能只生成不应用

**User Story:** 作为作者，我使用续写、对话、多版本、大纲分支、Hook 应用和健康检查时，要么结果真正可应用，要么 UI 明确说明只是 prompt/预览。

### Acceptance Criteria

1. `writing-modes.ts` 中只返回 prompt 的 endpoint 必须改名/响应字段标明 `mode: "prompt-preview"`，或接入真实 LLM 生成。
2. Workspace 写作模式的 `onAccept/onInsert/onSelectBranch` 不得为 noop；必须写入编辑器/章节/分支状态，或按钮 disabled 并说明未接入。
3. `handleApplyHook` 必须实际追加/写入对应章节或 hook 文件；否则 UI 不得显示“应用成功”。
4. Health dashboard 固定指标必须改为真实计算、明确 unknown，或隐藏对应指标。
5. `consistencyScore: 100` 这类固定满分不得作为真实健康结果返回。
6. 写作工具的 AI 功能必须走模型 gate 和真实 LLM；无模型时返回 gate，不生成假内容。

## Requirement 7：模拟流式与工具示例必须隔离

**User Story:** 作为用户，我需要知道哪些是示例/开发演示，哪些是真实工具执行。

### Acceptance Criteria

1. `/api/ai/complete` 如果不支持上游真实流式，响应必须标注 `streamSource: "chunked-buffer"` 或改成非流式；不能称为真实 streaming。
2. 后续若接真实流式，应直接转发上游 chunk，而不是先拿完整回复再切片。
3. `ToolUsageExample.tsx` 必须移出生产入口、改名为 demo-only，或删除。
4. 所有工具执行 UI 必须调用真实 tool executor；示例 mock 不得被主路由引用。

## Requirement 8：透明占位统一规范

**User Story:** 作为用户，我可以接受功能未完成，但不能被一个可点击按钮或成功提示误导。

### Acceptance Criteria

1. 未接入功能必须使用统一 `UnsupportedCapability` UI 或等价组件。
2. 未接入按钮必须 disabled，并展示原因。
3. 未接入 API 必须返回 501/422 + `{ code: "unsupported" }`，不能 200 success。
4. 页面文案必须明确“未接入”“仅预览”“当前进程临时状态”等状态。
5. 透明占位必须登记在 mock debt ledger 中，并有目标处理方式。

## Requirement 9：Core 与 CLI 的低风险项必须做口径确认

**User Story:** 作为维护者，我要避免把正常缺文件哨兵或测试 mock 误改坏，同时确认 no-op fallback 不进入真实运行路径。

### Acceptance Criteria

1. `packages/core/src/**` 的 `(文件尚未创建)` 必须登记为缺文件哨兵，不作为 mock 债务处理。
2. `noop-model` 必须仅在 `requireApiKey=false` 的非真实调用路径使用；真实 LLM 调用不得使用。
3. CLI 生产源码本轮未发现 mock；后续扫描若发现，应追加 ledger。
4. 测试 mock 不纳入产品债务，但测试不得掩盖产品假实现。

## Requirement 10：验证必须覆盖真实边界

**User Story:** 作为维护者，我需要测试能证明 mock 被替换，而不是证明 mock 工作正常。

### Acceptance Criteria

1. Provider 持久化测试必须重新实例化 store 后验证数据仍在。
2. Adapter 测试必须证明真实边界被调用；测试可 mock fetch，但不能 mock 被测业务逻辑。
3. 会话测试必须证明 assistant 内容来自 LLM runtime 结果，失败时无假回复。
4. Admin/Agent/Pipeline/Monitor 测试必须验证 unsupported 或真实状态，不允许固定成功。
5. 写作模式测试必须覆盖“应用结果实际写入”或“未接入按钮 disabled”。
6. 全项目 mock scan 应作为最终验收附录，列出剩余项和处理状态。
