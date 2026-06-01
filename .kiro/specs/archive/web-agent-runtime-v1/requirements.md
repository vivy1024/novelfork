# Web Agent Runtime v1 Requirements

## Introduction

本 spec 将 NovelFork 下一阶段全部收束为一个方向：**网页里的通用 Agent Runtime**。NovelFork 不是围绕某个模型或 provider 做补丁，而是在网页中运行一套升级版 Claude Code CLI / Codex CLI 式 runtime：真实 provider/model 显式选择、结构化工具循环、事件流、会话中心、权限确认门、headless exec，以及 NovelFork 自带的小说工具和提示词。

本 spec 同时纠偏当前已经出现但不符合方向的“虚拟模型”分支。NovelFork 不引入 VirtualModel / VirtualModelRegistry / 自动 fallback / 自动路由抽象。所有模型调用都基于用户显式选择的真实 providerId + modelId；未配置则对应 AI 功能不可用并提示配置。

## Requirement 1：移除虚拟模型概念与可见口径

**User Story：** 作为作者和维护者，我希望模型配置只表达真实供应商、真实模型、用户选择与运行能力，不出现“虚拟模型”这种 NarraFork/Codex/Claude Code 都没有的额外抽象。

### Acceptance Criteria

1. WHEN 用户打开 AI 供应商设置 THEN THE SYSTEM SHALL 不显示“虚拟模型”“默认正文模型”“默认分析模型”“写作任务绑定到虚拟模型”等 UI 文案。
2. WHEN 前端加载 provider runtime 概览 THEN THE SYSTEM SHALL 只统计真实供应商、真实模型、平台账号、异常项和能力状态。
3. WHEN 后端加载 provider runtime state THEN THE SYSTEM SHALL 忽略旧 state 中残留的 virtualModels / writingModelProfile 字段，不再依赖或展示它们。
4. WHEN API routes 注册 THEN THE SYSTEM SHALL 不再注册 `/api/virtual-models` 与 `/api/settings/writing-model-profile`。
5. WHEN 代码搜索 `VirtualModel`、`virtualModel`、`virtual-models`、`虚拟模型` THEN THE SYSTEM SHALL 仅允许历史 archive spec 或迁移说明中出现，不允许当前 runtime、UI、测试和主动文档继续使用。
6. WHEN 需要表达不同用途的模型 THEN THE SYSTEM SHALL 使用真实 provider/model 选择或会话当前模型，不经由虚拟模型 ID。

## Requirement 2：真实模型选择与未配置阻断

**User Story：** 作为作者，我希望每个 AI 调用都明确知道使用哪个真实模型；如果我没有配置模型，系统不要替我猜，也不要偷偷 fallback。

### Acceptance Criteria

1. WHEN 会话没有 providerId 或 modelId THEN THE SYSTEM SHALL 返回 `model-unavailable`，并提示用户先选择真实模型。
2. WHEN 当前 provider 已禁用或模型已禁用 THEN THE SYSTEM SHALL 返回 `provider-unavailable` 或 `model-unavailable`，不自动切换其他模型。
3. WHEN 当前模型不支持工具调用而会话请求包含 tools THEN THE SYSTEM SHALL 返回 `unsupported-tools`，并提示切换支持工具调用的真实模型。
4. WHEN 用户手动选择模型 THEN THE SYSTEM SHALL 将真实 providerId + modelId 存入 sessionConfig。
5. WHEN 子代理、摘要或后续写作任务需要单独模型偏好 THEN THE SYSTEM SHALL 复用现有 modelDefaults / subagentModelPool 风格，以真实模型引用表达。

## Requirement 3：Provider Runtime Control Plane 表达真实运行资源

**User Story：** 作为维护者，我希望 Provider 页面不是单纯表单，而是能观察真实供应商、真实模型、平台账号、能力标签、测试状态和运行策略。

### Acceptance Criteria

1. WHEN 用户进入 Provider 设置 THEN THE SYSTEM SHALL 展示平台集成、密钥供应商、模型库存、运行策略四类信息。
2. WHEN 模型库存展示 THEN THE SYSTEM SHALL 按真实供应商分组，显示模型名、上下文窗口、输出上限、工具调用、流式、视觉、测试状态等能力。
3. WHEN 运行策略展示 THEN THE SYSTEM SHALL 使用“显式模型选择、能力校验、权限模式、工具支持状态、请求调试”口径，不展示配额路由或失败回退。
4. WHEN provider adapter 不支持某能力 THEN THE SYSTEM SHALL 返回真实 unsupported 错误，不显示已接入。
5. WHEN provider summary 生成 THEN THE SYSTEM SHALL 不读取 virtualModels，也不把空 virtual model 计入异常项。

## Requirement 4：抽取通用 Agent Turn Runtime

**User Story：** 作为维护者，我希望 WebSocket 会话、headless exec 和未来子代理都复用同一套 turn runtime，而不是把工具循环逻辑写死在 session-chat-service 里。

### Acceptance Criteria

1. WHEN 用户发送一条会话消息 THEN THE SYSTEM SHALL 通过通用 `agent-turn-runtime` 执行本轮 turn。
2. WHEN headless exec 发起任务 THEN THE SYSTEM SHALL 复用同一个 turn runtime。
3. WHEN turn runtime 执行时 THEN THE SYSTEM SHALL 只依赖抽象输入：messages、systemPrompt、context、tools、generate、executeTool、permissionMode、canvasContext。
4. WHEN turn 产生事件 THEN THE SYSTEM SHALL 输出结构化事件：assistant_message、tool_call、tool_result、confirmation_required、turn_completed、turn_failed。
5. WHEN session-chat-service 使用 turn runtime THEN THE SYSTEM SHALL 只负责 WebSocket、消息持久化、recovery、UI envelope 和状态广播。
6. WHEN turn runtime 遇到工具失败、确认门或循环上限 THEN THE SYSTEM SHALL 停止当前 turn 并返回可持久化的失败/待确认事件。

## Requirement 5：建立 provider-agnostic 工具消息协议

**User Story：** 作为维护者，我希望 OpenAI-compatible、Anthropic-compatible、Responses API、Codex/Kiro 平台账号都能接同一套工具循环，而不是每个模型特殊处理。

### Acceptance Criteria

1. WHEN runtime 构建模型上下文 THEN THE SYSTEM SHALL 使用内部 canonical turn item 表达 message、tool_call、tool_result。
2. WHEN OpenAI-compatible adapter 发送工具调用上下文 THEN THE SYSTEM SHALL 转换为 assistant tool_calls 与 tool role message。
3. WHEN Anthropic-compatible adapter 后续接入 THEN THE SYSTEM SHALL 可转换为 tool_use / tool_result content block。
4. WHEN Responses API 后续接入 THEN THE SYSTEM SHALL 可转换为 function_call / function_call_output。
5. WHEN provider 返回 tool call THEN THE SYSTEM SHALL 还原 NovelFork 内部点号工具名，例如 `cockpit.get_snapshot`。
6. WHEN tool_result 回灌给模型 THEN THE SYSTEM SHALL 包含摘要、结构化数据引用和“基于结果继续下一步”的上下文，而不只是一条普通 assistant 文本。

## Requirement 6：有界工具循环与重复调用保护

**User Story：** 作为作者，我希望 Agent 调用工具后能总结并进入下一步，不要重复调用同一个读取工具直到 loop limit。

### Acceptance Criteria

1. WHEN 同一 turn 内连续出现相同 toolName + input 的重复调用 THEN THE SYSTEM SHALL 在达到重复阈值前拦截，并向模型返回已读取过该结果的 tool_result。
2. WHEN 工具执行成功 THEN THE SYSTEM SHALL 追加明确的 tool_result continuation 指令：总结已获信息、判断是否足够、足够则进入下一步、不要重复读取同一资源。
3. WHEN 工具循环达到全局上限 THEN THE SYSTEM SHALL 产生 turn_failed 事件，记录 maxSteps 和最近工具调用摘要。
4. WHEN 工具结果需要用户确认 THEN THE SYSTEM SHALL 停止模型继续调用，等待用户决策。
5. WHEN 用户批准或拒绝确认 THEN THE SYSTEM SHALL 将决策作为 tool_result 回灌同一 turn continuation 或下一轮 turn。

## Requirement 7：会话中心成为一等对象

**User Story：** 作为作者，我希望像 NarraFork narrator 列表页一样管理长期会话，区分独立会话和绑定章节/书籍的会话，并看到模型和权限状态。

### Acceptance Criteria

1. WHEN 用户打开会话中心 THEN THE SYSTEM SHALL 展示独立会话、绑定书籍会话、绑定章节会话的筛选。
2. WHEN 会话列表展示 THEN THE SYSTEM SHALL 按最近活跃排序，并显示标题、agent、书籍/章节绑定、模型、权限、状态、未处理确认项、最近失败。
3. WHEN 用户归档会话 THEN THE SYSTEM SHALL 将 status 置为 archived，不删除历史。
4. WHEN 用户恢复会话 THEN THE SYSTEM SHALL 复用现有 session recovery 与 chat history。
5. WHEN 工作台右侧叙述者打开 THEN THE SYSTEM SHALL 能从会话中心定位并切换会话。

## Requirement 8：高级工作台模式隔离危险工具

**User Story：** 作为普通作者，我不希望默认看到 Terminal、Browser、Bash、MCP、Admin 这些程序员工具；作为高级用户，我又希望能主动开启它们。

### Acceptance Criteria

1. WHEN preferences.workbenchMode 为 false THEN THE SYSTEM SHALL 默认隐藏 Terminal、Browser、Bash、MCP、Admin、原始工具调用日志和高风险工程工具入口。
2. WHEN preferences.workbenchMode 为 true THEN THE SYSTEM SHALL 显示高级工作台入口，并继续受权限模式与确认门约束。
3. WHEN 普通作者模式下模型尝试调用高级工具 THEN THE SYSTEM SHALL 返回 permission-denied 或 tool-unavailable。
4. WHEN 高级工具被启用 THEN THE SYSTEM SHALL 在工具卡和确认门中明确显示风险、目标和可回滚性。

## Requirement 9：Headless 写作命令复用 Web Agent Runtime

**User Story：** 作为高级用户，我希望通过 `novelfork exec` 非交互运行写作任务，结果进入候选区或待确认队列，而不是覆盖正式章节。

### Acceptance Criteria

1. WHEN 用户运行 `novelfork exec "为当前书生成下一章候选稿"` THEN THE SYSTEM SHALL 创建或复用 headless session，并调用通用 turn runtime。
2. WHEN headless exec 生成候选稿 THEN THE SYSTEM SHALL 写入候选区，不覆盖正式章节。
3. WHEN headless exec 遇到确认门 THEN THE SYSTEM SHALL 输出 pending confirmation 信息并停止，不自动批准。
4. WHEN headless exec 完成 THEN THE SYSTEM SHALL 输出最终消息、产物 ID、会话 ID 和退出码。
5. WHEN headless exec 失败 THEN THE SYSTEM SHALL 输出失败原因和最近工具链摘要，退出非零码。
6. WHEN 用户传入 stdin 或文件上下文 THEN THE SYSTEM SHALL 将其作为用户输入上下文附加到本轮 turn。

## Requirement 10：权限与确认门产品化一致

**User Story：** 作为作者，我希望所有会影响作品状态的工具都有一致确认/审计 UI，而不是只有 guided.exit 特殊处理。

### Acceptance Criteria

1. WHEN `guided.exit` 提交计划 THEN THE SYSTEM SHALL 继续进入确认门。
2. WHEN `candidate.create_chapter` 准备创建候选稿 THEN THE SYSTEM SHALL 按 draft-write 记录审计信息；若会影响正式章节则必须升级为 confirmed-write。
3. WHEN `narrative.propose_change` 生成变更草案 THEN THE SYSTEM SHALL 展示 mutation preview，不直接写入正式叙事线。
4. WHEN `questionnaire.submit_response` 准备写入经纬/Bible THEN THE SYSTEM SHALL 展示 mapping preview、目标资源和风险，并等待确认。
5. WHEN 用户批准确认 THEN THE SYSTEM SHALL 记录 confirmationId、sessionId、toolName、目标资源、摘要、批准时间和决策。
6. WHEN 用户拒绝确认 THEN THE SYSTEM SHALL 不执行写入，并把拒绝原因作为 tool_result 返回模型。

## Requirement 11：主动文档与测试同步

**User Story：** 作为维护者，我希望架构口径、能力矩阵、测试和 CHANGELOG 与实际 runtime 方向一致。

### Acceptance Criteria

1. WHEN 删除虚拟模型功能 THEN THE SYSTEM SHALL 更新能力矩阵、spec 索引和 CHANGELOG Unreleased。
2. WHEN 新增 agent-turn-runtime、headless exec 或会话中心 THEN THE SYSTEM SHALL 更新相关 README/docs 中的运行方式、能力状态和限制。
3. WHEN 测试数量或构建命令变化 THEN THE SYSTEM SHALL 同步项目状态文档。
4. WHEN 功能未实现 THEN THE SYSTEM SHALL 标记为本 spec 待办或 unsupported，不写成已完成。

## Non-goals

1. 不实现 VirtualModel、VirtualModelRegistry、自动 fallback、自动模型路由或硬编码任务模型。
2. 不围绕 DeepSeek 或任何单一 provider 做架构主线；单 provider 问题只作为 adapter 兼容测试。
3. 不复制 Codex 或 Claude Code 专有实现；只学习公开边界和交互范式。
4. 不在本 spec 中实现多人协作、模板市场、外部发布平台同步或读者数据分析。
5. 不让 AI 直接覆盖正式章节正文；正式修改继续走候选区或确认门。
6. 不恢复旧前端，不新增 shim/noop adapter 来维持废弃路径。
