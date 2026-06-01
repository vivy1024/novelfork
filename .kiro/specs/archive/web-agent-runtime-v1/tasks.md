# Implementation Plan

## Overview

本任务文档将 `web-agent-runtime-v1` 落成一个连续实现序列：先移除虚拟模型分支和可见口径，再把现有 session chat 工具循环抽成 provider-agnostic `AgentTurnRuntime`，随后引入 canonical tool item、重复工具保护、会话中心、高级工作台模式、headless exec 和统一确认门。所有任务都必须遵守 spec 约束：不新增虚拟模型、不自动 fallback、不围绕单一 provider 做架构主线、不让 AI 直接覆盖正式章节。

## Tasks

- [x] 1. 移除虚拟模型 API、store 字段和当前测试
  - 从 `packages/studio/src/api/lib/provider-runtime-store.ts` 删除 `RuntimeVirtualModelRecord`、`VirtualModelRoutingMode`、`RuntimeVirtualModelMember`、`ResolvedRuntimeModelRoute`、`writingModelProfile` 以及 `list/get/create/update/delete/resolveVirtualModelRoute`、`get/updateWritingModelProfile` 等方法。
  - 修改 `ProviderRuntimeState`，只保留 `providers` 与 `platformAccounts`；`normalizeState()` 忽略旧 JSON 中的 `virtualModels` / `writingModelProfile`。
  - 删除 `packages/studio/src/api/routes/virtual-models.ts`、`virtual-models.test.ts`、`writing-model-profile.ts`、`writing-model-profile.test.ts`。
  - 从 `packages/studio/src/api/routes/index.ts` 和 `packages/studio/src/api/server.ts` 移除对应导出与 route 注册。
  - 更新或删除 `provider-runtime-control.test.ts` 中依赖虚拟模型的断言，改为验证真实 provider/model/platform account 状态。
  - 验证：`VirtualModel|virtualModel|virtual-models|虚拟模型` 不再出现在当前 runtime/UI/test 主路径。
  - 覆盖需求：R1、R2、R3。

- [x] 2. 重写 Provider summary 与设置页运行态口径
  - 修改 `packages/studio/src/api/routes/providers.ts` 的 `/summary`，移除 `virtualModelCount` 与虚拟模型异常项，只统计真实 provider、enabled provider、physical model、平台账号和真实异常。
  - 更新 `packages/studio/src/api/routes/providers.test.ts`，删除创建虚拟模型的测试数据，改断言为真实模型库存与异常项。
  - 修改 `packages/studio/src/app-next/settings/ProviderSettingsPage.tsx`，删除 `VirtualModelsSection`、`WritingModelProfileSection`、相关 client 方法、state 和加载逻辑。
  - 将运行态总览文案改为真实供应商、真实模型、平台账号和运行策略；将运行策略卡片改为显式模型选择、能力校验、权限模式、工具支持状态。
  - 更新 `ProviderSettingsPage.test.tsx`，断言不出现“虚拟模型”“写作任务模型”“配额路由”“失败回退”。
  - 覆盖需求：R1、R3。

- [x] 3. 同步主动文档、spec 索引和 changelog 口径
  - 更新 `docs/01-当前状态/02-Studio能力矩阵.md`，将“虚拟模型 + 写作任务模型配置”改为真实 provider/model 管理、模型池、模型默认值/子代理池和显式模型选择。
  - 更新 `.kiro/specs/README.md`，将当前 active spec 指向 `web-agent-runtime-v1`，保留 `agent-native-workspace-v1` 为已完成或上一阶段。
  - 更新 `CHANGELOG.md` Unreleased，记录新增 `web-agent-runtime-v1` spec 与移除虚拟模型方向。
  - 验证：主动文档不再把虚拟模型写成当前能力。
  - 覆盖需求：R1、R11。

- [x] 4. 建立 AgentTurnRuntime 类型与事件契约
  - 新增 `packages/studio/src/api/lib/agent-turn-runtime.ts`，定义 `AgentTurnRuntimeInput`、`AgentTurnEvent`、`AgentTurnItem`、`AgentGenerateInput`、`AgentGenerateResult`、`AgentToolExecutionInput` 等类型。
  - 将 runtime 输入限制为 messages、systemPrompt、context、tools、generate、executeTool、permissionMode、canvasContext、maxSteps。
  - 实现 message-only 最小路径：调用 generate，返回 `assistant_message` 或 `turn_failed`、`turn_completed`。
  - 新增 `agent-turn-runtime.test.ts`，覆盖纯消息成功、模型失败、空回复、未配置模型失败透传。
  - 覆盖需求：R4。

- [x] 5. 将当前 session tool loop 迁入 AgentTurnRuntime
  - 将 `session-chat-service.ts` 中从模型返回 `tool_use` 到执行工具、生成 tool result、pending confirmation、loop limit 的逻辑迁入 `AgentTurnRuntime`。
  - 保持 `MAX_SESSION_TOOL_LOOP_STEPS` 行为可配置，默认继续使用 6 步。
  - runtime 只产出事件，不直接写 WebSocket、不持久化 session、不依赖 Hono。
  - `session-chat-service.ts` 保留 WebSocket、ack、history、recovery、事件到 `NarratorSessionChatMessage` 的转换和广播。
  - 验证：现有 session chat service 测试继续通过，并新增 runtime 单测覆盖工具成功、工具失败、pending confirmation、循环上限。
  - 覆盖需求：R4、R6、R10。

- [x] 6. 实现重复工具调用保护与 continuation 指令
  - 在 `AgentTurnRuntime` 中记录本 turn 内 `toolName + stableJson(input)` 签名与最近结果。
  - 当同一签名重复超过阈值时，不再次执行工具；产出 synthetic `tool_result`，提示模型已读取过该资源并基于已有结果继续。
  - 每个正常工具结果回灌模型上下文时追加 continuation 指令：总结已获信息、判断是否足够、足够则进入下一步、不要重复读取同一资源。
  - 新增测试覆盖重复读取工具被拦截、不同参数仍允许执行、loop limit 错误包含最近工具摘要。
  - 覆盖需求：R6。

- [x] 7. 引入 canonical tool item 并更新 LLM runtime 边界
  - 在共享或 runtime 模块中定义 `AgentTurnItem`：message、tool_call、tool_result。
  - 修改 `LlmRuntimeService` / adapter 输入，使其能接收 canonical turn items 或由 runtime 统一转换后的 messages。
  - 保持无工具普通聊天兼容。
  - 确保工具结果不再只作为普通 assistant 文本参与下一次模型调用。
  - 验证：新增测试确认 tool_call/tool_result 能被传给 adapter，并保留原纯文本路径。
  - 覆盖需求：R5、R6。

- [x] 8. 升级 OpenAI-compatible adapter 的工具上下文转换
  - 修改 `packages/studio/src/api/lib/provider-adapters/index.ts`，将 canonical `tool_call` 转为 assistant `tool_calls`，将 canonical `tool_result` 转为 `role: "tool"` + `tool_call_id`。
  - 保留已有 provider-safe function name 映射：内部点号工具名发出前转安全名，返回后还原内部工具名。
  - 为 Responses API 与 Anthropic-compatible 预留转换接口，但未实现时继续返回真实 unsupported。
  - 新增 adapter 测试覆盖 OpenAI chat completions 工具上下文格式、tool role 输出、内部工具名往返。
  - 覆盖需求：R5。

- [x] 9. 让 session-chat-service 消费 AgentTurnRuntime 事件
  - 在 `handleSessionChatTransportMessage()` 中调用 `runAgentTurn()`，按事件追加/广播消息。
  - 将 `assistant_message`、`tool_call`、`tool_result`、`confirmation_required`、`turn_failed` 映射为现有 `NarratorSessionChatMessage` 和 `ToolCall` metadata。
  - 保留 `appendModelContinuationAfterToolDecision()` 行为，但改为复用 `AgentTurnRuntime` 的 confirmation continuation 路径。
  - 确保刷新恢复、acked seq、recent messages、pending confirmations 与现有 API 兼容。
  - 验证：session 集成测试覆盖单工具成功、确认门后继续、拒绝确认、刷新恢复、unsupported-tools。
  - 覆盖需求：R4、R6、R10。

- [x] 10. 统一确认门审计 metadata
  - 扩展 `SessionToolExecutionResult` 或相关 metadata，增加 confirmation audit 字段：confirmationId、sessionId、toolName、targetResources、summary、risk、decision、decidedAt、reason。
  - 更新 `session-tool-executor.ts`，确保 `guided.exit`、`candidate.create_chapter`、`narrative.propose_change`、`questionnaire.submit_response` 使用一致确认/审计结构。
  - `questionnaire.submit_response` 写入前必须展示 mapping preview；拒绝时不执行写入。
  - `candidate.create_chapter` 保持候选区写入，不覆盖正式章节；若未来要影响正式章节必须升级风险级别。
  - 验证：确认 API 测试覆盖批准、拒绝、审计字段、正式资源未被误写。
  - 覆盖需求：R10。

- [x] 11. 建立会话中心 API 与页面
  - 复用现有 session storage，新增或扩展会话列表 API，支持按 `kind`、`projectId`、`chapterId`、`status`、最近活跃排序和搜索。
  - 新增会话中心页面/组件，显示独立/书籍绑定/章节绑定筛选、标题、agent、模型、权限、状态、最近失败、未处理确认项。
  - 支持归档/恢复会话，不删除历史。
  - 从工作台右侧叙述者入口可打开会话中心并切换会话。
  - 验证：API 测试覆盖筛选和归档；UI 测试覆盖列表、筛选、模型/权限状态显示。
  - 覆盖需求：R7。

- [x] 12. 用 workbenchMode 隔离高级工具
  - 为 session tool registry 或工具目录增加 `visibility: "author" | "advanced"`，默认 NovelFork 小说工具为 author，高风险工程工具为 advanced。
  - 基于 `preferences.workbenchMode` 过滤前端入口和后端可用工具。
  - 普通作者模式下 Terminal、Browser、Bash、MCP、Admin、原始工具日志不可见且不可调用。
  - 高级模式下仍受 permissionMode、toolAccess allow/blocklist 和确认门控制。
  - 验证：UI 测试覆盖 author/advanced 显隐；后端测试覆盖普通模式调用高级工具被拒绝。
  - 覆盖需求：R8。

- [x] 13. 设计并实现 headless exec 服务入口
  - 新增 headless exec service，接收 prompt、cwd/root、bookId/sessionId、providerId/modelId、json output、stdin context 等输入。
  - 创建或复用 headless session，调用 `AgentTurnRuntime`。
  - 输出最终消息、artifact IDs、sessionId、pending confirmation 或失败摘要。
  - 非交互模式遇到确认门必须停止并返回 pending 状态，不自动批准。
  - 失败时返回非零 exit code，并输出最近工具链摘要。
  - 验证：服务级测试覆盖成功生成候选稿、缺模型、pending confirmation、工具失败、stdin 附加上下文。
  - 覆盖需求：R4、R9、R10。

- [x] 14. 接入 `novelfork exec` CLI 命令
  - 在 CLI 包中新增 `novelfork exec <prompt>` 命令或等价入口，调用 headless exec service。
  - 支持 `--root`、`--book`、`--session`、`--model provider:model`、`--json`、`--stdin` 或管道输入。
  - 默认不覆盖正式章节；生成内容进入候选区或待确认队列。
  - 文档说明非交互权限边界和退出码。
  - 验证：CLI 测试或 smoke 覆盖普通输出、JSON 输出、pending confirmation、失败退出码。
  - 覆盖需求：R9、R11。

- [x] 15. 将 Provider/Agent runtime 能力写入主动文档
  - 更新 README、Studio README、能力矩阵、架构总览或相关 docs，说明 NovelFork 是 Web Agent Runtime + 小说工具，而不是 DeepSeek 专用 loop。
  - 说明模型必须显式配置，未配置不可用；不提供虚拟模型或自动 fallback。
  - 说明作者模式/高级工作台模式、会话中心、headless exec 的状态和限制。
  - 更新 `CHANGELOG.md` Unreleased。
  - 验证：全仓搜索旧口径，确保主动文档不再把虚拟模型作为当前能力。
  - 覆盖需求：R11。

- [x] 16. 回归验证与收尾
  - 运行受影响测试：provider runtime/store/routes/settings、session chat、tool executor、provider adapter、headless exec、会话中心和高级模式相关测试。
  - 运行 Studio typecheck 与必要 compile。
  - 核对 `git status --short`、相关 diff、主动文档和 CHANGELOG。
  - 记录未实现能力为 unsupported 或后续任务，不写成已完成。
  - 覆盖需求：R1-R11。
