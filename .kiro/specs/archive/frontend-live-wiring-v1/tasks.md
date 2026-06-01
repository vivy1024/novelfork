# Frontend Live Wiring v1 Tasks

## Overview

把 `frontend-refoundation-v1` 已完成的 Agent Shell、Conversation runtime/surface、Writing Workbench、Backend Contract clients 和 Tool Result Renderer 真正接入 `/next` live route。完成后，旧三栏仍可在后续 spec 删除，但当前用户路径必须不再是空壳或 noop。

## Tasks

- [x] 1. 建立 live wiring 回归基线
  - 新增/更新 `StudioNextApp` route tests，断言 narrator route 使用 runtime 数据、book route 使用真实资源加载状态。
  - 加入 guard，禁止 `/next/books/:bookId` 继续传 `nodes=[]`、`selectedNode=null`、noop save/open。
  - 验证：相关 app-next route tests 先失败后修复。

- [x] 2. 接通 Narrator Conversation runtime
  - 在 `/next/narrators/:sessionId` 调用 `useAgentConversationRuntime`。
  - 将 snapshot/state/message/stream/error/recovery 映射到 `ConversationSurface`。
  - 接通 send、abort、ack、loading、missing session 和 runtime error 状态。
  - 验证：覆盖 hydrate、发送、流式追加、中断、缺失会话。

- [x] 3. 接通状态栏模型、权限与推理配置
  - 使用 provider domain client 加载真实模型池。
  - 使用 session domain client 更新 `sessionConfig`。
  - 模型池为空、config 更新失败、unsupported-tools 均给出真实 UI 状态。
  - 验证：模型池为空禁发、切换成功、切换失败、unsupported-tools 测试。

- [x] 4. 将 Tool Result Renderer Registry 接入消息流
  - 让 `MessageItem`/`ToolCallCard` 使用 `tool-results/registry.tsx`。
  - 支持 cockpit、questionnaire、pgi、guided、candidate、narrative 与 generic fallback。
  - artifact open 动作必须连接 Workbench 或显示 disabled reason。
  - 验证：每类 renderer 至少一个 route/surface smoke test。

- [x] 5. 接通 session tool confirmation 刷新链路
  - 将 pending confirmation 映射到 `ConfirmationGate`。
  - 批准/拒绝调用 `/api/sessions/:id/tools/:toolName/confirm`。
  - 决策后刷新 snapshot 或应用返回 snapshot。
  - 验证：批准、拒绝、确认失败、重复确认测试。

- [x] 6. 接通 Writing Workbench 资源加载
  - `/next/books/:bookId` 使用 resource domain client 调 `loadWorkbenchResourcesFromContract()`。
  - 维护 loading/error/nodes/selectedNode 状态。
  - 点击资源树节点后在 canvas 打开。
  - 验证：章节、候选稿、草稿、story/truth、经纬、叙事线和 unsupported 节点测试。

- [x] 7. 接通 Workbench canvas 保存与 dirty context
  - 根据 resource capability 执行章节/草稿/文本资源保存。
  - readonly/unsupported 禁用保存并显示原因。
  - 输出 active resource、dirty、selection/open tabs 的 canvasContext。
  - 验证：保存成功、保存失败保持 dirty、只读禁用、canvasContext 注入测试。

- [x] 8. 接通 Workbench 写作动作到会话
  - `WorkbenchWritingActions` 创建或复用绑定 bookId 的 writer session。
  - 成功后导航 `/next/narrators/:sessionId`。
  - action disabled/unsupported/prompt-preview 状态必须来自 writing action adapter。
  - 验证：复用 session、新建 session、跳转、unsupported 禁用测试。

- [x] 9. 接通 Search、Routines、Settings 页面
  - `/next/search` 挂载真实搜索页面或 contract unsupported 状态。
  - `/next/routines` 挂载 routines/MCP/skills 管理页面。
  - `/next/settings` 挂载 provider/runtime/settings 面板，确保模型配置入口可达。
  - 验证：三个 route 不再出现“稍后接线”当前事实文案。

- [x] 10. 文档、变更记录与冒烟验收
  - 更新 `.kiro/specs/README.md`、CHANGELOG、必要的 Studio 文档。
  - 运行 `pnpm --dir packages/studio test -- app-next`、`pnpm --dir packages/studio typecheck`、`pnpm docs:verify`。
  - 手动冒烟 `/next`、`/next/narrators/:id`、`/next/books/:id`、settings、routines、search。
  - 未运行的验证必须明确记录。
  - 2026-05-06 验收记录：已更新 spec 索引、CHANGELOG、README、Studio README、当前状态/执行主线、Studio 架构与测试状态文档；`pnpm --dir packages/studio test -- app-next` 通过（Vitest 参数转发实际运行 210 files / 1276 tests），`pnpm --dir packages/studio typecheck` 通过，`pnpm docs:verify` 通过（84 markdown files / 22 directories）。手动冒烟使用 Vite `http://127.0.0.1:4567` + API server `4569`：`/next` 显示 Agent Shell 与真实书籍/会话；`/next/narrators/1e758446-5d77-42cf-b8be-ef6e87013a97` 显示 live 会话、模型池、工具结果 renderer；`/next/books/agent-检验-202605030757` 显示资源树、能力标签与写作动作；`/next/settings` 显示模型设置与 AI 供应商入口；`/next/routines` 显示命令/工具/权限/技能/MCP 管理；`/next/search` 显示全局搜索。冒烟中发现并修复了 WebSocket CONNECTING 期间自动 ack 触发 `InvalidStateError` 的真实浏览器空白问题，补充 `useAgentConversationRuntime` 队列测试并验证通过。
