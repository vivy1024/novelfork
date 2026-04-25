# Novel Bible 开发指引（Phase A）

## 范围

Phase A 提供 Novel Bible 的最小闭环：SQLite schema、Repository、可见性规则、上下文构建、Studio REST API、最小 UI、写作管线占位注入。

非目标：批量导入、版本历史、关系图谱、ai-taste-filter 深度集成、Conflict/Character Arc 等认知层对象的完整实现。

## 数据模型

核心表由 `packages/core/src/storage/migrations/0002_bible_v1.sql` 创建：

- `book`：记录 `bible_mode` 与 `current_chapter`
- `bible_character`：角色，支持别名、角色类型、可见性规则、软删除
- `bible_event`：事件，支持相关角色、伏笔状态、可见性规则、软删除
- `bible_setting`：设定，支持分类、nested refs、可见性规则、软删除
- `bible_chapter_summary`：章节摘要，`metadata_json` 预留 `filterReport` 等后续字段

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
- `token-budget.ts`：中文字符 × 0.6 估算 tokens，按 tracked → nested → global 丢弃
- `compose-context.ts`：格式化 `【类型】名称：内容`
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

- `static`：只使用章节窗口内的 global 条目
- `dynamic`：global + tracked alias 命中 + nested 展开
- sceneText 缺失时，dynamic fallback 到 global-only
- Phase B 扩展点 `injectPremise()` / `injectWorldModel()` / `injectConflicts()` / `injectCharacterArcs()` 当前返回空数组

写作管线通过 `pipeline-bridge.ts` 将 Bible 上下文格式化为 prompt block，并在 `PipelineRunner.createGovernedArtifacts()` 规划/组装上下文前尝试注入；失败时记录 warning 并回退到原 externalContext。

## Studio REST API

路由在 `packages/studio/src/api/routes/bible.ts`。

- `GET/POST /api/books/:bookId/bible/characters`
- `GET/PUT/DELETE /api/books/:bookId/bible/characters/:id`
- `events` / `settings` / `chapter-summaries` 同模式
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

- Characters / Events / Settings / Chapter Summaries 四个 Tab
- 结构化新增表单
- 可见性规则下拉与章节窗口输入
- nested 父条目选择
- bible_mode / currentChapter 设置面板
- AI 上下文预览弹窗

## 验证命令

Phase A 相关快速验证：

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

## 后续 Phase B 注意事项

- Conflict、Premise、World Model、Character Arc 应复用 Phase A 的可见性与 token budget 管线
- filterReport 写入 `bible_chapter_summary.metadataJson.filterReport`
- 若引入批量导入或关系图谱，另起 spec，不塞回 Phase A
