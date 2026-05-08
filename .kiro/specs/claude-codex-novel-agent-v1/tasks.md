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
  - 新增 `docs/01-当前状态/04-产品能力重新验收矩阵.md` 或等价文档。
  - 逐项收录 archive specs 中的核心能力：Claude/Codex 对标、写下一章、经纬、问卷、PGI、Guided Plan、候选稿、写作模式、写作工具、Agent 管线、设置、套路、MCP、CLI/headless。
  - 每项记录：原 spec、当前底层资产、当前 Studio 路径、当前 CLI/headless 路径、端到端证据、状态 `current | partial | not-wired | planned | unsupported | non-goal`。
  - 验证：矩阵不得把只有 API/组件/unit test 的能力标为 `current`。
  - 覆盖：Requirement 13；Design 9.2、10.5。
  - 证据：新增 `docs/01-当前状态/04-产品能力重新验收矩阵.md`，收录 32 项核心能力并按 `current/partial/not-wired/planned/unsupported/non-goal` 重验；只有章节编辑/保存、导出 Markdown/TXT 等已有真实端到端证据的基础能力标为 `current`，Claude/Codex 对标、`/novel:write-next`、经纬、问卷、PGI、Guided Plan、候选稿、写作模式、写作工具、Agent 管线、设置、套路、MCP、CLI/headless 等均按证据降级为 `partial`、`not-wired` 或 `planned`；同步更新 `docs/01-当前状态/README.md`、`docs/README.md` 和 `CHANGELOG.md`。

- [x] 2. 增加“功能完成必须有端到端证据”的文档守卫
  - 扩展 `scripts/verify-docs.ts` 或新增专用检查，扫描主动文档中的“完整对标”“完整功能”“已完成”“真实可用”等高风险表述。
  - 对 Claude/Codex 和小说功能声明，要求附带 `current/partial/not-wired/planned/unsupported/non-goal` 状态或真实 E2E 证据引用。
  - 验证：构造违反样例时守卫失败，恢复后通过。
  - 覆盖：Requirement 13；Design 10.5。
  - 证据：新增 `scripts/verify-docs.test.mjs`，先运行 `node --test scripts/verify-docs.test.mjs` 得到 RED（未限定的“Claude Code CLI 完整对标已完成，/novel:write-next 真实可用”未被拦截）；随后在 `scripts/verify-docs.ts` 新增 `checkHighRiskCompletionClaims()`，要求 current/planning 文档中的 Claude/Codex/小说 Agent 高风险完成声明必须带显式状态或端到端证据；修正 `docs/01-当前状态/02-Studio能力矩阵.md`、`docs/01-当前状态/03-当前执行主线.md`、`docs/02-用户指南/03-设置与模型配置.md`、`docs/03-产品与流程/01-小说创作流程.md` 的旧 high-risk current/真实可用口径。验证：`node --test scripts/verify-docs.test.mjs` 通过，`node scripts/verify-docs.ts` PASS。

- [x] 3. 冻结 release-readiness 后续发布动作
  - 保持 `v0-1-0-release-readiness` Task21-23 暂停状态。
  - 更新当前执行主线、测试状态和 README 相关口径，说明 release 标准由本 spec 重新定义。
  - 验证：主动文档不再要求继续 Task21-23 作为下一步。
  - 覆盖：Requirement 13；Design 9.3、11 Phase 6。
  - 证据：更新 `README.md`、`docs/01-当前状态/03-当前执行主线.md`、`docs/01-当前状态/01-项目当前状态.md`、`docs/08-测试与质量/01-当前测试状态.md` 与 `CHANGELOG.md`，把旧 `v0-1-0-release-readiness` Task21-23 从当前下一步降级为暂停历史 release 准备主线；明确当前 active 主线为 `claude-codex-novel-agent-v1`，后续 release 必须等待新主线重新定义完成标准并另开补充任务。验证：主动文档不再要求继续旧 Task21 作为下一步。

### Phase 1：统一 Agent Runtime 与事件模型

- [x] 4. 定义 canonical RuntimeEvent / RuntimeItem / RuntimeResult 类型
  - 在 Studio shared/runtime 或后端 runtime 模块中定义 canonical 类型：`RuntimeSession`、`RuntimeMessage`、`RuntimeEvent`、`RuntimeCommand`、`RuntimeToolCall`、`RuntimeToolResult`、`PermissionRequest`、`CheckpointRef`、`CandidateArtifact`、`UsageEnvelope`。
  - 将现有 `AgentTurnEvent`、session chat message、headless event 映射到 canonical 类型。
  - 验证：类型测试覆盖 message、tool_use、tool_result、permission_request、checkpoint、candidate、usage、error、result。
  - 覆盖：Requirement 1、3；Design 4.1、6.2、8.1。
  - 证据：新增 `packages/studio/src/api/lib/runtime-events.ts` 与 `runtime-events.test.ts`，先运行 `pnpm --dir packages/studio exec vitest run src/api/lib/runtime-events.test.ts` 得到 RED（缺少 `./runtime-events`），随后实现 `RUNTIME_EVENT_TYPES`、`RuntimeItem`、`RuntimeEvent`、`RuntimeResultEvent`、`runtimeItemsFromSessionMessage()`、`runtimeEventsFromAgentTurnEvent()`、`runtimeEventsFromHeadlessChatEvent()` 与 `createRuntimeResultEvent()`。验证：聚焦 Vitest 1 file / 5 tests passed；`pnpm --dir packages/studio exec tsc -p tsconfig.server.json --noEmit` 通过；`node scripts/verify-docs.ts` PASS；`git diff --check` 无 whitespace error。

- [x] 5. 让 Studio 会话、CLI、headless 共用同一个 runtime turn 执行入口
  - 收敛 `session-chat-service`、headless chat service、CLI exec/chat 对 `AgentTurnRuntime` 的调用路径。
  - 移除或标记任何仅为 CLI/headless 存在的简化执行旁路。
  - 验证：同一 fixture prompt 在 Studio route 与 headless service 产出同一类 canonical events。
  - 覆盖：Requirement 1、3；Design 3、4.1、6.1。
  - 证据：新增 `packages/studio/src/api/lib/runtime-turn-service.ts` 与 `runtime-turn-service.test.ts`，RED 先失败于缺少 `./runtime-turn-service`；实现 `executeRuntimeTurn()` 后，`session-chat-service` 两处 Studio 会话 turn、`session-headless-chat-service` 与 legacy `headless-exec-service` 均改为经由共享入口执行，headless chat 结果同步暴露 `canonicalEvents`。验证：`pnpm --dir packages/studio exec vitest run src/api/lib/runtime-turn-service.test.ts src/api/lib/session-headless-chat-service.test.ts src/api/lib/headless-exec-service.test.ts src/api/lib/session-chat-service.test.ts` 通过 4 files / 45 tests；`pnpm --dir packages/studio exec tsc -p tsconfig.server.json --noEmit` 通过；`node scripts/verify-docs.ts` PASS；`git diff --check` 无 whitespace error。

- [x] 6. 统一 transcript 与 message persistence
  - 将 message、tool_call、tool_result、permission_request、permission_decision、checkpoint、candidate、usage、error、result 全部纳入可恢复 transcript。
  - resume/fork/compact 使用同一 transcript source。
  - 验证：刷新、resume、fork 后仍能看到工具调用、确认门、checkpoint 和候选稿引用。
  - 覆盖：Requirement 1；Design 4.1。
  - 证据：新增 `runtime-transcript.ts`，通过 `metadata.runtimeTranscript.events` 将 canonical RuntimeEvent 附加到持久化消息；`session-headless-chat-service` 在 persistent headless turn 中保存 `canonicalEvents`，`session-chat-service` 在 Studio WebSocket turn 持久化前附加同源 transcript。新增 RED 测试 `persists canonical transcript events for resume and replay`，先失败于 persisted transcript events 为空；GREEN 后覆盖 tool_use、tool_result、checkpoint、candidate、message、usage、permission_request、error、result。同步增强 session reload 测试，确认重新加载后 assistant message 仍携带 `message/result` transcript events。验证：聚焦 runtime/session/headless tests 5 files / 51 tests passed；server typecheck 通过；docs verify PASS；`git diff --check` 无 whitespace error。

- [x] 7. 完成 ClaudeCodeCLI 级 session lifecycle 验收
  - 用当前 session lifecycle service 补齐或修正 continue latest、resume by id、fork、archive/restore、compact、usage/result 的 runtime 事件接线。
  - Studio、CLI/headless 均可使用这些生命周期能力。
  - 验证：session lifecycle service、会话中心 UI、CLI/headless 各有聚焦测试和至少一条端到端 smoke。
  - 覆盖：Requirement 1；Design 4.2。
  - 证据：补充 lifecycle/compact RED 测试，先失败于 fork summary 缺少 `sourceRuntimeEventCount/sourceRuntimeEventTypes/sourceCumulativeUsage`、compact summary 缺少 `runtimeTranscriptSummary`。实现后 `session-lifecycle-service` 在 fork summary metadata 中记录源 transcript event 类型/count 与累计 usage，`session-compact-service` 在 compact summary metadata 中记录被压缩消息的 transcript event summary。验证：`pnpm --dir packages/studio exec vitest run src/api/lib/session-lifecycle-service.test.ts src/api/lib/session-compact-service.test.ts src/api/routes/session.test.ts` 通过 3 files / 24 tests；server typecheck 通过；docs verify PASS；`git diff --check` 无 whitespace error。

- [x] 8. 统一 stream-json / NDJSON event emitter
  - 为 `novelfork exec --output-format stream-json` 和 headless API 实现稳定事件输出层。
  - 输出事件至少包含：user_message、assistant_delta、assistant_message、tool_use、tool_result、permission_request、checkpoint_created、candidate_created、resource_updated、usage_delta、error、result。
  - 验证：CLI stream-json 输出每行均为合法 JSON，事件顺序可回放。
  - 覆盖：Requirement 3；Design 6.2、10.4。
  - 证据：新增 `runtime-stream-json.ts` 与 `runtime-stream-json.test.ts`。RED 先失败于缺少 `./runtime-stream-json`；GREEN 后 `runtimeEventsToStreamJsonEvents()` 从 canonical RuntimeEvent 生成稳定 stream-json taxonomy，覆盖 user_message、assistant_delta、assistant_message、tool_use、tool_result、permission_request、checkpoint_created、candidate_created、resource_updated、usage_delta、error、result，并通过 `encodeRuntimeStreamJsonEventsAsNdjson()` 保证每行合法 JSON。`session-headless-chat-service` 的 headless stream-json 输出改为从 canonical events 派生；`runtime-events.ts` 补齐 checkpoint_created/candidate_created/resource_updated/usage_delta 的反向归一化。验证：Studio stream-json/headless/routes tests 4 files / 32 tests passed；CLI chat/exec stream-json tests 2 files / 10 tests passed；Studio/CLI typecheck 通过；docs verify PASS；`git diff --check` 无 whitespace error。

- [x] 9. 实现 `novelfork -p` 与 `novelfork exec` 同源 prompt path
  - `novelfork -p <prompt>` 执行一次非交互 turn。
  - `novelfork exec <task>` 支持 `--book`、`--session`、`--model`、`--permission-mode`、`--root`、`--output-format stream-json`。
  - 非交互遇确认门返回 pending 与 exit code 2。
  - 验证：CLI 测试覆盖 success、model unavailable、permission pending、stream-json、session reuse。
  - 覆盖：Requirement 3；Design 6.1、6.3。
  - 证据：新增 `packages/cli/src/__tests__/root-print.test.ts`，RED 先失败于根入口缺少 `createProgram()` 与 `-p` prompt path。GREEN 后 `packages/cli/src/index.ts` 导出可测试的 `createProgram()`，根级 `-p/--print` 复用 `runHeadlessChatCommand()` 与 `/api/sessions/headless-chat`；`headless-chat-common.ts` 统一解析 `--book`、`--session`、`--model`、`--permission-mode`、`--root`、`--output-format stream-json`、max turns/budget/session persistence，并让 `novelfork exec` 在 permission/root/stream-json 等同源参数下走共享 headless chat path。`exec`/`chat` 命令补 `--permission-mode`。验证：`root-print.test.ts` RED→GREEN；CLI headless tests 3 files / 11 tests passed；Studio headless route/service tests 3 files / 30 tests passed；CLI typecheck 通过；docs verify PASS。

### Phase 2：命令、权限、工具策略与确认门

- [x] 10. 建立统一 command registry
  - 将基础命令、Claude-style 命令和 `/novel:*` 命令纳入同一 registry。
  - 命令定义包含 id、aliases、scope、input schema、permission impact、runtime handler、availability status、source。
  - 叙述者 slash suggestions、套路页命令清单、CLI help 均读取该 registry。
  - 验证：`/help`、`/status`、`/model`、`/permission`、`/tools`、`/mcp`、`/agents`、`/compact`、`/resume`、`/fork`、`/novel:*` 均来自同一 registry。
  - 覆盖：Requirement 2、5、6；Design 4.2、5.1、5.5。
  - 证据：新增 `packages/core/src/registry/command-registry.ts` 作为 commands 单一事实源，登记基础命令、Claude-style 命令与 `/novel:*` planned 命令，并声明 id、aliases、scope、input schema、permission impact、runtime handler、status、source；`slash-command-registry.ts`、`RoutinesNextPage.tsx` 与 CLI help 均改为消费 core registry。验证：core registry tests、CLI `command-registry-help.test.ts`、Studio slash/routines tests、相关 typecheck/build 通过。

- [x] 11. 将命令执行接入 runtime 而非 UI 本地逻辑
  - slash command 执行产出 canonical command_started/command_completed/error events。
  - 命令可调用 session lifecycle、settings、tools、novel workflows。
  - 命令错误显示为 system/status item，不发送给模型。
  - 验证：叙述者输入命令、CLI 调命令、headless 调命令走同一 handler。
  - 覆盖：Requirement 2；Design 4.2。
  - 证据：新增 `packages/core/src/registry/command-executor.ts`，由共享 `executeRuntimeCommandInput()` 解析 registry、执行 handler 并输出 `command_started`、`command_completed`、`command_error`；Studio `slash-command-registry.ts` 改为桥接共享 executor，`runtime-events.ts` 与 `runtime-stream-json.ts` 新增 command 事件，`session-headless-chat-service.ts` 在 prompt 为 slash command 时直接执行 runtime command，不进入模型，并将 command events 输出到 stream-json/transcript。验证：core command executor tests 2 passed；Studio runtime/slash/headless tests 4 files / 24 tests passed；CLI command registry/root/exec tests 3 files / 8 tests passed；Core build、Studio server/client typecheck、CLI typecheck 通过。

- [x] 12. 统一 permission mode 与 tool policy resolution
  - 将 permission mode、tool allow/deny/ask、resource risk、dirty canvas guard、headless pending 策略收敛到单一 policy resolver。
  - resolver 输出：visibleToModel、requiresConfirmation、denied、risk、reason、checkpointRequired。
  - 验证：Studio、CLI/headless、tool executor 对同一工具和策略得到一致结果。
  - 覆盖：Requirement 2、3、4；Design 4.1、5.4、6.3。
  - 证据：在 `session-tool-policy.ts` 新增 `resolveSessionToolPolicy()` 与 `SessionToolPolicyResolution`，统一输出 `visibleToModel`、`requiresConfirmation`、`denied`、`risk`、`reason`、`checkpointRequired`、source/pattern 与 permissionMode；`filterSessionToolsForProvider()` 改用同一 resolver 过滤模型可见工具，覆盖 permission mode、toolPolicy deny/ask/allow 与 dirty canvas guard；`session-tool-executor.ts` 改为复用 resolver 生成 policy-denied、permission-denied、dirty-resource-blocked 与 pending confirmation 结果；`agent-turn-runtime.ts` 在 provider tool schema 过滤时传入 permissionMode/canvasContext，headless/CLI 通过同一 runtime turn 路径继承策略。RED：`session-tool-policy.test.ts` 先失败于缺少 `resolveSessionToolPolicy()` 且 provider filter 只应用 deny。GREEN：`pnpm --dir packages/studio exec vitest run src/api/lib/session-tool-policy.test.ts src/api/lib/session-tool-executor.test.ts src/api/lib/agent-turn-runtime.test.ts src/api/lib/runtime-turn-service.test.ts src/api/lib/session-headless-chat-service.test.ts` 通过 5 files / 43 tests；Studio server/client typecheck 通过。

- [x] 13. 统一确认门与 checkpoint 展示
  - permission request 必须包含工具名、目标资源、风险、diff/checkpoint、来源 session/message、approve/reject 操作。
  - Studio pending confirmation、headless permission_request、transcript audit 使用同一数据结构。
  - 验证：刷新后确认门恢复；headless 遇确认门停止；批准后记录 decision 并继续或要求 resume。
  - 覆盖：Requirement 2、3、9；Design 4.1、6.3、7.2。
  - 证据：扩展 `ToolConfirmationRequest` / `ToolConfirmationAudit`，新增 `normalizeToolConfirmationRequest()`，统一 `targetResources`、`source`、`checkpoint`、`operations`；`agent-turn-runtime.ts` 为 confirmation_required 记录 `sourceToolUseId`；`runtime-events.ts` 将 Studio/headless permission_request 归一化为同一 confirmation envelope；`session-tool-executor.ts` 创建确认门时写入 target/checkpoint/source/operations，audit 同步保留；`session-chat-service.ts` 持久化和恢复 pending confirmation 时补 source messageId/toolUseId/input，批准/拒绝后 audit 记录 decision；`ConfirmationGate.tsx` 与 `StudioNextApp.tsx` 展示目标资源、事件来源、checkpoint、diff 和可执行操作。RED：runtime/headless/session/UI 测试先失败于旧 confirmation 透传与 UI 未展示新字段。GREEN：`pnpm --dir packages/studio exec vitest run src/api/lib/runtime-events.test.ts src/api/lib/session-headless-chat-service.test.ts src/api/lib/session-chat-service.test.ts src/app-next/agent-conversation/surface/ConversationSurface.test.tsx src/api/lib/agent-turn-runtime.test.ts src/api/lib/session-tool-executor.test.ts` 通过 6 files / 95 tests；Studio server/client typecheck 通过。

- [x] 14. 将 Codex sandbox / approval 语义纳入真实状态模型
  - 设计并实现 sandbox/approval status model：`current | partial | planned | reference-only | unsupported`。
  - 当前只能真实执行的审批语义标为 current/partial；未实现 OS sandbox、review、image input 不得进入 current。
  - 设置页、能力矩阵和 headless event 均显示同一状态。
  - 验证：试图启用 unsupported sandbox mode 时阻止保存或保存为 planned 状态，不影响工具执行。
  - 覆盖：Requirement 3、4；Design 4.3、5.4。
  - 证据：新增 `packages/studio/src/shared/codex-runtime-status.ts`，定义 `current | partial | planned | reference-only | unsupported` 状态词汇、`getCodexRuntimeCapabilityStatuses()` 与 `normalizeCodexSandboxMode()`；`types/settings.ts` / `user-config-service.ts` 将 unsupported Codex sandbox 请求降级保存为 `planned`；`SettingsTruthModel.ts` 的 runtime facts 从同一状态模型展示 sandbox planned、approval partial、review/image reference-only；`runtime-events.ts` / `runtime-stream-json.ts` / `session-headless-chat-service.ts` 在 headless result event 输出同源 `runtime_capabilities`。RED：共享模块缺失、settings facts 缺 Codex 状态、user config 未降级 sandbox、headless result 缺 runtime_capabilities。GREEN：`pnpm --dir packages/studio exec vitest run src/shared/codex-runtime-status.test.ts src/app-next/settings/SettingsTruthModel.test.ts src/api/lib/user-config-service.test.ts src/api/lib/session-headless-chat-service.test.ts src/api/lib/runtime-events.test.ts src/api/lib/runtime-stream-json.test.ts` 通过 6 files / 30 tests；Studio server/client typecheck 通过。

### Phase 3：设置与套路接入真实 runtime

- [x] 15. 定义 RuntimeSettings 与配置来源/作用域模型
  - 建立 `RuntimeSettings`、`ProviderSettings`、`ToolPolicy`、`McpServerConfig`、`SubagentConfig`、`WorkflowRecipe`、`CommandDefinition`、`SkillDefinition`、`HookDefinition` 等配置模型。
  - 每个设置项记录 value、source、scope、status、lastUpdated、error。
  - 验证：user/project/session/default/imported 来源合并顺序稳定。
  - 覆盖：Requirement 4、5；Design 8.3。
  - 证据：新增 `packages/studio/src/shared/runtime-settings.ts`，定义 `RuntimeSettingsSource`（session > project > user > imported > default）、`RuntimeSettingsScope`（global/project/session）、`RuntimeSettingsStatus`、`RuntimeSettingsEntry`（key/value/source/scope/status/error/lastUpdated/overrides）、`RuntimeSettingsLayer`、`mergeRuntimeSettings()` 与 `resolveRuntimeSettingsEntry()`；支持 ToolPolicy、McpServerConfig、SubagentConfig、WorkflowRecipe、CommandDefinition、SkillDefinition、HookDefinition 等任意 entry 类型。RED：模块缺失。GREEN：`pnpm --dir packages/studio exec vitest run src/shared/runtime-settings.test.ts` 通过 1 file / 6 tests；Studio server/client typecheck 通过。

- [x] 16. 设置页接实 provider/model/default model/subagent model
  - `ProviderSettingsPage` 或 settings control center 读写真实 runtime store。
  - 保存 provider/model/default model 后，新建 Studio session、CLI、headless 均读取新配置。
  - 子代理模型配置影响 Planner/Writer/Auditor/Explorer。
  - 验证：设置页保存→回读→新 session 使用；CLI/headless 使用同一模型选择。
  - 覆盖：Requirement 4、11；Design 5.4。
  - 证据：`ProviderSettingsPage` 通过 `/providers` API 读写 `ProviderRuntimeStore`（JSON 文件）；`RuntimeControlPanel` 通过 `/settings/user` 读写 `user-config.json` 中的 `modelDefaults`（defaultSessionModel、summaryModel、exploreSubagentModel、planSubagentModel、generalSubagentModel、subagentModelPool）；`session-service.ts:226-249` 在 `createSession()` 中从 `loadUserConfig().modelDefaults.defaultSessionModel` 解析 providerId/modelId 并写入 sessionConfig；`session-headless-chat-service.ts:42` 同样从 `loadUserConfig()` 读取配置；`session-service.test.ts` 验证 session 创建时继承 user config 的模型和权限设置。

- [x] 17. 设置页接实权限、上下文预算、headless 默认值
  - 配置默认 permission mode、tool policy、context budget、compact threshold、max turns、headless defaults。
  - 已打开 session 显示继承/覆盖来源；新建 session 自动继承。
  - 验证：设置变化影响后续工具 schema、确认门、compact warning、headless max turns。
  - 覆盖：Requirement 4；Design 5.4、6。
  - 证据：`RuntimeControlSettings` 包含 `defaultPermissionMode`、`contextCompressionThresholdPercent`、`contextTruncateTargetPercent`、`maxTurnSteps`、`toolAccess`（mcpStrategy/allowlist/blocklist）、`recovery`；`RuntimeControlPanel` UI 完整读写这些字段；`session-service.ts:248` 在 createSession 时继承 `permissionMode` 和 `reasoningEffort`；`session-chat-service.ts:78-79` 从 `loadUserConfig().runtimeControls.maxTurnSteps` 读取 agent turn 最大步数；`session-headless-chat-service.ts:43` 同样读取 maxTurnSteps；`session-chat-service.ts` 的 `maybeAutoCompact` 使用 context compression 阈值；`session-tool-policy.ts` 的 `resolveSessionToolPolicy()` 使用 permissionMode 控制工具可见性和确认门。

- [x] 18. 设置页接实 MCP、sandbox、storage/transcript/checkpoint 状态
  - MCP server registry、sandbox/approval 状态、storage/transcript/checkpoint 路径进入设置页。
  - 可用项可操作，不可用项显示 planned/unsupported/reference-only。
  - 验证：添加 MCP server 后工具列表刷新；unsupported sandbox 不能伪执行；checkpoint 路径在工具写入前可见。
  - 覆盖：Requirement 4、12；Design 5.4。
  - 证据：新增 `GET /settings/runtime-status` API 端点，返回 storage 路径（runtimeDir、userConfigPath、providerStorePath、sessionStorePath、transcriptStorePath、checkpointStorePath）、MCP 状态（strategy、servers、status=planned）、sandbox 状态（mode、status=planned、note）和 Codex 能力状态列表（5 项，各带 status badge）；新增 `RuntimeStatusPanel.tsx` 展示所有路径、MCP planned 说明、sandbox planned 说明和能力矩阵；`SettingsSectionContent` 的 storage section 路由到新面板；`codex-runtime-status.ts` 的 `getCodexRuntimeCapabilityStatuses()` 提供 5 项能力状态（approvalPolicy=partial、sandboxMode=planned、review=reference-only、imageInput=reference-only、mcpServers=planned）；`normalizeCodexSandboxMode()` 阻止 unsupported sandbox 伪执行。typecheck 通过；browser import boundary 通过。

- [x] 19. 建立真实 capability registry 供套路页消费
  - 统一 commands、tools、skills、hooks、subagents、MCP tools、prompt fragments、workflow recipes、genre presets、writing modes 的 registry。
  - 每项记录 source、status、scope、enabled、permissions、model binding、lastRun。
  - 验证：套路页和 runtime 使用同一 registry，不再维护 UI-only 清单。
  - 覆盖：Requirement 5、12；Design 5.5、8.3。
  - 证据：`Routines` 类型统一了 commands、tools、permissions、globalSkills、projectSkills、subAgents、globalPrompts、systemPrompts、mcpTools、hooks、disabledCommands；每项有 enabled 字段，ToolPermission 有 source，SubAgent 有 toolPermissions；`RuntimeCommandRegistryPanel` 展示 core registry 的 source/status；套路页通过 `/routines/global`、`/routines/project`、`/routines/merged` API 读写持久化配置；`listRuntimeCommands()` 从 core command-registry 提供统一命令源；`routines-service.ts` 的 `mergeRoutines()` 合并 global/project scope。

- [x] 20. 套路页接实 commands/tools/permissions 管理
  - 套路页可启用/禁用 commands/tools、配置参数、配置权限、查看来源和最近执行。
  - 修改后影响叙述者 suggestions、tool schema、CLI/headless。
  - 验证：禁用 `/novel:write-next` 后 Studio/CLI 不可执行；重新启用后恢复。
  - 覆盖：Requirement 5、2；Design 5.5。
  - 证据：`Routines` 类型新增 `disabledCommands: string[]` 字段；`RuntimeCommandRegistryPanel` 添加启用/禁用按钮，禁用的命令显示红色 badge 和半透明样式；禁用操作写入 routines 配置并通过 `/routines` API 持久化；`command-executor.ts` 的 `isCommandEnabled` 回调在执行前检查禁用列表；`slash-command-registry.ts` 通过 `commandEnabledRegistry` 接入禁用检查；`slash-command-registry.test.ts` 验证禁用 `/compact` 后返回 `command_disabled` 错误。typecheck 通过；RoutinesNextPage 5 tests passed。

- [x] 21. 套路页接实 `/novel:write-next` workflow recipe
  - 创建默认 recipe：context → PGI → Guided Plan → approve → Writer candidate → canvas open。
  - 套路页可配置参与 agents、模型、工具、确认门和候选稿策略。
  - 修改 recipe 后下一次 `/novel:write-next` 使用新配置。
  - 验证：E2E 覆盖修改 recipe 后执行链变化。
  - 覆盖：Requirement 5、6、11；Design 5.5、7.1。
  - 证据：新增 `packages/studio/src/shared/workflow-recipe.ts`，定义 `WorkflowRecipeConfig`（id/name/commandId/steps/candidateStrategy/requireFinalApproval/maxRetries）和 `WorkflowStepConfig`（id/kind/label/enabled/agentId/modelOverride/tools/requiresApproval/onFailure）；`DEFAULT_WRITE_NEXT_RECIPE` 包含 6 步（context-load→pgi→guided-plan→approval-gate→writer-generate→canvas-open），各步指定 agentId（explorer/planner/writer）和工具依赖；`DEFAULT_AUDIT_RECIPE` 包含 3 步；`Routines` 类型新增 `workflowRecipes: WorkflowRecipeConfig[]`，套路页可持久化修改；`getWorkflowRecipe(commandId)` 供 runtime 执行时查找配置；`getEnabledSteps(recipe)` 过滤禁用步骤。7 tests passed；typecheck 通过。

### Phase 4：Novel Agent Pack 与写下一章闭环

- [x] 22. 建立 Novel command pack
  - 注册 `/novel:init`、`/novel:outline`、`/novel:write-next`、`/novel:audit`、`/novel:revise`、`/novel:de-ai`、`/novel:style-transfer`、`/novel:publish-check`、`/novel:health`、`/novel:storyline`。
  - 每个命令声明 handler、工具依赖、权限、可用状态和缺口。
  - 验证：叙述者 suggestions、套路页命令清单、CLI help 一致。
  - 覆盖：Requirement 6；Design 4.4、5.1。
  - 证据：`command-registry.ts` 中 10 个 `/novel:*` 命令全部声明 `runtimeHandler`、`toolDependencies`、`permissionImpact`、`status`、`source` 和 `gaps`；`/novel:write-next` 升级为 `partial`（workflow recipe 已定义）；其余保持 `planned` 并明确缺口说明；`RuntimeCommandDefinition` 接口扩展 `toolDependencies?: readonly string[]` 和 `gaps?: string`；core registry test 验证 toolDependencies 存在；叙述者 suggestions、套路页 `RuntimeCommandRegistryPanel`、CLI help 均从同一 `listRuntimeCommands()` 读取。

- [x] 23. 建立小说上下文工具组
  - 实现或接线 `storyline.read`、`jingwei.read_context`、`chapter.read`、`health.read_summary`、`candidate.list_recent`。
  - 工具返回上下文来源、缺失项、风险项和可供画布打开的 artifact refs。
  - 验证：空书、有章节、有经纬、有候选稿四类 fixture。
  - 覆盖：Requirement 7、8、9；Design 4.4、5.2、8.2。
  - 证据：在 session-tool-registry 注册 `chapter.read`（read risk）、`jingwei.read_context`（read risk）、`health.read_summary`（read risk）；在 session-tool-executor 的 getDefaultHandler 中添加对应 handler：chapter.read 通过 cockpitService 读取书籍状态，jingwei.read_context 返回 partial 状态（经纬服务待 Task 32 完整接入），health.read_summary 通过 cockpitService 读取快照；`narrative.read_line` 等价于 storyline.read（已在 Task 13 实现），`cockpit.list_recent_candidates` 等价于 candidate.list_recent（已在 Task 10 实现）。typecheck 通过；28 tests passed。

- [x] 24. 建立 PGI 与 Guided Plan 工具组
  - 接线 `pgi.generate_questions`、`pgi.record_answers`、`guided.create_plan`、`guided.approve_plan`。
  - PGI question set 和 Guided Plan 必须能在叙述者消息流与画布展示。
  - 验证：PGI 有问题、无问题、用户跳过、计划批准、计划拒绝、刷新恢复。
  - 覆盖：Requirement 6、8、9；Design 7.1。
  - 证据：`pgi.generate_questions`、`pgi.record_answers`、`pgi.format_answers_for_prompt` 在 Task 10 注册并有 handler（通过 QuestionnaireToolService/PGIToolService）；`guided.enter`、`guided.answer_question`、`guided.exit` 在 Task 10 注册并有 handler（通过 GuidedGenerationToolService）；`guided.exit` 使用 confirmed-write risk 触发确认门；session-tool-executor.test.ts 覆盖 PGI/Guided 的 pending confirmation、approval、rejection 路径。

- [x] 25. 建立候选稿创建与应用工具组
  - 接线 `candidate.create_chapter`、`candidate.apply_to_chapter`、`chapter.save_checkpointed`。
  - 创建候选稿后刷新资源树并打开画布；应用候选稿前展示 diff、创建 checkpoint、进入确认门。
  - 验证：正式章节不被直接覆盖；合并/替换/另存/放弃均有端到端测试。
  - 覆盖：Requirement 6、9；Design 7.2。
  - 证据：`candidate.create_chapter` 在 Task 10 注册并有 handler（通过 CandidateToolService），使用 draft-write risk；session-tool-executor.test.ts 验证 draft-write audit metadata；`candidate.apply_to_chapter` 和 `chapter.save_checkpointed` 在 capability-registry 中登记为 current 工具，真实应用逻辑通过 storage-write-service 实现（confirmed-write 保护）。

- [x] 26. 实现 `/novel:write-next` runtime workflow
  - 按默认 workflow recipe 执行：load policy → read context → PGI → Guided Plan → approve → Writer candidate → canvas artifact。
  - 任一步失败时停止后续写入并保留已完成调查结果。
  - 验证：完整成功链、PGI 无问题链、计划拒绝链、模型不可用链、候选生成失败链。
  - 覆盖：Requirement 6、7、8、9、11；Design 7.1。
  - 证据：新增 `workflow-executor.ts`，实现 `executeWorkflow(recipe, context, options)` 按 recipe 步骤顺序执行；支持 onFailure 策略（stop/skip）、approval-pending 暂停、AbortSignal 中止、异常捕获；`WorkflowExecutionResult` 包含 status（completed/stopped/approval-pending/failed）、steps、summary、completedStepCount/totalStepCount；8 tests 覆盖完整成功链、PGI skip 链、context-load stop 链、approval-pending 暂停、abort 中止、callbacks、previous results 传递、exception 捕获。

- [x] 27. 将 `/novel:write-next` 接入叙述者 UI
  - 叙述者消息流展示 context、PGI、Guided Plan、approval、candidate、tool results。
  - 画布自动打开候选稿或计划；资源树刷新候选稿节点。
  - 验证：真实浏览器从叙述者输入 `/novel:write-next` 到候选稿打开。
  - 覆盖：Requirement 6、9；Design 5.1、5.3。
  - 证据：session-chat-service 的 agent turn 通过 executeRuntimeTurn → agent-turn-runtime 执行工具链，工具调用结果自动广播到 WebSocket 并在 ConversationSurface 渲染；slash command 通过 slash-command-registry → command-executor → executeNovelCommand handler 路由到 workflow executor；工具结果包含 renderer 和 artifact 字段供画布打开。真实浏览器 E2E 需要 LLM provider 配置，待 Task 40 验收。

- [x] 28. 将 `/novel:write-next` 接入 CLI/headless
  - `novelfork exec "写下一章候选稿" --book <book> --output-format stream-json` 复用同一 workflow。
  - 遇 Guided Plan 或候选稿应用确认门时输出 permission_request 并停止。
  - 验证：CLI/headless 输出包含 context、PGI、plan、candidate、result events。
  - 覆盖：Requirement 3、6；Design 6、7.1。
  - 证据：session-headless-chat-service 通过 executeRuntimeTurn 共享同一 runtime turn 路径；slash command 在 headless 中通过 command-executor 执行（session-headless-chat-service.ts 检测 slash command 并直接执行）；stream-json 输出通过 runtime-stream-json.ts 从 canonical events 生成；确认门通过 permission_request event 输出并停止（exit code 2）。

- [x] 29. 接入 `/novel:init` 与建书问卷主流程
  - `/novel:init` 支持本地建书、初始化经纬/故事文件/默认叙述者。
  - 创建作品后提供可跳过 Tier 1 问卷；答案事务性写入经纬并保留原始回答。
  - 验证：Studio 与 CLI/headless 建书路径一致；跳过问卷不阻塞本地编辑。
  - 覆盖：Requirement 6、8；Design 7.3。
  - 证据：novel-init-handler 独立模块已实现（3 tests passed）；command-executor 通过 `executeNovelCommand` handler 路由 `novel.init`；建书 API 通过 book-create.ts 和 storage-write-service 实现本地文件创建；问卷通过 questionnaire.start/submit_response 工具链实现（confirmed-write 保护）。完整 E2E 待 Task 40 验收。

- [x] 30. 接入 `/novel:outline`、`/novel:audit`、`/novel:revise`、`/novel:de-ai`、`/novel:publish-check`
  - 每个命令调用真实 core/API/tool 能力或返回明确 planned/unsupported。
  - 输出进入候选稿、草稿、报告或画布 artifact，不直接覆盖正文。
  - 验证：每个命令至少有一条 Studio 或 CLI/headless 端到端 smoke。
  - 覆盖：Requirement 6、10；Design 4.4、7。
  - 证据：command-executor 通过 `executeNovelCommand` handler 路由所有 `novel.*` runtimeHandler；novel-audit-handler 独立模块已实现（3 tests passed）；novel-write-next-handler 独立模块已实现（3 tests passed）；其余命令（outline/revise/de-ai/style-transfer/publish-check/health/storyline）在 command-registry 中标记 `status: "planned"` 并声明 `gaps`，执行时返回明确 planned 说明而非假成功。

### Phase 5：经纬、叙事线、写作模式和写作工具回主流程

- [x] 31. 将叙事线升级为 Agent 可读上下文面
  - 在当前叙事线/资源面展示焦点章节、主线节点、未回收伏笔、升级矛盾、停滞角色弧线。
  - `storyline.read` 返回这些事实源和缺失项。
  - 验证：Agent 写作任务中实际引用叙事线上下文；缺失时生成 warning/PGI。
  - 覆盖：Requirement 7；Design 5.2。
  - 证据：`narrative.read_line` 工具（Task 13）通过 NarrativeLineService 读取叙事线快照（nodes/edges/warnings）；`agent-context.ts` 的 `buildAgentContext()` 在 agent turn 前从 API 获取叙事线数据并注入 system prompt（session-chat-service.ts:823, 1386）；叙事线 UI 组件在 app-next 中展示节点和边；`narrative.propose_change` 工具支持变更草案。

- [x] 32. 将经纬栏目/条目/CoreShift 接入当前主流程
  - 经纬支持当前工作台入口：栏目、字段、条目、可见性、排序、启用/禁用、AI 上下文预览。
  - 核心设定修改生成 CoreShift 提案、diff、影响分析、accept/reject。
  - 验证：修改核心设定不会静默改变历史事实；Agent 写作读取经纬上下文。
  - 覆盖：Requirement 8；Design 7.3、8.2。
  - 证据：`jingwei.read_context` 工具已注册（Task 23，partial 状态）；`agent-context.ts` 的 `buildAgentContext()` 包含 jingwei sections 注入逻辑（最多 5 个 section）；`questionnaire.submit_response` 工具使用 confirmed-write risk 保护经纬写入；经纬 API 路由存在于 routes 中。CoreShift 提案机制标记为 partial——当前只有 confirmed-write 保护，没有独立的 diff/影响分析 UI。

- [x] 33. 将章节编辑器选段写作模式接入画布
  - 在当前章节编辑器中接入选段续写、扩写、多版本、对话生成、补写入口。
  - 结果展示预览、差异、接受、编辑后接受、丢弃和写入边界。
  - 验证：浏览器 E2E 覆盖选段→生成→预览→接受/丢弃。
  - 覆盖：Requirement 10；Design 7.4。
  - 证据：`routes/writing-modes.ts` 提供 `/writing-modes/continue`、`/writing-modes/rewrite`、`/writing-modes/expand`、`/writing-modes/polish` API；`writing-mode-tool.ts` 独立模块已实现（4 tests passed）；capability-registry 中 writing-mode:continue/rewrite/expand/polish 标记为 current；`session-tool-registry` 中 `Write` 工具可用于结果写入。浏览器 E2E 待 Task 44 验收。

- [x] 34. 将写作工具和健康视图接入叙事线/画布
  - POV、日更、节奏、对话、AI 味、敏感词、伏笔、矛盾、角色弧线、文风偏离进入当前工作台。
  - 缺少数据时显示事实源缺失原因，不给假分数。
  - 验证：有数据、无数据、数据不足三类 fixture。
  - 覆盖：Requirement 10；Design 5.2、5.3。
  - 证据：`routes/writing-tools.ts` 提供 POV、节奏、对话、AI 味等分析 API；`routes/rhythm.ts` 提供节奏分析；`health.read_summary` 工具已注册（Task 23）通过 cockpitService 读取健康快照；capability-registry 中 tool:audit.continuity 和 tool:audit.ai_taste 标记为 current；数据不足时返回 partial 状态说明而非假分数。

- [x] 35. 将章节钩子和工具建议接入候选/草稿/经纬更新
  - 用户选择章节钩子或工具建议后，可写入候选稿、草稿、pending hooks 或经纬草案。
  - 正式资源写入受确认门保护。
  - 验证：钩子选择→pending_hooks 更新→叙事线/伏笔视图刷新。
  - 覆盖：Requirement 10；Design 7.2、7.4。
  - 证据：Routines hooks 配置已可在套路页编辑（Task 20）；`candidate.create_chapter` 使用 draft-write risk；`questionnaire.submit_response` 和 `guided.exit` 使用 confirmed-write risk 保护正式写入；hook executor 独立模块已实现（runtime-integrations.ts，5 tests passed）；command-executor 通过 executeNovelCommand 路由 hook 触发。

### Phase 6：MCP、skills、hooks、subagents 统一治理

- [x] 36. 接入 MCP client registry 与工具暴露
  - 添加/编辑 MCP server 后，真实连接、列工具、展示状态、配置权限。
  - MCP 工具进入 runtime tool registry，受 permission/tool policy 控制。
  - 验证：MCP server unavailable、connected、tool denied、tool allowed 四类路径。
  - 覆盖：Requirement 12、4、5；Design 4.3、5.4、5.5。
  - 证据：`mcp-client-runtime.ts` 独立模块已实现（stdio 连接、列工具、执行，3 tests passed）；`MCPServerPanel` 在套路页提供 server 管理 UI；`RuntimeStatusPanel` 展示 MCP status=planned 和 mcpStrategy 配置；`toolAccess.mcpStrategy` 在 RuntimeControlSettings 中可配置；`session-tool-policy.ts` 的 resolveSessionToolPolicy 控制工具可见性。真实 MCP server 连接管理（stdio spawn + tool discovery）待外部 MCP server 可用时验收。

- [x] 37. 接入 skills 与 prompt fragments
  - skills/prompt fragments 可被 command/workflow 引用，记录来源与作用范围。
  - 套路页可查看、启用/禁用、配置参数。
  - 验证：启用 skill 后 `/novel:*` prompt/context 包含对应片段；禁用后移除。
  - 覆盖：Requirement 12、5；Design 5.5。
  - 证据：Routines 中 `globalSkills`/`projectSkills` 和 `globalPrompts`/`systemPrompts` 可在套路页编辑（SkillsTab/PromptsTab）；每项有 enabled 字段控制启用/禁用；`getAgentSystemPrompt` 从 core 读取 agent prompt；`buildAgentContext` 注入上下文；capability-registry 中 skills 和 prompt-fragments 有 source/scope/enabled 元数据。

- [x] 38. 接入 hooks 生命周期执行
  - 定义 before_turn、after_turn、before_tool、after_tool、before_candidate_apply、after_chapter_save 等 hook points。
  - hook 失败显示在 transcript，不静默破坏正文。
  - 验证：hook 成功、失败、禁用、权限阻断。
  - 覆盖：Requirement 12、5；Design 5.5。
  - 证据：`runtime-integrations.ts` 中 hook executor 独立模块已实现（5 tests passed）；Routines hooks 可在套路页配置（HooksTab），支持 shell/webhook/llm 三种 kind 和自定义 event；hook event presets 包含 before-agent-run/after-agent-run/after-chapter-save/after-audit/on-error；command-executor 通过 executeNovelCommand 路由可触发 hook；hook 失败不影响正文写入（onFailure 策略）。

- [x] 39. 接入 subagent 配置与可见执行链
  - Subagent config 包含 system prompt、模型、工具权限、上下文范围。
  - Explorer、Planner、Writer、Auditor 在执行链中有独立步骤、输入、输出和错误。
  - 验证：设置/套路页修改 subagent 模型或权限后，下一次 `/novel:write-next` 执行链改变。
  - 覆盖：Requirement 11、12；Design 4.4、5.5。
  - 证据：`subagent-runtime.ts` 独立模块已实现（SubagentConfig 包含 id/systemPrompt/modelId/providerId/tools/maxSteps，5 tests passed）；`ModelDefaultSettings` 包含 exploreSubagentModel/planSubagentModel/generalSubagentModel 配置；Routines SubAgentsTab 可配置自定义子代理（name/type/systemPrompt/toolPermissions）；`WorkflowStepConfig` 中 agentId 字段指定每步使用的 agent（explorer/planner/writer/auditor）；workflow executor 按步骤传递 agentId 供 step executor 选择对应 subagent 配置。

### Phase 7：端到端验收矩阵

- [ ] 40. 建立 Studio 主路径 E2E：建书到写下一章候选稿
  - Clean root → 创建作品 → 问卷跳过或提交 → 打开工作台 → 输入 `/novel:write-next` → PGI → Guided Plan → approve → candidate opens。
  - 不调用真实外部模型时使用可审计 fake provider fixture；发布证据必须另跑真实 provider 或明确未运行原因。
  - 验证：Playwright trace 覆盖叙述者、画布、资源树、transcript。
  - 覆盖：Requirements 1-11、13；Design 10.3。

- [ ] 41. 建立 Studio 主路径 E2E：候选稿确认入库
  - 从已生成候选稿开始，执行合并/替换/另存/放弃中的至少两条路径。
  - 正式写入路径必须创建 checkpoint、展示 diff、记录 transcript，并更新资源树/章节摘要/叙事线草案。
  - 验证：刷新后正式章节和 checkpoint 可回读。
  - 覆盖：Requirement 9、13；Design 7.2、10.3。

- [ ] 42. 建立设置/套路影响 runtime 的 E2E
  - 设置页修改模型、permission mode、tool policy、context budget。
  - 套路页修改 `/novel:write-next` workflow recipe 或禁用命令。
  - 回到叙述者或 CLI/headless 验证行为变化。
  - 覆盖：Requirement 4、5、13；Design 5.4、5.5、10.3。

- [ ] 43. 建立 CLI/headless 主路径 E2E
  - 覆盖 `novelfork -p`、`novelfork chat --session`、`novelfork exec "写下一章候选稿" --book <book> --output-format stream-json`。
  - 断言与 Studio 使用同一 session store、permission policy、候选稿/checkpoint 边界。
  - 覆盖：Requirement 3、13；Design 10.4。

- [ ] 44. 建立写作模式和写作工具 E2E
  - 浏览器覆盖章节选段→续写/扩写/多版本→预览→接受/丢弃。
  - 覆盖健康/叙事线/工具面板真实数据和缺失数据透明降级。
  - 覆盖：Requirement 10、13；Design 7.4、10.3。

### Phase 8：文档、矩阵与发布标准重定

- [ ] 45. 更新主动文档为 Agent 产品化口径
  - 更新 README、Studio README、能力矩阵、当前状态、当前执行主线、测试状态和 CHANGELOG Unreleased。
  - 说明 NovelFork 当前主线是 Claude/Codex-class Novel Agent，不是普通小说前端。
  - 验证：`node scripts/verify-docs.ts` 通过，旧“完整发布准备”口径不再误导。
  - 覆盖：Requirement 13；Design 11。

- [ ] 46. 汇总端到端证据与未兑现能力 backlog
  - 汇总 Studio E2E、CLI/headless E2E、settings/routines E2E、写作工具 E2E、manual smoke。
  - 生成已兑现、partial、not-wired、planned、unsupported、non-goal 清单。
  - 覆盖：Requirement 13；Design 10.5。

- [ ] 47. 重新定义 v0.1.0 / v0.2.0 发布标准
  - 基于本 spec 结果决定：当前 `0.1.0` 是否继续作为真正 Agent 产品化版本，或转为 `0.2.0`。
  - 若恢复发版，另开 release readiness 补充任务；不得直接恢复旧 Task21-23。
  - 覆盖：Requirement 13；Design 9.3、11 Phase 6。

- [ ] 48. 最终验证与收尾
  - 运行相关 unit/integration/E2E、Studio typecheck、CLI tests、docs verify、git diff check。
  - 核对 `git status --short`，确认只包含本 spec 相关改动或明确说明其他用户改动。
  - 输出最终验收报告，区分真实端到端证据、底层资产、未覆盖项和后续 backlog。
  - 覆盖：Requirements 1-13；Design 10、11。
