# Frontend Live Wiring v1 Requirements

## Introduction

本 spec 接在 `frontend-refoundation-v1` 之后执行。前一阶段已经建立 Agent Shell、Conversation surface/runtime helper、Backend Contract clients、Writing Workbench 组件和 Tool Result Renderer Registry；本阶段目标是把这些资产真正接到 `/next` live route 上，消除“组件已存在但顶层仍传空数据或 noop 回调”的断层。

本 spec 不新增后端能力，不恢复旧三栏 WorkspacePage，不新增 mock/fake/noop shim。所有数据必须来自 `backend-contract-v1` 已登记的 route、WebSocket、session tool 或 domain client；缺能力必须显示 disabled/unsupported。

---

## Requirement 1：Narrator Route 必须接入真实 Conversation Runtime

**User Story：** 作为作者，我点击左侧叙述者会话后，应看到该会话的真实历史、流式回复、工具调用和恢复状态，而不是静态壳层。

### Acceptance Criteria

1. WHEN 用户打开 `/next/narrators/:sessionId` THEN THE SYSTEM SHALL 通过 `useAgentConversationRuntime` hydrate `GET /api/sessions/:id/chat/state`。
2. WHEN runtime 建立连接 THEN THE SYSTEM SHALL 使用 `WS /api/sessions/:id/chat?resumeFromSeq=` 并处理 snapshot/state/message/stream/error envelope。
3. WHEN 用户发送消息 THEN THE SYSTEM SHALL 发送 `session:message` client envelope，包含 sessionId、messageId、content、ack 和可用的 canvasContext。
4. WHEN 用户点击中断 THEN THE SYSTEM SHALL 发送 `session:abort`，并在 UI 上结束 running 状态。
5. WHEN 发生 WebSocket 断线、history gap 或 snapshot 失败 THEN THE SYSTEM SHALL 显示轻量 recovery/error notice，不伪造成功消息。
6. WHEN route session 不存在 THEN THE SYSTEM SHALL 显示 404/缺失会话状态，并提供返回会话列表或新建会话入口。

---

## Requirement 2：状态栏必须接入真实模型、权限与推理配置

**User Story：** 作为作者，我需要在对话底部看到当前 provider/model、权限模式、推理强度和 token 使用，并能直接切换配置。

### Acceptance Criteria

1. WHEN ConversationStatusBar 渲染 THEN THE SYSTEM SHALL 从 provider contract 加载真实模型池，不硬编码模型列表。
2. WHEN 模型池为空 THEN THE SYSTEM SHALL 禁用发送，并提示用户前往设置配置 provider/model。
3. WHEN 用户切换模型、权限模式或推理强度 THEN THE SYSTEM SHALL 通过 session client 更新该 session 的 `sessionConfig`。
4. WHEN session config 更新失败 THEN THE SYSTEM SHALL 在状态栏显示真实错误，不回滚成假成功。
5. WHEN 选中模型不支持工具调用 THEN THE SYSTEM SHALL 显示 unsupported-tools 降级说明，并阻止需要工具链的写入动作。
6. WHEN usage/cumulativeUsage 存在 THEN THE SYSTEM SHALL 显示 token 统计；缺失时不展示虚构数字。

---

## Requirement 3：Tool Result Renderer 必须接入消息流

**User Story：** 作为作者，我希望工具结果以写作语义卡片呈现，例如候选稿、PGI 问题、叙事线变化，而不是只显示一段通用 JSON。

### Acceptance Criteria

1. WHEN assistant message 包含 toolCalls 或 toolResult metadata THEN THE SYSTEM SHALL 优先通过 `app-next/tool-results/registry.tsx` 选择 renderer。
2. WHEN renderer 是 cockpit/questionnaire/pgi/guided/candidate/narrative THEN THE SYSTEM SHALL 使用对应专用卡片。
3. WHEN renderer 未知 THEN THE SYSTEM SHALL 使用 generic renderer，保留 raw data 和错误摘要。
4. WHEN tool result 包含 artifact 可打开到画布 THEN THE SYSTEM SHALL 提供“打开到工作台”动作，且动作必须通过当前 Workbench canvas/resource contract 执行。
5. WHEN 工具需要确认 THEN THE SYSTEM SHALL 在消息流中内联 ConfirmationGate，批准/拒绝后刷新 snapshot。

---

## Requirement 4：Book Route 必须接入真实 Writing Workbench 数据

**User Story：** 作为作者，我点击一本书后，应看到真实章节、候选稿、草稿、经纬、story/truth 和叙事线资源，并能打开、编辑或只读查看。

### Acceptance Criteria

1. WHEN 用户打开 `/next/books/:bookId` THEN THE SYSTEM SHALL 调用 `loadWorkbenchResourcesFromContract()` 加载资源树。
2. WHEN 资源加载中 THEN THE SYSTEM SHALL 显示加载状态；失败时显示真实错误。
3. WHEN 用户点击资源节点 THEN THE SYSTEM SHALL 在 WorkbenchCanvas 中打开该资源。
4. WHEN 资源 capability 为 edit THEN THE SYSTEM SHALL 使用合同声明的保存入口保存内容。
5. WHEN 资源 capability 为 readonly 或 unsupported THEN THE SYSTEM SHALL 禁用保存，并显示只读/unsupported 原因。
6. WHEN 内容修改 THEN THE SYSTEM SHALL 维护 dirty 状态，并输出可传入会话的 canvasContext。

---

## Requirement 5：Workbench Writing Actions 必须接入真实会话跳转

**User Story：** 作为作者，我在工作台点击“生成下一章/审校/去 AI 味”等动作时，应进入绑定本书的叙述者会话，由 session tools 和确认门完成写作闭环。

### Acceptance Criteria

1. WHEN 用户点击写作动作 THEN THE SYSTEM SHALL 根据 `writing-action-adapter` 判断 action 是否 enabled、preview-only、unsupported 或需要 session-native 工具链。
2. WHEN book 已有 active writer session THEN THE SYSTEM SHALL 复用该 session。
3. WHEN book 没有 active writer session THEN THE SYSTEM SHALL 创建绑定 bookId 的 writer session。
4. WHEN session 创建或复用成功 THEN THE SYSTEM SHALL 导航到 `/next/narrators/:sessionId`。
5. WHEN 当前画布存在 active resource、selection 或 dirty 状态 THEN THE SYSTEM SHALL 将 canvasContext 带入下一条用户消息或 action envelope。
6. WHEN action unsupported THEN THE SYSTEM SHALL 禁用按钮并显示 disabledReason，不触发假成功。

---

## Requirement 6：Shell 次级页面不能停留在“稍后接线”占位

**User Story：** 作为用户，我点击搜索、套路、设置时，应看到当前已有的真实页面或明确的 unsupported/planned 状态，而不是永久占位文案。

### Acceptance Criteria

1. WHEN 用户打开 `/next/search` THEN THE SYSTEM SHALL 接入真实 search 页面或显示基于合同状态的 unsupported 说明。
2. WHEN 用户打开 `/next/routines` THEN THE SYSTEM SHALL 接入现有 routines/MCP/skills 管理页面，不新增旧前端依赖。
3. WHEN 用户打开 `/next/settings` THEN THE SYSTEM SHALL 接入现有 provider/runtime/settings 面板，模型配置必须可达。
4. WHEN 页面仍缺真实数据源 THEN THE SYSTEM SHALL 使用 capability disabled/unsupported 语义，不写“稍后接线”作为当前事实。

---

## Requirement 7：验证与不回归

**User Story：** 作为维护者，我需要用自动化和冒烟证明新壳已经 live 接线，而不是仅有组件测试。

### Acceptance Criteria

1. WHEN 本 spec 完成 THEN THE SYSTEM SHALL 通过 Studio typecheck。
2. WHEN Conversation 测试运行 THEN THE SYSTEM SHALL 覆盖 snapshot hydrate、WebSocket message/stream/error、send、abort、ack、config update、工具确认。
3. WHEN Workbench 测试运行 THEN THE SYSTEM SHALL 覆盖资源树加载、打开、保存、只读、unsupported、dirty canvasContext、写作动作跳转。
4. WHEN Shell route 测试运行 THEN THE SYSTEM SHALL 覆盖 `/next`、`/next/narrators/:id`、`/next/books/:id`、search、routines、settings。
5. WHEN 文档更新 THEN THE SYSTEM SHALL 同步 `.kiro/specs/README.md`、CHANGELOG 和受影响的 Studio 文档。

---

## Non-goals

1. 不新增 Claude Code parity 的 slash commands、headless stream-json、checkpoint/rewind；这些属于 `conversation-parity-v1`。
2. 不删除旧源码；删除属于 `legacy-source-retirement-v1`。
3. 不新增后端能力；缺能力保持 transparent unsupported。
4. 不恢复 `WorkspacePage`、`ChatWindow` 或旧三栏布局作为 live route。