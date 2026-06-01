# Frontend Refoundation v1 Requirements

## Introduction

本 spec 取代继续修补 `novelfork-ui-v1` 的方向。NovelFork Studio 前端不再围绕失败的三栏 IDE 布局继续打补丁，而是基于 Backend Contract v1 重建一个 Agent Shell + Writing Workbench 的前端底座：左侧一级导航、中央工作区、底部/右侧轻量状态，主交互以叙述者对话和工具结果为核心。

可借鉴 Claude Code CLI / OpenAI Codex CLI 这类 agent shell 的公开交互范式：消息流、工具调用、确认门、权限状态、上下文状态、可中断执行。但不得复制未授权源码；所有数据和行为必须来自 NovelFork 自己的真实后端合同。

---

## Requirement 1：前端以 Backend Contract 为唯一数据源

**User Story：** 作为维护者，我希望新前端所有页面和按钮都来自已登记后端合同，避免再次出现看起来可用但没有真实能力的 UI。

### Acceptance Criteria

1. WHEN 新前端读取后端数据 THEN THE SYSTEM SHALL 通过 Backend Contract client，而不是组件内散写 fetch 字符串。
2. WHEN UI 渲染能力入口 THEN THE SYSTEM SHALL 根据合同状态决定 enabled、disabled、readonly、preview-only 或 unsupported。
3. WHEN 能力未登记在 backend-contract-v1 THEN THE SYSTEM SHALL 不渲染为可点击按钮。
4. WHEN 后端返回 `prompt-preview`、`process-memory`、`chunked-buffer`、`unknown` 或 `unsupported` THEN THE SYSTEM SHALL 保留并展示对应语义。
5. WHEN contract client 失败 THEN THE SYSTEM SHALL 显示真实错误或空状态，不填充 mock 数据。

---

## Requirement 2：Agent Shell 应用壳

**User Story：** 作为作者，我打开 Studio 后首先看到的是稳定的 Agent Shell：左侧导航，中央当前任务/资源/会话，输入区和状态区不被复杂面板淹没。

### Acceptance Criteria

1. WHEN 用户打开 `/next` THEN THE SYSTEM SHALL 显示左侧固定 sidebar 与右侧主区域，不再默认嵌套旧三栏 WorkspacePage。
2. WHEN sidebar 渲染 THEN THE SYSTEM SHALL 包含叙事线、叙述者、搜索、套路、设置和版本信息，且内容来自合同 client。
3. WHEN 用户点击叙述者会话 THEN THE SYSTEM SHALL 导航到 `/next/narrators/:sessionId` 并打开 Agent conversation。
4. WHEN 用户点击叙事线书籍 THEN THE SYSTEM SHALL 导航到 `/next/books/:bookId` 并打开 Writing Workbench。
5. WHEN 用户点击设置/套路/搜索 THEN THE SYSTEM SHALL 在同一 shell 内切换页面。
6. WHEN 页面切换 THEN THE SYSTEM SHALL 使用 URL 同步，支持浏览器前进/后退。

---

## Requirement 3：单栏 Agent Conversation

**User Story：** 作为用户，我希望主对话页像成熟 agent CLI 一样简洁：消息流是主角，工具调用和确认门内联，底部输入区持续可见。

### Acceptance Criteria

1. WHEN Conversation 页面显示 THEN THE SYSTEM SHALL 使用 flex-column：会话标题栏、消息流、状态栏、输入栏。
2. WHEN 没有选中会话 THEN THE SYSTEM SHALL 显示简洁空状态，并提供新建会话入口。
3. WHEN WebSocket snapshot 到达 THEN THE SYSTEM SHALL hydrate 消息、session config、cursor 和 recovery 状态。
4. WHEN `session:stream` 到达 THEN THE SYSTEM SHALL 在当前 assistant 消息中流式显示增量内容。
5. WHEN `session:message` 包含 toolCalls/metadata THEN THE SYSTEM SHALL 内联渲染工具调用卡片、工具结果卡片和 artifact 入口。
6. WHEN pending confirmation 存在 THEN THE SYSTEM SHALL 内联显示批准/拒绝确认门，不使用阻塞式全屏弹窗。
7. WHEN 用户发送消息 THEN THE SYSTEM SHALL 附带当前 canvasContext、ack 和可恢复 messageId。
8. WHEN 用户中断 THEN THE SYSTEM SHALL 发送 `session:abort` 并反映真实状态。
9. WHEN 连接断开、replay 或 history gap THEN THE SYSTEM SHALL 使用轻量 recovery notice，而不是大面积控制面板。

---

## Requirement 4：Writing Workbench 资源工作区

**User Story：** 作为作者，我点击一本书后进入以真实资源为中心的写作工作区，可以打开章节、候选稿、草稿、经纬、文件和叙事线，而不是把资源树塞进主对话框。

### Acceptance Criteria

1. WHEN 用户打开 `/next/books/:bookId` THEN THE SYSTEM SHALL 显示该书的独立 Writing Workbench。
2. WHEN Workbench 加载 THEN THE SYSTEM SHALL 通过 resource contract adapter 组装资源树。
3. WHEN 用户点击章节、候选稿、草稿或文件 THEN THE SYSTEM SHALL 在中央 canvas 打开对应资源 viewer/editor。
4. WHEN 资源可编辑 THEN THE SYSTEM SHALL 使用合同声明的保存入口；资源只读或 unsupported 时禁用保存。
5. WHEN 资源有 dirty 状态 THEN THE SYSTEM SHALL 在 canvasContext 中传给叙述者，并阻断危险写入工具。
6. WHEN Agent 返回 artifact THEN THE SYSTEM SHALL 可在 Workbench canvas 打开对应候选稿、草稿、叙事线或工具结果。
7. WHEN 用户从 Workbench 发起写作动作 THEN THE SYSTEM SHALL 创建或复用绑定书籍的 session，并进入对应 conversation。

---

## Requirement 5：工具结果与 artifact 渲染系统

**User Story：** 作为作者，我希望工具调用不是一段不可读 JSON，而是可展开的结果卡、计划卡、候选稿卡、叙事线卡和确认门。

### Acceptance Criteria

1. WHEN tool result 包含 `renderer` THEN THE SYSTEM SHALL 使用 Tool Result Renderer Registry 渲染专用卡片。
2. WHEN tool result 包含 `artifact` THEN THE SYSTEM SHALL 提供“在画布打开”动作。
3. WHEN renderer 未知 THEN THE SYSTEM SHALL 使用 generic fallback，但保留原始 data/metadata。
4. WHEN 工具失败 THEN THE SYSTEM SHALL 默认展开错误摘要，显示 error/code。
5. WHEN 工具输出很长 THEN THE SYSTEM SHALL 默认折叠长输出，保留复制/展开能力。
6. WHEN confirmation request 存在 THEN THE SYSTEM SHALL 显示风险、目标资源、diff/summary 和 approve/reject。

---

## Requirement 6：模型、权限、上下文与状态控制

**User Story：** 作为用户，我需要能清楚看到当前模型、权限、推理强度、上下文和连接状态，但这些控制不能挤占消息流主空间。

### Acceptance Criteria

1. WHEN Conversation 页面显示 THEN THE SYSTEM SHALL 在底部状态栏显示 provider/model、permission mode、reasoning effort、token/usage、连接状态。
2. WHEN 用户切换模型或权限 THEN THE SYSTEM SHALL 调用 session update 合同，不直接改本地假状态。
3. WHEN 模型池为空 THEN THE SYSTEM SHALL 禁用发送并引导到设置页。
4. WHEN 模型不支持工具 THEN THE SYSTEM SHALL 显示 unsupported-tools 降级说明。
5. WHEN context/recovery 详情需要展示 THEN THE SYSTEM SHALL 使用 popover/drawer/折叠区，不常驻大卡片。

---

## Requirement 7：退役旧前端与巨型文件边界

**User Story：** 作为维护者，我不接受继续把旧 ChatWindow、WorkspacePage 或失败三栏实验作为新前端核心依赖。

### Acceptance Criteria

1. WHEN 新 Agent Shell 可用 THEN THE SYSTEM SHALL 从主路由移除旧 WorkspacePage 三栏默认入口。
2. WHEN 新 Conversation 可用 THEN THE SYSTEM SHALL 退役旧 ChatWindow 的堆叠控制视觉层，保留可提取的运行逻辑。
3. WHEN 旧模块仍有价值 THEN THE SYSTEM SHALL 重构成真实复用组件；无价值则从构建路径移除。
4. WHEN 新建前端文件 THEN THE SYSTEM SHALL 默认控制在 300 行以内，超过 400 行必须拆分。
5. WHEN 删除或迁移旧组件 THEN THE SYSTEM SHALL 更新测试、导入和文档，不新增 shim/noop adapter。

---

## Requirement 8：测试、视觉冒烟与文档同步

**User Story：** 作为用户，我希望前端重建后关键能力不回归：会话、工具调用、确认门、资源打开、候选稿生成和设置都能用。

### Acceptance Criteria

1. WHEN Agent Shell 完成 THEN THE SYSTEM SHALL 有路由、sidebar、conversation、status bar、input bar、tool card 和 confirmation gate 测试。
2. WHEN Writing Workbench 完成 THEN THE SYSTEM SHALL 有资源树、资源打开、dirty 状态、artifact 打开和写作动作测试。
3. WHEN Provider/模型控制完成 THEN THE SYSTEM SHALL 有模型池为空、切换模型、unsupported-tools 降级测试。
4. WHEN 旧前端退役 THEN THE SYSTEM SHALL 通过 typecheck，且无主路由引用废弃三栏组件。
5. WHEN 完成阶段验收 THEN THE SYSTEM SHALL 运行相关 Vitest、`pnpm --dir packages/studio typecheck` 和手动冒烟。
6. WHEN 用户可见行为或文档口径改变 THEN THE SYSTEM SHALL 更新 CHANGELOG、README 和相关 docs。

---

## Non-goals

1. 不复制 Claude Code 或任何非公开/未授权源码。
2. 不在本阶段新增真实后端能力；缺能力显示 unsupported 或进入 backend-core-refactor 阶段。
3. 不恢复 VS Code 风格三栏 IDE、SplitView/Sash 或资源树常驻主对话页。
4. 不把 prompt-preview 写成已生成正文。
5. 不为了让旧代码编译而新增 shim、noop adapter 或 fake provider。
6. 不在第一阶段重写全部富文本编辑器；先保留必要章节/候选稿/草稿/文件 viewer/editor。
