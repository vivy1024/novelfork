# NovelFork UI v1 Requirements

> **Superseded / 仅历史过渡参考**：本 spec 已被 `backend-contract-v1` 与 `frontend-refoundation-v1` 取代，不再作为当前实现主线或任务入口。后续前端重建必须先执行 Backend Contract，再按 Agent Shell + Writing Workbench 路线推进。

## Introduction

本 spec 退役失败的三栏 IDE 前端实验，重写 NovelFork Studio 的当前前端壳和对话视觉层。目标不是硬删后端或运行时能力，而是保留已经可用的后端 API、session/WebSocket、模型聚合、token 计数、压缩、流式输出、权限模式等能力，把前端改成 NarraFork 验证过的 sidebar + 全宽内容区，并让主对话页接近 Claude Code CLI / Codex CLI 的单栏交互。

失败根因已经明确：旧 `WorkspacePage` 自带资源管理器 + 编辑器 + 叙述者三栏，又被嵌进新的外层布局，导致嵌套三栏、主对话区过窄、控制卡片堆叠、资源树喧宾夺主。本 spec 的方向是“新壳重写”：主路由不再渲染旧 WorkspacePage；旧 ChatWindow 的 WebSocket/session/runtime 逻辑可保留或抽出，但视觉层重写。

---

## Requirement 1：应用壳 — NarraFork 风格 Sidebar + 全宽 Main

**User Story：** 作为作者，我打开 NovelFork Studio 后看到的是简单稳定的 NarraFork 风格界面：左侧固定 sidebar，右侧是当前页面的全宽内容区。

### Acceptance Criteria

1. WHEN 用户打开 `/next` THEN THE SYSTEM SHALL 显示左侧固定 250px sidebar 和右侧全宽 main 区域。
2. WHEN sidebar 显示 THEN THE SYSTEM SHALL 只包含一级导航信息：叙事线列表、叙述者会话列表、套路、设置、版本号。
3. WHEN main 区域显示 THEN THE SYSTEM SHALL 不再嵌套旧三栏 WorkspacePage 作为默认内容。
4. WHEN 用户点击套路或设置 THEN THE SYSTEM SHALL 在右侧 main 区域切换到对应页面，sidebar 保持不变。
5. WHEN 页面切换 THEN THE SYSTEM SHALL 使用 URL 同步路由，支持浏览器前进/后退。
6. WHEN 视口宽度变化 THEN THE SYSTEM SHALL 保持 sidebar 固定宽度，main 区域占据剩余宽度，不出现三栏挤压或文字竖排。

---

## Requirement 2：主对话页 — Claude Code / Codex CLI 风格单栏对话

**User Story：** 作为用户，我希望主界面就是可用的叙述者对话：上方是对话流，工具调用内联，下方是状态栏和输入框，而不是一堆配置卡片堆在对话前面。

### Acceptance Criteria

1. WHEN 用户打开 `/next` 或 `/next/narrators/:sessionId` THEN THE SYSTEM SHALL 在 main 区域显示全宽对话页。
2. WHEN 对话页显示 THEN THE SYSTEM SHALL 使用 flex-column：顶部会话栏、flex:1 对话流、底部状态栏、底部输入框。
3. WHEN 没有选中会话 THEN THE SYSTEM SHALL 显示简洁空状态，并提供新建叙述者会话入口。
4. WHEN 用户点击 sidebar 中的叙述者会话 THEN THE SYSTEM SHALL 打开该会话并高亮 sidebar 项。
5. WHEN AI 回复流式输出 THEN THE SYSTEM SHALL 在对话流中追加内容，并保持底部输入区固定可见。
6. WHEN 工具调用发生 THEN THE SYSTEM SHALL 在对应助手消息内联展示工具调用卡片，默认折叠长输出，失败和运行中状态清晰可见。
7. WHEN 工具需要确认 THEN THE SYSTEM SHALL 在对话流中内联展示确认门，不使用阻塞式大弹窗遮挡整个对话。
8. WHEN 模型、权限、推理强度、上下文/token 信息显示 THEN THE SYSTEM SHALL 放入底部状态栏或轻量折叠面板，不常驻占用对话流上方空间。
9. WHEN AI 正在生成或工具执行中 THEN THE SYSTEM SHALL 显示中断按钮；空闲时显示发送按钮。
10. WHEN WebSocket 断线、恢复或 replay THEN THE SYSTEM SHALL 使用轻量状态提示，不把恢复细节堆成大面积控制面板。

---

## Requirement 3：Chat runtime 复用与视觉层退役

**User Story：** 作为开发者，我希望保留已经验证过的 session/WebSocket/权限/模型运行逻辑，但废弃旧 ChatWindow 视觉层，避免重写后端功能。

### Acceptance Criteria

1. WHEN 重写对话页 THEN THE SYSTEM SHALL 保留现有 session API、WebSocket snapshot/replay、消息发送、模型选择、权限模式、推理强度、上下文统计等能力。
2. WHEN 实现新视觉层 THEN THE SYSTEM SHALL 将旧 ChatWindow 中的运行逻辑抽成 hook 或 headless controller，供新 ChatSurface 使用。
3. WHEN 新 ChatSurface 渲染 THEN THE SYSTEM SHALL 不包含旧的“当前会话控制”大卡片和“最近执行链”大卡片常驻区。
4. WHEN 用户需要查看上下文详情、执行链详情或恢复详情 THEN THE SYSTEM SHALL 通过按钮打开抽屉、popover 或折叠面板。
5. WHEN floating ChatWindow 仍被历史窗口系统引用 THEN THE SYSTEM SHALL 要么使用新 ChatSurface，要么从当前构建路径正式退役，不能新增假 shim 或空实现续命。

---

## Requirement 4：Sidebar 叙事线 — 只显示书列表，不塞资源树

**User Story：** 作为作者，我希望左侧叙事线像 NarraFork 的项目列表一样清爽：只列出作品，点击后进入独立写作工作台。

### Acceptance Criteria

1. WHEN sidebar 渲染叙事线 THEN THE SYSTEM SHALL 显示书名、状态或简短计数，不显示完整章节/经纬/素材资源树。
2. WHEN 用户点击书籍 THEN THE SYSTEM SHALL 导航到 `/next/books/:bookId`。
3. WHEN 没有书籍 THEN THE SYSTEM SHALL 显示简洁空状态和创建/导入入口。
4. WHEN 当前位于某本书的详情页 THEN THE SYSTEM SHALL 高亮对应书籍。
5. WHEN 书籍列表内容过多 THEN THE SYSTEM SHALL sidebar 内部滚动，不影响 main 对话区域。

---

## Requirement 5：叙事线详情页 — 独立写作工作台

**User Story：** 作为作者，我点击一本书后进入独立写作工作台，那里可以查看资源树、编辑章节和触发写作工具；它不是主对话框的子视图。

### Acceptance Criteria

1. WHEN 用户打开 `/next/books/:bookId` THEN THE SYSTEM SHALL 显示该书的叙事线详情页，sidebar 仍保持可见。
2. WHEN 叙事线详情页显示 THEN THE SYSTEM SHALL 使用独立页面布局：顶部书籍栏、资源管理器、编辑/查看区域、写作动作入口。
3. WHEN 资源管理器显示 THEN THE SYSTEM SHALL 展示章节、候选稿、草稿、大纲、经纬/资料库、故事文件、真相文件、素材和发布报告。
4. WHEN 用户点击资源节点 THEN THE SYSTEM SHALL 在编辑/查看区域打开对应资源。
5. WHEN 用户触发续写、扩写、审校、生成下一章、去 AI 味或连续性检查 THEN THE SYSTEM SHALL 创建或复用绑定该书的叙述者会话，并可跳转到 `/next/narrators/:sessionId` 查看对话。
6. WHEN 从旧 WorkspacePage 迁移功能 THEN THE SYSTEM SHALL 优先提取真实资源树和 canvas 能力，不再直接复用 2040 行旧页面作为整体布局。

---

## Requirement 6：前端退役与清理

**User Story：** 作为维护者，我希望删除失败实验留下的前端骨架，避免后续再次误用三栏 IDE 布局。

### Acceptance Criteria

1. WHEN 新壳可用 THEN THE SYSTEM SHALL 从主路由移除 ResourceWorkspaceLayout 三栏布局。
2. WHEN 新 ChatSurface 可用 THEN THE SYSTEM SHALL 退役旧 ChatWindow 视觉层中的堆叠控制区。
3. WHEN SplitView、EditorArea、ConversationPanel 或 useStudioData 属于失败三栏实验且无真实复用价值 THEN THE SYSTEM SHALL 删除或迁移为真实复用组件。
4. WHEN 删除旧组件 THEN THE SYSTEM SHALL 同步更新测试、导入和文档，不留下构建路径中的废弃兼容层。
5. WHEN 旧模块仍有价值 THEN THE SYSTEM SHALL 重构为当前边界下的真实组件，而不是新增 noop adapter、假 provider 或 shim。

---

## Requirement 7：验证与不回归

**User Story：** 作为用户，我希望前端重写后不丢后端能力：流式输出、工具调用、权限确认、token 统计、压缩、模型选择仍然可用。

### Acceptance Criteria

1. WHEN 前端重写完成 THEN THE SYSTEM SHALL 通过 TypeScript typecheck。
2. WHEN 对话页测试运行 THEN THE SYSTEM SHALL 覆盖会话打开、发送消息、工具调用内联、权限确认、底部状态栏、空状态。
3. WHEN sidebar 测试运行 THEN THE SYSTEM SHALL 覆盖叙事线点击、叙述者点击、设置/套路导航、URL 同步。
4. WHEN 叙事线详情测试运行 THEN THE SYSTEM SHALL 覆盖资源节点打开和写作动作跳转会话。
5. WHEN 手动冒烟 THEN THE SYSTEM SHALL 验证 `/next` 主对话、`/next/narrators/:sessionId`、`/next/books/:bookId`、设置、套路都能正常切换。
6. WHEN 变更影响用户可见行为 THEN THE SYSTEM SHALL 更新 CHANGELOG 和相关项目文档。

---

## Requirement 8：文件规模与模块边界

**User Story：** 作为维护者，我不接受再次写出 1000-2000 行的前端巨型文件；重写必须按职责拆小，任何大文件都要拆分或退役。

### Acceptance Criteria

1. WHEN 新建前端文件 THEN THE SYSTEM SHALL 默认控制在 300 行以内；超过 400 行必须拆分。
2. WHEN 迁移旧巨型文件逻辑 THEN THE SYSTEM SHALL 按 runtime、surface、message list、tool call、status bar、input bar、resource tree、resource viewer、writing actions 等职责拆分。
3. WHEN 某个文件需要超过 400 行 THEN THE SYSTEM SHALL 在同一任务内说明原因并优先拆成子模块，不得默认接受超大文件。
4. WHEN `ChatWindow.tsx` 被处理 THEN THE SYSTEM SHALL 不生成新的 `ChatWindow` 巨型替代文件，而是拆成 `chat-runtime` 与 `chat-surface` 系列小文件。
5. WHEN `WorkspacePage.tsx` 被处理 THEN THE SYSTEM SHALL 不生成新的 `StorylineWorkbench` 巨型替代文件，而是拆成 route、data hook、resource tree、resource viewer、writing actions、editor adapters 等小文件。
6. WHEN 测试文件增长过大 THEN THE SYSTEM SHALL 按模块拆分测试，避免单个测试文件复制旧巨型结构。

---

## Non-goals

1. 不做 VS Code 风格三栏 IDE 布局。
2. 不做可拖拽 SplitView / Sash / 多面板网格。
3. 不把叙事线资源树塞进主对话页。
4. 不硬删后端 API、session 存储、WebSocket、模型聚合、token 计数、压缩或流式输出能力。
5. 不为了兼容旧前端新增假 shim、空实现或 noop adapter。
6. 不在第一阶段实现复杂可视化编辑器重构；写作工作台先迁移必要资源树、编辑/查看和写作动作。
