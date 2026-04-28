# Implementation Plan — Project-wide Real Runtime Cleanup

## Overview

本任务清单从已批准的 `requirements.md` 与 `design.md` 生成，用于把项目内已发现的 mock、占位、内存态、硬编码和假成功实现统一登记、分级、修复或降级为透明占位。

执行原则：

- 每个任务必须声明达到的层级：UI、内存、持久化、真实调用。
- 只有“持久化”或“真实调用”层级可以作为真实功能完成。
- 透明占位必须 disabled 或返回 unsupported，不能 200 success。
- 测试 mock 允许存在，但不得掩盖产品代码假实现。
- 每完成一个阶段，都要更新 mock debt ledger 与静态扫描结果。

## Tasks

### Phase 1：建立登记、门禁与统一 unsupported 机制

- [x] 1. 新增项目级 mock debt ledger
  - 层级目标：透明登记 / 验收门禁。
  - 新增 `packages/studio/src/api/lib/mock-debt-ledger.ts`。
  - 定义 `MockDebtStatus`、`MockDebtItem`、查询/更新 helper。
  - 录入初始条目：provider-runtime、platform-integrations、runtime-model-pool、session-chat-runtime、legacy-model-ui、book-chat-history、pipeline-runs、monitor-status、agent-config-service、admin-users、writing-modes-apply、writing-tools-health、ai-complete-streaming、tool-usage-example、transparent-admin-placeholders、core-missing-file-sentinel、cli-production-source。
  - 验证：单元测试断言所有 requirements 中列出的已知条目都存在，且每项都有 status、targetBehavior、verification。

- [x] 2. 新增 runtime capability / unsupported 响应规范
  - 层级目标：透明占位。
  - 新增 `packages/studio/src/lib/runtime-capabilities.ts` 与 `packages/studio/src/api/routes/runtime-capabilities.ts`。
  - 定义统一响应：`{ error, code: "unsupported", capability, status }`。
  - 对未接入能力使用 501 或 422，不允许 200 success。
  - 验证：route 测试覆盖 unsupported 响应结构和状态码。

- [x] 3. 新增统一 `UnsupportedCapability` UI 组件
  - 层级目标：透明占位。
  - 新增 `packages/studio/src/components/runtime/UnsupportedCapability.tsx`。
  - 支持 title、reason、status、capability、可选说明链接。
  - 替换明显透明占位入口的散乱文案：Container、Worktree terminal/container、Platform future actions、Cline import。
  - 验证：UI 测试断言未接入按钮 disabled，并展示原因。

- [x] 4. 新增生产源码 mock scan 脚本/测试
  - 层级目标：验收门禁。
  - 扫描生产源码，不扫描 `__tests__`、`.test.`、`.spec.`。
  - 关键词：`mock`、`fake`、`stub`、`dummy`、`noop`、`TODO`、`后续接入`、`尚未接入`、`暂未`、`buildAssistantReply`、`PROVIDERS.flatMap`、`accountsByPlatform`、`temporary implementation`。
  - 扫描结果不要求为零，但每个生产命中必须在 mock debt ledger 中登记，或明确属于低风险哨兵/透明占位。
  - 验证：测试在未登记命中时失败。

### Phase 2：Provider、平台账号、模型池与真实 LLM runtime

- [x] 5. 为 Provider runtime store 先写持久化测试
  - 层级目标：测试先行，验证持久化边界。
  - 新增 store 测试：创建 provider、更新 apiKey/baseUrl/enabled、patch model、导入平台账号后重新实例化 store，数据仍存在。
  - 测试必须使用临时 runtime 目录，不能依赖真实用户数据。
  - 验证：测试先失败于当前内存 providerManager。

- [x] 6. 实现 `provider-runtime-store.ts`
  - 层级目标：持久化。
  - 新增 `packages/studio/src/api/lib/provider-runtime-store.ts`。
  - 使用运行时 JSON 文件保存 providers、platformAccounts、models、updatedAt、version。
  - 读失败不得覆盖旧文件；写失败必须抛错并阻止假成功。
  - API view 必须脱敏 apiKey/credentialJson。
  - 验证：Phase 2.5 的持久化测试通过。

- [x] 7. 新增 adapter registry 与基础 adapter 测试
  - 层级目标：真实调用边界 / unsupported 边界。
  - 新增 `packages/studio/src/api/lib/provider-adapters/`。
  - 定义 `RuntimeAdapter`、`ListModelsResult`、`TestModelResult`、`GenerateResult`。
  - 实现 openai-compatible adapter 的 listModels/testModel/generate fetch 边界。
  - Anthropic/Codex/Kiro 未完整实现的能力必须返回 unsupported/auth-missing，不返回 success。
  - 验证：测试断言 fetch 被调用、参数含 baseUrl/apiKey/modelId；unsupported 不返回 success。

- [x] 8. 重写 providers route 使用 runtime store 与 adapter
  - 层级目标：持久化 + 真实调用边界。
  - 修改 `packages/studio/src/api/routes/providers.ts`。
  - CRUD、toggle、reorder、model patch 全部写 runtime store。
  - `/models/refresh` 调 adapter.listModels；不支持返回 unsupported。
  - `/models/:modelId/test` 调 adapter.testModel；失败记录真实错误。
  - 删除或隔离 `provider-manager.ts` 的运行时事实源地位，仅允许作为迁移 seed/helper。
  - 验证：route 测试覆盖 refresh/test 真实 adapter 调用、写入失败非 2xx、API Key 不回传明文。

- [x] 9. 重写平台账号 JSON 导入与平台模型来源
  - 层级目标：持久化。
  - 修改 `packages/studio/src/api/routes/platform-integrations.ts`。
  - 删除 `accountsByPlatform` 内存数组。
  - Codex/Kiro JSON 导入写 runtime store，缺少可识别账号字段时返回 400。
  - 导入账号后生成或激活平台模型来源；无账号/账号禁用时模型池不返回平台模型。
  - Cline 继续 transparent unsupported，不返回假成功。
  - 验证：导入账号后重新实例化 store 仍能列出账号；模型池出现平台模型；禁用账号后模型池移除平台模型。

- [x] 10. 实现统一 runtime model pool
  - 层级目标：持久化读取 / 真实可用过滤。
  - 新增 `packages/studio/src/api/lib/runtime-model-pool.ts`。
  - `/api/providers/models` 只从 runtime store 构建 enabled provider + enabled model + 可用凭据/账号。
  - 模型条目包含 modelId、providerId、providerName、modelName、source、contextWindow、maxOutputTokens、lastTestStatus、capabilities。
  - `shared/provider-catalog.ts` 只能作为 seed/template，不再作为运行时模型池。
  - 验证：禁用 provider/model/account 后模型池同步过滤。

- [x] 11. 去除默认模型与 session config 硬编码
  - 层级目标：真实模型池选择。
  - 修改 `packages/studio/src/types/settings.ts` 与 `packages/studio/src/shared/session-types.ts`。
  - `DEFAULT_USER_CONFIG` 不再引用不存在的固定 provider/model。
  - `DEFAULT_SESSION_CONFIG` 不再绑定 `anthropic:claude-sonnet-4-6`。
  - 已保存配置引用失效模型时标记 invalid，不静默 fallback。
  - 验证：配置测试覆盖模型池为空、模型失效、有效模型保存三种情况。

- [x] 12. 改造所有模型选择 UI 使用统一模型池
  - 层级目标：真实模型池选择。
  - 修改 `ChatWindow.tsx`：删除 `PROVIDERS.flatMap`，加载 `/api/providers/models`。
  - 修改 Runtime settings：默认会话模型、摘要模型、子代理模型池使用统一模型池 select/multiselect。
  - 修改 `NewSessionDialog`：新建会话模型来自统一模型池。
  - 模型池为空时显示“尚未配置可用模型”，阻止 AI 动作。
  - 验证：UI 测试断言不读取静态 PROVIDERS，选项来自 `/api/providers/models`。

- [x] 13. 删除或迁移旧 `ModelPicker` / `ProviderConfig` 双轨配置
  - 层级目标：移除假实现 / 单一事实源。
  - 处理 `packages/studio/src/components/Model/ModelPicker.tsx` 与 `ProviderConfig.tsx`。
  - 推荐：移除生产入口或重定向到 app-next AI Provider 设置。
  - 如保留组件，必须改为统一模型池客户端，不得继续使用 IndexedDB `provider-config`。
  - 验证：静态扫描不再命中旧组件的 key 长度测试、IndexedDB provider-config 双轨路径。

- [x] 14. 实现 LLM runtime service 并替换会话假回复
  - 层级目标：真实调用。
  - 新增 `packages/studio/src/api/lib/llm-runtime-service.ts`。
  - `session-chat-service.ts` 处理用户消息时读取 sessionConfig provider/model，校验 runtime model pool，然后调用 adapter.generate。
  - 删除 `buildAssistantReply()` 或使其只存在于测试 fixture 中。
  - adapter 未实现、模型不可用、凭据缺失时发送 error envelope，不生成假 assistant 正文。
  - 成功时 assistant 内容来自上游响应，并记录 provider/model/run metadata。
  - 验证：会话测试断言 assistant 内容来自 llmRuntimeService；失败时没有假回复。

### Phase 3：Studio runtime 状态去内存假实现

- [x] 15. 处理轻量 `/api/chat` 内存历史
  - 层级目标：持久化或透明临时状态。
  - 推荐：并入正式 session/message repository，废弃第二套 `messageStore`。
  - 如果短期不能并入，API 和 `ChatPanel` 必须标注 `persistence: "process-memory"` 与“当前进程临时历史”。
  - 验证：选择持久化则重启后历史仍在；选择透明临时则 UI 文案与 API 元数据明确临时状态。

- [ ] 16. 处理 pipeline runs temporary in-memory implementation
  - 层级目标：持久化或透明临时状态。
  - 修改 `packages/studio/src/api/routes/pipeline.ts`。
  - 推荐：复用现有 `RunStore` 事实流，废弃 route 内部 `pipelineRuns` Map。
  - 如果短期保留进程内状态，API 必须返回 `persistence: "process-memory"`，UI 不得暗示历史持久化。
  - 验证：route 测试覆盖 run 状态来源或 process-memory 标记。

- [ ] 17. 修正 monitor 固定 stopped 与未订阅 WS
  - 层级目标：真实运行时或 transparent unsupported。
  - 修改 `packages/studio/src/api/routes/monitor.ts`。
  - 若可接 daemon/runtime 状态，则 `/api/monitor/status` 返回真实状态。
  - 若没有可接事实源，则返回 501 unsupported。
  - WebSocket 未订阅真实事件前不得发出“实时监控已接入”语义。
  - 验证：测试断言不再固定 200 stopped；unsupported 或真实状态路径明确。

- [ ] 18. 持久化 Agent config，并修正资源/端口语义
  - 层级目标：持久化 + 真实本地检查。
  - 修改 `packages/studio/src/api/lib/agent-config-service.ts`。
  - Agent config 写 runtime config file，重新实例化仍在。
  - Resource usage 从真实 worktree/container/run stores 获取；无法获取的字段返回 unknown/unsupported。
  - 端口分配使用 `net` 尝试监听检测真实占用；结果持久化或标注 best-effort。
  - 验证：配置重启测试、端口占用测试、unknown 字段测试。

- [ ] 19. Admin 用户管理降级或持久化
  - 层级目标：持久化或透明占位。
  - 修改 `packages/studio/src/api/routes/admin.ts` 与 Admin Users UI。
  - 推荐：本地单用户阶段移除/禁用用户 CRUD，显示“本地单用户模式”。
  - 如果保留 CRUD，必须写 SQLite/users store，重启后仍存在。
  - 验证：透明占位路径按钮 disabled；或持久化路径重启后用户仍在。

### Phase 4：写作模式、写作工具与应用链路

- [ ] 20. 区分 writing-modes 的 prompt preview 与真实 generate
  - 层级目标：透明预览或真实调用。
  - 修改 `packages/studio/src/api/routes/writing-modes.ts`。
  - 当前只返回 prompt 的 endpoint 必须响应 `mode: "prompt-preview"` / `promptPreview`，或新增真实 generate endpoint 调 LLM。
  - UI 文案显示“复制 prompt / 执行生成”，不能把 prompt preview 叫成已生成正文。
  - 验证：route/UI 测试覆盖 prompt-preview 标记和真实生成路径。

- [ ] 21. 修复 Workspace 写作模式 noop 回调
  - 层级目标：真实应用或透明 disabled。
  - 修改 `packages/studio/src/app-next/workspace/WorkspacePage.tsx`。
  - `InlineWritePanel.onAccept`、`DialogueGenerator.onInsert`、`VariantCompare.onAccept`、`OutlineBrancher.onSelectBranch` 不得再绑定空 noop。
  - 能定位章节文件/编辑器时写入目标；不能定位时禁用按钮并显示原因。
  - 验证：UI 测试覆盖应用写入或 disabled 状态。

- [ ] 22. 实现 Hook 应用持久化
  - 层级目标：持久化。
  - 修改 `WorkspacePage.tsx` 的 `handleApplyHook`。
  - 将 `GeneratedHookOption` 写入 `pending_hooks.md` 或结构化 hooks repository。
  - 成功后刷新 hook 列表；失败时显示真实错误。
  - 验证：测试断言 hook 应用后文件/repository 发生预期变化。

- [ ] 23. 去除 writing-tools health 固定假指标
  - 层级目标：真实计算 / unknown 透明状态。
  - 修改 `packages/studio/src/api/routes/writing-tools.ts` 的 `/api/books/:bookId/health`。
  - 可真实计算的字段返回真实值：章节数、字数、日进度、敏感词数量、已知冲突数量。
  - 暂不能计算的字段返回 `unknown` 或不返回，UI 显示未接入。
  - 禁止固定 `consistencyScore: 100`、空数组假装无问题。
  - 验证：测试断言无数据时不是满分，未知字段显示 unknown。

### Phase 5：模拟流式、工具示例与透明占位治理

- [ ] 24. 标注或实现 `/api/ai/complete` 真实流式
  - 层级目标：透明 chunked-buffer 或真实流式。
  - 修改 `packages/studio/src/api/routes/ai.ts`。
  - 短期允许保留完整回复后切片，但 SSE payload 必须标注 `streamSource: "chunked-buffer"`。
  - 长期如接 provider 原生 stream，则移除切片模拟并透传上游 chunk。
  - 验证：测试断言 chunked-buffer 标记存在，UI 不称其为真实上游流式。

- [ ] 25. 隔离或删除 `ToolUsageExample` 模拟工具执行
  - 层级目标：内部辅助隔离。
  - 处理 `packages/studio/src/components/ToolUsageExample.tsx`。
  - 移到 demo-only 路径、改名标注 demo/mock，或删除未使用组件。
  - 确认生产主入口不引用该 demo。
  - 验证：静态扫描命中时 ledger 状态为 internal-demo；生产入口无引用。

- [ ] 26. 统一透明占位页面与按钮
  - 层级目标：透明占位。
  - 用 `UnsupportedCapability` 或等价组件治理 Container、Worktree terminal/container、Resources 缺失字段、Routines hooks、平台账号 future actions、Cline import。
  - 未接入按钮必须 disabled；未接入 API 返回 unsupported。
  - 验证：UI/route 测试覆盖每类透明占位。

### Phase 6：Core / CLI 口径确认与最终反 mock 验收

- [ ] 27. 登记 Core 与 CLI 低风险项
  - 层级目标：审计确认。
  - 将 `packages/core/src/**` 的 `(文件尚未创建)` 登记为缺文件哨兵。
  - 确认 `noop-model` 只在 `requireApiKey=false` 的非真实调用路径使用。
  - 登记 CLI 生产源码当前无 mock 命中；测试 mock 不计入产品债务。
  - 验证：静态扫描与 ledger 一致。

- [ ] 28. 更新测试，确保验证真实边界而不是 mock 表象
  - 层级目标：验收门禁。
  - Provider：store reinit、adapter fetch 调用、unsupported 不 success。
  - Session：assistant 内容来自 LLM runtime，失败无假回复。
  - Admin/Agent/Pipeline/Monitor：真实状态或 unsupported，不固定 success。
  - Writing UX：应用真实写入或按钮 disabled。
  - Health：unknown 不显示固定满分。
  - 验证：相关测试套件通过。

- [ ] 29. 运行全项目 mock scan 并更新 ledger 剩余项
  - 层级目标：最终验收。
  - 运行生产源码 mock scan。
  - 所有剩余命中必须在 ledger 中有状态：confirmed-real、transparent-placeholder、internal-demo、test-only 或 must-replace。
  - 如果仍存在 must-replace，不能宣布 spec 完成。
  - 验证：扫描测试通过，ledger 没有未处理命中。

- [ ] 30. 最终验收与报告
  - 层级目标：完成确认。
  - 运行相关单元测试、route 测试、UI 测试、typecheck。
  - 核对 `git status --short` 与相关 diff。
  - 完成报告必须列出：已真实修复项、保留的透明占位、内部 demo、Core/CLI 低风险确认、未完成项。
  - 验收标准：没有用户可点击后假成功的 mock 功能；需要持久化的业务数据不只存在内存；需要真实调用的功能不再本地模拟成功。
