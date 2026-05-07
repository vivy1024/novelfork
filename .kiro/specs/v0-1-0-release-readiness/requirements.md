# v0.1.0 Release Readiness Requirements

**版本**: v1.0.0
**创建日期**: 2026-05-07
**状态**: draft
**文档类型**: Kiro requirements

---

## 1. 背景

NovelFork 当前已经完成多轮 Backend Contract、Conversation Parity、Frontend Live Wiring、Legacy Source Retirement、Backend Core Refactor 与 `ui-live-parity-hardening-v1` 的大部分任务。功能合同、设置 truth model、provider callable、资源编辑读回、对话窗口工具透明化、Claude/Codex parity guard 和设置/会话浏览器 E2E 均已有验证证据。

但是 2026-05-07 真实浏览器手工对比显示：

- NovelFork `http://127.0.0.1:4567` 的 `/next/narrators/:sessionId` 已经能回读真实 session config，但视觉体验仍像基础 HTML，标题、状态、模型/权限/推理控件挤在顶部，composer 贴底且层级弱。
- 左侧 Agent Shell 直接堆叠大量 Planner/写作会话，缺少 NarraFork `http://127.0.0.1:7778/narrators` 那样的筛选、排序、归档、状态管理体验。
- 当前开发数据中残留多批 `E2E Provider ...`，说明测试夹具会污染手工验收样本。
- Task 13 Playwright E2E 证明路径可运行，但不能证明 UI 体验达到 NarraFork 成熟度。

用户明确要求：**需要完整功能才发布 v0.1.0**。因此本 spec 将 v0.1.0 发版前的产品完成度、真实 UI 验活、干净数据、文档、归档、编译和 GitHub Release 收口统一设为发布阻塞门槛。

---

## 2. 范围

### 2.1 In Scope

- 产品壳与首页 / 作品入口体验成品化。
- 作品工作台全量体验成品化。
- 叙述者中心与会话页全量体验成品化。
- 设置 / Provider / Runtime 控制台可读性与测试夹具污染治理。
- 套路 / 工作流配置台发布前验活和文档口径收敛。
- 干净 root 软件实际打开验活。
- `ui-live-parity-hardening-v1` 最终 Task 14 收口与归档。
- v0.1.0 版本资料、CHANGELOG、文档、编译、smoke、Git tag 与 GitHub Release 产物。

### 2.2 Out of Scope

- 不要求照抄 NarraFork 的 Mantine 视觉库或 React Flow 节点图。
- 不要求把小说章节改造成 NarraFork coding agent 节点。
- 不要求实现终端 TUI、tmux、Chrome bridge、插件市场等 conversation-parity 已声明 non-goal。
- 不要求在 v0.1.0 前完成 EPUB、专注写作模式、世界关系图等既有未规划能力。

---

## 3. 需求

### Requirement 1：产品入口必须像软件，而不是开发路由

**User Story:** 作为作者，我希望打开 NovelFork 后看到可理解的作品入口、最近会话和运行状态，而不是直接进入开发态 IDE 列表，这样我能知道下一步该做什么。

#### Acceptance Criteria

1. WHEN 用户打开 `/next` THEN 系统 SHALL 展示作者向首页或可理解的工作台入口，包含最近作品、最近会话、主要写作动作和运行状态摘要。
2. WHEN 没有作品或会话 THEN 系统 SHALL 展示明确空态和创建/导入作品入口，而不是空白或开发占位。
3. WHEN 系统展示高级 Agent/运行状态 THEN 系统 SHALL 使用作者可理解文案，并避免把内部 API 名称作为第一层主文案。
4. WHEN 首页存在高级功能入口 THEN 系统 SHALL 区分作者常用入口和高级调试/管理入口。

### Requirement 2：作品工作台必须达到发布级写作体验

**User Story:** 作为作者，我希望在作品页能清楚理解章节、草稿、候选稿、Story、Truth、经纬和写作动作的关系，这样我能放心使用 AI 生成和编辑流程。

#### Acceptance Criteria

1. WHEN 用户打开 `/next/books/:bookId` THEN 系统 SHALL 清楚展示作品标题、资源树、当前资源画布、写作动作区和当前状态。
2. WHEN 用户选择 Story/Truth/章节/草稿/候选稿/经纬资源 THEN 系统 SHALL 以不同视觉层级标明资源类型、读写能力、保存状态和真实路径。
3. WHEN 当前资源只读 THEN 系统 SHALL 禁用保存并解释原因。
4. WHEN 当前资源可写且内容变更 THEN 系统 SHALL 展示 dirty 状态、保存入口、保存结果和切换拦截。
5. WHEN 用户触发写作动作 THEN 系统 SHALL 明确说明该动作会进入 session、candidate、draft、audit、prompt-preview 或 unsupported 哪个边界。
6. WHEN 资源或动作失败 THEN 系统 SHALL 展示真实错误和可恢复动作，不得静默失败或伪成功。

### Requirement 3：必须有发布级叙述者中心

**User Story:** 作为作者，我希望能像 NarraFork 一样管理所有写作会话、独立会话和历史会话，而不是在左栏长列表中寻找。

#### Acceptance Criteria

1. WHEN 用户进入会话中心 THEN 系统 SHALL 展示会话列表，包含标题、模型、状态、消息数、绑定作品/章节/工作目录、创建时间、最后消息时间。
2. WHEN 会话很多 THEN 系统 SHALL 支持搜索、类型筛选、状态筛选、排序和分页或虚拟滚动。
3. WHEN 会话已归档 THEN 系统 SHALL 能切换查看归档会话，并提供恢复入口。
4. WHEN 会话绑定作品或章节 THEN 系统 SHALL 明确显示绑定对象，并能跳转到相关作品或会话详情。
5. WHEN 用户在 Agent Shell 左栏查看叙述者 THEN 系统 SHALL 默认只展示最近或高优先级会话，并提供进入会话中心的入口，避免满屏历史会话。
6. WHEN 用户新建独立叙述者 THEN 系统 SHALL 至少可选择标题/工作目录或绑定对象、模型、权限模式、计划模式。

### Requirement 4：会话页必须达到发布级运行工作台体验

**User Story:** 作为作者，我希望对话页清楚展示当前 AI 会话在做什么、用什么模型、有什么权限、绑定哪本书、上下文消耗如何，以及我如何发送/中断/压缩/继续。

#### Acceptance Criteria

1. WHEN 用户打开 `/next/narrators/:sessionId` THEN 系统 SHALL 使用成品级布局展示会话标题、状态、绑定对象、模型、权限、推理强度、消息数、上下文/Token/成本和工作区/Git 状态。
2. WHEN session config 已加载 THEN 系统 SHALL 将模型、权限、推理强度放入清晰的控制区，并支持更新后回读。
3. WHEN session config 未加载或模型不可用 THEN 系统 SHALL 显示明确原因和设置入口，而不是展示可编辑假控件。
4. WHEN 会话没有消息 THEN 系统 SHALL 展示作者向空态，包括当前绑定、可用操作、输入建议和模型状态。
5. WHEN 会话有消息 THEN 系统 SHALL 以清晰消息流展示用户、assistant、工具调用、工具结果、确认门和错误。
6. WHEN 工具调用存在 raw 数据 THEN 系统 SHALL 支持展开/复制/全屏并保持敏感信息脱敏。
7. WHEN 会话运行中 THEN 系统 SHALL 高亮运行态，中断按钮可用，并显示运行目标或最近工具状态。
8. WHEN 会话 idle THEN 系统 SHALL 禁用中断并说明无运行中的会话。
9. WHEN 上下文达到裁剪或 compact 阈值 THEN 系统 SHALL 显示可理解 warning 和 compact 入口。
10. WHEN composer 可用 THEN 系统 SHALL 显示完整输入容器、发送/中断按钮、快捷提示、slash 建议和禁用原因。

### Requirement 5：设置 / Provider / Runtime 控制台必须可读、可信、可清理

**User Story:** 作为用户，我希望设置页既真实又好读，不被测试数据和内部状态淹没，这样我能正确配置模型和 Agent 运行方式。

#### Acceptance Criteria

1. WHEN 用户打开模型设置 THEN 系统 SHALL 展示真实 user settings，不使用模型池第一项冒充当前值。
2. WHEN 用户打开 AI 供应商 THEN 系统 SHALL 区分平台账号、API key provider、模型库存、callable 状态和异常项。
3. WHEN provider 或模型来自 E2E/测试夹具 THEN 系统 SHALL 在正常生产 root 中不存在；若处于开发 root，系统 SHOULD 支持识别或清理测试夹具。
4. WHEN provider 列表很长 THEN 系统 SHALL 支持分组折叠、搜索或过滤，避免手工选择体验被噪声淹没。
5. WHEN Agent runtime 字段未接入 THEN 系统 SHALL 标为 planned/unsupported，不得显示已接入。
6. WHEN 设置保存完成 THEN 系统 SHALL 从真实 API 回读最终状态。

### Requirement 6：套路 / 工作流配置台必须完成发布前验活

**User Story:** 作为高级用户，我希望命令、工具、技能、子代理、MCP、钩子等工作流能力有统一入口和真实状态，这样我能理解哪些能力可用、哪些只是计划中。

#### Acceptance Criteria

1. WHEN 用户打开 `/next/routines` THEN 系统 SHALL 展示命令、工具、权限、技能、子代理、MCP、钩子等分组入口。
2. WHEN 某类能力已有真实 API THEN 系统 SHALL 展示真实列表、状态和操作结果。
3. WHEN 某类能力未接入或只读 THEN 系统 SHALL 显示 planned/unsupported/readonly 原因。
4. WHEN MCP 或工具权限状态变化 THEN 系统 SHALL 使用真实 API 结果，不使用静态 mock。
5. WHEN 发布前手工验活 routines 页 THEN 系统 SHALL 记录覆盖路径、可用项、未接项和错误。

### Requirement 7：干净 root 实际软件验活必须通过

**User Story:** 作为发布者，我希望在一个干净数据目录里打开软件并走完整主流程，确保发布包不是只在污染的开发环境里可用。

#### Acceptance Criteria

1. WHEN 执行 release smoke THEN 系统 SHALL 使用干净 root 启动编译产物或开发服务器。
2. WHEN 干净 root 首次打开 THEN 系统 SHALL 不出现 E2E Provider、测试书籍或历史 Planner 噪声。
3. WHEN 用户创建或导入作品 THEN 系统 SHALL 能进入作品工作台并打开资源。
4. WHEN 用户创建或打开会话 THEN 系统 SHALL 能进入会话页并显示发布级布局。
5. WHEN 用户打开设置、供应商、套路和关于页 THEN 系统 SHALL 能展示真实状态或明确空态。
6. WHEN 手工验活完成 THEN 系统 SHALL 在文档中记录端口、root、路径、结果、未覆盖项和截图/文字证据。

### Requirement 8：E2E 与测试夹具不得污染发布验收

**User Story:** 作为维护者，我希望自动化测试能验证真实路径，但不会污染之后的手工验收和发布数据。

#### Acceptance Criteria

1. WHEN Playwright E2E 创建 provider、book、session 或 settings THEN 测试 SHALL 使用隔离 root 或在结束后清理可识别夹具。
2. WHEN 测试失败中断 THEN 后续手工验收 SHALL 能通过独立 clean root 避免污染。
3. WHEN 文档记录测试结果 THEN 系统 SHALL 区分自动化隔离 root 与手工验活 root。
4. WHEN 发布前检查 provider/model 列表 THEN 系统 SHALL 不出现 `E2E Provider` 或测试模型。

### Requirement 9：所有旧 spec 必须收口或归档

**User Story:** 作为维护者，我希望 v0.1.0 前没有“执行中但未收口”的历史主线，否则发布状态不可信。

#### Acceptance Criteria

1. WHEN `ui-live-parity-hardening-v1` Task 14 完成 THEN 系统 SHALL 更新 tasks、能力矩阵、当前执行主线、测试状态、Studio README、CHANGELOG。
2. WHEN spec 已完成 THEN 系统 SHALL 归档或标记完成，并在 `.kiro/specs/README.md` 中更新状态。
3. WHEN 存在延期项 THEN 系统 SHALL 明确标记为 post-v0.1.0 planned/non-goal/known issue，不能混在 current 能力中。
4. WHEN 发布报告生成 THEN 系统 SHALL 列出所有 completed/archived specs 与剩余 known gaps。

### Requirement 10：v0.1.0 版本资料和发布产物必须完整

**User Story:** 作为发布者，我希望 v0.1.0 的版本号、变更记录、编译产物、校验和、Git tag 和 GitHub Release 完整一致。

#### Acceptance Criteria

1. WHEN 发版开始 THEN 系统 SHALL 将版本号从 `0.0.6` 更新到 `0.1.0`，同步根/包级 `package.json`、`CLAUDE.md`、`AGENTS.md`、CHANGELOG 和相关文档。
2. WHEN CHANGELOG 发版 THEN 系统 SHALL 将 Unreleased 内容移到 `v0.1.0` 段，日期使用实际发版日期。
3. WHEN 编译 Windows 产物 THEN 系统 SHALL 生成 `dist/novelfork-v0.1.0-windows-x64.exe` 和 SHA256。
4. WHEN smoke 编译产物 THEN 系统 SHALL 实际打开软件并验证 `/`、`/api/mode`、`/next`、关键页面和干净 root 主流程。
5. WHEN tag 发布 THEN 系统 SHALL 创建 `v0.1.0` Git tag 并推送提交与 tag。
6. WHEN GitHub Release 发布 THEN 系统 SHALL 上传 exe 与 SHA256，并记录 Release URL。

### Requirement 11：验证命令和手工证据必须可追溯

**User Story:** 作为维护者，我希望每个“完成/通过/可用”的声明都能回溯到命令输出或手工记录，避免发布报告虚构。

#### Acceptance Criteria

1. WHEN 声明测试通过 THEN 系统 SHALL 记录具体命令、结果、测试数量或关键输出。
2. WHEN 声明 UI 体验达标 THEN 系统 SHALL 记录真实浏览器路径、环境、观察结果和必要截图/文字证据。
3. WHEN 某项未运行 THEN 系统 SHALL 明确写“未运行”及原因。
4. WHEN 某项失败后修复 THEN 系统 SHALL 记录失败现象、根因、修复和最终验证。
5. WHEN 最终报告输出 THEN 系统 SHALL 区分自动化验证、手工软件验活、未覆盖项和 post-release backlog。

---

## 4. 成功标准

v0.1.0 只有在以下条件全部满足时才能发布：

1. 本 spec 所有 in-scope requirement 已满足，或明确经用户批准降级为 post-v0.1.0。
2. `ui-live-parity-hardening-v1` 完成并归档。
3. 对话页、会话中心、作品工作台、设置、套路、首页均通过干净 root 手工验活。
4. 自动化测试、typecheck、docs verify、compile、smoke 均有新鲜证据。
5. 文档、CHANGELOG、版本号、tag、GitHub Release 产物一致。

---

## 5. 风险

- 全量发布门槛会明显扩大 v0.1.0 前工作量。
- 会话中心和对话页视觉成品化可能触及多处前端组件与 E2E。
- 干净 root 验活可能暴露首次引导、模型空态、provider 空态等新问题。
- 发版前版本号同步和 GitHub Release 上传必须严格避免半成品发布。
