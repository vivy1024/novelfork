# Memory Admin Tools — Design

## 设计原则

1. **先保主链路。** `memory.read` / `memory.graph` / `memory.events` 不改语义，只新增管理层。
2. **薄工具，厚服务。** 工具注册只负责参数与分发，核心逻辑集中到单一管理服务。
3. **默认只读，显式写删。** list/read/search/stats/export/dedup 只读；update/delete/bulk_* 才进入写删门禁。
4. **硬删优先于假软删。** 现有 schema 没有 `deleted_at`，本阶段不做软删除迁移，采用受控硬删并保留操作审计。
5. **不引入新 HTTP 面。** 所有能力通过现有 session tool registry / executor 暴露。

---

## Architecture Overview

```text
Agent / prompt
  ↓
Studio session-tool-registry
  ↓
session-tool-executor
  ↓
Novel plugin tool-registry
  ↓
Memory admin handlers
  ├─ memory.read / graph / events  → existing lore-memory-boundary-handlers
  └─ memory.list / read_entry / search / update / delete / dedup / export / stats / bulk_approve / bulk_delete → new memory-admin-handlers
  ↓
Narrative memory storage
  ├─ narrative_fact
  ├─ narrative_event
  ├─ narrative_retrieval_log
  └─ narrative_context_vector
```

The design intentionally keeps the existing narrative memory boundary module focused on write-path gating and pending-event review, while the new admin module owns management operations across records.

---

## File Layout

### 新增文件

```text
packages/novel-plugin/src/handlers/memory-admin-handlers.ts
packages/novel-plugin/src/handlers/memory-admin-handlers.test.ts
```

### 修改文件

```text
packages/novel-plugin/src/handlers/tool-registry.ts
packages/novel-plugin/src/handler-registry.ts
packages/novel-plugin/src/tool-schemas.ts
packages/studio/src/api/lib/session-tool-executor.ts
packages/studio/src/api/lib/session-tool-registry.test.ts
packages/studio/src/api/lib/session-tool-executor.test.ts
packages/novel-plugin/src/handlers/tool-registry.test.ts
packages/novel-plugin/src/handlers/lore-memory-boundary-handlers.test.ts
.docs / learning docs that describe tool boundaries
```

`lore-memory-boundary-handlers.ts` 保持原职责，不新增 list/search/update/delete 逻辑。

---

## Tool Contract Design

### 1. 读类工具

#### `memory.list`
- 输入：`bookId`，可选 `kind`、`status`、`layer`、`category`、`chapterRange`、`limit`、`offset`、`query`
- 输出：条目列表与分页信息
- 行为：聚合 facts、events、logs、vectors 的摘要视图

#### `memory.read_entry`
- 输入：`bookId`、`kind`、`id`
- 输出：单条完整对象
- 行为：返回原始行 + 派生摘要字段

#### `memory.search`
- 输入：`bookId`、`query`、可选 `kind`、`status`、`limit`
- 输出：命中列表、命中字段、相关度或匹配原因
- 行为：对 facts/events/logs/vector 元数据做文本搜索；向量内容只查元数据，不做新 embedding 计算

#### `memory.stats`
- 输入：`bookId`
- 输出：数量分布、pending/applied/rejected、layer 分布、最近更新时间、去重风险概览

#### `memory.export`
- 输入：`bookId`、可选 `kind`、`format`
- 输出：结构化导出内容
- 行为：默认导出 JSON 结构；如需 Markdown，可作为后续扩展

#### `memory.dedup`
- 输入：`bookId`、可选 `kind`、`limit`
- 输出：候选重复组
- 行为：使用标准化签名（subject/predicate/object/category/eventType/evidenceText）与近邻相似性做候选识别；不自动删除

### 2. 写删类工具

#### `memory.update`
- 输入：`bookId`、`kind`、`id`、`patch`、`reason`
- 输出：更新后的对象
- 行为：
  - `fact`：允许更新 subject/predicate/object/category/layer/confidence/evidence/source chapters/validity
  - `event`：允许更新 subject/predicate/object/evidence/confidence/status/risk/appliedAt
  - `log`、`vector`：默认拒绝

#### `memory.delete`
- 输入：`bookId`、`kind`、`id`、`reason`
- 输出：删除结果与审计摘要
- 行为：
  - `fact`、`event` 可硬删
  - `log`、`vector` 默认拒绝
  - 删除前先确认目标存在且属于指定 bookId

#### `memory.bulk_approve`
- 输入：`bookId`、`eventIds` 或 `filter`、`reason`
- 输出：成功、失败、跳过明细
- 行为：只处理 pending event；对已 applied/rejected 项跳过

#### `memory.bulk_delete`
- 输入：`bookId`、`kind`、`filter`、`limit`、`reason`
- 输出：删除结果明细
- 行为：必须显式提供筛选条件，避免无条件全删

---

## Data Access Design

### Existing storage primitives to reuse

来自 `packages/novel-plugin/src/engine/narrative-memory/storage.ts` 的现有能力：

- `ensureNarrativeMemorySchema`
- `queryNarrativeFacts`
- `insertNarrativeFact`
- `insertNarrativeEvent`
- `updateNarrativeEventStatus`
- `listPendingNarrativeEvents`
- `insertRetrievalLog`
- `queryNarrativeContextVectors`
- `getLatestNarrativeRetrievalLog`

### New service responsibilities

新管理服务不直接暴露 SQL，而是封装以下职责：

1. 统一校验 `bookId` 与 `kind`。
2. 将输入参数翻译为 facts/events/logs/vectors 的查询条件。
3. 为读类工具补充摘要字段和分页信息。
4. 为写删类工具做 confirmed-write 风险门禁和结构化审计结果。
5. 保证 `memory.events` 的 pending 审批和 `memory.bulk_approve` 语义一致。

### Recommended implementation detail

- `list/search/stats/export/dedup` 以 SQLite 查询 + 简单聚合实现。
- `update/delete` 对 `fact` 使用直接 update/delete，对 `event` 使用 status update 或硬删。
- `bulk_approve` 复用 `updateNarrativeEventStatus` 与 `applyNarrativeEvents` 的既有模式。
- `bulk_delete` 先枚举候选，再逐条执行，以便返回逐条结果。

---

## Tool Registry and Executor Wiring

### Novel plugin registry

在 `packages/novel-plugin/src/handlers/tool-registry.ts` 中新增管理工具定义，并保持现有 3 个主链路工具不变。

### Handler registry

在 `packages/novel-plugin/src/handler-registry.ts` 中把新工具映射到 `memory-admin-handlers`。

### Executor

在 `packages/studio/src/api/lib/session-tool-executor.ts` 中新增 case 分发，保持现有确认/权限/dirty-resource 逻辑不变。

### Schemas

在 `packages/novel-plugin/src/tool-schemas.ts` 中新增新工具 schema，必须显式列出：

- `bookId`
- `kind`
- `id`
- `reason`
- `filter`
- `limit`
- `offset`
- `patch`
- `format`

避免使用宽松 `additionalProperties`，继续保持 JSON schema 严格校验。

---

## Error Handling

1. 缺少 `bookId` / `kind` / `id` 时，返回结构化 invalid-input 错误。
2. 目标不存在时，返回 not-found 类错误。
3. 对 `log/vector` 的写删请求，返回 unsupported-kind 或 forbidden。
4. 批量操作中单条失败不得吞没整体结果，必须返回逐条明细。
5. `bulk_delete` 若 filter 为空或结果过大，必须拒绝并提示缩小范围。
6. 所有写删类结果必须携带 `reason` 或等价审计信息。

---

## Test Strategy

### Unit tests

新增/更新测试覆盖：

- `memory-admin-handlers` 的 list/read/search/stats/export/dedup/update/delete/bulk_approve/bulk_delete
- `tool-registry.test.ts`：确保新工具被注册，且现有三件套不变
- `session-tool-registry.test.ts`：确保 provider 可见工具包含新工具，且风险分类正确
- `session-tool-executor.test.ts`：确保新工具被分发、门禁仍生效
- `lore-memory-boundary-handlers.test.ts`：确保原主链路未被污染

### Verification expectations

- `pnpm typecheck`
- 相关单测通过
- 无需 Browser 截图，因为本 spec 不新增前端 UI
- 如后续补充文档，则需要 `docs:verify` / `docs:drift`

---

## Rollout Plan

1. 先实现 `memory-admin-handlers` 内部只读能力：list/read_entry/search/stats/export/dedup。
2. 再实现 `update/delete`，最后加 `bulk_approve/bulk_delete`。
3. 完成后补测试，确保 `memory.read/graph/events` 原语义不变。
4. 再补工具文档与学习文档。

---

## Non-Goals

- 不新增 HTTP 路由。
- 不重写前端工作区。
- 不引入软删除 schema 迁移。
- 不把管理工具合并回 `memory.events`。
- 不把 Narrative Memory 变成通用数据后台。

---

## Open Questions Resolved

1. **硬删还是软删？** 本阶段选硬删。理由：现有 schema 无 `deleted_at`，软删会引入额外迁移与回填复杂度。
2. **是否新增独立 HTTP API？** 不新增。现有 session tool registry / executor 已足够承载。
3. **是否重写主 UI？** 不重写。先把工具和执行层补齐。
