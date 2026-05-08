# Legacy Source Retirement v1 Tasks

## Overview

在 `frontend-live-wiring-v1` 使新 Agent Shell/Conversation/Workbench live route 可用后，删除旧三栏、旧 ChatWindow、旧 windowStore 会话事实源和未挂载 route 残留。删除前必须迁移 current consumer；删除后必须移除 tsconfig exclude 和旧文档口径。

## Tasks

- [x] 1. 建立旧源码依赖基线
  - 全仓搜索 `StudioApp`、`WorkspacePage`、`ChatWindow`、`ChatWindowManager`、`SplitView`、`EditorArea`、`ConversationPanel`、`useStudioData`、`windowStore`。
  - 输出删除/迁移/保留清单，并标记 current consumer。
  - 验证：清单覆盖 source、tests、docs、Backend Contract matrix。
  - 证据：`dependency-baseline.md` 记录 2026-05-06 搜索结果、删除/迁移/保留清单、current consumer 与 Backend Contract matrix route 候选；确认本任务未执行删除/迁移/typecheck，后续任务按清单推进。

- [x] 2. 迁移 SessionCenterPage 到 session client
  - 移除 `app-next/sessions/SessionCenterPage.tsx` 对 `windowStore` 的依赖。
  - 使用 `/api/sessions` domain client 展示会话列表、归档/恢复、绑定和 sessionConfig。
  - 验证：会话列表、空状态、归档/恢复、错误状态测试。
  - 证据：`SessionCenter.test.tsx` 先红后绿覆盖 session domain client list/search/archive/restore/empty/error；`SessionCenterPage.test.tsx` 先红后绿确认打开会话跳转 `/next/narrators/:sessionId` 且不调用 `windowStore`；`pnpm --dir packages/studio exec vitest run src/components/sessions/SessionCenter.test.tsx src/app-next/sessions/SessionCenterPage.test.tsx --reporter=verbose` 通过（2 files / 6 tests）；`pnpm --dir packages/studio exec tsc --noEmit --project tsconfig.json --pretty false` 通过。

- [x] 3. 迁移 Admin SessionsTab 到 session/runtime truth
  - 移除 `components/Admin/SessionsTab.tsx` 对 `windowStore` 的依赖。
  - 使用 session list、chat state/tools/recovery 展示运行状态。
  - 验证：active/archived、pending confirmation、recovery badge、缺失会话测试。
  - 证据：`SessionsTab.test.tsx` 先红后绿覆盖无会话、active/archived session runtime truth、chat state/tools 缺失状态，并显式 mock `windowStore`/`windowRuntimeStore` 为抛错以防回归；`SessionsTab.tsx` 无 `useWindowStore` / `useWindowRuntimeStore` 导入或调用；`pnpm --dir packages/studio exec vitest run src/components/Admin/SessionsTab.test.tsx src/components/sessions/SessionCenter.test.tsx src/app-next/sessions/SessionCenterPage.test.tsx --reporter=verbose` 通过（3 files / 9 tests）；`pnpm --dir packages/studio exec tsc --noEmit --project tsconfig.json --pretty false` 通过；`pnpm docs:verify` 通过；`git diff --check` 无 whitespace error，仅 LF/CRLF 提示。

- [x] 4. 迁移仍有价值的 ToolCall / Recovery 资产
  - 将旧 ToolCall 的折叠输出、图标、错误展示迁入 `agent-conversation` 或 `tool-results` 边界。
  - 将 `windowRecoveryPresentation` 改为 session recovery presentation，或确认无 consumer 后删除。
  - 更新 `components/ToolCall/README.md`，不再写 ChatWindow 集成。
  - 验证：renderer/generic tool card/recovery badge 测试。
  - 证据：新增 `lib/sessionRecoveryPresentation.ts` 并让 `RecoveryBadge` 使用 `NarratorSessionRecoveryState`，`windowRecoveryPresentation.ts` 仅保留兼容 re-export；`agent-conversation/surface/ToolCallCard.tsx` 在 `output/error/exitCode` 详细执行信息存在时复用 `ToolCallBlock`，保留折叠输出、图标、错误与 exit code 展示；`components/ToolCall/README.md` 改为 narrator session 共享资产边界，不再写旧 ChatWindow 集成；`pnpm --dir packages/studio exec vitest run src/lib/windowRecoveryPresentation.test.ts src/components/RecoveryBadge.test.tsx src/app-next/agent-conversation/surface/ConversationSurface.test.tsx src/components/ToolCall/ToolCallBlock.test.tsx --reporter=verbose` 通过（4 files / 42 tests）；`pnpm --dir packages/studio exec tsc --noEmit --project tsconfig.json --pretty false` 通过；`pnpm docs:verify` 最后一轮因审批层拒绝未取得新鲜输出（前一轮通过）；`git diff --check` 无 whitespace error，仅 LF/CRLF 提示。

- [x] 5. 删除旧三栏前端源码
  - 删除 `app-next/StudioApp.tsx`、对应测试、`workspace/**`、`editor/**`、旧 `ConversationPanel`、`GitChangesView`、`useStudioData`。
  - 删除无 current consumer 的 `components/split-view/**`。
  - 验证：全仓无 current import，app-next tests 通过。
  - 证据：删除 `StudioApp.tsx` / `StudioApp.test.tsx`、`app-next/workspace/**`、`app-next/editor/**`、旧 `ConversationPanel` / `GitChangesView` 及测试、`hooks/useStudioData.ts`、`components/split-view/**`；删除前 `git status --short -- <paths>` 无输出，确认这些路径没有未提交改动；`Grep` 确认删除后源码中旧三栏 current 引用只剩 Task 7 的 `legacy-retirement.test.ts` exclude guard 与 `StudioNextApp.test.tsx` 的 anti-regression 断言；文档和 mock debt 已改用 `backend-contract/resource-tree-adapter`、`writing-workbench/useWorkbenchResources`、`WorkbenchCanvas`、`resource-viewers` 等当前事实源；`pnpm --dir packages/studio exec vitest run src/app-next/StudioNextApp.test.tsx src/app-next/routing.test.tsx --reporter=verbose` 通过（2 files / 28 tests）；`pnpm --dir packages/studio exec vitest run src/app-next/backend-contract/resource-tree-adapter.test.ts src/app-next/writing-workbench/useWorkbenchResources.test.ts src/app-next/writing-workbench/WorkbenchCanvas.test.tsx src/app-next/writing-workbench/resource-viewers.test.tsx --reporter=verbose` 通过（4 files / 17 tests）；`pnpm --dir packages/studio exec vitest run src/api/lib/mock-debt-ledger.test.ts --reporter=verbose` 通过（1 file / 4 tests）；`pnpm --dir packages/studio exec tsc --noEmit --project tsconfig.json --pretty false` 通过；`pnpm docs:verify` 通过（84 markdown files / 22 directories）；`git diff --check` 无 whitespace error，仅 LF/CRLF 提示。

- [x] 6. 删除旧 ChatWindow 视觉层
  - 删除 `components/ChatWindow.tsx`、`ChatWindow.test.tsx`、`ChatWindowManager.tsx`。
  - 确认 `NarratorPanel` 不再被 current 路径引用。
  - 验证：全仓无 current ChatWindow import，Conversation route tests 通过。
  - 证据：先在 `StudioNextApp.test.tsx` 增加旧窗口视觉层不存在 guard 并观察 RED（3 个文件仍存在），经确认后删除 `components/ChatWindow.tsx`、`components/ChatWindow.test.tsx`、`components/ChatWindowManager.tsx`；Python 存在性检查显示删除后 3 个路径均为 `False`，`git status` 显示 3 个 `D`；`Grep` 确认没有 `from "./ChatWindow"`、`from "./ChatWindowManager"` 或 `@/components/ChatWindow*` current import；源码预览 fallback 改到 `agent-conversation/surface/ConversationSurface.tsx`，mock debt、ToolCall README 和测试状态文档改为 ConversationSurface 事实源；`pnpm --dir packages/studio exec vitest run src/app-next/StudioNextApp.test.tsx src/app-next/agent-conversation/ConversationRoute.test.tsx src/app-next/agent-conversation/surface/ConversationSurface.test.tsx --reporter=verbose` 通过（3 files / 41 tests）；`pnpm --dir packages/studio exec vitest run src/components/ToolCall/ToolCallBlock.test.tsx src/api/routes/tools.test.ts src/api/lib/mock-debt-ledger.test.ts --reporter=verbose` 通过（3 files / 29 tests）；`pnpm --dir packages/studio exec tsc --noEmit --project tsconfig.json --pretty false` 通过；`pnpm docs:verify` 通过（84 markdown files / 22 directories）；`git diff --check` 无 whitespace error，仅 LF/CRLF 提示。

- [x] 7. 收紧 tsconfig 和 retirement guard
  - 移除 `packages/studio/tsconfig.json` 中旧前端路径 exclude。
  - 更新 `legacy-retirement.test.ts`：检查旧路径不存在或无 current import，而不是只检查 exclude。
  - 验证：Studio typecheck 不依赖隐藏旧源码。
  - 证据：`legacy-retirement.test.ts` 改为检查旧前端路径不存在且不再被 `tsconfig.json` exclude；RED 阶段 `pnpm --dir packages/studio exec vitest run src/app-next/legacy-retirement.test.ts --reporter=verbose` 因 12 个旧前端路径仍在 exclude 中失败；随后移除 `packages/studio/tsconfig.json` 中 `StudioApp`、`workspace/**`、`editor/**`、旧 `ConversationPanel` / `GitChangesView` / `useStudioData`、`components/split-view/**`、`ChatWindow*` exclude，仅保留 Task 8 的 `hooks-countdown.ts` / `poison-detector.ts` route exclude；GREEN 阶段同一 guard 测试通过（1 file / 1 test）；`pnpm --dir packages/studio exec tsc --noEmit --project tsconfig.json --pretty false` 通过；`pnpm docs:verify` 通过（84 markdown files / 22 directories）；`git diff --check` 无 whitespace error，仅 LF/CRLF 提示。

- [x] 8. 清理未挂载 route 残留
  - 删除未挂载且无 current 计划的 `poison-detector.ts`、`hooks-countdown.ts`。
  - 移除 `routes/index.ts` 注释导出和 `tsconfig.server.json` exclude。
  - 验证：server typecheck、routes index tests 或 API smoke 通过。
  - 证据：在 `legacy-retirement.test.ts` 新增 route retirement guard；RED 阶段 `pnpm --dir packages/studio exec vitest run src/app-next/legacy-retirement.test.ts --reporter=verbose` 因 `hooks-countdown.ts` / `poison-detector.ts` 仍存在失败；经确认后删除两个未挂载 route 文件，移除 `routes/index.ts` 注释导出、`server.ts` 注释 import/挂载残留、`tsconfig.json` 和 `tsconfig.server.json` 对这两个 route 的 exclude，并删除 `mock-debt-scan.ts` 中已删除 `poison-detector.ts` 的 allowlist 分支；Backend Contract matrix 将该 legacy router 条目改为已删除源码、unsupported 不可调用口径；`pnpm --dir packages/studio exec vitest run src/api/lib/mock-debt-scan.test.ts src/app-next/legacy-retirement.test.ts src/api/backend-contract-matrix.test.ts --reporter=verbose` 通过（3 files / 9 tests）；`pnpm --dir packages/studio exec tsc --noEmit --project tsconfig.json --pretty false` 通过；`pnpm docs:verify` 通过（84 markdown files / 22 directories）；`git diff --check` 无 whitespace error，仅 LF/CRLF 提示。

- [x] 9. 处理 legacy route 候选退役
  - `/api/chat/:bookId/*` 无 consumer 后删除 route/test/matrix 条目；仍有 consumer 时保留 process-memory 标注。
  - `/api/agent` 无 consumer 后从 route 中移除或标为正式退役。
  - `/api/pipeline`、`/api/monitor`、旧导出、旧 AI panel route 按合同状态保留或登记后续迁移条件。
  - 验证：Backend Contract matrix 与 route tests 一致。
  - 证据：重新搜索确认 standalone `ChatPanel.tsx` 与 `/api/chat/:bookId/*` 只剩自身测试、docs/matrix/mock debt 引用，未被 `StudioNextApp`/current route mount；`POST /api/agent` exact endpoint 未发现 frontend client/current docs/tests consumer，`/api/agent/config` 独立 current route 保留；先在 `legacy-retirement.test.ts` 与 `backend-contract-matrix.test.ts` 增加 RED guard，`pnpm --dir packages/studio exec vitest run src/app-next/legacy-retirement.test.ts src/api/backend-contract-matrix.test.ts --reporter=verbose` 如预期失败（3 failed：chat 文件仍存在、`app.post("/api/agent"` 仍存在、`legacy.book-chat.process-memory` 仍在 matrix）；经用户确认后删除 `routes/chat.ts`、`routes/chat.test.ts`、`components/ChatPanel.tsx`、`ChatPanel.test.tsx`，移除 `createChatRouter` export/server mount、`book-chat-history` mock debt 与 matrix 条目；从 `createAIRouter` 移除 exact `POST /api/agent`，Backend Contract matrix 改为 `legacy.ai-agent.unsupported` retired 口径；`/api/pipeline` 保留 process-memory，`/api/monitor` 保留 unsupported，旧导出与旧 AI panel 继续 deprecated 并登记迁移条件；`pnpm --dir packages/studio exec vitest run src/app-next/legacy-retirement.test.ts src/api/backend-contract-matrix.test.ts src/api/lib/mock-debt-ledger.test.ts src/api/routes/ai.test.ts src/api/routes/pipeline.test.ts src/api/routes/monitor.test.ts src/components/Admin/RequestsTab.test.tsx --reporter=verbose` 通过（7 files / 22 tests）；`pnpm --dir packages/studio typecheck` 通过；`pnpm docs:verify` 通过（84 markdown files / 22 directories）；`git diff --check` 无 whitespace error，仅 LF/CRLF 提示。

- [x] 10. 文档、变更记录与验收
  - 更新 `.kiro/specs/README.md`、CHANGELOG、Studio README、API 文档和 ToolCall README。
  - 运行 `pnpm --dir packages/studio test -- app-next`、受影响 API tests、`pnpm --dir packages/studio typecheck`、`pnpm docs:verify`。
  - 记录被删除路径、保留 legacy route 与未运行验证。
  - 证据：已更新 `.kiro/specs/README.md`、`CHANGELOG.md`、`README.md`、`AGENTS.md`、`packages/studio/README.md`、`docs/01-当前状态/03-当前执行主线.md`、`docs/06-API与数据契约/01-Studio API总览.md`、`docs/06-API与数据契约/02-创作工作台接口.md` 和 `components/ToolCall/README.md` 的旧源码退役/ConversationSurface/API 合同口径；删除路径包括 `app-next/StudioApp.tsx` 与测试、`app-next/workspace/**`、`app-next/editor/**`、旧 `ConversationPanel` / `GitChangesView` / `useStudioData`、`components/split-view/**`、`components/ChatWindow.tsx` / 测试 / manager、`routes/hooks-countdown.ts`、`routes/poison-detector.ts`、`routes/chat.ts` / 测试、`components/ChatPanel.tsx` / 测试；保留 legacy route 口径为 `/api/pipeline` process-memory、`/api/monitor` unsupported、旧导出入口与旧 AI panel route deprecated，`/api/agent/config` 继续 current，exact `POST /api/agent` retired unsupported；`pnpm --dir packages/studio test -- app-next` 通过（200 files / 1157 tests，输出含既有 React nested button warning、SQLite experimental warning 与 localstorage-file warning）；`pnpm --dir packages/studio exec vitest run src/app-next/legacy-retirement.test.ts src/api/backend-contract-matrix.test.ts src/api/lib/mock-debt-ledger.test.ts src/api/lib/mock-debt-scan.test.ts src/api/routes/ai.test.ts src/api/routes/pipeline.test.ts src/api/routes/monitor.test.ts src/api/routes/tools.test.ts src/api/routes/session.test.ts src/components/Admin/SessionsTab.test.tsx src/components/Admin/RequestsTab.test.tsx --reporter=verbose` 通过（11 files / 48 tests）；`pnpm --dir packages/studio typecheck` 通过；`pnpm docs:verify` 与 `git diff --check` 在本任务收口编辑后重新运行通过；未运行验证：无。
