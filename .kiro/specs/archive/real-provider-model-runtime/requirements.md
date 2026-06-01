# Real Provider Model Runtime Requirements

> Incorporated: 此 spec 的内容已被 `.kiro/specs/project-wide-real-runtime-cleanup/` 吸收。单独修 Provider 时可参考本文件，但项目级验收以 umbrella spec 为准。

## 背景

此前 `provider-integration-rewrite` 只完成了 UI 骨架和部分内存 route，不能算功能完成。本 spec 用于纠正并补齐真实 Provider/平台集成/模型池/会话使用链路。

本 spec 明确区分四种状态：

1. **UI 骨架**：页面、按钮、表格存在，但没有真实数据或真实行为。
2. **内存实现**：当前进程内可用，重启丢失。
3. **持久化实现**：写入本地运行时存储，重启后仍存在。
4. **真实调用实现**：会请求上游 API 或平台账号适配器，并将结果用于会话。

验收时只能把 3 或 4 称为“完成”。UI 骨架和内存实现必须标注为未完成或 prototype，不得作为 Done。

## 当前必须纠正的 mock 清单

| 位置 | 当前问题 | 本 spec 要求 |
|---|---|---|
| `packages/studio/src/api/lib/session-chat-service.ts` | `buildAssistantReply()` 直接返回“已收到” | 移除假回复，会话必须走真实 LLM runtime；未接入 adapter 时返回明确错误 |
| `packages/studio/src/components/ChatWindow.tsx` | 会话模型下拉来自硬编码 `PROVIDERS.flatMap` | 改为加载统一模型池，只展示 enabled 可用模型 |
| `packages/studio/src/api/lib/provider-manager.ts` | Provider / model 状态只在内存 `Map` | Provider、模型配置、启用状态、上下文大小、测试结果持久化 |
| `provider-manager.refreshProviderModels()` | 不请求上游，只刷新已有模型时间戳 | 调用真实 adapter 检测模型；不支持检测时返回 unsupported，不能假成功 |
| `provider-manager.testProviderConnection()` | 只检查 apiKey/endpoint 并返回本地 latency | 对目标模型发起真实最小请求，记录真实结果 |
| `packages/studio/src/api/routes/platform-integrations.ts` | `accountsByPlatform` 为 route 内存数组 | 平台账号 JSON 导入持久化；重启后账号仍存在 |
| `packages/studio/src/types/settings.ts` | 默认模型硬编码 | 默认值从统一模型池解析；无模型时为空并阻止 AI 功能 |
| `packages/studio/src/shared/session-types.ts` | `DEFAULT_SESSION_CONFIG` 硬编码 provider/model | session 默认配置不得绑定不存在的硬编码模型 |
| `packages/studio/src/shared/provider-catalog.ts` | 静态 catalog 被当真实模型池 | 只能作为内置模板/迁移种子，不得作为运行时真实来源 |

## Requirement 1：Provider 配置必须持久化

**User Story:** 作为用户，我添加或修改 API key provider 后，重启 Studio 仍能看到配置和模型设置。

### Acceptance Criteria

1. `POST /api/providers` 创建的 provider 必须写入本地运行时存储，重启服务后 `GET /api/providers` 仍返回该 provider。
2. `PUT /api/providers/:id` 修改的 `name`、`baseUrl`、`compatibility`、`apiMode`、`config.apiKey`、`enabled`、`priority` 必须持久化。
3. `POST /api/providers/:id/toggle` 的启用/禁用状态必须持久化。
4. API 响应不得回传明文 API Key；只允许返回 `hasApiKey` 或 masked metadata。
5. 写入失败时接口必须返回非 2xx 错误，不能更新前端为假成功状态。
6. 测试必须覆盖：创建 provider → 重新初始化 provider store → provider 仍存在。

## Requirement 2：平台账号 JSON 导入必须持久化并成为模型来源

**User Story:** 作为用户，我导入 Codex/Kiro JSON 账号后，账号和对应平台模型在重启后仍可用。

### Acceptance Criteria

1. `POST /api/platform-integrations/:platformId/accounts/import-json` 导入 Codex/Kiro JSON 后，账号必须持久化。
2. 重启服务或重新创建 store 后，`GET /api/platform-integrations/:platformId/accounts` 必须返回已导入账号。
3. 导入账号不得伪造配额；如果 JSON 不含配额，配额字段为空或 unknown。
4. 导入账号必须生成或激活对应平台模型来源，例如 `codex:gpt-5.5`、`kiro:<model>`。
5. 平台账号被禁用或删除后，依赖该平台账号的模型不得继续作为可用模型返回。
6. JSON 结构无效、缺少可识别账号标识时必须返回 400，并说明缺失字段。
7. 凭据类字段不得在列表 API 中原样回传。

## Requirement 3：模型刷新必须真实检测或明确 unsupported

**User Story:** 作为用户，我点击刷新模型时，要么从上游真实拉到模型列表，要么明确知道该 provider 不支持自动刷新。

### Acceptance Criteria

1. OpenAI-compatible provider 刷新模型时必须请求 provider 的模型列表接口，不能复用旧列表假装刷新。
2. Anthropic-compatible provider 刷新模型时必须请求对应模型列表接口；如果当前 adapter 未实现，返回 `unsupported`，不能返回 success。
3. Codex/Kiro 平台模型刷新必须走平台 adapter；若使用平台内置模型 catalog，响应必须标注 `source: "builtin-platform"`，且不能伪装成远端检测。
4. 手动添加模型允许存在，但必须标注 `source: "manual"`，并在测试成功前默认不进入 enabled 可用模型池。
5. 刷新结果必须持久化模型列表、`lastRefreshedAt`、source、contextWindow、enabled 状态。
6. 刷新失败不得覆盖现有模型列表；必须记录 `lastRefreshError`。
7. 测试必须证明：没有调用 adapter 时刷新不能成功。

## Requirement 4：模型测试必须真实请求目标模型

**User Story:** 作为用户，我点击测试模型时，测试结果必须来自真实上游请求，而不是本地检查。

### Acceptance Criteria

1. `POST /api/providers/:id/models/:modelId/test` 必须调用该 provider/model 对应 adapter 的最小请求。
2. 测试请求必须使用当前 provider 的 baseUrl、apiKey、compatibility、apiMode 和目标 modelId。
3. 成功时记录真实 latency、testedAt、lastTestStatus=`success`。
4. 失败时记录上游错误摘要，lastTestStatus=`error`，并在 UI 显示。
5. 没有 API Key、账号不可用、adapter 未实现、模型被禁用时必须返回失败，不能假成功。
6. 平台模型测试必须使用当前或指定平台账号；无账号时返回明确错误。
7. 测试必须覆盖 adapter 被调用的参数，不能只断言状态码。

## Requirement 5：模型配置管理必须持久化并影响模型池

**User Story:** 作为用户，我调整模型上下文大小或禁用模型后，所有模型选择入口都立即反映变化，重启后仍保持。

### Acceptance Criteria

1. `PATCH /api/providers/:providerId/models/:modelId` 的 `enabled`、`contextWindow`、`maxOutputTokens`、别名/显示名必须持久化。
2. contextWindow 必须做数值校验，不能小于 1，不能写入 NaN/Infinity。
3. 禁用模型后，`GET /api/providers/models` 不再返回该模型作为可选模型。
4. 禁用 provider 后，`GET /api/providers/models` 不再返回该 provider 下所有模型。
5. 已有会话引用被禁用模型时，UI 必须显示“当前模型不可用”，并要求切换；不能静默 fallback 到硬编码模型。
6. 模型配置更新失败时前端必须回滚 optimistic 状态。

## Requirement 6：统一模型池必须成为唯一运行时模型来源

**User Story:** 作为用户，我在默认模型、AI 代理模型、新建会话和会话中切换时，只能选择当前真实可用模型。

### Acceptance Criteria

1. `GET /api/providers/models` 必须返回统一模型池，包含 API provider 模型与平台 provider 模型。
2. 模型池只包含 enabled provider + enabled model + 凭据/账号满足基本可用条件的模型。
3. 模型池条目必须包含：`modelId`（全局 ID）、`providerId`、`providerName`、`modelName`、`source`、`contextWindow`、`maxOutputTokens`、`lastTestStatus`、`capabilities`。
4. `ChatWindow` 模型下拉必须从 `/api/providers/models` 加载，不得使用 `PROVIDERS.flatMap`。
5. `RuntimeControlPanel` 默认会话模型、摘要模型、子代理模型池必须使用统一模型池 select/multiselect，不得使用自由文本硬编码输入。
6. `NewSessionDialog` 必须允许从统一模型池选择启动模型，默认值来自用户配置中仍可用的模型。
7. 用户配置中的默认模型如果已不存在，保存/加载时必须保留错误提示或置空，不能替换为硬编码模型。
8. 所有模型选择入口在模型池为空时必须显示“尚未配置可用模型”，并阻止 AI 动作。

## Requirement 7：会话发送必须使用当前 sessionConfig 的真实模型

**User Story:** 作为用户，我在会话中切换模型后，下一条消息必须使用切换后的模型真实调用。

### Acceptance Criteria

1. `session-chat-service` 不得再使用 `buildAssistantReply()` 生成假回复。
2. 处理用户消息时必须读取当前 session 的 `sessionConfig.providerId` 和 `sessionConfig.modelId`。
3. 后端必须通过统一 LLM runtime / adapter 调用该 provider/model。
4. adapter 未实现、模型不可用、凭据缺失、请求失败时，必须向会话返回错误 envelope，不能返回假 assistant 正文。
5. 成功调用时，assistant 消息内容来自上游响应，并记录 provider/model/run metadata。
6. 流式输出如果当前阶段无法完整实现，必须至少实现非流式真实响应；UI 应明确显示发送中/失败状态。
7. 会话中切换模型后必须通过 `PUT /api/sessions/:id` 持久化，刷新页面后仍是新模型。

## Requirement 8：AI 代理模型配置不得硬编码

**User Story:** 作为用户，我给不同 AI 代理配置默认模型时，选项必须来自真实模型池。

### Acceptance Criteria

1. AI 代理默认模型、摘要模型、子代理模型池必须从统一模型池选择。
2. 默认配置不得引用不存在的硬编码模型。
3. 模型池变化后，已失效的 agent 模型配置必须显示为 invalid，并要求用户重新选择。
4. 保存 agent 模型配置时，后端必须校验模型仍在统一模型池中。
5. 测试必须覆盖：禁用模型后，该模型不能继续作为 agent 默认模型保存。

## Requirement 9：反 mock 验收标准

**User Story:** 作为项目维护者，我需要防止 UI/内存 mock 再次被报告成功能完成。

### Acceptance Criteria

1. 每个任务的 Done Definition 必须声明其达到的层级：UI / 内存 / 持久化 / 真实调用。
2. 本 spec 的功能只有达到“持久化”或“真实调用”才可勾选完成。
3. 测试 mock 只允许在测试边界替代上游网络；产品代码不得有 mock adapter 作为默认路径。
4. 所有 `后续接入`、`placeholder`、`buildAssistantReply`、`PROVIDERS.flatMap`、`accountsByPlatform` 等已知问题必须在任务中明确处理或标为非目标。
5. 完成报告必须列出仍存在的 mock/占位项；没有列出即视为未通过验收。
