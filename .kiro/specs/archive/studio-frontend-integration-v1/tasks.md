# Studio Frontend Integration v1 Tasks

## Overview

拆解 WorkspacePage 单体，将数据逻辑分发到 SplitView 三面板。复用现有组件，不重写。

## Tasks

- [ ] 1. 提升数据获取到 StudioNextApp
  - 将 WorkspacePage 的 `useApi("/books")`、`useApi("/books/:id")`、`useApi("/books/:id/candidates")`、`useApi("/books/:id/drafts")`、`useApi("/books/:id/story-files")`、`useApi("/books/:id/truth-files")` 提升到 StudioNextApp。
  - 新增 `useStudioData` hook 封装所有数据获取，返回 books、chapters、candidates、drafts、storyFiles、truthFiles、resourceNodes。
  - 内部调用 `buildStudioResourceTree()` 构建资源树。
  - 验证：数据正确加载、资源树正确构建。
  - 覆盖需求：R1。

- [ ] 2. Sidebar 接入完整资源树
  - 将 StorylineTree 改为接收 `resourceNodes`（完整资源树），而不只是 `books`（书籍列表）。
  - 复用 WorkspacePage 的 `ResourceTree` 组件渲染子节点。
  - 点击节点时通过回调通知 StudioNextApp 打开对应 tab。
  - 空状态动作（创建章节/生成下一章/导入章节）通过回调传递。
  - 验证：资源树完整渲染、节点点击打开 tab、空状态动作可用。
  - 覆盖需求：R2。

- [ ] 3. EditorArea 接入真实编辑器
  - 在 StudioNextApp 中，根据打开的 tab 类型创建对应编辑器组件作为 `tab.content`。
  - 复用 WorkspacePage 的 `ChapterEditor`、`CandidateEditor`、`BibleCategoryView`、`DraftEditor`、`OutlineEditor`、`MarkdownViewer`。
  - 章节编辑器：加载正文（`fetchJson("/books/:id/chapters/:n")`）、保存（`fetchJson` PUT）、dirty 追踪。
  - 候选稿编辑器：预览 + 合并/替换/另存/放弃操作。
  - dirty tab 切换拦截：弹出保存确认对话框。
  - 验证：章节可编辑保存、候选稿操作可用、dirty 拦截正常。
  - 覆盖需求：R3。

- [ ] 4. ConversationPanel 接入 NarratorPanel
  - 将现有的 `NarratorPanel`（ChatWindow docked 模式）整体嵌入 ConversationPanel 的对话视图区域。
  - 传递 `windowId`（从 windowStore 获取或创建）和 `canvasContext`（从 EditorArea 状态构建）。
  - 保留 ConversationPanel 的会话头部（标题/详情/归档）和 Git 视图切换。
  - 无活跃会话时显示空状态。
  - 验证：对话可发送/接收、工具调用正常、确认门正常、模型/权限选择器可用。
  - 覆盖需求：R4。

- [ ] 5. Canvas Context 双向传递
  - 从 EditorArea 的当前 tab 状态构建 `CanvasContext`（activeResource、dirty、selection、openTabs）。
  - 将 CanvasContext 传递给 ConversationPanel → NarratorPanel → ChatWindow。
  - 当 AI 工具调用产生 artifact 时，通过回调在 EditorArea 打开新 tab。
  - dirty=true 时阻止非 read 工具执行（已有逻辑，确认在新布局中生效）。
  - 验证：AI 能感知当前编辑状态、artifact 能在编辑器打开、dirty 阻止正常。
  - 覆盖需求：R5。

- [ ] 6. AI 面板与写作工具集成
  - 在 EditorArea 的编辑器下方添加可折叠的 AI 面板（复用 WorkspacePage 的 `AssistantPanel`）。
  - AI 动作按钮：生成下一章/续写/审校/改写/去AI味/连续性检查。
  - 写作模式面板：续写/扩写/对话生成/多版本对比/大纲分支。
  - 写作工具面板：节奏分析/对话分析/钩子生成/日更进度/健康仪表盘。
  - Agent 写作入口：自由意图输入 → 创建 writer session。
  - 验证：AI 动作可触发、写作模式可用、写作工具可用。
  - 覆盖需求：R6。

- [ ] 7. 设置/套路/其他页面路由
  - 点击 Sidebar 的套路按钮 → 中间面板切换为 RoutinesNextPage。
  - 点击 Sidebar 的设置按钮 → 中间面板切换为 SettingsPage。
  - 从设置/套路返回工作台 → 恢复之前的 EditorArea tab 状态。
  - 保留 URL pushState 路由（/next、/next/settings、/next/routines 等）。
  - 验证：页面切换正常、URL 同步、tab 状态恢复。
  - 覆盖需求：R7。

- [ ] 8. 导入/导出功能迁移
  - 将 WorkspacePage 的章节导入面板迁移到 EditorArea 的工具栏或模态。
  - 将全书导出功能迁移到 EditorArea 的工具栏。
  - 将发布就绪检查（PublishPanel）迁移到 EditorArea 的工具栏。
  - 验证：导入/导出/发布检查可用。
  - 覆盖需求：R3、R6。

- [ ] 9. 移除 WorkspacePage 嵌入，清理旧代码
  - StudioNextApp 不再将 WorkspacePage 整体嵌入中间面板。
  - 中间面板在 workspace 视图下渲染 EditorArea + AI 面板。
  - WorkspacePage 保留为 legacy 入口（可通过 URL 直接访问），但不再是默认。
  - 清理 ResourceWorkspaceLayout 中不再需要的旧布局代码。
  - 验证：新布局功能完整、旧入口仍可访问、typecheck 通过、测试通过。
  - 覆盖需求：R1-R7。

- [ ] 10. 编译验证与冒烟测试
  - 运行 typecheck + 全量测试。
  - 编译 exe 并冒烟测试：启动 → 打开工作台 → 点击章节 → 编辑 → 发送消息 → 工具调用 → 确认门 → 设置页 → 套路页。
  - 截图验证三面板布局正确。
  - 更新 CHANGELOG。
  - 覆盖需求：R1-R7。
