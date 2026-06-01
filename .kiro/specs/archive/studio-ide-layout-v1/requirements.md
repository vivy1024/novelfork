# Studio IDE Layout v1 Requirements

## Introduction

将 NovelFork Studio 从当前的三栏固定布局重写为 IDE 风格的可拖拽多面板布局。产品定位：**网页版 Claude Code CLI / Codex CLI，面向小说创作**。目标用户是 NarraFork 公测的开发者同行，熟悉 IDE 和 NarraFork 交互范式。

核心参考：
- **NarraFork**：叙事线/叙述者概念、套路/设置位置、对话框内 git 面板、底部输入区布局
- **Claude Code CLI/Desktop**：单栏对话流、工具调用内联、权限确认 overlay、session sidebar
- **Codex CLI/App**：exec_cell 工具卡片、approval overlay、上下文监控
- **VS Code**：可拖拽 splitview、面板折叠/关闭、多 tab 编辑器、快捷键

---

## Requirement 1：IDE 风格四区布局

**User Story：** 作为熟悉 IDE 的开发者/作者，我希望工作台像 VS Code 一样有可自由调整的多面板布局，而不是固定比例的三栏。

### Acceptance Criteria

1. WHEN 用户打开工作台 THEN THE SYSTEM SHALL 显示四个区域：左侧 Sidebar、中间内容区、右侧对话框，三者之间有可拖拽的分隔条。
2. WHEN 用户拖拽分隔条 THEN THE SYSTEM SHALL 实时调整相邻面板宽度，并持久化到 preferences。
3. WHEN 用户双击分隔条 THEN THE SYSTEM SHALL 恢复该分隔条的默认位置。
4. WHEN 用户关闭中间内容区 THEN THE SYSTEM SHALL 让右侧对话框扩展填满。
5. WHEN 用户关闭右侧对话框 THEN THE SYSTEM SHALL 让中间内容区扩展填满。
6. WHEN 用户关闭左侧 Sidebar THEN THE SYSTEM SHALL 让中间内容区和右侧对话框扩展填满。
7. WHEN 用户下次打开工作台 THEN THE SYSTEM SHALL 恢复上次的面板宽度和折叠状态。
8. WHEN 用户按 `Ctrl+B` THEN THE SYSTEM SHALL 切换左侧 Sidebar 显隐。
9. WHEN 用户按 `Ctrl+J` THEN THE SYSTEM SHALL 切换右侧对话框显隐。

---

## Requirement 2：左侧 Sidebar — 叙事线与叙述者

**User Story：** 作为作者，我希望左侧 Sidebar 像 NarraFork 一样有叙事线（书籍/章节资源树）和叙述者（会话列表）两个同级区域，底部固定套路和设置入口。

### Acceptance Criteria

1. WHEN 用户查看 Sidebar THEN THE SYSTEM SHALL 显示两个可折叠的顶级区域：叙事线、叙述者；底部固定显示套路和设置入口。
2. WHEN 用户展开叙事线 THEN THE SYSTEM SHALL 显示所有书籍节点，每本书可展开显示章节、经纬、大纲、故事文件、真相文件等子节点。
3. WHEN 用户点击叙事线中的章节/经纬/大纲节点 THEN THE SYSTEM SHALL 在中间内容区打开对应内容的 tab。
4. WHEN 用户点击叙事线中的书籍节点 THEN THE SYSTEM SHALL 展开该书并显示写书方式入口（已有功能：续写/扩写/整章生成/审校等）。
5. WHEN 用户选择写书方式开始 AI 工作 THEN THE SYSTEM SHALL 自动创建或复用绑定该书的叙述者会话，在右侧对话框打开，并由用户在此时命名该叙述者。
6. WHEN 用户点击折叠叙事线 THEN THE SYSTEM SHALL 一键折叠全部叙事线节点。
7. WHEN 用户点击叙事线标题 THEN THE SYSTEM SHALL 可打开独立全屏页面查看全部叙事线历史，支持归档管理。
8. WHEN 用户展开叙述者 THEN THE SYSTEM SHALL 显示活跃会话列表，每个会话显示名称和绑定状态。
9. WHEN 用户点击叙述者中的会话 THEN THE SYSTEM SHALL 在右侧对话框打开该会话。
10. WHEN 用户新建独立叙述者 THEN THE SYSTEM SHALL 创建空白会话，可选绑定工作目录（git 仓库），也可不绑定。
11. WHEN 独立叙述者产生第一轮对话后 THEN THE SYSTEM SHALL 由摘要模型自动生成会话名称。
12. WHEN 用户点击叙述者标题 THEN THE SYSTEM SHALL 可打开独立全屏页面查看全部叙述者历史，支持归档和清理。
13. WHEN 用户点击套路 THEN THE SYSTEM SHALL 打开套路设置页面（已有功能）。
14. WHEN 用户点击设置 THEN THE SYSTEM SHALL 打开设置页面（已有功能）。

---

## Requirement 3：中间内容区 — 多 Tab 编辑器

**User Story：** 作为作者，我希望中间内容区像 VS Code 编辑器一样支持多 tab，可以同时打开多个章节、候选稿、经纬资料。

### Acceptance Criteria

1. WHEN 用户从叙事线点击资源节点 THEN THE SYSTEM SHALL 在中间内容区打开对应 tab，如果已打开则切换到该 tab。
2. WHEN 用户打开章节 THEN THE SYSTEM SHALL 显示富文本编辑器（已有 TipTap/InkEditor）。
3. WHEN 用户打开候选稿 THEN THE SYSTEM SHALL 显示候选稿预览，支持合并/替换/另存/放弃操作。
4. WHEN 用户打开经纬资料 THEN THE SYSTEM SHALL 显示经纬详情编辑。
5. WHEN 用户打开大纲 THEN THE SYSTEM SHALL 显示 Markdown 大纲编辑器。
6. WHEN 用户打开驾驶舱快照（从对话框工具卡片点击"在画布打开"） THEN THE SYSTEM SHALL 在中间内容区新开 tab 展示。
7. WHEN tab 有未保存修改 THEN THE SYSTEM SHALL 在 tab 标题显示 dirty 标记，关闭时提示保存。
8. WHEN 用户关闭 tab THEN THE SYSTEM SHALL 关闭该 tab，如果是最后一个 tab 则显示空状态。
9. WHEN 中间内容区被关闭 THEN THE SYSTEM SHALL 保留已打开的 tab 列表，重新打开时恢复。

---

## Requirement 4：右侧对话框 — 叙述者会话 + Git 面板

**User Story：** 作为开发者/作者，我希望右侧对话框不只是聊天，而是像 NarraFork 一样集成对话流和 git 变更管理，底部固定输入区和上下文监控。

### Acceptance Criteria

#### 会话头部
1. WHEN 用户查看对话框顶部 THEN THE SYSTEM SHALL 显示会话名称、详情按钮和归档按钮。
2. WHEN 用户点击详情按钮 THEN THE SYSTEM SHALL 显示完整会话信息（agent、模型、权限、消息数、创建时间等）。
3. WHEN 用户点击归档按钮 THEN THE SYSTEM SHALL 归档当前会话（不删除历史）。

#### 对话流
4. WHEN 用户发送消息 THEN THE SYSTEM SHALL 在对话流中显示用户消息和 AI 回复，工具调用卡片内联展示（Claude Code 风格）。
5. WHEN 工具调用需要确认 THEN THE SYSTEM SHALL 在对话流中内联显示确认门（不是弹窗）。
6. WHEN 工具调用产生可视化结果（驾驶舱快照、PGI 追问、引导计划） THEN THE SYSTEM SHALL 在对话流中内联展示工具结果卡片。

#### Git 面板（对话框内视图）
7. WHEN 当前叙述者绑定了 git 仓库 THEN THE SYSTEM SHALL 在对话框内显示 git 状态栏（分支名 + 改动统计），并可切换到 git 变更视图。
8. WHEN 用户切换到 git 变更视图 THEN THE SYSTEM SHALL 在对话流位置显示变更/提交/暂存 tab 和文件列表（NarraFork 风格）。
9. WHEN 用户在 git 视图操作暂存/提交 THEN THE SYSTEM SHALL 执行对应 git 操作并更新状态。

#### 输入区（底部固定）
10. WHEN 用户查看输入区 THEN THE SYSTEM SHALL 显示上下文监控指示器（圆圈/百分比）、模型选择器、权限模式、推理强度、输入框和发送按钮。
11. WHEN 用户点击上下文监控指示器 THEN THE SYSTEM SHALL 展开显示：裁剪百分比、压缩百分比、token 用量（已用/总量）、自动裁剪开关、立即压缩按钮、清空上下文按钮。
12. WHEN 用户选择不同供应商的模型 THEN THE SYSTEM SHALL 根据该供应商/模型的能力显示对应配置项（如 Codex 的 fast 模式和推理强度、DeepSeek 的推理模式等）。
13. WHEN 没有活跃会话 THEN THE SYSTEM SHALL 显示空状态提示（从叙事线选择书籍开始工作，或新建独立会话）。

---

## Requirement 5：Git 工作目录与 Worktree 基础

**User Story：** 作为开发者，我希望每个叙事线和独立叙述者都绑定一个 git 仓库工作目录，为后续 NarraFork 的 fork/worktree/rebase/merge 工作流铺路。

### Acceptance Criteria

1. WHEN 用户创建叙事线（书籍） THEN THE SYSTEM SHALL 为该书创建或关联一个 git 仓库工作目录。
2. WHEN 用户创建独立叙述者并选择绑定目录 THEN THE SYSTEM SHALL 关联指定的 git 仓库。
3. WHEN 叙述者执行写入操作（创建章节、修改经纬等） THEN THE SYSTEM SHALL 在绑定的 git 工作目录中产生文件变更。
4. WHEN 同一叙事线打开多个叙述者 THEN THE SYSTEM SHALL 通过 git worktree 为每个叙述者创建独立工作树（后续 spec 详细设计）。
5. WHEN 用户在 git 面板提交变更 THEN THE SYSTEM SHALL 记录章节变更历史，支持随时回退。

---

## Requirement 6：面板状态持久化与快捷键

**User Story：** 作为熟悉 IDE 的用户，我希望面板状态在会话间持久化，并支持常用快捷键。

### Acceptance Criteria

1. WHEN 用户调整面板宽度/折叠状态 THEN THE SYSTEM SHALL 持久化到 user preferences。
2. WHEN 用户下次打开 THEN THE SYSTEM SHALL 恢复所有面板状态。
3. WHEN 用户按 `Ctrl+B` THEN THE SYSTEM SHALL 切换 Sidebar 显隐。
4. WHEN 用户按 `Ctrl+J` THEN THE SYSTEM SHALL 切换对话框显隐。
5. WHEN 用户按 `Ctrl+1` THEN THE SYSTEM SHALL 聚焦 Sidebar。
6. WHEN 用户按 `Ctrl+2` THEN THE SYSTEM SHALL 聚焦中间内容区。
7. WHEN 用户按 `Ctrl+3` THEN THE SYSTEM SHALL 聚焦对话框。

---

## Requirement 7：上下文管理 — Token 计数、自动压缩与裁剪

**User Story：** 作为作者，我希望长对话不会因为上下文溢出而崩溃，系统能自动管理上下文大小，并让我看到当前用量。

参考实现：Claude Code CLI 的 `compact/autoCompact.ts` + `tokens.ts` + `microCompact.ts`（源码在 `D:\DESKTOP\novelfork\claude\restored-cli-src\src`）。

### Acceptance Criteria

1. WHEN 模型返回 API 响应 THEN THE SYSTEM SHALL 从 usage 字段提取 input_tokens + output_tokens 并累计到会话 token 计数。
2. WHEN 没有 API usage 数据时 THEN THE SYSTEM SHALL 使用粗估方式（`content.length / 4`）计算 token 数。
3. WHEN 用户查看对话框输入区 THEN THE SYSTEM SHALL 显示上下文使用百分比（已用 token / 模型上下文窗口）。
4. WHEN 上下文使用达到裁剪阈值（`contextCompressionThresholdPercent`，默认 80%） THEN THE SYSTEM SHALL 自动触发 MicroCompact：将旧工具结果内容替换为摘要占位符。
5. WHEN MicroCompact 后仍超过压缩阈值（`contextTruncateTargetPercent`，默认 95%） THEN THE SYSTEM SHALL 自动触发 Full Compact：调用摘要模型生成对话摘要，替换旧消息。
6. WHEN Full Compact 完成后 THEN THE SYSTEM SHALL 恢复最近读取的章节内容和当前活跃的 guided generation 状态。
7. WHEN 用户点击"立即压缩"按钮 THEN THE SYSTEM SHALL 手动触发 Full Compact。
8. WHEN 用户点击"清空上下文"按钮 THEN THE SYSTEM SHALL 清空当前会话消息历史，保留 session 元数据。
9. WHEN 用户开启"自动裁剪"选项 THEN THE SYSTEM SHALL 在每次 API 调用前自动执行 MicroCompact + 阈值检查。
10. WHEN 消息上限 THEN THE SYSTEM SHALL 使用纯 token 驱动而非硬编码 50 条消息上限。
11. WHEN Full Compact 连续失败 3 次 THEN THE SYSTEM SHALL 熔断停止自动压缩，提示用户手动处理。

---

## Requirement 8：Agent 工具循环对齐 NarraFork

**User Story：** 作为开发者，我希望 NovelFork 的 agent 工具循环能力和 NarraFork 对齐，不被硬编码的 6 步上限卡住。

### Acceptance Criteria

1. WHEN 用户在设置 > AI 代理中配置"每条消息最大轮次" THEN THE SYSTEM SHALL 使用该值替代硬编码的 `MAX_SESSION_TOOL_LOOP_STEPS = 6`，默认值 200。
2. WHEN 工具执行失败 THEN THE SYSTEM SHALL 将失败结果回灌给模型让其自行决定下一步，而非直接停止循环。
3. WHEN 模型输出被截断（空回复或不完整） THEN THE SYSTEM SHALL 自动发送继续消息重试；非空回复由摘要模型判断是否中断。
4. WHEN 用户开启"宽松规划"模式 THEN THE SYSTEM SHALL 在 plan 权限模式下仍允许工具调用，而非全部 deny。
5. WHEN 用户开启"YOLO 跳过只读确认" THEN THE SYSTEM SHALL 在全部允许模式下不因只读工具暂停，仅对 Write 覆盖、删除和危险执行暂停。

---

## Requirement 9：AI 代理设置对齐 NarraFork

**User Story：** 作为 NarraFork 公测用户，我希望 NovelFork 的 AI 代理设置和 NarraFork 一致，不缺功能。

### Acceptance Criteria

#### 设置 > AI 代理
1. WHEN 用户打开 AI 代理设置 THEN THE SYSTEM SHALL 显示以下可编辑字段：默认权限模式、每条消息最大轮次、裁剪起始%、压缩起始%、可恢复错误最大重试次数、重试退避时间上限。
2. WHEN 用户打开 AI 代理设置 THEN THE SYSTEM SHALL 显示以下开关：翻译思考内容、Dump API 请求、默认展开推理内容、宽松规划、YOLO 跳过只读确认、智能检查输出中断、滚动自动加载更早消息、要求使用用户语言回复、显示每轮 Token 用量、显示实时 AI 输出速率。

#### 设置 > 模型
3. WHEN 用户打开模型设置 THEN THE SYSTEM SHALL 显示：默认会话模型、摘要模型（用于压缩和翻译思考）、Explore/Plan/General 子代理各自独立模型选择、子代理可用模型池、默认推理强度。
4. WHEN 用户选择 Codex 供应商的模型 THEN THE SYSTEM SHALL 额外显示 Codex 专属推理强度配置。

#### 设置 > 提供商
5. WHEN 用户打开提供商设置 THEN THE SYSTEM SHALL 保持现有功能：供应商 CRUD、API Key、平台账号、模型库存刷新/测试/启停。

#### 套路页
6. WHEN 用户打开套路页 THEN THE SYSTEM SHALL 保持现有 10 个 tab：命令、可选工具、工具权限、全局技能、项目技能、自定义子代理、全局提示词、系统提示词、MCP 工具、钩子。
7. WHEN 用户在套路页编辑工具权限 THEN THE SYSTEM SHALL 管理逐工具的 allow/deny/ask 规则，不与设置页的全局 allowlist/blocklist 冲突。

#### 边界清理
8. WHEN 设置页显示 MCP 策略和 allowlist/blocklist THEN THE SYSTEM SHALL 将这些从设置页的 AI 代理面板移除，统一由套路页的工具权限 tab 管理。

---

## Requirement 10：流式输出

**User Story：** 作为作者，我希望 AI 回复像 Claude Code / NarraFork 一样逐字流式输出，而不是等全部生成完才一次性显示。

### Acceptance Criteria

1. WHEN 模型生成回复 THEN THE SYSTEM SHALL 通过 WebSocket 逐 token 推送给前端，前端逐字渲染。
2. WHEN 模型生成工具调用 THEN THE SYSTEM SHALL 流式推送工具调用参数的构建过程。
3. WHEN 流式输出进行中 THEN THE SYSTEM SHALL 在对话框显示打字动画指示器。
4. WHEN 用户按 Escape THEN THE SYSTEM SHALL 中断当前流式输出。
5. WHEN provider adapter 不支持流式 THEN THE SYSTEM SHALL 降级为一次性返回，不报错。
6. WHEN 用户开启"显示实时 AI 输出速率" THEN THE SYSTEM SHALL 在输入区显示字符/秒指示器（3 秒滑动窗口平均）。

---

## Requirement 11：每轮 Token 用量与费用追踪

**User Story：** 作为开发者，我希望看到每轮对话消耗了多少 token，便于监控成本。

### Acceptance Criteria

1. WHEN 用户开启"显示每轮 Token 用量" THEN THE SYSTEM SHALL 在每条 AI 回复下方显示 input_tokens / output_tokens。
2. WHEN API 返回 usage 数据 THEN THE SYSTEM SHALL 累计到会话级和全局级 token 统计。
3. WHEN 用户查看会话详情 THEN THE SYSTEM SHALL 显示该会话的总 token 消耗。

---

## Requirement 12：翻译思考内容

**User Story：** 作为中文作者，我希望模型的推理/思考块能自动翻译成中文，方便理解 AI 的推理过程。

### Acceptance Criteria

1. WHEN 用户开启"翻译思考内容" THEN THE SYSTEM SHALL 在每个思考/推理块完成后调用摘要模型翻译为用户语言。
2. WHEN 翻译完成 THEN THE SYSTEM SHALL 同时保留原始内容和翻译内容，用户可切换查看。
3. WHEN 摘要模型未配置 THEN THE SYSTEM SHALL 跳过翻译，只显示原始内容。

---

## Requirement 13：搜索系统升级

**User Story：** 作为作者，我希望全文搜索能快速找到章节、经纬、大纲中的内容，而不是简单的字符串匹配。

### Acceptance Criteria

1. WHEN 用户在搜索框输入关键词 THEN THE SYSTEM SHALL 使用 SQLite FTS5 全文索引返回匹配结果，支持中文分词。
2. WHEN 搜索结果返回 THEN THE SYSTEM SHALL 按相关度排序，显示匹配片段高亮。
3. WHEN 章节/经纬/大纲内容变更 THEN THE SYSTEM SHALL 自动更新搜索索引，无需手动 rebuild。
4. WHEN 服务重启 THEN THE SYSTEM SHALL 搜索索引持久化在 SQLite 中，不丢失。

---

## Requirement 14：写作工具健康仪表盘补全

**User Story：** 作为作者，我希望健康仪表盘的所有指标都有真实数据，而不是占位符。

### Acceptance Criteria

1. WHEN 用户查看健康仪表盘 THEN THE SYSTEM SHALL 显示真实的连续性分数（从审计结果聚合）。
2. WHEN 用户查看健康仪表盘 THEN THE SYSTEM SHALL 显示真实的钩子回收率（已回收/总伏笔）。
3. WHEN 用户查看健康仪表盘 THEN THE SYSTEM SHALL 显示真实的 AI 味均值（从过滤报告聚合）。
4. WHEN 用户查看健康仪表盘 THEN THE SYSTEM SHALL 显示真实的节奏多样性（从节奏分析聚合）。

---

## Requirement 15：会话自动命名

**User Story：** 作为作者，我希望独立会话能自动生成有意义的名称，而不是"Untitled Session"。

### Acceptance Criteria

1. WHEN 独立叙述者产生第一轮对话后 THEN THE SYSTEM SHALL 调用摘要模型根据对话内容自动生成会话名称。
2. WHEN 自动命名完成 THEN THE SYSTEM SHALL 更新 sidebar 中的会话显示名称。
3. WHEN 摘要模型未配置 THEN THE SYSTEM SHALL 使用用户消息的前 30 个字符作为 fallback 名称。

---

## Requirement 16：AI 味检测前端修复

**User Story：** 作为作者，我希望工作台中的 AI 味检测面板能正常工作，而不是 404。

### Acceptance Criteria

1. WHEN 用户在工作台打开 AI 味检测面板 THEN THE SYSTEM SHALL 调用真实存在的 API 端点返回检测结果。
2. WHEN 检测完成 THEN THE SYSTEM SHALL 显示 12 特征规则评分和 7 招消味建议。

---

## Requirement 17：代理管理（网络代理）

**User Story：** 作为中国用户，我希望能为每个 AI 供应商单独配置 HTTP 代理，因为不同供应商可能需要不同的网络出口。

### Acceptance Criteria

1. WHEN 用户打开代理管理设置 THEN THE SYSTEM SHALL 显示每个平台集成（Codex/Kiro）和 API Key 供应商的代理配置。
2. WHEN 用户为某个供应商配置代理 THEN THE SYSTEM SHALL 该供应商的所有 API 请求通过指定代理发出。
3. WHEN 用户配置 WebFetch 代理 THEN THE SYSTEM SHALL WebFetch 工具的 HTTP 请求和浏览器抓取通过指定代理发出。
4. WHEN 供应商未配置代理 THEN THE SYSTEM SHALL 直连（不使用代理）。

---

## Requirement 18：终端管理

**User Story：** 作为开发者，我希望能查看和管理 agent Terminal 工具创建的所有终端进程。

### Acceptance Criteria

1. WHEN 用户打开终端管理设置 THEN THE SYSTEM SHALL 显示运行中和已退出的终端列表，包含名称、状态、进程、工作目录、创建时间。
2. WHEN 终端正在运行 THEN THE SYSTEM SHALL 支持查看终端输出和发送输入。
3. WHEN 终端已退出 THEN THE SYSTEM SHALL 支持清理已退出的终端记录。

---

## Requirement 19：模型聚合

**User Story：** 作为使用多个供应商的用户，我希望同一模型在不同供应商的条目能聚合为一个，选择时可切换供应商或自动路由。

### Acceptance Criteria

1. WHEN 用户在模型设置中添加聚合 THEN THE SYSTEM SHALL 将不同供应商的同一模型聚合为一个虚拟条目。
2. WHEN 用户选择聚合模型 THEN THE SYSTEM SHALL 支持手动切换供应商或自动路由（按可用性/延迟）。
3. WHEN 聚合中的某个供应商不可用 THEN THE SYSTEM SHALL 自动切换到其他可用供应商。

---

## Requirement 20：章节与工作区管理

**User Story：** 作为作者，我希望能管理叙事线中的工作区（git worktree），包括活跃数量限制、自动休眠和批量合并。

### Acceptance Criteria

1. WHEN 用户打开章节与工作区设置 THEN THE SYSTEM SHALL 显示最大活跃工作区数、工作区大小警告、休眠自动保存、不活跃自动休眠时间。
2. WHEN 叙事线详情页显示章节列表 THEN THE SYSTEM SHALL 每个章节对应一个 git worktree，显示状态（活跃/休眠/已合并）。
3. WHEN 用户点击批量合并 THEN THE SYSTEM SHALL 将选中的 worktree 合并回主分支。
4. WHEN 用户点击清理 THEN THE SYSTEM SHALL 删除已合并的 worktree。
5. WHEN 工作区不活跃超过设定时间 THEN THE SYSTEM SHALL 自动休眠该工作区（保存状态但释放资源）。

---

## Non-goals

1. 不实现拖拽 tab 到不同面板（VS Code 的 editor group 拆分）——第一版只支持单编辑器组。
2. 不降低门槛做新手引导——目标用户是 NarraFork 公测的开发者同行。
3. 不改变现有后端 API 的基本结构——扩展字段和新端点可以加，但不破坏已有接口。
4. 不实现 NarraFork 的 IM 网关（钉钉/飞书通知）——单机工作台用浏览器通知。
5. 不实现 NarraFork 的用户管理——单机单用户。
6. 不实现 NarraFork 的容器（Podman）——用 git worktree 替代。
7. 不实现屏幕常亮——桌面端不需要。
8. 不实现消息渲染器选择（React/PixiJS）——第一版用 React。
