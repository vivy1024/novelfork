# Implementation Plan

## Overview

本任务文档将 `agent-native-workspace-v1` spec 落成可执行实现顺序：先统一类型与工具协议，再重构工作台三栏主布局、右侧固定叙述者会话、中间画布与工具结果 renderer；随后补齐真实 session tool loop、确认门、Guided Generation Mode、Cockpit/Questionnaire/PGI 工具化；最后实现叙事线只读 v1、最小“写下一章”闭环、文档同步与验证。所有任务必须遵守 spec non-goals：不恢复旧前端、不新增 shim/noop adapter、不伪造工具成功、不直接覆盖正式正文。

## Tasks

- [x] 1. 建立 Agent-native workspace 共享类型与契约
  - 在 `packages/studio/src/shared/` 或现有共享契约位置新增/扩展类型：`OpenResourceTab`、`CanvasArtifact`、`CanvasContext`、`SessionToolDefinition`、`SessionToolExecutionResult`、`ToolConfirmationRequest`、`GuidedGenerationState`、`GuidedQuestion`、`GuidedGenerationPlan`、`NarrativeLineSnapshot`。
  - 扩展 `ToolCall` / session message metadata，使工具结果可携带 `renderer`、`artifact`、`confirmation`、`guided`、`pgi` 与 `narrative` 元数据。
  - 明确风险级别：`read`、`draft-write`、`confirmed-write`、`destructive`，并映射到当前 `SessionPermissionMode`。
  - 验证：新增类型级/单元测试，覆盖权限模式到工具风险的基础映射。
  - 覆盖需求：R3、R4、R7、R8、R9。

- [x] 2. 实现 Session Tool Registry
  - 新增 `packages/studio/src/api/lib/session-tool-registry.ts`，定义 studio-facing session tools 列表与 schema。
  - 注册首批工具定义：`cockpit.get_snapshot`、`cockpit.list_open_hooks`、`cockpit.list_recent_candidates`、`questionnaire.list_templates`、`questionnaire.start`、`questionnaire.suggest_answer`、`questionnaire.submit_response`、`pgi.generate_questions`、`pgi.record_answers`、`pgi.format_answers_for_prompt`、`guided.enter`、`guided.exit`、`candidate.create_chapter`、`narrative.read_line`、`narrative.propose_change`。
  - 为每个工具声明 `risk`、`renderer`、`enabledForModes` 与 provider tool calling 可用的 input schema。
  - 暂不执行工具，只完成可查询、可过滤、可序列化的注册表。
  - 验证：单元测试确认不同 permission mode 下可见工具集合正确；read/plan 下不暴露写入工具。
  - 覆盖需求：R3、R5、R6、R8、R9。

- [x] 3. 实现 Session Tool Executor 骨架和权限拦截
  - 新增 `packages/studio/src/api/lib/session-tool-executor.ts`，接收 session、toolName、input、permissionMode、canvasContext 并返回统一 `SessionToolExecutionResult`。
  - 先实现通用流程：工具存在性校验、参数 schema 校验、权限校验、执行计时、错误包装、renderer/artifact/confirmation 透传。
  - 将 `confirmed-write` 与 `destructive` 工具转换为 pending confirmation，不直接执行正式写入。
  - 对 `read` / `plan` 模式阻止所有写入风险工具。
  - 验证：单元测试覆盖 unknown tool、schema 错误、read/plan 写入阻断、执行异常不伪造成功。
  - 覆盖需求：R3、R9。

- [x] 4. 为 LLM runtime 增加工具调用契约和 unsupported 降级
  - 扩展 `packages/studio/src/api/lib/llm-runtime-service.ts` 的输入输出类型，支持 `tools?: SessionToolDefinition[]` 与 `type: "message" | "tool_use"` 结果。
  - 扩展 provider adapter 通用接口，支持传入工具定义与返回 `RuntimeToolUse[]`。
  - 对不支持 tools 的 provider/model 返回明确 `unsupported-tools` 或等价错误码，不退化为“已执行”。
  - 保持纯文本生成兼容：没有传 tools 时仍返回普通 message。
  - 验证：adapter 层测试覆盖无工具、支持工具、不支持工具三种分支。
  - 覆盖需求：R3。

- [x] 5. 在 session-chat-service 中实现有界 tool loop
  - 修改 `packages/studio/src/api/lib/session-chat-service.ts`，在单次用户消息处理中执行最多 6 步的 tool loop。
  - 当模型返回 `tool_use` 时，持久化 assistant tool-use 消息，调用 `SessionToolExecutor`，再持久化 tool-result 消息并回灌给模型。
  - 当工具返回 pending confirmation 时停止后续模型调用，等待用户确认。
  - 当 loop 超过上限时持久化错误消息并停止。
  - 保留现有 WebSocket、ack、recent messages、recovery JSON 行为。
  - 验证：集成测试覆盖单工具成功、工具失败、超过步数、刷新恢复、无工具模型 unsupported。
  - 覆盖需求：R2、R3、R9。

- [x] 6. 实现工具确认门 API 与恢复
  - 新增/扩展 API：`GET /api/sessions/:id/tools`、`POST /api/sessions/:id/tools/:toolName/confirm`，以及 pending confirmation 查询/提交能力。
  - confirmation 数据持久化到 session recovery 或 session message metadata，包含工具名、目标资源、风险、摘要、diff、批准/拒绝记录。
  - 用户批准后执行被挂起的工具或把批准结果作为 tool_result 回灌模型；用户拒绝后不执行写入并回灌拒绝结果。
  - 刷新页面后右侧会话必须恢复待确认卡片。
  - 验证：集成测试覆盖批准执行、拒绝不写、刷新恢复、审计字段记录。
  - 覆盖需求：R3、R4、R9。

- [x] 7. 实现 Cockpit 数据服务与 session tools
  - 从现有驾驶舱页面/API 数据源抽出共享服务，例如 `cockpit-service.ts`，返回 `CockpitSnapshot`、open hooks、recent candidates。
  - 实现 `cockpit.get_snapshot`、`cockpit.list_open_hooks`、`cockpit.list_recent_candidates` executor。
  - 保证缺失数据返回 `null`、`[]`、`unsupported` 或 `missing` 状态，不使用 mock 数据。
  - 保留原驾驶舱组件作为临时消费者，但业务数据以共享服务为准。
  - 验证：单元测试覆盖空书、缺失 `current_focus.md`、无候选稿、无模型配置、有真实数据。
  - 覆盖需求：R5、R10。

- [x] 8. 工具化 Questionnaire 能力
  - 将现有 questionnaire 模块接入 session tools：`questionnaire.list_templates`、`questionnaire.start`、`questionnaire.suggest_answer`、`questionnaire.submit_response`。
  - `submit_response` 继续使用现有 mapping 事务化写入 Bible/Jingwei，并保留 response。
  - `suggest_answer` 必须接收真实 provider/model 上下文；模型不可用时返回 unsupported，不返回虚假建议。
  - 工具结果带 renderer：`guided.questions` 或 questionnaire 专用问题卡。
  - 验证：单元/集成测试覆盖模板列表、提交映射、AI 建议 unsupported、真实 provider 参数传递。
  - 覆盖需求：R4、R6。

- [x] 9. 工具化 PGI 能力
  - 将 `packages/core/src/bible/pgi/pgi-engine.ts` 接入 session tools：`pgi.generate_questions`、`pgi.record_answers`、`pgi.format_answers_for_prompt`。
  - 工具结果必须包含触发原因 `heuristicsTriggered` 与每个问题的 reason。
  - 用户回答后将 PGI metadata 写入 session message metadata 和候选稿 metadata；跳过时记录 `pgi.used=false` 与 skippedReason。
  - `format_answers_for_prompt` 输出 writer 可用的本章作者指示。
  - 验证：测试覆盖有 escalating 矛盾、有临近伏笔、无问题、用户跳过、答案格式化。
  - 覆盖需求：R4、R6、R10。

- [x] 10. 实现 Guided Generation Mode 状态机与工具
  - 实现 `guided.enter`：创建 `GuidedGenerationState`，进入只读 planning/awaiting-user 状态，不执行写入。
  - 实现 `guided.exit`：提交 `GuidedGenerationPlan` 到确认门，批准后进入 executing，拒绝后回到 planning 或 rejected。
  - 支持 `GuidedQuestion` 回答、跳过、编辑、采纳 AI 建议，并写入 state。
  - Guided plan 至少包含：目标、上下文来源、关键判断、拟写入经纬变更、拟生成候选稿、风险、确认项。
  - 状态存储必须支持刷新恢复；v1 可使用 session metadata，若现有 metadata 不够稳定则新增轻量存储表/文件。
  - 验证：状态机测试覆盖 enter、answer、approve、reject、execute、complete、refresh recovery。
  - 覆盖需求：R4、R6、R9、R10。

- [x] 11. 实现候选稿创建 session tool
  - 实现 `candidate.create_chapter`，复用现有候选稿/写作生成 API 或 service，确保 AI 输出默认进入候选区。
  - 工具输入接收 `bookId`、chapter intent、PGI 指示、GuidedGenerationPlan 引用。
  - 工具结果返回 candidate ID、chapter number、title、summary、artifact ref，并声明 `renderer: "candidate.created"`。
  - 生成正式章节覆盖、合并、插入不在本工具直接执行；必须走后续确认工具。
  - 验证：集成测试确认候选稿创建成功、正式章节未被覆盖、资源树数据可刷新。
  - 覆盖需求：R2、R4、R7、R10。

- [x] 12. 建立 Tool Result Renderer Registry
  - 在 ChatWindow 工具块 UI 附近新增 renderer registry，按 `toolCall.result.renderer` 或工具名选择专用 renderer。
  - 实现首批 renderer：`CockpitSnapshotCard`、`OpenHooksCard`、`GuidedQuestionsCard`、`PgiQuestionsCard`、`GuidedGenerationPlanCard`、`CandidateCreatedCard`、`JingweiMutationPreviewCard`。
  - fallback 继续使用现有 generic `ToolCallBlock`。
  - renderer 使用 tool result JSON，不重复请求业务数据；展开 stale 数据时才发起刷新请求。
  - 验证：UI 测试覆盖 renderer 命中、fallback、错误态、pending/running/success/error 状态。
  - 覆盖需求：R3、R4、R5、R6、R7、R9。

- [x] 13. 提取 ChatWindow 可复用结构并支持 docked 模式
  - 从 `ChatWindow.tsx` 提取 `ChatWindowShell`、`ChatMessageList`、`ChatInputBar`、`ChatSessionHeader`、`ChatToolCallList` 或等价结构。
  - 保留 legacy floating host 的行为，新增 docked host 给右侧叙述者面板使用。
  - docked 模式保留模型选择、权限模式、reasoning effort、连接状态、recovery banner、recent execution chain、tool call blocks。
  - 确保切换中间画布资源不重置右侧输入框、WebSocket 连接和当前 session。
  - 验证：组件测试覆盖 floating 仍可渲染、docked 渲染、输入内容保持、权限/模型控件存在。
  - 覆盖需求：R1、R2、R3。

- [ ] 14. 实现 WorkspaceCanvas 打开资源模型
  - 新增 `WorkspaceCanvas` 与 open tab store/state，管理 `OpenResourceTab[]`、active tab、dirty 状态和 agent artifact 打开。
  - 复用 `resource-view-registry.tsx` 渲染章节、候选稿、草稿、经纬、故事文件、素材、发布报告。
  - 支持工具结果通过 `artifact` 或 `openInCanvas` 打开 guided plan、candidate、tool result、narrative line。
  - 资源有未保存编辑时，在关闭、切换覆盖、Agent 写入前显示保存/放弃/另存为候选的拦截提示。
  - 验证：UI 测试覆盖资源点击打开、多个 tab、dirty 拦截、工具产物打开。
  - 覆盖需求：R1、R7、R9、R10。

- [ ] 15. 实现 WorkspaceLeftRail
  - 新增 `WorkspaceLeftRail`，合并 compact global navigation、book switcher、当前书籍资源树与可选 session list。
  - 复用 `buildStudioResourceTree`，点击资源只更新 canvas，不影响 narrator session。
  - 当前无书籍时显示选择/创建入口，并联动右侧叙述者创建新书会话入口。
  - 窄屏时资源栏可折叠，优先保留 canvas + narrator。
  - 验证：UI 测试覆盖导航存在、资源树存在、无书籍空态、折叠行为、资源点击不重置 narrator。
  - 覆盖需求：R1、R2、R7。

- [ ] 16. 将工作台装配为左资源 / 中画布 / 右叙述者
  - 在 `WorkspacePage.tsx` 或工作台入口使用 `AgentWorkspaceLayout` / 演进后的 `ResourceWorkspaceLayout` 装配 `WorkspaceLeftRail`、`WorkspaceCanvas`、`NarratorPanel`。
  - 打开已有书籍时自动定位或创建默认 narrator/writer session，并 dock 到右侧。
  - 创建新书成功后进入该书叙述者会话，不提示用户去 ChatWindow。
  - 原驾驶舱/经纬/写作 Tab 不再作为右侧主入口；仍可作为 canvas 或工具结果 renderer 的复用组件存在。
  - 验证：路由/UI 测试覆盖三栏布局、默认会话打开、新书创建后右侧会话可用。
  - 覆盖需求：R1、R2、R5。

- [ ] 17. 增加 canvas context 到会话请求
  - 扩展前端发送消息协议，将当前 active resource tab、resource kind、resource ID、可用选区和 dirty 状态作为 canvas context 传给 session runtime。
  - 后端将 canvas context 注入工具执行上下文和必要的 system/user context，但不得把未保存正文误写入正式资源。
  - 工具确认门遇到 dirty resource 时阻止覆盖并要求用户处理。
  - 验证：集成测试覆盖 current canvas context 被传入、dirty 状态阻断写入。
  - 覆盖需求：R7、R9。

- [ ] 18. 实现 Narrative Line 只读快照服务与工具
  - 新增 narrative line 服务，从章节、章节摘要、经纬事件、冲突、伏笔和人物弧光生成 `NarrativeLineSnapshot`。
  - 实现 `narrative.read_line` tool 与 `GET /api/books/:bookId/narrative-line`。
  - 快照包含 nodes、edges、warnings；warnings 至少覆盖断线伏笔、长期未推进冲突、无 payoff、章节推进缺口、主线偏离风险中的可计算部分。
  - 不实现复杂自动排版；canvas renderer 可使用列表/分组图谱展示。
  - 验证：单元测试覆盖空书、有章节摘要、有伏笔/回收、有冲突、多 warning。
  - 覆盖需求：R8。

- [ ] 19. 实现 Narrative Line 变更草案与确认写入
  - 实现 `narrative.propose_change`，只返回 `NarrativeLineMutationPreview`，不直接写入正式叙事线。
  - 新增 propose/apply routes：`POST /api/books/:bookId/narrative-line/propose`、`POST /api/books/:bookId/narrative-line/apply`。
  - apply 必须经过确认门，记录批准时间、session ID、目标节点/边与变更摘要。
  - 验证：测试覆盖 propose 不写入、拒绝不写入、批准写入、canvas 刷新。
  - 覆盖需求：R8、R9。

- [ ] 20. 打通最小“写下一章”链路
  - 在 narrator system prompt 或 session orchestration 中明确：用户请求“写下一章”时按 cockpit snapshot → PGI → GuidedGenerationPlan → 用户批准 → candidate.create_chapter 执行。
  - 确保每一步作为工具调用显示在右侧消息流中。
  - PGI 无问题时显示明确原因并继续计划生成。
  - 用户批准后生成候选稿，在中间画布自动打开并刷新左侧候选稿节点。
  - 任一步失败时停止后续写入，保留已完成只读调查结果。
  - 验证：端到端/集成测试覆盖完整成功链、PGI 无问题链、计划拒绝链、候选生成失败链。
  - 覆盖需求：R2、R3、R4、R5、R6、R7、R9、R10。

- [ ] 21. 更新主动文档与产品口径
  - 更新 active 文档中 page-first / 右侧驾驶舱主入口的描述，改为 session-first：右侧叙述者主入口、中间画布、左侧资源栏。
  - 保留归档 spec 原文，只在当前状态/架构/使用指南/README 中说明历史驾驶舱已降级为工具结果卡片和画布组件。
  - 记录模型不支持工具调用时的 unsupported 行为和降级路径。
  - 更新 `CHANGELOG.md` Unreleased。
  - 验证：全仓搜索旧口径关键词，确保主动文档不再误导为 page-first。
  - 覆盖需求：R1、R2、R3、R5。

- [ ] 22. 完成测试矩阵与质量门
  - 补齐 design 中列出的 unit、integration、UI、non-regression 测试。
  - 至少运行相关测试、typecheck，并按修改范围运行 Studio 编译或 smoke 验证。
  - 验证项必须包含：session tool loop、confirmation gate、GuidedGenerationState、cockpit snapshot、PGI metadata、renderer registry、workspace 三栏布局、canvas 打开候选稿、最小“写下一章”链路。
  - 未运行的验证必须在交付说明中明确标注，不得声明通过。
  - 覆盖需求：全部。

- [ ] 23. 收尾与回归检查
  - 检查 `git status --short`、相关 diff、主动文档、CHANGELOG、测试输出。
  - 确认没有引入旧前端 shim/noop adapter、mock/fake success、直接覆盖正式正文路径。
  - 确认现有章节/资源编辑仍可用，ChatWindow floating 模式若保留则仍可渲染。
  - 若用户要求验收完成，按项目流程执行相关验证、提交并 push 当前分支。
  - 覆盖需求：Non-goals、R9、R10。
