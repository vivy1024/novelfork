# 设计：统一资源版本系统 + 经纬上下文分层

## 一、数据模型

### 1.1 `writing_resource` 表

```sql
CREATE TABLE "writing_resource" (
  "id" TEXT PRIMARY KEY,
  "book_id" TEXT NOT NULL,
  "type" TEXT NOT NULL CHECK ("type" IN ('chapter', 'candidate', 'draft')),
  "status" TEXT NOT NULL CHECK ("status" IN ('draft', 'candidate', 'accepted', 'rejected', 'archived')),
  "title" TEXT NOT NULL,
  "content" TEXT NOT NULL DEFAULT '',
  "chapter_number" INTEGER,
  "word_count" INTEGER NOT NULL DEFAULT 0,
  "parent_id" TEXT REFERENCES "writing_resource"("id"),
  "version" INTEGER NOT NULL DEFAULT 1,
  "source" TEXT,
  "metadata_json" TEXT,
  "created_at" INTEGER NOT NULL,
  "updated_at" INTEGER NOT NULL,
  "accepted_at" INTEGER,
  "deleted_at" INTEGER
);

CREATE INDEX "idx_wr_book_type" ON "writing_resource" ("book_id", "type", "deleted_at");
CREATE INDEX "idx_wr_book_chapter" ON "writing_resource" ("book_id", "chapter_number")
  WHERE "type" = 'chapter' AND "status" = 'accepted' AND "deleted_at" IS NULL;
CREATE INDEX "idx_wr_parent" ON "writing_resource" ("parent_id") WHERE "parent_id" IS NOT NULL;
CREATE INDEX "idx_wr_status" ON "writing_resource" ("book_id", "status", "deleted_at");
```

### 1.2 状态机

```
合法转换:
  draft      → candidate     (提交审阅)
  draft      → accepted      (直接采纳)
  candidate  → accepted      (采纳为章节)
  candidate  → draft         (退回编辑)
  candidate  → rejected      (拒绝)
  candidate  → archived      (归档)
  rejected   → draft         (重新编辑)
  archived   → candidate     (恢复)
```

终态：`accepted`（可生成新变体，但自身不再变）。

### 1.3 版本链

- `parent_id` 指向派生来源。
- 正式章节被新版本替换时，旧版本 status → `archived`，新版本 version = 旧版本 version + 1。
- 查询版本历史：递归查 parent_id 链。

### 1.4 `story_jingwei_entry` 新增字段

```sql
ALTER TABLE "story_jingwei_entry" ADD COLUMN "priority_tier" TEXT DEFAULT 'auto';
-- 'core' | 'relevant' | 'reference' | 'auto'
```

## 二、后端服务

### 2.1 WritingResourceService

位置：`packages/novel-plugin/src/engine/writing-resource/`

```typescript
interface WritingResourceService {
  list(bookId: string, filter?: { type?, status?, chapterNumber? }): WritingResource[];
  getById(id: string): WritingResource | null;
  create(input: CreateWritingResourceInput): WritingResource;
  update(id: string, input: UpdateWritingResourceInput): WritingResource;
  transition(id: string, action: TransitionAction): WritingResource;
  softDelete(id: string): void;
  getHistory(id: string): WritingResource[];  // 版本链
}

type TransitionAction =
  | { action: "accept"; chapterNumber: number; mode: "replace" | "merge" | "new" }
  | { action: "reject" }
  | { action: "archive" }
  | { action: "to-draft" }
  | { action: "to-candidate" }
  | { action: "restore" };
```

### 2.2 WritingResourceRepository

位置：`packages/novel-plugin/src/engine/writing-resource/repository.ts`

纯 SQL 操作层，被 Service 调用。

### 2.3 经纬上下文策略

位置：`packages/novel-plugin/src/engine/jingwei/context/context-policy.ts`

```typescript
interface JingweiContextPolicy {
  resolveLayer(entry: StoryJingweiEntryRecord, bookConfig: BookConfig): 'core' | 'relevant' | 'reference';
}

// 默认规则：
// core: priority_tier='core' OR category IN ('premise','world-model','core-memory') OR tags含'core'
// relevant: priority_tier='relevant' OR (category IN ('character','faction','foreshadowing','arc','timeline') AND 匹配条件)
// reference: 其余
```

`buildJingweiContext` 增加 `mode` 参数：

```typescript
interface BuildJingweiContextOptions {
  bookId: string;
  currentChapter?: number;
  sceneText?: string;
  tokenBudget?: number;
  mode?: 'auto' | 'core' | 'relevant' | 'full';  // 新增
}
```

- `auto`（默认）：core + relevant，budget ~12000
- `core`：只 core，budget ~4000
- `relevant`：只 relevant，budget ~8000
- `full`：全部，budget ~20000

## 三、后端 API

### 3.1 写作资源 REST API

位置：`packages/novel-plugin/src/routes/writing-resource.ts`

```
GET    /api/books/:bookId/resources?type=&status=&chapter=
GET    /api/books/:bookId/resources/:resourceId
POST   /api/books/:bookId/resources
PUT    /api/books/:bookId/resources/:resourceId
POST   /api/books/:bookId/resources/:resourceId/transition
DELETE /api/books/:bookId/resources/:resourceId
GET    /api/books/:bookId/resources/:resourceId/history
```

### 3.2 经纬 read_context 工具变化

`jingwei.read_context` schema 增加 `mode` 字段：

```json
{
  "bookId": "...",
  "mode": "auto",
  "sceneText": "...",
  "chapterNumber": 1
}
```

### 3.3 candidate.create_chapter 适配

工具内部改为调用 `WritingResourceService.create()`，不再直接操作文件系统。

## 四、前端

### 4.1 资源树

`WorkbenchResourceTree` 改为从 `/api/books/:id/resources` 拉数据，按 type 分组：

```
章节 (accepted)
候选稿 (candidate)
草稿 (draft)
已归档 (archived) — 折叠
```

### 4.2 资源详情页

根据 type + status 渲染不同操作栏：

- candidate → CandidateActionsBar（已有，接入新 API）
- draft → DraftActionsBar（新增：保存/提交/直接采纳/删除）
- accepted → ChapterActionsBar（新增：编辑/生成变体/查看历史）

### 4.3 版本历史面板

`ResourceHistoryPanel`：显示 parent 链，每个节点显示 title + status + 时间。

### 4.4 经纬条目优先级标记

经纬条目编辑表单增加 `priority_tier` 下拉：
- 自动（按规则推断）
- 核心（始终注入）
- 相关（按匹配注入）
- 参考（仅 full 模式）

## 五、Migration

### 5.1 SQL Migration

`0016_writing_resource.sql`：建表 + 索引。
`0017_jingwei_priority_tier.sql`：加列。

### 5.2 数据迁移（应用层）

位置：`packages/novel-plugin/src/engine/writing-resource/migrate-from-files.ts`

启动时检测：如果 `writing_resource` 表为空且 `books/` 目录下有 `chapters/index.json`，执行迁移：

1. 读 `chapters/index.json` → 插入 type=chapter, status=accepted
2. 读 `generated-candidates/index.json` → 插入 type=candidate, status=candidate
3. 读 `drafts/index.json` → 插入 type=draft, status=draft
4. 正文从对应 .md 文件读入 content 字段
5. 写入迁移标记防止重复执行

### 5.3 兼容层

旧 `chapter-candidates.ts` 路由保留为 deprecated 代理，内部转发到新 API。过渡期后删除。

## 六、工具适配

| 工具 | 变化 |
|------|------|
| `candidate.create_chapter` | 内部改为 `WritingResourceService.create({ type:'candidate', status:'candidate', ... })` |
| `cockpit.get_snapshot` | 章节列表改为查 `writing_resource WHERE type='chapter' AND status='accepted'` |
| `jingwei.read_context` | 增加 mode 参数，默认 auto |
| `chapter.read` | 改为查 `writing_resource` |

## 七、不做

- 实时协同编辑
- Diff 可视化
- 版本树图形化展示
- AI 自动续写/润色按钮（只保留入口）
- 改动 `candidate.create_chapter` 的外部接口（保持 content 纯保存）
