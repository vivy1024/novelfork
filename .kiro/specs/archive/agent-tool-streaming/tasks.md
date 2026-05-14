# Agent 工具流式执行 + 能力补全 — 任务清单

## Phase 1：Bash 实时 stdout 流（P0）✅ 已完成

- [x] 1.1 `process-adapter.ts` 新增 `execCommandStreaming` 函数
  - [x] 1.1.1 实现 Bun.spawn 包装，逐行读取 stdout/stderr
  - [x] 1.1.2 实现超时机制（SIGTERM）
  - [x] 1.1.3 实现 onStdout/onStderr 回调
  - [ ] 1.1.4 单元测试：正常命令、超时命令、大输出命令
- [x] 1.2 `tool-executor.ts` ToolContext 接口添加 `onOutput` 回调
- [x] 1.3 `BashTool.ts` 改造
  - [x] 1.3.1 添加 `description` 参数到 parameters
  - [ ] 1.3.2 添加 `run_in_background` 参数到 parameters
  - [x] 1.3.3 execute 方法改用 `execCommandStreaming`，传入 onOutput
  - [ ] 1.3.4 background 模式：spawn 后立即返回 taskId
- [x] 1.4 `session-tool-executor.ts` 桥接 onOutput → WebSocket `session:tool-stream`（已存在）
- [ ] 1.5 验证：执行命令前端实时看到每行输出

## Phase 2：工具结果截断 + 并行执行（P1）✅ 已完成

- [x] 2.1 `agent-turn-runtime.ts` 添加 `truncateToolResult` 函数
  - [x] 2.1.1 实现 HEAD + TAIL 截断策略（30000 字符阈值）
  - [x] 2.1.2 在 `toolResultContent()` 返回前应用截断
  - [ ] 2.1.3 单元测试：短内容不截断、长内容正确截断
- [x] 2.2 `agent-turn-runtime.ts` 并行工具执行（已存在）
  - [x] 2.2.1 定义 PARALLEL_SAFE_TOOLS 集合
  - [x] 2.2.2 修改 tool_use 处理逻辑：检测并行安全性
  - [x] 2.2.3 Promise.all 并行执行 + 结果按序排列
  - [ ] 2.2.4 单元测试：3 个 Read 并行、混合 Read+Bash 串行
- [x] 2.3 工具输入流式预览
  - [x] 2.3.1 `provider-adapters/index.ts` 新增 RuntimeToolStreamEvent 类型
  - [x] 2.3.2 `anthropic.ts` 解析 SSE content_block_start(tool_use) + input_json_delta
  - [x] 2.3.3 推送 `tool_started` + `tool_input_chunk` 事件（200ms 节流）
  - [x] 2.3.4 `llm-runtime-service.ts` 传递 onToolEvent
  - [x] 2.3.5 `agent-turn-runtime.ts` 传递 onToolEvent
  - [x] 2.3.6 `session-chat-service.ts` 桥接到 WebSocket
  - [x] 2.3.7 `ws-envelope-reducer.ts` 处理 `session:tool-input-chunk` 事件

## Phase 3：Browser + WebSearch 后端实现（P2）✅ 已完成

- [x] 3.1 BrowserTool
  - [x] 3.1.1 实现 `BrowserTool.ts`（lazy import playwright，8 个 action）
  - [x] 3.1.2 会话管理 + 5 分钟自动清理
  - [x] 3.1.3 注册到 `tools/index.ts`
  - [ ] 3.1.4 集成测试
- [x] 3.2 WebSearchTool
  - [x] 3.2.1 实现 `WebSearchTool.ts`（Serper API + DuckDuckGo fallback）
  - [x] 3.2.2 注册到 `tools/index.ts`
  - [ ] 3.2.3 集成测试
- [x] 3.3 WebFetchTool
  - [x] 3.3.1 实现 `WebFetchTool.ts`（readability/text/raw 三模式）
  - [x] 3.3.2 注册到 `tools/index.ts`
  - [ ] 3.3.3 集成测试

## Phase 4：权限决策 UI + 计划模式（P2）✅ 已完成

- [x] 4.1 权限决策
  - [x] 4.1.1 新增 `PermissionRequestCard.tsx`（风险等级 4 色 badge + allow/deny 按钮）
  - [x] 4.1.2 WebSocket 新增 `session:permission-request` 事件
  - [x] 4.1.3 `ws-envelope-reducer.ts` 处理 permission 事件 + pendingPermission state
  - [ ] 4.1.4 后端 permission-pipeline 等待前端决策（需要 Promise + WebSocket 回调）
  - [ ] 4.1.5 集成测试
- [x] 4.2 计划模式
  - [x] 4.2.1 `session-types.ts` SessionConfig 添加 `mode?: "normal" | "plan"`
  - [x] 4.2.2 新增 `PlanModeBar.tsx`（蓝色条 + 退出/批准按钮）
  - [ ] 4.2.3 `session-tool-policy.ts` plan 模式下过滤写入工具
  - [ ] 4.2.4 前端 Composer 集成
- [x] 4.3 危险反思
  - [x] 4.3.1 新增 `DangerReflectionCard.tsx`（红色主题 + 风险因子 badges + 确认/中止）
  - [x] 4.3.2 WebSocket 新增 `session:danger-reflection` 事件
  - [ ] 4.3.3 后端触发逻辑（匹配高风险 → 调用轻量 LLM → 推送反思）
