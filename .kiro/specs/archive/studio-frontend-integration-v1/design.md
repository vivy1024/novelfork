# Studio Frontend Integration v1 Design

## Architecture

### 数据流模式（对标 Claude Code REPL.tsx）

Claude Code 的 REPL.tsx 是数据中心——它持有消息列表、管理 query 生命周期、将数据分发给 Messages/PromptInput/FullscreenLayout。NovelFork 的 StudioNextApp 应该扮演同样的角色。

```
StudioNextApp (数据中心)
├── useApi("/books") → books
├── useApi("/books/:id") → chapters, candidates, drafts, storyFiles, truthFiles
├── useApi("/sessions") → sessions
├── useApi("/providers/models") → models
├── buildStudioResourceTree() → resourceNodes
├── activeBookId, activeSessionId, activeTabId (状态)
│
├── Sidebar (左)
│   ├── StorylineTree ← books, resourceNodes, activeBookId
│   │   └── ResourceTree ← nodes (复用旧组件)
│   └── NarratorList ← sessions, activeSessionId
│
├── EditorArea (中) ← 根据 activeView 切换
│   ├── workspace 视图:
│   │   ├── TabBar ← openTabs, activeTabId
│   │   ├── ChapterEditor ← chapterContent, onSave
│   │   ├── CandidateEditor ← candidate, onMerge/onReplace/onDiscard
│   │   ├── BibleDetail ← entry, onSave
│   │   ├── OutlineEditor ← content, onSave
│   │   └── AI 面板 + 写作工具 (编辑器下方)
│   ├── settings 视图: SettingsPage
│   ├── routines 视图: RoutinesNextPage
│   └── 其他视图: WorkflowPage, SearchPage, SessionCenterPage
│
└── ConversationPanel (右)
    ├── NarratorPanel ← windowId, canvasContext (复用旧组件)
    │   └── ChatWindow ← WebSocket, 消息, 工具调用, 确认门
    └── GitChangesView ← git status (切换视图)
```

### 关键设计决策

#### 1. 复用而非重写

WorkspacePage 和 ChatWindow 的核心逻辑不重写，而是：
- 将 WorkspacePage 的**数据获取层**（useApi hooks）提升到 StudioNextApp
- 将 WorkspacePage 的**资源树构建**（buildStudioResourceTree）提升到 StudioNextApp
- 将 WorkspacePage 的**编辑器组件**（ChapterEditor 等）直接嵌入 EditorArea 的 tab.content
- 将 ChatWindow/NarratorPanel **整体**嵌入 ConversationPanel（不拆解内部逻辑）

#### 2. 状态管理（对标 Claude Code 的 Store + useState 混合）

Claude Code 用自研轻量 Store（`createStore` + `useSyncExternalStore`）管理全局状态，useState 管理组件局部状态。NovelFork 采用类似模式：

- **全局状态**（appStore）：activeBookId, activeSessionId, openTabs
- **组件局部状态**：编辑器 dirty、输入框文本、折叠状态
- **数据获取**：useApi hooks（已有）

#### 3. 消息渲染优化（对标 Claude Code Messages.tsx）

- 静态消息冻结：已完成的消息用 `React.memo` + 自定义 comparator 跳过重渲染
- 工具调用分组：连续的读取工具折叠为摘要
- 虚拟滚动：长对话使用虚拟列表（后续优化，第一版用全量渲染 + overflow-auto）

#### 4. ConversationPanel 内嵌 NarratorPanel

不拆解 ChatWindow 的 1974 行代码。直接将现有的 `NarratorPanel`（ChatWindow 的 docked 模式包装）嵌入 ConversationPanel 的对话视图区域。ChatWindow 内部已有完整的 WebSocket、消息管理、工具调用、确认门、模型选择器、权限控制。

ConversationPanel 只负责：
- 会话头部（标题/详情/归档）
- 对话/Git 视图切换
- Git 状态栏
- 将 canvasContext 传递给 NarratorPanel

---

## 组件迁移映射

| 旧组件（WorkspacePage 内部） | 新位置 | 迁移方式 |
|---|---|---|
| `useApi("/books")` 等数据获取 | StudioNextApp | 提升到顶层 |
| `buildStudioResourceTree()` | StudioNextApp | 提升到顶层 |
| `WorkspaceLeftRail` > `ResourceTree` | Sidebar > StorylineTree | 复用 ResourceTree 组件 |
| `WorkspaceCanvas` (tab 系统) | EditorArea | 复用 useEditorTabs hook |
| `WorkspaceEditor` (ChapterEditor 等) | EditorArea tab.content | 直接嵌入 |
| `AssistantPanel` (AI 动作) | EditorArea 编辑器下方 | 复用 |
| `WritingModesPanel` | EditorArea 编辑器下方 | 复用 |
| `WritingToolsPanel` | EditorArea 编辑器下方 | 复用 |
| `NarratorPanel` (docked ChatWindow) | ConversationPanel | 整体嵌入 |
| `PublishPanel` | EditorArea 工具栏 | 复用 |
| 导入/导出面板 | EditorArea 工具栏 | 复用 |
| dirty 拦截对话框 | EditorArea | 复用 |

---

## 不做的事

- 不重写 ChatWindow 内部逻辑（WebSocket/恢复/消息处理）
- 不重写编辑器组件（InkEditor/CandidateEditor 等）
- 不实现虚拟滚动（第一版用全量渲染）
- 不实现 Claude Code 的 React Compiler 优化
- 不改变后端 API
