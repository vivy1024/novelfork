# Legacy Source Retirement v1 Design

## 总体设计

本 spec 采用“先迁移消费者，再删除旧源文件，最后收紧守护”的顺序。目标不是立刻删除所有带 legacy 字样的东西，而是删除已经不在 current 产品路径中的旧前端和未挂载 route 残留，同时保留仍有真实合同意义的后端能力。

```
依赖基线
  → consumer 迁移
  → reusable asset 迁移
  → 删除旧三栏/ChatWindow 源码
  → 清理 tsconfig exclude / 注释导出
  → 更新 Backend Contract matrix 与文档
  → typecheck / tests / docs verify
```

## 删除对象分组

### 1. 旧三栏前端

候选删除路径：

- `packages/studio/src/app-next/StudioApp.tsx`
- `packages/studio/src/app-next/StudioApp.test.tsx`
- `packages/studio/src/app-next/workspace/**`
- `packages/studio/src/app-next/editor/**`
- `packages/studio/src/app-next/conversation/ConversationPanel.tsx`
- `packages/studio/src/app-next/conversation/ConversationPanel.test.tsx`
- `packages/studio/src/app-next/conversation/GitChangesView.tsx`
- `packages/studio/src/app-next/hooks/useStudioData.ts`
- `packages/studio/src/components/split-view/**`

这些文件的共同特征是：服务失败三栏实验，已经不应作为 `/next` 主线依赖。

### 2. 旧 ChatWindow 视觉层

候选删除路径：

- `packages/studio/src/components/ChatWindow.tsx`
- `packages/studio/src/components/ChatWindow.test.tsx`
- `packages/studio/src/components/ChatWindowManager.tsx`

如果其中某些逻辑仍有价值，只能迁移到 `app-next/agent-conversation/runtime`、`app-next/agent-conversation/surface` 或 `app-next/tool-results`，不能保留为旧名兼容层。

### 3. windowStore 生态

需先迁移 consumer：

- `app-next/sessions/SessionCenterPage.tsx`
- `components/Admin/SessionsTab.tsx`
- `components/RecoveryBadge.tsx`
- `lib/windowRecoveryPresentation.ts`
- `stores/windowStore.ts`

迁移后，session 事实源统一来自 `/api/sessions`、session recovery metadata 和 session chat runtime。若仍需要窗口布局状态，应单独命名为 UI workspace state，不能继续混同 narrator session。

### 4. 后端 legacy route

按合同状态处理：

- `/api/chat/:bookId/*`：无 current consumer 后删除。
- `/api/agent`：无 current consumer 后删除或从 `createAIRouter` 移除。
- `poison-detector.ts`、`hooks-countdown.ts`：未挂载且 tsconfig exclude，优先删除注释导出和 exclude。
- `/api/pipeline`：若仍作为调试面板，保留 process-memory 标注。
- `/api/monitor`：若无真实 runtime/daemon，保留 unsupported，不返回假 stopped。
- 旧导出与旧 AI panel route：本阶段只登记迁移条件，不强删。

## 迁移策略

### SessionCenterPage

从 `windowStore` 改为 `createSessionClient(...).listActiveSessions()`、archive/restore/update session API。UI 上显示 session title、agentId、kind、binding、lastModified、messageCount、recovery 和 sessionConfig。

### Admin/SessionsTab

从 window 运行态改为 session/runtime 运行态：

- session list：来自 `/api/sessions`。
- recovery：来自 session record recovery。
- recent messages / pending confirmations：来自 `/api/sessions/:id/chat/state` 和 `/api/sessions/:id/tools`。

### ToolCall 可视化

旧 `components/ToolCall` 中有价值的折叠输出、图标、错误高亮可以迁入：

- generic tool result renderer；或
- `agent-conversation/surface/ToolCallCard`。

迁移后更新 README，不再写 ChatWindow 集成。

## tsconfig 和 guard 收敛

删除旧文件后，移除 `packages/studio/tsconfig.json` 中针对旧前端的 exclude 项。`legacy-retirement.test.ts` 改为检查：

- live entry 不导入旧路径；
- 已删除路径不存在；
- 当前源码无 `WorkspacePage` / `ChatWindow` current import；
- backend contract matrix 中 legacy route 状态准确。

`tsconfig.server.json` 中 `poison-detector.ts`、`hooks-countdown.ts` exclude 只有在文件仍存在且明确保留时才允许存在；若删除文件，exclude 同步移除。

## 错误处理

- 删除导致 typecheck 失败：先定位真实 consumer，迁移 consumer，不恢复旧文件。
- route 删除导致 API 测试失败：判断测试是否仍代表 current contract；若代表 current，则迁移 route；若代表 legacy，则删除或改为 deprecated contract 测试。
- 文档仍引用旧路径：更新为新路径或移动到归档上下文。

## 测试策略

- Grep guard：确认旧前端 import 不再出现在 current 源码。
- Typecheck：确认不靠 exclude 隐藏旧前端问题。
- App-next tests：确认新 shell/conversation/workbench live route 仍通过。
- API tests：确认被保留 legacy route 的 process-memory/deprecated/unsupported 状态不被误写成 current。
- Docs verify：防止 README/API 文档继续宣传旧 ChatWindow/WorkspacePage。

## 验收命令

至少运行：

```bash
pnpm --dir packages/studio test -- app-next
pnpm --dir packages/studio typecheck
pnpm docs:verify
```

若删除或改动 API route，还需运行对应 route tests。