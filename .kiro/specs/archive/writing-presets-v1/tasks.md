# Implementation Plan

## Overview

本任务文件从升级后的 `writing-presets-v1` spec 生成。目标是为 NovelFork 填充并管理一套“题材 + 文风 + 时代/社会基底 + 逻辑风险自检 + 节拍 + AI味过滤 + 文学技法 + 经纬栏目”的创作基底预设。

本次升级后的核心原则：

- 每个预设都是可选的，不强制启用。
- 流派配置使用现有 `GenreProfile` YAML 格式，不改底层 schema。
- `tone` 只负责语言气质，不负责时代设定。
- `settingBase` 负责时代、社会、制度、生产力、生活材料和现实参照边界。
- `logicRisk` 同时服务写前 prompt 约束和写后审计，不替作者强行改写。
- `bundle` 是推荐组合，作者可一键启用，也可拆分替换。
- 经纬题材推荐填充到已有模板骨架中。
- 当前已创建的 tone 文件视为草稿，必须升级后才能重新标记完成。

## Tasks

- [x] 1. 定义预设类型系统与注册中心（第一版）
  - 新增 `packages/core/src/presets/types.ts`：`Preset`、`PresetCategory`、`PresetConfig`、`PostWriteCheck`、`BeatTemplate`、`Beat` 类型。
  - 新增 `packages/core/src/presets/index.ts`：预设注册中心，提供 `getPreset(id)`、`listPresets(category?)`、`getPresetsByGenre(genreId)` 查询。
  - 添加单测：注册中心查询、按分类过滤、按流派过滤。
  - 状态说明：已完成第一版；后续 Task 5 需要扩展 setting/logic/bundle 类型。
  - 覆盖 Requirements 10、11。

- [x] 2. 填充 6 个流派的 GenreProfile 文件
  - 在 `packages/core/src/presets/genres/` 下创建 `xianxia.md`、`urban.md`、`mystery.md`、`romance.md`、`scifi.md`、`history.md`。
  - 每个文件包含完整 YAML frontmatter（name/id/language/chapterTypes/fatigueWords/numericalSystem/powerScaling/eraResearch/pacingRule/satisfactionTypes/auditDimensions）和 Markdown body（流派核心/常见结构/写作禁忌）。
  - 添加解析测试：每个文件通过 `parseGenreProfile()` 解析无错误，必填字段完整。
  - 覆盖 Requirements 1、11。

- [x] 3. 升级 5 个文风 tone 预设模板
  - 当前已创建的 5 个 tone 文件仅为草稿，不能作为最终完成态。
  - 重写 `packages/core/src/presets/tones/` 下 5 个 `.md` 文件：
    - `tragic-solitude.md`（悲苦孤独）
    - `austere-pragmatic.md`（冷峻质朴）
    - `classical-imagery.md`（古典意境）
    - `dark-humor-social.md`（黑色幽默+社会批判）
    - `comedic-light.md`（沙雕轻快）
  - 每个文件只描述语言气质，包含：叙事声音、对话风格、场景描写、转折衔接、节奏特征、词汇偏好、情绪表达、禁止漂移方向、参考来源、推荐 settingBase。
  - 不在 tone 文件内混写完整时代/社会基底。
  - 添加测试：每个 tone 文件包含规定章节；不包含 setting base 的完整章节集合。
  - 覆盖 Requirements 2、11。

- [x] 4. 实现 5 个叙事节拍模板（第一版）
  - 在 `packages/core/src/presets/beats/` 下实现：
    - `heros-journey.ts`：英雄之旅 17 阶段。
    - `save-the-cat.ts`：救猫咪 15 节拍。
    - `three-act.ts`：三幕结构。
    - `opening-hooks.ts`：网文开篇钩子 12 式。
    - `chapter-ending-hooks.ts`：章节结尾钩子生成器。
  - 每个模板导出 `BeatTemplate` 类型数据。
  - 添加测试：节拍数量正确、wordRatio 之和 ≈ 1、每个 beat 有 purpose。
  - 状态说明：已完成第一版；后续可继续细化来源和模板应用逻辑。
  - 覆盖 Requirements 6、11。

- [x] 5. 扩展预设类型系统与注册中心（setting/logic/bundle）
  - 更新 `packages/core/src/presets/types.ts`：新增 `TonePreset`、`SettingBasePreset`、`LogicRiskRule`、`PresetBundle` 类型。
  - 扩展 `PresetCategory`：加入 `setting-base`、`logic-risk`、`bundle`。
  - 扩展注册中心：支持 `listSettingBases()`、`listLogicRisks()`、`listBundles()`、`getBundle(id)`。
  - 添加测试：分类过滤、bundle 引用解析、互斥 conflictGroup。
  - 覆盖 Requirements 3、4、5、10、11。

- [x] 6. 实现 6 个 Setting Base 预设
  - 在 `packages/core/src/presets/setting-bases/` 下创建 6 个 `.md` 文件：
    - `victorian-industrial-occult.md`
    - `classical-travelogue-jianghu.md`
    - `sect-family-xianxia.md`
    - `modern-platform-economy-satire.md`
    - `historical-court-livelihood.md`
    - `near-future-industrial-scifi.md`
  - 每个文件包含固定章节：现实/历史参照、社会阶层、权力结构、经济系统、技术/魔法边界、交通与信息传播、日常生活材料、可借用元素、不可照搬元素、常见违和点。
  - 内容必须基于调研文档或公开历史/现实常识，不凭空编造。
  - 添加测试：6 个文件存在；每个包含 10 个固定章节；包含“参考而非复刻”边界说明。
  - 覆盖 Requirements 3、11。

- [x] 7. 实现 Logic Risk 规则库
  - 在 `packages/core/src/presets/logic-risks/` 下实现：
    - `anachronism.ts`：时代错位。
    - `information-flow.ts`：信息传播速度。
    - `economy-resource.ts`：经济/资源体系。
    - `institution-response.ts`：权力机构响应。
    - `technology-boundary.ts`：技术/魔法边界。
    - `character-motivation.ts`：人物动机与阶层行为。
    - `geography-transport.ts`：地理/交通。
    - `satisfaction-cost.ts`：爽点代价。
  - 每条规则导出 `LogicRiskRule`，包含 writerConstraint、auditQuestion、evidenceHints、uncertainHandling。
  - 添加测试：字段完整、适用 settingBase 非空、不确定时要求作者确认。
  - 覆盖 Requirements 4、11。

- [x] 8. 实现 6 个 Preset Bundle 推荐组合
  - 在 `packages/core/src/presets/bundles/` 下实现：
    - `industrial-occult-mystery.ts`
    - `classical-travel-xianxia.ts`
    - `mortal-sect-xianxia.ts`
    - `institutional-cultivation-satire.ts`
    - `historical-governance.ts`
    - `near-future-hard-scifi.ts`
  - 每个 bundle 引用存在的 genre、tone、settingBase、logicRisk。
  - 高难度 bundle 必须标注 prerequisites 和不适用场景。
  - 添加测试：引用完整、难度标注、可拆分启用。
  - 覆盖 Requirements 5、10、11。

- [x] 9. 实现 4 个 AI 味过滤预设
  - 在 `packages/core/src/presets/anti-ai/` 下实现：
    - `full-scan.ts`：12 特征全量扫描配置。
    - `sentence-variance.ts`：句长方差修复。
    - `emotion-concretize.ts`：情感具体化。
    - `dialogue-colloquial.ts`：口语化对话。
  - 每个预设导出 `Preset` 类型数据，包含 `promptInjection` 和可选 `postWriteChecks`。
  - 添加测试：promptInjection 非空、PostWriteCheck 阈值合理。
  - 覆盖 Requirements 7、11。

- [x] 10. 实现 4 个文学技法预设
  - 在 `packages/core/src/presets/literary/` 下实现：
    - `character-multidim.ts`：人物多维度展开。
    - `hook-four-states.ts`：伏笔四态追踪（埋/暗/半明/收）。
    - `consistency-audit.ts`：一致性审计（每 N 章自动触发配置）。
    - `controlling-idea.ts`：控制观念锚定。
  - 每个预设导出 `Preset` 类型数据。
  - 添加测试。
  - 覆盖 Requirements 8、11。

- [x] 11. 填充 6 个题材的经纬推荐栏目内容
  - 在 `packages/core/src/jingwei/genre-recommendations.ts` 中实现 `GenreRecommendation` 数据：
    - 修仙/玄幻：境界体系、功法、势力/宗门、资源/灵材、法宝/神器、秘境/副本。
    - 悬疑/盗墓：线索、谜团、误导项、案件时间线、真相层。
    - 女频/感情流：关系变化、情感节点、误会与和解、家庭关系、人物成长。
    - 科幻：科技树、星图/地理、组织/阵营、术语表、实验记录。
    - 都市：职业线、关系网、资产/经济、城市地图、社会身份。
    - 历史穿越：时代背景、历史人物、朝堂势力、科技差、蝴蝶效应。
  - 每个栏目包含 name/description/defaultVisibility/participatesInAi/fields。
  - 接入已有 `templates.ts` 的题材推荐逻辑。
  - 添加测试：每个题材的栏目数量和名称正确，字段定义非空。
  - 覆盖 Requirements 9、11。

- [x] 12. 将预设注入写作管线
  - 在 `writer-prompts.ts` 中新增或升级 `buildPresetInjections(enabledPresets)`。
  - 注入顺序固定：genre → tone → settingBase → logicRisk → anti-ai → literary。
  - 在 `buildWriterSystemPrompt()` 中调用，位于 style guide 之后、output section 之前。
  - 在 Writer Agent 写完章节后，执行启用预设的 `postWriteChecks`，结果附加到章节审计报告。
  - 添加测试：system prompt 包含 tone + setting + logic；PostWriteCheck 执行正确。
  - 覆盖 Requirements 2、3、4、7、8。

- [x] 13. 将流派配置、bundle 与建书流程关联
  - 在 `BookCreate.tsx` 的题材字段增加流派选择和推荐 bundle 选择。
  - 选择 bundle 后自动展示其包含的 genre/tone/settingBase/logicRisks，允许作者逐项取消或替换。
  - 自动生成或更新 `book_rules.md`、`style_guide.md`、`setting_guide.md` 和 enabled presets 配置。
  - 不选流派或 bundle 时跳过所有自动配置。
  - 添加测试：选择 bundle 后配置正确；拆分替换后只启用作者选择项。
  - 覆盖 Requirements 1、3、5、9、10。
  - 2026-04-25 补充验证：BookCreate 已支持推荐 bundle 选择、显示组合内 tone / setting-base / logic-risk，并允许逐项取消、替换 tone / setting-base、追加 logic-risk；建书时会把 `enabledPresetIds` 写入 `book.json` 并生成/更新 `book_rules.md`、`style_guide.md`、`setting_guide.md`。验证通过：`pnpm --dir packages/studio exec vitest run src/pages/BookCreate.test.tsx -t "applies a recommended bundle and lets authors remove or replace individual presets before create"`、`pnpm --dir packages/studio exec vitest run src/api/server.test.ts -t "writes preset-derived guide files when create requests enable writing presets"`、`pnpm --dir packages/studio exec tsc --noEmit`、`pnpm --dir packages/core typecheck`。

- [x] 14. 实现预设管理 API
  - 新增 `packages/studio/src/api/routes/presets.ts`：
    - `GET /api/presets` 列出所有内置预设。
    - `GET /api/presets/bundles` 列出推荐组合。
    - `GET /api/books/:bookId/presets` 获取书籍已启用预设。
    - `PUT /api/books/:bookId/presets` 更新书籍启用预设列表。
    - `POST /api/books/:bookId/presets/:presetId/customize` 保存自定义覆盖。
  - 添加 API 测试。
  - 覆盖 Requirements 10、11。
  - 2026-04-26 补充验证：已新增 `packages/studio/src/api/routes/presets.ts` 并挂载到 Studio server，覆盖 presets/bundles/beats 查询、书籍启用预设 GET/PUT、自定义覆盖 POST；`BookConfig` 支持 `enabledPresetIds` 与 `customPresetOverrides`。验证通过：`pnpm --filter novelfork-studio exec vitest run src/api/routes/presets.test.ts`（3 tests passed）、`pnpm --filter novelfork-studio exec tsc -p tsconfig.server.json --noEmit`。

- [x] 15. 实现预设管理 UI
  - 新增 `packages/studio/src/pages/PresetManager.tsx`。
  - Tab：推荐组合 / 流派 / 文风 / 时代基底 / 逻辑自检 / 节拍 / AI味 / 文学技法。
  - 推荐组合卡片展示：难度、包含项、适用/不适用场景、启用组合、自定义拆分。
  - 单项预设卡片展示：名称、说明、适用流派、冲突提示、启用/禁用、详情。
  - 使用 shadcn/ui Card + Switch + Badge + Dialog + ScrollArea + Accordion。
  - 添加组件测试：启用/禁用、冲突提示、bundle 拆分。
  - 覆盖 Requirements 10、11。
  - 2026-04-26 补充验证：已新增 `PresetManager.tsx`，接入 `presets` 路由、Sidebar / CommandPalette / BookDetail 入口和标签标题；UI 支持推荐组合、分类 Tab、启用/禁用、冲突组提示、bundle 应用。验证通过：`pnpm --filter novelfork-studio exec vitest run src/pages/PresetManager.test.tsx src/pages/BookCreate.test.tsx src/api/routes/presets.test.ts`（13 tests passed）、Studio client/server typecheck 通过。

- [x] 16. 执行验证
  - 运行相关单测和 typecheck。
  - 验证每个 GenreProfile 解析正确。
  - 验证每个 tone 预设不混写 setting base。
  - 验证每个 setting base 章节完整。
  - 验证每个 logic risk 字段完整。
  - 验证每个 bundle 引用存在。
  - 验证每个节拍模板结构正确。
  - 验证经纬题材推荐栏目数量正确。
  - 验证预设注入写作管线后 system prompt 格式正确。
  - 覆盖 Requirement 11。
  - 2026-04-26 补充验证：核心预设注册、节拍、tone/setting 内容、logic/bundle 引用、经纬模板和 writer prompt 注入测试通过；Studio 预设 API、PresetManager、BookCreate bundle 拆分与 guide 文件写入测试通过；core/studio typecheck 通过。验证命令：`pnpm --filter @vivy1024/novelfork-core exec vitest run src/__tests__/presets-registry.test.ts src/__tests__/presets-beats.test.ts src/__tests__/presets-content.test.ts src/__tests__/presets-logic-bundles.test.ts src/__tests__/writer-prompts.test.ts src/__tests__/jingwei-templates.test.ts`（27 tests passed）、`pnpm --filter novelfork-studio exec vitest run src/pages/BookCreate.test.tsx src/pages/PresetManager.test.tsx src/api/routes/presets.test.ts`（13 tests passed）、`pnpm --filter novelfork-studio exec vitest run src/api/server.test.ts -t "writes preset-derived guide files"`、`pnpm --filter @vivy1024/novelfork-core exec tsc --noEmit`、`pnpm --filter novelfork-studio exec tsc -p tsconfig.json --noEmit`、`pnpm --filter novelfork-studio exec tsc -p tsconfig.server.json --noEmit`。

## Done Definition

- 6 个流派 GenreProfile 全部解析通过，包含 chapterTypes/fatigueWords/pacingRule/satisfactionTypes。
- 5 个 tone 预设只描述语言气质，包含来源与禁止漂移方向，不混写完整 setting base。
- 6 个 setting base 预设各包含 10 个固定章节，说明现实/历史参照、制度逻辑和常见违和点。
- 8 个 logic risk 规则包含 writerConstraint、auditQuestion、evidenceHints、uncertainHandling。
- 6 个 bundle 能解析到存在的 genre/tone/settingBase/logicRisk，并支持拆分启用。
- 5 个节拍模板节拍数量正确（17/15/3/12/8+），wordRatio 之和 ≈ 1。
- 4 个 AI 味过滤预设包含 promptInjection 和 PostWriteCheck。
- 4 个文学技法预设包含 promptInjection。
- 6 个题材的经纬推荐栏目各包含 5-6 个栏目及字段定义。
- Writer Agent system prompt 正确按 genre → tone → settingBase → logicRisk → anti-ai → literary 顺序注入启用预设。
- PresetManager UI 支持推荐组合、单项预设浏览、启用/禁用、冲突检测和 bundle 拆分。
- 相关测试、typecheck 通过。
