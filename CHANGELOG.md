# Changelog

本文件记录 **NovelFork** 的版本变更。

---

## Unreleased

### 改进
- Backend Contract：新增可测试的 MVP 能力矩阵，固化启动/侧栏、session、资源工作台、AI 写作动作与 provider/model 的关键能力到真实 route、WebSocket 或 session tool source，并保留 `process-memory`、`prompt-preview`、`chunked-buffer` 等非 current 语义；完善 capability status UI 决策表，为 unsupported/planned 能力提供可见 disabled reason，避免前端只有禁用态却没有真实说明；确认 typed contract client 覆盖 2xx、4xx、5xx、非法 JSON、network error，并保留 gate、streamSource、null/unknown metric 与 capability metadata；补齐 session/resource/provider/writing action 领域 client 的默认共享响应类型，减少组件侧重复声明核心 API 类型；补充 session WebSocket 合同 helper，封装 `resumeFromSeq` URL、client envelope、server envelope 解析与 replay/resetRequired 状态归并；新增资源树 contract adapter，用真实 books/chapters/candidates/drafts/story/truth/jingwei/narrative-line route 组装资源节点，并为 read/edit/delete/apply/unsupported 显式挂载 capability；新增写作动作 contract adapter，区分 session-native 候选链、异步 write-next、AI draft、writing modes、hooks、审校/检测与 gate/unsupported 结果，确保 AI 输出默认进入 candidate/draft/preview 边界。
- Backend Contract：完成 task 9 验证收口，新增 `backend-contract-verification` 命令报告与 app-next API guard，补齐 `fetchJson` 到 `ContractClient` 的桥接和错误 envelope 转换；将 ChatWindow/WorkspacePage 的关键 session、provider、资源入口接入领域 client，并修复 NodeNext 导入、Workspace sessions 查询 mock 与会话快照/增量消息竞态。
- Frontend Live Wiring：将 `/next` live route 接入真实 Conversation runtime、模型/权限状态栏、Tool Result Renderer、session tool 确认门、Writing Workbench 资源/保存/dirty context 与写作动作跳转；`/next/search` 直接挂载 `SearchPage`，`/next/routines` 挂载 routines/MCP/skills 管理页，`/next/settings` 挂载 settings/provider runtime 面板并确保模型配置入口可达，不再使用“稍后接线”作为当前事实；修复真实浏览器中 WebSocket CONNECTING 期间自动 ack 触发 `InvalidStateError` 导致 narrator route 空白的问题，改为 socket open 后刷新待发送 envelope；`frontend-live-wiring-v1` 已完成 10/10，阶段收口包含 app-next 定向测试、Studio/Core TypeScript、docs verify 与 `/next` live routes 冒烟。
- Legacy Source Retirement：启动 `legacy-source-retirement-v1`，完成旧源码依赖基线并新增 `dependency-baseline.md`，登记旧三栏、旧 ChatWindow、windowStore、tsconfig exclude、Backend Contract legacy route 的删除/迁移/保留清单；完成 Task 2 会话中心迁移，`SessionCenter` 改用 session domain client 读取、搜索、归档/恢复真实 `/api/sessions` 数据，`SessionCenterPage` 打开会话时跳转 `/next/narrators/:sessionId`，不再通过 `windowStore` 创建 ChatWindow shell 窗口；完成 Task 3 Admin SessionsTab 迁移，改用 session list、chat state 与 pending tools 作为运行态事实源，不再依赖 `windowStore`/`windowRuntimeStore` 或 ChatWindow 已打开窗口；完成 Task 4 ToolCall/Recovery 资产迁移，新增 session recovery presentation，让 `RecoveryBadge` 脱离 window runtime 类型，并在 narrator conversation tool card 中复用 `ToolCallBlock` 的折叠输出、图标、错误和 exit code 展示能力；完成 Task 5 旧三栏源码退役，删除 `StudioApp`、`workspace/**`、`editor/**`、旧 `ConversationPanel` / `GitChangesView` / `useStudioData` 与 `components/split-view/**`，并将文档/mock debt 事实源迁到 Backend Contract resource tree 与 Writing Workbench；完成 Task 6 旧 ChatWindow 视觉层退役，删除 `components/ChatWindow.tsx`、测试与 `ChatWindowManager.tsx`，并把源码预览 fallback、ToolCall README、模型池登记和测试状态口径迁到 ConversationSurface；完成 Task 7 tsconfig/retirement guard 收紧，移除旧前端路径 exclude，改为 guard 检查旧路径不存在且不靠 exclude 隐藏问题；完成 Task 8 未挂载 route 残留清理，删除 `hooks-countdown.ts` 与 `poison-detector.ts`，移除 routes/server 注释残留、tsconfig exclude 和 mock-debt allowlist，并把 Backend Contract matrix 改为已删除源码的 unsupported 口径；完成 Task 9 legacy route 候选退役，删除轻量 `/api/chat/:bookId/*` route/test、未挂载 `ChatPanel` 组件/test、`createChatRouter` 挂载、book-chat matrix/mock debt 条目，并从 `createAIRouter` 移除 exact `POST /api/agent`，保留 `/api/agent/config` current、`/api/pipeline` process-memory、`/api/monitor` unsupported、旧导出与旧 AI panel deprecated 口径；完成 Task 10 文档、变更记录与验收收口，`legacy-source-retirement-v1` 更新为 10/10 已完成，并记录 app-next 回归、受影响 API 测试、Studio typecheck、docs verify 与 diff check 证据。
- Conversation Parity：启动 `conversation-parity-v1` 执行并完成 Task 1 Claude Code parity 对照与范围守护，新增 `claude-code-parity-baseline.md`，基于本机 Claude Code CLI 2.1.69 help/version 输出整理 resume/continue/fork、slash、compact、tool policy、headless stream-json、checkpoint/rewind、usage result 的实现范围，并明确 tmux、Chrome bridge、remote-control、插件市场和完整终端 TUI 为非目标；完成 Task 2 会话 lifecycle service，新增 `session-lifecycle-service.ts` 与测试，支持 continue latest、resume by id、归档 readonly/restore 和 fork session，fork 继承必要配置/绑定并写入 system summary，不复用源 sessionId、不复制完整历史；完成 Task 3 ResumePicker/ForkDialog UI 接线，`SessionCenter` 新增 scoped continue latest、Fork 标题/继承说明、真实错误展示，并补齐 `/api/sessions/lifecycle/latest`、`/:id/fork`、`/:id/restore` Backend Contract route/client/matrix；完成 Task 4 Slash Command Registry，新增会话 slash registry 与 Composer 拦截，支持 `/help`、`/status`、`/model`、`/permission`、`/fork`、`/resume` 的建议、解析、结构化执行与错误 status 展示，不把非法命令发送给模型；完成 Task 5 `/compact` 产品化，新增 session compact service、`POST /api/sessions/:id/compact`、Backend Contract client/matrix 与 `/compact` slash command 接线，成功后写入 `session-compact-summary`、保留 recent messages、记录 source/preserved range、model、time 和 budget，失败时保留原历史；完成 Task 6 Memory 写入边界，新增 `session-memory-boundary-service.ts`、`GET /api/sessions/:id/memory/status`、`POST /api/sessions/:id/memory` 与 Backend Contract client/matrix，区分用户偏好、项目事实、临时剧情草稿，稳定偏好/项目事实写入带审计 envelope，临时剧情草稿不自动写长期 memory，writer 未配置时返回 readonly/可恢复错误并在会话中心显示只读状态；完成 Task 7 细粒度工具权限策略，新增 `session-tool-policy.ts` 与 `SessionConfig.toolPolicy` allow/deny/ask，工具执行合并 permissionMode、tool policy、resource risk 与 dirty canvasContext，deny 返回 `policy-denied`，ask 返回带 `permission-required` code 的确认门，provider schema 发送前过滤 deny 工具，全部被禁用时返回 `policy-disabled`，状态栏展示工具策略概览并同步 Backend Contract matrix；完成 Task 8 Headless stream-json API，新增 `session-headless-chat-service.ts` 与 `POST /api/sessions/headless-chat`，支持 text / stream-json input、NDJSON stream-json output、sessionId 复用、新 session 持久化、`ephemeral:<uuid>` no-session-persistence、`permission_request`、`error/result` envelope、max turns 与 max budget stop result，并补齐 `sessions.headless-chat` Backend Contract client/matrix；旧 `POST /api/exec` 保持兼容，`novelfork exec` 在 stream-json/ephemeral/max-turns 模式下调用新 headless chat API；完成 Task 9 CLI 会话命令，新增 `novelfork chat` 与 `headless-chat-common.ts`，支持 text/json/stream-json、`--session`、`--book`、`--model`、`--no-session-persistence`、max turns/budget，并将 success/error/pending confirmation 映射到 exit code 0/1/2，同时修复 `novelfork exec --output-format stream-json` 解析真实 NDJSON response；完成 Task 10 资源 checkpoint service，新增 `resource-checkpoint-service.ts`，正式章节、Truth/story 与 narrative apply 写入前保存 `.novelfork/checkpoints/<checkpointId>` 快照，记录 session/message/toolUse、reason、资源 path/hash/snapshotRef，candidate/draft/prompt-preview 不强制 checkpoint，缺失必需资源返回真实错误；完成 Task 11 Rewind preview/apply，新增 `resource-rewind-service.ts` 与 `/api/books/:id/checkpoints/:checkpointId/rewind/preview|apply`，preview 返回 diff/hash/risk，apply 必须走 destructive confirmation，支持拒绝审计、approved safety checkpoint + restore audit、expected hash 冲突失败、资源移动/删除失败，并在工具卡展示 checkpointId 与受影响资源；完成 Task 12 会话执行结果与用量 envelope，Headless result/result event 输出 duration、stop_reason、usage.currentTurn、usage.cumulative、cost unknown 与 permission_denials，持久 session 累加 cumulativeUsage，状态栏区分当前 turn、累计 tokens 与未知成本；完成 Task 13 文档、能力矩阵与验收收口，将 `conversation-parity-v1` 标记为 13/13 完成，并记录 CLI、Core、Studio 聚焦回归、typecheck、docs verify 与 diff check 证据（手动 GUI 冒烟未运行，已明确记录）。
- Backend Core Refactor：已建立 `contract-guard.md`，冻结 route/tool/shared type 映射、不可破坏合同分组和 task 2 补测清单；新增 `contract-regression.test.ts` 覆盖 books、sessions、providers、resources、writing actions 的成功、404/400、unsupported/gate 与脱敏边界。
- Backend Core Refactor：完成 Task 3 统一错误与状态 helper，新增 `packages/studio/src/api/errors.test.ts` 合同测试，抽出 `ApiError` 响应、结构化 `capability/gate` 错误、provider failure envelope/status 与 unsupported failure helper，并迁移 server、providers、platform integrations、writing tools 相关使用点。
- Backend Core Refactor：完成 Task 4 storage.ts 只读 service 拆分，新增 `books-service.ts` / `story-file-service.ts` 与单测，将 books list/detail、story/truth list/read 的业务逻辑从 route adapter 中迁出；cockpit drilldown 继续复用既有 `cockpit-service.ts` 领域服务。
- Backend Core Refactor：完成 Task 5 storage.ts 非破坏写入拆分，新增 `storage-write-service.ts` 与 service 单测，将 books update、chapter create/save、truth write 与 JSON export 生成逻辑从 route adapter 中迁出，并通过聚焦 service/route Vitest 与 Studio/Core TypeScript 检查。
- Backend Core Refactor：完成 Task 6 destructive 能力拆分，新增 `storage-destructive-service.ts` / `candidate-destructive-service.ts` 与 service 单测，将 book/chapter/story file/truth file/candidate/draft 硬删除逻辑从 route adapter 中迁出，保留 route 层确认入口、旧 envelope 与不存在/非法文件名失败状态。
- Backend Core Refactor：完成 Task 7 session runtime 内聚拆分，新增 `session-runtime/transport.ts` 与 `session-runtime/recovery.ts`，先以 envelope/recovery golden tests 固化 WebSocket envelope、payload parse、cursor、ack、replay metadata 与 failure recovery，再让 `session-chat-service.ts` 复用这些 helper，保持 REST snapshot/history、WebSocket replay/ack/abort 与 confirmation API 行为不变。
- Backend Core Refactor：完成 Task 8 Provider/runtime store 边界收敛，新增 provider-level test 状态写回回归测试，让 `POST /api/providers/:id/test` 与单模型测试一致将真实 `lastTestStatus/lastTestError` 写回 runtime store，同时保留脱敏输出、真实模型池与 adapter failure code。
- Backend Core Refactor：完成 Task 9 legacy route 依赖调查与标记，扩展 Backend Contract matrix 支持 `deprecated` 状态，并登记轻量 `/api/chat`、`/api/pipeline`、`/api/monitor`、旧 `/api/agent`、旧导出入口、旧 AI 面板直连接口与未挂载 router 的保留/候选退役边界。
- Backend Core Refactor：完成 Task 10 文档与验收收口，更新 API 文档、存储层开发指引、README、AGENTS、spec 索引、当前执行主线、测试状态与 CHANGELOG，将 `backend-core-refactor-v1` 标记为 10/10 已完成，并记录后端合同/storage/session/provider/legacy route 聚焦回归、Studio typecheck、docs verify 证据。

### 修复
- UI Live Parity Hardening Task 2：工作台资源打开改为先通过 `ResourceDetailLoader` hydrate 详情，再渲染可编辑画布；章节、Story/Truth、草稿 preview 会调用真实详情 API，候选稿、经纬条目、叙事线按当前合同透明处理；列表预览节点标记为 preview，未 hydrate 时禁用编辑器与保存，避免空 textarea 覆盖正文；资源切换加载详情期间保留当前画布并显示真实 loading/error/retry 状态。当前验证包含 `ResourceDetailLoader`、`WorkbenchCanvas`、`StudioNextApp`、`useWorkbenchResources` 定向回归和 Studio typecheck；打开→修改→保存→刷新读回浏览器闭环仍留给 Task 3-4。
- UI Live Parity Hardening Task 3：新增 `ResourceSaveController` 保存控制器，保存前拒绝未 hydrate preview、列表预览与候选稿直接覆盖，章节/Truth/草稿/经纬条目按 kind 调真实合同；章节、Truth 与草稿保存后重新读取详情并回填画布，保存失败保留本地 dirty 内容；工作台切换资源时 dirty guard 会阻止丢弃未保存文本并提供“放弃并切换”，dirty 状态下禁用写作动作启动，防止带未保存上下文触发写入链路。当前验证包含保存控制器、资源详情、WorkbenchCanvas、StudioNextApp、useWorkbenchResources 与 domain client 聚焦回归，Studio typecheck 与 docs verify 通过；真实浏览器刷新读回仍留给 Task 4。
- UI Live Parity Hardening Task 4：新增 `e2e/workbench-resource-edit.spec.ts`，通过真实 Playwright 浏览器启动 Bun API + Vite 前端，走 `/next/books/:bookId` 页面完成章节打开、textarea 正文显示、修改、保存、刷新后重新打开并读回修改内容；测试用真实 Studio API 创建书籍与章节，并用 `GET /api/books/:id/chapters/1` 校验持久化结果。验证 `pnpm exec playwright test e2e/workbench-resource-edit.spec.ts` 通过（1 passed）。
- UI Live Parity Hardening Task 5：Shell 数据切换为 `useSyncExternalStore` store，新增 `upsertSession` 与 `invalidate`，工作台写作动作创建 session 后乐观插入左侧“叙述者”并触发 sessions refetch；对话 recovery notice 改为归一化中文状态、最近成功 cursor 与恢复动作展示，不再直接泄露 raw state；状态栏在 session config 未加载时隐藏模型/权限/推理编辑控件。验证包含 StudioNextApp、ConversationSurface、useShellData 与 WorkbenchWritingActions 聚焦回归（50 tests）、Studio typecheck 与 docs verify。
- UI Live Parity Hardening Task 6：新增 `SettingsTruthModel` 派生层，模型设置页展示每个可见 setting 的来源、状态、读写 API 与未配置原因；普通模型页隐藏无真实 schema 来源的 `Codex 推理强度`，共享 Row 空值统一为“未配置”；`RuntimeControlPanel` 保存后重新读取 `/api/settings/user`，并删除模型池第一项冒充当前默认模型的展示；设置导航拆为个人设置、实例管理、运行资源与审计、关于与项目。验证包含 SettingsTruthModel、SettingsSectionContent、RuntimeControlPanel 与 StudioNextApp 聚焦回归（40 tests）和 Studio typecheck。
- UI Live Parity Hardening Task 7：模型与 Agent runtime 设置页改为直接使用真实 user settings 字段，Explore/Plan/General 子代理模型和 Codex 推理强度不再由模型池选项冒充；新增 `deriveAgentRuntimeSettingsFacts` 登记 default permission、max turns、retry/backoff、WebFetch proxy、上下文/大窗口阈值、调试可见性、目录/命令 allow/deny 与 sendMode 的来源、状态、可写性和读写 API；first-token timeout 因 NovelFork settings schema 尚无字段显示为 planned 而非可编辑控件。验证包含 SettingsTruthModel 与 RuntimeControlPanel 聚焦回归（8 tests）、SettingsSectionContent 与 StudioNextApp 相关回归（34 tests）和 Studio typecheck。
- UI Live Parity Hardening Task 8：Provider 设置页区分 API key provider 的“可配置 / 已配置 / 已验证 / 可调用”四态，平台集成无账号或 0 模型时显示“可导入 / 未配置账号 / 不可调用”或“未验证 / 0 个模型 / 不可调用”，不再把 catalog 存在冒充为已启用/可用；API provider 缺 Base URL/API Key、0 模型、未验证或最近测试失败时显示 degraded/error 原因，并提示添加密钥、刷新模型、测试模型和启停 provider。运行态总览拆分 provider total、enabled provider、available models、total catalog models、callable models；模型库存能力标签只来自真实 inventory 的大上下文、多模态、思考链、工具调用，未知显示 `unknown`。验证包含 ProviderSettingsPage 与 providers route 聚焦回归（2 files / 22 tests passed）和 Studio typecheck。
- UI Live Parity Hardening Task 9：对话状态栏补齐真实 session header facts，展示绑定书籍/章节或工作目录、消息数、工作区与 Git 状态；narrator route 通过 `/api/worktree/status?path=` 读取工作区 Git 摘要，失败时显示 unavailable reason。模型、权限和推理强度控件更新改为先调用真实 `PUT /api/sessions/:id`，成功后回读 `GET /api/sessions/:id/chat/state` 并刷新 runtime snapshot，同时同步 ShellDataProvider；provider 不支持 reasoning 或 plan session 不允许 `allow/edit` 权限时禁用控件或返回 `UNSUPPORTED_PERMISSION_MODE` 结构化错误。验证包含 ConversationSurface、StudioNextApp 与 session route 聚焦回归（3 files / 65 tests passed）、Core build、Studio client/server TypeScript。
- UI Live Parity Hardening Task 10：对话窗口补齐工具调用、审批、运行控制和上下文透明化。简化 ToolCallCard 现在提供复制摘要、全屏详情和 raw 展开，并对 `apiKey`、`access_token`、`sk-*` 等敏感 key/value 做 DOM 与 clipboard 脱敏；ConfirmationGate 展示 pending permission request 的目标、风险、permission source 和操作说明；状态栏展示 context used/max、trim/compact threshold warning、checkpoint notice 与 planned runtime panel 列表；运行控制只在 running 状态启用真实中断，Compact 仅在接入真实 handler 时启用，Retry/Clear/Fork/Resume 显示 disabled reason 而不冒充 current。验证包含 ConversationSurface 聚焦回归（1 file / 23 tests passed）、StudioNextApp + session route 邻近回归（2 files / 46 tests passed）和 Studio client/server TypeScript。
- UI Live Parity Hardening Task 11：新增 Claude Code parity baseline 与守护验证，基于本机 `claude --version` 2.1.69、同日旧 help baseline、官方 CLI reference 和本地 `claude/restored-cli-src/src/main.tsx` / `src/types/permissions.ts` / `src/utils/permissions/permissions.ts` 记录 continue/resume/fork、print/headless、stream-json、permission-mode、allowed/disallowed tools、`--tools`、MCP config、permission prompt tool、settings file/json、agents json、add-dir、worktree、tmux、Chrome bridge、IDE/server、plugins、usage/result 的 current/partial/planned/non-goal/unknown 状态；新增 parity matrix validator，覆盖非法状态、缺来源、缺日期、non-goal 不得进入 UI current claim；SettingsTruthModel 新增 Claude parity facts，将 TUI/Chrome bridge 标为 unsupported/non-goal、权限模式标为 partial。验证包含 parity-matrix 与 SettingsTruthModel 聚焦回归（2 files / 6 tests passed）和 Studio client/server TypeScript。
- UI Live Parity Hardening Task 12：新增 Codex CLI parity baseline 与 sandbox/approval 守护验证，基于本机 `codex-cli 0.80.0`、`codex --help` / `codex exec --help` / `codex mcp --help` / `codex review --help` / `codex sandbox --help`、官方 CLI/config/non-interactive/subagents/Windows 文档记录 TUI、non-interactive exec、config/profile、sandbox、approval、MCP、subagents、web search、image input、code review 与 Windows 原生边界；新增 `CODEX_CLI_PARITY_MATRIX`，明确 TUI non-goal、exec/config/subagents/web search/approval/Windows partial、sandbox/MCP/image input/review planned，其中 sandbox `read-only` / `workspace-write` / `danger-full-access` 不得进入 UI current claim；`deriveCodexParitySettingsFacts()` 将 Codex sandbox 标为 planned、approval 标为 partial，避免把 NovelFork permissionMode/toolPolicy 冒充完整 Codex OS sandbox。验证包含先失败后通过的 parity-matrix 与 SettingsTruthModel 聚焦回归（最终 2 files / 8 tests passed）和 Studio client/server TypeScript。
- UI Live Parity Hardening Task 13：新增 `e2e/settings-session-conversation.spec.ts` 浏览器验收，真实启动 Bun API + Vite 前端，在隔离 `.novelfork/e2e-workspace-flow-*` 根目录内用真实 API 准备 provider/runtime settings 与书籍，不调用真实模型。设置页场景覆盖默认模型未配置不使用模型池第一项 fallback、Codex 推理强度来自真实 settings schema、Codex 平台无账号显示“可导入 / 未配置账号 / 不可调用”、AI 代理页 first-token timeout 为 planned 且不出现“已接入/Codex sandbox 已接入”假 current；会话场景覆盖工作台“生成下一章”创建真实 session、Shell 侧栏同步、`/next/narrators/:sessionId` header 使用真实 binding/model/权限/推理，工具卡 raw 展开并脱敏 `apiKey/sk-*`，模型/权限/推理控件调用真实 session API 并轮询回读，idle 中断禁用、持久化 running tool call 刷新后中断启用。E2E 先失败暴露 running tool call 刷新后运行控制仍 idle，修复 `toConversationStatus()` 将持久化 running tool call 纳入 running 状态。验证 `pnpm exec -- playwright test e2e/settings-session-conversation.spec.ts` 通过（2 passed）。

### 文档
- 新增并补强 `ui-live-parity-hardening-v1` Kiro spec，聚焦真实浏览器暴露的工作台资源编辑器未加载章节正文、设置页硬编码/伪接线、对话窗口运行态不透明、Shell 会话状态不同步，以及 Claude Code CLI / OpenAI Codex CLI parity 口径守护；基于 7778 端口 NarraFork 设置页/对话窗口实测和本地 Claude 源码参考，要求 NovelFork 借鉴信息架构但所有 UI 可用声明必须有自身真实合同与打开→编辑→保存→刷新读回等浏览器证据；新增 14 项 `tasks.md`，按资源详情/保存、Shell 同步、设置 truth model、provider callable、对话透明化、Claude/Codex parity、浏览器 E2E 与文档验收顺序拆分执行；完成 Task 1 hardening RED 回归基线，新增 6 条失败优先测试暴露章节未 hydrate 仍可编辑/保存、设置页 Codex 空字段、默认模型 first fallback、平台 0 账号可用误导和对话控件无 session config 来源等缺口。
- 新增 `backend-contract-v1`、`frontend-refoundation-v1` 与 `backend-core-refactor-v1` Kiro specs，将后续主线调整为先冻结真实后端能力合同，再基于 Agent Shell + Writing Workbench 重建前端，最后按合同分阶段整理后端核心；`novelfork-ui-v1` 保留为被取代的过渡参考。
- 更新 specs 索引、README、Studio README、AGENTS、当前执行主线与 API 文档口径，明确新前端不得绕过 Backend Contract client 接入未登记能力，`prompt-preview`、`process-memory`、`chunked-buffer`、`unsupported` 和 `unknown` 必须透明呈现；同步 `backend-contract-v1` 进度为 9/9，并记录 app-next 组件禁止散写未登记 API 字符串与验证 guard。
- 同步 `backend-core-refactor-v1` Task 3 文档口径：tasks/spec 索引更新为 3/10，API 文档记录统一错误 helper、provider failure 状态码、writing tools gate 与平台集成 unsupported 边界。
- 同步 `backend-core-refactor-v1` Task 4/5/6 文档口径：tasks/spec 索引更新为 6/10，Studio README 与 API 验证事实源记录 storage 只读、非破坏写入和 destructive service 拆分。
- 同步 `backend-core-refactor-v1` Task 7 文档口径：tasks/spec 索引更新为 7/10，README、AGENTS、当前执行主线、Studio README 与 API 文档记录 session runtime transport/recovery helper 边界和验证事实源。
- 同步 `backend-core-refactor-v1` Task 8 文档口径：tasks/spec 索引更新为 8/10，README、AGENTS、当前执行主线与 API 文档记录 provider test 状态写回、runtime store 脱敏和真实模型池边界。
- 同步 `backend-core-refactor-v1` Task 9/10 文档口径：tasks/spec 索引更新为 10/10，contract guard、Studio API 文档、存储层开发指引、Studio README、当前执行主线与测试状态记录 legacy/deprecated route 边界、后端领域 service 拆分纪律与最终验收结果。
- 新增 `frontend-live-wiring-v1`、`legacy-source-retirement-v1` 与 `conversation-parity-v1` specs：分别规划新前端 live 接线、旧三栏/旧 ChatWindow 源码退役、参考 Claude Code CLI 补齐叙述者会话能力，并同步 spec 索引当前主线。

## v0.0.6 (2026-05-04)

### 改进
- 移除当前 Provider Runtime 的虚拟模型 API/UI/store 口径，恢复为真实供应商、真实模型、平台账号与显式模型选择；运行策略不再展示虚拟模型 fallback、配额路由或写作任务虚拟绑定。
- 引入通用 Agent Turn Runtime 与 canonical message/tool_call/tool_result 工具循环协议，session chat 改为通过运行时事件持久化工具调用和结果，并在工具失败时把失败 tool_result 回传给模型生成最终说明。
- 统一 session tools 的确认/写入审计 metadata：confirmed-write 工具记录 confirmationAudit，questionnaire 提交确认前展示 mapping preview，candidate/narrative draft-write 结果记录目标资源与风险。
- 新增会话中心 API 与页面，支持独立/书籍/章节绑定筛选、归档/恢复、模型/权限/状态显示，并从工作台右侧叙述者入口可打开会话中心切换会话。
- 新增高级工作台模式（workbenchMode）隔离：作者模式下隐藏 Terminal/Browser/Bash/MCP/Admin 等高级工具入口和后端调用；高级模式下仍受权限模式与确认门约束。
- 新增 Headless Exec 服务（`POST /api/exec`）：非交互执行写作任务，复用 AgentTurnRuntime，遇确认门停止返回 pending 状态（exitCode=2），失败返回工具链摘要（exitCode=1）。
- 新增 `novelfork exec` CLI 命令：通过 HTTP 调用 Studio headless exec API，支持 `--json` JSONL 事件流、`--model provider:model`、`--book`、`--session`、`--stdin`、`--max-steps`。

### 文档
- 新增 `web-agent-runtime-v1` Kiro spec，将下一阶段统一为 Web 版通用 Agent Runtime：移除虚拟模型方向，保留真实 provider/model 显式选择，并规划结构化工具循环、会话中心、高级工作台模式、headless exec 与统一确认门。
- 更新能力矩阵至 v2.1，新增 Web Agent Runtime 能力段落，记录 Agent Turn Runtime、重复工具保护、会话中心、高级工作台模式、Headless Exec 与 CLI 的真实可用状态。
- 更新 spec 索引进度为 14/16 已完成。

## v0.0.5 (2026-05-03)

### 改进
- 完成 Agent-native Workspace v1 task22-task23 测试矩阵与收尾回归验收：补齐/核对 session tool loop、confirmation gate、GuidedGenerationState、cockpit snapshot、PGI metadata、renderer registry、workspace 三栏布局、canvas 打开候选稿和最小“写下一章”链路覆盖，并修复 Node/jsdom 下 `windowStore` 持久化 fallback；localStorage 写入失败时降级为内存存储并输出 warning，避免静默丢失持久化语义。
- 建立 Agent-native Workspace 共享类型契约，覆盖中间画布资源、工具执行结果、确认门、Guided Generation、PGI、叙事线快照与会话工具结果 metadata，并补齐权限风险映射测试。
- 新增 Studio-facing Session Tool Registry，注册首批 cockpit、questionnaire、PGI、guided、candidate 与 narrative session tools，支持按会话权限模式过滤与 provider tool schema 序列化，并复用 agent-native workspace 共享风险契约。
- 新增 Session Tool Executor 骨架，统一处理工具存在性校验、输入 schema 校验、权限风险拦截、pending confirmation、执行计时与错误包装，避免写入类 session tools 在 read/plan 模式或确认前执行。
- 扩展 LLM runtime 与 provider adapter 工具调用契约，支持向工具能力模型传入 session tools、解析结构化 `tool_use`，并在模型不支持工具循环时返回明确 `unsupported-tools` 降级。
- 在 session chat service 中实现最多 6 步的有界工具循环，持久化 tool-use/tool-result 消息，处理工具失败、pending confirmation、循环上限与 unsupported tools 错误恢复。
- 新增 session tools 确认门 API，支持查询 pending confirmations、提交批准/拒绝决策、记录审计字段，并在拒绝后回灌错误 tool result 且清除待确认状态。
- 抽出 Cockpit 共享数据服务并接入 `cockpit.get_snapshot`、`cockpit.list_open_hooks`、`cockpit.list_recent_candidates` session tools 与 REST drilldown routes，确保缺失焦点、无候选稿、无模型配置等状态返回真实 missing/empty 信息而非 mock 数据。
- 将 Questionnaire 能力接入 session tools，支持列出模板、启动结构化问题卡、提交回答复用现有 Bible/Jingwei mapping 事务写入，并在未配置真实 provider/model 时返回明确 unsupported AI 建议状态。
- 将 PGI 能力接入 session tools，支持基于 escalating 矛盾和临近伏笔生成生成前追问、记录回答/跳过审计 metadata，并格式化为 writer 可用的本章作者指示。
- 实现 Guided Generation Mode 基础状态机与 session tools，支持进入只读引导模式、回答/跳过结构化问题、提交计划到确认门，并在批准或拒绝后记录可恢复的 guided metadata 与画布 artifact。
- 实现 `candidate.create_chapter` session tool，生成内容默认写入 `generated-candidates/` 候选区并返回 `candidate.created` artifact，确保不覆盖正式章节；未配置可用模型时返回 prompt-preview/unsupported 状态。
- 建立 Tool Result Renderer Registry，按 tool result renderer 或工具名渲染驾驶舱快照、开放伏笔、Guided/PGI 问题、引导计划、候选稿产物与经纬变更预览，并保留 generic ToolCallBlock fallback。
- 提取 ChatWindow 可复用结构，新增 docked 叙述者面板宿主，保留 floating 工作台宿主、模型/权限/推理控制、recovery banner、最近执行链、工具调用块与输入状态。
- 将工作台装配为左侧 WorkspaceLeftRail、中间 WorkspaceCanvas 与右侧固定叙述者会话，支持多资源 tab、dirty 切换拦截、Agent artifact 打开、默认 writer 会话自动创建/复用，并将旧驾驶舱/经纬/写作入口降级为画布/工具复用能力而非右侧主 Tab。
- 扩展叙述者会话 canvas context 协议，将当前 active resource、open tabs、选区与 dirty 状态随消息发送给 session runtime，后端净化后注入 system prompt、用户消息 metadata 和 session tool 上下文，并在 dirty 资源存在时阻断写入类工具执行。
- 新增 Narrative Line 只读快照服务、`GET /api/books/:bookId/narrative-line` route 与 `narrative.read_line` session tool，基于章节、章节摘要、经纬事件/设定、冲突、伏笔和人物弧光生成 nodes/edges/threads/warnings，并以画布 artifact 展示。
- 新增 Narrative Line 变更草案与确认写入链路：`narrative.propose_change` 仅生成 mutation preview，`POST /api/books/:bookId/narrative-line/propose|apply` 在用户明确 approve 后写入 `story/narrative_line.json`，并记录批准时间、session ID、confirmation ID、目标节点/边与变更摘要。
- 打通最小「写下一章」session-first 链路：system prompt 明确 cockpit snapshot → PGI → guided plan → 用户批准 → candidate.create_chapter 顺序；确认 guided plan 后可继续执行模型返回的 candidate tool_use，候选生成失败时停止后续写入并保留已完成调查结果。
- 更新主动文档与产品口径为 Agent-native session-first 工作台：右侧固定叙述者会话、中间多资源画布、左侧资源栏；历史驾驶舱/经纬/写作面板降级为工具结果卡片和画布组件，并补充 `unsupported-tools` 模型降级说明。

### 文档
- 同步 README、Studio README、`AGENTS.md`、spec 索引、当前状态/执行主线、Studio 架构与测试状态文档，记录 `frontend-live-wiring-v1` 已完成 10/10、search/routines/settings 不再停留在“稍后接线”占位，并将 Studio 回归测试数量口径更新为约 210 files / 1276 tests。
- 新增 `agent-native-workspace-v1` spec 与任务文档，明确工作台恢复为右侧叙述者会话主入口、中间画布、左侧资源栏，并将引导式生成定义为 Plan Mode 风格的工具链与确认门；同步 `.kiro/specs/README.md` 当前 active spec 索引。
- 同步 README、Studio README、测试状态与架构总览中的测试数量、编译命令和 release 产物口径。
- 将“代码/配置/流程变更必须同步文档与 CHANGELOG、验收前全仓核对旧口径”的文档纪律写入 `CLAUDE.md` 与 `AGENTS.md`。
- 同步 `.kiro/steering/` 中的项目结构、Tauri 退役、构建测试命令与文档发布纪律口径。

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
