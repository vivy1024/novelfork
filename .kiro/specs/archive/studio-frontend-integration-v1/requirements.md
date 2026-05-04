# Studio Frontend Integration v1 Requirements

## Introduction

将 NovelFork Studio 的前端骨架组件接入真实数据，完成从旧 WorkspacePage 单体到新 IDE 三面板布局的拆解迁移。

**当前状态**：后端功能全部就绪（1118 个测试通过），前端新组件（SplitView/Sidebar/EditorArea/ConversationPanel/ChatFlow/GitChangesView）已创建但只是骨架，未接入真实数据。旧的 WorkspacePage（2040 行）被整个嵌入中间面板导致布局崩溃。

**目标**：拆解 WorkspacePage 和 ChatWindow，将数据逻辑分发到三个独立面板，对标 Claude Code CLI 的 REPL.tsx 数据流模式和 Codex CLI 的 chatwidget 架构。

**核心参考源码**：
- Claude Code CLI：`D:\DESKTOP\novelfork\claude\restored-cli-src\src\screens\REPL.tsx`（数据流）、`src\query.ts`（工具循环）、`src\components\Messages.tsx`（消息渲染）、`src\components\PromptInput\`（输入区）、`src\components\FullscreenLayout.tsx`（面板管理）
- Codex CLI：`codex-rs/tui/src/chatwidget/`（消息历史）、`exec_cell/`（工具调用渲染）、`bottom_pane/approval_overlay.rs`（审批交互）

---

## Requirement 1：拆解 WorkspacePage 为三面板数据源

**User Story：** 作为开发者，我希望 StudioNextApp 作为数据中心，将书籍/章节/会话数据分发给 Sidebar、EditorArea、ConversationPanel 三个独立面板，而不是把 WorkspacePage 整个嵌入。

### Acceptance Criteria

1. WHEN StudioNextApp 加载 THEN THE SYSTEM SHALL 从 `/books`、`/books/:id`、`/sessions`、`/providers/models` 获取数据，通过 props 或 context 分发给三个面板。
2. WHEN 用户在 Sidebar 叙事线点击书籍 THEN THE SYSTEM SHALL 加载该书的章节/候选稿/草稿/经纬/故事文件，构建完整资源树（复用 `buildStudioResourceTree`）。
3. WHEN 用户在 Sidebar 叙事线点击章节节点 THEN THE SYSTEM SHALL 在 EditorArea 打开对应 tab。
4. WHEN 用户在 Sidebar 叙述者点击会话 THEN THE SYSTEM SHALL 在 ConversationPanel 打开该会话的对话流。
5. WHEN 数据加载中 THEN THE SYSTEM SHALL 在对应面板显示加载状态，不阻塞其他面板。

---

## Requirement 2：Sidebar 接入完整资源树

**User Story：** 作为作者，我希望 Sidebar 的叙事线不只是书籍列表，而是像旧 WorkspacePage 一样有完整的资源树（章节/候选稿/草稿/经纬/大纲/故事文件/真相文件）。

### Acceptance Criteria

1. WHEN 用户展开叙事线中的书籍 THEN THE SYSTEM SHALL 显示完整资源树，包含已有章节、生成章节（候选稿）、草稿、大纲、经纬/资料库、故事文件、真相文件、素材、发布报告。
2. WHEN 资源树节点有空状态 THEN THE SYSTEM SHALL 显示空状态提示和操作按钮（创建章节/生成下一章/导入章节等），复用旧 WorkspacePage 的 `StudioResourceEmptyState`。
3. WHEN 章节/候选稿/经纬内容变更 THEN THE SYSTEM SHALL 自动刷新资源树。

---

## Requirement 3：EditorArea 接入真实编辑器

**User Story：** 作为作者，我希望中间 EditorArea 能打开和编辑章节正文、候选稿、经纬资料、大纲，而不是空白占位。

### Acceptance Criteria

1. WHEN 用户从资源树点击章节 THEN THE SYSTEM SHALL 在 EditorArea 打开 InkEditor 富文本编辑器，加载章节正文，支持编辑和保存。
2. WHEN 用户从资源树点击候选稿 THEN THE SYSTEM SHALL 在 EditorArea 打开候选稿预览，支持合并/替换/另存为草稿/放弃。
3. WHEN 用户从资源树点击经纬条目 THEN THE SYSTEM SHALL 在 EditorArea 打开经纬详情编辑。
4. WHEN 用户从资源树点击大纲 THEN THE SYSTEM SHALL 在 EditorArea 打开 Markdown 大纲编辑器。
5. WHEN tab 有未保存修改 THEN THE SYSTEM SHALL 显示 dirty 标记，切换/关闭时弹出保存确认对话框。
6. WHEN 对话框中的工具卡片点击"在画布打开" THEN THE SYSTEM SHALL 在 EditorArea 新开 tab 展示。

---

## Requirement 4：ConversationPanel 接入 ChatWindow 对话逻辑

**User Story：** 作为作者，我希望右侧对话框有完整的对话功能——WebSocket 连接、消息收发、工具调用渲染、确认门、模型/权限选择、上下文监控，对标 Claude Code CLI 的 REPL + PromptInput。

### Acceptance Criteria

#### WebSocket 与会话管理（对标 Claude Code REPL.tsx 的 onQuery 数据流）
1. WHEN 用户打开会话 THEN THE SYSTEM SHALL 建立 WebSocket 连接，加载会话快照和历史消息。
2. WHEN WebSocket 断开 THEN THE SYSTEM SHALL 自动重连（指数退避），显示连接状态指示器。
3. WHEN 会话恢复 THEN THE SYSTEM SHALL 执行快照恢复 → 增量回放 → 全量重置三级降级。

#### 消息渲染（对标 Claude Code Messages.tsx 的渲染模式）
4. WHEN 对话流显示消息 THEN THE SYSTEM SHALL 区分用户消息、AI 回复、工具调用卡片、工具结果卡片、确认门，全部内联展示。
5. WHEN 工具调用完成 THEN THE SYSTEM SHALL 支持折叠/展开工具结果详情（对标 Claude Code 的 `expandKey` 联动展开）。
6. WHEN 连续多个读取/搜索工具调用 THEN THE SYSTEM SHALL 折叠为一行摘要（对标 Claude Code 的 `CollapsedReadSearchContent`）。
7. WHEN 消息列表很长 THEN THE SYSTEM SHALL 使用虚拟滚动优化性能（对标 Claude Code 的 `VirtualMessageList`）。
8. WHEN 已完成的消息 THEN THE SYSTEM SHALL 冻结渲染避免重复 diff（对标 Claude Code 的 `OffscreenFreeze` + 自定义 memo comparator）。

#### 流式输出（对标 Claude Code 的 streaming + Codex 的 streaming/）
9. WHEN AI 生成回复 THEN THE SYSTEM SHALL 逐 token 流式渲染，显示打字光标动画。
10. WHEN 用户按 Escape THEN THE SYSTEM SHALL 中断流式输出（对标 Claude Code 的 AbortController + Codex 的 interrupt）。

#### 权限确认（对标 Claude Code 的 PermissionRequest overlay + Codex 的 approval_overlay）
11. WHEN 工具调用需要确认 THEN THE SYSTEM SHALL 在对话流内联显示确认门（不是弹窗），用户可以滚动查看历史。
12. WHEN 用户批准/拒绝确认 THEN THE SYSTEM SHALL 将决策回传给 agent 循环继续执行。

#### 输入区（对标 Claude Code 的 PromptInput）
13. WHEN 用户查看输入区 THEN THE SYSTEM SHALL 显示上下文监控（token 百分比 + 点击展开详情）、模型选择器、权限模式、推理强度、输入框、发送/中断按钮。
14. WHEN AI 正在生成 THEN THE SYSTEM SHALL 禁用输入框，显示红色中断按钮。
15. WHEN 用户发送消息 THEN THE SYSTEM SHALL 清空输入框，创建 AbortController，等待回复。

#### 上下文监控（对标 Claude Code 的 tokenCountWithEstimation + autoCompact）
16. WHEN 上下文使用率超过阈值 THEN THE SYSTEM SHALL 自动触发 MicroCompact，并在 UI 显示压缩提示。
17. WHEN 用户点击"立即压缩" THEN THE SYSTEM SHALL 手动触发 Full Compact。
18. WHEN 用户点击"清空上下文" THEN THE SYSTEM SHALL 清空当前会话消息。

---

## Requirement 5：Canvas Context 双向传递

**User Story：** 作为作者，我希望对话框中的 AI 能感知我当前正在编辑的章节、选中的文本、打开的 tab，对标 Claude Code 的 context 注入。

### Acceptance Criteria

1. WHEN 用户在 EditorArea 编辑章节 THEN THE SYSTEM SHALL 将当前 activeResource、dirty 状态、selection 传递给 ConversationPanel 作为 canvasContext。
2. WHEN AI 工具调用产生 artifact THEN THE SYSTEM SHALL 在 EditorArea 打开对应 tab（驾驶舱快照、候选稿等）。
3. WHEN canvasContext.dirty=true THEN THE SYSTEM SHALL 阻止非 read 工具执行。

---

## Requirement 6：AI 面板与写作工具集成

**User Story：** 作为作者，我希望 AI 写作功能（生成下一章/续写/审校/改写/去AI味/连续性检查）和写作工具（节奏分析/对话分析/钩子生成等）在新布局中可用。

### Acceptance Criteria

1. WHEN 用户在 EditorArea 编辑章节 THEN THE SYSTEM SHALL 在编辑器下方或工具栏显示 AI 动作按钮（生成下一章/续写/审校/改写/去AI味/连续性检查）。
2. WHEN 用户点击 AI 动作 THEN THE SYSTEM SHALL 检查模型可用性（ModelGate），然后在 ConversationPanel 中执行。
3. WHEN 用户展开写作工具面板 THEN THE SYSTEM SHALL 显示节奏分析、对话分析、钩子生成、日更进度等工具。
4. WHEN 用户展开写作模式面板 THEN THE SYSTEM SHALL 显示续写/扩写/对话生成/多版本对比/大纲分支。

---

## Requirement 7：设置/套路/其他页面在中间面板渲染

**User Story：** 作为用户，我希望点击 Sidebar 的套路/设置按钮后，中间面板切换为对应页面，右侧对话框保持不变。

### Acceptance Criteria

1. WHEN 用户点击套路 THEN THE SYSTEM SHALL 在中间面板渲染 RoutinesNextPage，右侧对话框不变。
2. WHEN 用户点击设置 THEN THE SYSTEM SHALL 在中间面板渲染 SettingsPage，右侧对话框不变。
3. WHEN 用户从设置/套路返回工作台 THEN THE SYSTEM SHALL 恢复之前的 EditorArea tab 状态。

---

## Non-goals

1. 不重写 ChatWindow 的 WebSocket/恢复逻辑——复用现有实现，只改容器。
2. 不重写 WorkspacePage 的编辑器组件——复用 ChapterEditor/CandidateEditor 等，只改数据传递方式。
3. 不实现 Claude Code 的 React Compiler 优化——先保证功能正确。
4. 不实现 Codex 的 app-server 协议——保持现有 WebSocket 协议。
