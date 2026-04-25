# Novel Bible 开发指引（Phase A+B）

## 范围

Phase A 提供 Novel Bible 的最小闭环：SQLite schema、Repository、可见性规则、上下文构建、Studio REST API、最小 UI、写作管线占位注入。

Phase B 在此基础上补齐认知层核心对象：Conflict、WorldModel、Premise、CharacterArc，并把它们接入上下文注入、Studio REST API 与 Bible UI。

非目标：批量导入、版本历史、关系图谱、ai-taste-filter 深度集成、Questionnaire/CoreShift/PGI（Phase C）。

## 数据模型

基础表由 `packages/core/src/storage/migrations/0002_bible_v1.sql` 创建：

- `book`：记录 `bible_mode` 与 `current_chapter`
- `bible_character`：角色，支持别名、角色类型、可见性规则、软删除
- `bible_event`：事件，支持相关角色、伏笔状态、可见性规则、软删除
- `bible_setting`：设定，支持分类、nested refs、可见性规则、软删除
- `bible_chapter_summary`：章节摘要，`metadata_json` 预留 `filterReport` 等后续字段

Phase B 表由 `packages/core/src/storage/migrations/0003_bible_phaseB.sql` 创建：

- `bible_conflict`：矛盾一等公民，含 scope、priority、evolution_path、resolution_state、resolution_chapter 与软删除
- `bible_world_model`：每书 1 行，经济 / 社会 / 地理 / 力量体系 / 文化 / 纪年 6 个 JSON 维度
- `bible_premise`：每书 1 行，logline、theme、tone、targetReaders、uniqueHook、genreTags
- `bible_character_arc`：角色弧线，支持同一角色多条并行弧线、转折点与可见性规则

TypeScript 类型集中在 `packages/core/src/bible/types.ts`，Repository 在 `packages/core/src/bible/repositories/`。

## 可见性规则

`VisibilityRule` 有三类：

- `global`：章节窗口内始终注入
- `tracked`：动态模式下，sceneText 命中名称或别名后注入
- `nested`：父条目被注入后，通过 `nestedRefs` 或 `parentIds` 展开

相关模块：

- `visibility-filter.ts`：章节时间线过滤
- `alias-matcher.ts`：名称/别名命中
- `nested-resolver.ts`：nested BFS + 环保护
- `token-budget.ts`：中文字符 × 0.6 估算 tokens，按认知层顺序与来源优先级裁剪
- `compose-context.ts`：格式化 `【类型】名称：内容`
- `format-descriptor.ts`：WorldModel JSON 维度格式化为中文自然文本
- `stalled-detector.ts`：检测 `escalating` 且超过 10 章未推进的 stalled conflict
- `build-bible-context.ts`：总入口

## 上下文构建 API

核心入口：

```ts
buildBibleContext({
  bookId,
  currentChapter,
  sceneText,
  tokenBudget,
});
```

行为：

- `static`：使用章节窗口内的 global 条目，并注入 Premise / WorldModel / main Conflict / global CharacterArc
- `dynamic`：global + tracked alias 命中 + nested 展开，并按当前章节注入 active Conflict 与命中角色的 CharacterArc
- sceneText 缺失时，dynamic fallback 到 global-only + 认知层锚点
- Phase B 注入顺序：Premise → WorldModel → Character + CharacterArc → Event / Setting → Conflict → nested → ChapterSummary

写作管线通过 `pipeline-bridge.ts` 将 Bible 上下文格式化为 prompt block，并在 `PipelineRunner.createGovernedArtifacts()` 规划/组装上下文前尝试注入；失败时记录 warning 并回退到原 externalContext。

## Studio REST API

路由在 `packages/studio/src/api/routes/bible.ts`。

- `GET/POST /api/books/:bookId/bible/characters`
- `GET/PUT/DELETE /api/books/:bookId/bible/characters/:id`
- `events` / `settings` / `chapter-summaries` 同模式
- `GET/POST /api/books/:bookId/bible/conflicts`
- `GET/PUT/DELETE /api/books/:bookId/bible/conflicts/:id`
- `GET /api/books/:bookId/bible/conflicts/active?chapter=N`
- `GET/PUT /api/books/:bookId/bible/world-model`
- `GET/PUT /api/books/:bookId/bible/premise`
- `GET/POST /api/books/:bookId/bible/character-arcs`
- `GET/PUT/DELETE /api/books/:bookId/bible/character-arcs/:id`
- `POST /api/books/:bookId/bible/preview-context`
- `PATCH /api/books/:bookId/settings` 更新 `bibleMode` / `currentChapter`

Studio 侧使用动态 import core，避免 server tests 中旧 mock 未覆盖新导出时崩溃。

## Studio UI

入口：展开书籍侧栏后点击 `Bible`。

页面：`packages/studio/src/pages/BibleView.tsx`

组件：

- `components/Bible/EntryForm.tsx`
- `components/Bible/VisibilityRuleEditor.tsx`
- `components/Bible/ContextPreviewModal.tsx`

UI 提供：

- Characters / Events / Settings / Chapter Summaries / Conflicts / World / Premise / Character Arcs 八个 Tab
- 结构化新增/更新表单
- 可见性规则下拉与章节窗口输入
- nested 父条目选择
- bible_mode / currentChapter 设置面板
- AI 上下文预览弹窗

## 验证命令

Phase A+B 相关快速验证：

```bash
pnpm --dir packages/core exec vitest run src/__tests__/bible-pipeline-bridge.test.ts src/__tests__/bible-build-context.test.ts src/__tests__/bible-compose-context.test.ts src/__tests__/bible-visibility.test.ts src/__tests__/bible-repositories.test.ts
pnpm --dir packages/studio exec vitest run src/api/routes/bible.test.ts src/routes.test.ts
pnpm --dir packages/core typecheck
pnpm --dir packages/studio typecheck
```

Studio API 测试若依赖刚新增的 core 导出，先执行：

```bash
pnpm --dir packages/core build
```

## Phase B 注意事项

- Conflict 的 active 查询由 `getActiveConflictsAtChapter(bookId, chapter)` 负责，过滤 `resolved` / `deferred`，并按 `evolution_path.first.chapter` 到 `resolution_chapter` 覆盖章节范围
- stalled 检测只标记，不自动修改：`resolutionState = escalating` 且 `currentChapter - lastEvolutionChapter > 10`
- WorldModel 维度 JSON 允许局部为空；空维度不会注入上下文
- Premise / WorldModel 是每书 1:1，使用 upsert 保持唯一行
- CharacterArc 支持同一角色多条并行，注入时跟随已注入角色
- filterReport 写入 `bible_chapter_summary.metadataJson.filterReport`
- Questionnaire / CoreShift / PGI 属于 Phase C，不在本阶段实现
