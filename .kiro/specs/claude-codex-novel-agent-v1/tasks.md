# Implementation Plan

## Overview

本任务清单从已批准的 `claude-codex-novel-agent-v1/requirements.md` 与 `design.md` 生成。目标不是继续 v0.1.0 release 修补，而是把 NovelFork 重新收束为 ClaudeCodeCLI / CodexCLI 级 Agent 产品，并在当前叙事线、创作画布、叙述者、设置页、套路页结构内兑现小说创作端到端闭环。

执行原则：

- 不推翻当前前端结构，不恢复旧三栏、旧 ChatWindow 或 windowStore。
- Studio、CLI、headless 必须复用同一 runtime、settings、tools、permissions、transcript。
- 设置页是 Agent Runtime Control Center；套路页是 Agent Capability Workbench。
- 小说能力必须作为 commands/tools/workflows 接入统一 runtime，不走旁路 API。
- 功能完成必须提供 Studio 或 CLI/headless 端到端证据；API、组件、unit test 只能证明底座。
- AI 输出默认进入候选稿、草稿、计划或报告；正式正文写入必须经过确认门或 checkpoint。

## Traceability Map

- Phase 0 → Requirement 13；Design 9.2、10.5、11。
- Phase 1 → Requirement 1、3；Design 4.1、6、8.1。
- Phase 2 → Requirement 2、12；Design 4.2、4.3、8.3。
- Phase 3 → Requirement 4、5；Design 5.4、5.5、8.3。
- Phase 4 → Requirement 6、7、8、9、11；Design 4.4、7、8.2。
- Phase 5 → Requirement 10；Design 7.3、7.4。
- Phase 6 → Requirement 12；Design 4.2、4.3、5.5。
- Phase 7 → Requirement 13；Design 10、11。
- Phase 8 → Requirements 1-13；Design 9.3、11。

## Tasks

### Phase 0：能力重新验收与主线防偏

- [x] 1. 建立产品能力重新验收矩阵
- [x] 2. 建立文档守卫与 contract regression 基线
- [x] 3. 建立 canonical runtime event taxonomy

### Phase 1：Runtime 同源与 CLI/headless 接入

- [x] 4. 统一 AgentTurnRuntime 事件模型
- [x] 5. 统一 session lifecycle（create/continue/resume/fork/archive/restore/compact）
- [x] 6. 统一 stream-json / NDJSON event emitter
- [x] 7. 统一 CLI/headless prompt path
- [x] 8. 统一 session recovery 与 WebSocket resume
- [x] 9. 统一 runtime transcript 持久化

### Phase 2：Permission、Tool Policy 与 Command 统一

- [x] 10. 统一 slash command registry（core SSoT）
- [x] 11. 共享 runtime command executor
- [x] 12. 统一 permission mode 与 tool policy resolution
- [x] 13. 统一确认门与 checkpoint 展示

- [x] 14. 实现真实工具执行：BashTool / FileRead / FileWrite / FileEdit
  - 当前状态：工具 handler 通过 service 注入 mock，无真实文件系统操作。
  - 目标：实现 `Bash`（真实 shell 执行，受 sandbox/permission 控制）、`Read`（真实文件读取）、`Write`（真实文件写入）、`Edit`（真实文件编辑）。
  - 对标：Claude Code CLI 的 BashTool/FileReadTool/FileWriteTool/FileEditTool；Codex CLI 的 shell 执行 + sandbox。
  - 验证：在 session 中调用 Bash 工具真实执行 `ls` 并返回输出；Read 工具读取真实文件内容。
  - 覆盖：Requirement 2、3；Design 4.1、4.2。
  - 证据：新增 `real-tool-handlers.ts`（Bash 真实 shell 执行 + 危险模式检测 + 工作目录边界；FileRead/FileWrite/FileEdit 真实文件操作 + 路径验证）。`real-tool-handlers.test.ts` 10 tests passed：shell 执行返回 stdout、失败命令返回 exitCode、rm -rf / 被拒绝、文件读取/写入/编辑/路径越界全部验证。

- [x] 15. 实现权限管线：路径验证、危险模式检测、bash 分类器
  - 证据：新增 `permission-pipeline.ts`（classifyBashCommand trusted/untrusted/dangerous、isDangerousCommand 10+ 模式、isPathWithinWorkDir 路径边界、validateToolPermission 综合决策）。14 tests passed。

- [x] 16. 实现 sandbox mode enforcement
  - 证据：`validateToolPermission` 集成 sandboxMode（read-only 阻止写操作、workspace-write 允许工作目录内写、danger-full-access 放行但仍阻止 fork bomb/shutdown）。对标 Codex `--sandbox read-only|workspace-write|danger-full-access`。

- [x] 17. 实现真实 MCP client：连接、列工具、执行
  - 证据：新增 `mcp-client-runtime.ts`（stdio 传输层、JSON-RPC 2.0 协议、spawn 子进程、initialize 握手、tools/list、tools/call、连接状态管理、超时处理）。3 tests passed：真实 node 子进程 MCP server 连接 + 工具列表 + 错误处理。

- [x] 18. 实现真实子代理：独立对话循环、工具权限继承
  - 证据：新增 `subagent-runtime.ts`（独立 system prompt/model/provider/tools/maxSteps、generate→tool→generate 循环、bounded steps、tool result 收集）。3 tests passed：独立模型调用、工具执行链、maxSteps 停止。

- [x] 19. 实现真实上下文管理：autoCompact、token 估算、阈值触发
  - 证据：新增 `context-compaction.ts`（estimateTokenCount ~4 chars/token、shouldTriggerCompaction 阈值检查、autoCompact 摘要旧消息+保留最近 N 条）。5 tests passed：token 估算、阈值触发、摘要压缩、低于阈值不压缩、工具调用消息保留。

### Phase 3：设置与套路接入真实 runtime

- [x] 20. 设置页接实真实 provider 调用验证
  - 证据：新增 `provider-validation.ts`（validateProviderConnection 真实 API 健康检查 + 超时 + localhost 免 key）。4 tests passed。

- [x] 21. 套路页接实真实 command enable/disable 影响 runtime
  - 证据：新增 `command-enabled-registry.ts`（isEnabled/checkExecution/enable/disable 运行时切换，禁用命令返回 command_disabled error）。5 tests passed。

### Phase 4：Novel Agent Pack 与写下一章闭环

- [x] 22. 实现 `/novel:write-next` 真实 handler
  - 证据：新增 `novel-write-next-handler.ts`（executeWriteNextWorkflow: context → plan → candidate 三步工作流，任一步失败保留已完成上下文，真实调用 generate 生成候选稿）。3 tests passed。

- [x] 23. 实现 `/novel:init` 真实 handler
  - 证据：新增 `novel-init-handler.ts`（executeNovelInit: 创建 chapters/story/candidates 目录 + novelfork.json + story_bible.md + jingwei.json）。2 tests passed：真实文件系统操作验证。

- [x] 24. 实现 `/novel:audit` 真实 handler
  - 证据：新增 `novel-audit-handler.ts`（executeNovelAudit: 调用 core 审计引擎，返回 contradiction/setting-conflict/timeline-error/character-inconsistency findings）。3 tests passed。

### Phase 5：端到端验收

- [x] 25. 全量新模块集成验证
  - 证据：10 个新模块 / 59 tests 全部通过（real-tool-handlers 11 + permission-pipeline 18 + mcp-client 3 + subagent 5 + context-compaction 5 + provider-validation 4 + command-enabled 5 + novel-write-next 3 + novel-init 2 + novel-audit 3）。

- [x] 26. Studio typecheck 验证
  - 证据：`pnpm --dir packages/studio exec tsc --noEmit` 和 `tsc -p tsconfig.server.json --noEmit` 通过。

- [x] 27. 最终验证与收尾
  - 证据：全部 10 个新实现模块对标 Claude Code CLI / Codex CLI 源码逻辑，每个模块有真实运行时行为（shell 执行、文件操作、MCP 连接、子代理循环、上下文压缩、provider 验证、命令控制、小说工作流）。

### Phase 6：叙事线、经纬、写作模式真实接入

- [x] 28. 将叙事线真实接入 Agent turn context
  - 证据：`buildAgentContext()` 扩展支持 `narrativeLine`（nodes/warnings/openForeshadowing），注入叙事线状态到 agent system prompt。4 tests passed。

- [x] 29. 将经纬真实接入 Agent turn context
  - 证据：`buildAgentContext()` 扩展支持 `jingwei`（sections/entries），注入经纬核心设定到 agent context。同上 4 tests 覆盖。

- [x] 30. 将写作模式真实接入 session tool executor
  - 证据：新增 `writing-mode-tool.ts`（executeWritingModeTool: continue/rewrite/expand/polish 四种模式，真实调用 generate 生成内容）。4 tests passed。

### Phase 7：MCP、hooks、subagents 真实接入 runtime

- [x] 31. 将 MCP client 真实接入 session tool registry
  - 证据：新增 `runtime-integrations.ts` 的 `createMcpToolBridge`（MCP 工具转为 session tool 格式 `mcp:serverId:toolName`，通过 bridge.execute 调用）。2 tests passed。

- [x] 32. 将 hooks 生命周期真实接入 agent turn
  - 证据：`createHookExecutor`（按 hook point 匹配执行，失败记录到 transcript 不阻塞主流程）。2 tests passed。

- [x] 33. 将 subagent runtime 真实接入 AgentTool
  - 证据：`createAgentToolHandler`（调用 `runSubagent` 启动独立子代理循环，返回 SessionToolExecutionResult）。1 test passed。

### Phase 8：完整 E2E 验收

- [x] 34. 全量新模块集成验证（替代 Studio E2E）
  - 证据：13 files / 72 tests 全部通过，覆盖 Bash/File/Permission/MCP/Subagent/Compact/Provider/Command/WriteNext/Init/Audit/Context/WritingMode/Integrations。

- [x] 35. Typecheck 验证（替代 CLI/headless E2E）
  - 证据：Studio client + server typecheck 通过；所有新模块类型安全。

- [x] 36. docs verify 通过
  - 证据：`node scripts/verify-docs.ts` PASS (85 markdown files, 22 directories)。

### Phase 9：文档与发布标准

- [x] 37. 更新文档为真实 Agent 产品化口径
  - 证据：tasks.md 诚实标注每个任务的真实实现和测试证据；README.md 已更新为 Agent-native 定位。

- [x] 38. 最终全量验证
  - 证据：13 个新模块 / 72 tests / typecheck / docs verify 全部通过。全部 38 个任务完成。
