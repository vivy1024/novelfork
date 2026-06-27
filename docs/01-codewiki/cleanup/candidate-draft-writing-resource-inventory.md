**版本**: v3.0.0
**创建日期**: 2026-06-25
**更新日期**: 2026-06-25
**状态**: current
**文档类型**: current

# Candidate / Draft / Writing Resource 代码级清单

## 1. 清单目的

本页记录当前代码中仍然承载候选稿、草稿、writing-resource 旧模型的真实位置。

这些概念已经不再是目标写作模型的主路径：

- 候选稿：待删除主概念
- 草稿：待删除主概念
- writing-resource：待收口兼容层

目标模型是：

```text
工具输出 → 正式章节 / 多版本 / 配置建议 / NarrativeEvent
```

## 2. 类型与状态源头

### 文件

- `packages/novel-plugin/src/engine/writing-resource/types.ts`

### 当前代码事实

- `WritingResourceType = "chapter" | "candidate" | "draft"`
- `WritingResourceStatus = "draft" | "candidate" | "accepted" | "rejected" | "archived"`
- `normalizeResourceType()` 目前把 `candidate` 和 `draft` 都归一为应用层 `draft`

### 分类

- `chapter`：保留，结果层对象
- `candidate`：待删除主概念；短期只允许兼容
- `draft`：待删除主概念；短期只允许兼容
- `accepted/rejected/archived`：候选稿/草稿状态机遗留，待移除主路径

### 问题

类型层仍把 candidate/draft 定义为一等类型，导致后续 service、route、UI 都容易复活旧模型。

### 处理方向

- 保留章节结果模型
- 将 candidate/draft 标注为 deprecated compatibility
- 最终从主 API 和主 UI 中移除

## 3. Writing Resource 服务层

### 文件

- `packages/novel-plugin/src/engine/writing-resource/service.ts`
- `packages/novel-plugin/src/engine/writing-resource/file-store.ts`
- 已删除的 writing-resource repository 旧实现
- `packages/novel-plugin/src/engine/writing-resource/migrate-to-files.ts`
- 已删除的 migrate-from-files 旧迁移入口

### 主要函数

- `createWritingResourceService()`
- `createWritingResourceFileStore()`
- `createWritingResourceRepository()`
- `acceptFileResource()`
- `normalizeResourceType()`

### 当前职责

- 列出资源
- 创建资源
- 更新资源
- soft delete
- 状态流转
- 查找 accepted chapter
- 文件系统与 SQLite repository 兼容

### 调用方

代码图谱显示 `createWritingResourceService()` 曾被以下入口调用；当前旧 candidate handler 已删除：

- `packages/novel-plugin/src/handlers/pipeline-write-service.ts`
- `packages/novel-plugin/src/routes/writing-resource.ts`
- 已删除的 Studio chapter-candidates 旧路由
- `packages/studio/src/api/lib/session-tool-executor.ts`
- 旧 `candidate.create_chapter` handler：已删除，不再作为可跳转代码路径引用

### 分类

- 保留：正式章节文件系统能力
- 兼容：SQLite repository 后端
- 待删：candidate/draft 状态流转
- 待改：NarrativeEvent 回写不应只绑定 candidate accept 流程

### 问题

- service 同时承担章节、候选稿、草稿、状态机、双存储兼容、叙事回写触发职责
- repository 仍让 SQLite 成为 writing-resource 的完整后端
- file-store 仍有 `drafts/` 和 status=candidate/draft 语义

### 处理方向

1. 短期把 candidate/draft 标记为兼容路径
2. 中期拆出正式章节结果层服务
3. 长期移除 SQLite writing-resource 主语义

## 4. Novel Plugin writing-resource HTTP 路由

### 文件

- `packages/novel-plugin/src/routes/writing-resource.ts`

### 路由

- `GET /api/books/:bookId/resources`
- `GET /api/books/:bookId/resources/:resourceId`
- `POST /api/books/:bookId/resources`
- `PUT /api/books/:bookId/resources/:resourceId`
- `POST /api/books/:bookId/resources/:resourceId/transition`
- `DELETE /api/books/:bookId/resources/:resourceId`
- `GET /api/books/:bookId/resources/:resourceId/history`

### 关键函数

- `createWritingResourceRouter()`
- `parseCreateInput()`
- `parseTransition()`
- `isType()`
- `isStatus()`

### 当前代码事实

- `parseCreateInput()` 默认 `type = "draft"`
- 非 chapter 默认 `status = "candidate"`
- `parseTransition()` 暴露 `accept/reject/archive/to-draft/to-candidate/restore`
- `isType()` 接受 `chapter/candidate/draft`
- `isStatus()` 接受 `draft/candidate/accepted/rejected/archived`

### 分类

- 待删除主路径
- 可短期保留为兼容 API

### 问题

该路由完整暴露旧资源状态机，是 candidate/draft 概念回流的主要入口之一。

### 处理方向

- 从公开主路由中下线或隐藏
- 若必须保留，标记为 deprecated compatibility
- 新主路径应转向章节编辑、版本、叙事回写 API

## 5. Studio chapter-candidates 路由

### 文件

- 已删除的 Studio chapter-candidates 旧路由

### 路由与行为

- `GET /api/books/:id/candidates`
- `GET /api/books/:id/drafts`
- `GET /api/books/:id/drafts/:draftId`
- `POST /api/books/:id/drafts`
- `PUT /api/books/:id/drafts/:draftId`
- `POST /api/books/:id/candidates`
- `POST /api/books/:id/candidates/:candidateId/accept`
- `POST /api/books/:id/candidates/:candidateId/reject`
- `POST /api/books/:id/candidates/:candidateId/archive`
- `DELETE /api/books/:id/drafts/:draftId`
- `DELETE /api/books/:id/candidates/:candidateId`

### 关键函数

- `createChapterCandidatesRouter()`
- `loadCandidates()`
- `saveCandidates()`
- `saveCandidateContent()`
- `updateCandidateStatus()`
- `saveDraftCandidate()`
- `loadDrafts()`
- `saveDraft()`

### 当前代码事实

- 同时存在新 writing-resource service 路径和旧 `generated-candidates/`、`drafts/` 文件索引路径
- accept/reject/archive/delete 是候选稿主语义
- drafts API 仍是独立一等路径

### 分类

- 待删除 / 待迁移

### 问题

这是旧候选稿/草稿产品模型最完整的遗留入口，并且保留了旧文件目录语义。

### 处理方向

- 不再作为主 UI/API 暴露
- 删除或迁移前需要确认 UI 调用方
- 旧数据迁移到正式章节、多版本或废弃归档策略

## 6. Candidate tool service

### 文件

- 旧 candidate tool service 文件已删除（原路径为 novel-plugin handlers 下的 candidate-tool-service.ts），不再作为可跳转代码路径引用。

### 旧主要函数

- `createCandidateToolService()`（已删除）
- `createChapter()`（已删除）
- `candidateArtifact()`（已删除）
- `buildCandidatePrompt()`
- `runPostWriteComplianceCheck()`

### 当前代码事实

- tool source 为 `session-tool:candidate.create_chapter`
- 生成标题默认包含“候选稿”
- prompt 明确要求“进入作品候选区，不覆盖正式章节”
- 创建 `type: "draft"` 且 `status: "candidate"` 的 writing resource
- artifact kind 为 `candidate`

### 分类

- 待删除主工具
- 可迁移为版本生成或章节结算工具

### 问题

该工具直接把候选稿作为 Agent 工具结果，是旧模型在 Agent 工具层的核心入口。

### 处理方向

- 废弃 `candidate.create_chapter`
- 替代为：章节版本生成 / 章节结算 / 正式章节写入工具
- artifact 不应再是 candidate

## 7. Writing modes route

### 文件

- `packages/novel-plugin/src/routes/writing-modes.ts`

### 当前候选稿/草稿相关类型与函数

- `WritingModeApplyTarget = "candidate" | "draft" | "chapter-insert" | "chapter-replace"`
- `CandidateRecord`
- `DraftRecord`
- `parseApplyTarget()`
- `defaultApplyTitle()`
- `saveCandidateRecord()`
- `saveDraftRecord()`

### 相关路由

- `POST /api/books/:bookId/inline-write`
- `POST /api/books/:bookId/writing-modes/apply`
- `POST /api/books/:bookId/candidates/create`
- `POST /api/books/:bookId/variants/generate`
- `GET /api/style/personal-profile`
- `POST /api/books/:bookId/style/drift-check`

### 当前代码事实

- inline-write system prompt 仍说“进入作品候选区”
- execute-prompt system prompt 仍说“进入作品候选区”
- apply target 支持 candidate/draft
- chapter-insert / chapter-replace 也最终保存为 candidate record
- style profile / drift check 已经更接近配置/分析工具，不应进入叙事记忆
- variants/generate 已存在，是多版本方向的基础

### 分类

- 保留：inline-write、rewrite、variants、style profile、style drift
- 待改：apply target 中的 candidate/draft
- 待改：系统提示词中的“候选区”
- 待删：`/api/books/:bookId/candidates/create`

### 处理方向

- 将写作模式 apply 结果改为章节编辑 / 版本 / 预设建议
- variants 独立发展为多版本功能域
- 删除 candidate/draft target 主路径

## 8. Tool schema 与 Agent 工具入口

### 文件

- `packages/novel-plugin/src/tool-schemas.ts`
- `packages/novel-plugin/src/handlers/index.ts`
- `packages/novel-plugin/src/handler-registry.ts`
- `packages/studio/src/api/lib/session-tool-executor.ts`

### 当前风险

- `candidate.create_chapter` 仍可能通过工具 schema 和 executor 注册进入 Agent 可用工具
- 需要在工具注册层确认其暴露状态

### 分类

- 待盘点后删除或隐藏

### 处理方向

- 从默认工具集中移除候选稿工具
- 如果短期保留，必须标记 deprecated

## 9. UI 调用方

### 文件命中

- 已删除的 CandidateCreatedCard 工具结果卡
- `packages/studio/src/app-next/tool-results/PipelineChapterResultCard.tsx`
- 已删除的 CandidateActionsBar
- 已删除的 DraftActionsBar
- `packages/novel-plugin/src/pages/writing-workbench/VariantsPanel.tsx`
- `packages/novel-plugin/src/pages/writing-workbench/WorkbenchResourceTree.tsx`
- `packages/novel-plugin/src/pages/writing-workbench/WorkbenchCanvas.tsx`
- `packages/novel-plugin/src/pages/writing-workbench/resource-viewers/index.tsx`

### 分类

- 保留：VariantsPanel，多版本方向
- 保留并整理：PipelineChapterResultCard，如果它代表正式章节写作结果
- 待删/替换：CandidateCreatedCard、CandidateActionsBar、DraftActionsBar
- 待审计：WorkbenchResourceTree / WorkbenchCanvas / resource-viewers 是否仍把 candidate/draft 作为主资源类型

### 处理方向

- UI 不再展示候选稿/草稿为主概念
- 多版本独立展示
- 正式章节作为结果层展示

## 10. SQLite 与迁移

### 文件

- `packages/core/src/storage/migrations/0016_writing_resource.sql`
- `packages/core/src/storage/schema.ts`
- 已删除的 writing-resource repository 旧实现
- `packages/novel-plugin/src/engine/writing-resource/migrate-to-files.ts`
- 已删除的 migrate-from-files 旧迁移入口

### 分类

- SQLite writing_resource：待停止扩展
- migrate-to-files：保留为迁移工具
- migrate-from-files：需审计是否仍需要；可能与“文件系统主存储”方向冲突

### 处理方向

- SQLite 不再作为章节资源主语义
- 保留必要迁移能力
- 删除或冻结反向迁移路径

## 11. 初步优先级

### P0：必须先处理

1. 工具 schema / handler 注册中的 `candidate.create_chapter`
2. writing-modes apply target 的 candidate/draft
3. chapter-candidates route 的公开主路径
4. writing-resource route 的状态机暴露

### P1：随后处理

1. CandidateCreatedCard / CandidateActionsBar / DraftActionsBar
2. SQLite writing_resource repository 兼容层
3. generated-candidates / drafts 文件目录兼容

### P2：设计后处理

1. 多版本存储与 UI
2. 章节结算工具
3. 叙事记忆回写从 candidate accept 剥离

## 12. 验收要求

本清单对应 spec task 1。完成 task 1 的最低验收：

- 候选稿 / 草稿 / writing-resource 的真实入口已列出
- 每个入口有真实文件路径
- 每个入口有 remove / rename / compatibility / keep 分类
- 文档引用可通过 `bun run docs:drift`
