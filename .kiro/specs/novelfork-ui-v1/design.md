# NovelFork UI v1 Design

> **Superseded / 仅历史过渡参考**：本 spec 已被 `backend-contract-v1` 与 `frontend-refoundation-v1` 取代，不再作为当前实现主线或任务入口。本文仅保留失败三栏实验后的过渡设计记录。

## 总体架构

采用“新壳重写”而不是“硬删一切”：保留后端 API、session/WebSocket、模型/权限配置、token/压缩/流式输出等运行能力；退役当前失败的前端布局壳、主路由三栏 WorkspacePage 和旧 ChatWindow 视觉层。

```
┌──────────────┬─────────────────────────────────────────────┐
│ Sidebar 250  │ Main                                        │
│              │                                             │
│ 叙事线        │ /next 或 /next/narrators/:id                │
│ - 书A         │ → ConversationRoute                         │
│ - 书B         │                                             │
│              │ /next/books/:bookId                         │
│ 叙述者        │ → StorylineWorkbenchRoute                   │
│ - 会话1       │                                             │
│ - 会话2       │ /next/routines / /next/settings / /next/search │
│              │ → 现有页面包在新壳内                         │
│ 套路/设置     │                                             │
└──────────────┴─────────────────────────────────────────────┘
```

## 页面设计

### 1. ConversationRoute（主对话页）

```
┌────────────────────────────────────────────────────────────┐
│ 会话栏：标题 / 连接状态 / 详情按钮                          │ 40px
├────────────────────────────────────────────────────────────┤
│                                                            │
│ 单栏对话流：                                                │ flex:1
│ - 用户消息右侧                                              │
│ - 助手消息左侧                                              │
│ - 工具调用卡片内联，可折叠                                  │
│ - 权限确认门内联                                            │
│                                                            │
├────────────────────────────────────────────────────────────┤
│ 状态栏：Context / 模型 / 权限 / 推理 / 费用或 token / Git    │ 32-44px
├────────────────────────────────────────────────────────────┤
│ 输入区：附件 / textarea / 中断或发送                         │ 48-96px
└────────────────────────────────────────────────────────────┘
```

设计重点：对话流必须 `flex:1`，其他区域都是固定高度或折叠区域。旧的“当前会话控制”和“最近执行链”不再常驻；上下文详情、执行链、恢复详情通过按钮打开抽屉或 popover。

### 2. Sidebar

Sidebar 是 250px 固定宽度，不承载完整资源树。

- 叙事线：书籍列表 + 简短状态/计数；点击进入 `/next/books/:bookId`。
- 叙述者：活跃会话列表；点击进入 `/next/narrators/:sessionId`。
- 底部：套路、设置、版本号。
- 空状态：没有书或会话时显示单行提示和创建入口。

### 3. StorylineWorkbenchRoute（叙事线详情页）

```
┌────────────────────────────────────────────────────────────┐
│ 顶部书籍栏：返回 / 书名 / 状态 / 写作动作                    │
├──────────────┬─────────────────────────────────────────────┤
│ 资源管理器    │ 编辑/查看区域                                │
│ 280px        │ - 章节正文                                   │
│              │ - 候选稿 / 草稿                              │
│ 章节          │ - 大纲 / 经纬 / 故事文件 / 真相文件           │
│ 候选稿        │                                             │
│ 草稿          │                                             │
│ 大纲/经纬     │                                             │
└──────────────┴─────────────────────────────────────────────┘
```

这里可以是两列，因为它是独立写作工作台，不是主对话页。旧 `WorkspacePage` 的资源树、canvas、写作动作要被提取成小组件，而不是继续整体嵌套。

## 组件边界

| 模块 | 新边界 | 处理方式 |
|---|---|---|
| `StudioNextApp` | 路由 + 新 shell | 重写，移除默认 WorkspacePage |
| `Sidebar` | 一级导航 | 保留并简化数据展示，叙事线不显示资源树 |
| `ConversationRoute` | 主对话页面 | 新建 |
| `ChatRuntime` hook/controller | WebSocket、snapshot、发送、配置 | 从 `ChatWindow.tsx` 提取真实逻辑 |
| `ChatSurface` | 对话视觉层 | 新建，替代旧堆叠 UI |
| `StorylineWorkbenchRoute` | 独立写作工作台 | 新建 |
| `WorkspacePage` | 旧三栏页面 | 不再用于主路由，逐步提取后退役 |
| `SplitView` / `EditorArea` / `ConversationPanel` | 失败三栏实验骨架 | 无真实复用则删除 |

## 文件组织与规模限制

这次重写不得再制造新的超大文件。`ChatWindow.tsx` 和 `WorkspacePage.tsx` 的问题之一就是职责混杂，不允许用一个新的大文件替代旧大文件。

建议文件边界：

```
app-next/conversation/
├── ConversationRoute.tsx          # route 绑定 session/window，不承载渲染细节
├── chat-runtime/
│   ├── useChatRuntime.ts          # WebSocket/snapshot/send/replay 主 hook
│   ├── chat-runtime-types.ts
│   ├── session-config-actions.ts
│   └── message-transforms.ts
├── chat-surface/
│   ├── ChatSurface.tsx            # 组合布局，目标 <300 行
│   ├── ChatMessageList.tsx
│   ├── ChatMessageItem.tsx
│   ├── ChatToolCallItem.tsx
│   ├── ChatStatusBar.tsx
│   ├── ChatInputBar.tsx
│   └── ChatRecoveryNotice.tsx

app-next/storyline/
├── StorylineWorkbenchRoute.tsx     # route + 页面组合，目标 <300 行
├── useStorylineWorkbenchData.ts
├── StorylineResourceTree.tsx
├── StorylineResourceViewer.tsx
├── StorylineTopBar.tsx
├── StorylineWritingActions.tsx
└── resource-viewers/
    ├── ChapterResourceViewer.tsx
    ├── CandidateResourceViewer.tsx
    ├── DraftResourceViewer.tsx
    └── TextFileResourceViewer.tsx
```

规模规则：

- 新建前端文件默认 <300 行。
- 超过 400 行必须拆分；除非同一任务内写明不可拆原因。
- route 文件只组合数据和页面，不直接写大量 UI 分支。
- runtime hook 不渲染 UI；surface 组件不直接处理 WebSocket。
- 工具调用、状态栏、输入框、资源树、资源 viewer 都必须独立文件。
- 测试也按模块拆分，不能复制一个巨型 `ChatWindow.test.tsx` 或 `WorkspacePage.test.tsx`。

## 数据流

1. `StudioNextApp` 解析 URL，确定当前 route 和 route params。
2. Sidebar 通过现有 `/books`、`/sessions` 数据源渲染书籍和会话列表。
3. 点击叙述者会话：路由到 `/next/narrators/:sessionId`，ConversationRoute 绑定该 session。
4. ConversationRoute 通过 ChatRuntime 加载 snapshot、建立 WebSocket、发送消息、更新 session config。
5. ChatSurface 只消费 runtime state/actions：messages、toolCalls、status、input、send/abort、model/permission/reasoning 更新。
6. 点击叙事线书籍：路由到 `/next/books/:bookId`，StorylineWorkbenchRoute 加载该书资源树。
7. 写作动作创建或复用绑定书籍的 session，再跳转回 ConversationRoute。

## 错误与恢复

- session 未找到：显示轻量错误状态，提供返回或新建会话。
- WebSocket 断开：状态栏显示“重连中/离线”，允许保留输入，不用大面积 banner 挤占对话。
- snapshot/replay 失败：用可折叠恢复提示，提供重试、归档、新会话动作。
- 模型池为空：输入区禁用发送，状态栏提示去设置配置模型。
- 工具失败：工具卡片内联标红并默认展开失败摘要。

## 测试策略

- 路由测试：`/next`、`/next/narrators/:id`、`/next/books/:id`、设置、套路、搜索。
- Sidebar 测试：书籍点击、会话点击、active 高亮、空状态。
- ChatSurface 测试：消息渲染、工具卡片折叠、权限确认、底部状态栏、输入发送/中断状态。
- ChatRuntime 测试：复用现有 session/WebSocket 行为测试，避免重写后端能力。
- StorylineWorkbench 测试：资源节点打开、写作动作创建/复用会话并跳转。
- 验证命令：相关 Vitest、`pnpm --dir packages/studio typecheck`，完成阶段再做手动冒烟。

## 退役策略

- 先切断主路由对旧 `WorkspacePage` 和 `ResourceWorkspaceLayout` 的依赖。
- 再提取资源树/canvas/写作动作到 StorylineWorkbench。
- 新 ChatSurface 稳定后，让 floating 和 docked 都走同一视觉层，或正式退役 floating 旧窗口路径。
- 删除失败实验组件时必须同步测试和导入，不新增假兼容层。

## 不做的事

- 不做三栏主界面。
- 不做可拖拽 SplitView。
- 不把资源树放进主对话页。
- 不重写后端 API 和 session 存储。
- 不保留旧控制卡片堆叠 UI。
