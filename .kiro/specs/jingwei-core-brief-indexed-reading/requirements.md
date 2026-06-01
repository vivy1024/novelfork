# Requirements: 经纬核心包 + 目录化按需阅读

## Introduction

当前 Jingwei（故事经纬）上下文读取仍以“构造一个完整上下文包”为主。即使已有 `mode: auto/core/relevant/full`、`priorityTier`、`visibilityRule`、token budget 等机制，模型仍容易尝试一次性读取大量条目；当经纬资料增长后，会出现全量导入/全量读取超过 token 限制、上游生成变慢或失败、模型不知道还有哪些资料可查等问题。

本规格将 Jingwei 从“全量上下文注入”升级为“核心包 + 分类目录 + 按需分页阅读”的资料系统。模型默认先读取小型核心包和经纬目录，再根据写作/审计/大纲等任务按分类逐步读取细节，避免 prompt 膨胀并提高设定命中率。

## Goals

1. 默认禁止模型依赖全量经纬注入。
2. 提供小而稳定的核心包，让模型一开始拥有故事基本盘。
3. 提供分类目录，让模型知道有哪些资料可继续读取。
4. 支持按分类、分页、预算、详情等级读取经纬条目。
5. 支持关键词搜索与相关条目展开。
6. 支持分类导入与导入报告，为大规模经纬资料建立可查索引。
7. 与 Runtime context budget 后续工作兼容，所有经纬读取结果必须可估算 token。

## Non-Goals

1. 本阶段不重写整个小说写作 pipeline。
2. 本阶段不实现完整向量检索或 GraphRAG。
3. 本阶段不强制迁移所有旧经纬字段到新表结构；允许先复用 `customFields`。
4. 本阶段不移除 `jingwei.read_context`，只将其降级为兼容层。
5. 本阶段不要求一次性完成完整 UI 可视化，但 API 结果必须支持后续 UI 展示。

## Definitions

- **核心包（Core Brief）**：每次任务开始默认读取的小型经纬摘要，预算约 2000-4000 tokens。
- **分类目录（Jingwei Index）**：按分类聚合的目录信息，包含条目数、估算 tokens、分层数量和建议使用场景。
- **分类读取（Category Read）**：模型按 `category`、分页、token budget、详情等级读取条目。
- **详情等级（Detail Level）**：`summary | normal | full`。默认读取摘要，必要时展开详情。
- **兼容层（Compatibility Layer）**：保留旧工具名 `jingwei.read_context`，但不再鼓励全量读取。

## Requirements

### R1. 核心包读取工具

**User Story:** 作为写作模型，我希望在开始写作前获得一个小型核心包和可查目录，以便理解故事基本盘而不消耗过多上下文。

#### Acceptance Criteria

1. WHEN 模型调用 `jingwei.read_brief` 并提供 `bookId` THEN 系统 SHALL 返回 `coreBrief` 和 `index`。
2. WHEN `chapterNumber` 存在 THEN 核心包 SHALL 应用章节可见性过滤。
3. WHEN `sceneText` 或 `chapterIntent` 存在 THEN 核心包 SHOULD 优先包含相关角色、地点、伏笔和当前主线。
4. 核心包 SHALL 包含 token 估算字段 `estimatedTokens`。
5. 核心包 SHALL 默认控制在配置预算内，默认预算为 4000 tokens。
6. WHEN 超出预算 THEN 系统 SHALL 省略低优先级项目，并返回 `droppedEntryIds` 与 `omittedSummary`。
7. 核心包 SHALL 不包含 reference 层长详情，除非该条目被明确标记为 core。

### R2. 分类目录

**User Story:** 作为写作模型，我希望知道经纬资料按哪些分类组织、每类有多少内容，以便决定下一步读什么。

#### Acceptance Criteria

1. `jingwei.read_brief` SHALL 返回分类目录 `index.categories`。
2. 每个分类目录项 SHALL 包含：`category`、`title`、`count`、`estimatedTokens`、`coreCount`、`relevantCount`、`referenceCount`、`updatedAt`、`recommendedWhen`。
3. WHEN 某分类为空 THEN 目录 MAY 省略该分类，除非 UI 请求包含空分类。
4. 分类目录 SHALL 能覆盖至少：`premise`、`world-model`、`characters`、`relationships`、`factions`、`locations`、`power-system`、`timeline`、`chapter-summaries`、`foreshadowing`、`conflicts`、`props`、`rules`、`reference`。
5. 目录 SHALL 不返回条目正文全文。

### R3. 分类分页读取工具

**User Story:** 作为写作模型，我希望按分类、分页和预算读取经纬细节，以便只读取当前任务需要的资料。

#### Acceptance Criteria

1. WHEN 模型调用 `jingwei.read_category` THEN 系统 SHALL 按 `category` 返回条目列表。
2. `jingwei.read_category` SHALL 支持 `page`、`limit`、`tokenBudget`。
3. `jingwei.read_category` SHALL 支持 `detailLevel: summary | normal | full`。
4. WHEN `detailLevel=summary` THEN 系统 SHALL 优先返回 `summaryMd` 或自动摘要，不返回完整长详情。
5. WHEN `detailLevel=full` 且结果超预算 THEN 系统 SHALL 返回预算内条目，并提供 `hasMore`、`nextPage`、`droppedEntryIds`。
6. 分类读取 SHALL 应用章节可见性过滤。
7. 分类读取 SHOULD 支持 `sceneText` 匹配，用于优先排序 tracked 条目。
8. 返回结果 SHALL 包含 `totalAvailable`、`returnedCount`、`estimatedTokens`、`page`、`hasMore`。

### R4. 关键词搜索工具

**User Story:** 作为写作模型，我希望按人物名、别名、关键词、标签搜索经纬，以便在缺信息时精准补读。

#### Acceptance Criteria

1. WHEN 模型调用 `jingwei.search` 并提供 `query` THEN 系统 SHALL 搜索标题、别名、标签、关键词、摘要和正文。
2. 搜索结果 SHALL 包含命中原因 `matchReason`。
3. 搜索 SHALL 支持按 `categories` 限定范围。
4. 搜索 SHALL 支持 `tokenBudget`，并在超预算时返回省略信息。
5. 搜索结果 SHOULD 按相关性、priorityTier、章节可见性排序。

### R5. 旧工具兼容

**User Story:** 作为已有 agent prompt 和旧客户端，我希望旧的 `jingwei.read_context` 仍能工作，但不会再诱导全量注入。

#### Acceptance Criteria

1. `jingwei.read_context` SHALL 继续存在。
2. WHEN `mode=auto` THEN `jingwei.read_context` SHALL 返回与 `jingwei.read_brief` 等价或兼容的核心包 + 目录摘要。
3. WHEN `mode=core` THEN `jingwei.read_context` SHALL 只返回核心包。
4. WHEN `mode=relevant` THEN `jingwei.read_context` SHALL 返回核心包和 sceneText 命中的相关条目。
5. WHEN `mode=full` THEN 系统 SHALL 不默认返回全量正文；它 SHALL 返回目录、预算警告和分页读取建议。
6. 旧返回字段 `items`、`totalTokens`、`droppedEntryIds` SHALL 尽量保持兼容，避免前端立即崩溃。

### R6. 分类导入

**User Story:** 作为作者，我希望导入大量设定时系统能自动分类、摘要和标记优先级，而不是把全部内容混成不可读的大块上下文。

#### Acceptance Criteria

1. 导入流程 SHALL 将原始资料解析成经纬条目候选。
2. 每个候选 SHALL 尝试分类到标准 category。
3. 每个候选 SHALL 生成或保留 `summaryMd`。
4. 长内容 SHALL 拆分为摘要和详情，不得只保存超长正文。
5. 每个候选 SHOULD 推断 `priorityTier`、`visibilityRule`、`aliases`、`tags`。
6. 导入完成 SHALL 生成导入报告，包含每类数量、未分类条目、疑似重复、超长已摘要条目、需要用户确认条目。
7. 未能分类的条目 SHALL 进入 `reference` 或 `unclassified`，并在报告中提示。

### R7. 数据模型兼容演进

**User Story:** 作为开发者，我希望经纬数据模型支持摘要/详情分离，同时避免一次大迁移带来的风险。

#### Acceptance Criteria

1. 系统 SHALL 支持 `summaryMd` 作为一等字段或兼容字段。
2. 第一阶段 MAY 仅新增 `summary_md` 字段，其它结构化信息存入 `customFields`。
3. 系统 SHALL 继续兼容已有 `contentMd`。
4. WHEN `summaryMd` 不存在 THEN 系统 SHALL 从 `contentMd` 生成短摘要或使用截断摘要。
5. 数据读取层 SHALL 统一输出摘要和详情，不要求调用方知道字段来源。

### R8. Agent 阅读策略

**User Story:** 作为 agent，我希望 prompt 明确告诉我先读核心包和目录，再按任务补读分类，而不是直接 full read。

#### Acceptance Criteria

1. 写作 agent prompt SHALL 指示先调用 `jingwei.read_brief`。
2. 写下一章任务 SHOULD 根据章节意图继续读取相关 `characters`、`locations`、`foreshadowing`、`chapter-summaries`。
3. 审计任务 SHOULD 优先读取 `chapter-summaries`、`foreshadowing`、`characters`、`rules`、`conflicts`。
4. 大纲任务 SHOULD 优先读取 `world-model`、`conflicts`、`foreshadowing`、`chapter-summaries`。
5. Prompt SHALL 明确禁止默认调用 full 全量读取。

### R9. Token 预算与可观察性

**User Story:** 作为开发者和作者，我希望知道经纬读取消耗了多少 token，以及哪些内容被省略。

#### Acceptance Criteria

1. 所有 Jingwei 读取工具 SHALL 返回 `estimatedTokens`。
2. 所有预算裁剪 SHALL 返回省略说明。
3. 系统 SHOULD 记录每次经纬工具调用的分类、返回条目数、估算 tokens、dropped count。
4. 前端后续 SHALL 可基于 API 结果展示每类 token 估算与读取预览。

## Success Metrics

1. 默认写作流程不再调用 full 经纬上下文。
2. 默认核心包 + 目录控制在 4000 tokens 内。
3. 大规模经纬资料下，模型可以通过分类分页读取完成任务。
4. 日志中不再因经纬全量读取导致 100k+ token prompt。
5. 用户能看到导入报告，知道资料被分到哪些分类。

## Open Questions

1. `summaryMd` 是否新增数据库字段，还是第一版全部放入 `customFields.summaryMd`？推荐：新增 `summary_md`。
2. 分类标准是否需要允许用户自定义映射？推荐：第一版内置标准分类 + fallback 到 section key。
3. 是否需要立即做 UI 导入报告页？推荐：API 先返回报告，UI 后续补齐。
