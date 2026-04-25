# Implementation Plan

## Overview

Novel Bible v1（现已扩展为**认知层 v1**）。**前置**：`storage-migration` 完成。

分 **3 个 Phase**，约 25-30 个工作日，每个 Phase 可独立产出可用 MVP：

| Phase | 范围 | 工期 | 产出 |
|---|---|---|---|
| **A** | 原 Bible 4 表 + 三可见性 + 时间线 + 双模式 + 上下文 API + 最小 UI + 写作管线接口 | 10-14 天 | 基础 Bible MVP 可用 |
| **B** | Conflict（一等公民） + WorldModel（5 维） + Premise + CharacterArc | 7-9 天 | 结构化深度 + 矛盾追踪 |
| **C** | Questionnaire 问卷系统 + CoreShift 变更协议 + PGI 生成前引导 | 8-10 天 | 引导式创作闭环 |

**关键原则**：每个 Phase 结束均可独立上线；后续 Phase 不破坏前置 Phase 已有能力。

---

## Phase A：Bible 基础（原 8 任务）

- [x] A1. Schema 与 Repository（Phase A）
  - 在 `packages/core/src/storage/schema.ts` 追加：`book`、`bible_character`、`bible_event`、`bible_setting`、`bible_chapter_summary`
  - 生成 migration `0002_bible_v1.sql`
  - 新建 `packages/core/src/bible/types.ts`：`VisibilityRule` / `BibleMode` / `BibleContextItem` / `BuildBibleContextResult`
  - 新建 `repositories/`：`book-repo.ts` / `character-repo.ts` / `event-repo.ts` / `setting-repo.ts` / `chapter-summary-repo.ts`
  - 软删除支持（`deletedAt`）
  - 单测：CRUD / 多 book 隔离 / 软删过滤

- [ ] A2. 可见性规则引擎
  - `visibility-filter.ts`：时间线过滤（visibleAfterChapter / visibleUntilChapter）
  - `nested-resolver.ts`：BFS + 深度 cap 3 + 环保护
  - `alias-matcher.ts`：Aho-Corasick 构建 + 扫描，支持 name + aliases
  - 单测：每种 type 命中 / 不命中 / 边界章节 / nested 环
  - 性能：500 条目 + 10000 字 sceneText <50ms

- [ ] A3. token-budget 与 composer
  - `token-budget.ts`：估算 tokens（中文字符 × 0.6）+ 按优先级丢弃
  - `compose-context.ts`：格式化 `【类型】名称：内容` 结构
  - 单测：预算不够 / 刚好够 / 绰绰有余三种场景
  - 测试丢弃优先级：tracked 先于 nested 先于 global

- [ ] A4. buildBibleContext 总入口
  - `build-bible-context.ts`：串联以上模块
  - 处理 static / dynamic 两种 bibleMode
  - 当 sceneText 缺失时 fallback 到 global-only
  - 集成测试：使用 fixture book（含 30+ 条目）验证输出完整性
  - **预留扩展点**：`injectPremise()` / `injectWorldModel()` / `injectConflicts()` / `injectCharacterArcs()` 为 Phase B stubs，返回空数组

- [ ] A5. REST API（Bible 四表）
  - 新建 `packages/studio/src/api/routes/bible/`：4 类实体各 GET/POST/PUT/DELETE
  - `preview-context.ts`：POST 接口
  - `book-settings.ts`：PATCH bibleMode / currentChapter
  - zod 校验 + 错误码
  - API 测试：每个路由 happy path + 错误路径

- [ ] A6. Studio UI 最小可用
  - 侧栏新增 Bible 入口
  - 4 Tabs 列表 + 结构化表单（`EntryForm.tsx`）
  - `VisibilityRuleEditor.tsx`：下拉 + 章节数字输入 + nested 父选择
  - Book Settings Panel 添加 bibleMode 切换
  - `ContextPreviewModal.tsx`：展示注入清单 / tokens / 丢弃理由
  - 样式复用现有 NovelFork Studio 设计系统

- [ ] A7. 与写作管线的接口（占位）
  - 在 AI 写作管线的上下文构建点，调用 `buildBibleContext()` 并拼接到 prompt
  - 留出 `bible_chapter_summary.metadataJson.filterReport` 字段，供 ai-taste-filter-v1 写入
  - 本任务不实现 filter 集成本身，仅确认字段与接口稳定

- [ ] A8. Phase A 测试、性能与文档
  - 运行 `pnpm --filter ... test`
  - 运行 `pnpm --filter ... typecheck`
  - E2E：创建 book → 加 5 角色 + 3 事件 + 5 设定 → 预览上下文 → 断言注入集正确
  - 新建 `docs/04-开发指南/Bible开发指引.md`（Phase A 版）
  - 更新 07 调研文档的路线图勾选 Phase A

---

## Phase B：Conflict + WorldModel + Premise + CharacterArc

- [ ] B1. Phase B Schema 与 Repository
  - 在 `packages/core/src/storage/schema.ts` 追加：`bible_conflict`、`bible_world_model`、`bible_premise`、`bible_character_arc`
  - 生成 migration `0003_bible_phaseB.sql`
  - 新建 repo：`conflict-repo.ts` / `world-model-repo.ts` / `premise-repo.ts` / `character-arc-repo.ts`
  - 单测：CRUD / 唯一约束（premise/world-model 1:1）/ character-arc 多条并行
  - 单测：`getActiveConflictsAtChapter(bookId, chapter)` 正确覆盖 `resolution_state` 过滤 + 章节范围

- [ ] B2. Conflict 注入与 Stalled 检测
  - `injectConflicts()` 填入 Phase A 的扩展点
  - `stalled-detector.ts`：扫 `escalating` + 超过 10 章未推进
  - UI：新增「Conflicts」Tab（列表 + 结构化表单 + stalled 徽章）
  - REST API：`/api/books/:bookId/bible/conflicts/*`、`/active?chapter=N`
  - 单测：在场矛盾查询 / stalled 检测 / 注入顺序

- [ ] B3. WorldModel 注入与 UI
  - `injectWorldModel()` 填入 Phase A 扩展点
  - `format-descriptor.ts`：各子字段格式化为中文自然文本
  - UI：新增「World」Tab（5 维卡片式表单，每个可独立展开/折叠）
  - REST API：`GET/PUT /api/books/:bookId/bible/world-model`（1:1）
  - 单测：空维度跳过 / 注入文本格式 / 非法 JSON 兜底

- [ ] B4. Premise + CharacterArc 注入与 UI
  - `injectPremise()` + `injectCharacterArcs()` 填入 Phase A 扩展点
  - 更新 `buildBibleContext` 的组装顺序（Premise 首 → WorldModel → Character+Arc → Event/Setting → Conflict → nested → ChapterSummary）
  - UI：BookCreate 完成后弹出 Premise 编辑弹窗（可跳过）
  - UI：Character 表单下方附 CharacterArcs 子列表
  - REST API：`GET/PUT /api/books/:bookId/bible/premise` + `/character-arcs/*`
  - 单测：注入顺序 / Character 与 Arc 的关联注入 / 多 Arc 并行

- [ ] B5. Phase B 测试、性能与文档
  - 集成测试：一本书含 Premise + WorldModel 3 维 + 5 Conflicts + 3 Characters × 2 Arcs → 第 50 章 `buildBibleContext` 输出验证
  - 性能：500 条目 + 10 矛盾 + 完整 WorldModel → <150ms
  - 更新 `docs/04-开发指南/Bible开发指引.md`（Phase B 段）
  - 07 路线图勾选 Phase B

---

## Phase C：Questionnaire + CoreShift + PGI

- [ ] C1. Phase C Schema 与 Seed
  - 在 `packages/core/src/storage/schema.ts` 追加：`questionnaire_template`、`questionnaire_response`、`core_shift`
  - 生成 migration `0004_bible_phaseC.sql`
  - 新建 `packages/core/src/bible/questionnaires/seed/`：3 套 Tier 1（通用/玄幻/都市）+ 5 套 Tier 2 + 1 套 Tier 3 的 builtin JSON
  - 启动时 idempotent 写入 `questionnaire_template`（按 `id + version` 去重）
  - 单测：seed 幂等 / 模板 JSON 合法性校验

- [ ] C2. Questionnaire 提交引擎
  - `apply-mapping.ts`：按 `questions_json[i].mapping` 规则把答案写入 `bible_*` 表
  - `submit-response.ts`：事务化提交（要么全成要么全不成）
  - `ai-suggest.ts`：调 writer/worldbuilder agent 返回候选答案
  - REST API：`GET /api/questionnaires?genre=&tier=` / `POST /api/books/:bookId/questionnaires/:templateId/responses` / `PUT .../responses/:id` / `POST .../ai-suggest`
  - 单测：mapping 各 transform / 事务回滚 / dependsOn 跳过 / AI suggest 失败降级

- [ ] C3. Questionnaire UI
  - `QuestionnaireWizard.tsx`：分步骤向导（进度条 + 返回/跳过/AI 建议按钮）
  - 集成到 BookCreate 成功回调：自动弹 Tier 1 问卷（可跳过）
  - Book Detail 新增「问卷中心」Tab：列出所有 template（按 tier） + 已填 response
  - 支持"稍后再填"：draft 自动保存 + 重入继续
  - 单测：向导状态机 / AI 建议 UI 展开 / 跳过路径

- [ ] C4. Dynamic 模式滞后问卷
  - 章节保存后（`appendChapterSummary` 钩子）扫描新人物/设定/矛盾未建档
  - 生成临时 "ratify-questionnaire" 注入前端侧边栏
  - 作者响应后调用 submit-response 走事务提交
  - 单测：章节文本扫描 / 未建档识别 / ratify 流程

- [ ] C5. CoreShift 协议引擎
  - `core-shift-repo.ts` + `impact-analysis.ts`：扫 `chapter_summary` / `conflict.evolution_path` / `character_arc.turning_points`
  - REST API：`POST /api/books/:bookId/core-shifts` / `POST .../core-shifts/:id/accept` / `.../reject` / `GET .../core-shifts?status=`
  - 集成：修改 premise / 主线 conflict / world-model / character-arc 时自动创建 proposed
  - 单测：影响分析 / accept 回写 / reject 恢复 / 幂等

- [ ] C6. CoreShift UI
  - Book Detail 新增「变更历史」Tab：时间线 + diff + 影响章节 + accept/reject 按钮
  - 章节列表中 affected 章节显示橙色"需复核"徽章
  - 清除徽章：作者手动点"已复核"或 rewrite/revise 该章

- [ ] C7. PGI（Pre-Generation Interrogation）
  - `pgi-engine.ts`：启发式规则生成 2-5 个问题（矛盾 escalating / 伏笔到期 / 人设漂移 stub / 大纲偏离 stub）
  - REST API：`POST /api/books/:bookId/chapters/:chapter/pre-generation-questions`
  - UI：writer session 发起生成前，先弹 PGI 弹窗（可关闭）
  - 答案以 `pgi_answers` 结构化字段注入 writer prompt
  - 写入 `session_message.metadata_json.pgi_answers` 便于审计
  - 跳过 PGI 时在 filter 报告中标注
  - 单测：每条规则正例 / 规则不触发时返回空 / 截断到 5 题

- [ ] C8. Phase C 测试、文档与路线图
  - E2E：创建新书 → 走完 Tier 1 问卷 → Bible 自动生成 → 写第 1 章（触发 PGI）→ 修改主线 conflict（触发 CoreShift）→ accept
  - 更新 `docs/04-开发指南/Bible开发指引.md`（Phase C 段，含问卷模板扩展指南）
  - 07 路线图勾选 Phase C 完成、声明"认知层 v1 MVP 完整"
  - 记忆 MCP：问卷模板命名约定 / CoreShift 事务边界 / PGI 规则扩展点

---

## Done Definition（全 Phase 完成）

### Phase A
- Bible 4 表 + migration 落地
- buildBibleContext() 单测覆盖三档可见性 + 时间线 + 两种模式
- REST API 全部可用并有测试
- Studio UI 能增删改查 + 预览 + 切换模式
- typecheck 通过
- 至少一次烟测：在自有项目上创建 3 章 Bible 并通过 AI 写作验证注入生效

### Phase B
- Conflict / WorldModel / Premise / CharacterArc 4 表 + migration
- `getActiveConflictsAtChapter` / stalled 检测 / WorldModel 空维度跳过 全部测试通过
- 注入顺序按 Premise → WorldModel → Character+Arc → Event/Setting → Conflict → nested → ChapterSummary
- UI：Conflicts / World / Premise / Character Arcs 均可操作
- 集成烟测：50 章规模的 book 正确输出上下文

### Phase C
- 3 张新表 + migration + 至少 10 套 builtin 问卷 seed
- BookCreate 后自动弹 Tier 1 问卷（可跳过）
- dynamic 模式滞后问卷工作
- CoreShift proposed / accepted / rejected 全路径测试
- PGI 规则 1-2 实现，规则 3-4 stub 预留
- E2E 通过
- 07 路线图标记"认知层 v1 MVP 完整"
