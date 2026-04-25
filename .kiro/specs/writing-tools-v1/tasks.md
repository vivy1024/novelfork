# Implementation Plan

## Overview

本任务文件从已批准的 `writing-tools-v1` spec 生成。目标是实现九个写作辅助工具：章节钩子生成器、POV 视角管理、日更进度追踪、段落节奏可视化、对话比例分析、全书健康仪表盘、矛盾辩证追踪、角色弧线长程追踪、题材文风一致性守护。

关键执行原则：

- 工具是辅助性的，不阻断写作流程。
- 节奏分析和对话分析复用已有 `style-analyzer.ts` 和 `extractDialogueFingerprints` 的逻辑，不重复造轮子。
- 钩子生成器需要 AI 模型，走 AI gate；其他工具纯本地计算。
- 日更进度数据存 SQLite，不依赖文件系统。
- 全书健康仪表盘复用已有引擎（ContinuityAuditor、hookHealth、longSpanFatigue、stalledDetector、aiTells），不重新计算。
- 矛盾辩证追踪扩展已有 `bible_conflict` 表，不新建独立表。
- 角色弧线追踪在 `character_matrix` 基础上扩展 arc beat 数据。
- 文风偏离检测复用 `style_profile` 统计特征。

## Tasks

- [ ] 1. 定义工具类型系统
  - 新增 `packages/core/src/tools/` 目录结构。
  - 定义类型：`GeneratedHook`、`HookStyle`、`HookGeneratorInput`、`PovCharacter`、`PovDashboard`、`PovWarning`、`WritingLog`、`DailyProgress`、`ProgressConfig`、`RhythmAnalysis`、`RhythmIssue`、`DialogueAnalysis`、`ChapterAuditLog`、`BookHealthSummary`、`ConflictDialecticExtension`、`CharacterArc`、`ArcBeat`、`ArcType`、`ToneDriftResult`。
  - 覆盖 Requirements 6-10。

- [ ] 2. 实现段落节奏分析器
  - 新增 `packages/core/src/tools/analysis/rhythm-analyzer.ts`。
  - 扩展 `analyzeStyle()` 逻辑：句长直方图（5字区间分桶）、段落长度序列、节奏评分、与 `style_profile.json` 对比偏差。
  - 实现 `analyzeRhythm(text, referenceProfile?)` 纯本地函数。
  - 实现句子定位：返回每个句子在原文中的 start/end 偏移，支持 UI 高亮。
  - 添加单测：均匀句长→低分、混合句长→高分、空文本→安全返回、对比偏差计算。
  - 覆盖 Requirements 4、6。

- [ ] 3. 实现对话比例分析器
  - 新增 `packages/core/src/tools/analysis/dialogue-analyzer.ts`。
  - 复用 Writer Agent 的对话正则，实现 `analyzeDialogue(text, chapterType?)`。
  - 计算：对话总字数、对话比例、按角色分组、参考范围判断、健康度判定。
  - 添加单测：纯叙述→0%、纯对话→100%、混合→比例正确、角色分组正确。
  - 覆盖 Requirements 5、6。

- [ ] 4. 实现章节钩子生成器
  - 新增 `packages/core/src/tools/chapter-hooks/hook-generator.ts`。
  - 实现 `generateChapterHooks(input, llmConfig)` 函数，调用 LLM 生成 3-5 个钩子方案。
  - 解析 LLM 输出为 `GeneratedHook[]` 结构。
  - 钩子类型分类：suspense/reversal/emotional/info-gap/action/mystery/cliffhanger。
  - 添加单测（mock LLM）：输出格式正确、至少 3 个方案、每个方案有类型和 text。
  - 覆盖 Requirements 1、6。

- [ ] 5. 实现 POV 视角追踪器
  - 新增 `packages/core/src/tools/pov/pov-tracker.ts`。
  - 实现 `buildPovDashboard(characterMatrix, chapterSummaries, currentChapter)` 纯本地函数。
  - 从 `character_matrix.md` 提取 POV 标记角色。
  - 从 `chapter_summaries.md` 统计每章 POV。
  - 计算 gap、生成警告、建议下一章 POV。
  - 单视角书籍返回空 dashboard。
  - 添加单测：多视角统计、gap 警告、单视角跳过、角色缺失容错。
  - 覆盖 Requirements 2、6。

- [ ] 6. 实现日更进度追踪
  - 依赖：migration 编号需排在 `narrafork-platform-upgrade` 存储收口之后（Bun SQLite 驱动确认后再加表）。
  - 新增 `packages/core/src/tools/progress/daily-tracker.ts`。
  - 新增 SQLite migration：`writing_log` 表（book_id, chapter_number, word_count, completed_at, date）。
  - 实现 `recordChapterCompletion(log)`、`getDailyProgress(config)`、`getProgressTrend(days)`。
  - streak 计算：从今天往前连续达标天数。
  - 预计完成日期：(剩余章数 × 平均字数) / 日均字数。
  - 添加单测：记录/查询、streak 计算、跨天边界、零数据安全。
  - 覆盖 Requirements 3、6。

- [ ] 7. 实现写作工具 API 路由
  - 新增 `packages/studio/src/api/routes/writing-tools.ts`：
    - `POST /api/books/:bookId/hooks/generate`：生成章末钩子（走 AI gate）。
    - `GET /api/books/:bookId/pov`：获取 POV 仪表盘。
    - `GET /api/progress`：获取日更进度。
    - `PUT /api/progress/config`：设置日更目标。
    - `POST /api/books/:bookId/chapters/:ch/rhythm`：分析章节节奏。
    - `POST /api/books/:bookId/chapters/:ch/dialogue`：分析章节对话。
  - 添加 API 测试。
  - 覆盖 Requirements 1-5、6。

- [ ] 8. 实现段落节奏可视化 UI
  - 新增 `packages/studio/src/components/writing-tools/RhythmChart.tsx`。
  - 句长分布直方图（当前章节蓝色 + 参考文本灰色虚线）。
  - 段落长度折线图。
  - 点击直方图区间→高亮正文中对应句子。
  - 使用轻量 SVG 或 recharts（如已有依赖）。
  - 添加组件测试。
  - 覆盖 Requirements 4、6。

- [ ] 9. 实现对话分析 UI
  - 新增 `packages/studio/src/components/writing-tools/DialogueAnalysis.tsx`。
  - 对话比例条形图 + 参考范围标注。
  - 角色对话占比表格。
  - 健康度指示。
  - 使用 shadcn/ui Card + Table + Progress + Badge。
  - 添加组件测试。
  - 覆盖 Requirements 5、6。

- [ ] 10. 实现章节钩子生成 UI
  - 依赖：复用 `narrafork-platform-upgrade` P0-4 的 AI gate 实现。
  - 新增 `packages/studio/src/components/writing-tools/ChapterHookGenerator.tsx`。
  - 章节编辑器侧栏入口按钮。
  - 展示 3-5 个钩子方案：RadioGroup 选择 + 类型 Badge + 效果评估。
  - 选择后插入章末 + 更新 pending_hooks。
  - 模型未配置时走 AI gate 提示。
  - 添加组件测试。
  - 覆盖 Requirements 1、6。

- [ ] 11. 实现 POV 仪表盘 UI
  - 新增 `packages/studio/src/components/writing-tools/PovDashboard.tsx`。
  - 书籍总览页嵌入：角色列表 + 章节数 + 最近出现 + gap 警告。
  - POV 建议卡片。
  - 单视角书籍不显示。
  - 使用 shadcn/ui Card + Table + Badge + Progress。
  - 添加组件测试。
  - 覆盖 Requirements 2、6。

- [ ] 12. 实现日更进度 UI
  - 新增 `packages/studio/src/components/writing-tools/DailyProgressTracker.tsx`。
  - 首页/书籍总览嵌入：今日字数环形图 + streak 显示 + 30 天趋势折线。
  - 设置日更目标入口。
  - 达标状态和预计完成日期。
  - 使用 shadcn/ui Card + Progress + Badge + Button。
  - 添加组件测试。
  - 覆盖 Requirements 3、6。

- [ ] 13. 将钩子生成器接入写作管线
  - 在章节审计报告中增加"生成章末钩子"入口链接。
  - 选择钩子后自动更新 `pending_hooks.md`（新增一条 hook，status=planted）。
  - 添加集成测试：写章→审计→生成钩子→选择→hooks 更新。
  - 覆盖 Requirement 1。

- [ ] 14. 将日更记录接入章节完成流程
  - 在 PipelineRunner 的章节完成流程中自动调用 `recordChapterCompletion()`。
  - 确保导入已有章节时也补录写作日志。
  - 添加集成测试。
  - 覆盖 Requirement 3。

- [ ] 15. 实现章节审计日志持久化
  - 依赖：migration 编号排在 `writing_log` 之后。
  - 新增 SQLite migration：`chapter_audit_log` 表（book_id, chapter_number, audited_at, continuity_passed, continuity_issue_count, ai_taste_score, hook_health_issues, long_span_fatigue_issues, sensitive_word_count, chapter_type, mood, pov_character, conflicts_advanced JSON, arc_beats JSON）。
  - 在 `writeNextChapter()` 和 `reviseDraft()` 审计阶段末尾写入审计结果。
  - 添加单测：写入/读取/覆盖更新。
  - 覆盖 Requirement 6 前置。

- [ ] 16. 实现全书健康仪表盘聚合逻辑
  - 新增 `packages/core/src/tools/health/book-health-summary.ts`。
  - 实现 `buildBookHealthSummary(bookId)` 从 `chapter_audit_log` 聚合：一致性得分、伏笔回收率、AI味均值+趋势、节奏多样性（Shannon 熵）、情绪曲线、敏感词总数。
  - 调用已有引擎汇总预警：`detectStalledConflicts`、`analyzeHookHealth`、`analyzeLongSpanFatigue`。
  - 整合主线偏离预警（`detectMainConflictDrift`）、POV gap 预警、角色弧线预警。
  - 数据不足（<5 章）降级处理。
  - 添加单测：正常聚合、空数据降级、趋势截断。
  - 覆盖 Requirement 6。

- [ ] 17. 实现矛盾辩证追踪
  - 扩展 `packages/core/src/bible/context/` 现有冲突数据模型。
  - 在 `BibleConflictRecord` 上扩展字段：`rank`（primary/secondary）、`nature`（antagonistic/non-antagonistic）、`sides`、`controllingIdea`、`transformations[]`。
  - 扩展冲突状态链：latent→emerging→escalating→transforming→climaxing→unifying→resolved。
  - 实现 `detectMainConflictDrift(conflicts, currentChapter)` 主线偏离检测（阈值 5 章）。
  - 建书时的 Tier 1 问卷新增"主要矛盾声明"引导（矛盾描述 + 矛盾双方 + 性质）。
  - 章后审计新增"本章推进了哪些矛盾"记录。
  - 添加单测：主线偏离/转化记录/层级变更/空矛盾安全。
  - 覆盖 Requirement 7。

- [ ] 18. 实现角色弧线长程追踪
  - 新增 `packages/core/src/tools/arcs/character-arc-tracker.ts`。
  - 定义 `CharacterArc`、`ArcBeat`、`ArcType` 类型。
  - 实现 `detectArcInconsistency(arc)` 弧线一致性检测。
  - 实现 `detectStagnantArc(arc, currentChapter, threshold)` 弧线停滞检测。
  - 从 `ChapterAnalyzerAgent` 分析结果提取候选 arc beat 的逻辑。
  - 建角色时新增弧线声明：弧线类型 + 起点描述 + 终点描述。
  - 添加单测：正向成长+退行预警、堕落型+退行不预警、停滞检测、空弧线安全。
  - 覆盖 Requirement 8。

- [ ] 19. 实现题材文风守护
  - 新增 `packages/core/src/tools/tone/tone-drift-detector.ts`。
  - 实现 `GENRE_TONE_MAP` 流派→文风推荐映射（12 个流派细分）。
  - 实现 `detectToneDrift(chapterText, declaredTone, styleProfile?)` 偏离检测。
  - 检测方式：从 style_profile 统计特征对比声明 tone 的参考范围 + 可选 LLM 判断。
  - 连续偏离计数（从 chapter_audit_log 中查询）。
  - 建书流程集成：选流派后自动推荐 tone，作者确认/覆盖。
  - 添加单测：偏离计算/连续偏离计数/推荐匹配/空 profile 安全。
  - 覆盖 Requirement 9。

- [ ] 20. 扩展写作工具 API 路由（新增 4 条）
  - 在 `packages/studio/src/api/routes/writing-tools.ts` 中新增：
    - `GET /api/books/:bookId/health`：全书健康仪表盘。
    - `GET /api/books/:bookId/conflicts/map`：矛盾辩证地图。
    - `GET /api/books/:bookId/arcs`：角色弧线总览。
    - `POST /api/books/:bookId/chapters/:ch/tone-check`：文风偏离检测。
  - 添加 API 测试。
  - 覆盖 Requirements 6-9。

- [ ] 21. 实现全书健康仪表盘 UI
  - 新增 `packages/studio/src/components/writing-tools/BookHealthDashboard.tsx`。
  - 书籍总览页顶部嵌入：6 个聚合指标条 + 预警汇总区 + 趋势图区。
  - 指标条：人设一致性 / 伏笔回收率 / AI 味均值 / 节奏多样性 / 敏感词 + 颜色编码。
  - 预警区：矛盾停滞 / 伏笔债务 / 节奏单调 / 开头结尾同构 / POV 遗忘 / 弧线停滞。
  - 趋势区：AI 味折线 / 字数折线 / 伏笔开收比折线（最近 20 章）。
  - 使用 shadcn/ui Card + Progress + Badge + 轻量图表。
  - 数据不足（<5 章）降级显示。
  - 添加组件测试。
  - 覆盖 Requirement 6。

- [ ] 22. 实现矛盾地图 UI
  - 新增 `packages/studio/src/components/writing-tools/ConflictMap.tsx`。
  - 矛盾列表视图：主要矛盾（★）+ 次要矛盾（○）+ 已解决（●）。
  - 每条矛盾：性质标签 / 状态标签 / 控制观念（主矛盾时）/ 推进时间线条。
  - 转化事件节点高亮。
  - 使用 shadcn/ui Card + Timeline + Badge。
  - 添加组件测试。
  - 覆盖 Requirement 7。

- [ ] 23. 实现角色弧线仪表盘 UI
  - 新增 `packages/studio/src/components/writing-tools/CharacterArcDashboard.tsx`。
  - 群像总览：并排展示重要角色弧线进度条 + 弧线类型标签 + 最近 arc beat。
  - 单角色详情：时间线展示所有 arc beat + 方向标识（advance/regression/neutral）。
  - 弧线一致性预警内嵌。
  - 使用 shadcn/ui Card + Progress + Timeline + Badge。
  - 添加组件测试。
  - 覆盖 Requirement 8。

- [ ] 24. 实现文风偏离提示 UI
  - 新增 `packages/studio/src/components/writing-tools/ToneDriftAlert.tsx`。
  - 章节审计报告中嵌入：偏离方向 + 偏离度 + 连续偏离章数。
  - 连续 3 章偏离时提示"是否更新基调声明"。
  - 使用 shadcn/ui Alert + Badge。
  - 添加组件测试。
  - 覆盖 Requirement 9。

- [ ] 25. 执行全量验证
  - 运行 `pnpm typecheck` 和 `pnpm test`。
  - 真实烟测：写一章→分析节奏→分析对话→生成钩子→选择→验证 hooks 更新。
  - 真实烟测：写 2 天→查看进度→streak 正确→趋势图正确。
  - 真实烟测：多 POV 书→POV 仪表盘→gap 警告→建议合理。
  - 真实烟测：写 10 章→审计日志持久化→健康仪表盘聚合正确→预警显示。
  - 真实烟测：声明主要矛盾→5 章未推进→主线偏离预警触发。
  - 真实烟测：声明角色正向成长→连续退行→弧线一致性预警。
  - 真实烟测：声明悲苦基调→写轻快章→文风偏离提醒。
  - 覆盖 Requirement 10。

## Done Definition

- 钩子生成器生成 3-5 个方案，每个包含类型/文本/理由/效果评估。
- POV 仪表盘正确统计多视角章节分配，gap 超阈值有警告。
- 日更进度准确显示今日/本周字数、streak、30 天趋势。
- 节奏分析生成句长直方图和段落折线图，支持与参考文本对比。
- 对话分析计算比例并按角色分组，偏离参考范围有提示。
- 全书健康仪表盘聚合所有监控信号，提供 6 个指标 + 预警 + 趋势图。
- 矛盾辩证追踪支持主/次层级、7 态状态链、转化记录、主线偏离预警。
- 角色弧线追踪支持弧线声明、arc beat 记录、一致性检测、停滞预警。
- 题材文风守护支持流派→tone 推荐、偏离检测、连续偏离提醒。
- 章节审计日志持久化到 `chapter_audit_log` 表。
- 所有工具有对应 API 和 UI 组件。
- 相关测试、typecheck 通过。
