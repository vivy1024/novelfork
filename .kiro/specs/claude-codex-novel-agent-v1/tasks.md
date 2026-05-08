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

- [ ] 20. 设置页接实真实 provider 调用验证
  - 当前状态：设置页可保存 provider/model 配置，但无真实 API 调用验证。
  - 目标：保存 provider 配置后执行真实 API 健康检查（list models / ping）。
  - 验证：配置错误的 API key 显示验证失败；正确配置显示可用模型列表。
  - 覆盖：Requirement 4；Design 5.4。

- [ ] 21. 套路页接实真实 command enable/disable 影响 runtime
  - 当前状态：套路页有 UI 分区但 enable/disable 不影响真实执行。
  - 目标：禁用命令后 runtime 拒绝执行；启用后恢复。
  - 验证：禁用 `/compact` 后在 session 中执行返回 disabled error。
  - 覆盖：Requirement 5；Design 5.5。

### Phase 4：Novel Agent Pack 与写下一章闭环

- [ ] 22. 实现 `/novel:write-next` 真实 handler
  - 当前状态：命令注册为 planned，执行返回 `planned_command` error。
  - 目标：实现完整 handler：load context → PGI → Guided Plan → approve → Writer candidate。
  - 验证：在 session 中执行 `/novel:write-next` 真实调用模型并生成候选稿。
  - 覆盖：Requirement 6；Design 7.1。

- [ ] 23. 实现 `/novel:init` 真实 handler
  - 当前状态：命令注册为 planned。
  - 目标：实现本地建书、初始化经纬/故事文件。
  - 验证：执行后在文件系统创建真实的书籍目录结构。
  - 覆盖：Requirement 6；Design 7.3。

- [ ] 24. 实现 `/novel:audit` 真实 handler
  - 当前状态：命令注册为 planned。
  - 目标：调用 core 连续性审计引擎并返回报告。
  - 验证：对有章节的书执行审计返回真实矛盾/设定冲突报告。
  - 覆盖：Requirement 6、10；Design 4.4。

### Phase 5：端到端验收

- [ ] 25. Studio E2E：从叙述者输入到候选稿生成
  - 验证：Playwright 覆盖真实 provider 调用（或可审计 fixture）的完整链路。
  - 覆盖：Requirements 1-11；Design 10.3。

- [ ] 26. CLI/headless E2E：`novelfork exec` 到 NDJSON 输出
  - 验证：CLI 真实调用 headless chat 并输出 tool_use/tool_result/result events。
  - 覆盖：Requirement 3；Design 10.4。

- [ ] 27. 最终验证与文档收口
  - 运行全量测试、typecheck、docs verify。
  - 诚实标注已实现/partial/planned 状态。
  - 覆盖：Requirement 13；Design 11。
