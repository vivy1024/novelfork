# UI Live Parity Hardening v1 Requirements

## Introduction

本 spec 处理 2026-05-06 真实浏览器调查暴露的问题：NovelFork Studio 的 `/next` 页面、资源树、设置页和会话入口已经可见，但仍存在“组件渲染成功不等于功能真实可用”的断裂。最严重的事实是：章节详情 API 已返回正文，工作台点击章节后编辑器却显示空内容；设置页存在写死的 `Codex 推理强度`、固定“已接入”状态卡和用 `modelOptions[0]` 冒充当前模型的显示风险；从工作台创建会话后 Shell 左侧叙述者列表和 recovery 状态没有同步到真实运行态。

本 spec 目标是把新前端从“live route 可达”推进到“作者可安全使用”：资源打开、编辑、保存、刷新读回必须闭环；设置页必须只展示真实配置、真实能力和真实不可用原因；Claude Code CLI 与 OpenAI Codex CLI 的对标必须落成 current / partial / non-goal 守护矩阵，防止文档和 UI 把未实现能力写成已实现。

本 spec 在 `frontend-live-wiring-v1`、`legacy-source-retirement-v1`、`conversation-parity-v1` 和 `backend-core-refactor-v1` 之后执行。实现必须继续遵守 Backend Contract client / adapter 边界，不恢复旧前端、不新增 mock/fake/noop 成功层、不让 AI 输出直接覆盖正式正文。

本 spec 明确把本地 NarraFork 作为产品参考，而不是把它的所有能力写成 NovelFork 当前承诺。2026-05-06 对 `http://localhost:7778` 的真实浏览器调查确认：NarraFork 的设置页已经覆盖个人资料、模型、AI 代理、通知、外观与界面、IM 网关、提供商、代理管理、章节与容器、服务器与系统、用户管理、终端管理、储存空间、运行资源、使用历史、关于等分区；对话窗口已经把工作区/Git 状态、上下文占用、模型、推理强度、权限模式、工具调用、运行控制直接暴露给用户。NovelFork 借鉴这些信息架构和透明化原则，但每个显示项都必须回到 NovelFork 自己的真实 schema、API、runtime 状态或明确的 planned/non-goal 标记。

---

## Requirement 1：工作台资源打开必须加载真实详情内容

**User Story：** 作为作者，我希望点击资源树里的章节、草稿、Truth 文件或经纬条目时，画布显示真实内容，而不是空编辑器或列表预览。

### Acceptance Criteria

1. WHEN 用户点击章节资源 THEN THE SYSTEM SHALL 通过集中 resource client 拉取 `/api/books/:bookId/chapters/:chapterNumber` 详情，并在章节编辑器显示真实 `content`。
2. WHEN 章节详情 API 返回非空 content THEN THE SYSTEM SHALL 禁止以空 textarea 作为已加载状态展示。
3. WHEN 资源详情加载中 THEN THE SYSTEM SHALL 显示明确 loading 状态，并保留当前画布内容直到新资源成功加载或用户确认切换。
4. WHEN 资源详情加载失败 THEN THE SYSTEM SHALL 显示真实错误和重试入口，不得退化为空内容编辑器。
5. WHEN 用户打开候选稿、草稿、Story 文件、Truth 文件、经纬条目或叙事线快照 THEN THE SYSTEM SHALL 按 kind 选择真实详情来源；若仅有列表预览，UI 必须标明“预览”而非“完整内容”。
6. WHEN 某资源 contract 标记 `read` 非 current THEN THE SYSTEM SHALL 禁用打开或展示 unsupported/planned/deprecated 原因，不得假装可读。

---

## Requirement 2：工作台资源保存必须具备防覆盖闭环

**User Story：** 作为作者，我希望编辑章节或设定文件后保存，并能刷新页面读回同一内容，同时不会因为 UI 空内容或旧版本覆盖正式正文。

### Acceptance Criteria

1. WHEN 用户修改可编辑资源 THEN THE SYSTEM SHALL 标记 dirty，并在切换资源、离开页面或触发写作动作前给出明确拦截。
2. WHEN 用户保存章节 THEN THE SYSTEM SHALL 调用真实章节保存 API，并在成功后刷新该资源详情、清除 dirty、更新保存时间或状态。
3. WHEN 用户保存 Truth 文件、草稿或经纬条目 THEN THE SYSTEM SHALL 调用对应 kind 的真实保存 API；若当前 kind 没有 current save contract，保存按钮必须禁用并解释原因。
4. WHEN 保存请求基于过期内容、缺失资源或服务端冲突 THEN THE SYSTEM SHALL 显示冲突错误，不得静默覆盖。
5. WHEN 保存前资源内容尚未完成详情 hydrate THEN THE SYSTEM SHALL 禁止保存，避免把空 textarea 写回正式资源。
6. WHEN 保存成功后用户刷新页面并重新打开资源 THEN THE SYSTEM SHALL 展示刚保存的内容。
7. WHEN 资源具备 checkpoint 规则 THEN THE SYSTEM SHALL 继续走已存在的 checkpoint/rewind 边界；候选稿、草稿和 prompt-preview 不升级为正式正文覆盖。

---

## Requirement 3：Agent Shell 会话列表与恢复状态必须同步真实运行态

**User Story：** 作为作者，我希望从工作台创建“生成下一章”等叙述者会话后，左侧 Shell 立刻出现会话，并且恢复状态能从 reconnecting/recovering 正确进入 ready/idle。

### Acceptance Criteria

1. WHEN 工作台写作动作创建、恢复或 fork session THEN THE SYSTEM SHALL 刷新或乐观更新 Shell 左侧叙述者列表。
2. WHEN `/api/sessions` 返回新 active session THEN THE SYSTEM SHALL 在当前 Shell 侧栏中展示该会话，不再显示“暂无活跃会话”。
3. WHEN session recovery service 返回 idle 或 WebSocket 已完成 replay THEN THE SYSTEM SHALL 更新 UI recovery badge，不得长期停留在 `recovering / reconnect`。
4. WHEN WebSocket 连接失败、replay 失败或 resetRequired THEN THE SYSTEM SHALL 展示真实失败状态、恢复动作和最近成功 cursor。
5. WHEN 用户切换模型、权限模式或推理强度 THEN THE SYSTEM SHALL 持久化到 session config，并刷新状态栏显示。
6. WHEN session list、chat state、tools 或 provider models 任一依赖请求失败 THEN THE SYSTEM SHALL 显示局部错误，不得让整个 narrator route 空白。

---

## Requirement 4：设置页必须移除硬编码状态与伪接线

**User Story：** 作为维护者，我希望设置页只展示真实配置、真实能力和真实不可用原因，不能用硬编码“已接入”或空值误导用户。

### Acceptance Criteria

1. WHEN 设置页展示模型、推理强度、权限、MCP、目录规则或调试项 THEN THE SYSTEM SHALL 从 `/api/settings/user`、provider/runtime contract 或明确默认值来源派生显示。
2. WHEN 某配置项没有后端字段或不可编辑 THEN THE SYSTEM SHALL 显示“未接入 / 只读 / unsupported”及来源说明，不得显示空白破折号冒充配置值。
3. WHEN 展示“Codex 推理强度”或类似平台专项配置 THEN THE SYSTEM SHALL 只有在真实 settings schema 支持该字段时显示；否则删除该行或归入 parity planned 区。
4. WHEN 展示默认会话模型、摘要模型、Explore/Plan 子代理模型、子代理模型池、全局默认推理强度或平台专项推理强度 THEN THE SYSTEM SHALL 使用用户配置中的当前值，不得用 `modelOptions[0]` 或模型清单第一项代替当前配置。
5. WHEN 展示 AI 代理运行策略 THEN THE SYSTEM SHALL 至少为真实已接入字段提供 default permission mode、max turns、retry/backoff、first-token timeout、WebFetch proxy、context trim/compact thresholds、session behavior、debug visibility、global directory allow/deny 和 command allow/deny 的来源、当前值和可编辑性；暂未接入字段必须标 planned/unsupported。
6. WHEN 用户保存运行策略 THEN THE SYSTEM SHALL 调用真实 settings API，并在成功后重新读取设置以确认。
7. WHEN settings API 保存失败 THEN THE SYSTEM SHALL 保留本地草稿、显示错误，并提供重试或恢复服务器值。
8. WHEN 任何设置页文案包含“已接入”“可用”“启用” THEN THE SYSTEM SHALL 能追溯到 current capability、真实 provider 状态或真实账号状态。
9. WHEN NovelFork 借鉴 NarraFork 设置结构 THEN THE SYSTEM SHALL 保留“个人设置 / 实例管理 / 运行资源”这类分组意图，但不得把 NarraFork 当前字段原样硬编码到 NovelFork；每个字段必须登记 owner、source、read/write API 和 browser verification。

---

## Requirement 5：AI 供应商与平台账号页必须区分“已启用”“可导入”“可调用”

**User Story：** 作为作者，我希望知道某个平台账号或 API key 是否真的能用于生成，而不是只看到“平台已启用”。

### Acceptance Criteria

1. WHEN 平台集成 catalog 标记 enabled 但账号数为 0 THEN THE SYSTEM SHALL 显示“可导入 / 未配置账号 / 不可调用”，不得显示为“可调用”。
2. WHEN 平台集成已有 provider card 但未通过验证 THEN THE SYSTEM SHALL 显示“未验证 / 0 个模型 / 不可调用”或真实 model count，不得用平台存在性冒充运行可用。
3. WHEN API key provider 缺失 baseUrl、apiKey、可用模型或最近测试失败 THEN THE SYSTEM SHALL 在卡片和详情页显示对应 degraded/error 状态。
4. WHEN provider/model 支持 tools、vision、streaming、reasoning 或 contextWindow THEN THE SYSTEM SHALL 从真实 model inventory 展示能力标签；未知能力显示 unknown，不得补造。
5. WHEN 用户刷新模型、测试模型、启停 provider 或导入平台账号 THEN THE SYSTEM SHALL 调用真实 API 并展示成功/失败结果。
6. WHEN 密钥、token 或账号 JSON 被展示 THEN THE SYSTEM SHALL 只显示脱敏摘要，不得把 secret 写入 DOM、日志、测试快照或文档。
7. WHEN 运行策略总览展示显式模型选择、能力校验、权限模式和上下文窗口 THEN THE SYSTEM SHALL 基于真实 current/partial/unsupported 状态派生，不得固定写“已接入”。
8. WHEN 提供商列表展示总数、启用数、模型数或模型示例 THEN THE SYSTEM SHALL 说明统计口径，例如 platform integration、API key provider、enabled provider、available model / total model；不得把 imported catalog model 计入 callable model。

---

## Requirement 6：Claude Code CLI parity 必须有可审计守护矩阵

**User Story：** 作为维护者，我希望 NovelFork 对 Claude Code CLI 的借鉴有事实基线，避免把尚未实现的 CLI 能力写成 current。

### Acceptance Criteria

1. WHEN 本 spec 建立 parity 守护 THEN THE SYSTEM SHALL 新增或更新 Claude Code parity matrix，逐项标记 `current`、`partial`、`planned`、`non-goal`。
2. WHEN 矩阵记录 Claude Code 能力 THEN THE SYSTEM SHALL 覆盖 continue/resume/fork、print/headless、stream-json、permission-mode、allowed/disallowed tools、MCP、agents、plugins、worktree、Chrome/IDE/server、usage/result。
3. WHEN 矩阵记录 Claude Code 配置/权限模型 THEN THE SYSTEM SHALL 基于本地 Claude 源码和/或 CLI help 明确 `--allowedTools`、`--disallowedTools`、`--tools`、`--mcp-config`、`--permission-prompt-tool`、`--settings`、`--agents`、`--add-dir`、`--permission-mode` 与 permission rule source 的真实含义。
4. WHEN NovelFork 只实现 Web 工作台等价能力而非 CLI/TUI 原能力 THEN THE SYSTEM SHALL 标记为 `partial`，并在 notes 中说明 NovelFork 产品化差异。
5. WHEN 能力是明确 non-goal THEN THE SYSTEM SHALL 在矩阵、README 或能力文档中保持一致，不得在 UI 中显示为“已接入”。
6. WHEN 后续实现新增 parity 能力 THEN THE SYSTEM SHALL 同步更新矩阵、tests 和用户可见设置页状态。
7. WHEN 本机 CLI help、官方文档、本地 Claude 源码三者发生差异 THEN THE SYSTEM SHALL 分别记录来源、版本或文件路径、调查日期，不得混写为单一事实。

---

## Requirement 7：OpenAI Codex CLI parity 必须显式建模 sandbox 与 approval

**User Story：** 作为维护者，我希望设置页和高级模式能清楚表达 Codex CLI 式 sandbox / approval 模型，避免把 NovelFork 的 permissionMode 简化冒充完整 Codex 对标。

### Acceptance Criteria

1. WHEN 建立 Codex parity matrix THEN THE SYSTEM SHALL 覆盖 TUI、non-interactive exec、config、sandbox、approval、MCP、subagents、web search、image input、code review 和 Windows 支持等官方能力类别。
2. WHEN 对比 sandbox THEN THE SYSTEM SHALL 区分 `read-only`、`workspace-write`、`danger-full-access` 或 NovelFork 当前等价/缺失状态。
3. WHEN 对比 approval THEN THE SYSTEM SHALL 区分 suggest/auto-edit/full-auto 或当前官方 approval policy，并说明 NovelFork permissionMode/toolPolicy 与其差异。
4. WHEN NovelFork 尚无真实 sandbox 隔离 THEN THE SYSTEM SHALL 标记为 `planned` 或 `non-goal`，不得在设置页显示“Codex sandbox 已接入”。
5. WHEN NovelFork 在 Windows 原生环境运行 THEN THE SYSTEM SHALL 遵守本项目 Windows 原生约束，不要求用户切换 WSL；若某上游能力依赖不同平台，应明确为参考而非当前要求。
6. WHEN 设置页展示 Codex 相关配置 THEN THE SYSTEM SHALL 来源于 parity matrix 或真实 settings schema，而不是硬编码空值。

---

## Requirement 8：对话窗口必须透明呈现当前会话运行态

**User Story：** 作为作者，我希望对话窗口不是一个黑盒聊天框，而是像 NarraFork 一样能看到当前工作区、上下文、模型、权限、推理强度、工具调用和运行控制，避免不知道 AI 正在用什么配置行动。

### Acceptance Criteria

1. WHEN 用户打开 narrator route 或工作台右侧对话 THEN THE SYSTEM SHALL 显示当前 session 标题、绑定书籍/章节或工作目录、模型、推理强度、权限模式、消息数或最近状态。
2. WHEN session 关联到项目或工作目录 THEN THE SYSTEM SHALL 在安全脱敏前提下显示工作区/Git 状态摘要；无 Git 或不可读时显示 unavailable reason，不得留空。
3. WHEN 用户切换模型、推理强度或权限模式 THEN THE SYSTEM SHALL 调用真实 session config API，回读后更新 UI；如果该 session 不支持某项配置，控件必须 disabled 并显示原因。
4. WHEN 模型执行工具调用 THEN THE SYSTEM SHALL 显示工具名、输入摘要、耗时、状态、错误和可展开输出；长输出必须折叠，secret 必须脱敏。
5. WHEN 工具调用需要审批 THEN THE SYSTEM SHALL 显示 permission request 的工具、风险、来源规则和允许/拒绝动作，并把用户决策写入真实 pending confirmation / tool policy 流程。
6. WHEN session 正在运行 THEN THE SYSTEM SHALL 提供真实中断/停止动作和运行时状态；没有正在运行时不得显示假“思考中”。
7. WHEN session 使用上下文窗口阈值、压缩、裁剪或 checkpoint/rewind THEN THE SYSTEM SHALL 用可理解的状态提示展示当前 context usage 或相关保护动作。
8. WHEN 对话窗口借鉴 NarraFork 的 Git/容器/快照/变更面板 THEN THE SYSTEM SHALL 只展示 NovelFork 已有真实 API 能力；未实现的面板必须隐藏或标 planned，不能做静态壳。

---

## Requirement 9：真实浏览器 E2E 成为 UI 可用性的验收门

**User Story：** 作为维护者，我希望以后不能再只凭单元测试或 API 冒烟宣布 UI 可用，必须用真实浏览器路径证明核心组件工作。

### Acceptance Criteria

1. WHEN 本 spec 完成 THEN THE SYSTEM SHALL 提供至少一条浏览器 E2E 场景覆盖：打开书籍 → 点击章节 → 看到正文 → 修改 → 保存 → 刷新 → 读回。
2. WHEN 本 spec 完成 THEN THE SYSTEM SHALL 提供设置页 E2E 或 integration test，验证无账号平台不显示“可调用”、运行策略不固定“已接入”、默认模型不来自列表第一个。
3. WHEN 本 spec 完成 THEN THE SYSTEM SHALL 提供会话创建 E2E，验证从工作台动作创建 session 后 Shell 侧栏和 narrator route 状态同步。
4. WHEN 本 spec 完成 THEN THE SYSTEM SHALL 提供对话窗口 E2E，验证模型/推理/权限控件来自真实 session config、工具调用卡真实展开、运行中断按钮只在 running 状态可用。
5. WHEN 浏览器测试无法调用真实模型 THEN THE SYSTEM SHALL 使用 max-turns、mock provider failure 或 prompt-preview 边界验证 UI 行为，不虚构模型生成成功。
6. WHEN release 或验收报告声明“UI 可用” THEN THE SYSTEM SHALL 附带浏览器 E2E 命令、结果和覆盖路径。
7. WHEN 测试覆盖不到某个 UI 能力 THEN THE SYSTEM SHALL 在能力矩阵中标记未验活，不得写成已完成。

---

## Requirement 10：文档与能力矩阵必须回到真实口径

**User Story：** 作为维护者，我希望 README、能力矩阵、当前执行主线和 CHANGELOG 不再把未验活 UI、硬编码状态或 partial parity 写成完成事实。

### Acceptance Criteria

1. WHEN 本 spec 开始 THEN THE SYSTEM SHALL 在 `.kiro/specs/README.md` 登记为 active hardening spec。
2. WHEN 本 spec 完成任一任务 THEN THE SYSTEM SHALL 更新 CHANGELOG Unreleased，并区分“新增 spec / 修复 / 验证”。
3. WHEN 某 UI 功能只完成 route/API 而未完成浏览器路径 THEN THE SYSTEM SHALL 在能力矩阵标记为 partial 或 needs-browser-verification。
4. WHEN 设置页移除硬编码 THEN THE SYSTEM SHALL 更新相关 README/API 文档，说明配置项来源和不可用展示规则。
5. WHEN Claude/Codex parity 矩阵更新 THEN THE SYSTEM SHALL 明确引用来源日期和当前 NovelFork 状态。
6. WHEN NarraFork 参考材料或本地 Claude 源码被用于设计依据 THEN THE SYSTEM SHALL 在 design 或参考文档中记录具体来源，例如 7778 端口实测日期、NarraFork 参考文档路径、Claude 源码文件路径，而不是只写“参考上游”。
7. WHEN 本 spec 完成 THEN THE SYSTEM SHALL 更新测试状态文档，记录新增 E2E/集成测试数量和未覆盖项。

---

## Non-goals

1. 不在本 spec 中发布 v0.1.0、不改版本号、不打 tag、不上传 GitHub Release。
2. 不复制完整 Claude Code 终端 TUI、tmux、Chrome bridge、IDE remote-control server 或插件市场。
3. 不完整实现 Codex CLI 的本机 sandbox；本 spec 只要求建立真实状态映射和防误导 UI，是否实现 sandbox 需另开 spec。
4. 不恢复旧三栏、旧 ChatWindow、windowStore 会话事实源或任何 retired legacy 前端。
5. 不新增 mock/fake/noop provider、假账号、假模型或假“已接入”状态。
6. 不让 AI 直接覆盖正式正文；正式写入仍必须遵守候选稿、草稿、确认门、checkpoint 与 rewind 边界。
7. 不把真实模型生成质量、提示词优化或小说风格改造纳入本 spec；本 spec 聚焦 UI 真实接线、设置可信状态和 parity 守护。
