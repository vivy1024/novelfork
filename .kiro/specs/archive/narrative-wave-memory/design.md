# Narrative Wave Memory — Design

**版本**: v1.0.0  
**创建日期**: 2026-06-22  
**状态**: draft（待审批）  
**对应**: requirements.md

---

## 设计总原则

**本地算法优先**：在线检索不调用 LLM rerank，不让 LLM 自由查库。LLM 只负责写作、审计、写后语义抽取；检索、排序、预算、回写由程序控制。

**MVP 是终局架构的子集**：MVP 不做临时方案，而是实现最终 Narrative Wave Memory 的 Layer 1-3，后续 embedding 和 Wave 算法层自然叠加。

**canon 安全第一**：canon/world rules 永不自动覆盖。LLM 抽取结果必须先进入 NarrativeEvent，经过 reducer 和风险规则后才能 applied 或 pending。

**可解释优先**：每次上下文构建都必须能回答：召回了什么、为什么召回、哪个通道召回、花了多少 token、哪些被降级/丢弃。

---

## Current State

已核实相关现状：

- `packages/novel-plugin/src/engine/jingwei/types.ts` 已有 `StoryJingweiEntryRecord`、`priorityTier`、`layer`、`summaryL0`、`summaryMd`、`tags`、`aliases`、`visibilityRule`、`relatedChapterNumbers`、`relatedEntryIds`。
- `packages/novel-plugin/src/engine/jingwei/read-model/token-budget.ts` 已有 `applyTokenBudgetWithDegradation`，可复用逐条降级思想。
- `packages/novel-plugin/src/handlers/pipeline-write-service.ts` 当前 `PipelineWriteInput` 接收 `jingweiContext?: string`，再拼入 `ContextPackage.selectedContext`。
- `packages/novel-plugin/src/engine/writing-resource/service.ts` 的 `applyJingweiDeltaOnAccept` 当前可根据 candidate metadata 直接更新/创建经纬条目，但风险控制较弱。
- `packages/core/src/models/runtime-state.ts` 已有 `RuntimeStateDelta`、`knowledgeOps`、`timelineOp`、`resourceOps`、`hookOps` 等结构化状态基础。
- `packages/core/src/state/state-reducer.ts` 已有 `applyRuntimeStateDelta`，可以作为 NarrativeEvent reducer 的设计参考。

当前主要问题：

1. 上下文来源多，但没有统一 `ContextCard`。
2. `pipeline.write` 仍把经纬作为字符串注入。
3. 写后状态更新没有统一事件日志，缺少 pending/review gate。
4. 检索评估与诊断不足。
5. 终局语义联想能力尚未接入。

---

## Architecture Overview

```text
Narrative Wave Memory
  ↓
Context Sources
  ├─ Jingwei entries
  ├─ SceneSpec
  ├─ RuntimeStateSnapshot
  ├─ Chapter summaries
  ├─ Hooks / resources / timeline
  ├─ Presets / style / beat rules
  └─ NarrativeFacts / NarrativeEvents
  ↓
ContextCard Adapters
  ↓
Parallel Retrieval Channels
  ├─ scene-spec
  ├─ hard
  ├─ state
  ├─ hooks
  ├─ timeline
  ├─ facts + 1-hop
  ├─ fts
  ├─ style
  └─ semantic / wave (later)
  ↓
Merge / Dedupe / Score
  ↓
Channel-aware Budget Pack
  ↓
NarrativeContextPackage
  ↓
WriterAgent / ReviserAgent / ContinuityAuditor
  ↓
Writer settle / post-write extraction
  ↓
NarrativeEvent Log
  ↓
Reducer
  ├─ applied → NarrativeFact/runtime dynamic state
  ├─ pending → review queue
  └─ rejected → audit trail
```

---

## Module Layout

新增模块建议放在小说插件域，避免 core/studio 出现小说领域逻辑。

```text
packages/novel-plugin/src/engine/narrative-memory/
  types.ts
  context-card.ts
  build-narrative-context.ts
  channels/
    scene-spec-channel.ts
    hard-channel.ts
    state-channel.ts
    hooks-channel.ts
    timeline-channel.ts
    facts-channel.ts
    fts-channel.ts
    style-channel.ts
    semantic-channel.ts
  budget.ts
  merge.ts
  scoring.ts
  diagnostics.ts
  facts.ts
  events.ts
  reducer.ts
  storage.ts
  wave/
    epa.ts
    residual-pyramid.ts
    spike-routing.ts
    geodesic-rerank.ts
    tag-graph.ts
```

职责说明：

- `types.ts`：公开类型与 Zod schema。
- `context-card.ts`：来源 adapter 和格式化。
- `build-narrative-context.ts`：统一入口，调度通道。
- `channels/*`：每个通道只负责取候选 ContextCard，不做全局预算。
- `merge.ts`：去重、合并、冲突处理。
- `scoring.ts`：规则分数与 score breakdown。
- `budget.ts`：按 channel 预算打包。
- `diagnostics.ts`：日志与可解释输出。
- `facts.ts`：NarrativeFact 查询、1-hop 扩展。
- `events.ts`：NarrativeEvent 创建、风险分类。
- `reducer.ts`：事件应用规则。
- `storage.ts`：SQLite 表读写。
- `wave/*`：终局算法层，纯函数优先，可关闭。

---

## Core Types

### NarrativeContextCard

```ts
export type NarrativeContextSourceType =
  | "jingwei"
  | "fact"
  | "outline"
  | "chapter-summary"
  | "runtime-state"
  | "hook"
  | "style"
  | "scene-spec";

export type NarrativeContextChannel =
  | "hard"
  | "state"
  | "timeline"
  | "relationship"
  | "hooks"
  | "facts"
  | "style"
  | "semantic";

export interface NarrativeContextCard {
  readonly id: string;
  readonly bookId: string;
  readonly sourceType: NarrativeContextSourceType;
  readonly sourceId: string;
  readonly channel: NarrativeContextChannel;
  readonly title: string;
  readonly content: string;
  readonly normal?: string;
  readonly summary?: string;
  readonly brief: string;
  readonly tags: readonly string[];
  readonly entities: readonly string[];
  readonly priority: number;
  readonly importance: number;
  readonly accessCount: number;
  readonly lastAccessedAt?: string;
  readonly validFromChapter?: number;
  readonly validUntilChapter?: number;
  readonly reason: string;
  readonly estimatedTokens: number;
  readonly score?: number;
  readonly scoreBreakdown?: Record<string, number>;
}
```

### NarrativeContextPackage

```ts
export interface NarrativeContextPackage {
  readonly bookId: string;
  readonly chapterNumber?: number;
  readonly purpose: NarrativeRetrievalPurpose;
  readonly cards: readonly NarrativeContextCard[];
  readonly sections: {
    readonly hard: string;
    readonly state: string;
    readonly timeline: string;
    readonly hooks: string;
    readonly facts: string;
    readonly style: string;
    readonly semantic: string;
  };
  readonly diagnostics: NarrativeRetrievalDiagnostics;
}
```

### NarrativeFact

```ts
export interface NarrativeFact {
  readonly id: string;
  readonly bookId: string;
  readonly subject: string;
  readonly predicate: string;
  readonly object: string;
  readonly category: string;
  readonly layer: "canon" | "dynamic" | "reference";
  readonly confidence: number;
  readonly sourceType: "jingwei" | "runtime-state" | "event" | "manual" | "import";
  readonly sourceId?: string;
  readonly sourceChapter?: number;
  readonly evidenceText?: string;
  readonly validFromChapter?: number;
  readonly validUntilChapter?: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}
```

### NarrativeEvent

```ts
export type NarrativeEventStatus = "pending" | "applied" | "rejected";
export type NarrativeEventRiskLevel = "low" | "medium" | "high";

export interface NarrativeEvent {
  readonly id: string;
  readonly bookId: string;
  readonly chapterNumber: number;
  readonly eventType:
    | "character_state_changed"
    | "relationship_changed"
    | "location_changed"
    | "hook_planted"
    | "hook_progressed"
    | "hook_resolved"
    | "world_fact_introduced"
    | "timeline_advanced";
  readonly subject: string;
  readonly predicate: string;
  readonly object: string;
  readonly evidenceText: string;
  readonly confidence: number;
  readonly source: "settle" | "manual" | "import";
  readonly status: NarrativeEventStatus;
  readonly riskLevel: NarrativeEventRiskLevel;
  readonly createdAt: string;
  readonly appliedAt?: string;
}
```

---

## Storage Design

MVP SQLite 表建议：

```sql
CREATE TABLE IF NOT EXISTS narrative_fact (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  predicate TEXT NOT NULL,
  object TEXT NOT NULL,
  category TEXT NOT NULL,
  layer TEXT NOT NULL,
  confidence REAL NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT,
  source_chapter INTEGER,
  evidence_text TEXT,
  valid_from_chapter INTEGER,
  valid_until_chapter INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_narrative_fact_book_subject ON narrative_fact(book_id, subject);
CREATE INDEX IF NOT EXISTS idx_narrative_fact_book_object ON narrative_fact(book_id, object);
CREATE INDEX IF NOT EXISTS idx_narrative_fact_book_category ON narrative_fact(book_id, category);

CREATE TABLE IF NOT EXISTS narrative_event (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  chapter_number INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  subject TEXT NOT NULL,
  predicate TEXT NOT NULL,
  object TEXT NOT NULL,
  evidence_text TEXT NOT NULL,
  confidence REAL NOT NULL,
  source TEXT NOT NULL,
  status TEXT NOT NULL,
  risk_level TEXT NOT NULL,
  created_at TEXT NOT NULL,
  applied_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_narrative_event_book_chapter ON narrative_event(book_id, chapter_number);
CREATE INDEX IF NOT EXISTS idx_narrative_event_book_status ON narrative_event(book_id, status);

CREATE TABLE IF NOT EXISTS narrative_retrieval_log (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  chapter_number INTEGER,
  purpose TEXT NOT NULL,
  total_tokens INTEGER NOT NULL,
  diagnostics_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

中期表：

```sql
CREATE TABLE IF NOT EXISTS narrative_context_vector (
  card_id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  embedding_model_id TEXT NOT NULL,
  embedding_dim INTEGER NOT NULL,
  vector_blob BLOB NOT NULL,
  vector_updated_at TEXT NOT NULL
);
```

终局表：

```sql
CREATE TABLE IF NOT EXISTS narrative_tag (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  name TEXT NOT NULL,
  tag_type TEXT NOT NULL,
  frequency INTEGER NOT NULL DEFAULT 0,
  confidence REAL NOT NULL DEFAULT 1.0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(book_id, name)
);

CREATE TABLE IF NOT EXISTS narrative_card_tag (
  card_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  relevance REAL NOT NULL DEFAULT 1.0,
  PRIMARY KEY(card_id, tag_id)
);

CREATE TABLE IF NOT EXISTS narrative_tag_edge (
  source_tag_id TEXT NOT NULL,
  target_tag_id TEXT NOT NULL,
  weight REAL NOT NULL,
  edge_type TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(source_tag_id, target_tag_id, edge_type)
);
```

迁移策略：

- 所有表使用 `CREATE TABLE IF NOT EXISTS`。
- 旧书没有 narrative tables 时，系统自动创建空表并从现有经纬/runtime state 动态派生 ContextCard。
- vector 和 wave 表不是 MVP 必需；缺表时 semantic/wave 通道 skipped。

---

## buildNarrativeContext Flow

```ts
export async function buildNarrativeContext(input: BuildNarrativeContextInput): Promise<NarrativeContextPackage> {
  const channelResults = await runChannelsInParallel(input);
  const merged = mergeAndDedupe(channelResults.flatMap((r) => r.cards));
  const scored = scoreCards(merged, input);
  const packed = packNarrativeContext(scored, resolveBudgetPolicy(input));
  const sections = formatNarrativeSections(packed.cards);
  const diagnostics = buildDiagnostics(channelResults, packed);
  await persistRetrievalLog(input, diagnostics);
  return { bookId: input.bookId, chapterNumber: input.chapterNumber, purpose: input.purpose, cards: packed.cards, sections, diagnostics };
}
```

并行策略：

- 每个通道独立 `try/catch`。
- 默认单通道 timeout 2-3 秒。
- 通道失败只写 diagnostics，不阻断整体。
- hard/scene-spec 通道优先同步执行或短 timeout，避免最关键上下文缺失。

---

## Channel Design

### SceneSpec Channel

来源：`PipelineWriteInput.sceneSpec`。

输出：1-3 张卡：

- 本章标题和目标。
- 场景列表摘要。
- constraints/hard rules。

优先级：最高。

### Hard Channel

来源：

- Jingwei canon layer。
- book_rules。
- SceneSpec constraints。
- 平台合规硬规则。

规则：

- 不可直接 drop。
- 预算不足时降级到 brief。
- diagnostics 若为空，给 warning。

### State Channel

来源：

- Jingwei dynamic layer。
- RuntimeState current state。
- 角色/地点/组织当前状态。
- `validFromChapter <= currentChapter - 1` 且未过期的 NarrativeFacts。

排序：实体命中 > 章节近邻 > importance > recency。

### Hooks Channel

来源：

- Runtime hookOps / HookRecord。
- pending_hooks。
- foreshadowing 经纬分类。

功能：

- 本章涉及实体的伏笔优先。
- 长时间未提及的活跃伏笔提高 priority。

### Timeline Channel

来源：

- chapter summaries。
- runtime timeline。
- previousChapterTail。

规则：

- 默认最近 3-5 章。
- 如果 sceneSpec 引用旧事件，允许 FTS/facts 召回更早摘要。

### Facts Channel

来源：`narrative_fact`。

算法：

1. 从 sceneSpec、entities、sceneText 中抽取 query entities。
2. 查 subject/object/predicate/category。
3. 命中 fact 后，对前 N 个 subject/object 做 1-hop 扩展。
4. 按 confidence、layer、chapter proximity、importance 排序。
5. 转成 ContextCard。

防膨胀：

- 每个实体最多扩展 3 条。
- 总 fact cards 受 channel budget 限制。

### FTS Channel

来源：Jingwei、facts、chapter summaries、context cards derived view。

实现：

- 优先 SQLite FTS5。
- FTS 不可用时 LIKE fallback。
- 查询词 sanitize。
- 返回 matchReason。

### Style Channel

来源：

- presets。
- beat/rules。
- style drift hints。
- compliance constraints。

规则：

- 预算较小。
- 不允许挤占 hard/state。

### Semantic Channel（Phase 2）

来源：context vector table。

算法：

1. 获取 query embedding。
2. 候选预过滤：bookId、chapter visibility、category/entities。
3. exact cosine。
4. top results 与其它通道 merge。
5. score 不得覆盖 hard channel。

---

## Scoring and Merge

MVP score：

```text
score =
  channelBoost
  + entityMatchBoost
  + layerBoost
  + chapterProximityBoost
  + importanceBoost
  + ftsBoost
  + factConfidenceBoost
  + recencyBoost
  - tokenCostPenalty
```

建议 boost：

| 因素 | 建议 |
|---|---:|
| scene-spec | +1000 |
| hard/canon | +900 |
| current dynamic state | +600 |
| active hook | +500 |
| direct entity match | +300 |
| 1-hop fact | +150 |
| recent chapter | +100 |
| style | +50 |

去重规则：

1. 同 sourceType + sourceId 视为同源，保留高分。
2. 同 fact `(subject,predicate,object,validFrom)` 视为重复。
3. 同标题/同 entryId 的 jingwei 卡合并 reason。
4. hard 与非 hard 重复时保留 hard channel。

---

## Budget Packing

默认写作预算：

```text
hard:      4000
state:     4000
timeline:  3000
hooks:     2000
facts:     2000
style:     1000
semantic:  2000
```

MVP 可按 `maxTokens` 缩放，但 hard/state 优先。

打包流程：

1. 按 channel 分桶。
2. 每桶内部按 score 排序。
3. 每卡准备 levels：full/normal/summary/brief。
4. 调用降级预算算法。
5. 汇总 sections。
6. 如果总预算仍超，则按全局低优先 drop，hard 不 drop。

格式化要求：

```text
<hard_constraints>
- [source] title: brief/content
  reason: ...
</hard_constraints>
```

所有 section 都要显式标签，方便 Writer prompt 解析。

---

## NarrativeEvent and Reducer

写后流程：

```text
Writer settle / post-write extraction
  ↓
parse candidate events
  ↓
classify risk
  ↓
insert narrative_event
  ↓
apply reducer for low-risk events
  ↓
update narrative_fact / runtime dynamic state
  ↓
pending events wait for review
```

风险规则：

| Event | 默认风险 | 默认状态 |
|---|---|---|
| location_changed | low | applied |
| hook_progressed | low | applied |
| hook_resolved | medium | applied if confidence high |
| character_state_changed | medium | applied if dynamic + confidence high |
| relationship_changed | medium/high | pending |
| world_fact_introduced | high | pending |
| timeline_advanced | low/medium | applied |

Reducer 规则：

- canon 不自动覆盖。
- `world_fact_introduced` 必须 pending。
- 低置信度事件 pending。
- applied 事件 upsert narrative_fact。
- applied hook event 同步 runtime hook state。
- applied timeline event 同步 runtime timeline。
- 所有变更写入 diagnostics/audit trail。

---

## Pipeline Integration

### executePipelineWrite

当前：

```ts
readonly jingweiContext?: string;
```

兼容扩展：

```ts
readonly narrativeContext?: NarrativeContextPackage;
readonly jingweiContext?: string;
```

集成方式：

1. 如果调用方提供 `narrativeContext`，直接使用。
2. 如果未提供，`executePipelineWrite` 可根据 `sceneSpec` 调 `buildNarrativeContext()`。
3. 如果仅有旧 `jingweiContext`，包装成 compatibility card。
4. 将 `NarrativeContextPackage.sections` 写入现有 `ContextPackage.selectedContext`。
5. candidate metadata 记录 retrieval diagnostics 摘要。

### WriterAgent

MVP 不强制改 WriterAgent 内部结构。调用层把 NarrativeContextPackage 转成现有 `ContextPackage`：

```ts
selectedContext: [
  { source: "narrative-memory/hard", reason: "硬约束", excerpt: sections.hard },
  { source: "narrative-memory/state", reason: "当前状态", excerpt: sections.state },
  ...
]
```

这样降低侵入风险。

### Accept Flow

当前 `applyJingweiDeltaOnAccept` 可直接更新经纬。新设计：

- 若 metadata 有 `narrativeEvents`，优先走 NarrativeEvent reducer。
- 旧 `jingweiDelta` 继续兼容，但应标记 deprecated path。
- canon 更新必须 pending。

---

## Wave Algorithm Layer

终局算法从 Wave Memory 改造而来，但适配 NovelFork。

### Tag Graph

Tag 类型：

```text
character / location / faction / item / event / hook / theme / style / rule
```

边权：

```text
weight = ordinalPotential * semanticGain * residualAnchor * chapterProximity
```

- ordinalPotential：同一卡片内靠前 tags 权重更高。
- semanticGain：中等相似度最大，过近冗余、过远噪声。
- residualAnchor：不可被邻居解释的 tag 更有信息价值。
- chapterProximity：近期相关边略加权，但 canon/rule 不衰减。

### EPA

输入：query vector。输出：

```ts
{ logicDepth: number; entropy: number; dominantAxis?: number }
```

用途：

- logicDepth 高：聚焦检索，减少 spike hops 和 semantic alpha。
- entropy 高：发散检索，增加联想扩散。

### Residual Pyramid

流程：

1. 用 query vector 搜 top tags。
2. 将已解释 tag 分量从 query residual 中扣除。
3. 用 residual 继续搜下一层。
4. 输出多层 seed tags。

用途：复合章节目标的多面召回。

### Spike Routing

从 seed tags 沿 tag graph 扩散能量：

```text
seed → neighbor → emergent tags
```

限制：

- maxHops。
- firingThreshold。
- maxEmergentNodes。
- maxNeighborsPerNode。

### Geodesic Rerank

对 semantic/FTS/facts 候选进行图能量重排：

```text
finalScore = (1 - alpha) * baseScore + alpha * graphEnergy
```

hard channel 不参与降权。

---

## Diagnostics

`NarrativeRetrievalDiagnostics`：

```ts
export interface NarrativeRetrievalDiagnostics {
  readonly totalMs: number;
  readonly totalEstimatedTokens: number;
  readonly channelStats: readonly {
    readonly channel: string;
    readonly status: "ok" | "skipped" | "timeout" | "error";
    readonly latencyMs: number;
    readonly candidateCount: number;
    readonly returnedCount: number;
    readonly estimatedTokens: number;
    readonly error?: string;
  }[];
  readonly droppedCardIds: readonly string[];
  readonly degradedCards: readonly { id: string; from: string; to: string }[];
  readonly warnings: readonly string[];
}
```

MVP 要记录：

- 每通道耗时。
- 每通道候选数/返回数。
- token 总数与分通道 token。
- dropped/degraded ids。
- hard channel 空 warning。

终局补充：

- score breakdown。
- EPA entropy/logicDepth。
- spike activated tags。
- geodesic rerank alpha。

---

## Evaluation

### MVP 指标

- `injectedTokens`：本次注入 token 数。
- `channelLatency`：每通道耗时。
- `droppedCardIds`：预算丢弃情况。
- `hardConstraintCoverage`：hard channel 是否非空且包含本章相关规则。
- `futureLeakageCount`：未来章节事实误注入数量，目标 0。
- `autoAppliedHighRiskCount`：高风险事件自动应用数量，目标 0。

### Final 指标

- `recall@budget`：给定预算下关键事实召回率。
- `conflictRate`：新章节断言冲突率。
- `falseUpdateRate`：自动应用事件错误率。
- `staleRecallRate`：过期状态误召回率。
- `hookContinuityRate`：伏笔持续追踪率。

Benchmark 设计：

- 构造 10-20 个测试故事片段。
- 每个样本标注必须召回的角色状态/规则/伏笔/前情。
- 对比 baseline：priority-only、FTS-only、facts+FTS、semantic、wave。

---

## Error Handling

### 通道失败

- 记录 diagnostics。
- 不阻断上下文构建。
- hard/scene-spec 失败记录 warning。

### FTS 失败

- sanitize 后重试。
- 失败则 fallback LIKE。
- fallback 状态写入 diagnostics。

### Embedding 失败

- semantic channel skipped。
- 不影响 MVP 通道。

### Reducer 失败

- 事件保持 pending。
- candidate/accepted chapter 不回滚。
- diagnostics 记录错误。

### Vector dimension mismatch

- 不使用旧 vector。
- 标记需要 re-embed。
- 不阻断检索。

---

## Testing Strategy

### Unit Tests

- `ContextCard` adapters。
- channel merge/dedupe。
- facts 1-hop expansion。
- FTS query sanitize。
- budget degradation。
- risk classification。
- reducer：canon 不自动 applied。
- no future chapter leakage。

### Integration Tests

- 创建测试书 + 经纬 + facts + runtime state。
- 调 `buildNarrativeContext(write_chapter)`。
- 验证 sections 包含 scene-spec、hard、state、hooks、timeline。
- 调 `executePipelineWrite`，验证 selectedContext 包含 narrative-memory sections。
- 写后插入 NarrativeEvents，低风险 applied，高风险 pending。

### End-to-End Verification

用户可见链路：

```text
scene.spec → buildNarrativeContext → pipeline.write → candidate → accept → reducer
```

前端相关变更必须 Browser 截图。后端 API 可用 curl 验证。

---

## Implementation Phases

### Phase 1 — MVP

1. 新增 types/schema。
2. 新增 storage 表和迁移。
3. 实现 ContextCard adapters。
4. 实现 8 个 MVP channels。
5. 实现 merge/scoring/budget/diagnostics。
6. 接入 pipeline.write。
7. 实现 NarrativeEvent/risk/reducer 初版。
8. 写测试与最小 E2E 验证。

### Phase 2 — Semantic

1. vector metadata 表。
2. embedding provider 接入。
3. exact cosine semantic channel。
4. dimension mismatch fallback。
5. semantic tests。

### Phase 3 — Wave Algorithms

1. tag graph 表与构建。
2. semantic gain / residual map。
3. EPA。
4. residual pyramid。
5. spike routing。
6. geodesic rerank。
7. benchmark 对比。

### Phase 4 — UI/Observability

1. retrieval diagnostics UI。
2. pending events review UI。
3. benchmark/report UI。
4. hot config / tuning panel。

---

## Risks and Mitigations

| 风险 | 缓解 |
|---|---|
| 系统过大 | 分层实现，每层可独立测试和关闭 |
| LLM 抽取污染设定 | NarrativeEvent pending/reducer；canon 不自动覆盖 |
| token 膨胀 | channel budget + degradation + diagnostics |
| hidden future info leakage | validFrom/validUntil + chapter filter 单测 |
| native 依赖影响 exe | MVP/中期不用 HNSW/ANN |
| embedding provider 不稳定 | semantic channel skipped，不影响基础检索 |
| Wave 算法难调 | 所有算法可关闭，diagnostics 记录 score breakdown |
| 旧路径断裂 | 保留 jingweiContext 兼容包装 |

---

## Completion Evidence

MVP 完成不得只看 typecheck。必须提供：

1. `pnpm --dir packages/studio typecheck` 通过。
2. 相关单元/集成测试通过。
3. curl 或内部测试证明 `buildNarrativeContext` 返回各通道 diagnostics。
4. 实际 `pipeline.write` 运行时 selectedContext 包含 narrative-memory sections。
5. 写后 NarrativeEvent 低风险 applied、高风险 pending 的测试证据。
6. 如果涉及前端展示，必须 Browser 截图。

---

## Design Decision

采用“分层终局架构”：

```text
MVP = ContextCard + 多通道本地检索 + facts/FTS/timeline + Event reducer
中期 = embedding exact cosine
终局 = tag graph + EPA + residual pyramid + spike routing + geodesic rerank
```

这让 NovelFork 能先获得稳定的叙事记忆闭环，同时保留 Wave Memory 的先进算法演进空间，而不会在首轮实现中被 native 向量依赖或复杂调参阻塞。
