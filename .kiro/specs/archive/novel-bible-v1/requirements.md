# Requirements Document

## Introduction

本 spec 定义 NovelFork 核心作者向价值功能 **Novel Bible v1**：一份动态、结构化、AI 可消费的小说设定库。它不是静态 wiki，而是**按场景、按时间、按引用自动注入 AI 上下文**的 Bible 系统。

设计依据（见 `docs/03-代码参考/07-小说写作与AI调研.md` v1.0）：

- **4 个一等公民表**：角色 / 事件 / 设定 / 章节摘要
- **三种可见性**（借鉴 NovelCrafter Codex）：
  - `tracked`：场景文本提到条目名时才注入给 AI
  - `global`：始终对 AI 可见（文风 / 流派 / 核心规则）
  - `nested`：条目 A 引用条目 B 时自动带入 B
- **时间线纪律**：`visible_after_chapter` 防剧透
- **双哲学支持**：静态模式（Sudowrite-like）/ 动态追踪模式（NovelCrafter-like）
- **不预装大型数据库**：可由 coding-agent-workbench 按需生成（本 spec 不依赖）

前置：`storage-migration` 已完成（SQLite + drizzle 底座就绪）。

## Requirements

### Requirement 1：四张一等公民表 schema

**User Story：** 作为作者，我希望把小说设定分为「角色 / 事件 / 设定 / 章节摘要」四类各有结构化字段，这样我不用再写一份 markdown wiki 来养活 AI。

#### Acceptance Criteria

1. WHEN 作者管理角色时 THEN THE SYSTEM SHALL 提供 `bible_character` 表，包含：`id`、`book_id`、`name`、`aliases`（JSON 数组）、`role_type`（主角/配角/反派/路人）、`summary`、`traits_json`、`visibility_rule`、`first_chapter`、`last_chapter`、`created_at`、`updated_at`。
2. WHEN 作者记录事件时 THEN THE SYSTEM SHALL 提供 `bible_event` 表，包含：`id`、`book_id`、`name`、`event_type`（关键/背景/伏笔/回收）、`chapter_start`、`chapter_end`、`summary`、`related_character_ids_json`、`visibility_rule`、`foreshadow_state`（埋/暗/半明/收）。
3. WHEN 作者录入设定条目时 THEN THE SYSTEM SHALL 提供 `bible_setting` 表，包含：`id`、`book_id`、`category`（世界观/力量体系/地图/势力/金手指/背景/其他）、`name`、`content`、`visibility_rule`、`nested_refs_json`。
4. WHEN 作者保存章节摘要时 THEN THE SYSTEM SHALL 提供 `bible_chapter_summary` 表，包含：`id`、`book_id`、`chapter_number`、`title`、`summary`、`word_count`、`key_events_json`、`appearing_character_ids_json`、`pov`、`created_at`。
5. WHEN 多本书并存时 THEN THE SYSTEM SHALL 所有 bible 表按 `book_id` 隔离，不同书的条目互不可见。
6. WHEN 条目被删除时 THEN THE SYSTEM SHALL 采用软删除（`deleted_at`），AI 上下文构建时过滤软删条目。

### Requirement 2：三种可见性规则（tracked / global / nested）

**User Story：** 作为作者，我希望 Bible 条目不要全部塞进 AI 上下文把 token 耗光，而是按"场景提到才注入 / 始终可见 / 链式带入"智能取用。

#### Acceptance Criteria

1. WHEN 条目 `visibility_rule.type = "global"` 时 THEN THE SYSTEM SHALL 在构建任何 AI 写作请求的上下文时始终包含该条目。
2. WHEN 条目 `visibility_rule.type = "tracked"` 时 THEN THE SYSTEM SHALL 扫描当前章节/场景文本，若文本中出现该条目的 `name` 或 `aliases` 之一，则注入该条目；否则不注入。
3. WHEN 条目 `visibility_rule.type = "nested"` 时 THEN THE SYSTEM SHALL 递归检查被注入的条目中是否含 `nested_refs_json` 引用，若有则连带注入被引条目（防循环引用，深度上限 3）。
4. WHEN 同一条目同时被多种规则触发时 THEN THE SYSTEM SHALL 只注入一次，去重以 `id` 为准。
5. WHEN 最终 context 超出预算（默认 8000 tokens）时 THEN THE SYSTEM SHALL 按优先级 `global > nested > tracked` 丢弃超额条目，并在 debug 日志中记录丢弃清单。

### Requirement 3：时间线纪律（visible_after_chapter）

**User Story：** 作为作者，我希望写到第 10 章时，AI 不会把第 100 章才揭示的伏笔偷看过去，我需要 Bible 能按章节时间线控制可见性。

#### Acceptance Criteria

1. WHEN `visibility_rule` 包含 `visible_after_chapter: N` 时 THEN THE SYSTEM SHALL 仅在 `current_chapter >= N` 时才把该条目注入 AI 上下文。
2. WHEN `visibility_rule` 包含 `visible_until_chapter: M` 时 THEN THE SYSTEM SHALL 仅在 `current_chapter <= M` 时才注入（用于已经下线的角色/设定）。
3. WHEN AI 写作请求未传 `current_chapter` 时 THEN THE SYSTEM SHALL 默认使用该书最新章节号，并在日志中记录推断来源。
4. WHEN 作者在 UI 手动切换"时间回退"模式（回到某章节重写）时 THEN THE SYSTEM SHALL 所有 Bible 注入遵循该 `current_chapter` 设定。

### Requirement 4：双写作哲学模式切换

**User Story：** 作为作者，我希望对不同小说项目采用不同哲学：脑洞型项目用静态模式（写完塞 Bible），情节型项目用动态追踪模式（AI 自动链接 tracked）。

#### Acceptance Criteria

1. WHEN 创建新 book 时 THEN THE SYSTEM SHALL 提供 `bible_mode` 字段选项：`static`（默认，仅 global）/ `dynamic`（启用 tracked 自动注入）。
2. WHEN `bible_mode = "static"` 时 THEN THE SYSTEM SHALL 忽略 `tracked` 规则，全按 `global` + 时间线处理。
3. WHEN `bible_mode = "dynamic"` 时 THEN THE SYSTEM SHALL 启用全部三种可见性 + 自动扫描当前章节文本建立条目链接。
4. WHEN 作者随时切换 `bible_mode` 时 THEN THE SYSTEM SHALL 立即生效于下一次 AI 写作请求，不改动已有条目。

### Requirement 5：Bible 上下文构建 API

**User Story：** 作为 AI 写作管线上游，我希望有一个统一 API `buildBibleContext(bookId, chapterNumber, sceneText?)` 返回即插即用的上下文片段，不用自己拼 prompt。

#### Acceptance Criteria

1. WHEN 上游调用 `buildBibleContext(bookId, currentChapter, sceneText?)` 时 THEN THE SYSTEM SHALL 返回 `{ items: BibleContextItem[], totalTokens: number, droppedIds: string[], mode: BibleMode }`。
2. WHEN `sceneText` 缺失时 THEN THE SYSTEM SHALL 仅按 `global` + 时间线规则注入（不激活 tracked）。
3. WHEN `sceneText` 提供时 THEN THE SYSTEM SHALL 使用高效关键词匹配（Aho-Corasick 或等价算法）识别出现的 aliases，避免 O(n·m) 扫描。
4. WHEN 返回项目时 THEN THE SYSTEM SHALL 按 `type + priority` 排序：global 优先、同类按最近更新时间。
5. WHEN 内容格式化时 THEN THE SYSTEM SHALL 每条以 `【类型】名称：内容` 格式输出，便于 AI 结构化消费。

### Requirement 6：Studio UI 最小可用

**User Story：** 作为作者，我希望在 NovelFork Studio 中能直接增删改查 Bible 条目、预览 AI 注入的上下文、切换模式。

#### Acceptance Criteria

1. WHEN 作者进入某本书时 THEN THE SYSTEM SHALL 在侧栏提供「Bible」入口，下含 Characters / Events / Settings / Chapter Summaries 四个 Tab。
2. WHEN 作者新建/编辑条目时 THEN THE SYSTEM SHALL 提供结构化表单，包含可见性规则的可视化配置（下拉选择 type + 条件输入）。
3. WHEN 作者切换 `bible_mode` 时 THEN THE SYSTEM SHALL 提供书籍设置面板的切换控件，并提示模式差异。
4. WHEN 作者点击「预览 AI 上下文」时 THEN THE SYSTEM SHALL 弹出窗口展示当前章节将被注入的条目列表、token 总数、被丢弃条目及原因。
5. WHEN UI 做最小化时 THEN THE SYSTEM SHALL 不实现批量导入、版本历史、可视化关系图（留给后续 spec）。

### Requirement 7：API 契约与测试

**User Story：** 作为维护者，我希望 Bible 的 REST API 与 schema 有明确契约和回归测试，防止后续 spec 改动引入回归。

#### Acceptance Criteria

1. WHEN 设计 REST API 时 THEN THE SYSTEM SHALL 提供：`GET/POST /api/books/:bookId/bible/characters`、`GET/PUT/DELETE /api/books/:bookId/bible/characters/:id`，同样模式用于 events / settings / chapter-summaries。
2. WHEN 提供上下文预览 API 时 THEN THE SYSTEM SHALL 提供 `POST /api/books/:bookId/bible/preview-context` 入参 `{ currentChapter, sceneText? }`。
3. WHEN 运行单元测试时 THEN THE SYSTEM SHALL 覆盖：三种可见性规则、时间线过滤、nested 循环引用保护、token 预算溢出处理、bible_mode 切换。
4. WHEN 运行 E2E 测试时 THEN THE SYSTEM SHALL 验证作者从创建书到新增 Bible 条目到预览上下文的完整流程。
5. WHEN 运行 typecheck 时 THEN THE SYSTEM SHALL 无错误。

### Requirement 8：Conflict（矛盾）作为一等公民对象

**User Story：** 作为作者，我希望矛盾不再埋在 Event 里，而是独立建模，这样我、AI、auditor 都能随时追问：当前章节正面对哪些矛盾？哪些在升级？哪些该回收？否则写到 50 章矛盾会自然淡化、读者弃书。

#### Acceptance Criteria

1. WHEN 设计 Conflict schema 时 THEN THE SYSTEM SHALL 提供 `bible_conflict` 表，包含：`id`、`book_id`、`name`、`type`（external-character / external-power / external-world / internal-value / internal-fear / social-class / system-scarcity / cultural）、`scope`（main / arc / chapter / scene）、`priority` 1-5、`protagonist_side_json`、`antagonist_side_json`、`stakes`（赌注描述）、`root_cause_json`、`evolution_path_json`（章节 × 状态数组）、`resolution_state`（unborn / brewing / erupted / escalating / climax / resolved / deferred）、`resolution_chapter?`、`related_conflict_ids_json`、`visibility_rule_json`、`created_at`、`updated_at`、`deleted_at`。
2. WHEN Conflict 被 AI 注入上下文时 THEN THE SYSTEM SHALL 支持三档可见性（复用 Requirement 2）：主线 `main` 矛盾 `global`，支线 `arc` 矛盾按弧线章节范围 `tracked`，临时 `chapter` 矛盾仅本章附近。
3. WHEN 作者或 AI 更新矛盾演化时 THEN THE SYSTEM SHALL 向 `evolution_path_json` 追加 `{ chapter, state, summary, movedBy: "author" | "ai-generated" | "audit" }`，不删旧节点。
4. WHEN 某矛盾 `resolution_state = escalating` 超过 10 章未推进时 THEN THE SYSTEM SHALL 在 auditor / UI 中标记 "stalled-conflict" 警告，由作者决定推进或降级。
5. WHEN 查询某章"当前在场矛盾"时 THEN THE SYSTEM SHALL 返回满足 `chapter ∈ [evolution_path.first.chapter, resolution_chapter ?? +∞]` 且 `resolution_state ≠ resolved & deferred` 的所有 Conflict，按 priority 排序。
6. WHEN REST API 提供时 THEN THE SYSTEM SHALL 提供 `GET/POST /api/books/:bookId/bible/conflicts`、`GET/PUT/DELETE /api/books/:bookId/bible/conflicts/:id`、`GET /api/books/:bookId/bible/conflicts/active?chapter=N`。

### Requirement 9：WorldModel（世界模型）5 维结构化

**User Story：** 作为作者，我希望经济 / 社会 / 地理 / 力量体系 / 文化这 5 个维度各有结构化条目，不是扔一堆自由 markdown，这样 AI 在写涉及经济的章节时能精准取用那一层。

#### Acceptance Criteria

1. WHEN 设计 WorldModel 时 THEN THE SYSTEM SHALL 提供 `bible_world_model` 表，每本书 1 行：`id`、`book_id UNIQUE`、`economy_json`、`society_json`、`geography_json`、`power_system_json`、`culture_json`、`timeline_json`（era / years-span / key-beats）、`updated_at`。
2. WHEN `economy_json` 被设计时 THEN THE SYSTEM SHALL 包含子字段：`currency`、`scarcity`、`class_income_levels`、`trade_patterns`、`notable_commodities`。
3. WHEN `society_json` 被设计时 THEN THE SYSTEM SHALL 包含：`government_type`、`class_mobility`、`taboos`、`ethics_frame`、`key_institutions`。
4. WHEN `geography_json` 被设计时 THEN THE SYSTEM SHALL 包含：`climate_impact`、`key_regions`、`transport_constraints`、`resource_distribution`。
5. WHEN `power_system_json` 被设计时 THEN THE SYSTEM SHALL 包含：`level_tiers`、`bottleneck_resources`、`breakthrough_cost`、`system_contradictions`。
6. WHEN `culture_json` 被设计时 THEN THE SYSTEM SHALL 包含：`languages`、`religions`、`customs`、`historical_events`。
7. WHEN 任意子字段为空时 THEN THE SYSTEM SHALL 允许留空（作者可以只填力量体系不填经济），AI 上下文注入时跳过空字段。
8. WHEN `buildBibleContext` 被调用时 THEN THE SYSTEM SHALL 将 WorldModel 非空子字段以 `【世界-{维度}】{内容}` 格式注入，作为 `global` 级可见性（除非作者显式降级）。
9. WHEN WorldModel 发生编辑时 THEN THE SYSTEM SHALL 记录 `updated_at`，并触发 CoreShift 评估（见 Requirement 12）。

### Requirement 10：Premise + CharacterArc（故事基线与角色弧线）

**User Story：** 作为作者，我希望在建书时可以用引导的方式把"这本书到底在讲什么"和"主角会经历什么变化"这两件事固定下来，这样后续 20 万字都能回到这条锚。

#### Acceptance Criteria

1. WHEN 设计 Premise 时 THEN THE SYSTEM SHALL 提供 `bible_premise` 表，每本书 1 行：`book_id UNIQUE`、`logline`（一句话核心）、`theme_json`（主题关键词数组）、`tone`（基调：热血 / 沉郁 / 轻松 / 黑暗 / 治愈 / ...）、`target_readers`、`unique_hook`（差异化钩子）、`genre_tags_json`、`created_at`、`updated_at`。
2. WHEN Premise 存在时 THEN THE SYSTEM SHALL 在 `buildBibleContext` 的 `global` 段首位注入 `【基线】{logline} · 基调 {tone} · 目标读者 {target_readers}`。
3. WHEN 设计 CharacterArc 时 THEN THE SYSTEM SHALL 提供 `bible_character_arc` 表：`id`、`book_id`、`character_id`（关联 `bible_character`）、`arc_type`（成长 / 堕落 / 平移 / 反转 / 救赎）、`starting_state`、`ending_state`、`key_turning_points_json`（`[{chapter, summary}]`）、`current_position`（描述当前处于弧线哪一段）、`visibility_rule_json`（默认 `global` + tracked by character）、`deleted_at`。
4. WHEN Character 存在多个 CharacterArc 时 THEN THE SYSTEM SHALL 允许一个角色有多条并行弧（如事业弧 + 感情弧），每条独立追踪。
5. WHEN `buildBibleContext` 注入 Character 时 THEN THE SYSTEM SHALL 附加该角色"当前章节所处的 arc 位置"描述，格式 `【弧线】{character.name} 当前处于 {current_position}`。
6. WHEN REST API 提供时 THEN THE SYSTEM SHALL 提供 premise 的 `GET/PUT /api/books/:bookId/bible/premise`（唯一行，无 POST/DELETE）与 character-arc 的完整 CRUD。

### Requirement 11：引导式问卷系统（Questionnaire）

**User Story：** 作为新人作者，我面对空白输入框会卡住。我希望 NovelFork 用结构化提问一步步引导我把 Premise / 矛盾 / WorldModel / CharacterArc 建立起来，允许我随时跳过、允许 AI 基于已填项给我建议答案，也允许我一次性跳过所有问卷自己手写。

#### Acceptance Criteria

1. WHEN 设计问卷系统时 THEN THE SYSTEM SHALL 提供两张表：
   - `questionnaire_template`：`id`、`version`、`genre_tags_json`（适用流派）、`tier`（1 必答 / 2 推荐 / 3 可选）、`target_object`（premise / conflict / world-model / character-arc / character / setting）、`questions_json`（问题数组，含 `id` / `prompt` / `type`（single / multi / text / ranged-number / ai-suggest）/ `options?` / `mapping`（答案 → 目标对象字段的映射规则））、`is_builtin`、`created_at`。
   - `questionnaire_response`：`id`、`book_id`、`template_id`、`target_object_type`、`target_object_id?`（如填的是 Premise 则可空或指向该书 premise id）、`answers_json`、`status`（draft / submitted / skipped）、`answered_via`（author / ai-assisted）、`created_at`、`updated_at`。
2. WHEN NovelFork 启动时 THEN THE SYSTEM SHALL 内置至少 3 套 Tier 1 问卷模板（通用 / 玄幻 / 都市），每套含 5-8 道必答题；Tier 2 各 15-20 题；Tier 3 按维度分组共 30+ 题。
3. WHEN 作者创建新书时 THEN THE SYSTEM SHALL 在 `BookCreate` 完成后弹出 Tier 1 问卷（5-10 分钟），且明确提供"稍后再填"和"跳过全部"两个逃生出口。
4. WHEN 作者在问卷中点"AI 建议"时 THEN THE SYSTEM SHALL 调用 writer/worldbuilder agent，以已填答案 + premise + genre 为上下文生成该题候选答案，作者可以一键采纳 / 编辑 / 丢弃。
5. WHEN 问卷被提交时 THEN THE SYSTEM SHALL 根据 `questions_json[i].mapping` 规则，把答案写入对应的 `bible_*` 表；写入过程必须是事务性的（要么全成要么全不成）。
6. WHEN 作者在任何时刻打开"补答问卷"入口时 THEN THE SYSTEM SHALL 列出当前本书所有 draft / 未作答的问卷，允许继续。
7. WHEN 作者处于 `bible_mode = dynamic`（花园派）时 THEN THE SYSTEM SHALL 不主动弹 Tier 2/3 问卷，而是在每章生成完成后扫描新出现的人物/设定/矛盾，反问："要把这些固化进 Bible 吗？"作者 yes 才回填。
8. WHEN 问卷产生 QuestionResponse 时 THEN THE SYSTEM SHALL 保留原始答案（不覆盖写入 Bible 的事实），便于后续审计或重做。
9. WHEN REST API 提供时 THEN THE SYSTEM SHALL 提供 `GET /api/questionnaires?genre=&tier=`、`POST /api/books/:bookId/questionnaires/:templateId/responses`、`PUT /api/books/:bookId/questionnaires/:templateId/responses/:id`、`POST /api/books/:bookId/questionnaires/:templateId/ai-suggest?questionId=...`。

### Requirement 12：CoreShift 变更协议 + Pre-Generation Interrogation

**User Story：** 作为作者，我的 Premise / CharacterArc / 主要矛盾 / WorldModel 是可以在写作过程中调整的，但这些调整会影响已经写了的章节。我希望有一个变更协议帮我评估影响、记录历史；并且在每次 AI 写新章前，软件能用 2-3 个精准问题把我对本章的隐性判断显性化出来，让 AI 不再猜。

#### Acceptance Criteria

1. WHEN 设计 CoreShift 时 THEN THE SYSTEM SHALL 提供 `core_shift` 表：`id`、`book_id`、`target_type`（premise / character-arc / conflict / world-model / outline）、`target_id`、`from_snapshot_json`、`to_snapshot_json`、`triggered_by`（author / data-signal / continuity-audit）、`chapter_at`（在第几章提出变更）、`affected_chapters_json`（数组）、`impact_analysis_json`、`status`（proposed / accepted / rejected / applied）、`created_at`、`applied_at?`。
2. WHEN 作者修改 Premise / CharacterArc / 主线 Conflict / WorldModel 时 THEN THE SYSTEM SHALL 自动创建一条 CoreShift 记录（`status = proposed`），不立即生效。
3. WHEN CoreShift 被创建时 THEN THE SYSTEM SHALL 运行简单影响分析：
   - 扫 `bible_chapter_summary` 中引用了该对象的章节号
   - 扫 `bible_conflict.evolution_path_json` 中涉及的章节号
   - 输出 `affected_chapters_json`
4. WHEN 作者点击"接受变更"时 THEN THE SYSTEM SHALL 把 `to_snapshot` 落库（覆盖当前 Bible 对象），标记 `status = applied`、`applied_at = now`；被影响章节在 UI 列表里被标"需复核"徽章，但不自动重写。
5. WHEN 作者点击"拒绝变更"时 THEN THE SYSTEM SHALL 恢复 Bible 对象到变更前、标记 `status = rejected`；保留 CoreShift 记录供回顾。
6. WHEN 设计 Pre-Generation Interrogation（PGI）时 THEN THE SYSTEM SHALL 提供 `POST /api/books/:bookId/chapters/:chapter/pre-generation-questions` 接口，返回 2-5 个动态问题，问题由以下规则生成：
   - 若当前章有"在场矛盾"处于 `escalating` → 问"本章是否升级到 climax？"
   - 若当前章前 3 章有"埋伏笔"`foreshadow_state = buried` 且该伏笔已过预期回收章 ±3 内 → 问"是否本章回收？"
   - 若最近 3 章 auditor 检测到人设漂移 → 问"本章主角性格偏向 A 还是 B？"
   - 若 `chapter_plan[currentChapter].plannedSummary` 与 `premise.tone` 偏离 → 问"本章基调要跟大纲还是跟 premise？"
7. WHEN 作者回答 PGI 问题时 THEN THE SYSTEM SHALL 把答案以结构化形式注入下一次 writer agent 调用的 prompt，并记录到 `session_message.metadata_json.pgi_answers`。
8. WHEN 作者选择"跳过 PGI"时 THEN THE SYSTEM SHALL 走默认 Bible 注入流程，不强制；但在本章生成完后，filter 报告中会备注"本章未走 PGI"。

### Requirement 13：明确不做

**User Story：** 作为 PM，我希望本 v1 有清晰的边界，不把 v2 的工作偷渡进来。

#### Acceptance Criteria

1. WHEN 定义 v1 边界时 THEN THE SYSTEM SHALL 明确不包含：
   - Voice（文风指纹自动提取）（留给 `voice-fingerprint-v1`）
   - Continuity 连续性审计 agent（留给 `continuity-audit-v1`）
   - Outline `book_arc` / `chapter_plan` 两表（留给 `outline-v1`，与本 spec 并行但独立）
   - Reader / Subscription / 订阅曲线等 L4 市场层（留给 `feedback-ingestion-v1` / `platform-data-sync-v1`）
   - 流派模板市场 UI（留给 `template-market-v1`，但本 spec 内置最少 3 套 Tier 1 问卷模板作为 seed）
   - Bible 与 coding-agent 的联动生成（留给 `coding-agent-workbench`）
   - 多语言条目翻译
   - Bible 条目的版本历史与 diff 查看（CoreShift 只管核心对象，不管普通条目）
   - CoreShift 的自动重写已写章节功能（只标"需复核"，不自动动笔）
2. WHEN 遇到未列入 v1 的需求时 THEN THE SYSTEM SHALL 在文档中明确 defer 到哪个 spec。
