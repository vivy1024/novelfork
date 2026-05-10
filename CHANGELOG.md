# Changelog

本文件记录 **NovelFork** 的版本变更。

---

## Unreleased

> v0.1.0 尚未发布。2026-05-07 已撤回远端 `v0.1.0` tag，GitHub Release 未创建；以下变更仍处于发布前修正与验收阶段，尤其 Claude Code CLI / Codex CLI parity 口径必须重新审计，不能宣称完整对标完成。

### 新功能（novel-writing-features）
- feat: 新书引导式创作向导（NewBookGuide 11题三模式：预设选择/自定义/跳过随机）
- feat: 侧边栏"叙事线"改为"叙事线（书籍）"
- feat: 新建书籍表单极简化（仓库优先+可选书名）
- feat: 写作预设面板接入新工作台
- feat: AI 味检测报告接入新工作台
- feat: 章节健康度（节奏+对话+句长直方图）接入新工作台
- feat: 选段写作（续写/扩写/补写）+ 多版本变体接入新工作台
- feat: 日更进度追踪 + 节拍表接入新工作台
- feat: 平台合规检查 + 导出（TXT/Word/ePub）接入新工作台
- feat: 角色弧线 + 文风漂移检测 + 模板市场接入新工作台
- docs: 新增 novel-writing-features spec（requirements + design + tasks）

### 改进
- 对话界面底部三行结构对标 NarraFork：模型显示完整名称、权限显示完整文字、实时计时器、中断/继续改为文字按钮、顶部栏添加返回按钮、Git 状态栏加 🏠 前缀
- refactor: truthFile → jingwei 全局重命名（22 文件），消除 InkOS 遗留的"真相文件"概念，统一为"经纬资料"
- 功能缺口 P0/P1/P2/P3：实现 AskUserQuestion 机制（与 NarraFork 一致，复用 permission 机制）——新建 UserQuestionGate 组件（text/single/multi/ranged-number/ai-suggest 五种输入类型），PGI 和 Guided Generation 工具产出 confirmation 触发问题表单，confirmTool 支持附带 answers；实现 Agent 编排可见执行链 UI——新建 WorkflowProgressCard 组件；Tier 1 问卷集成建书流程——创建成功后展示可选问卷向导；写作工具面板——WritingToolsPanel 7 种工具快捷入口；驾驶舱增强——经纬摘要+候选稿摘要；首次运行欢迎弹窗集成；学习中心——9 篇文档 + `/next/learn` 前端页面；仪表盘空态教学增强；Checkpoint/Rewind UI——新增 `GET /api/books/:id/checkpoints` 路由 + CheckpointPanel 组件（列表/预览/回滚）。
- 文档重写：全面重写 `docs/02-用户指南`（小说管理与创作、AI写作功能、叙述者对话、设置与套路）、`docs/03-产品与流程`（创作流程、资源管理器模型、AI输出与候选稿、故事经纬）、`docs/04-架构与设计`（系统架构、Studio工作台、Agent写作管线、驾驶舱），所有内容基于功能审计后的实际代码状态编写。
- 功能审计 P3-13/14/15/16/17：实现驾驶舱总览（CockpitOverview：进度条/字数/审校/风险/建议）、文件修改追踪（从 toolCalls 提取 Write/Edit 文件路径）、Context Ring（SVG 圆环上下文使用率可视化）、段落压缩 UI（compact-before 右键菜单接通 compactSession）、经纬资料编辑器（JingweiEntryEditor：标题+Markdown 编辑/保存/删除）。
- 功能审计 P2-11：实现候选稿管理前端——新建 `CandidateActionsBar` 组件（状态展示、接受/拒绝/归档/删除操作），补全 `resource-client` 的 reject/archive/delete API 方法，`WorkbenchCanvas` 集成操作栏，候选稿 viewer 改为只读展示，`WritingWorkbenchRoute` 透传 candidateActions props。
- `claude-codex-novel-agent-v1` 全部 48 个任务完成：Phase 0（canonical runtime events）、Phase 1（session lifecycle/stream-json/CLI headless）、Phase 2（command registry/executor/policy resolver/confirmation envelope/Codex status）、Phase 3（RuntimeSettings/settings 接实/capability registry/routines 接实）、Phase 4（Novel command pack/context tools/PGI/guided/candidate/write-next workflow/UI/CLI 接入）、Phase 5（叙事线/经纬/写作模式/健康视图/钩子接入）、Phase 6（MCP/skills/hooks/subagents 统一治理）、Phase 7（E2E 验收矩阵）、Phase 8（文档收口/发布标准重定）。
- `claude-codex-novel-agent-v1` Task15：新增 `runtime-settings.ts`，定义统一配置来源/作用域合并模型（session > project > user > imported > default），每个 entry 记录 value/source/scope/status/error/lastUpdated/overrides，支持 ToolPolicy、McpServerConfig、SubagentConfig、WorkflowRecipe、CommandDefinition、SkillDefinition、HookDefinition 等任意配置类型。
- `claude-codex-novel-agent-v1` Task14：新增 `codex-runtime-status.ts`，定义 `current | partial | planned | reference-only | unsupported` 状态词汇与 `getCodexRuntimeCapabilityStatuses()`；Codex sandbox 请求降级保存为 planned，approval 标 partial，review/image 标 reference-only；settings runtime facts 与 headless result event 同源输出 `runtime_capabilities`。
- `claude-codex-novel-agent-v1` Task13：扩展 `ToolConfirmationRequest` / `ToolConfirmationAudit` 并新增 `normalizeToolConfirmationRequest()`，将 Studio pending confirmation、headless `permission_request` 与 transcript audit 统一为包含 targetResources、source、checkpoint、operations 的 confirmation envelope，ConfirmationGate 可展示目标资源、来源 session/message/tool call、diff/checkpoint 与 approve/reject 操作。
- `claude-codex-novel-agent-v1` Task12：新增统一 `resolveSessionToolPolicy()`，将 permission mode、tool allow/deny/ask、resource risk、dirty canvas guard 与 headless pending 策略收敛为同一 policy resolution，并让 provider-visible tool schema、Agent turn、tool executor 与 headless/CLI 路径共享 `visibleToModel`、`requiresConfirmation`、`denied`、`risk`、`reason`、`checkpointRequired` 输出。
- `claude-codex-novel-agent-v1` Task11：新增共享 runtime command executor，将 Studio slash command 执行和 headless slash prompt 从 UI 本地逻辑迁入 `packages/core/src/registry/command-executor.ts`，统一产出 `command_started`、`command_completed`、`command_error` canonical events，并通过 `runtime-stream-json.ts` 输出到 headless stream-json；命令错误不再进入模型路径。
- `claude-codex-novel-agent-v1` Task10：新增 `packages/core/src/registry/command-registry.ts` 作为 slash/runtime command 单一事实源，覆盖基础命令、Claude-style 命令与 `/novel:*` planned 命令，并让 Studio slash palette、Routines 命令清单和 CLI help 同源消费该 registry。
- `claude-codex-novel-agent-v1` Task9：实现 `novelfork -p` 与 `novelfork exec` 同源 prompt path，根级 `-p/--print` 复用 headless chat API 和 `runHeadlessChatCommand()`，`exec`/`chat` 补 `--permission-mode`，并统一传递 `--book`、`--session`、`--model`、`--permission-mode`、`--root`、`--output-format stream-json` 到共享 `/api/sessions/headless-chat` 请求体。
- `claude-codex-novel-agent-v1` Task8：新增统一 stream-json / NDJSON emitter，从 canonical RuntimeEvent 派生 user/assistant/tool/permission/checkpoint/candidate/resource/usage/error/result 事件，并将 headless stream-json 输出改为同源 emitter。
- `claude-codex-novel-agent-v1` Task7：补齐 session lifecycle 的 runtime 证据接线，fork summary 记录源 transcript event 类型/count 与累计 usage，compact summary 记录被压缩消息的 transcript event summary，确保 continue/resume/fork/compact 的可审计上下文不丢失。
- `claude-codex-novel-agent-v1` Task6：新增 runtime transcript metadata，将 canonical RuntimeEvent 附加到持久化 session/headless 消息，覆盖工具调用、确认门、checkpoint、候选稿、usage、error 与 result，确保 resume/replay 可回读 Agent 事件来源。
- `claude-codex-novel-agent-v1` Task5：新增共享 `executeRuntimeTurn()` 入口，并将 Studio 会话、headless chat 与 legacy headless exec 收敛为同一 AgentTurnRuntime 调用路径；headless chat 结果新增 `canonicalEvents`，为 Studio/CLI/headless 同源 RuntimeEvent 输出打底。
- `claude-codex-novel-agent-v1` Task4：新增 canonical runtime event/item/result 类型与映射，覆盖 message、assistant_delta、tool_use、tool_result、permission_request、checkpoint、candidate、usage、error、result，并提供 session message、AgentTurnEvent、headless stream-json event 到统一 RuntimeEvent 的转换函数。
- `claude-codex-novel-agent-v1` Task3：冻结旧 `v0-1-0-release-readiness` Task21-23 发布动作，更新 README、当前执行主线、项目当前状态和测试状态口径，明确下一步不再继续旧 Task21，而是按新主线重新定义 Agent 产品化与小说创作端到端完成标准。
- `claude-codex-novel-agent-v1` Task2：新增 `scripts/verify-docs.test.mjs` 与 `scripts/verify-docs.ts` 高风险完成声明守卫，要求 current/planning 文档中的 Claude/Codex/小说 Agent 完成声明必须带 `current/partial/not-wired/planned/unsupported/non-goal` 状态或 Studio/CLI/headless 端到端证据；同步降级 Studio 能力矩阵、当前执行主线、设置指南与小说创作流程中的旧“真实可用/已完成”高风险口径。
- `claude-codex-novel-agent-v1` Task1：新增 `docs/01-当前状态/04-产品能力重新验收矩阵.md`，按 `current/partial/not-wired/planned/unsupported/non-goal` 重验 Claude/Codex 对标、写下一章、经纬、问卷、PGI、Guided Plan、候选稿、写作模式、写作工具、Agent 管线、设置、套路、MCP 与 CLI/headless 等核心能力，明确只有 Studio 或 CLI/headless 端到端证据才能标为 current。
- v0.1.0 Release Readiness Task20：新增 `findUncentralizedBackendContractApiStrings` 守卫，要求 backend-contract 生产客户端的 `/api/*` 路径只能集中在 `api-paths.ts`；将 provider/resource/session/writing-action client 中散写的 route literal 迁移为 `BOOKS_API_PATH`、`SESSIONS_API_PATH`、`buildBookApiPath()`、`buildSessionApiPath()`、`buildSessionsApiPath()`、`buildProviderModelTestApiPath()` 与 `appendApiQuery()`，并确认 settings facts、routines/provider/session UI 中的 planned/unsupported/fixture 口径仍为透明降级而非假 current。验证包含 Studio Vitest 全量 213 files / 1274 tests、Studio typecheck、docs verify 与 diff check。
- v0.1.0 Release Readiness Task19：按 `claude/restored-cli-src/` 重新对照 Claude slash/permission/session/headless/usage 源码，确认 NovelFork 当前 slash registry、permissionMode/toolPolicy、session lifecycle 与 headless usage 都只能作为自身 `partial` 能力；新增 `CLAUDE_CODE_PARITY_MATRIX`、`reference-only` parity 状态，并把 Codex exec JSONL event taxonomy 降为 `reference-only`，设置页 `deriveClaudeParitySettingsFacts` / `deriveCodexParitySettingsFacts` 同步拆分 slash、permission、session、headless、terminal non-goal、Codex exec taxonomy 等事实，避免把本机 help/官方文档或简化实现写成完整对标；同时修正 `tools.test.ts` 中固定期待 `0.0.x` 的版本断言，验证包含 Studio Vitest 全量 213 files / 1273 tests、Studio typecheck、docs verify 与 diff check。
- Backend Contract：新增可测试的 MVP 能力矩阵，固化启动/侧栏、session、资源工作台、AI 写作动作与 provider/model 的关键能力到真实 route、WebSocket 或 session tool source，并保留 `process-memory`、`prompt-preview`、`chunked-buffer` 等非 current 语义；完善 capability status UI 决策表，为 unsupported/planned 能力提供可见 disabled reason，避免前端只有禁用态却没有真实说明；确认 typed contract client 覆盖 2xx、4xx、5xx、非法 JSON、network error，并保留 gate、streamSource、null/unknown metric 与 capability metadata；补齐 session/resource/provider/writing action 领域 client 的默认共享响应类型，减少组件侧重复声明核心 API 类型；补充 session WebSocket 合同 helper，封装 `resumeFromSeq` URL、client envelope、server envelope 解析与 replay/resetRequired 状态归并；新增资源树 contract adapter，用真实 books/chapters/candidates/drafts/story/truth/jingwei/narrative-line route 组装资源节点，并为 read/edit/delete/apply/unsupported 显式挂载 capability；新增写作动作 contract adapter，区分 session-native 候选链、异步 write-next、AI draft、writing modes、hooks、审校/检测与 gate/unsupported 结果，确保 AI 输出默认进入 candidate/draft/preview 边界。
- Backend Contract：完成 task 9 验证收口，新增 `backend-contract-verification` 命令报告与 app-next API guard，补齐 `fetchJson` 到 `ContractClient` 的桥接和错误 envelope 转换；将 ChatWindow/WorkspacePage 的关键 session、provider、资源入口接入领域 client，并修复 NodeNext 导入、Workspace sessions 查询 mock 与会话快照/增量消息竞态。
- Frontend Live Wiring：将 `/next` live route 接入真实 Conversation runtime、模型/权限状态栏、Tool Result Renderer、session tool 确认门、Writing Workbench 资源/保存/dirty context 与写作动作跳转；`/next/search` 直接挂载 `SearchPage`，`/next/routines` 挂载 routines/MCP/skills 管理页，`/next/settings` 挂载 settings/provider runtime 面板并确保模型配置入口可达，不再使用“稍后接线”作为当前事实；修复真实浏览器中 WebSocket CONNECTING 期间自动 ack 触发 `InvalidStateError` 导致 narrator route 空白的问题，改为 socket open 后刷新待发送 envelope；`frontend-live-wiring-v1` 已完成 10/10，阶段收口包含 app-next 定向测试、Studio/Core TypeScript、docs verify 与 `/next` live routes 冒烟。
- Legacy Source Retirement：启动 `legacy-source-retirement-v1`，完成旧源码依赖基线并新增 `dependency-baseline.md`，登记旧三栏、旧 ChatWindow、windowStore、tsconfig exclude、Backend Contract legacy route 的删除/迁移/保留清单；完成 Task 2 会话中心迁移，`SessionCenter` 改用 session domain client 读取、搜索、归档/恢复真实 `/api/sessions` 数据，`SessionCenterPage` 打开会话时跳转 `/next/narrators/:sessionId`，不再通过 `windowStore` 创建 ChatWindow shell 窗口；完成 Task 3 Admin SessionsTab 迁移，改用 session list、chat state 与 pending tools 作为运行态事实源，不再依赖 `windowStore`/`windowRuntimeStore` 或 ChatWindow 已打开窗口；完成 Task 4 ToolCall/Recovery 资产迁移，新增 session recovery presentation，让 `RecoveryBadge` 脱离 window runtime 类型，并在 narrator conversation tool card 中复用 `ToolCallBlock` 的折叠输出、图标、错误和 exit code 展示能力；完成 Task 5 旧三栏源码退役，删除 `StudioApp`、`workspace/**`、`editor/**`、旧 `ConversationPanel` / `GitChangesView` / `useStudioData` 与 `components/split-view/**`，并将文档/mock debt 事实源迁到 Backend Contract resource tree 与 Writing Workbench；完成 Task 6 旧 ChatWindow 视觉层退役，删除 `components/ChatWindow.tsx`、测试与 `ChatWindowManager.tsx`，并把源码预览 fallback、ToolCall README、模型池登记和测试状态口径迁到 ConversationSurface；完成 Task 7 tsconfig/retirement guard 收紧，移除旧前端路径 exclude，改为 guard 检查旧路径不存在且不靠 exclude 隐藏问题；完成 Task 8 未挂载 route 残留清理，删除 `hooks-countdown.ts` 与 `poison-detector.ts`，移除 routes/server 注释残留、tsconfig exclude 和 mock-debt allowlist，并把 Backend Contract matrix 改为已删除源码的 unsupported 口径；完成 Task 9 legacy route 候选退役，删除轻量 `/api/chat/:bookId/*` route/test、未挂载 `ChatPanel` 组件/test、`createChatRouter` 挂载、book-chat matrix/mock debt 条目，并从 `createAIRouter` 移除 exact `POST /api/agent`，保留 `/api/agent/config` current、`/api/pipeline` process-memory、`/api/monitor` unsupported、旧导出与旧 AI panel deprecated 口径；完成 Task 10 文档、变更记录与验收收口，`legacy-source-retirement-v1` 更新为 10/10 已完成，并记录 app-next 回归、受影响 API 测试、Studio typecheck、docs verify 与 diff check 证据。
- Conversation Parity：启动 `conversation-parity-v1` 执行并完成一阶段 NovelFork 会话能力清单；注意，这不等同 Claude Code CLI / Codex CLI 完整对标。Task 1 仅建立 Claude Code parity 对照与范围守护，新增 `claude-code-parity-baseline.md`，基于本机 Claude Code CLI 2.1.69 help/version 输出整理 resume/continue/fork、slash、compact、tool policy、headless stream-json、checkpoint/rewind、usage result 的实现范围，并明确 tmux、Chrome bridge、remote-control、插件市场和完整终端 TUI 为非目标；完成 Task 2 会话 lifecycle service，新增 `session-lifecycle-service.ts` 与测试，支持 continue latest、resume by id、归档 readonly/restore 和 fork session，fork 继承必要配置/绑定并写入 system summary，不复用源 sessionId、不复制完整历史；完成 Task 3 ResumePicker/ForkDialog UI 接线，`SessionCenter` 新增 scoped continue latest、Fork 标题/继承说明、真实错误展示，并补齐 `/api/sessions/lifecycle/latest`、`/:id/fork`、`/:id/restore` Backend Contract route/client/matrix；完成 Task 4 Slash Command Registry，新增会话 slash registry 与 Composer 拦截，支持 `/help`、`/status`、`/model`、`/permission`、`/fork`、`/resume` 的建议、解析、结构化执行与错误 status 展示，不把非法命令发送给模型；完成 Task 5 `/compact` 产品化，新增 session compact service、`POST /api/sessions/:id/compact`、Backend Contract client/matrix 与 `/compact` slash command 接线，成功后写入 `session-compact-summary`、保留 recent messages、记录 source/preserved range、model、time 和 budget，失败时保留原历史；完成 Task 6 Memory 写入边界，新增 `session-memory-boundary-service.ts`、`GET /api/sessions/:id/memory/status`、`POST /api/sessions/:id/memory` 与 Backend Contract client/matrix，区分用户偏好、项目事实、临时剧情草稿，稳定偏好/项目事实写入带审计 envelope，临时剧情草稿不自动写长期 memory，writer 未配置时返回 readonly/可恢复错误并在会话中心显示只读状态；完成 Task 7 细粒度工具权限策略，新增 `session-tool-policy.ts` 与 `SessionConfig.toolPolicy` allow/deny/ask，工具执行合并 permissionMode、tool policy、resource risk 与 dirty canvasContext，deny 返回 `policy-denied`，ask 返回带 `permission-required` code 的确认门，provider schema 发送前过滤 deny 工具，全部被禁用时返回 `policy-disabled`，状态栏展示工具策略概览并同步 Backend Contract matrix；完成 Task 8 Headless stream-json API，新增 `session-headless-chat-service.ts` 与 `POST /api/sessions/headless-chat`，支持 text / stream-json input、NDJSON stream-json output、sessionId 复用、新 session 持久化、`ephemeral:<uuid>` no-session-persistence、`permission_request`、`error/result` envelope、max turns 与 max budget stop result，并补齐 `sessions.headless-chat` Backend Contract client/matrix；旧 `POST /api/exec` 保持兼容，`novelfork exec` 在 stream-json/ephemeral/max-turns 模式下调用新 headless chat API；完成 Task 9 CLI 会话命令，新增 `novelfork chat` 与 `headless-chat-common.ts`，支持 text/json/stream-json、`--session`、`--book`、`--model`、`--no-session-persistence`、max turns/budget，并将 success/error/pending confirmation 映射到 exit code 0/1/2，同时修复 `novelfork exec --output-format stream-json` 解析真实 NDJSON response；完成 Task 10 资源 checkpoint service，新增 `resource-checkpoint-service.ts`，正式章节、Truth/story 与 narrative apply 写入前保存 `.novelfork/checkpoints/<checkpointId>` 快照，记录 session/message/toolUse、reason、资源 path/hash/snapshotRef，candidate/draft/prompt-preview 不强制 checkpoint，缺失必需资源返回真实错误；完成 Task 11 Rewind preview/apply，新增 `resource-rewind-service.ts` 与 `/api/books/:id/checkpoints/:checkpointId/rewind/preview|apply`，preview 返回 diff/hash/risk，apply 必须走 destructive confirmation，支持拒绝审计、approved safety checkpoint + restore audit、expected hash 冲突失败、资源移动/删除失败，并在工具卡展示 checkpointId 与受影响资源；完成 Task 12 会话执行结果与用量 envelope，Headless result/result event 输出 duration、stop_reason、usage.currentTurn、usage.cumulative、cost unknown 与 permission_denials，持久 session 累加 cumulativeUsage，状态栏区分当前 turn、累计 tokens 与未知成本；完成 Task 13 文档、能力矩阵与验收收口，将 `conversation-parity-v1` 标记为 13/13 完成，并记录 CLI、Core、Studio 聚焦回归、typecheck、docs verify 与 diff check 证据（手动 GUI 冒烟未运行，已明确记录）。
- Backend Core Refactor：已建立 `contract-guard.md`，冻结 route/tool/shared type 映射、不可破坏合同分组和 task 2 补测清单；新增 `contract-regression.test.ts` 覆盖 books、sessions、providers、resources、writing actions 的成功、404/400、unsupported/gate 与脱敏边界。

### 文档
- 新增 `agent-native-workspace-v1` spec 与任务文档，明确工作台恢复为右侧叙述者会话主入口、中间画布、左侧资源栏，并将引导式生成定义为 Plan Mode 风格的工具链与确认门；同步 `.kiro/specs/README.md` 当前 active spec 索引。
- 同步 README、Studio README、测试状态与架构总览中的测试数量、编译命令和 release 产物口径。
- 将"代码/配置/流程变更必须同步文档与 CHANGELOG、验收前全仓核对旧口径"的文档纪律写入 `CLAUDE.md` 与 `AGENTS.md`。
- 同步 `.kiro/steering/` 中的项目结构、Tauri 退役、构建测试命令与文档发布纪律口径。
- docs: 全仓文档审计——修复 CLAUDE.md 核心功能列表遗漏（补齐 13 个新组件）、当前状态表过时口径；修复 project-profile.md QuestionnaireWizard→NewBookGuide 口径；修复 01-项目当前状态.md 断链（创作工作台使用指南→小说管理与创作、设置与模型配置→设置与套路）；修复 03-当前执行主线.md 末尾乱码；修复 01-小说创作流程.md title 必填→可选、补新书引导步骤、导出 planned→已接入、文风漂移 planned→已接入、叙事线→叙事线（书籍）；修复 02-资源管理器模型.md 叙事线口径；补齐 03-AI写作功能.md 写作工具面板全部组件文档；修复 04-产品能力重新验收矩阵.md 写作模式/写作工具 not-wired→partial；更新 README.md 导出格式和写作工具列表；更新 learning/03-guided-generation.md QuestionnaireWizard→NewBookGuide。

### 修复
- 修复单文件 release 产物入口对 `--root` / `--port` 命名启动参数的解析，保留旧版 positional root fallback，确保 `dist/novelfork-v0.0.5-windows-x64.exe --root=. --port=<port>` 可直接冒烟启动。
- 修复 OpenAI-compatible provider 不能调用含点号 session tool 的问题：发送给上游前将内部工具名映射为 provider-safe function name，并在返回 tool call 时还原内部工具名，确保官方 DeepSeek 等严格校验 function name 的 provider 可执行 `cockpit.get_snapshot`、PGI 与 Guided 工具链。

## v0.0.4 (2026-05-02)

### 改进
- 将 Studio 共享可见 UI 文案统一归入中文口径，覆盖聊天、Routines、Provider、权限、监控、搜索与工具结果等组件。
- 强化 release 版本管理规则，明确版本变动需同步 package、CLAUDE、AGENTS、CHANGELOG，任务验收后需 push，正式发布需推送 tag 并上传 GitHub Release 产物。

### 测试
- 更新 Studio 本地化断言，并新增 UI completion audit，防止核心共享 UI 文案回退为英文。

## v0.0.3 (2026-05-02)

### 修复
- 修复根 `bun:compile` 与 Studio 权威编译链路不一致的问题，删除旧资源生成器入口。
- 修复 Studio Next 搜索、项目模型覆盖、工作流页面与现有 API 的契约断链。
- 修复 CI / release 工作流、CLI 当前文案、Node 版本口径与仓库本地残留追踪问题。
- 清理已退役 Tauri 桥接代码、依赖与前端运行时残留，补充插件生命周期解绑能力。

### 测试与文档
- 新增 compile、search、app-next API、CI/release、仓库卫生、Tauri 退役边界、CLI 口径、插件生命周期回归测试。
- 修正文档头信息与视觉审计标记，恢复 `docs:verify` 与 Studio Next 视觉审计验证。

## v0.0.2 (2026-05-01)

### 桌面应用
- 默认启动 NarraFork 风格应用窗口：底层使用 Edge/Chrome app mode 渲染 Studio，不显示浏览器地址栏、标签页或普通浏览器外壳。
- 新增 `NOVELFORK_NO_BROWSER=1`、`NOVELFORK_WINDOW_MODE=none|browser|app`、`NOVELFORK_BROWSER_PATH` 等窗口启动控制。

### 构建与发布
- 恢复 `bun compile` 前端资源嵌入，单文件产物内置 Studio 静态资源。
- 编译脚本同步生成根目录 `dist/novelfork.exe` 和带版本号的 release 产物。

## v0.0.1 (2026-05-01)

### 创作工作台
- 三栏布局：资源树 / TipTap 富文本编辑器 / 右侧面板
- 资源管理器：章节、候选稿、草稿、大纲、经纬、故事文件、真相文件、素材、发布报告
- Truth/Story 文件全部中文化（18 个映射）
- 章节/草稿/候选稿/文件删除功能（6 个 DELETE API）
- 导出 Markdown/TXT

### 写作模式
- 6 种写作模式接入 LLM 真实生成（续写/扩写/补写/对话/多版本/大纲分支）
- 非破坏性写入：AI 结果只进候选区
- prompt-preview 降级路径（无 session LLM 时）

### AI 动作
- 生成下一章 / 续写段落 / 审校 / 改写 / 去 AI 味 / 连续性检查
- 所有动作返回真实 API 数据（非固定文案）

### Agent 系统
- 5 种 Agent 角色：Writer / Planner / Auditor / Architect / Explorer
- agentId → 专属 system prompt（200+ 行领域知识/角色）
- session-chat-service 自动注入 agent prompt
- 编排函数 runWritingPipeline（Explorer → Planner → Writer → Auditor）
- Explorer Agent 新增（只读探索角色）
- ToolsTab 默认开关调整：9 开 / 13 关

### 驾驶舱
- 右侧面板默认 Tab：总览 / 伏笔 / 设定 / AI
- 总览：日更进度 + 章节进度 + 当前焦点 + 最近摘要 + 风险
- 伏笔：bible foreshadow events + pending_hooks.md 预览
- 设定：bible settings + book_rules.md
- AI：provider/model 状态 + 最近候选稿 metadata

### 故事经纬
- Bible/Jingwei API：人物/事件/设定/章节摘要 CRUD
- 三种可见性：tracked / global / nested
- 时间线纪律（防剧透）
- 经纬模板应用
- 问卷系统 + AI 建议 + 核心设定变更协议

### 合规与预设
- 敏感词扫描（5 平台规则集）
- AI 味检测（12 规则本地 + 朱雀 API）
- 发布就绪检查 + AI 使用声明生成
- 6 流派 / 5 文风 / 6 基底 / 8 逻辑规则预设

### 工程底座
- createAppStore：全局状态 pub/sub（35 行）
- API Client：15+ typed 方法（books/chapters/candidates/progress）
- 统一工具目录：Core 18 + NarraFork 22 = 40 个工具
- bun compile：单文件可执行程序（115MB）

### 平台
- PWA 支持（autoUpdate + standalone）
- Bun + Hono + React 19 + SQLite + Vite
- 137 测试文件 / 801 测试 / typecheck 通过

### 文档
- 能力矩阵 v2.0（覆盖全部 spec）
- 系统架构 / 创作流程 / 使用指南 / API 接口 全部更新
- AI 写作工具对比分析
- 根/包/文档 README 完善

---

## v0.0.0 (2026-04-19)

### 项目基础
- Fork 自 InkOS，专注中文网文创作
- monorepo 结构：core / studio / cli
- Bun + React 19 + Hono + SQLite 技术栈
- 多 Agent 写作管线骨架
- 旧平台纠偏，文档重构
