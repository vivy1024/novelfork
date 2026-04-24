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
