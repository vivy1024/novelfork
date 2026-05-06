# Legacy Source Retirement v1 Dependency Baseline

最后更新：2026-05-06

## 调查范围与证据

Task 1 依赖基线已覆盖以下范围：

- 全仓旧入口关键词搜索：`StudioApp`、`WorkspacePage`、`ChatWindow`、`ChatWindowManager`、`SplitView`、`EditorArea`、`ConversationPanel`、`useStudioData`、`windowStore`。
- Studio source/tests：`packages/studio/src/**`。
- current docs/specs：`docs/**`、`.kiro/specs/**`、根级 README/AGENTS/CHANGELOG。
- Backend Contract matrix：`packages/studio/src/api/backend-contract-matrix.ts` 与相关 route tests/docs。
- 构建守护：`packages/studio/tsconfig.json`、`packages/studio/tsconfig.server.json`、`packages/studio/src/app-next/legacy-retirement.test.ts`。

关键事实：

- `StudioNextApp.tsx` 当前 `/next` live route 不导入 `StudioApp`、`WorkspacePage` 或 `SplitView`；`StudioNextApp.test.tsx` 已有 guard 断言主路由不含这些旧入口。
- `packages/studio/tsconfig.json` 仍通过 `exclude` 隐藏旧三栏、旧 ChatWindow 和 split-view 路径；`legacy-retirement.test.ts` 当前只验证这些路径仍在 `exclude` 中，后续 Task 7 需要改为检查路径不存在或无 current import。
- `tsconfig.server.json` 仍 exclude `src/api/routes/hooks-countdown.ts` 和 `src/api/routes/poison-detector.ts`；`routes/index.ts` 与 `server.ts` 仍有注释导出，后续 Task 8 删除时必须同步收紧。

## 删除 / 迁移 / 保留清单

| 对象 | 当前命中 | current consumer | 处理结论 | 后续任务 |
|---|---|---|---|---|
| `packages/studio/src/app-next/StudioApp.tsx` | 自身 + `StudioApp.test.tsx`；导入 `WorkspacePage` 与 `SplitView` | 无 live `/next` consumer；只剩旧三栏实验自身测试 | 删除 | Task 5 |
| `packages/studio/src/app-next/StudioApp.test.tsx` | 旧三栏测试；导入 `StudioApp` 和 `usePanelLayout` | 无 current 产品 consumer | 删除 | Task 5 |
| `packages/studio/src/components/split-view/**` | `SplitView.tsx`、`usePanelLayout.ts`、`SplitView.test.tsx`；仅 `StudioApp*` 和自身测试使用 | 无 current 产品 consumer | 删除 | Task 5 / Task 7 |
| `packages/studio/src/app-next/editor/**` | `EditorArea.tsx`、`EditorArea.test.tsx`；无外部 source import | 无 current 产品 consumer | 删除 | Task 5 |
| `packages/studio/src/app-next/conversation/ConversationPanel.tsx` | 自身 + `ConversationPanel.test.tsx` | 无 current 产品 consumer；新会话走 `app-next/agent-conversation` | 删除 | Task 5 |
| `packages/studio/src/app-next/conversation/GitChangesView.tsx` | 旧 `ConversationPanel` git 视图；自身测试仍存在 | 无 current 产品 consumer | 删除 | Task 5 |
| `packages/studio/src/app-next/hooks/useStudioData.ts` | 自身注释明确“从 WorkspacePage 提取”；导入旧 `workspace/resource-adapter` | 无 current 产品 consumer | 删除 | Task 5 |
| `packages/studio/src/app-next/workspace/WorkspacePage.tsx` | `StudioApp.tsx`、自身大测试、docs/mock-debt ledger；导入 `NarratorPanel`、`windowStore`、`windowRuntimeStore` | live `/next/books/:bookId` 已走 `WritingWorkbenchRoute`，不再由 `WorkspacePage` 承载 | 删除；删除前确认可复用资源能力已迁入 `writing-workbench` | Task 5 |
| `packages/studio/src/app-next/workspace/resource-adapter.ts`、`resource-view-registry.tsx`、`WorkspaceFileViewer.tsx`、面板与 cockpit 辅助文件 | 主要被 `WorkspacePage`、workspace tests、`useStudioData` 使用；docs/test 状态仍引用 | current live workbench 已有 `app-next/writing-workbench/**`；这些旧文件无外部 source import | 默认随 `workspace/**` 删除；若发现差异能力缺口，只能迁移到 `writing-workbench`，不能保留旧 workspace 命名 | Task 5 |
| `packages/studio/src/components/ChatWindow.tsx` | 自身大测试、`ChatWindowManager`、旧 `WorkspacePage` 的 `NarratorPanel`、ToolCall README/mock-debt/docs | current live narrator route 已走 `app-next/agent-conversation`；旧 workspace 仍是待删 consumer | 删除；有价值的工具卡/恢复展示已进入或需迁入新边界 | Task 4 / Task 6 |
| `packages/studio/src/components/ChatWindowManager.tsx` | 自身导入 `ChatWindow` 与 `windowStore`；无 current source consumer | 无 current 产品 consumer | 删除 | Task 6 |
| `NarratorPanel`（从 `ChatWindow.tsx` 导出） | 旧 `WorkspacePage.tsx` 和 `ChatWindow.test.tsx` 使用 | 仅旧 workspace consumer | 随 `WorkspacePage`/`ChatWindow` 删除，不复制兼容层 | Task 5 / Task 6 |
| `packages/studio/src/stores/windowStore.ts` | `SessionCenterPage`、`Admin/SessionsTab`、`WorkspacePage`、`ChatWindow`、`ChatWindowManager`、自身测试/持久化测试 | 有 current 页面 consumer：`SessionCenterPage` 与 `Admin/SessionsTab` 仍依赖；其余为旧 workspace/ChatWindow | 先迁移 current consumer 到 session truth；无 consumer 后删除 store 与测试 | Task 2 / Task 3 / Task 4 |
| `packages/studio/src/components/Admin/SessionsTab.tsx` | 直接读取 `windowStore` + `windowRuntimeStore`，文案写“ChatWindow 实例” | current Admin 页面 consumer | 迁移到 session/runtime truth，保留 Admin 入口 | Task 3 |
| `packages/studio/src/app-next/sessions/SessionCenterPage.tsx` | 通过 `windowStore` 打开/聚焦 session shell window | current session center 页面 consumer | 迁移到 `/api/sessions` domain client / 当前 session store 行为；不再制造 ChatWindow shell truth | Task 2 |
| `packages/studio/src/components/RecoveryBadge.tsx` | `ChatWindow`、`Admin/SessionsTab`、自身测试；依赖 `windowRecoveryPresentation` 与 `WindowRecoveryState` | Admin/recovery UI 仍有复用价值 | 迁移/重命名为 session recovery presentation，不保留 window 命名事实源 | Task 4 |
| `packages/studio/src/lib/windowRecoveryPresentation.ts` | `RecoveryBadge`、tests；注释仍写 SessionCenter/ChatWindow/Admin | recovery 语义有复用价值，但 window 命名过时 | 迁移或重命名为 session recovery presentation | Task 4 |
| `packages/studio/src/lib/closed-window-hint.ts` | 仅旧 `ChatWindow.tsx` import；自身测试 | 无 current 产品 consumer | 随旧 ChatWindow 删除，除非迁移到明确的新 session UX | Task 4 / Task 6 |
| `packages/studio/src/components/ToolCall/README.md` | 仍写类型定义在 `windowStore.ts`、ChatWindow 集成 | 文档 consumer | 更新为 ConversationSurface / Tool Result Renderer 口径 | Task 4 / Task 10 |
| `docs/**`、根级 `README.md`、`AGENTS.md`、`CHANGELOG.md` | 仍有 `WorkspacePage`、`ChatWindow`、`windowStore` 等 current/历史混合表述 | 文档 consumer | current docs 改新口径；历史归档可保留但需保持归档语义 | Task 10 |

## Backend Contract matrix 与 route 候选

| 对象 | 当前命中 | 处理结论 | 后续任务 |
|---|---|---|---|
| `/api/chat/:bookId/*` / `routes/chat.ts` | Task 9 重新搜索确认无 current consumer；旧 `ChatPanel` 与 route test 已删除，`server.ts` 不再 mount `createChatRouter` | 已退役并删除 route/test/matrix/mock debt 条目；正式长期会话使用 `/api/sessions` 与 `/api/sessions/:id/chat` | Task 9 |
| exact `POST /api/agent` | Task 9 重新搜索确认无 frontend client/docs/tests current consumer；`/api/agent/config` 是独立 current route | 已从 `createAIRouter` 移除，matrix 改为 `legacy.ai-agent.unsupported` retired 口径 | Task 9 |
| `/api/pipeline*` | matrix 标记 `legacy.pipeline-runs.process-memory`；server mount 与 route tests 存在 | 保留 transparent process-memory，不写 current | Task 9 |
| `/api/monitor` | matrix 标记 `legacy.monitor.unsupported`；`MonitorWidget`、tests/docs 存在 | 保留 unsupported，不能伪造成 stopped/可用 | Task 9 |
| `poison-detector.ts`、`hooks-countdown.ts` | `routes/index.ts` / `server.ts` 注释导出；`tsconfig.server.json` exclude；matrix 标记 `legacy.disabled-routers.unsupported` | 删除源码、注释导出和 tsconfig exclude | Task 8 |
| 旧导出、旧 AI 面板 route | matrix 标记 `legacy.export.deprecated`、`legacy.ai-panels.deprecated`；docs/tests 仍引用 | 本 spec 只登记条件，不强删 current 能力 | Task 9 / Task 10 |

## Task 1 验证结果

- 全仓关键词搜索已覆盖 source、tests、docs/specs 与根级文档；命中包括 `packages/studio/src/**`、`docs/**`、`.kiro/specs/**`、`README.md`、`AGENTS.md`、`CHANGELOG.md`。
- source/tests 基线已确认：`StudioNextApp.tsx` 不导入旧三栏入口；旧路径主要由自身 tests、legacy workspace/ChatWindow、SessionCenter/Admin windowStore consumers 和文档引用保留。
- Backend Contract matrix 已确认：legacy chat、pipeline、monitor、agent、export、AI panels、disabled routers 均有 process-memory/deprecated/unsupported 状态登记。
- 尚未执行删除、迁移或 typecheck；这些属于 Task 2+。