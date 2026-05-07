# Implementation Plan

## Overview

本任务清单把 `ui-live-parity-hardening-v1` 的 requirements/design 转成可执行实现步骤。执行顺序优先保护作者正文安全：先建立回归基线，再修资源详情/保存闭环，然后收敛 Shell 会话同步、设置 truth model、provider callable 状态、对话窗口透明化，最后补 Claude/Codex parity 矩阵、浏览器 E2E 与文档口径。所有任务必须遵守 Backend Contract client / adapter 边界，不恢复旧前端、不新增 mock/fake/noop 成功层、不把 NarraFork 字段硬编码为 NovelFork 当前能力。

## Tasks

- [x] 1. 建立 hardening 回归基线与当前差距清单
  - 从 requirements/design 建立 traceability map：资源详情/保存、Shell session sync、设置 truth model、provider callable、Claude/Codex parity、对话窗口透明化、浏览器 E2E、文档矩阵。
  - 在现有 Backend Contract matrix 或测试夹具中标记当前 `partial / needs-browser-verification / unsupported / planned` 状态，禁止把未验活 UI 写成 current。
  - 新增失败优先的回归测试入口，覆盖章节详情 API 有 content 但画布为空、保存前未 hydrate、设置页 first-model fallback、provider 平台 0 模型误显示可调用、对话窗口静态模型/权限/推理控件。
  - 验证：新增测试在实现前能暴露当前缺口；不跳过、不改成 snapshot 占位。
  - 覆盖：Requirement 1、2、4、5、8、9、10；Design: Browser E2E Gate、Test Strategy。
  - 证据：已在 `WorkbenchCanvas.test.tsx`、`SettingsSectionContent.test.tsx`、`RuntimeControlPanel.test.tsx`、`ProviderSettingsPage.test.tsx`、`ConversationSurface.test.tsx` 增加 6 条 RED 回归；运行 `pnpm --dir packages/studio test -- src/app-next/writing-workbench/WorkbenchCanvas.test.tsx src/app-next/settings/SettingsSectionContent.test.tsx src/app-next/settings/panels/RuntimeControlPanel.test.tsx src/app-next/settings/ProviderSettingsPage.test.tsx src/app-next/agent-conversation/surface/ConversationSurface.test.tsx --reporter=verbose`，当前按预期失败（5 failed files / 6 failed tests，1220 total tests 中 1214 passed；失败点分别为章节未 hydrate 仍渲染 textarea、未 hydrate 仍调用保存、Codex 推理强度空字段仍显示、未配置默认模型仍展示模型池第一项、0 账号平台仍显示可用、无持久化 session config 仍显示模型选择控件）。

- [x] 2. 实现资源详情读取统一边界
  - 在 `packages/studio/src/app-next/backend-contract/` 领域 client / adapter 中补齐资源详情读取方法，至少覆盖 chapter、draft/candidate、story/truth、jingwei-entry、narrative-line 的 read capability。
  - 新增 `ResourceDetailLoader` 状态模型：idle、loading、ready、error，并记录 `source: detail | preview`、revision/hash/loadedAt。
  - 资源切换时保留当前画布，直到新资源成功加载或用户处理 dirty guard；失败时显示真实错误与 retry。
  - 对 contract 非 current 的资源显示 unsupported/planned/deprecated 原因，禁止空编辑器冒充 ready。
  - 验证：unit/component tests 覆盖 kind routing、loading/error/ready、预览标记、章节 content 非空时 textarea 非空。
  - 覆盖：Requirement 1；Design: Resource Detail Hydration。
  - 证据：新增 `ResourceDetailLoader.ts` / `ResourceDetailLoader.test.ts`，由 `resourceNeedsDetailHydration`、`loadResourceDetailState`、`applyResourceDetailToNode` 统一处理 chapter、draft/candidate、story/truth、jingwei-entry、narrative-line 的详情读取与 preview/full 标记；`WorkbenchCanvas` 对 `source/detailSource` 非完整详情资源禁用编辑器与保存；`StudioNextApp` 打开资源时先 hydrate，详情加载中保留当前画布并显示“正在加载 <资源> 详情…”，失败时显示真实错误与重试；`resource-tree-adapter` 把树节点标为 preview。运行 `pnpm --dir packages/studio exec vitest run src/app-next/writing-workbench/ResourceDetailLoader.test.ts src/app-next/writing-workbench/WorkbenchCanvas.test.tsx src/app-next/StudioNextApp.test.tsx src/app-next/writing-workbench/useWorkbenchResources.test.ts` 通过（4 files / 41 tests passed）；`pnpm --dir packages/studio typecheck` 与 `pnpm docs:verify` 通过；浏览器保存读回仍留给 Task 3-4。

- [x] 3. 实现资源保存控制器与防覆盖 dirty guard
  - 新增或收敛 `ResourceSaveController`，保存前校验详情已 hydrate、资源 edit capability 为 current、content 不来自空 textarea 或列表预览。
  - 章节保存调用真实章节保存 API；Truth、草稿、经纬条目按 kind 调用对应真实保存 API；candidate/prompt-preview 不升级为正式正文覆盖。
  - 保存成功后重新读取详情，更新 content/revision/hash/保存状态并清除 dirty；失败时保留本地草稿和 dirty 标记。
  - 切换资源、离开页面、启动写作动作、发送带 dirty canvasContext 的写入类工具前统一拦截。
  - 验证：component/API tests 覆盖成功保存、未 hydrate 禁止保存、preview 禁止保存、冲突/过期失败、刷新后读回。
  - 覆盖：Requirement 2；Design: Save Controller and Dirty Guard。
  - 证据：新增 `ResourceSaveController.ts` / `ResourceSaveController.test.ts`，保存前拒绝未 hydrate preview 与候选稿直接覆盖，章节/Truth/草稿/经纬条目按 kind 调真实合同，章节/Truth/草稿保存后回读详情并回填画布；`resource-client` 新增 `saveJingweiEntry` current contract helper；`StudioNextApp` 保存后更新 `resources.resourceMap/tree/openableNodes`，dirty 切换资源显示拦截与“放弃并切换”，dirty 状态下禁用工作台写作动作。运行 `pnpm --dir packages/studio exec vitest run src/app-next/writing-workbench/ResourceSaveController.test.ts src/app-next/writing-workbench/ResourceDetailLoader.test.ts src/app-next/writing-workbench/WorkbenchCanvas.test.tsx src/app-next/StudioNextApp.test.tsx src/app-next/writing-workbench/useWorkbenchResources.test.ts src/app-next/backend-contract/domain-clients.test.ts` 通过（6 files / 57 tests passed）；`pnpm --dir packages/studio typecheck` 与 `pnpm docs:verify` 通过；真实浏览器刷新读回仍留给 Task 4。

- [x] 4. 打通工作台资源编辑浏览器主链路
  - 增加真实浏览器或 Playwright 场景：启动 Studio → 打开书籍 → 点击章节 → 看到正文 → 修改 → 保存 → 刷新 → 重新打开章节 → 读回修改。
  - 测试必须通过真实 `/next` 页面和真实 Studio API，不直接调用 service 伪造 UI 成功。
  - 对无法调用模型的路径使用 provider-unavailable、max-turns 或 prompt-preview 边界，只验证 UI 和资源写入保护。
  - 验证：E2E 命令可在本地重复运行，并在测试状态文档记录覆盖路径。
  - 覆盖：Requirement 1、2、9；Design: Browser E2E Gate。
  - 证据：新增 `e2e/workbench-resource-edit.spec.ts`，通过 Playwright 启动 Bun API + Vite 前端，使用真实 `/api/books/create`、`POST /api/books/:id/chapters`、`PUT/GET /api/books/:id/chapters/1` 准备和校验数据，再走 `/next/books/:bookId` UI 点击章节、断言 textarea 正文、修改、保存、刷新并重新打开章节读回。首次运行暴露“未保存”选择器命中 dirty 提示，已收敛到 `.workbench-canvas`；复跑 `pnpm exec playwright test e2e/workbench-resource-edit.spec.ts` 通过（1 passed）。

- [x] 5. 修复 Shell 会话列表与 recovery 状态同步
  - 在 session create/fork/resume/restore、工作台写作动作创建 session 后调用 `ShellDataProvider.invalidate("sessions")` 或 `upsertSession(session)`。
  - 确保 `/api/sessions` 返回 active session 后，左侧 Shell 不再显示“暂无活跃会话”。
  - 统一 recovery presentation：REST chat state、WebSocket open/replay/ack、resetRequired、error 只能派生一个 UI 状态。
  - WebSocket 失败、replay 失败、resetRequired 显示真实失败、恢复动作和最近成功 cursor。
  - 验证：session lifecycle/component tests 覆盖新 session 乐观插入、refetch、ready/idle、failed/resetRequired；E2E 覆盖工作台动作后 Shell 同步。
  - 覆盖：Requirement 3、9；Design: Shell Session Synchronization。
  - 证据：`useShellData` 收敛为 `useSyncExternalStore` 驱动的 Shell 数据 store，暴露 `useShellDataStore().upsertSession()/invalidate()`；工作台写作动作新建 session 后乐观插入侧栏并触发 sessions refetch；`ConversationSurface` recovery notice 改为中文归一化状态、最近成功 cursor 与恢复动作，不再直接泄露 raw state；状态栏在 session config 未加载时隐藏模型/权限/推理编辑控件。运行 `pnpm --dir packages/studio exec vitest run src/app-next/StudioNextApp.test.tsx src/app-next/agent-conversation/surface/ConversationSurface.test.tsx src/app-next/shell/useShellData.test.ts src/app-next/writing-workbench/WorkbenchWritingActions.test.tsx` 通过（4 files / 50 tests passed）；`pnpm --dir packages/studio typecheck` 与 `pnpm docs:verify` 通过。

- [x] 6. 建立 SettingsTruthModel 与 NarraFork-inspired 设置分组
  - 实现 `SettingsFact<T>` 派生层，字段包含 id、label、group、source、status、writable、readApi、writeApi、reason、verifiedBy。
  - 设置页按 NovelFork 自有 schema 组织为个人设置、实例管理、运行资源/关于等分组；借鉴 NarraFork IA，但字段必须来自真实 NovelFork source。
  - 对未接入字段显示 planned/unsupported 或隐藏，不渲染可编辑假控件；移除无来源破折号、固定“已接入”、硬编码可用状态。
  - 保存设置后重新读取服务器值；保存失败保留草稿并允许恢复服务器值。
  - 验证：unit/component tests 覆盖每个可见 setting 的 source/status/writable/readApi/writeApi，禁止无来源“已接入/可用/—”。
  - 覆盖：Requirement 4、10；Design: Settings Truth Model、NarraFork-Inspired Settings IA。
  - 证据：新增 `SettingsTruthModel.ts` / `SettingsTruthModel.test.ts`，模型设置页通过 `SettingsFact` 展示来源、状态、读写 API 与未配置原因；无真实 schema 来源时隐藏普通模型页的 `Codex 推理强度`，共享 Row 空值改为“未配置”而非破折号；`RuntimeControlPanel` 保存后重新读取 `/api/settings/user`，并删除模型池第一项冒充当前默认模型的展示；设置导航分为个人设置、实例管理、运行资源与审计、关于与项目。先运行 RED 聚焦测试，确认 3 files / 5 failed tests；实现后运行 `pnpm --dir packages/studio exec vitest run src/app-next/settings/SettingsTruthModel.test.ts src/app-next/settings/SettingsSectionContent.test.tsx src/app-next/settings/panels/RuntimeControlPanel.test.tsx src/app-next/StudioNextApp.test.tsx` 通过（4 files / 40 tests passed）；`pnpm --dir packages/studio typecheck` 通过。

- [x] 7. 收敛模型与 Agent runtime 设置页真实来源
  - 默认模型、摘要模型、Explore/Plan 子代理模型、子代理模型池、全局默认推理强度、平台专项推理强度全部从 user settings 或明确 runtime source 派生。
  - 删除 `modelOptions[0]` 作为当前值的 fallback；模型清单只能作为 options，不代表已选择值。
  - AI 代理运行策略逐项登记 default permission mode、max turns、retry/backoff、first token timeout、WebFetch proxy、context trim/compact thresholds、session behavior、debug visibility、global directory allow/deny、global command allow/deny 的来源与可写性。
  - 暂未接 API 的 Agent runtime 字段标 planned/unsupported，不做 NarraFork 文案硬编码。
  - 验证：Settings page tests 覆盖无默认模型时 unconfigured、设置保存回读、Codex 推理强度仅在真实 schema 存在时显示。
  - 覆盖：Requirement 4；Design: Settings Truth Model、NarraFork-Inspired Settings IA。
  - 证据：`deriveModelSettingsFacts` 改为直接读取 `exploreSubagentModel`、`planSubagentModel`、`generalSubagentModel` 与真实 `codexReasoningEffort` schema 字段，不再用 `subagentModelPool[0/1]` 回填；新增 `deriveAgentRuntimeSettingsFacts` 覆盖权限、默认推理、max turns、上下文/大窗口阈值、retry/backoff、WebFetch proxy、MCP/allowlist/blocklist、debug 与 sendMode，并把 first-token timeout 标为 `planned` / `capability-matrix`；`RuntimeControlPanel` 展示每项来源事实、Explore/Plan/General 子代理模型和 Codex 推理强度真实控件，WebFetch proxy 走 `/api/proxy`，保存后仍回读 `/api/settings/user`。先运行 Task 7 RED 聚焦测试，确认 2 files / 4 failed tests；实现后运行 `pnpm --dir packages/studio test src/app-next/settings/SettingsTruthModel.test.ts src/app-next/settings/panels/RuntimeControlPanel.test.tsx` 通过（2 files / 8 tests passed），`pnpm --dir packages/studio test src/app-next/settings/SettingsSectionContent.test.tsx src/app-next/StudioNextApp.test.tsx` 通过（2 files / 34 tests passed），`pnpm --dir packages/studio typecheck` 通过。

- [x] 8. 修复 provider 与平台账号 callable 状态模型
  - 建立 provider 状态派生：catalog enabled、configured、verified、callable；统计 provider total、enabled provider、available models、total catalog models、callable models。
  - 平台集成账号数为 0 或模型数为 0 时显示“可导入 / 未配置账号 / 不可调用”或“未验证 / 0 个模型 / 不可调用”。
  - API key provider 缺 baseUrl/apiKey/models 或最近测试失败时显示 degraded/error，并暴露添加密钥、刷新模型、测试模型、启停 provider 的真实动作。
  - 模型能力标签只来自真实 inventory；unknown 不补造；secret/token/account JSON 只显示脱敏摘要。
  - 验证：provider runtime/store/component tests 覆盖 0 账号、未验证、模型数口径、测试失败、secret 脱敏、统计卡口径。
  - 覆盖：Requirement 5；Design: Provider and Platform Account Status。
  - 证据：`ProviderSettingsPage` 增加 API provider 状态派生，卡片分开展示“可配置 / 已配置或未配置 / 已验证或未验证 / 可调用或不可调用”，测试失败时显示 `degraded/error`、缺 Base URL/API Key/未验证原因和“添加密钥 / 刷新模型 / 测试模型 / 启停 provider”恢复动作；平台卡片按账号数和 catalog 模型数显示“可导入 / 未配置账号 / 不可调用”或“未验证 / 0 个模型 / 不可调用”，不再用平台 catalog 冒充“已启用/可用”。`/api/providers/summary` 拆出 provider total、enabled provider、available model、total catalog model、callable model；`/api/providers/models/grouped` 只从真实 inventory 派生“大上下文 / 多模态 / 思考链 / 工具调用”，未知显示 `unknown`。验证先补 Task 8 RED 用例暴露缺口；实现后运行 `pnpm --dir packages/studio exec vitest run src/app-next/settings/ProviderSettingsPage.test.tsx src/api/routes/providers.test.ts` 通过（2 files / 22 tests passed），`pnpm --dir packages/studio typecheck` 通过。

- [x] 9. 实现会话配置真实读写与对话窗口 header facts
  - 对 narrator route / 工作台右侧对话补齐 session header facts：title、binding（book/chapter/workdir）、model、reasoning effort、permission mode、message count、runtime status、context usage。
  - 模型、推理强度、权限模式控件通过真实 session config API 更新，成功后 refetch chat state/session summary，并同步 ShellDataProvider。
  - provider 不支持 reasoning 或 session 不允许某 permission mode 时禁用控件并显示 validation error 或 unsupported reason。
  - 工作区/Git 状态摘要只来自真实 API；不可读或无 Git 显示 unavailable reason。
  - 验证：component/API tests 覆盖读写回读、unsupported 控件禁用、Shell 同步、无 Git/unavailable 显示。
  - 覆盖：Requirement 3、8；Design: Conversation Runtime Transparency。
  - 证据：`ConversationStatusBar` 增加 binding、messageCount、workspace/Git fact、reasoning unsupported 与 permission mode disabled reason 展示；`StudioNextApp` 在 narrator route 从真实 session record 派生 book/chapter/worktree binding，通过 `/api/worktree/status?path=` 读取 Git 状态，失败显示 unavailable reason；模型/权限/推理强度更新先 `PUT /api/sessions/:id`，成功后 `GET /api/sessions/:id/chat/state` 回读并 `runtime.applyEnvelope` 刷新 header/control，同时 `ShellDataProvider.upsertSession()` + `invalidate("sessions")` 同步侧栏。`session` route 对 plan session 的 `allow/edit` 权限更新返回 `UNSUPPORTED_PERMISSION_MODE` 结构化错误。先补 Task 9 RED 用例；实现后运行 `pnpm --dir packages/studio exec vitest run src/app-next/agent-conversation/surface/ConversationSurface.test.tsx src/app-next/StudioNextApp.test.tsx src/api/routes/session.test.ts` 通过（3 files / 65 tests passed），`pnpm --dir packages/core build`、`pnpm --dir packages/studio exec tsc --noEmit`、`pnpm --dir packages/studio exec tsc -p tsconfig.server.json --noEmit` 通过。

- [x] 10. 实现工具调用、审批、运行控制与上下文透明化
  - 对话 tool card 显示 tool name、input summary、duration、status、error、collapsed output、copy/fullscreen action；长输出折叠，secret 脱敏。
  - pending permission request 显示工具、风险、permission source、allow/deny，并写入真实 pending confirmation / tool policy 流程。
  - running 状态显示真实中断/停止动作；idle 状态不得显示假“思考中”或可点击中断。
  - context usage、trim/compact threshold、checkpoint/rewind 保护动作以可理解状态显示。
  - Git/容器/快照/变更 side panel 只在真实 API current 时显示；未实现隐藏或标 planned。
  - 验证：ConversationSurface tests 覆盖 tool card 展开、approval 决策、running/idle 控制、context usage、secret 脱敏、planned 面板不冒充 current。
  - 覆盖：Requirement 8、9；Design: Conversation Runtime Transparency。
  - 证据：`ToolCallCard` 简化分支补齐复制摘要、全屏详情、raw 展开脱敏，敏感 key/value（apiKey/access_token/sk-* 等）显示和 clipboard 均替换为 `[REDACTED]`；`ConfirmationGate` 展示目标、风险、permission source 与操作说明，仍通过真实 approve/reject 回调进入 pending confirmation 流程；`ConversationStatusBar` 展示 context used/max、trim/compact threshold warning、checkpoint notice 和 planned runtime panel 列表；`ConversationSurface` 新增 runtime controls，running 才启用中断，idle 显示“无运行中的会话”，Compact 只有接入真实 handler 时启用，Retry/Clear/Fork/Resume 不做假 current 而显示 disabled reason。验证：`pnpm --dir packages/studio test src/app-next/agent-conversation/surface/ConversationSurface.test.tsx` 通过（1 file / 23 tests passed），`pnpm --dir packages/studio test src/app-next/StudioNextApp.test.tsx src/api/routes/session.test.ts` 通过（2 files / 46 tests passed），`pnpm --dir packages/studio exec tsc --noEmit` 与 `pnpm --dir packages/studio exec tsc -p tsconfig.server.json --noEmit` 通过。

- [x] 11. 建立 Claude Code parity baseline 与守护验证
  - 新增或更新 `claude-code-parity-baseline.md`，记录本机 CLI help/version、官方文档、本地 Claude 源码路径与读取日期。
  - 矩阵覆盖 continue/resume/fork、print/headless、stream-json、permission-mode、allowed/disallowed tools、tool set filtering、MCP config、permission prompt tool、settings file/json、agents json、add-dir、plugins、worktree、Chrome/IDE/server、usage/result。
  - 将 NovelFork 状态标为 current/partial/planned/non-goal/unknown，并说明 UI/API/CLI surface 与验证证据。
  - 权限模式中文产品文案必须映射到真实 internal value 和差异，不能把 NarraFork 文案当 Claude 原生枚举。
  - 验证：parity matrix validator 测试覆盖状态枚举、来源日期、non-goal 不进入 UI “已接入”。
  - 覆盖：Requirement 6、10；Design: Claude Code Parity Guard。
  - 证据：新增 `.kiro/specs/ui-live-parity-hardening-v1/claude-code-parity-baseline.md`，记录 `claude --version` 本机返回 `2.1.69 (Claude Code)`、同日旧 baseline 的 help surface、官方 CLI reference（2026-05-06 访问）和本地 `claude/restored-cli-src/src/main.tsx`、`src/types/permissions.ts`、`src/utils/permissions/permissions.ts` 源码路径；矩阵覆盖 continue/resume/fork、print/headless、stream-json、permission-mode、allowed/disallowed tools、`--tools`、MCP config、permission prompt tool、settings file/json、agents json、add-dir、worktree、tmux、Chrome bridge、IDE/server、plugins 与 usage/result，并将 NovelFork 状态标为 current/partial/planned/non-goal。新增 `parity-matrix.ts` validator 与测试，覆盖非法状态、缺来源、缺日期、non-goal 不得进入 UI current claim；`deriveClaudeParitySettingsFacts()` 把 Claude TUI/Chrome bridge 显示为 unsupported/non-goal，permission modes 显示 partial。验证：`pnpm --dir packages/studio test src/app-next/settings/parity-matrix.test.ts src/app-next/settings/SettingsTruthModel.test.ts` 通过（2 files / 6 tests passed），`pnpm --dir packages/studio exec tsc --noEmit` 与 `pnpm --dir packages/studio exec tsc -p tsconfig.server.json --noEmit` 通过。

- [x] 12. 建立 Codex CLI parity baseline 与 sandbox/approval 差异守护
  - 新增 `codex-cli-parity-baseline.md`，记录官方/本机可确认来源与访问日期。
  - 矩阵覆盖 TUI、non-interactive exec、config file、sandbox、approval、MCP、subagents、web search、image input、code review、Windows 原生支持边界。
  - 明确 Codex sandbox 的 read-only/workspace-write/danger-full-access 或官方当前等价项，并映射 NovelFork 当前缺失/partial/non-goal 状态。
  - 明确 Codex approval policy 与 NovelFork permissionMode/toolPolicy 的差异；NovelFork 无真实 OS sandbox 时不得在设置页显示“Codex sandbox 已接入”。
  - 验证：parity matrix validator 与 SettingsTruthModel tests 覆盖 Codex 字段必须来自 matrix 或真实 settings schema。
  - 覆盖：Requirement 7、10；Design: Codex CLI Parity Guard。
  - 证据：新增 `.kiro/specs/ui-live-parity-hardening-v1/codex-cli-parity-baseline.md`，记录本机 `codex --version` 返回 `codex-cli 0.80.0`，并用 `codex --help` / `codex exec --help` / `codex mcp --help` / `codex review --help` / `codex sandbox --help`、官方 CLI/config/non-interactive/subagents/Windows 文档（2026-05-06 访问）作为来源；`codex sandbox windows --help` 被权限层拒绝，未虚构细项。新增 `CODEX_CLI_PARITY_MATRIX`，覆盖 TUI、exec、config/profile、sandbox、approval、MCP、subagents、web search、image input、review 与 Windows native boundary，标记 TUI non-goal，exec/config/subagents/web search/approval/Windows partial，sandbox/MCP/image input/review planned；明确 sandbox `read-only` / `workspace-write` / `danger-full-access` 均非 current，approval 区分本机 `untrusted/on-failure/on-request/never` 与官方 `untrusted/on-request/never/granular` 差异。`deriveCodexParitySettingsFacts()` 将 Codex sandbox 显示为 planned、approval 显示为 partial，来源限制为 capability-matrix/official-docs/user-settings。先运行 RED 聚焦测试确认 2 failed tests；实现后运行 `pnpm --dir packages/studio exec vitest run src/app-next/settings/parity-matrix.test.ts src/app-next/settings/SettingsTruthModel.test.ts` 通过（2 files / 8 tests passed），`pnpm --dir packages/studio exec tsc --noEmit` 与 `pnpm --dir packages/studio exec tsc -p tsconfig.server.json --noEmit` 通过。

- [x] 13. 建立设置页与对话窗口浏览器 E2E 验收
  - 设置页 E2E：打开设置 → provider/模型/AI 代理 → 断言 0 账号平台不可调用、默认模型不来自列表第一个、运行策略不固定“已接入”、Codex 推理强度按真实 schema 显示或隐藏。
  - 会话创建 E2E：从工作台动作创建 session → Shell 侧栏出现 session → narrator route 可打开 → recovery 进入 ready/idle 或显示真实失败。
  - 对话窗口 E2E：打开 narrator route → 断言 header 使用真实 session config → 切换模型/推理/权限并回读 → 展开真实 tool card → running 时中断按钮可用，idle 时不可显示假运行。
  - E2E 记录命令、覆盖路径和不调用真实模型的降级边界。
  - 验证：Playwright/Browser E2E 在本地可重复运行，失败时输出真实错误而非吞掉断言。
  - 覆盖：Requirement 3、4、5、8、9；Design: Browser E2E Gate。
  - 证据：新增 `e2e/settings-session-conversation.spec.ts`，通过真实 Playwright 启动 Bun API + Vite 前端，在隔离 `.novelfork/e2e-workspace-flow-*` 根目录内准备真实 provider/runtime settings 与书籍，不调用真实模型。场景 1 覆盖 `/next/settings` 模型页默认模型未配置不从模型池第一项 fallback、`Codex 推理强度` 来自真实 settings schema、AI 供应商页 Codex 平台无账号显示“可导入 / 未配置账号 / 不可调用”、AI 代理页 first-token timeout 为 planned 且无“已接入/Codex sandbox 已接入”假 current。场景 2 覆盖 `/next/books/:bookId` 点击“生成下一章”创建真实 session、Shell 侧栏出现写作会话、跳转 `/next/narrators/:sessionId`，header 显示真实 binding/model/权限/推理，注入真实 chat state 后工具卡展开 raw 且脱敏 `apiKey/sk-*`，模型/权限/推理控件调用真实 session API 并轮询回读，idle 中断禁用、持久化 running tool call 刷新后中断启用。RED 先暴露 running tool call 刷新后仍禁用中断的问题；修复 `toConversationStatus()` 纳入持久化 running tool call。验证 `pnpm exec -- playwright test e2e/settings-session-conversation.spec.ts` 通过（2 passed）。

- [ ] 14. 文档、能力矩阵、CHANGELOG 与最终验收收口
  - 更新 `docs/01-当前状态/02-Studio能力矩阵.md`，把资源编辑、设置页、provider、对话窗口、Claude/Codex parity 按 current/partial/planned/non-goal/needs-browser-verification 记录。
  - 2026-05-07 追加真实 UI 交互体验记录：同机浏览器打开 NovelFork `http://127.0.0.1:4567` 与 NarraFork `http://127.0.0.1:7778`，记录设置页、工作台/项目页、叙述者列表与会话页对比；结论是 NovelFork 真实合同/状态透明已收敛，但会话页视觉布局、composer 空态、侧栏长列表管理与干净验收数据仍是 v0.1.0 前风险，不能把 Task 13 E2E passed 等同于 NarraFork 级 UI 体验成熟。
  - 更新 `docs/01-当前状态/03-当前执行主线.md`、`docs/08-测试与质量/01-当前测试状态.md`、`packages/studio/README.md`、相关 API 文档和 `.kiro/specs/README.md`。
  - CHANGELOG Unreleased 记录每个完成任务的修复/验证，不虚构未跑浏览器路径。
  - 运行验证：`pnpm --dir packages/studio test -- app-next`、`pnpm --dir packages/studio test -- backend-contract`、`pnpm --dir packages/studio typecheck`、`pnpm docs:verify`；涉及 CLI parity 或 headless 行为时追加 `pnpm --dir packages/cli test`；涉及 compiled Studio 冒烟时追加 `pnpm --dir packages/studio compile`。
  - 最终报告必须列出已运行命令、结果、浏览器 E2E 覆盖路径、未覆盖项和未运行项。
  - 覆盖：Requirement 9、10；Design: Documentation Strategy、Validation Commands。
