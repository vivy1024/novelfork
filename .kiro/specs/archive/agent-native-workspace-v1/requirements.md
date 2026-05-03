# Agent-native Workspace v1 Requirements

## Introduction

本 spec 重新确立 NovelFork 的主产品形态：**Agent-native 小说创作工作台**。工作台的第一操作面不再是传统「驾驶舱 / 经纬 / 写作」功能 Tab，而是右侧固定的「叙述者会话」。驾驶舱、引导式生成、PGI、问卷、经纬、写作、候选稿、文件预览等能力都必须先成为 Agent 可调用工具，再由 UI 作为状态、预览、确认与编辑层渲染。

本 spec 目标不是照搬 Claude Code CLI 或 NarraFork coder UI，而是复用其交互范式：

- 会话是主对象，窗口只是视图。
- 工具调用透明展示，工具结果可专用渲染。
- 引导式生成类似 Claude Code 的 Plan Mode：先调查、提问、形成计划，用户确认后再写入。
- AI 输出默认进入候选区，不直接覆盖正式正文。

## Requirement 1：工作台主布局改为「左资源 / 中画布 / 右叙述者」

**User Story：** 作为作者，我打开工作台后，希望右侧直接就是可对话的叙述者，中间显示我当前打开的章节、候选稿、经纬或素材，左侧保留应用导航并展示当前书籍资源树，而不是先寻找驾驶舱或写作 Tab。

### Acceptance Criteria

1. WHEN 用户进入工作台 THEN THE SYSTEM SHALL 使用三栏布局：左侧资源栏、中间画布区、右侧叙述者会话区。
2. WHEN 左侧资源栏渲染时 THEN THE SYSTEM SHALL 同时保留全局入口（如仪表盘、工作台、工作流、设置、套路）与当前书籍资源管理器入口。
3. WHEN 用户点击章节、候选稿、草稿、经纬条目、故事文件、素材或发布报告 THEN THE SYSTEM SHALL 在中间画布打开对应资源，而不是替换右侧叙述者会话。
4. WHEN 用户切换资源 THEN THE SYSTEM SHALL 保持右侧当前会话、输入内容、模型配置与权限模式不丢失。
5. WHEN 当前没有选中书籍 THEN THE SYSTEM SHALL 在中间画布显示书籍选择/创建入口，在右侧叙述者显示可帮助创建新书的会话入口。
6. WHEN 屏幕宽度不足以同时展示三栏 THEN THE SYSTEM SHALL 优先保留叙述者会话与中间画布，并允许资源栏折叠。

## Requirement 2：右侧叙述者会话成为主入口

**User Story：** 作为作者，我希望直接用自然语言要求系统读取设定、检查伏笔、生成下一章、整理素材，而不是在多个页面之间寻找功能按钮。

### Acceptance Criteria

1. WHEN 用户打开已有书籍工作台 THEN THE SYSTEM SHALL 自动定位或创建该书默认 writer/narrator 会话，并在右侧打开。
2. WHEN 用户创建新书成功 THEN THE SYSTEM SHALL 自然进入该书第一个可用叙述者会话，而不是只返回书籍详情页或提示用户去别处查看。
3. WHEN 用户在右侧输入自然语言请求 THEN THE SYSTEM SHALL 将请求发送到当前 NarratorSession，并保留会话消息、模型、权限、工作区与当前书籍上下文。
4. WHEN 会话断线或刷新 THEN THE SYSTEM SHALL 使用已有 session recovery 机制恢复消息、ack 边界、未完成工具调用与最近执行链。
5. WHEN 用户关闭或切换右侧会话视图 THEN THE SYSTEM SHALL 保留会话对象本身，并能从会话列表重新打开。
6. WHEN 用户在右侧会话中执行写作相关请求 THEN THE SYSTEM SHALL 默认以候选稿/草案形式产出结果，除非用户明确批准写入正式资源。

## Requirement 3：会话工具循环支持真实 tool_use / tool_result

**User Story：** 作为作者，我希望看到 Agent 实际读取了哪些材料、调用了哪些工具、生成了什么结果，而不是只看到一段无法验证的自然语言回复。

### Acceptance Criteria

1. WHEN 模型需要读取工作台状态、经纬、章节、素材或执行写作动作 THEN THE SYSTEM SHALL 支持模型发起结构化 tool_use。
2. WHEN session runtime 收到 tool_use THEN THE SYSTEM SHALL 根据工具注册表解析工具名与参数，执行工具，并将 tool_result 追加回会话上下文。
3. WHEN 工具执行中 THEN THE SYSTEM SHALL 在右侧消息流中展示 pending/running 状态。
4. WHEN 工具执行成功 THEN THE SYSTEM SHALL 在右侧消息流中展示 success 状态、耗时、关键摘要和可展开结果。
5. WHEN 工具执行失败 THEN THE SYSTEM SHALL 展示 error 状态、错误信息和安全的重试/改参入口，不伪造成功回复。
6. WHEN 工具需要写入正式资源、覆盖正文、批量改设定或产生不可逆影响 THEN THE SYSTEM SHALL 进入确认门，等待用户批准或拒绝。
7. WHEN 工具结果被确认或拒绝 THEN THE SYSTEM SHALL 将用户决定作为 tool_result 回灌给模型，使模型能继续下一步。
8. WHEN 当前模型或 provider 不支持工具调用 THEN THE SYSTEM SHALL 明确提示「当前模型不支持工具循环」，并降级到只读解释或 prompt-preview，不假装已经执行工具。

## Requirement 4：引导式生成实现为 Plan Mode 风格的会话模式

**User Story：** 作为作者，我希望系统像 Claude Code 的 plan 工具一样，先调查、追问、形成可审查的创作计划，再由我批准是否写入经纬或生成候选稿。

### Acceptance Criteria

1. WHEN 用户发出「写下一章」「生成开篇」「帮我搭设定」「整理素材成世界观」等复杂创作请求 THEN THE SYSTEM SHALL 可进入 Guided Generation Mode。
2. WHEN 进入 Guided Generation Mode THEN THE SYSTEM SHALL 限制 Agent 先执行只读调查、状态读取、问卷/PGI 生成和计划整理，不直接写入正式正文或经纬。
3. WHEN 引导式生成需要用户补充信息 THEN THE SYSTEM SHALL 以结构化问题卡片展示问题，支持用户回答、跳过、采纳 AI 建议或编辑建议。
4. WHEN 引导式生成形成计划 THEN THE SYSTEM SHALL 输出可审查的 GuidedGenerationPlan，至少包含目标、上下文来源、关键判断、拟写入经纬变更、拟生成候选稿、风险和需要确认项。
5. WHEN 用户批准 GuidedGenerationPlan THEN THE SYSTEM SHALL 退出 Guided Generation Mode，并允许 Agent 调用写入经纬、创建候选稿、更新当前焦点等执行工具。
6. WHEN 用户拒绝或要求修改 GuidedGenerationPlan THEN THE SYSTEM SHALL 保留原计划和反馈，回到计划修订状态，不执行写入工具。
7. WHEN GuidedGenerationPlan 涉及章节正文 THEN THE SYSTEM SHALL 默认创建候选稿；只有用户明确选择合并/替换/插入时才改正式章节。
8. WHEN Guided Generation Mode 完成 THEN THE SYSTEM SHALL 在会话消息 metadata 中记录计划、用户确认结果、相关工具调用和生成产物 ID，供审计与恢复使用。

## Requirement 5：驾驶舱能力工具化并在消息流中复用

**User Story：** 作为作者，我希望在对话中说「看看当前状态」就能得到驾驶舱级别的项目快照，并能继续让 Agent 展开伏笔、候选稿、风险或设定，而不是切换到单独驾驶舱 Tab。

### Acceptance Criteria

1. WHEN 用户请求查看书籍状态 THEN THE SYSTEM SHALL 调用 cockpit 工具生成结构化快照，而不是依赖右侧静态驾驶舱页面。
2. WHEN cockpit 快照返回 THEN THE SYSTEM SHALL 在右侧消息流渲染专用 CockpitSnapshotCard。
3. CockpitSnapshotCard SHALL 至少展示日更进度、章节进度、当前焦点、最近章节摘要、风险章节、待回收伏笔、最近候选稿与模型状态摘要。
4. WHEN 用户要求展开某一项 THEN THE SYSTEM SHALL 调用对应工具，例如 list_open_hooks、list_recent_candidates、list_world_settings、get_current_focus。
5. WHEN cockpit 工具发现数据缺失或未接入 THEN THE SYSTEM SHALL 显示「未接入 / 无数据 / 需要配置」状态，不使用 mock 数据冒充真实状态。
6. WHEN 原驾驶舱组件仍有复用价值 THEN THE SYSTEM SHALL 将其拆为可被消息 renderer 或中间画布复用的展示组件，而不是继续作为右侧主 Tab。

## Requirement 6：Questionnaire 与 PGI 都必须工具化

**User Story：** 作为作者，我希望问卷和生成前追问成为叙述者对话的一部分，系统能根据当前作品主动选择问题、解释原因、记录答案，并在我确认后写入经纬或生成上下文。

### Acceptance Criteria

1. WHEN Agent 需要建立书籍前提、世界模型、人物弧光或主要矛盾 THEN THE SYSTEM SHALL 可调用 questionnaire 工具列出模板、启动问卷、生成建议答案和提交答案。
2. WHEN 用户提交 questionnaire 答案 THEN THE SYSTEM SHALL 继续使用现有 mapping 机制事务化写入对应经纬/Bible 数据，并保留原始 response。
3. WHEN Agent 需要写下一章前澄清隐性判断 THEN THE SYSTEM SHALL 调用 PGI 工具生成 2-5 个生成前问题。
4. WHEN PGI 问题展示时 THEN THE SYSTEM SHALL 显示每个问题的触发原因，例如 escalating 矛盾、临近回收伏笔或大纲偏离。
5. WHEN 用户回答 PGI THEN THE SYSTEM SHALL 将答案结构化保存，并转换为 writer 可用的本章作者指示。
6. WHEN 用户跳过 PGI THEN THE SYSTEM SHALL 记录跳过状态，并在后续 filter/AI 味或质量报告中保留 pgiUsed=false 的审计信息。
7. WHEN questionnaire 或 PGI 需要 AI 建议但当前模型不可用 THEN THE SYSTEM SHALL 清楚提示需要配置支持模型，不返回虚假的建议答案。

## Requirement 7：中间画布承载打开资源与 Agent 产物

**User Story：** 作为作者，我希望 Agent 生成或读取的资源能在中间画布打开、比较和编辑，而不是全部挤在聊天气泡里。

### Acceptance Criteria

1. WHEN 用户从左侧资源树打开资源 THEN THE SYSTEM SHALL 在中间画布以合适 renderer 展示该资源。
2. WHEN Agent 创建候选稿、计划、经纬变更草案或审计报告 THEN THE SYSTEM SHALL 可在中间画布自动打开对应产物。
3. WHEN 多个资源被打开 THEN THE SYSTEM SHALL 支持 Tab 或等价的打开资源列表，避免覆盖用户当前编辑内容。
4. WHEN 资源存在未保存编辑 THEN THE SYSTEM SHALL 在切换、关闭或被 Agent 写入前提示用户保存、放弃或另存为候选。
5. WHEN 工具结果适合长文本或结构化编辑 THEN THE SYSTEM SHALL 在消息流显示摘要，并提供「在画布打开」入口。
6. WHEN Agent 需要引用当前画布资源 THEN THE SYSTEM SHALL 将当前打开资源 ID、类型和选区作为会话上下文的一部分传入。

## Requirement 8：叙事线 v1 作为 Agent 可读写的故事图谱底座

**User Story：** 作为长篇作者，我希望系统能跟踪章节、事件、冲突、伏笔、回收和人物弧光之间的关系，帮助我判断主线是否偏航、伏笔是否遗落、章节是否缺少推进。

### Acceptance Criteria

1. WHEN 叙事线 v1 建立时 THEN THE SYSTEM SHALL 定义 NarrativeLine、NarrativeNode、NarrativeEdge、StoryBeat、ConflictThread、ForeshadowThread、PayoffLink 等核心概念。
2. WHEN 系统读取已有章节摘要、经纬事件、冲突和伏笔 THEN THE SYSTEM SHALL 能生成只读叙事线快照。
3. WHEN Agent 提出新增、移动或连接叙事节点 THEN THE SYSTEM SHALL 先生成变更草案，不直接修改正式叙事线。
4. WHEN 用户批准叙事线变更 THEN THE SYSTEM SHALL 将变更写入叙事线存储，并在中间画布刷新展示。
5. WHEN 用户请求检查叙事线 THEN THE SYSTEM SHALL 可检测断线伏笔、长期未推进冲突、无回收 payoff、章节推进缺口和主线偏离风险。
6. NarrativeLine v1 SHALL 优先服务写作上下文和可视化，不在本 spec 中实现复杂自动排版、多人协作或外部平台同步。

## Requirement 9：权限、确认与非破坏性写入

**User Story：** 作为作者，我希望 AI 能主动工作，但所有可能破坏正文或核心设定的动作都必须让我确认。

### Acceptance Criteria

1. WHEN 会话权限模式为 read 或 plan THEN THE SYSTEM SHALL 阻止写入正式正文、经纬、故事文件和系统配置。
2. WHEN 会话权限模式为 edit THEN THE SYSTEM SHALL 允许非破坏性写入候选稿、草案和可回滚经纬草案；正式覆盖仍需确认。
3. WHEN 会话权限模式为 allow THEN THE SYSTEM SHALL 放行已授权工具，但仍必须遵守项目禁止事项：不写密钥、不伪造成功、不直接覆盖正式正文。
4. WHEN 工具准备执行破坏性或高风险动作 THEN THE SYSTEM SHALL 展示确认卡片，列出目标资源、变更摘要、风险和可选操作。
5. WHEN 用户拒绝确认 THEN THE SYSTEM SHALL 不执行工具，并把拒绝原因作为 tool_result 返回模型。
6. WHEN 用户批准确认 THEN THE SYSTEM SHALL 记录批准时间、会话 ID、工具名、目标资源和变更摘要。

## Requirement 10：最小可用闭环

**User Story：** 作为作者，我希望第一版就能真实完成一条「对话驱动写下一章」链路，而不是只完成界面外观。

### Acceptance Criteria

1. WHEN 用户在右侧叙述者输入「写下一章」 THEN THE SYSTEM SHALL 调用 cockpit 快照工具读取当前书状态。
2. THEN THE SYSTEM SHALL 调用 PGI 工具生成必要的生成前问题；若无问题，也要明确说明未触发原因。
3. THEN THE SYSTEM SHALL 生成 GuidedGenerationPlan，并等待用户批准。
4. WHEN 用户批准 THEN THE SYSTEM SHALL 调用候选稿生成工具，生成下一章候选稿。
5. THEN THE SYSTEM SHALL 在中间画布打开该候选稿，并在左侧资源树刷新候选稿节点。
6. THEN THE SYSTEM SHALL 在右侧会话中展示执行链：驾驶舱快照、PGI、计划、候选稿产物。
7. WHEN 任一步失败 THEN THE SYSTEM SHALL 停止后续写入，展示失败原因，并保留已完成的只读调查结果。

## Non-goals

1. 不照搬 Claude Code CLI 的 TUI 视觉实现；只复用 Plan Mode、工具循环、权限确认和消息渲染范式。
2. 不恢复旧前端或废弃路由，不为旧代码新增 shim/noop adapter。
3. 不在 v1 一次性实现完整 NarraFork 多章节/多分支/多用户协作能力。
4. 不让 AI 直接覆盖正式正文；正式章节修改必须由用户确认。
5. 不使用 mock/fake/noop 假成功填补未接能力。
6. 不在本 spec 中实现外部平台发布、读者数据同步或模板市场。