# Design Document

## Overview

Novel Bible v1 提供一份**动态、结构化、AI 可消费**的小说设定库。核心设计是 4 张一等公民表（角色 / 事件 / 设定 / 章节摘要）+ 三种可见性规则 + 时间线纪律 + 双哲学模式，通过 `buildBibleContext()` 统一 API 提供给 AI 写作管线。

## Goals

- 为作者提供与网文创作实际习惯对齐的 Bible 结构（8 字段抽象为 4 表）
- 解决"条目爆炸 → AI 上下文溢出"的经典难题（三档可见性）
- 防剧透（时间线）
- 脑洞型 / 情节型作者都能用（静态 / 动态模式）

## Non-Goals

- 不做角色弧线 progressions（留给 progressions-tracking）
- 不做流派模板导入（留给 template-market-v1）
- 不做关系图 / 版本历史 / 多语言
- 不内置大型预置数据库（由 coding-agent 按需生成）

## Architecture

### 分层

```
packages/core/src/bible/
  schema.ts                    ← drizzle schema（在 storage schema.ts 中统一导出）
  types.ts                     ← BibleEntry / VisibilityRule / BibleContextItem
  repositories/
    character-repo.ts
    event-repo.ts
    setting-repo.ts
    chapter-summary-repo.ts
  context/
    build-bible-context.ts     ← 核心 API
    alias-matcher.ts           ← Aho-Corasick 关键词扫描
    visibility-filter.ts       ← 三档可见性裁决
    nested-resolver.ts         ← 嵌套引用递归
    token-budget.ts            ← token 预算与丢弃
  
packages/studio/src/
  api/routes/bible/
    characters.ts
    events.ts
    settings.ts
    chapter-summaries.ts
    preview-context.ts
  components/bible/
    BibleSidebar.tsx
    EntryForm.tsx
    VisibilityRuleEditor.tsx
    ContextPreviewModal.tsx
```

## Schema（drizzle）

```ts
// bible 表都带 bookId 隔离
export const book = sqliteTable("book", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  bibleMode: text("bible_mode").notNull().default("static"), // static | dynamic
  currentChapter: integer("current_chapter").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const bibleCharacter = sqliteTable("bible_character", {
  id: text("id").primaryKey(),
  bookId: text("book_id").notNull().references(() => book.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  aliasesJson: text("aliases_json").notNull().default("[]"),
  roleType: text("role_type").notNull().default("minor"),
  summary: text("summary").notNull().default(""),
  traitsJson: text("traits_json").notNull().default("{}"),
  visibilityRuleJson: text("visibility_rule_json").notNull().default("{\"type\":\"global\"}"),
  firstChapter: integer("first_chapter"),
  lastChapter: integer("last_chapter"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
});

export const bibleEvent = sqliteTable("bible_event", {
  id: text("id").primaryKey(),
  bookId: text("book_id").notNull().references(() => book.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  eventType: text("event_type").notNull(),  // key | background | foreshadow | payoff
  chapterStart: integer("chapter_start"),
  chapterEnd: integer("chapter_end"),
  summary: text("summary").notNull().default(""),
  relatedCharacterIdsJson: text("related_character_ids_json").notNull().default("[]"),
  visibilityRuleJson: text("visibility_rule_json").notNull().default("{\"type\":\"tracked\"}"),
  foreshadowState: text("foreshadow_state"),  // buried | hinted | half-revealed | paid-off
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
});

export const bibleSetting = sqliteTable("bible_setting", {
  id: text("id").primaryKey(),
  bookId: text("book_id").notNull().references(() => book.id, { onDelete: "cascade" }),
  category: text("category").notNull(),  // worldview | power-system | map | faction | golden-finger | background | other
  name: text("name").notNull(),
  content: text("content").notNull().default(""),
  visibilityRuleJson: text("visibility_rule_json").notNull().default("{\"type\":\"global\"}"),
  nestedRefsJson: text("nested_refs_json").notNull().default("[]"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
});

export const bibleChapterSummary = sqliteTable("bible_chapter_summary", {
  id: text("id").primaryKey(),
  bookId: text("book_id").notNull().references(() => book.id, { onDelete: "cascade" }),
  chapterNumber: integer("chapter_number").notNull(),
  title: text("title").notNull().default(""),
  summary: text("summary").notNull().default(""),
  wordCount: integer("word_count").notNull().default(0),
  keyEventsJson: text("key_events_json").notNull().default("[]"),
  appearingCharacterIdsJson: text("appearing_character_ids_json").notNull().default("[]"),
  pov: text("pov").notNull().default(""),
  metadataJson: text("metadata_json").notNull().default("{}"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
}, (t) => ({
  byChapter: uniqueIndex("idx_bible_chapter_summary_by_chapter").on(t.bookId, t.chapterNumber),
}));
```

## 可见性规则 JSON 结构

```ts
type VisibilityRule =
  | { type: "global"; visibleAfterChapter?: number; visibleUntilChapter?: number }
  | { type: "tracked"; visibleAfterChapter?: number; visibleUntilChapter?: number }
  | { type: "nested"; parentIds: string[]; visibleAfterChapter?: number };
```

## buildBibleContext 实现

```ts
export interface BuildBibleContextInput {
  bookId: string;
  currentChapter: number;
  sceneText?: string;
  tokenBudget?: number;  // default 8000
}

export interface BibleContextItem {
  id: string;
  type: "character" | "event" | "setting" | "chapter-summary";
  category?: string;
  name: string;
  content: string;       // 格式化后的内容文本
  priority: number;      // for budget cutoff
  source: "global" | "tracked" | "nested";
  estimatedTokens: number;
}

export async function buildBibleContext(input: BuildBibleContextInput): Promise<BuildBibleContextResult> {
  const book = await bookRepo.getById(input.bookId);
  const mode: BibleMode = book.bibleMode;
  
  // 1. 加载所有未删除的候选条目（按 bookId）
  const allEntries = await loadAllCandidateEntries(input.bookId);
  
  // 2. 时间线过滤
  const timelineFiltered = allEntries.filter((e) => isVisibleAtChapter(e, input.currentChapter));
  
  // 3. 静态模式：只保留 global
  if (mode === "static") {
    return composeContext(timelineFiltered.filter(e => e.visibility.type === "global"), input.tokenBudget);
  }
  
  // 4. 动态模式：global 全收，tracked 扫描，nested 递归
  const globals = timelineFiltered.filter(e => e.visibility.type === "global");
  const trackedCandidates = timelineFiltered.filter(e => e.visibility.type === "tracked");
  const tracked = input.sceneText
    ? matchTrackedByAliases(trackedCandidates, input.sceneText)
    : [];
  const nested = resolveNestedRefs([...globals, ...tracked], timelineFiltered, { maxDepth: 3 });
  
  // 5. 去重 + 预算裁剪 + 格式化
  const merged = dedupeById([...globals, ...tracked, ...nested]);
  return composeContext(merged, input.tokenBudget);
}
```

### alias-matcher（Aho-Corasick）

- 一次性用所有 tracked 条目的 name + aliases 构建 AC 自动机
- 对 sceneText 单次扫描 O(n+m) 找出所有命中
- 对 1 万字的章节、上千条目，<10ms 完成

### nested-resolver

- BFS，起点是已命中的 entries
- 每次取一个 entry 的 nestedRefsJson → 加入队列（若未访问过）
- 深度 cap = 3，防止病态环
- 被递归带入的条目 source = "nested"

### token-budget

- 粗估：中文每条目的 tokens ≈ 字符数 × 0.6（可调）
- 超出预算时按 `global > nested > tracked` 优先丢弃 tracked 类中最后 updatedAt 最早者
- 返回 `droppedIds[]` 供 UI 提示

## REST API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/books/:bookId/bible/characters` | 列表 |
| POST | `/api/books/:bookId/bible/characters` | 新建 |
| PUT | `/api/books/:bookId/bible/characters/:id` | 更新 |
| DELETE | `/api/books/:bookId/bible/characters/:id` | 软删 |
| 同上 | events / settings / chapter-summaries | 同模式 |
| POST | `/api/books/:bookId/bible/preview-context` | 入参 `{ currentChapter, sceneText? }` 返 `BuildBibleContextResult` |
| PATCH | `/api/books/:bookId/settings` | 改 bibleMode |

## UI 设计（最小版）

- 左侧 Bible Sidebar：4 Tabs（Characters/Events/Settings/Chapter Summaries）
- 右侧列表 + 表单：结构化字段输入
- VisibilityRuleEditor：下拉 type + visibleAfterChapter 数字输入 + nested parentIds 多选
- Book Settings Panel：bible_mode 切换（static / dynamic）
- ContextPreviewModal：输入 currentChapter 与 sceneText → 展示注入清单 + tokens + 丢弃理由

## 错误处理

- 写入失败：400/500 + code，前端按 code 显示消息
- 可见性规则不合法：保存时前置校验（zod schema）
- nested 环：构建上下文时按深度 cap 截断，日志记录警告但不抛错

## 测试策略

- 单测：visibility-filter 各规则 / token-budget 溢出 / nested 环保护 / AC matcher 命中
- 集成：REST API + 本地 SQLite fixture
- E2E：Studio 中创建书 → 加条目 → 预览上下文

## 性能

- 冷启动构建 AC 自动机：若 tracked 条目 <500 → <50ms
- 单次 buildBibleContext（10 章节 + 200 条目 + 5000 字 sceneText）：<100ms

## 对 ai-taste-filter 与 coding-agent 的接口

- `bible_chapter_summary.metadataJson` 预留 `filterReport` 字段，由 filter spec 写入
- coding-agent 可通过公开的 repository / API 批量插入条目（权限受 workbench mode 控制）

---

# Phase B 设计扩展：Conflict / WorldModel / Premise / CharacterArc

## Conflict（矛盾）建模

### Schema

```ts
export const bibleConflict = sqliteTable("bible_conflict", {
  id: text("id").primaryKey(),
  bookId: text("book_id").notNull().references(() => book.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  type: text("type").notNull(),
  // external-character | external-power | external-world |
  // internal-value | internal-fear | social-class | system-scarcity | cultural
  scope: text("scope").notNull().default("arc"),          // main | arc | chapter | scene
  priority: integer("priority").notNull().default(3),      // 1-5，1=主线
  protagonistSideJson: text("protagonist_side_json").notNull().default("[]"),
  antagonistSideJson: text("antagonist_side_json").notNull().default("[]"),
  stakes: text("stakes").notNull().default(""),
  rootCauseJson: text("root_cause_json").notNull().default("{}"),
  evolutionPathJson: text("evolution_path_json").notNull().default("[]"),
  // [{ chapter, state, summary, movedBy: "author" | "ai-generated" | "audit", at }]
  resolutionState: text("resolution_state").notNull().default("unborn"),
  // unborn | brewing | erupted | escalating | climax | resolved | deferred
  resolutionChapter: integer("resolution_chapter"),
  relatedConflictIdsJson: text("related_conflict_ids_json").notNull().default("[]"),
  visibilityRuleJson: text("visibility_rule_json").notNull().default("{\"type\":\"tracked\"}"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
}, (t) => ({
  byBookStatus: index("idx_bible_conflict_by_status").on(t.bookId, t.resolutionState),
  byBookPriority: index("idx_bible_conflict_by_priority").on(t.bookId, t.priority),
}));
```

### 在场矛盾查询

```ts
// conflict-repo.ts
export async function getActiveConflictsAtChapter(bookId: string, chapter: number): Promise<ConflictItem[]> {
  const rows = await db.select().from(bibleConflict)
    .where(and(
      eq(bibleConflict.bookId, bookId),
      isNull(bibleConflict.deletedAt),
      notInArray(bibleConflict.resolutionState, ["resolved", "deferred"]),
    ));
  return rows
    .filter((r) => {
      const path = safeJson(r.evolutionPathJson, []);
      const firstCh = path[0]?.chapter ?? r.resolutionChapter ?? 0;
      const lastCh = r.resolutionChapter ?? Number.POSITIVE_INFINITY;
      return chapter >= firstCh && chapter <= lastCh;
    })
    .sort((a, b) => a.priority - b.priority);
}
```

### Stalled 检测

- 后台定时（或每次进入 BookDetail 时触发）扫描 `resolution_state = escalating` 的矛盾
- 对每条查 `evolution_path_json` 最后一条 `{ chapter }`，若 `currentChapter - lastChapter > 10` → 标 stalled
- UI 在 Conflicts Tab 显示橙色徽章 + "stalled-conflict" 原因

### 注入到 buildBibleContext

```ts
// 扩展 buildBibleContext
async function injectConflicts(bookId: string, currentChapter: number): Promise<BibleContextItem[]> {
  const active = await getActiveConflictsAtChapter(bookId, currentChapter);
  return active.map((c) => ({
    id: c.id,
    type: "conflict",
    name: c.name,
    content: `【矛盾-${c.type}】${c.name}（${c.resolutionState}）：${c.stakes}`,
    priority: 10 - c.priority,         // 主线 1 → 9（高优先），支线 5 → 5（中）
    source: c.scope === "main" ? "global" : "tracked",
    estimatedTokens: approxTokens(c.stakes),
  }));
}
```

## WorldModel（5 维）建模

### Schema

```ts
export const bibleWorldModel = sqliteTable("bible_world_model", {
  id: text("id").primaryKey(),
  bookId: text("book_id").notNull().unique().references(() => book.id, { onDelete: "cascade" }),
  economyJson: text("economy_json").notNull().default("{}"),
  societyJson: text("society_json").notNull().default("{}"),
  geographyJson: text("geography_json").notNull().default("{}"),
  powerSystemJson: text("power_system_json").notNull().default("{}"),
  cultureJson: text("culture_json").notNull().default("{}"),
  timelineJson: text("timeline_json").notNull().default("{}"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});
```

### 子字段 TS 类型（规范 JSON 结构）

```ts
interface EconomyDescriptor {
  currency?: string;
  scarcity?: string;
  classIncomeLevels?: Array<{ class: string; typicalIncome: string }>;
  tradePatterns?: string;
  notableCommodities?: string[];
}

interface SocietyDescriptor {
  governmentType?: string;
  classMobility?: string;
  taboos?: string[];
  ethicsFrame?: string;
  keyInstitutions?: Array<{ name: string; role: string }>;
}

// geography / powerSystem / culture / timeline 类似，按 Requirement 9 条目展开
```

### 注入策略

```ts
function formatWorldModel(wm: WorldModelRow): BibleContextItem[] {
  const items: BibleContextItem[] = [];
  for (const [dim, json] of [
    ["经济", wm.economyJson],
    ["社会", wm.societyJson],
    ["地理", wm.geographyJson],
    ["力量体系", wm.powerSystemJson],
    ["文化", wm.cultureJson],
    ["纪年", wm.timelineJson],
  ] as const) {
    const parsed = safeJson(json, {});
    if (Object.keys(parsed).length === 0) continue;  // 空维度跳过
    items.push({
      id: `world-model:${dim}`,
      type: "world-model",
      name: dim,
      content: `【世界-${dim}】${formatDescriptor(parsed)}`,
      priority: 8,
      source: "global",
      estimatedTokens: approxTokens(JSON.stringify(parsed)),
    });
  }
  return items;
}
```

## Premise + CharacterArc

### Schema

```ts
export const biblePremise = sqliteTable("bible_premise", {
  id: text("id").primaryKey(),
  bookId: text("book_id").notNull().unique().references(() => book.id, { onDelete: "cascade" }),
  logline: text("logline").notNull().default(""),
  themeJson: text("theme_json").notNull().default("[]"),
  tone: text("tone").notNull().default(""),
  targetReaders: text("target_readers").notNull().default(""),
  uniqueHook: text("unique_hook").notNull().default(""),
  genreTagsJson: text("genre_tags_json").notNull().default("[]"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const bibleCharacterArc = sqliteTable("bible_character_arc", {
  id: text("id").primaryKey(),
  bookId: text("book_id").notNull().references(() => book.id, { onDelete: "cascade" }),
  characterId: text("character_id").notNull().references(() => bibleCharacter.id, { onDelete: "cascade" }),
  arcType: text("arc_type").notNull(),   // 成长 | 堕落 | 平移 | 反转 | 救赎
  startingState: text("starting_state").notNull().default(""),
  endingState: text("ending_state").notNull().default(""),
  keyTurningPointsJson: text("key_turning_points_json").notNull().default("[]"),
  // [{ chapter, summary }]
  currentPosition: text("current_position").notNull().default(""),
  visibilityRuleJson: text("visibility_rule_json").notNull().default("{\"type\":\"global\"}"),
  deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, (t) => ({
  byCharacter: index("idx_bible_character_arc_by_character").on(t.bookId, t.characterId),
}));
```

### Premise 注入顺序

`buildBibleContext` 组装顺序更新为：

```
1. Premise（1 条，global，最高优先）
2. WorldModel 非空维度（global）
3. 已命中的 Character + 附加 CharacterArc.currentPosition
4. 已命中的 Event / Setting
5. 在场 Conflict
6. nested 扩展
7. ChapterSummary（最近 N 章，tracked）
```

---

# Phase C 设计扩展：Questionnaire + CoreShift + PGI

## Questionnaire 系统

### Schema

```ts
export const questionnaireTemplate = sqliteTable("questionnaire_template", {
  id: text("id").primaryKey(),
  version: text("version").notNull(),
  genreTagsJson: text("genre_tags_json").notNull().default("[]"),
  tier: integer("tier").notNull(),             // 1 | 2 | 3
  targetObject: text("target_object").notNull(),
  // premise | conflict | world-model | character-arc | character | setting
  questionsJson: text("questions_json").notNull(),
  isBuiltin: integer("is_builtin", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const questionnaireResponse = sqliteTable("questionnaire_response", {
  id: text("id").primaryKey(),
  bookId: text("book_id").notNull().references(() => book.id, { onDelete: "cascade" }),
  templateId: text("template_id").notNull().references(() => questionnaireTemplate.id),
  targetObjectType: text("target_object_type").notNull(),
  targetObjectId: text("target_object_id"),
  answersJson: text("answers_json").notNull(),
  status: text("status").notNull().default("draft"),   // draft | submitted | skipped
  answeredVia: text("answered_via").notNull().default("author"),  // author | ai-assisted
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, (t) => ({
  byBookTemplate: index("idx_questionnaire_response_by_book_template").on(t.bookId, t.templateId),
}));
```

### 问卷 questions_json 规范

```ts
interface QuestionnaireQuestion {
  id: string;                      // 问题稳定 ID
  prompt: string;                  // 提问文本
  type: "single" | "multi" | "text" | "ranged-number" | "ai-suggest";
  options?: string[];              // single / multi 使用
  min?: number; max?: number;      // ranged-number 使用
  mapping: {                       // 答案如何落到 target object
    fieldPath: string;             // e.g. "logline" / "economy.currency"
    transform?: "identity" | "join-comma" | "parse-int" | "ai-rewrite";
  };
  dependsOn?: { questionId: string; equals: string | number | boolean };
  hint?: string;                   // AI 建议时的上下文 hint
  defaultSkippable: boolean;       // 本题是否允许跳过
}
```

### 内置模板（seed）

Phase C 至少提供以下 builtin：

| tier | target | 适用流派 | 题数 |
|---|---|---|---|
| 1 | premise | 通用 | 6 |
| 1 | premise | 玄幻 | 6 |
| 1 | premise | 都市 | 6 |
| 2 | world-model | 玄幻（力量体系优先） | 18 |
| 2 | world-model | 都市（社会/经济优先） | 18 |
| 2 | conflict（主线 × 1 支线 × 2） | 通用 | 15 |
| 2 | character-arc | 通用 | 12 |
| 3 | world-model（五维全）| 通用 | 35 |

### 事务提交

```ts
async function submitResponse(response: QuestionnaireResponseInput): Promise<void> {
  await db.transaction(async (tx) => {
    const template = await tx.select().from(questionnaireTemplate).where(eq(id, response.templateId)).get();
    const mappings = safeJson(template.questionsJson, []).map((q) => q.mapping);
    for (const [qId, answer] of Object.entries(response.answers)) {
      await applyMappingToTargetObject(tx, response.bookId, template.targetObject, mappings[qId], answer);
    }
    await tx.insert(questionnaireResponse).values({ ...response, status: "submitted" });
  });
}
```

### AI 建议端点

```
POST /api/books/:bookId/questionnaires/:templateId/ai-suggest
body: { questionId, existingAnswers }
→ 调用 writer/worldbuilder agent → 返回候选答案与理由
```

### Dynamic 模式的滞后问卷

- 每章 `appendChapterSummary` 后，扫描 `chapter.keyEventsJson` 中引用但 Bible 中未建档的人物 / 设定 / 矛盾
- 生成一份临时 "ratify-questionnaire"（形如："本章出现了'林间老翁'，要固化为 Character 吗？"）
- 作者在侧边栏或章节完成弹窗中响应

## CoreShift 协议

### Schema

```ts
export const coreShift = sqliteTable("core_shift", {
  id: text("id").primaryKey(),
  bookId: text("book_id").notNull().references(() => book.id, { onDelete: "cascade" }),
  targetType: text("target_type").notNull(),
  // premise | character-arc | conflict | world-model | outline
  targetId: text("target_id").notNull(),
  fromSnapshotJson: text("from_snapshot_json").notNull(),
  toSnapshotJson: text("to_snapshot_json").notNull(),
  triggeredBy: text("triggered_by").notNull(),  // author | data-signal | continuity-audit
  chapterAt: integer("chapter_at").notNull(),
  affectedChaptersJson: text("affected_chapters_json").notNull().default("[]"),
  impactAnalysisJson: text("impact_analysis_json").notNull().default("{}"),
  status: text("status").notNull().default("proposed"),  // proposed | accepted | rejected | applied
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  appliedAt: integer("applied_at", { mode: "timestamp_ms" }),
}, (t) => ({
  byBookStatus: index("idx_core_shift_by_status").on(t.bookId, t.status),
}));
```

### 流程

```
[作者编辑 premise / conflict(main) / world-model / character-arc]
      ↓
create CoreShift (status = proposed, from/to snapshot)
      ↓
analyzeImpact():
  - 扫 bible_chapter_summary 中引用
  - 扫 bible_conflict.evolution_path_json
  - 扫 bible_character_arc.keyTurningPointsJson
  → affectedChapters[]
      ↓
UI 弹"影响分析"面板
      ↓
[accept] → 覆盖 Bible 对象；affected 章节加"需复核"徽章
[reject] → 恢复 Bible 对象前态
```

### UI

- Book Detail 新增"变更历史" Tab：列出所有 CoreShift 时间线
- 每个 proposed 变更显示 diff + 影响章节列表 + accept/reject 按钮
- 章节列表中被 affected 的条目显示橙色"需复核"徽章

## Pre-Generation Interrogation（PGI）

### 端点

```
POST /api/books/:bookId/chapters/:chapter/pre-generation-questions
→ 返回 { questions: PGIQuestion[], heuristicsTriggered: string[] }
```

### 规则引擎（启发式，不用 LLM）

```ts
async function generatePGIQuestions(bookId: string, chapter: number): Promise<PGIQuestion[]> {
  const questions: PGIQuestion[] = [];
  
  // 规则 1：在场矛盾 escalating
  const escalating = await getActiveConflictsAtChapter(bookId, chapter);
  for (const c of escalating.filter((x) => x.resolutionState === "escalating").slice(0, 2)) {
    questions.push({
      id: `conflict-escalate:${c.id}`,
      prompt: `矛盾"${c.name}"当前状态：escalating。本章要推到 climax 吗？`,
      type: "single",
      options: ["推到 climax", "保持 escalating", "稍缓（brewing 回退）", "跳过"],
      context: { conflictId: c.id },
    });
  }
  
  // 规则 2：伏笔到期
  const buried = await getEventsByForeshadowState(bookId, "buried");
  for (const ev of buried) {
    const plannedAt = ev.chapterEnd ?? ev.chapterStart;
    if (plannedAt && Math.abs(chapter - plannedAt) <= 3) {
      questions.push({
        id: `foreshadow-payoff:${ev.id}`,
        prompt: `伏笔"${ev.name}"预计在第 ${plannedAt} 章回收。本章要兑现吗？`,
        type: "single",
        options: ["本章兑现", "再埋 2 章", "改线（改成其他伏笔）", "跳过"],
      });
    }
  }
  
  // 规则 3：人设漂移警报（需 continuity-audit-v1，当前 stub）
  // 规则 4：大纲偏离（需 outline-v1，当前 stub）
  
  return questions.slice(0, 5);
}
```

### 生成集成

- writer agent 调用前，UI 先弹 PGI 弹窗（可关闭）
- 作者答题后，答案以 `pgi_answers` 结构化字段注入 prompt
- 跳过时直接走默认

### 注入格式

```
【本章作者指示（PGI）】
- 矛盾"拜师被拒"推到 climax
- 伏笔"师父的玉符"本章兑现
```

---

# 整体数据流视图（Phase A + B + C 完成后）

```
[问卷（Phase C）] → 事务写入 → [Premise / WorldModel / Conflict / CharacterArc / Character]（Phase A/B）
                                              ↓
                                  [buildBibleContext]（Phase A/B 引擎）
                                              ↓ 先拿 PGI
[PGI（Phase C）] → 作者回答 → 注入 prompt ← [writer agent]
                                              ↓
                                      [生成章节文本]
                                              ↓ 回流
                              [bible_chapter_summary（Phase A）]
                              [filter_report]（ai-taste-filter spec）
                              [conflict.evolution_path 自动追加（Phase B）]
                              [dynamic 模式：ratify-questionnaire（Phase C）]

[作者编辑核心对象] → 自动 [CoreShift propose（Phase C）]
                         → 影响分析
                         → accept/reject
                         → Bible 对象更新 + affected 章节标"需复核"
```
