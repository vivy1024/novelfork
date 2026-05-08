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

## 真实进度说明

- Task 1-13：真实实现并接线到 runtime，有集成测试覆盖。
- Task 14-19：独立模块已实现（real-tool-handlers、permission-pipeline、mcp-client-runtime、subagent-runtime、context-compaction），但**尚未接线到 session-chat-service / session-tool-executor / agent-turn-runtime**。
- Task 20-24：独立模块已实现（provider-validation、command-enabled-registry、novel-write-next-handler、novel-init-handler、novel-audit-handler），但**尚未接线到真实 API 路由和 command executor**。
- Task 25-33：独立模块已实现（agent-context 扩展、writing-mode-tool、runtime-integrations），但**尚未接线到 session runtime**。
- Task 34-48：未实现。

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

### Phase 2.5：独立模块实现（底座，未接线）

- [x] 14. 实现真实工具执行模块：BashTool / FileRead / FileWrite / FileEdit
  - 状态：`real-tool-handlers.ts` 已实现，11 tests passed。未接线到 session-tool-executor。

- [x] 15. 实现权限管线模块：路径验证、危险模式检测、bash 分类器
  - 状态：`permission-pipeline.ts` 已实现，18 tests passed。未接线到 session-tool-policy。

- [x] 16. 实现 sandbox mode enforcement 模块
  - 状态：集成在 permission-pipeline.ts 中。未接线到 session runtime。

- [x] 17. 实现 MCP client 模块：stdio 连接、列工具、执行
  - 状态：`mcp-client-runtime.ts` 已实现，3 tests passed。未接线到 session-tool-registry。

- [x] 18. 实现子代理模块：AsyncGenerator 循环、abort、transcript
  - 状态：`subagent-runtime.ts` 已实现，5 tests passed。未接线到 session-tool-executor。

- [x] 19. 实现上下文压缩模块：tiktoken、阈值触发、post-compact 恢复
  - 状态：`context-compaction.ts` 已实现，5 tests passed。未接线到 session-chat-service。

- [x] 20. 实现 provider 验证模块
  - 状态：`provider-validation.ts` 已实现，4 tests passed。未接线到设置页 API。

- [x] 21. 实现 command enable/disable 模块
  - 状态：`command-enabled-registry.ts` 已实现，5 tests passed。未接线到 command executor。

- [x] 22. 实现 `/novel:write-next` handler 模块
  - 状态：`novel-write-next-handler.ts` 已实现，3 tests passed。未接线到 command registry handler。

- [x] 23. 实现 `/novel:init` handler 模块
  - 状态：`novel-init-handler.ts` 已实现，2 tests passed。未接线到 command registry handler。

- [x] 24. 实现 `/novel:audit` handler 模块
  - 状态：`novel-audit-handler.ts` 已实现，3 tests passed。未接线到 command registry handler。

- [x] 25. 实现 agent context 叙事线/经纬扩展
  - 状态：`agent-context.ts` 已扩展，4 tests passed。未在 session-chat-service 中真实调用 narrative/jingwei API。

- [x] 26. 实现写作模式工具模块
  - 状态：`writing-mode-tool.ts` 已实现，4 tests passed。未注册到 session-tool-registry。

- [x] 27. 实现 MCP bridge / hook executor / AgentTool handler 模块
  - 状态：`runtime-integrations.ts` 已实现，5 tests passed。未接线到 agent-turn-runtime。

### Phase 3：接线——将独立模块接入 session runtime（未完成）

- [ ] 28. 将 real-tool-handlers 接入 session-tool-executor
  - 目标：session-tool-executor 的 `getDefaultHandler` 中注册 Bash/Read/Write/Edit，调用 real-tool-handlers。
  - 验证：在真实 session chat 中发送消息触发 Bash 工具，返回真实 shell 输出。

- [ ] 29. 将 permission-pipeline 接入 session-tool-policy
  - 目标：`resolveSessionToolPolicy()` 调用 `validateToolPermission()` 和 `classifyBashCommand()`。
  - 验证：session 中执行 `rm -rf /` 被 permission pipeline 拦截。

- [ ] 30. 将 context-compaction 接入 session-chat-service
  - 目标：session chat 的 agent turn 前检查 token 阈值，超过时调用 autoCompact。
  - 验证：长对话自动触发压缩，压缩后消息数减少但关键上下文保留。

- [ ] 31. 将 MCP client 接入 session-tool-registry
  - 目标：MCP server 连接后，工具自动出现在 session tool list。
  - 验证：`/tools` 命令输出包含 MCP 工具。

- [ ] 32. 将 subagent-runtime 接入 session-tool-executor 的 AgentTool
  - 目标：session 中模型调用 AgentTool 时启动真实子代理。
  - 验证：agent turn 中 AgentTool 调用返回子代理执行结果。

- [ ] 33. 将 hook-executor 接入 agent-turn-runtime
  - 目标：agent turn 的 tool loop 中调用 before_tool/after_tool hooks。
  - 验证：注册 hook 后工具执行前后 hook 被调用。

- [ ] 34. 将 command-enabled-registry 接入 command-executor
  - 目标：command executor 执行前检查 isEnabled，禁用命令返回 command_disabled。
  - 验证：禁用 `/compact` 后执行返回 disabled error。

- [ ] 35. 将 novel handlers 接入 command registry
  - 目标：`/novel:write-next`、`/novel:init`、`/novel:audit` 的 handler 从 planned 变为 current。
  - 验证：执行 `/novel:init` 真实创建书籍目录。

- [ ] 36. 将 writing-mode-tool 注册到 session-tool-registry
  - 目标：session tool list 包含 writing.continue/rewrite/expand/polish。
  - 验证：agent turn 中调用 writing.continue 返回真实生成内容。

- [ ] 37. 将 narrative/jingwei 数据真实注入 agent turn
  - 目标：session-chat-service 在 agent turn 前从 API 获取叙事线/经纬数据并传入 buildAgentContext。
  - 验证：agent 的 system prompt 包含真实叙事线节点和经纬设定。

### Phase 4：端到端验收（未完成）

- [ ] 38. Studio E2E：session 中执行 Bash 工具
  - 验证：Playwright 或 integration test 覆盖 WebSocket session → Bash 工具 → 真实输出。

- [ ] 39. CLI/headless E2E：`novelfork exec` 完整链路
  - 验证：CLI 调用 headless chat → agent turn → tool execution → NDJSON 输出。

- [ ] 40. `/novel:write-next` E2E：context → plan → candidate
  - 验证：从 session 输入到候选稿生成的完整链路。

- [ ] 41. `/novel:init` E2E：命令执行到文件系统
  - 验证：执行命令后文件系统有真实书籍目录。

- [ ] 42. Permission E2E：危险命令被拦截
  - 验证：session 中尝试 `rm -rf /` 被 permission pipeline 阻止。

- [ ] 43. MCP E2E：MCP server 工具可调用
  - 验证：连接 MCP server 后 agent 可调用其工具。

- [ ] 44. Subagent E2E：主 agent 调用子代理
  - 验证：agent turn 中 AgentTool 启动子代理并返回结果。

- [ ] 45. Context compact E2E：长对话自动压缩
  - 验证：超过 token 阈值后自动压缩，对话可继续。

### Phase 5：文档与发布标准（未完成）

- [ ] 46. 更新文档为真实 Agent 产品化口径
  - 诚实标注 current/partial/planned。

- [ ] 47. 汇总端到端证据与未兑现能力 backlog

- [ ] 48. 最终全量验证与收尾
  - 运行 Studio 全量测试、CLI 测试、Core 测试、typecheck、docs verify。
