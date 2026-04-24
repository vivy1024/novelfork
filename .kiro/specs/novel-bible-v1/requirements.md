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

### Requirement 8：明确不做

**User Story：** 作为 PM，我希望本 v1 有清晰的边界，不把 v2 的工作偷渡进来。

#### Acceptance Criteria

1. WHEN 定义 v1 边界时 THEN THE SYSTEM SHALL 明确不包含：
   - 角色弧线动态 progressions（留给 `progressions-tracking`）
   - 流派模板导入（留给 `template-market-v1`）
   - Bible 与 coding-agent 的联动生成（留给 `coding-agent-workbench`）
   - 多语言条目翻译
   - 版本历史与 diff 查看
2. WHEN 遇到未列入 v1 的需求时 THEN THE SYSTEM SHALL 在文档中明确 defer 到哪个 spec。
