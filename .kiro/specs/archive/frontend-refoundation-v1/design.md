# Frontend Refoundation v1 Design

## 总体架构

Frontend Refoundation v1 采用“Agent Shell + Backend Contract Adapter + Writing Workbench”的三层结构。

```
┌──────────────────────────────────────────────────────────────┐
│ Agent Shell                                                   │
│ Sidebar / Route / Global Status / Search / Settings / Routines│
├──────────────────────────────┬───────────────────────────────┤
│ Agent Conversation            │ Writing Workbench              │
│ message stream                │ resource tree + canvas          │
│ tool cards / confirmations    │ resource viewers / artifacts     │
│ input + status bar            │ writing action launchers         │
├──────────────────────────────┴───────────────────────────────┤
│ Backend Contract Client                                        │
│ session / resources / providers / writing actions / statuses   │
└──────────────────────────────────────────────────────────────┘
```

核心原则：UI 不直接相信组件自己的想象；UI 只相信 Backend Contract client 返回的事实、状态和错误。

## 页面结构

### 1. Shell

```
┌──────────────┬──────────────────────────────────────────────┐
│ Sidebar 250  │ Route Main                                   │
│              │                                              │
│ 叙事线        │ /next                         → Conversation │
│ 叙述者        │ /next/narrators/:sessionId    → Conversation │
│ 搜索          │ /next/books/:bookId           → Workbench    │
│ 套路          │ /next/search                  → Search       │
│ 设置          │ /next/routines                → Routines     │
│ v0.0.x       │ /next/settings                → Settings     │
└──────────────┴──────────────────────────────────────────────┘
```

Shell 只负责路由、一级导航、全局状态和数据 provider。它不承载资源树细节，也不直接处理 WebSocket 事件。

### 2. Conversation

```
┌────────────────────────────────────────────────────────────┐
│ Header: title / book binding / connection / details        │
├────────────────────────────────────────────────────────────┤
│ MessageStream flex:1                                       │
│  - user / assistant / system                               │
│  - tool call cards                                         │
│  - tool result renderers                                   │
│  - confirmation gate                                       │
│  - recovery notice                                         │
├────────────────────────────────────────────────────────────┤
│ StatusBar: model / permission / reasoning / context / git  │
├────────────────────────────────────────────────────────────┤
│ Composer: attachments / textarea / abort-or-send           │
└────────────────────────────────────────────────────────────┘
```

旧 ChatWindow 中可复用的是 session/WebSocket/配置/消息转换逻辑，不是堆叠控制区视觉层。新实现必须把 runtime 与 surface 分开。

### 3. Writing Workbench

```
┌────────────────────────────────────────────────────────────┐
│ BookTopBar: title / status / actions / open narrator       │
├──────────────┬─────────────────────────────────────────────┤
│ ResourceTree  │ Canvas tabs                                 │
│ 280px         │  - ChapterResourceViewer                    │
│               │  - CandidateResourceViewer                  │
│ chapters      │  - DraftResourceViewer                      │
│ candidates    │  - TextFileResourceViewer                   │
│ drafts        │  - Jingwei/Narrative/ToolResult viewer      │
│ files         │                                             │
└──────────────┴─────────────────────────────────────────────┘
```

Workbench 可以是两列，因为它是独立页面；主对话页不得嵌入资源树。

## 模块边界

```
packages/studio/src/app-next/
├── shell/
│   ├── AgentShell.tsx
│   ├── ShellSidebar.tsx
│   ├── shell-route.ts
│   └── useShellData.ts
├── backend-contract/
│   ├── capability-status.ts
│   ├── contract-client.ts
│   ├── session-client.ts
│   ├── resource-client.ts
│   ├── provider-client.ts
│   └── writing-action-client.ts
├── agent-conversation/
│   ├── ConversationRoute.tsx
│   ├── runtime/
│   │   ├── useAgentConversationRuntime.ts
│   │   ├── ws-envelope-reducer.ts
│   │   ├── session-actions.ts
│   │   └── message-transforms.ts
│   └── surface/
│       ├── ConversationSurface.tsx
│       ├── MessageStream.tsx
│       ├── MessageItem.tsx
│       ├── ToolCallCard.tsx
│       ├── ConfirmationGate.tsx
│       ├── ConversationStatusBar.tsx
│       └── Composer.tsx
├── tool-results/
│   ├── ToolResultRendererRegistry.tsx
│   ├── GenericToolResultCard.tsx
│   ├── CockpitSnapshotCard.tsx
│   ├── GuidedPlanCard.tsx
│   ├── CandidateCreatedCard.tsx
│   └── NarrativeLineCard.tsx
└── writing-workbench/
    ├── WritingWorkbenchRoute.tsx
    ├── useWorkbenchResources.ts
    ├── WorkbenchResourceTree.tsx
    ├── WorkbenchCanvas.tsx
    ├── WorkbenchTopBar.tsx
    ├── WorkbenchWritingActions.tsx
    └── resource-viewers/
        ├── ChapterResourceViewer.tsx
        ├── CandidateResourceViewer.tsx
        ├── DraftResourceViewer.tsx
        └── TextFileResourceViewer.tsx
```

### 文件规模规则

- 新文件默认 <300 行。
- 超过 400 行必须拆分。
- route 文件只组合数据和组件。
- runtime hook 不渲染 UI。
- surface 组件不直接写 fetch/WebSocket。
- 工具结果 renderer 单文件只服务一个 renderer family。

## 数据流

### Shell 启动

1. `AgentShell` 调用 `useShellData`。
2. `useShellData` 并行读取 books、sessions、provider summary/status。
3. 结果进入 Sidebar；失败转换为空状态或错误卡。
4. URL 决定 main route：Conversation、Workbench、Search、Settings 或 Routines。

### Conversation

1. `ConversationRoute` 解析 sessionId；缺失时可创建/选择默认会话。
2. `useAgentConversationRuntime` 先调用 `sessionClient.getSnapshot`。
3. Runtime 建立 WebSocket `/api/sessions/:id/chat?resumeFromSeq=`。
4. `ws-envelope-reducer` 处理 state/snapshot/message/stream/error。
5. Composer 发送 `session:message`，包含 `canvasContext` 和 `ack`。
6. StatusBar 展示 session config、provider/model、permission、reasoning、usage、recovery。
7. Tool cards 从 message.toolCalls 与 metadata 读取 renderer/artifact/confirmation。

### Workbench

1. `WritingWorkbenchRoute` 解析 bookId。
2. `useWorkbenchResources` 调用 resource contract adapter 组装资源树。
3. 用户打开资源后创建 canvas tab。
4. 可编辑资源调用对应保存合同；只读/unsupported 资源禁用保存。
5. Canvas 将 active resource、open tabs、selection、dirty 输出为 `canvasContext`。
6. Workbench writing action 创建/复用绑定 bookId 的 session，并跳转 Conversation。
7. Agent artifact 可反向打开到 Workbench canvas。

## Tool Result Renderer Registry

Renderer 输入来源：`ToolCall.result`、message metadata 的 `toolResult`、`artifact`、`confirmation`、`guided`、`pgi`、`narrative`。

| Renderer | UI |
|---|---|
| `cockpit.snapshot` | 进度、当前焦点、风险、模型状态 |
| `cockpit.openHooks` | 伏笔列表/empty 状态 |
| `cockpit.recentCandidates` | 候选稿列表，可打开 artifact |
| `questionnaire.*` | 问卷模板、问题、AI 建议 |
| `pgi.questions` / `pgi.answers` | 生成前追问与回答摘要 |
| `guided.questions` / `guided.plan` | 引导式问题与计划确认 |
| `candidate.created` | 候选稿卡片 + 打开画布 |
| `narrative.line` | 叙事线快照 |
| `narrative.mutationPreview` | 变更草案与 diff |
| unknown | Generic JSON/text fallback |

## 错误与降级

- Contract client 保留原始错误。
- `unsupported` 显示禁用按钮和说明。
- `prompt-preview` 显示预览标签，只允许复制/显式 apply。
- `process-memory` 显示临时状态提示。
- `unknown` metric 显示“待接入/未知”，不显示绿色成功。
- WebSocket 失败进入 recovery notice，不清空输入框。
- History gap 使用 snapshot reset，不拼接可能错乱的消息。

## 退役策略

1. 第一阶段切断 `/next` 默认路由对旧 WorkspacePage 的依赖。
2. 第二阶段新 Conversation 吃掉 docked 叙述者面板能力。
3. 第三阶段 Workbench 接管资源树/canvas/viewers。
4. 第四阶段删除或迁移失败三栏实验组件：`SplitView`、`EditorArea`、`ConversationPanel`、旧 `useStudioData` 等。
5. 旧 `ChatWindow.tsx` 若仍被历史 floating 入口使用，要么改为新 surface，要么正式退役；禁止 shim。

## 测试策略

- Contract client：状态映射、错误 envelope、typed client。
- Shell：路由、sidebar、active 状态、空状态。
- Conversation runtime：snapshot、stream、message、error、ack、abort、replay。
- Conversation surface：消息、工具卡、确认门、状态栏、输入发送/中断。
- Workbench：资源树、资源打开、保存/只读/unsupported、dirty canvasContext。
- Tool renderers：每个 renderer 至少一个 smoke test，unknown fallback 保留 raw data。
- 退役测试：主路由不再导入旧三栏默认组件。
- 验证命令：相关 Vitest、`pnpm --dir packages/studio typecheck`、完成阶段手动冒烟。

## 阶段划分

| 阶段 | 目标 | 退出条件 |
|---|---|---|
| Phase 0 | Backend Contract client | 合同状态和 typed client 测试通过 |
| Phase 1 | Agent Shell + Conversation | `/next` 与 `/next/narrators/:id` 可用 |
| Phase 2 | Writing Workbench | `/next/books/:bookId` 可打开真实资源 |
| Phase 3 | Tool renderer + artifact | 核心 session tool 结果可读可打开 |
| Phase 4 | 退役旧前端 | typecheck 通过，无主路由旧三栏依赖 |
| Phase 5 | 文档/冒烟 | docs/CHANGELOG 同步，冒烟清单完成 |
