# Conversation Parity v1 Tasks

## Overview

参考 Claude Code CLI 的成熟对话体验，为 NovelFork 叙述者会话补齐恢复/继续/fork、slash command、compact/memory、工具权限策略、headless stream-json、checkpoint/rewind 和结构化执行结果。所有能力必须接真实 session/runtime/storage，不做 UI 壳或假成功。

## Tasks

- [x] 1. 建立 Claude Code parity 对照与范围守护
  - 将本机 Claude Code CLI 2.1.69 调查结果整理为能力对照表。
  - 明确本 spec 实现范围：resume/continue/fork、slash、compact、tool policy、headless、checkpoint、usage result。
  - 明确排除范围：tmux、Chrome bridge、remote-control、插件市场、完整终端 TUI。
  - 验证：spec/design 与能力矩阵不把排除项写成当前能力。
  - 证据：新增 `claude-code-parity-baseline.md`，记录 `claude --version` 返回 `2.1.69 (Claude Code)`，`claude --help` 暴露 `--continue`、`--resume`、`--fork-session`、stream-json 输入/输出、tool allow/deny、permission mode、no-session-persistence、worktree/tmux/chrome/server/plugin 等能力；同步调查 NovelFork 当前 session route、SessionCenter、`/api/exec`、`novelfork exec`、microCompact、permissionMode、usage 与 checkpoint 缺口，整理 Claude Code → NovelFork 能力对照表；范围限定为 resume/continue/fork、slash、compact/memory、tool policy、headless stream-json、checkpoint/rewind、usage result；明确排除 tmux、Chrome bridge、remote-control/server parity、插件市场、完整终端 TUI、完整 Claude Code 命令照搬；`pnpm docs:verify` 通过；`git diff --check` 无 whitespace error，仅 LF/CRLF 提示。

- [x] 2. 实现会话继续、恢复与 fork service
  - 新增 session lifecycle service：continue latest、resume by id、fork session。
  - fork 继承必要 session config、绑定信息和上下文摘要，不复用原 sessionId。
  - 归档会话默认只读，恢复 active 后可继续。
  - 验证：continue latest、resume missing、fork success/failure、archived handling 测试。
  - 证据：先新增 `packages/studio/src/api/lib/session-lifecycle-service.test.ts` RED，初始运行因缺少 `session-lifecycle-service` 模块失败；补最小 stub 后重新 RED，5 项中 3 项按预期失败（continue latest、archived readonly/restore、fork success），2 项错误路径通过（resume missing、fork missing 不创建空会话）；随后实现 `session-lifecycle-service.ts`，提供 `continueLatestSession`、`resumeSession`、`restoreSessionForContinue`、`forkSession`，复用真实 `listSessions`/`getSessionById`/`updateSession`/`createSession` 与 `getSessionChatSnapshot`/`replaceSessionChatState`；fork 继承 title override、agentId、kind、sessionMode、worktree、projectId、chapterId、sessionConfig，创建新的 active session 与 system summary，不复用源 sessionId，不复制完整历史；归档会话 resume 返回 `readonly: true`，restore 后变 active；`pnpm --dir packages/studio exec vitest run src/api/lib/session-lifecycle-service.test.ts --reporter=verbose` 通过（1 file / 5 tests）；`pnpm --dir packages/studio exec vitest run src/api/lib/session-lifecycle-service.test.ts src/api/lib/session-service.test.ts src/api/routes/session.test.ts --reporter=verbose` 通过（3 files / 15 tests，输出含 SQLite experimental warning 与 session.recovery stdout）。

- [x] 3. 实现 ResumePicker / ForkDialog UI
  - Conversation/Shell 提供最近会话、按 book/chapter 搜索、恢复和 fork 入口。
  - fork 支持填写标题和继承说明。
  - 错误显示真实原因，不创建空假会话。
  - 验证：选择最近会话、搜索会话、fork 导航、失败状态测试。
  - 证据：先补 `SessionCenter.test.tsx` RED，3 项按预期失败（缺少“继续最近会话”按钮、缺少 Fork 按钮/对话框、lifecycle 错误未显示）；随后扩展 `SessionCenter` 为 ResumePicker/ForkDialog 承载组件，新增 `projectId`/`chapterId` scoped continue、Fork 标题与继承说明输入、真实错误展示、成功后只打开后端返回的 session。为 UI 接线补齐 Backend Contract client 与 route：`GET /api/sessions/lifecycle/latest`、`POST /api/sessions/:id/fork`、`POST /api/sessions/:id/restore`，并登记 `sessions.lifecycle.continue/fork/restore` capability；`pnpm --dir packages/studio exec vitest run src/components/sessions/SessionCenter.test.tsx --reporter=verbose` 通过（1 file / 8 tests）；`pnpm --dir packages/studio exec vitest run src/app-next/backend-contract/domain-clients.test.ts src/api/routes/session.test.ts src/api/backend-contract-matrix.test.ts src/api/lib/session-lifecycle-service.test.ts --reporter=verbose` 通过（4 files / 29 tests，含 SQLite experimental warning 与 session.recovery stdout）。

- [x] 4. 建立 Slash Command Registry
  - Composer 拦截 `/` 命令并展示建议。
  - 实现 `/help`、`/status`、`/model`、`/permission`、`/fork`、`/resume` 的解析与执行。
  - 命令错误以 system/status item 显示，不发送给模型。
  - 验证：合法命令、非法命令、参数命令、权限命令测试。
  - 证据：先补 `slash-command-registry.test.ts` 与 `ConversationSurface.test.tsx` RED；失败点为缺少 `slash-command-registry` 模块、Composer 不显示 `listbox` 建议、slash command 未触发结构化结果。随后新增 `slash-command-registry.ts`，实现 `/help`、`/status`、`/model [provider:model]`、`/permission [ask|edit|allow|read|plan]`、`/fork [title]`、`/resume [sessionId]` 的 parse/suggestion/execute 结构化结果，Task 4 当时把 `/compact` 暂登记为后续 Task 5 待接入入口；Composer 拦截 `/` 命令，显示斜杠建议，错误以 `role=status` 显示，不调用 `onSend`，成功命令回调 `onSlashCommandResult`；`ConversationSurface` 对 `update-session-config` 命令走既有 `onUpdateSessionConfig`，不绕过 session update。`pnpm --dir packages/studio exec vitest run src/app-next/agent-conversation/slash-command-registry.test.ts src/app-next/agent-conversation/surface/ConversationSurface.test.tsx --reporter=verbose` 通过（2 files / 17 tests）。

- [x] 5. 产品化 `/compact` 与上下文预算
  - 将 `microCompact` 包装为 session compact service。
  - 记录 compact summary、消息范围、模型、时间和失败原因。
  - 后续 turn 使用 summary + recent messages 构造上下文。
  - UI 展示 compact status、context budget 和最近摘要。
  - 验证：compact 成功、失败保留原历史、summary 注入、预算提示测试。
  - 证据：先补 `session-compact-service.test.ts` RED，失败点为缺少 `session-compact-service` 模块；随后新增 `session-compact-service.ts`，基于 `microCompact` 和 session chat snapshot 生成 `session-compact-summary` system message，替换为 summary + recent messages，并记录 `sourceRange`、`preservedRange`、model、`compactedAt`、`budget` 与 `compactedMessageCount`。首次 GREEN 前发现测试历史过短导致预算断言不成立，修正为长历史 fixture 后又发现 summary 拼入全文，随即截断每条摘录，确保 compact 真正降低预算。新增 `POST /api/sessions/:id/compact` route、`createSessionClient().compactSession`、`sessions.compact` matrix，并将 `/compact` 从暂登记入口升级为调用真实 compact service 的 slash command；`ConversationRouteLive` 成功后刷新 snapshot，Composer status 展示 budget。`pnpm --dir packages/studio exec vitest run src/api/lib/session-compact-service.test.ts --reporter=verbose` 通过（1 file / 3 tests）；`pnpm --dir packages/studio exec vitest run src/api/routes/session.test.ts --reporter=verbose` 通过（1 file / 11 tests，含 SQLite experimental warning 与 session.recovery stdout）；`pnpm --dir packages/studio exec vitest run src/app-next/backend-contract/domain-clients.test.ts src/api/backend-contract-matrix.test.ts src/app-next/agent-conversation/slash-command-registry.test.ts src/app-next/agent-conversation/surface/ConversationSurface.test.tsx --reporter=verbose` 通过（4 files / 32 tests）。

- [x] 6. 接入 Memory 写入边界
  - 定义用户偏好、项目事实、临时剧情草稿三类 memory 规则。
  - 稳定偏好/项目事实写入必须可审计，临时剧情不自动写长期 memory。
  - UI 提供查看和撤销入口或明确当前只读状态。
  - 验证：偏好写入、项目事实写入、临时剧情不写入、失败恢复测试。
  - 证据：先补 `session-memory-boundary-service.test.ts` RED，失败点为缺少 `session-memory-boundary-service` 模块；随后新增 `session-memory-boundary-service.ts`，提供可注入 `SessionMemoryWriter`、分类规则、scope 映射和审计 envelope：显式或稳定用户偏好写 user memory，项目事实写 project memory 且必须带 `project-resource` 来源，临时剧情草稿返回 `skipped` 不写长期 memory，writer 缺失或失败返回可恢复错误且不报假成功。新增 `GET /api/sessions/:id/memory/status`、`POST /api/sessions/:id/memory`、`createSessionClient().getMemoryStatus/commitMemory` 和 `sessions.memory.status/write` matrix；默认 writer 未配置时状态为 readonly，`SessionCenter` 展示“Memory：只读（未接入写入器）”并说明临时剧情不会自动写长期 memory。`pnpm --dir packages/studio exec vitest run src/api/lib/session-memory-boundary-service.test.ts --reporter=verbose` 通过（1 file / 5 tests）；`pnpm --dir packages/studio exec vitest run src/api/routes/session.test.ts src/app-next/backend-contract/domain-clients.test.ts src/api/backend-contract-matrix.test.ts --reporter=verbose` 通过（3 files / 26 tests，含 SQLite experimental warning 与 session.recovery stdout）；`pnpm --dir packages/studio exec vitest run src/components/sessions/SessionCenter.test.tsx --reporter=verbose` 通过（1 file / 9 tests）。

- [x] 7. 实现细粒度工具权限策略
  - 扩展 session config 或 policy store，支持 allow/deny/ask 工具规则。
  - 工具执行时合并 permissionMode、tool policy、resource risk、dirty canvasContext。
  - policy-denied/permission-required/unsupported-tools 返回结构化结果。
  - 验证：allow、deny、ask、dirty blocked、模型不支持工具测试。
  - 证据：先补 `session-tool-executor.test.ts`、`agent-turn-runtime.test.ts`、`session-service.test.ts`、`session.test.ts` 与 `ConversationSurface.test.tsx` RED，覆盖 toolPolicy deny 不执行 handler、ask 产生 `permission-required` 确认门、allow 覆盖 ask-mode draft-write 但仍受 dirty canvasContext 阻断、provider tool schema 过滤、全部工具被策略禁用时返回 `policy-disabled`、sessionConfig.toolPolicy 持久化、`GET /api/sessions/:id/tools` 展示 policy 与状态栏 allow/deny/ask 概览。随后新增 `session-tool-policy.ts`，扩展 `SessionConfig.toolPolicy`，在 `session-service` 归一化并持久化 allow/deny/ask，`session-tool-executor` 合并 permissionMode、toolPolicy、resource risk 与 dirty canvasContext：deny 返回结构化 `policy-denied`，ask 返回带 `permission-required` code 的 pending confirmation，allow 仅降低策略询问但不绕过 dirty-resource-blocked；`agent-turn-runtime` 在发给 provider 前过滤 deny 工具 schema，全部过滤时返回 `policy-disabled`，继续保留模型不支持工具时的 `unsupported-tools`；`SessionToolState`、Backend Contract matrix 和 `ConversationStatusBar` 暴露 policy 状态。`pnpm --dir packages/studio exec vitest run src/api/lib/session-tool-executor.test.ts src/api/lib/agent-turn-runtime.test.ts src/api/lib/session-service.test.ts src/api/routes/session.test.ts src/api/backend-contract-matrix.test.ts src/app-next/agent-conversation/surface/ConversationSurface.test.tsx --reporter=verbose` 通过（6 files / 62 tests，含 SQLite experimental warning 与 session.recovery stdout）；`pnpm --dir packages/studio exec tsc --noEmit --project tsconfig.json --pretty false` 通过。

- [x] 8. 实现 Headless stream-json API
  - 新增或扩展 headless chat API，支持 text 与 stream-json input。
  - 输出 user_message、assistant_delta、tool_use、tool_result、permission_request、error、result 事件。
  - 支持 sessionId 复用、ephemeral/no-session-persistence、max turns/预算限制。
  - 验证：stream-json 输入输出、partial messages、pending confirmation、max turns 测试。
  - 证据：先补 `session-headless-chat-service.test.ts` RED，覆盖持久化 session 创建、stream-json input prompt 提取、no-session-persistence ephemeral session、不写 history、pending confirmation 映射为 `permission_request`、`maxTurns=0` 和 `maxBudgetUsd=0` 的结构化 stop result；随后新增 `session-headless-chat-service.ts`，复用 AgentTurnRuntime、session tools、provider generate 与 session history store，输出 `user_message`、`assistant_delta`、`assistant_message`、`tool_use`、`tool_result`、`permission_request`、`error`、`result` 事件，普通调用写入 session history/recentMessages，ephemeral 调用使用 `ephemeral:<uuid>` 且不落库。新增 `POST /api/sessions/headless-chat`，`outputFormat=stream-json` 返回 `application/x-ndjson`，JSON 输出返回完整 result；补齐 `sessions.headless-chat` Backend Contract matrix 与 `createSessionClient().headlessChat`；保持旧 `POST /api/exec` 不破坏，并扩展 `novelfork exec` 在传入 `--input-format stream-json`、`--output-format stream-json`、`--no-session-persistence` 或 `--max-turns` 时调用新 headless chat API。`pnpm --dir packages/studio exec vitest run src/api/lib/session-headless-chat-service.test.ts src/api/routes/session.test.ts src/api/backend-contract-matrix.test.ts src/app-next/backend-contract/domain-clients.test.ts --reporter=verbose` 通过（4 files / 35 tests，含 SQLite experimental warning 与 session.recovery stdout）；`pnpm --dir packages/cli exec vitest run src/__tests__/exec.test.ts --reporter=verbose` 通过（1 file / 6 tests）；`pnpm --dir packages/studio exec tsc --noEmit --project tsconfig.json --pretty false` 通过。

- [x] 9. 增加 CLI 会话命令
  - 新增 `novelfork chat` 或扩展现有 CLI，调用 headless chat API。
  - 支持 `--session`、`--book`、`--json`、`--input-format`、`--output-format`、`--no-session-persistence`。
  - exit code 映射 success/error/pending confirmation。
  - 验证：CLI text、json、stream-json、sessionId、pending confirmation 测试。
  - 证据：先补 `packages/cli/src/__tests__/chat.test.ts` RED，失败点为 `commands/chat.js` 不存在；随后新增 `chatCommand`、注册到 CLI index，并新增 `headless-chat-common.ts` 复用 Studio `/api/sessions/headless-chat` 调用、model 解析、text/stream-json request body、NDJSON response 解析、JSONL 输出与 success/error/pending confirmation exit code 映射。`novelfork chat` 支持 `--session`、`--book`、`--model`、`--json`、`--input-format`、`--output-format`、`--no-session-persistence`、`--max-turns`、`--max-budget-usd`；同时把 `novelfork exec` 的 stream-json/ephemeral/max-turns 路径改为复用公共 parser，修复真实 NDJSON 响应不能被 `response.json()` 解析的问题，旧默认 `/api/exec` 兼容保留。`pnpm --dir packages/cli exec vitest run src/__tests__/chat.test.ts src/__tests__/exec.test.ts --reporter=verbose` 通过（2 files / 10 tests）；`pnpm --dir packages/cli test` 通过（13 files / 97 tests）；`pnpm --dir packages/cli run typecheck` 通过；`pnpm docs:verify` 通过（84 markdown files / 22 directories）；`git diff --check` 无 whitespace error，仅 LF/CRLF 提示。

- [x] 10. 实现资源 checkpoint service
  - 对正式章节、story/truth、经纬、narrative apply 等写入前创建 checkpoint。
  - 记录 sessionId、messageId、toolUseId、资源路径/hash/snapshotRef。
  - 候选稿、草稿、prompt-preview 不强制 checkpoint。
  - 验证：正式写入前快照、非破坏性写入不快照、checkpoint 缺失失败测试。
  - 证据：先补 `resource-checkpoint-service.test.ts` RED，失败点为缺少 `resource-checkpoint-service` 模块；随后新增 `resource-checkpoint-service.ts`，将正式资源写入前内容保存到 `books/<bookId>/.novelfork/checkpoints/<checkpointId>/resources/*`，写入 `checkpoint.json` 与 `index.json`，记录 `sessionId`、`messageId`、`toolUseId`、`reason`、资源 `kind/id/path/beforeHash/snapshotRef`，并对必需资源缺失返回 `checkpoint-resource-missing`，对 candidate/draft/prompt-preview 返回不强制 checkpoint。扩展 `storage-write-service`：章节覆盖写入和 Truth/story 文件写入前创建 checkpoint，Workbench 未传 sessionId 时使用 `workbench` 审计来源，route body 可透传 `sessionId/messageId/toolUseId`；扩展 `narrative-line-service`：approved apply 写入 `story/narrative_line.json` 前创建 checkpoint，并在 result/audit 中记录 `checkpointId`。`pnpm --dir packages/studio exec vitest run src/api/lib/resource-checkpoint-service.test.ts src/api/lib/storage-write-service.test.ts src/api/lib/narrative-line-service.test.ts --reporter=verbose` 通过（3 files / 13 tests，含 SQLite experimental warning）；`pnpm --dir packages/studio exec tsc --noEmit --project tsconfig.json --pretty false` 通过；`pnpm docs:verify` 通过（84 markdown files / 22 directories）；`git diff --check` 无 whitespace error，仅 LF/CRLF 提示。

- [x] 11. 实现 Rewind preview/apply
  - UI 提供按 message/checkpoint 查看影响资源和恢复预览。
  - 后端返回 diff/hash/risk，apply 必须走确认门。
  - 恢复后记录审计事件和新状态。
  - 验证：preview、批准恢复、拒绝、冲突失败、资源移动失败测试。
  - 证据：先补 `resource-rewind-service.test.ts` RED，失败点为缺少 `resource-rewind-service` 模块；随后新增 `resource-rewind-service.ts`，从 `.novelfork/checkpoints/<checkpointId>/checkpoint.json` 与 snapshotRef 读取资源快照，`previewRewind` 返回 snapshot/current hash、diff、risk、currentExists/snapshotExists/changed。`applyRewind` 无 `confirmationDecision` 时返回 `pending-confirmation` + `resource.rewind` destructive confirmation，拒绝时只写 `rewind-audit.json` 且不恢复文件，批准时校验 `expectedCurrentHashes`、资源移动/删除与 snapshot 缺失，先创建 `rewind-apply` safety checkpoint，再恢复正式资源并写入 approved audit。新增 `GET /api/books/:id/checkpoints/:checkpointId/rewind/preview`、`POST /api/books/:id/checkpoints/:checkpointId/rewind/apply`，补齐 `resources.rewind.preview/apply` Backend Contract matrix 和 `createResourceClient().previewRewind/applyRewind`；`ToolCallCard` 会展示 tool result 中的 `checkpointId` 与受影响资源路径，便于按 message/checkpoint 查看恢复来源。`pnpm --dir packages/studio exec vitest run src/api/lib/resource-rewind-service.test.ts src/app-next/backend-contract/domain-clients.test.ts src/app-next/agent-conversation/surface/ConversationSurface.test.tsx src/api/backend-contract-matrix.test.ts --reporter=verbose` 通过（4 files / 35 tests）；`pnpm --dir packages/studio exec tsc --noEmit --project tsconfig.json --pretty false` 通过；`pnpm docs:verify` 通过（84 markdown files / 22 directories）；`git diff --check` 无 whitespace error，仅 LF/CRLF 提示。

- [x] 12. 记录会话执行结果与用量统计
  - 记录 turn/run duration、num_turns、stop_reason、usage、modelUsage、permission_denials、errors、session_id。
  - provider 不提供成本时显示 unknown，不虚构 USD。
  - UI 区分本轮、session 累计、headless run result。
  - 验证：成功 result、错误 result、权限拒绝、unknown cost、累计 usage 测试。
  - 证据：先补 `session-headless-chat-service.test.ts` RED，要求 Headless result/event 包含 `usage.currentTurn`、`usage.cumulative`、`cost: { status: "unknown", currency: "USD", amount: null }`、`permissionDenials` / `permission_denials`，并将本轮 usage 累加到 session `cumulativeUsage`；补 `ConversationSurface.test.tsx` / `StudioNextApp.test.tsx` RED，要求状态栏显示当前 turn、累计 tokens 与未知成本。随后扩展 `session-headless-chat-service.ts`：从 `assistant_message` / `tool_call` runtime metadata 汇总本轮 token usage，更新持久 session cumulative usage，Headless result/result event 输出 duration/stop_reason/usage/cost/permission denials；`policy-denied` tool_result 会进入 permission denial envelope。扩展 `ConversationStatusBar` 与 `StudioNextApp` usage 聚合：从最近 assistant runtime usage 显示 current turn，从 session `cumulativeUsage` 显示累计，并显示成本 unknown。`pnpm --dir packages/studio exec vitest run src/api/lib/session-headless-chat-service.test.ts src/app-next/agent-conversation/surface/ConversationSurface.test.tsx src/app-next/StudioNextApp.test.tsx --reporter=verbose` 通过（3 files / 49 tests）；`pnpm --dir packages/studio exec tsc --noEmit --project tsconfig.json --pretty false` 通过；`pnpm docs:verify` 通过（84 markdown files / 22 directories）；`git diff --check` 无 whitespace error，仅 LF/CRLF 提示。

- [x] 13. 文档、能力矩阵与验收
  - 更新 CLI/API 文档、能力矩阵、`.kiro/specs/README.md`、CHANGELOG。
  - 运行 session/API/app-next/CLI 相关测试、Studio/Core typecheck 和 `pnpm docs:verify`。
  - 手动冒烟：resume、fork、slash、compact、tool policy、headless、checkpoint/rewind。
  - 未运行验证必须明确记录。
  - 证据：已同步 `README.md`、`AGENTS.md`、`.kiro/specs/README.md`、`CHANGELOG.md`、`docs/01-当前状态/02-Studio能力矩阵.md`、`docs/01-当前状态/03-当前执行主线.md`、`docs/06-API与数据契约/01-Studio API总览.md`、`docs/06-API与数据契约/02-创作工作台接口.md` 与本任务清单。验证：`pnpm --dir packages/cli test` 通过（13 files / 97 tests，含预期 stderr 与 SQLite experimental warning）；`pnpm --dir packages/cli typecheck` 通过；`pnpm --dir packages/core typecheck` 通过；`pnpm --dir packages/studio exec vitest run src/api/lib/session-lifecycle-service.test.ts src/api/lib/session-compact-service.test.ts src/api/lib/session-memory-boundary-service.test.ts src/api/lib/session-headless-chat-service.test.ts src/api/lib/resource-checkpoint-service.test.ts src/api/lib/resource-rewind-service.test.ts src/api/lib/storage-write-service.test.ts src/api/lib/narrative-line-service.test.ts src/api/routes/session.test.ts src/api/backend-contract-matrix.test.ts src/app-next/backend-contract/domain-clients.test.ts src/app-next/agent-conversation/surface/ConversationSurface.test.tsx src/app-next/StudioNextApp.test.tsx --reporter=verbose` 通过（13 files / 110 tests，含 SQLite experimental warning 与 session.recovery stdout）；`pnpm --dir packages/studio exec tsc --noEmit --project tsconfig.json --pretty false` 通过；`pnpm --dir packages/studio exec tsc --noEmit --project tsconfig.server.json --pretty false` 通过；`pnpm docs:verify` 通过（84 markdown files / 22 directories）；`git diff --check` 无 whitespace error，仅 LF/CRLF 提示。手动 GUI 冒烟未运行（本轮无前台 Studio GUI 点击环境），以 session route、app-next、CLI 和 service 自动化覆盖 resume、fork、slash、compact、tool policy、headless、checkpoint/rewind 主链路。