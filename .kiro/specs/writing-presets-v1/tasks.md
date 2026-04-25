# Implementation Plan

## Overview

本任务文件从已批准的 `writing-presets-v1` spec 生成。目标是为 NovelFork 填充 6 个流派配置、5 个文风预设、5 个节拍模板、4 个 AI 味过滤预设、4 个文学技法预设，以及 6 个题材的经纬推荐栏目内容，并提供预设管理 UI。

关键执行原则：

- 每个预设都是可选的，不强制启用。
- 流派配置使用现有 `GenreProfile` YAML 格式，不改底层 schema。
- 文风预设是 `style_guide.md` 模板，不需要 LLM 运行时生成。
- 节拍模板在 Architect Agent 中可选引用，不替代作者大纲。
- 经纬题材推荐填充到已有的 `templates.ts` 骨架中。

## Tasks

- [ ] 1. 定义预设类型系统与注册中心
  - 新增 `packages/core/src/presets/types.ts`：`Preset`、`PresetCategory`、`PresetConfig`、`PostWriteCheck`、`BeatTemplate`、`Beat` 类型。
  - 新增 `packages/core/src/presets/index.ts`：预设注册中心，提供 `getPreset(id)`、`listPresets(category?)`、`getPresetsByGenre(genreId)` 查询。
  - 添加单测：注册中心查询、按分类过滤、按流派过滤。
  - 覆盖 Requirements 7、8。

- [ ] 2. 填充 6 个流派的 GenreProfile 文件
  - 在 `packages/core/src/presets/genres/` 下创建 `xianxia.md`、`urban.md`、`mystery.md`、`romance.md`、`scifi.md`、`history.md`。
  - 每个文件包含完整 YAML frontmatter（name/id/language/chapterTypes/fatigueWords/numericalSystem/powerScaling/eraResearch/pacingRule/satisfactionTypes/auditDimensions）和 Markdown body（流派核心/常见结构/写作禁忌）。
  - 添加解析测试：每个文件通过 `parseGenreProfile()` 解析无错误，必填字段完整。
  - 覆盖 Requirements 1、8。

- [ ] 3. 填充 5 个文风 tone 预设模板
  - 在 `packages/core/src/presets/tones/` 下创建 5 个 `.md` 文件：`tragic-solitude.md`（悲苦孤独）、`austere-pragmatic.md`（冷峻质朴）、`classical-imagery.md`（古典意境）、`dark-humor-social.md`（黑色幽默+社会批判）、`comedic-light.md`（沙雕轻快）。
  - 每个文件包含 8 维风格描述：叙事声音、对话风格、场景描写、转折衔接、节奏特征、词汇偏好、情绪表达、独特习惯。
  - 标注参考作者但不抄袭原文。
  - 添加测试：每个 tone 文件包含 8 个二级标题。
  - 覆盖 Requirements 2、8。

- [ ] 4. 实现 5 个叙事节拍模板
  - 在 `packages/core/src/presets/beats/` 下实现：
    - `heros-journey.ts`：英雄之旅 17 阶段，含 purpose/wordRatio/emotionalTone/networkNovelTip。
    - `save-the-cat.ts`：救猫咪 15 节拍。
    - `three-act.ts`：三幕结构。
    - `opening-hooks.ts`：网文开篇钩子 12 式（12 种开篇策略及示例）。
    - `chapter-ending-hooks.ts`：章节结尾钩子生成器（8+ 种结尾策略）。
  - 每个模板导出 `BeatTemplate` 类型数据。
  - 添加测试：节拍数量正确、wordRatio 之和 ≈ 1、每个 beat 有 purpose。
  - 覆盖 Requirements 3、8。

- [ ] 5. 实现 4 个 AI 味过滤预设
  - 在 `packages/core/src/presets/anti-ai/` 下实现：
    - `full-scan.ts`：12 特征全量扫描配置（复用已有检测器，组合为预设）。
    - `sentence-variance.ts`：句长方差修复（promptInjection + PostWriteCheck）。
    - `emotion-concretize.ts`：情感具体化（promptInjection + PostWriteCheck）。
    - `dialogue-colloquial.ts`：口语化对话（promptInjection + PostWriteCheck）。
  - 每个预设导出 `Preset` 类型数据，包含 `promptInjection` 和可选 `postWriteChecks`。
  - 添加测试：promptInjection 非空、PostWriteCheck 阈值合理。
  - 覆盖 Requirements 4、8。

- [ ] 6. 实现 4 个文学技法预设
  - 在 `packages/core/src/presets/literary/` 下实现：
    - `character-multidim.ts`：人物多维度展开。
    - `hook-four-states.ts`：伏笔四态追踪（埋/暗/半明/收）。
    - `consistency-audit.ts`：一致性审计（每 N 章自动触发配置）。
    - `controlling-idea.ts`：控制观念锚定。
  - 每个预设导出 `Preset` 类型数据。
  - 添加测试。
  - 覆盖 Requirements 5、8。

- [ ] 7. 填充 6 个题材的经纬推荐栏目内容
  - 在 `packages/core/src/jingwei/genre-recommendations.ts` 中实现 `GenreRecommendation` 数据：
    - 修仙/玄幻：境界体系、功法、势力/宗门、资源/灵材、法宝/神器、秘境/副本（6 栏目）。
    - 悬疑/盗墓：线索、谜团、误导项、案件时间线、真相层（5 栏目）。
    - 女频/感情流：关系变化、情感节点、误会与和解、家庭关系、人物成长（5 栏目）。
    - 科幻：科技树、星图/地理、组织/阵营、术语表、实验记录（5 栏目）。
    - 都市：职业线、关系网、资产/经济、城市地图、社会身份（5 栏目）。
    - 历史穿越：时代背景、历史人物、朝堂势力、科技差、蝴蝶效应（5 栏目）。
  - 每个栏目包含 name/description/defaultVisibility/participatesInAi/fields。
  - 接入已有 `templates.ts` 的题材推荐逻辑。
  - 添加测试：每个题材的栏目数量和名称正确，字段定义非空。
  - 覆盖 Requirements 6、8。

- [ ] 8. 将预设注入写作管线
  - 在 `writer-prompts.ts` 中新增 `buildPresetInjections(enabledPresets)`，将启用的预设 promptInjection 拼接注入。
  - 在 `buildWriterSystemPrompt()` 中调用，位于 style guide 之后。
  - 在 Writer Agent 写完章节后，执行启用预设的 `postWriteChecks`，结果附加到章节审计报告。
  - 添加测试：预设注入后 system prompt 包含预设内容、PostWriteCheck 执行正确。
  - 覆盖 Requirements 4、5。

- [ ] 9. 将流派配置与建书流程关联
  - 在 `BookCreate.tsx` 的题材字段增加流派选择下拉（复用已有 GenreProfile 数据）。
  - 选择流派后自动：设置 `book_rules.md` 的 `genreLock.primary`、推荐启用的预设组合、推荐经纬题材模板。
  - 不选流派时跳过所有自动配置。
  - 添加测试：选择流派后 book_rules 和推荐预设正确。
  - 覆盖 Requirements 1、6。

- [ ] 10. 实现预设管理 API
  - 新增 `packages/studio/src/api/routes/presets.ts`：
    - `GET /api/presets` 列出所有内置预设。
    - `GET /api/books/:bookId/presets` 获取书籍已启用预设。
    - `PUT /api/books/:bookId/presets` 更新书籍启用预设列表。
    - `POST /api/books/:bookId/presets/:presetId/customize` 保存自定义覆盖。
  - 添加 API 测试。
  - 覆盖 Requirements 7、8。

- [ ] 11. 实现预设管理 UI
  - 新增 `packages/studio/src/pages/PresetManager.tsx`，包含四 Tab（节拍/文风/AI味/技法）。
  - 使用 shadcn/ui Card + Switch + Badge + Dialog + ScrollArea。
  - 支持启用/禁用、冲突检测、点击展开详情。
  - 底部展示当前书已启用预设摘要。
  - 添加组件测试：启用/禁用/冲突提示。
  - 覆盖 Requirements 7、8。

- [ ] 12. 执行验证
  - 运行 `pnpm typecheck` 和 `pnpm test`。
  - 验证每个 GenreProfile 解析正确。
  - 验证每个 tone 预设 8 维完整。
  - 验证每个节拍模板结构正确。
  - 验证经纬题材推荐栏目数量正确。
  - 验证预设注入写作管线后 system prompt 格式正确。
  - 覆盖 Requirement 8。

## Done Definition

- 6 个流派 GenreProfile 全部解析通过，包含 chapterTypes/fatigueWords/pacingRule/satisfactionTypes。
- 5 个文风 tone 预设各包含 8 维风格描述。
- 5 个节拍模板节拍数量正确（17/15/3+/12/8+），wordRatio 之和 ≈ 1。
- 4 个 AI 味过滤预设包含 promptInjection 和 PostWriteCheck。
- 4 个文学技法预设包含 promptInjection。
- 6 个题材的经纬推荐栏目各包含 5-6 个栏目及字段定义。
- Writer Agent system prompt 正确注入启用的预设。
- PresetManager UI 支持四 Tab 浏览、启用/禁用、冲突检测。
- 相关测试、typecheck 通过。
