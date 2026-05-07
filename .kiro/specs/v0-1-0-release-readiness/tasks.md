# Implementation Plan

## Overview

本任务清单从已批准的 `v0-1-0-release-readiness` requirements/design 生成，目标是在发布 v0.1.0 前完成全量产品体验、真实 UI 验活、干净 root 验收、spec 归档、版本资料、编译 smoke、Git tag 和 GitHub Release 产物。执行时必须保持 Backend Contract、Agent Shell + Writing Workbench、SettingsTruthModel 和现有 session runtime 边界，不恢复旧三栏、旧 ChatWindow、mock/fake/noop 假成功。

## Tasks

- [x] 1. 固化发布准备基线与可追溯清单
  - 读取并确认 `requirements.md` / `design.md`、`ui-live-parity-hardening-v1` Task 14、2026-05-07 4567/7778 手工 UI 对比记录、当前能力矩阵和测试状态。
  - 建立本轮发布准备 traceability checklist：Requirement 1-11 → 相关组件/API/E2E/文档/验证命令。
  - 检查当前工作树、最近提交、当前版本号、现有 dist/release 产物和 active spec 状态，避免基于过期事实执行。
  - 验证：记录 `git status --short`、最近提交、spec 状态和待执行清单；不得修改实现。
  - 覆盖：Requirement 9、11；Design 2、7、9。
  - 证据：新增 `release-readiness-baseline.md`，记录已读取的 approved requirements/design/tasks、`ui-live-parity-hardening-v1` Task 14 状态、4567/7778 手工 UI 对比、能力矩阵、测试状态、执行前干净工作树、最新提交 `cb269472`、当前 0.0.6 版本号、dist 中仅有 v0.0.2-v0.0.6/novelfork.exe 而无 v0.1.0 产物；建立 Requirement 1-11 → Task/子系统/验证方式映射，并列出会话页视觉、叙述者中心、首页、工作台、E2E provider 污染、Routines 验活、clean root、spec 归档、版本/产物等当前发布阻塞项。

- [x] 2. 为会话页 UI 成品化补 RED 组件测试
  - 在 `ConversationSurface.test.tsx` / 邻近测试中先补失败用例，覆盖发布级 session header、runtime summary cards、empty state、composer dock、running/idle controls、session config 未加载原因、模型不可用设置入口。
  - 测试必须断言信息被分区展示，不能再以一长串文本挤在 `.conversation-status-bar` 内。
  - 测试必须保留既有工具卡 raw 脱敏、确认门、context warning、running abort 行为。
  - 验证：先运行聚焦测试并确认 RED 失败原因来自当前 UI 结构不足，而不是测试选择器错误。
  - 覆盖：Requirement 4；Design 4.4、5.2、6.1。
  - 证据：在 `ConversationSurface.test.tsx` 新增 3 条 RED 用例，覆盖 `conversation-session-header`、`conversation-runtime-summary-cards`、`conversation-session-config-controls`、`conversation-empty-state`、`conversation-composer-dock` 与 `conversation-recovery-confirmation-lane`。先运行 `pnpm --dir packages/studio exec vitest run src/app-next/agent-conversation/surface/ConversationSurface.test.tsx`，确认 1 file / 26 tests 中 3 failed / 23 passed；失败原因均为缺少成品化结构 testid 或空态，而现有 DOM 仍把状态、模型、权限、推理、Token、上下文、工具策略和控件堆在 `conversation-status-bar` 内。

- [x] 3. 重构 `/next/narrators/:sessionId` 会话页布局为发布级工作台
  - 重排 `ConversationSurface`、`ConversationStatusBar`、`Composer`、`ConversationRuntimeControls`，形成 Session Header、Runtime Summary Cards、Recovery/Confirmation Lane、Message Stream、Composer Dock 五区布局。
  - 使用现有 Tailwind token、`paper-sheet` / `glass-panel` / 卡片样式；不引入 Mantine，不恢复旧 ChatWindow。
  - 保持所有 session config 更新、chat state 回读、tool confirmation、compact、abort、slash command 和 raw 脱敏合同不变。
  - 验证：Task 2 RED 测试转 GREEN；运行 `ConversationSurface`、`StudioNextApp` 和 session route 邻近回归。
  - 覆盖：Requirement 4；Design 4.4、5.2、8。
  - 证据：`ConversationSurface` 增加 session header、recovery/confirmation lane 和作者向空态；`ConversationStatusBar` 拆分 session facts、runtime summary cards、session config controls；`Composer` 增加 dock testid 与 `paper-sheet` 输入容器；`ConversationRuntimeControls` 使用 `glass-panel` 卡片样式。验证 `pnpm --dir packages/studio exec vitest run src/app-next/agent-conversation/surface/ConversationSurface.test.tsx` 通过（1 file / 26 tests passed），`pnpm --dir packages/studio exec vitest run src/app-next/agent-conversation/surface/ConversationSurface.test.tsx src/app-next/StudioNextApp.test.tsx src/api/routes/session.test.ts` 通过（3 files / 72 tests passed），`pnpm --dir packages/studio exec tsc --noEmit` 与 `pnpm --dir packages/studio exec tsc -p tsconfig.server.json --noEmit` 通过。

- [x] 4. 补会话页浏览器 E2E 与手工体验检查点
  - 扩展 `e2e/settings-session-conversation.spec.ts` 或新增 release-readiness E2E，覆盖空会话、已有消息、工具卡、pending confirmation、running tool call、模型/权限/推理回读、composer dock、禁用原因和设置入口。
  - E2E 不调用真实模型，继续用真实 API 准备 session/chat state。
  - 在文档中记录会话页手工检查点：标题、状态、绑定、模型/权限/推理、Token/context、运行控制、composer 是否分区清晰。
  - 验证：Playwright 聚焦通过；失败时截图/trace 可定位布局或合同问题。
  - 覆盖：Requirement 4、11；Design 6.2、7、9。
  - 证据：在 `e2e/settings-session-conversation.spec.ts` 新增空会话发布布局场景，使用隔离 `.novelfork/e2e-workspace-flow-*` root、真实 `/api/providers`、`/api/settings/user`、`/api/sessions` 准备 model-unavailable session，先运行 `pnpm exec playwright test e2e/settings-session-conversation.spec.ts -g "conversation route empty state"` 得到 RED：`conversation-empty-state` 缺少“模型池为空，请先到设置页启用模型”恢复说明；随后让空态同步显示 `sendDisabledReason` 和设置入口，聚焦场景通过。扩展既有工作台→会话 E2E，覆盖工具卡 raw 脱敏 + 全屏详情、pending confirmation lane + 拒绝后 `/api/sessions/:id/tools` 回读清空、模型/权限/推理回读、idle/running 中断控制。验证 `pnpm exec playwright test e2e/settings-session-conversation.spec.ts` 通过（3 tests passed，真实 Bun API + Vite 前端，不调用真实模型）。收尾验证：`pnpm --dir packages/studio exec vitest run src/app-next/agent-conversation/surface/ConversationSurface.test.tsx` 通过（1 file / 26 tests passed）；`pnpm --dir packages/studio exec vitest run src/app-next/agent-conversation/surface/ConversationSurface.test.tsx src/app-next/StudioNextApp.test.tsx src/api/routes/session.test.ts` 通过（3 files / 72 tests passed）；`pnpm --dir packages/studio exec tsc --noEmit` 与 `pnpm --dir packages/studio exec tsc -p tsconfig.server.json --noEmit` 通过；`pnpm docs:verify` 通过（84 markdown files / 22 directories）；`git diff --check` 退出码 0（仅 LF/CRLF 工作区提示）。

- [x] 5. 为叙述者中心和 Shell 左栏管理补 RED 测试
  - 检查并扩展 `SessionCenterPage`、`SessionCenter`、`NarratorList`、`AgentShell` / `StudioNextApp` 相关测试。
  - 先补失败用例：会话中心展示标题、状态、模型、消息数、绑定对象、工作目录、创建/最后消息时间；支持搜索、类型筛选、状态筛选、排序、归档/恢复入口；Shell 左栏只展示最近/高优先级会话并提供“查看全部叙述者”。
  - 新建独立叙述者测试应覆盖标题、工作目录/绑定对象、模型、权限模式、计划模式。
  - 验证：聚焦测试先 RED，失败原因来自缺少 UI/行为。
  - 覆盖：Requirement 3；Design 4.3、5.1、6.1。
  - 证据：扩展 `SessionCenter.test.tsx`、`NewSessionDialog.test.tsx`、`AgentShell.test.tsx`，新增 3 个 RED 用例，覆盖会话中心工作目录/创建/最后消息时间/排序控件，新建独立叙述者标题 + 工作目录 + 绑定对象 + 模型 + 权限 + 计划模式，以及 Shell 左栏最近会话截断、剩余数量和“查看全部叙述者”入口。运行 `pnpm --dir packages/studio exec vitest run src/components/sessions/SessionCenter.test.tsx src/components/sessions/NewSessionDialog.test.tsx src/app-next/shell/AgentShell.test.tsx` 得到 3 failed / 15 passed：失败点分别为 Shell 左栏仍显示 `历史会话 6`、SessionCenter 行缺 `工作目录：D:\\novels\\free-session`/时间元信息、NewSessionDialog 缺 `工作目录` 字段，均来自 Task 6 待实现的 UI/行为缺口。

- [x] 6. 完成发布级叙述者中心与 Shell 左栏收敛
  - 复用现有 `SessionCenterPage` 和 session domain client，补搜索、类型/状态筛选、排序、归档/恢复、新建独立叙述者表单和真实错误展示。
  - Shell 左栏改为精选最近 N 条或折叠分组，显示进入会话中心入口，不再默认满屏历史 Planner/写作会话。
  - 保持打开会话跳转 `/next/narrators/:sessionId`，不恢复 windowStore 或旧 shell window。
  - 验证：Task 5 RED 转 GREEN；运行 SessionCenter/NarratorList/StudioNextApp 聚焦回归。
  - 覆盖：Requirement 3；Design 4.3、5.1、8。
  - 证据：`SessionCenter` 复用 session domain client 增加排序控件、工作目录、创建/最后消息时间、`NewSessionDialog` 入口与真实 `createSession`；`NewSessionDialog` 增加工作目录、绑定对象、运行时模型选择并保留权限/计划模式；`ShellSidebar` 仅展示前 5 条活跃叙述者、显示剩余数量并通过 `/next/sessions` 进入完整会话中心；`shell-route` 与 `StudioNextApp` 接通 `/next/sessions`。验证 `pnpm --dir packages/studio exec vitest run src/components/sessions/SessionCenter.test.tsx src/components/sessions/NewSessionDialog.test.tsx src/app-next/shell/AgentShell.test.tsx` 通过（3 files / 18 tests passed）；邻近回归 `pnpm --dir packages/studio exec vitest run src/components/sessions/SessionCenter.test.tsx src/components/sessions/NewSessionDialog.test.tsx src/app-next/shell/AgentShell.test.tsx src/app-next/shell/shell-route.test.ts src/app-next/sessions/SessionCenterPage.test.tsx src/app-next/sidebar/NarratorList.test.tsx src/app-next/StudioNextApp.test.tsx src/api/routes/session.test.ts src/app-next/backend-contract/domain-clients.test.ts` 通过（9 files / 87 tests passed）；`pnpm --dir packages/studio exec tsc --noEmit` 与 `pnpm --dir packages/studio exec tsc -p tsconfig.server.json --noEmit` 通过。

- [x] 7. 补产品首页 / 作品入口 RED 测试
  - 为 `/next` route 或 AgentShell 首页补测试，断言作者向首页展示最近作品、最近会话、provider/model 健康摘要、主要写作动作、设置/套路入口和空态。
  - 首页统计必须来自真实 books/sessions/provider summary 或透明 unavailable/planned 状态，不允许硬编码假数据。
  - 验证：聚焦测试先 RED，确认当前 `/next` 入口仍偏开发态或缺空态。
  - 覆盖：Requirement 1；Design 4.1、5.1。
  - 证据：扩展 `src/app-next/routing.test.tsx`，新增作者首页 RED 用例：带 shell data mock 时要求 `/next` 主区显示“最近作品”“最近会话”“模型健康”“新建会话”“打开设置”；空数据时要求显示“还没有可用内容，先创建第一本书或新建会话。”。运行 `pnpm --dir packages/studio exec vitest run src/app-next/routing.test.tsx -t "author-facing home sections"` 先失败于主区仍为 `Agent Shell` 占位页且缺少“最近作品”。

- [x] 8. 实现发布级产品壳首页
  - 在 app-next route 中实现作者首页或可理解的工作台入口，复用 `useShellData`、provider summary/status 和现有导航。
  - 展示最近作品、最近会话、主要写作动作、设置/套路/会话中心入口和空态。
  - 高级调试/管理入口降低层级，不作为作者第一屏主动作。
  - 验证：Task 7 RED 转 GREEN；运行 routing/StudioNextApp/ShellData 相关回归。
  - 覆盖：Requirement 1；Design 4.1、5.1、8。
  - 证据：`StudioNextApp` 新增 `HomeRouteLive`，`/next` 主区不再显示开发占位 `Agent Shell`，而是从 `useShellData` 读取真实 books/sessions/provider summary/status，展示作者首页、最近作品、最近会话、模型健康、快速动作、provider 透明摘要和空态；保留 route 内导航，不引入假统计。验证 `pnpm --dir packages/studio exec vitest run src/app-next/routing.test.tsx` 通过（1 file / 4 tests passed）；邻近回归 `pnpm --dir packages/studio exec vitest run src/app-next/routing.test.tsx src/app-next/StudioNextApp.test.tsx src/app-next/entry.test.ts src/app-next/shell/useShellData.test.ts src/app-next/shell/AgentShell.test.tsx` 通过（5 files / 39 tests passed）；`pnpm --dir packages/studio exec tsc --noEmit` 与 `pnpm --dir packages/studio exec tsc -p tsconfig.server.json --noEmit` 通过。

- [x] 9. 为作品工作台发布级体验补 RED 测试
  - 扩展 `WritingWorkbenchRoute`、资源树、资源 viewer/canvas、WorkbenchWritingActions 相关测试。
  - 先补失败用例：作品标题/当前状态清晰、资源类型/路径/读写能力/保存状态卡片化、只读保存解释、dirty 状态、写作动作结果边界（session/candidate/draft/audit/prompt-preview/unsupported）可见。
  - 保留资源 hydrate、保存后回读、dirty guard、写作动作创建 session 的既有断言。
  - 验证：聚焦测试先 RED，失败原因来自体验信息缺失或布局不足。
  - 覆盖：Requirement 2；Design 4.2、5.1。
  - 证据：新增 `WritingWorkbenchRoute.test.tsx`，要求工作台首屏展示作品标题“灵潮纪元”、当前状态、资源树/当前资源画布/写作动作区域；扩展 `WorkbenchCanvas.test.tsx`，要求 `workbench-resource-header` 卡片展示资源类型、真实路径、读写能力、保存状态和只读原因；扩展 `WorkbenchWritingActions.test.tsx`，要求动作卡显示 `session → candidate`、`prompt-preview`、`audit` 结果边界。验证 `pnpm --dir packages/studio exec vitest run src/app-next/writing-workbench/WritingWorkbenchRoute.test.tsx src/app-next/writing-workbench/WorkbenchCanvas.test.tsx src/app-next/writing-workbench/WorkbenchWritingActions.test.tsx` 得到 3 failed / 12 passed，失败均来自发布级解释层缺失：无作品标题 heading/当前状态区域、无 `workbench-resource-header`、无结果边界文本。

- [ ] 10. 完成作品工作台体验成品化
  - 改进资源树分组、当前资源 header、资源 viewer/canvas 和写作动作卡片文案。
  - 不改变正式写入边界：AI 输出仍进 candidate/draft/preview，不直接覆盖正文。
  - 失败、只读、unsupported、prompt-preview、dirty guard 均保持透明。
  - 验证：Task 9 RED 转 GREEN；运行工作台聚焦回归和 `e2e/workbench-resource-edit.spec.ts`。
  - 覆盖：Requirement 2；Design 4.2、8、9。

- [ ] 11. 治理设置 / Provider 可读性与 E2E 夹具污染
  - 为 `ProviderSettingsPage`、`SettingsTruthModel`、相关 E2E fixtures 补测试，确认 clean root 不出现 `E2E Provider`，开发 root 可识别/清理测试 provider 或测试模型。
  - Provider 页增加搜索/分组折叠/异常过滤或等价可读性改进，保留平台账号、API key provider、模型库存、callable 状态分离。
  - E2E fixture 必须使用隔离 root 或可清理数据，不污染发布 smoke root。
  - 验证：Provider/Settings 聚焦回归、相关 Playwright 场景通过；手工检查模型/provider 列表无测试噪声。
  - 覆盖：Requirement 5、8；Design 4.5、4.7、5.3、6.1、6.2。

- [ ] 12. 验活并补齐 Routines / 工作流配置台发布口径
  - 真实打开 `/next/routines`，检查命令、工具、权限、技能、子代理、MCP、钩子等分组入口。
  - 如果发现静态 mock 或假 current，先补 RED 测试并修复为真实列表、readonly/planned/unsupported 或错误状态。
  - 更新文档记录 routines 页 current/readonly/planned/unsupported 项和未覆盖项。
  - 验证：Routines 聚焦回归、必要 Browser/Playwright 验活；未接能力不得宣传为可用。
  - 覆盖：Requirement 6、11；Design 4.6、7、9。

- [ ] 13. 建立 v0.1.0 release-readiness 浏览器 E2E 主路径
  - 新增或扩展 Playwright spec，使用 clean/isolated root 覆盖：`/next` 首页、作品创建/打开、工作台资源、写作动作创建 session、会话中心、会话页、设置、Provider、Routines、关于。
  - 不调用真实模型；通过真实 API 或 UI 准备最小可用 provider/settings/book/session。
  - 断言 clean root 无测试 provider、测试书籍、历史 Planner 噪声。
  - 验证：Playwright 主路径通过，并输出可用于发布验收的 trace/screenshot 证据。
  - 覆盖：Requirement 1-8、11；Design 6.2、4.7。

- [ ] 14. 执行干净 root 手工软件验活
  - 用全新 clean root 启动开发服务器或编译产物，打开真实浏览器，逐项走 `/`、`/api/mode`、`/next`、首页、作品、工作台、会话中心、会话页、设置、Provider、Routines、关于。
  - 记录端口、root、启动命令、浏览器路径、观察结果、失败项、未覆盖项和截图/文字证据。
  - 如果发现阻塞问题，回到对应任务补 RED 测试和修复，不能只写 known issue 发布。
  - 验证：手工记录写入 `docs/08-测试与质量/01-当前测试状态.md` 和 NarraFork/UI 调研或 release readiness 文档。
  - 覆盖：Requirement 7、11；Design 4.7、6.3、7、9。

- [ ] 15. 收口 `ui-live-parity-hardening-v1` Task 14 并归档旧 spec 状态
  - 更新 `ui-live-parity-hardening-v1/tasks.md`，完成 Task 14 文档、能力矩阵、CHANGELOG 与最终验收收口。
  - 更新 `.kiro/specs/README.md`、当前执行主线、能力矩阵、测试状态、Studio README、相关 API/运行文档。
  - 将已完成或被 release-readiness 上收的风险标记清楚：current、partial、planned、unsupported、non-goal、experience-not-ready、verified-by-browser、verified-by-release-smoke。
  - 按项目归档规则移动或标记 completed specs，确保 v0.1.0 前没有未收口 active 主线。
  - 验证：docs verify 通过，spec 索引与任务状态一致。
  - 覆盖：Requirement 9、11；Design 7、9。

- [ ] 16. 全量自动化验证与回归矩阵
  - 运行并记录：`pnpm --dir packages/studio test -- app-next`、`pnpm --dir packages/studio test -- backend-contract`、`pnpm --dir packages/studio typecheck`、`pnpm --dir packages/cli test`、`pnpm docs:verify`、`git diff --check`。
  - 涉及新增 E2E 时运行 release-readiness Playwright spec、workbench/resource E2E、settings/session conversation E2E。
  - 所有失败先读报错、补调查、修复根因，再重跑；不得跳过失败测试。
  - 验证：测试状态文档记录命令、结果、失败/修复和未运行项。
  - 覆盖：Requirement 11；Design 6.1、6.2、6.3。

- [ ] 17. 更新 v0.1.0 版本资料与发布文档
  - 将版本号更新到 `0.1.0`，同步根/包级 `package.json`、`CLAUDE.md`、`AGENTS.md`、README、Studio README、CHANGELOG 和需要同步的文档。
  - 将 CHANGELOG Unreleased 移入 `v0.1.0 (YYYY-MM-DD)`，日期使用实际发版日期，不虚构条目。
  - 更新能力矩阵、当前状态、当前执行主线、测试状态和 release readiness spec 状态。
  - 验证：全仓搜索旧版本/旧发布口径，确保无遗漏；docs verify 通过。
  - 覆盖：Requirement 10、11；Design 4.8、7。

- [ ] 18. 编译 Windows 发布产物并执行 compiled smoke
  - 运行 `pnpm --dir packages/studio compile`，生成 `dist/novelfork-v0.1.0-windows-x64.exe`。
  - 生成 SHA256 校验文件。
  - 使用 clean root 启动编译产物，实际打开软件验证 `/`、`/api/mode`、`/next`、关键页面与主流程。
  - 记录端口、命令、进程状态、HTTP 结果、浏览器手工结果和失败项。
  - 验证：compile/smoke 证据写入测试状态和发布记录。
  - 覆盖：Requirement 7、10、11；Design 4.8、6.3。

- [ ] 19. Release commit、Git tag 与 GitHub Release
  - 在所有验证和手工验活通过后创建 release commit。
  - 创建并推送 `v0.1.0` tag。
  - 创建 GitHub Release，上传 `dist/novelfork-v0.1.0-windows-x64.exe` 与 SHA256。
  - 验证 Release URL、附件名称、校验和和远端 tag 存在。
  - 不得只本地 tag 或只本地构建就宣称 release 完成。
  - 覆盖：Requirement 10、11；Design 4.8、9。

- [ ] 20. 最终验收报告与目标完成判断
  - 汇总所有自动化验证、手工软件验活、clean root 证据、未覆盖项、post-v0.1.0 backlog、Release URL、tag、commit。
  - 核对 active goal 每一项：剩余 spec 完成、测试验证、实际打开软件验证、文档全量更新、spec 归档、v0.1.0 发布。
  - 运行最终 `git status --short`、必要 diff/log 检查，确认无未提交发布改动。
  - 只有全部证据齐全后，才能声明 active goal 完成并更新目标状态。
  - 覆盖：Requirement 9、10、11；Design 7、9。
