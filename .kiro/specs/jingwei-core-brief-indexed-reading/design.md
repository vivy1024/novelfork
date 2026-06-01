# Design: 经纬核心包 + 目录化按需阅读

## Overview

本设计将 Jingwei 上下文从“一次性构造完整上下文包”升级为“核心包 + 分类目录 + 按需分页阅读”。核心目标是解决经纬资料增长后全量导入/读取超过 token 限制的问题，同时让模型知道有哪些资料可查，并按任务逐步读取。

设计保持现有 SQLite `story_jingwei_section` / `story_jingwei_entry` 为主数据源，复用已有 `priorityTier`、`visibilityRule`、`relatedEntryIds`、`relatedChapterNumbers`、`tags`、`aliases`、`customFields`。第一阶段只建议新增 `summary_md` 字段；其它结构化分类信息可先放入 `customFields`，降低迁移风险。

## Current State

现有关键文件：

- `packages/novel-plugin/src/handlers/jingwei-read.ts`
- `packages/novel-plugin/src/engine/jingwei/context/build-jingwei-context.ts`
- `packages/novel-plugin/src/engine/jingwei/context/context-policy.ts`
- `packages/novel-plugin/src/engine/jingwei/types.ts`
- `packages/novel-plugin/src/tool-schemas.ts`
- `packages/novel-plugin/src/handlers/tool-registry.ts`

当前 `buildJingweiContext()` 流程：

1. 读取所有 AI 可用分区和条目。
2. 按章节可见性过滤。
3. global 全量纳入。
4. tracked 依赖 `sceneText` 命中标题、别名、关键词。
5. nested 依赖关联递归纳入。
6. `full` 模式额外纳入非 nested reference。
7. 统一排序后按 tokenBudget 裁剪。

问题：

- 输出仍是扁平 items 包。
- 分类目录缺失。
- `categories` 参数当前没有实际贯穿到构建层。
- `full` 模式仍容易诱导大上下文。
- 条目没有一等摘要字段，长内容只能整体裁剪。

## Architecture

### High-Level Flow

```text
Agent task begins
  ↓
jingwei.read_brief(bookId, chapterNumber, sceneText, chapterIntent)
  ↓
返回 Core Brief + Jingwei Index
  ↓
Agent 根据任务选择分类
  ↓
jingwei.read_category(category, page, tokenBudget, detailLevel)
  ↓
必要时 jingwei.search(query)
  ↓
写作/审计/大纲继续执行
```

### New Modules

建议新增：

```text
packages/novel-plugin/src/engine/jingwei/read-model/
  category-map.ts
  entry-summary.ts
  build-jingwei-index.ts
  build-jingwei-brief.ts
  read-jingwei-category.ts
  search-jingwei.ts
  token-budget.ts
```

职责：

- `category-map.ts`：标准分类映射和 fallback 规则。
- `entry-summary.ts`：统一取得 `summaryMd`、`detailMd`、fallback 摘要。
- `build-jingwei-index.ts`：构建分类目录。
- `build-jingwei-brief.ts`：构建核心包。
- `read-jingwei-category.ts`：分类分页读取。
- `search-jingwei.ts`：关键词检索。
- `token-budget.ts`：估算 tokens、预算裁剪、分页统计。

### New Handlers

建议新增或扩展：

```text
packages/novel-plugin/src/handlers/jingwei-brief.ts
packages/novel-plugin/src/handlers/jingwei-category.ts
packages/novel-plugin/src/handlers/jingwei-search.ts
```

旧 `jingwei-read.ts` 保留，作为兼容层调用新模块。

## Data Model

### Minimal Migration

新增迁移：

```sql
ALTER TABLE story_jingwei_entry ADD COLUMN summary_md TEXT;
```

字段策略：

- `summary_md`：模型默认读取的短摘要。
- `content_md`：现有详情正文，继续保留。
- `custom_fields`：暂存扩展结构：

```json
{
  "category": "characters",
  "subtype": "protagonist",
  "importance": 90,
  "lifecycle": "active",
  "scope": "book",
  "canonicalFacts": ["..."],
  "readHints": ["写主角心理变化时读取"],
  "lastReferencedChapter": 12
}
```

### Type Additions

在 `types.ts` 增加：

```ts
export type JingweiReadCategory =
  | "premise"
  | "world-model"
  | "characters"
  | "relationships"
  | "factions"
  | "locations"
  | "power-system"
  | "timeline"
  | "chapter-summaries"
  | "foreshadowing"
  | "conflicts"
  | "props"
  | "rules"
  | "reference"
  | "unclassified";

export type JingweiDetailLevel = "summary" | "normal" | "full";
```

核心返回类型：

```ts
export interface JingweiBriefResult {
  ok: true;
  bookId: string;
  coreBrief: JingweiReadableBlock;
  index: JingweiIndex;
  recommendedReads: JingweiReadRecommendation[];
  estimatedTokens: number;
  droppedEntryIds: string[];
  omittedSummary?: string;
}

export interface JingweiIndexCategory {
  category: JingweiReadCategory;
  title: string;
  count: number;
  estimatedTokens: number;
  coreCount: number;
  relevantCount: number;
  referenceCount: number;
  updatedAt: string | null;
  recommendedWhen: string;
}
```

## Category Resolution

分类优先级：

1. `customFields.category`
2. `section.builtinKind`
3. `section.key`
4. `tags`
5. 规则 fallback
6. `reference` 或 `unclassified`

初始映射：

| Source | Category |
| --- | --- |
| premise | premise |
| world-model | world-model |
| character / people | characters |
| relationship | relationships |
| faction | factions |
| geography / location | locations |
| power / cultivation / ability | power-system |
| timeline / event | timeline |
| chapter-summary | chapter-summaries |
| foreshadowing | foreshadowing |
| conflict | conflicts |
| prop / item / resource | props |
| rule / taboo / style | rules |
| unknown | reference |

## Core Brief Construction

`buildJingweiBrief(input)` 输入：

```ts
interface BuildJingweiBriefInput {
  bookId: string;
  chapterNumber?: number;
  sceneText?: string;
  chapterIntent?: string;
  tokenBudget?: number; // default 4000
}
```

核心包候选来源：

1. `priorityTier=core`
2. 核心分区：`premise`、`world-model`、`core-memory`
3. 当前章节附近摘要：最近 3-5 章
4. 当前 sceneText / chapterIntent 命中的角色、地点、势力、伏笔
5. 活跃矛盾和高优先级未解决伏笔
6. 最近更新且明确参与 AI 的核心记忆

排序权重：

```text
core tier > scene/chapterIntent match > active lifecycle > related chapter proximity > recency > section order
```

预算策略：

- 默认 4000 tokens。
- 每条默认使用 summary。
- 若 summary 不存在，用 `contentMd` 的短截断摘要。
- 超预算时先丢 reference，再丢 relevant，尽量保留 core。
- 返回 dropped ids 和 omitted summary。

## Category Read

`readJingweiCategory(input)` 输入：

```ts
interface ReadJingweiCategoryInput {
  bookId: string;
  category: JingweiReadCategory;
  chapterNumber?: number;
  sceneText?: string;
  page?: number;
  limit?: number;
  tokenBudget?: number;
  detailLevel?: JingweiDetailLevel;
}
```

输出：

```ts
interface JingweiCategoryReadResult {
  ok: true;
  bookId: string;
  category: JingweiReadCategory;
  items: JingweiReadableItem[];
  page: number;
  limit: number;
  totalAvailable: number;
  returnedCount: number;
  hasMore: boolean;
  nextPage?: number;
  estimatedTokens: number;
  droppedEntryIds: string[];
}
```

详情策略：

- `summary`：标题 + summaryMd + canonical facts。
- `normal`：summaryMd + 关键 customFields + 适度 content excerpt。
- `full`：完整 contentMd，但仍受 tokenBudget 和分页限制。

## Search

`searchJingwei(input)` 输入：

```ts
interface SearchJingweiInput {
  bookId: string;
  query: string;
  categories?: JingweiReadCategory[];
  chapterNumber?: number;
  tokenBudget?: number;
  limit?: number;
}
```

搜索字段：

- title
- aliases
- tags
- visibility keywords
- summaryMd
- contentMd
- customFields canonicalFacts

命中输出包含：

- `matchReason`
- `matchedFields`
- `score`

## Tool Schemas

新增工具：

- `jingwei.read_brief`
- `jingwei.read_category`
- `jingwei.search`

更新 `jingwei.read_context` 描述：

- 明确它是兼容工具。
- `full` 不再表示一次性返回所有正文。
- 推荐模型使用 `read_brief` + `read_category`。

## Agent Prompt Updates

写作 agent prompt 应加入：

```text
经纬读取规则：
1. 默认先调用 jingwei.read_brief。
2. 不要默认调用 jingwei.read_context mode=full。
3. 根据任务需要调用 jingwei.read_category 分批读取。
4. 缺具体设定时调用 jingwei.search。
5. 如果工具提示 hasMore=true，只在确有必要时继续读取下一页。
```

任务建议：

- 写下一章：`read_brief` → `characters` → `locations/factions` → `foreshadowing` → `chapter-summaries`
- 审计：`read_brief` → `chapter-summaries` → `foreshadowing` → `characters` → `rules/conflicts`
- 大纲：`read_brief` → `world-model` → `conflicts` → `foreshadowing` → `chapter-summaries`

## Import Pipeline

新增分类导入服务，先不要求复杂 UI：

```text
raw material
  ↓
parse chunks
  ↓
classify category
  ↓
generate summary/detail split
  ↓
infer priorityTier / visibilityRule / aliases / tags
  ↓
upsert entries
  ↓
return import report
```

导入报告：

```ts
interface JingweiImportReport {
  totalChunks: number;
  createdCount: number;
  updatedCount: number;
  byCategory: Array<{ category: string; count: number }>;
  unclassified: Array<{ title: string; reason: string }>;
  duplicates: Array<{ title: string; existingEntryId: string }>;
  summarizedLongEntries: Array<{ title: string; originalTokens: number; summaryTokens: number }>;
  warnings: string[];
}
```

## Error Handling

- book 不存在：`book-not-found`
- category 不合法：`invalid-category`
- 查询为空：`invalid-query`
- 数据库失败：`storage-error`
- 预算过小：返回空 items + 明确 `budget-too-small` warning，不抛异常
- 没有 summary：自动 fallback，不中断

## Testing Strategy

### Unit Tests

- category resolution
- summary fallback
- core brief budget clipping
- category pagination
- search scoring
- read_context compatibility mapping

### Contract Tests

- tool schema contains new tools
- backend contract matrix includes new Jingwei actions
- `read_context mode=full` no longer returns unbounded full context

### Integration Tests

- 构造一本含大量角色/章节摘要/伏笔的测试书
- 验证 `read_brief` 稳定小于预算
- 验证 `read_category` 可分页读完
- 验证 `search` 能命中 aliases/tags/content

## Migration Plan

1. 新增 `summary_md` migration。
2. Repository 读写兼容 `summaryMd`。
3. 没有 summary 的旧条目 fallback 自动摘要。
4. 新导入流程开始写 summary。
5. 后续可增加批量回填 summary 的维护工具。

## Rollout Plan

### Phase 1: Read Protocol

- 新增 brief/index/category/search 构建模块。
- 新增三个工具 handler。
- 更新 schema 和 tool registry。
- `read_context` 改兼容层。
- 更新 agent prompt。

### Phase 2: Import Classification

- 实现分类导入服务。
- 生成导入报告。
- 支持 summary/detail 拆分。

### Phase 3: Observability

- 工具调用日志记录分类、返回数量、估算 tokens、dropped count。
- UI 可消费目录和 token 估算。

### Phase 4: UI

- 经纬面板展示分类健康度。
- 展示模型默认读取预览。
- 展示导入报告。

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| 模型不知道要继续读分类 | prompt 明确阅读策略，brief 返回 recommendedReads |
| summary 质量差导致遗漏设定 | 支持 normal/full 展开，search 可补读 |
| 分类误判 | 导入报告列出需确认项，允许用户改分类 |
| 旧 UI 依赖 read_context items | 保持兼容字段，逐步迁移 UI |
| 数据迁移风险 | 第一阶段只新增 summary_md，其它放 customFields |

## Open Decisions

1. `summary_md` 是否本轮立即新增数据库字段。推荐新增。
2. `read_brief` 默认预算是 3000 还是 4000 tokens。推荐 4000。
3. `full` 是否完全禁用。推荐不禁用，但改为分页建议，不返回无界全量。
