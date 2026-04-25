# Implementation Plan

## Overview

本任务文件从已批准的 `platform-compliance-v1` spec 生成。目标是实现平台敏感词扫描、AI 内容比例估算、格式规范检查、发布就绪汇总和 AI 使用标注生成。

关键执行原则：

- 敏感词库以 JSON 存储，支持外部导入，不硬编码。
- AI 比例估算基于已有 AI 味检测结果，不重复调用检测。
- 所有合规工具是辅助参考，不替代平台实际审核。
- 词库和规则按平台隔离，便于独立更新。

## Tasks

- [ ] 1. 定义合规类型系统
  - 新增 `packages/core/src/compliance/types.ts`。
  - 定义类型：`SensitiveWord`、`SensitiveHit`、`SensitiveScanResult`、`ChapterAiEstimate`、`BookAiRatioReport`、`FormatIssue`、`FormatCheckResult`、`PublishReadinessReport`、`AiDisclosure`。
  - 覆盖 Requirement 5。

- [ ] 2. 构建基础敏感词库
  - 在 `packages/core/src/compliance/dictionaries/` 下创建 JSON 词库：
    - `common.json`：通用敏感词（约 500-800 词），分 8 个类别。
    - `qidian-extra.json`：起点专属屏蔽词。
    - `jjwxc-extra.json`：晋江专属限制词。
    - `fanqie-extra.json`：番茄专属词。
    - `qimao-extra.json`：七猫专属词。
  - 词库格式：`[{ word, category, severity, platforms, suggestion }]`。
  - 添加测试：每个词库 JSON 解析无错误、格式符合 schema。
  - 覆盖 Requirements 1、5。

- [ ] 3. 实现敏感词扫描引擎
  - 新增 `packages/core/src/compliance/sensitive-scanner.ts`。
  - 实现 `loadDictionary(platform)` 加载通用+平台专属词库。
  - 实现 `scanChapter(text, chapterNumber, chapterTitle, dictionary)` 扫描单章。
  - 实现 `scanBook(chapters, platform)` 扫描全书。
  - 支持自定义词库追加。
  - 命中结果包含位置、上下文（前后 30 字）、替代建议。
  - 添加单测：已知词命中、未命中、平台过滤、上下文正确、自定义词库追加。
  - 覆盖 Requirements 1、5。

- [ ] 4. 实现 AI 比例估算
  - 新增 `packages/core/src/compliance/ai-ratio-estimator.ts`。
  - 实现 `estimateChapterAiRatio(aiScore)` 单章估算。
  - 实现 `estimateBookAiRatio(chapters, aiScores)` 全书汇总。
  - 复用 `ai-taste-filter-v1` 的 `detectAIContent()` 结果。
  - 标注平台阈值（起点 0%、晋江 5%、番茄/AIGC 20%）。
  - 添加单测：分段映射、全书汇总、空章节安全、阈值判断。
  - 覆盖 Requirements 2、5。

- [ ] 5. 实现格式规范检查
  - 新增 `packages/core/src/compliance/format-checker.ts`。
  - 实现 `checkFormat(chapters, bookConfig, platform?)` 检查：
    - 章节标题格式。
    - 章节字数范围（< 1000 warn, = 0 block, > 8000 suggest）。
    - 总字数（不同平台有不同首秀/验证要求）。
    - 连续空行（> 3 行 suggest）。
    - 缺少简介。
  - 添加单测：各检查项独立覆盖。
  - 覆盖 Requirements 3、5。

- [ ] 6. 实现发布就绪汇总
  - 新增 `packages/core/src/compliance/publish-readiness.ts`。
  - 实现 `checkPublishReadiness(bookId, platform, chapters, aiScores, bookConfig)` 依次调用敏感词扫描、AI 比例估算、格式检查。
  - 汇总为 `PublishReadinessReport`：按严重等级排序、计算 block/warn/suggest 计数、判定就绪状态。
  - 添加集成测试：全流程执行、汇总正确。
  - 覆盖 Requirements 3、5。

- [ ] 7. 实现 AI 使用标注生成
  - 新增 `packages/core/src/compliance/ai-disclosure-generator.ts`。
  - 实现 `generateAiDisclosure(bookId, aiRatioReport, writingLogs?)` 生成结构化声明。
  - 声明包含：辅助类型、估算比例、模型名称、人工修改说明。
  - 输出为可编辑的 Markdown 文本。
  - 添加测试：格式正确、包含必要字段。
  - 覆盖 Requirements 4、5。

- [ ] 8. 实现合规 API 路由
  - 新增 `packages/studio/src/api/routes/compliance.ts`：
    - `POST /api/books/:bookId/compliance/sensitive-scan`：body 含 platform。
    - `POST /api/books/:bookId/compliance/ai-ratio`。
    - `POST /api/books/:bookId/compliance/format-check`：body 含 platform。
    - `POST /api/books/:bookId/compliance/publish-readiness`：body 含 platform，一键执行全部。
    - `POST /api/books/:bookId/compliance/ai-disclosure`：生成标注。
    - `GET /api/compliance/dictionaries`：列出可用词库。
    - `POST /api/compliance/dictionaries/import`：导入自定义词库。
  - 添加 API 测试。
  - 覆盖 Requirements 1-4、5。

- [ ] 9. 实现敏感词扫描结果 UI
  - 新增 `packages/studio/src/components/compliance/SensitiveWordReport.tsx`。
  - 展示：命中列表（表格）、严重等级 Badge、上下文高亮、一键跳转章节。
  - 支持按类别/严重等级过滤。
  - 使用 shadcn/ui Table + Badge + Button + ScrollArea。
  - 添加组件测试。
  - 覆盖 Requirements 1、5。

- [ ] 10. 实现 AI 比例报告 UI
  - 新增 `packages/studio/src/components/compliance/AiRatioReport.tsx`。
  - 展示：全书总比例 + 每章明细表格 + 平台阈值参考线。
  - 高 AI 比例章节标注警告。
  - 声明"仅供参考"。
  - 使用 shadcn/ui Card + Table + Progress + Badge。
  - 添加组件测试。
  - 覆盖 Requirements 2、5。

- [ ] 11. 实现发布就绪检查页面
  - 新增 `packages/studio/src/pages/PublishReadiness.tsx`。
  - 平台选择下拉 + 开始检查按钮。
  - 检查结果摘要（block/warn/suggest 计数）。
  - 三个可展开卡片：敏感词/AI比例/格式检查。
  - 底部：生成 AI 标注 + 导出报告。
  - 使用 shadcn/ui Card + Accordion + Badge + Select + Button + Dialog。
  - 添加组件测试。
  - 覆盖 Requirements 3、5。

- [ ] 12. 实现 AI 使用标注编辑器 UI
  - 新增 `packages/studio/src/components/compliance/AiDisclosureEditor.tsx`。
  - 展示生成的标注声明 + 可编辑 Textarea。
  - 导出为文本/Markdown。
  - 使用 shadcn/ui Card + Textarea + Button。
  - 添加组件测试。
  - 覆盖 Requirements 4、5。

- [ ] 13. 执行验证
  - 运行 `pnpm typecheck` 和 `pnpm test`。
  - 真实烟测：选择起点平台→扫描敏感词→查看AI比例→格式检查→就绪报告。
  - 真实烟测：切换番茄平台→不同词库+不同阈值→结果变化。
  - 真实烟测：生成 AI 标注→编辑→导出。
  - 覆盖 Requirement 5。

## Done Definition

- 通用词库 500+ 词，4 个平台专属词库各 50+ 词。
- 敏感词扫描正确命中、支持平台切换和自定义词库。
- AI 比例估算基于已有检测结果，分段映射合理。
- 格式检查覆盖 6+ 检查项。
- 发布就绪一键执行三步检查、汇总报告正确。
- AI 使用标注生成格式正确、可编辑导出。
- PublishReadiness 页面完整展示所有检查结果。
- 相关测试、typecheck 通过。
