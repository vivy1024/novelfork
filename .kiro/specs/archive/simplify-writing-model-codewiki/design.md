# Design Document

## Overview

本设计将当前精简工作分为四条主线：

1. 写作对象模型收口
2. 存储语义收口
3. 工具定位收口
4. CodeWiki 代码百科化与 docs 入口调整

目标不是新增功能，而是移除旧中间层、统一边界，并把真实代码结构沉淀为可长期维护的文档。

## Architecture

### Target Model

```text
经纬          → 静态参考
叙事记忆      → 动态事实
正式章节      → 结果层正文
预设/模板/节拍 → 用户可编辑配置
工具          → 用户体验入口
```

### Deprecated Model

```text
候选稿
草稿
候选稿/草稿/正式章节三态流转
SQLite + 文件系统双主章节存储
candidate.create_chapter 作为主写作入口
```

## Components

### 1. Writing Resource Cleanup

Current files to audit and refactor:

- `packages/novel-plugin/src/engine/writing-resource/types.ts`
- `packages/novel-plugin/src/engine/writing-resource/service.ts`
- `packages/novel-plugin/src/engine/writing-resource/file-store.ts`
- `packages/novel-plugin/src/engine/writing-resource/repository.ts`
- `packages/novel-plugin/src/routes/writing-resource.ts`
- `packages/studio/src/api/routes/chapter-candidates.ts`
- `packages/novel-plugin/src/handlers/candidate-tool-service.ts`

Design direction:

- Formal chapters remain.
- Candidate/draft semantics become deprecated compatibility only.
- SQLite repository path for writing resources should be phased out for chapters.
- Existing compatibility code must be documented before removal.

### 2. Writing Tools Repositioning

Current files to audit:

- `packages/novel-plugin/src/routes/writing-modes.ts`
- `packages/novel-plugin/src/engine/agents/inline-writer.ts`
- `packages/novel-plugin/src/engine/agents/variant-generator.ts`
- `packages/novel-plugin/src/pages/writing-workbench/VariantsPanel.tsx`
- `packages/novel-plugin/src/pages/writing-workbench/resource-viewers/ChapterEditor.tsx`

Design direction:

- Style extraction outputs preset suggestions, not facts.
- Segment expansion and rewrite are edit actions.
- Multi-version is a major UX domain, not candidate list replacement.
- Chapter finalization writes formal chapter and triggers NarrativeEvent processing.

### 3. Narrative Memory Boundary

Current files to audit:

- `packages/novel-plugin/src/engine/narrative-memory/`
- `packages/novel-plugin/src/routes/narrative-memory.ts`
- `packages/novel-plugin/src/pages/writing-workbench/NarrativeMemoryPanel.tsx`
- `packages/novel-plugin/src/handlers/pipeline-write-service.ts`

Design direction:

- Dynamic facts are written through NarrativeEvent / reducer.
- LLM-generated facts are candidates; reducer and approval decide applied/pending.
- Writing-resource accept logic should not remain the only writeback trigger.

### 4. Jingwei Boundary

Current files to audit:

- `packages/novel-plugin/src/engine/jingwei/`
- `packages/novel-plugin/src/routes/jingwei.ts`
- `packages/novel-plugin/src/handlers/jingwei-write-handler.ts`

Design direction:

- Jingwei is static reference.
- Dynamic facts do not belong here.
- Jingwei can be read by tools and agents but should not be overwritten by dynamic writing processes.

### 5. CodeWiki

CodeWiki must become a code-backed wiki, not only planning notes.

Target structure:

```text
docs/01-codewiki/
├── README.md
├── 00-overview.md
├── architecture/
├── modules/
├── api/
├── data/
├── ui/
├── cleanup/
├── risks/
└── decisions/
```

Each module page should include:

- Status
- Responsibility
- Real code paths
- Main functions/routes/tools
- Inputs
- Outputs
- Calls / called-by summary
- Current problems
- Cleanup / refactor direction
- Maintenance rules

### 6. Docs Entry Rename

`docs/01-当前状态` should be renamed or migrated to:

```text
docs/01-codewiki
```

Design options:

- Move current CodeWiki into `docs/01-codewiki/codewiki/`, or
- Rename the old CodeWiki root to `docs/01-codewiki` and merge current status content into it.

Chosen direction:

- Use `docs/01-codewiki/` as the first docs entry.
- Move or mirror CodeWiki there as the canonical entry.
- Update `docs/README.md` references.
- Avoid duplicate authoritative CodeWiki roots after migration.

## Data Flow

### Writing Result Flow

```text
Tool / Agent result
  → user confirmation
  → formal chapter or multi-version
  → if story facts changed: NarrativeEvent
  → reducer applied/pending
```

### Style Extraction Flow

```text
text sample
  → style extraction
  → preset suggestion
  → user confirmation
  → preset/template/beat config
```

### Deprecated Flow

```text
write result
  → candidate/draft
  → accept/reject/archive
  → chapter
```

This flow should be removed from the primary path.

## Verification Strategy

- `bun run docs:drift`
- package-specific typecheck after code refactors
- focused tests for changed routes/tools
- CodeWiki pages must reference real existing files
- old candidate/draft references should be searchable and accounted for in cleanup pages

## Risks

- Removing candidate/draft too early may break UI routes.
- SQLite writing-resource compatibility may still be needed for existing data migration.
- Multi-version design is large and should not be collapsed into candidate cleanup.
- Renaming docs folder may break documentation links.
