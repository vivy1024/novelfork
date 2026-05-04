# Implementation Plan

## Overview

基于 backend-contract-v1 重建 Studio 前端底座：先建立合同 client，再实现 Agent Shell、单栏 Conversation、Writing Workbench、工具结果渲染与旧前端退役。

## Tasks

> `backend-contract-v1` 已完成验收；本 spec 从 Backend Contract client 接入与 Agent Shell 路由壳开始正式计入进度。

- [x] 1. 接入 Backend Contract client
  - 依赖 `backend-contract-v1` 的 capability status、session/resource/provider/writing action clients。
  - 在新前端中禁止组件散写未登记 API。
  - 验证：contract client 单测和 typecheck 通过。

- [x] 2. 建立 Agent Shell 路由壳
  - 新增 `app-next/shell/AgentShell.tsx`、`ShellSidebar.tsx`、`shell-route.ts`、`useShellData.ts`。
  - `/next`、`/next/narrators/:sessionId`、`/next/books/:bookId`、`/next/search`、`/next/routines`、`/next/settings` 统一在 shell 内切换。
  - 验证：路由和 sidebar active 状态测试。

- [x] 3. 实现 Conversation runtime
  - 新增 `agent-conversation/runtime/useAgentConversationRuntime.ts`、`ws-envelope-reducer.ts`、`session-actions.ts`。
  - 处理 snapshot、state、message、stream、error、ack、abort、resumeFromSeq。
  - 验证：runtime reducer 和 WebSocket envelope 单测。

- [ ] 4. 实现 Conversation surface
  - 新增 `ConversationSurface`、`MessageStream`、`MessageItem`、`ToolCallCard`、`ConfirmationGate`、`ConversationStatusBar`、`Composer`。
  - 移除旧 ChatWindow 常驻控制大卡片视觉层。
  - 验证：消息流、工具卡、确认门、状态栏、发送/中断测试。

- [ ] 5. 实现模型、权限与状态栏动作
  - 状态栏使用 provider/model/session config 合同。
  - 切换模型、权限、推理强度必须调用 session update。
  - 模型池为空或 unsupported-tools 时禁用发送并展示说明。
  - 验证：模型池为空、切换成功、切换失败、unsupported-tools 测试。

- [ ] 6. 建立 Tool Result Renderer Registry
  - 新增 `tool-results/` registry 与 cockpit、questionnaire、pgi、guided、candidate、narrative、generic renderer。
  - 支持 artifact 的“在画布打开”动作。
  - 验证：每个 renderer 至少一个 smoke test，unknown fallback 保留 raw data。

- [ ] 7. 实现 Writing Workbench 数据和资源树
  - 新增 `writing-workbench/useWorkbenchResources.ts`、`WorkbenchResourceTree.tsx`。
  - 通过 resource contract adapter 组装章节、候选稿、草稿、经纬、story/truth、叙事线资源节点。
  - 验证：资源节点类型、unsupported/readonly/edit capability 测试。

- [ ] 8. 实现 Workbench canvas 与资源 viewer
  - 新增 `WorkbenchCanvas.tsx` 和章节、候选稿、草稿、文本文件、工具结果 viewer。
  - 支持 dirty 状态、保存、只读、artifact 打开。
  - 验证：打开资源、保存章节/草稿、只读禁用、dirty canvasContext 测试。

- [ ] 9. 实现 Workbench 写作动作入口
  - 新增 `WorkbenchWritingActions.tsx`。
  - 续写、扩写、审校、生成下一章、去 AI 味、连续性检查等动作创建/复用绑定 bookId 的 session 并跳转 Conversation。
  - 验证：会话创建/复用、路由跳转、unsupported 动作禁用。

- [ ] 10. 切断主路由旧三栏依赖
  - `/next` 默认入口改为 Agent Shell + Conversation。
  - 旧 WorkspacePage 不再作为主路由默认内容。
  - 验证：全仓搜索主路由导入，typecheck 通过。

- [ ] 11. 迁移或删除失败三栏实验组件
  - 审计 `SplitView`、`EditorArea`、`ConversationPanel`、`useStudioData`、旧 ChatWindow floating/docked 依赖。
  - 有真实复用价值则迁移到新边界；无价值则从构建路径删除。
  - 验证：无 shim/noop adapter，相关测试更新。

- [ ] 12. 文档、变更记录与冒烟
  - 更新 README、Studio README、API/架构文档和 CHANGELOG。
  - 运行相关 Vitest、`pnpm --dir packages/studio typecheck`、`pnpm docs:verify`。
  - 手动冒烟：`/next` 对话、叙述者会话、书籍工作台、设置、套路、搜索、工具确认门。
