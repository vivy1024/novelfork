# Narrative Wave Memory — Requirements

**版本**: v1.0.0  
**创建日期**: 2026-06-22  
**状态**: draft（待审批）

---

## Introduction

NovelFork 当前已经具备 Jingwei（经纬资料）、RuntimeState（伏笔/知识边界/时间线/资源账本）、Scene Spec、章节摘要、预设/节拍和 Writer/Auditor/Reviser 管线，但上下文注入仍存在系统性断裂：

- `pipeline.write` 仍接收 `jingweiContext?: string`，上下文以字符串形式拼接，缺少统一可解释结构。
- 经纬读取已有 brief/category/search 和逐条降级预算能力，但未统一覆盖所有写作路径。
- 写后 `settle` 的状态变化未形成可靠的叙事事件日志；部分自动回写存在直接覆盖经纬的污染风险。
- 现有检索以规则/优先级为主，缺少 Wave Memory 式的“本地算法检索 + 离线 LLM 整合 + 生命周期管理”闭环。

本规格定义 **Narrative Wave Memory（叙事浪潮记忆）**：将经纬、大纲、章节摘要、runtime state、伏笔、事实三元组、风格规则统一为 `NarrativeContextCard`，通过多通道本地检索、预算打包、可解释诊断和写后事件日志，为长篇网文写作提供低依赖、可评估、可演进的叙事记忆引擎。

设计包含基础 MVP 与最终版设想：MVP 先实现零新 native 依赖的结构化多通道检索；中期接入 embedding exact cosine；终局吸收 Wave Memory 的 EPA、残差金字塔、脉冲传播和测地线重排。

---

## Goals

1. 建立统一 `NarrativeContextCard` 抽象，承接经纬、facts、outline、runtime state、hooks、timeline、style、scene spec 等上下文来源。
2. 提供 `buildNarrativeContext()` 作为写作、续写、审计、修订的统一上下文入口，逐步替代散落的字符串拼接。
3. 实现多通道本地检索：scene-spec、hard constraints、state、hooks、timeline、facts、FTS、style。
4. 实现 channel-aware token budget：按通道分配预算，支持 full/normal/summary/brief 逐级降级，并记录 dropped card。
5. 建立 `NarrativeEvent` 写后事件日志，LLM 只产出候选事件，程序 reducer 决定 applied/pending/rejected。
6. 明确 canon 永不自动覆盖，dynamic/reference 可按风险等级半自动应用。
7. 预留 embedding exact cosine 通道，不要求 MVP 引入 HNSW/ANN/native vector DB。
8. 终局支持叙事 tag graph、EPA、残差金字塔、脉冲传播、测地线重排。
9. 建立检索评估与诊断日志：channel latency、injected tokens、recall@budget、conflict rate、false update rate。
10. 与现有 Jingwei read-model、RuntimeState、pipeline.write、WriterAgent、ReviserAgent、ContinuityAuditor 兼容演进。

---

## Non-Goals

1. MVP 不引入外部向量数据库、Neo4j、Elasticsearch、LangChain 或 LlamaIndex。
2. MVP 不要求接入 HNSW、sqlite-vec、sqlite-vss 或其它 native ANN 依赖。
3. MVP 不让 LLM 直接查 SQL、直接改经纬、直接覆盖 canon。
4. 本规格不重写整个写作 UI；UI 只要求后续能显示诊断信息和 pending events。
5. 本规格不删除现有 `jingwei.read` / `jingweiContext` 兼容路径，必须提供渐进迁移。
6. 本规格不把 Wave Memory 的 AstrBot 人格、好感度、黑话、防骚扰系统迁入 NovelFork。
7. 本规格不以 typecheck 通过作为用户可见完成标准；写作链路需 Browser/curl/实际运行验证。

---

## Definitions

- **NarrativeContextCard**：统一上下文卡片，记录来源、内容、摘要、实体、标签、优先级、重要度、章节有效期、注入原因和 token 估算。
- **NarrativeContextPackage**：一次写作/审计/修订任务的上下文包，包含卡片、按通道格式化后的 sections 和 diagnostics。
- **Channel**：上下文来源通道，例如 hard、state、timeline、hooks、facts、style、semantic。
- **NarrativeFact**：叙事三元组 `(subject, predicate, object)`，带章节有效期、置信度、来源证据和 layer。
- **NarrativeEvent**：写后抽取的候选状态变化事件，进入 pending/applied/rejected 生命周期。
- **Wave Algorithm Layer**：终局算法层，包括 EPA、残差金字塔、脉冲传播、测地线重排。
- **MVP**：不依赖 embedding/native ANN 的 Layer 1-3 + 基础事件日志。
- **Final Version**：包含 embedding、tag graph、Wave Algorithm Layer、评估面板和调参能力的完整叙事记忆引擎。

---

## Requirements

### R1. ContextCard 统一抽象

**User Story:** 作为写作管线，我希望所有上下文来源都转成统一结构，以便排序、预算、诊断和注入可以一致处理。

#### Acceptance Criteria

1. 系统 SHALL 定义 `NarrativeContextCard` 类型，至少包含 `id`、`bookId`、`sourceType`、`sourceId`、`channel`、`title`、`content`、`brief`、`tags`、`entities`、`priority`、`importance`、`reason`、`estimatedTokens`。
2. `sourceType` SHALL 覆盖：`jingwei`、`fact`、`outline`、`chapter-summary`、`runtime-state`、`hook`、`style`、`scene-spec`。
3. `channel` SHALL 覆盖：`hard`、`state`、`timeline`、`relationship`、`hooks`、`facts`、`style`、`semantic`。
4. 每张卡片 SHALL 有 `reason`，说明为什么被召回或注入。
5. 每张卡片 SHALL 有 token 估算；缺少估算时 SHALL 使用现有 token-utils 或 fallback 估算。
6. 卡片 SHALL 支持 `validFromChapter` / `validUntilChapter`，用于避免未来信息泄露和旧状态误召回。
7. 系统 SHALL 提供从现有 JingweiReadableItem、RuntimeStateSnapshot、SceneSpec、章节摘要、hooks 转换成 ContextCard 的 adapter。

### R2. 统一上下文构建入口

**User Story:** 作为 WriterAgent/Reviser/Auditor，我希望通过一个统一函数取得上下文，而不是每条路径自己拼字符串。

#### Acceptance Criteria

1. 系统 SHALL 提供 `buildNarrativeContext(input)`。
2. `buildNarrativeContext` 输入 SHALL 包含 `bookId`、`purpose`、`chapterNumber`、`sceneSpec?`、`sceneText?`、`entities?`、`maxTokens?`。
3. `purpose` SHALL 至少支持 `write_chapter`、`continue`、`revise`、`audit`、`outline`。
4. 输出 SHALL 是 `NarrativeContextPackage`，包含 `cards`、`sections`、`diagnostics`。
5. `sections` SHALL 至少包含 `hard`、`state`、`timeline`、`hooks`、`facts`、`style`、`semantic` 字符串区块。
6. `pipeline.write` SHALL 能消费 `NarrativeContextPackage`，并兼容旧 `jingweiContext?: string`。
7. 兼容期内，旧 `jingweiContext` SHALL 被包装为一张 `sourceType=jingwei`、`channel=state` 的 ContextCard。
8. Writer/Reviser/Auditor 不应直接散落读取经纬全文；它们 SHOULD 消费 `NarrativeContextPackage` 或由调用层转换成现有 `ContextPackage.selectedContext`。

### R3. MVP 多通道检索

**User Story:** 作为作者，我希望写作前系统自动召回本章需要的设定、状态、伏笔、前情和风格约束，而不是依赖模型主动搜索。

#### Acceptance Criteria

1. MVP SHALL 实现 `scene-spec` 通道，将当前 SceneSpec 作为最高优先上下文。
2. MVP SHALL 实现 `hard` 通道，读取 canon 经纬、book_rules、写作硬约束。
3. MVP SHALL 实现 `state` 通道，读取 dynamic 经纬、runtime current state、当前角色/地点/势力状态。
4. MVP SHALL 实现 `hooks` 通道，读取 pending hooks、runtime hook state 和本章相关伏笔。
5. MVP SHALL 实现 `timeline` 通道，读取最近章节摘要、runtime timeline、前章尾部摘要。
6. MVP SHALL 实现 `facts` 通道，读取 narrative facts，并对命中实体做 1-hop 扩展。
7. MVP SHALL 实现 `fts` 通道，基于标题、别名、标签、摘要、正文进行精确匹配；若 SQLite FTS5 不可用，SHALL fallback 到 LIKE/普通索引检索。
8. MVP SHALL 实现 `style` 通道，读取预设、节拍、文风规则、合规约束。
9. 各通道 SHALL 独立失败，不阻断整体上下文构建。
10. 各通道 SHALL 在 diagnostics 中记录 `ok`、`skipped`、`timeout` 或 `error`。

### R4. Channel-aware Token Budget

**User Story:** 作为写作管线，我希望重要上下文不被低价值长文本挤掉，并能知道哪些内容因预算被降级或丢弃。

#### Acceptance Criteria

1. 系统 SHALL 提供 `packNarrativeContext(cards, budgetPolicy)`。
2. budget policy SHALL 支持按 channel 配置预算，例如 hard/state/timeline/hooks/facts/style/semantic。
3. hard channel SHALL 不可直接 drop；超预算时 SHOULD 从 full 降级到 normal/summary/brief。
4. 非 hard channel SHALL 支持 `full → normal → summary → brief → drop`。
5. 系统 SHALL 复用或兼容现有 `applyTokenBudgetWithDegradation` 思路。
6. 输出 diagnostics SHALL 包含 `totalEstimatedTokens`、`injectedTokensByChannel`、`droppedCardIds`、`degradedCardIds`。
7. 默认写作上下文预算 SHOULD 控制在 12k-16k tokens，上限不超过调用方 `maxTokens`。
8. 当 hard channel 为空时，系统 SHALL 记录 warning，但不阻断写作。

### R5. NarrativeFact 三元组与 1-hop 扩展

**User Story:** 作为写作模型，我希望系统能以结构化方式提供角色状态、关系、地点、伏笔等事实，并自动补充一跳相关信息。

#### Acceptance Criteria

1. 系统 SHALL 定义 `NarrativeFact` 数据模型，包含 `subject`、`predicate`、`object`、`layer`、`category`、`confidence`、`sourceCardId?`、`sourceChapter?`、`validFromChapter?`、`validUntilChapter?`。
2. MVP SHALL 支持从 RuntimeStateDelta、Jingwei 条目、hooks、chapter summary 生成或导入 facts。
3. facts 检索 SHALL 支持按 subject/object/predicate/category/entity 查询。
4. facts 通道 SHALL 对命中的前若干实体做 1-hop 扩展。
5. 1-hop 扩展 SHALL 有数量上限和 token 预算，避免链式膨胀。
6. facts 输出 SHALL 标明来源和有效章节范围。
7. 查询当前章节时，系统 SHALL 不返回 `validFromChapter > currentChapter - 1` 的未来事实。

### R6. FTS 精确召回

**User Story:** 作为作者，我希望人名、法宝、地点、组织、术语等精确名词能被稳定召回，不被向量语义漂移淹没。

#### Acceptance Criteria

1. 系统 SHALL 为 ContextCard 或其来源建立精确搜索能力。
2. 若 SQLite FTS5 可用，系统 SHOULD 创建/复用 FTS 表；若不可用，SHALL fallback 到 LIKE。
3. FTS/LIKE 查询 SHALL 搜索 `title`、`aliases`、`tags`、`brief`、`content`。
4. 查询词 SHALL 被 sanitize，避免 FTS MATCH 语法错误。
5. FTS 通道 SHALL 返回 matchReason。
6. FTS 结果 SHALL 与其它通道结果去重合并。

### R7. NarrativeEvent 写后事件日志

**User Story:** 作为系统，我希望写完章节后记录发生了什么，但不让 LLM 直接污染 canon 或经纬正文。

#### Acceptance Criteria

1. 系统 SHALL 定义 `NarrativeEvent` 数据模型，包含 `id`、`bookId`、`chapterNumber`、`eventType`、`subject`、`predicate`、`object`、`evidenceText`、`confidence`、`source`、`status`、`riskLevel`。
2. `eventType` SHALL 至少支持：`character_state_changed`、`relationship_changed`、`location_changed`、`hook_planted`、`hook_progressed`、`hook_resolved`、`world_fact_introduced`、`timeline_advanced`。
3. Writer settle 或写后抽取 SHALL 只生成 candidate events，不直接覆盖 canon。
4. 系统 SHALL 保存事件原文证据 `evidenceText`。
5. 系统 SHALL 根据 eventType、layer、confidence、source 判断 `riskLevel`。
6. 低风险 dynamic 事件 MAY 自动 applied。
7. canon/world_fact_introduced/重大关系变化 SHALL 默认 pending。
8. pending events SHALL 可被后续 UI 或工具批准/拒绝。
9. applied event SHALL 能生成或更新 NarrativeFact，并可驱动 runtime state / jingwei dynamic 更新。

### R8. Reducer 与安全回写

**User Story:** 作为开发者，我希望所有自动状态更新都经过 reducer 和规则校验，避免散落更新造成状态污染。

#### Acceptance Criteria

1. 系统 SHALL 提供 `applyNarrativeEvents(bookId, events)` 或等价 reducer。
2. reducer SHALL 拒绝自动应用 canon 覆盖。
3. reducer SHALL 对 dynamic 状态更新执行幂等 upsert。
4. reducer SHALL 对关系变化、世界观新增、低置信度事件保持 pending。
5. reducer SHALL 记录 applied/rejected/pending 状态变化。
6. reducer SHALL 避免同章重复事件导致重复 facts。
7. reducer SHALL 能从 applied event 更新 `lastAccessedAt` / importance / related chapter 信息。
8. reducer 错误 SHALL 不阻断章节保存，但必须记录 diagnostics。

### R9. Embedding exact cosine 中期能力

**User Story:** 作为作者，我希望当结构化/FTS 不足时，系统能基于语义相似度召回相关记忆，但不引入重型向量库。

#### Acceptance Criteria

1. 中期版 SHALL 支持为 ContextCard 存储 embedding metadata：`embeddingModelId`、`embeddingDim`、`vectorBlob`、`vectorUpdatedAt`。
2. 当 embedding provider 不可用时，semantic channel SHALL skipped，不影响其它通道。
3. 中期版 SHALL 使用 exact cosine 搜索，不要求 HNSW/ANN。
4. exact cosine SHALL 先基于 bookId/category/chapter/entity 缩小候选，再计算相似度。
5. 系统 SHALL 检查 embedding dimension 与当前模型一致；不一致时 SHALL 跳过旧 vector 或排队重算。
6. semantic 结果 SHALL 与其它通道去重合并，且不能覆盖 hard channel 优先级。
7. semantic channel SHALL 记录 latency、candidate count、hit count。

### R10. Tag Graph 终局能力

**User Story:** 作为系统，我希望在叙事实体之间建立轻量图关联，以发现未直接命中但叙事上相关的记忆。

#### Acceptance Criteria

1. 终局版 SHALL 定义 narrative tags，类型至少包括 `character`、`location`、`faction`、`item`、`event`、`hook`、`theme`、`style`、`rule`。
2. ContextCard SHALL 可关联多个 narrative tags。
3. 系统 SHALL 建立 `sourceTag -> targetTag` 的有向共现边。
4. 边权 SHOULD 综合序位势能、语义增益、残差锚定、章节近邻权重。
5. 图构建 SHALL 本地执行，不依赖外部图数据库。
6. 图重建 SHALL 支持防抖/批处理，避免每次写作全量重建。
7. 图查询 SHALL 有 hop、neighbor、energy、token 上限。

### R11. Wave Algorithm Layer 终局能力

**User Story:** 作为长篇写作系统，我希望检索不只是 top-k 相似文本，而能根据查询聚焦度、复合语义和图联想进行召回与重排。

#### Acceptance Criteria

1. 终局版 SHOULD 实现 EPA，用于判断 query 聚焦/发散程度。
2. EPA 输出 SHALL 至少包含 `logicDepth`、`entropy`。
3. 终局版 SHOULD 实现 residual pyramid，对复合 query 分层找 tag/semantic facets。
4. residual pyramid SHALL 有 `maxLevels`、`topK`、`minEnergyRatio` 配置。
5. 终局版 SHOULD 实现 spike routing，从 seed tags 沿 tag graph 扩散能量。
6. spike routing SHALL 有 `maxHops`、`firingThreshold`、`maxEmergentNodes`、`maxNeighborsPerNode` 配置。
7. 终局版 SHOULD 实现 geodesic rerank，用 graph energy 修正 semantic/local retrieval 排序。
8. Wave Algorithm Layer SHALL 可整体关闭，关闭后系统回退到 MVP/semantic 检索。
9. Wave Algorithm Layer SHALL 不影响 hard channel 的不可丢弃规则。

### R12. 评估与诊断

**User Story:** 作为开发者和作者，我希望知道系统检索了什么、为什么检索、消耗多少、哪里失败，以便调试长篇一致性问题。

#### Acceptance Criteria

1. 系统 SHALL 记录 `narrative_retrieval_log` 或等价日志。
2. 每次上下文构建 SHALL 记录 purpose、chapter、channels、latency、token、dropped/degraded counts。
3. diagnostics SHALL 包含每张卡片的 reason 和 score breakdown（MVP 可先记录核心原因，终局补完整分数）。
4. 系统 SHOULD 支持 recall@budget benchmark 数据集。
5. 系统 SHOULD 记录 conflictRate、falseUpdateRate、staleRecallRate、hardConstraintCoverage、hookContinuityRate。
6. MVP SHALL 至少落地 channelLatency、injectedTokens、droppedCardIds、degradedCardIds。
7. 用户可见写作流程 SHALL 能在调试日志或 UI 中查看本次上下文构建摘要。

### R13. 与现有 pipeline 集成

**User Story:** 作为现有写作流程，我希望引入 Narrative Wave Memory 后不破坏已有 scene.spec → pipeline.write → candidate → accept 链路。

#### Acceptance Criteria

1. `executePipelineWrite` SHALL 在写作前能调用或接收 `NarrativeContextPackage`。
2. ContextPackage selectedContext SHALL 包含 NarrativeContextPackage 格式化结果。
3. `jingweiContext?: string` SHALL 在兼容期继续可用。
4. `previousChapterTail` SHALL 被转换为 timeline/context card。
5. 写作输出 candidate metadata SHOULD 包含 retrieval diagnostics 摘要。
6. accept candidate 时，若存在 pending/applied NarrativeEvents，系统 SHALL 走 reducer 而不是直接覆盖经纬 canon。
7. 与现有 runtime-state `applyRuntimeStateDelta`、hook arbiter、timeline/knowledge checks SHALL 兼容。

### R14. 测试与验证

**User Story:** 作为项目维护者，我希望每层能力都有可验证测试，避免记忆系统看似高级但不可控。

#### Acceptance Criteria

1. MVP SHALL 有单元测试覆盖 ContextCard adapter、facts 1-hop、token budget、FTS sanitize、channel merge/dedupe、event risk classification。
2. MVP SHALL 有集成测试覆盖构造测试书 → buildNarrativeContext → pipeline.write context 注入。
3. 系统 SHALL 测试 no future chapter leakage。
4. 系统 SHALL 测试 canon event 不自动 applied。
5. 中期 semantic channel SHALL 测试 embedding dimension mismatch fallback。
6. 终局 Wave Algorithm Layer SHALL 有纯函数测试，覆盖 EPA、residual pyramid、spike routing、geodesic rerank 的 deterministic 行为。
7. 用户可见写作流程完成时 SHALL 进行 Browser 或 curl 实测，前端变更需 Browser 截图。

---

## Phasing

### Phase 1 — MVP 基础闭环

1. ContextCard 类型与 adapters。
2. `buildNarrativeContext()`。
3. 多通道检索：scene-spec、hard、state、hooks、timeline、facts、FTS、style。
4. channel-aware budget。
5. NarrativeEvent 表/模型。
6. reducer 初版：低风险 dynamic 自动应用，canon pending。
7. retrieval diagnostics 初版。
8. pipeline.write 兼容接入。

### Phase 2 — Semantic 中期版

1. ContextCard vector metadata。
2. embedding provider 接入。
3. exact cosine semantic channel。
4. dimension/modelId 校验。
5. semantic diagnostics。

### Phase 3 — Wave 终局版

1. narrative tags 与 card-tag 关系。
2. directed cooccurrence graph。
3. EPA。
4. residual pyramid。
5. spike routing。
6. geodesic rerank。
7. Wave algorithm tuning diagnostics。

### Phase 4 — Evaluation & UI

1. retrieval benchmark。
2. recall@budget/conflictRate/falseUpdateRate 统计。
3. pending events UI。
4. retrieval diagnostics UI。
5. 调参面板。

---

## Success Metrics

1. 默认写作流程通过 `buildNarrativeContext()` 注入上下文。
2. 写作上下文可解释：每张卡片有 reason，diagnostics 可查看。
3. MVP 默认不新增 native 依赖。
4. 默认写作上下文控制在 12k-16k tokens，且 hard channel 不被低优先长文本挤掉。
5. 章节写后能产生 NarrativeEvents，并且 canon/world_fact_introduced 默认 pending。
6. 已过期或未来章节事实不会被当前章节检索注入。
7. 至少一个集成测试证明 scene.spec → buildNarrativeContext → pipeline.write 可以工作。
8. 终局版 benchmark 中 recall@budget 高于纯 FTS/纯 priority baseline。

---

## Open Decisions

1. MVP 存储可以先使用 SQLite 表；若迁移风险过高，可先以 existing storage + derived views 实现，但 spec 推荐 SQLite 表。
2. embedding exact cosine 默认不开启，需配置 provider 后启用。
3. HNSW/ANN 不进入默认依赖；未来仅在数据规模证明 exact cosine 不够时评估。
