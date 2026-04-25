# Requirements Document

## Introduction

本 spec 定义 NovelFork 的 **强制核心功能**：AI 味过滤器 v1。

**为什么强制**（依据 `docs/03-代码参考/07-小说写作与AI调研.md` v1.0 第二节）：

- 起点 2025 年 3 月起**只接受 100% 人工创作**
- 晋江仅允许 3 种 AI 辅助（校对 / 起名 / 粗纲）
- 番茄 2025 Q2 起图文水印联合检测
- 国家《人工智能生成合成内容标识办法》2025-09-01 施行
- 没有 AI 味过滤 = NovelFork 作者写出来的书直接 **上架被拒**

本 v1 实现 **12 特征规则检测 + 可选第三方朱雀 API 集成 + 消 AI 味 7 招内置预设**，作为 writing 管线必经一层。

前置：`storage-migration` 已完成（用于记录检测历史 / 特征命中统计）。
并行：可与 `novel-bible-v1` 独立开发。

## Requirements

### Requirement 1：12 特征规则检测（本地优先）

**User Story：** 作为作者，我希望 NovelFork 在本地就能快速扫描我的章节内容，告诉我有多少 AI 味，不必每次都调外部 API。

#### Acceptance Criteria

1. WHEN 用户请求检测时 THEN THE SYSTEM SHALL 对文本执行以下 12 类规则检测：
   - 1. 过度正式 / 官腔（"综上所述" / "总的来说"等命中）
   - 2. 固定句式模板（"首先...其次...最后..."序列）
   - 3. 典型 AI 词汇（"值得注意的是" / "以下是为您" / "让我们一起来"等词典）
   - 4. 缺乏情感动词（大量"感到/觉得/认为"而无具体动作）
   - 5. 缺乏口头禅 / 人称癖好（全书无个性化用词）
   - 6. 句长方差过低（标准差 < 阈值）
   - 7. 段落长度过于均匀（方差 < 阈值）
   - 8. 行话 / 术语密度过高（领域白名单外的书面词占比）
   - 9. 形容词堆叠（连续 2+ 形容词短语出现密度）
   - 10. 空话密度（"很 / 非常 / 十分 / 极其" + 情感词无具体描写）
   - 11. 对话书面语（引号内句子缺口语标记）
   - 12. "伪人感"（综合指标，由 1-11 加权给出）
2. WHEN 单条规则命中时 THEN THE SYSTEM SHALL 返回 `{ ruleId, severity: "low"|"medium"|"high", spans: [{ start, end, matched }], suggestion? }`。
3. WHEN 计算总体评分时 THEN THE SYSTEM SHALL 输出 `aiTasteScore: 0-100`（0 = 纯人味，100 = 纯 AI 味）和对应等级 `clean | mild | moderate | severe`。
4. WHEN 文本长度 < 200 字时 THEN THE SYSTEM SHALL 跳过方差类规则（6、7）避免小样本误报。
5. WHEN 作者自定义规则权重 / 阈值时 THEN THE SYSTEM SHALL 支持通过 `kv_store` 持久化每本书的 filter 配置。

### Requirement 2：朱雀 API 可选集成

**User Story：** 作为要上架的作者，我希望 NovelFork 能直接调用腾讯朱雀检测 API，给出平台级一致的 AI 率，不用我自己去朱雀网站贴。

#### Acceptance Criteria

1. WHEN 用户在设置中填入朱雀 API 凭据时 THEN THE SYSTEM SHALL 支持 HTTP 调用 Matrix 朱雀检测接口并解析返回的 AI 率百分比。
2. WHEN 朱雀 API 未配置时 THEN THE SYSTEM SHALL 仅使用本地 12 特征检测，不阻塞使用。
3. WHEN 朱雀 API 调用失败 / 超时时 THEN THE SYSTEM SHALL 降级为本地检测结果，并在 UI 提示"朱雀检测失败，仅使用本地规则"。
4. WHEN 作者要求时 THEN THE SYSTEM SHALL 在同一份检测报告中并列展示本地评分与朱雀评分。
5. WHEN 朱雀评分 > 30% 时 THEN THE SYSTEM SHALL 标记为 `platform-risk`，提示作者平台可能拒稿。

### Requirement 3：消 AI 味 7 招内置预设

**User Story：** 作为作者，我希望系统不仅告诉我哪里像 AI，还能直接帮我改写或给建议。

#### Acceptance Criteria

1. WHEN 检测发现命中时 THEN THE SYSTEM SHALL 针对每类特征给出修改建议预设：
   - 1. 招：喂人类范文后重写（链接到 writing-presets-v1）
   - 2. 招：明确人格提示词模板（注入"你是网文作者，轻松诙谐..."）
   - 3. 招：屏蔽鼓励性人格（注入"不需要鼓励，只给问题和修改方向"）
   - 4. 招：人工改写润色（提供可编辑 diff）
   - 5. 招：朱雀 → 降重 → 朱雀循环工具
   - 6. 招：章节结尾钩子生成器（调用 writing-presets）
   - 7. 招：AI 使用标注（写入 frontmatter / metadata）
2. WHEN 作者点击"应用第 N 招"时 THEN THE SYSTEM SHALL 提供对应的预设提示词并跳转到重写入口，不自动覆盖原文。
3. WHEN 7 招作为独立功能被调用时 THEN THE SYSTEM SHALL 提供 `POST /api/filter/suggest-rewrite` 接口，入参 `{ text, ruleIds[] }` 返回建议。

### Requirement 4：写作管线集成（必经一层）

**User Story：** 作为项目规则制定者，我希望任何章节一旦生成 / 保存，都会被 AI 味过滤器扫描一次，结果写入 session 记录。

#### Acceptance Criteria

1. WHEN AI 写作管线生成一段新内容时 THEN THE SYSTEM SHALL 在写入章节之前调用 filter 并附带结果到生成响应。
2. WHEN 作者手动保存章节时 THEN THE SYSTEM SHALL 异步扫描并将 `aiTasteScore` 与命中清单写入 `bible_chapter_summary.metadata_json` 或独立的 `filter_report` 表。
3. WHEN `aiTasteScore > 70`（severe）时 THEN THE SYSTEM SHALL 在 UI 以醒目红色警告，但**不阻止保存**（作者自主）。
4. WHEN `aiTasteScore < 30`（clean）时 THEN THE SYSTEM SHALL 在 UI 以绿色徽章标记。
5. WHEN 作者想要关闭扫描时 THEN THE SYSTEM SHALL 仅允许在开发者模式下临时跳过，默认启用不可在生产模式关闭。

### Requirement 5：检测历史与统计

**User Story：** 作为作者，我希望看到整本书的 AI 味趋势（哪一章最像 AI），以便集中精力改高风险章节。

#### Acceptance Criteria

1. WHEN 作者打开书籍详情时 THEN THE SYSTEM SHALL 提供「AI 味报告」Tab 展示：全书平均分、各章评分折线、各规则触发频次排行、朱雀评分（若有）。
2. WHEN 作者点击某章节条目时 THEN THE SYSTEM SHALL 展开该章 12 特征细节与高亮段落。
3. WHEN 检测历史累积时 THEN THE SYSTEM SHALL 在 `filter_report` 表存储每次扫描：`id`、`book_id`、`chapter_number`、`ai_taste_score`、`hit_counts_json`、`zhuque_score?`、`scanned_at`、`engine_version`。
4. WHEN 规则版本升级时 THEN THE SYSTEM SHALL 记录 `engine_version`，便于作者看到某章被新版规则重新评估过。

### Requirement 6：性能与资源约束

**User Story：** 作为维护者，我希望本地检测对普通 5000 字章节在 200ms 内完成，不卡作者输入。

#### Acceptance Criteria

1. WHEN 本地检测 5000 字章节时 THEN THE SYSTEM SHALL 在 <200ms 完成（单线程）。
2. WHEN 批量扫描整本书（100+ 章节）时 THEN THE SYSTEM SHALL 使用 worker / stream 模式，不阻塞 UI 线程。
3. WHEN 规则字典加载时 THEN THE SYSTEM SHALL 使用 Aho-Corasick 或 trie 结构一次性构建，避免每章重建。
4. WHEN 朱雀 API 被调用时 THEN THE SYSTEM SHALL 支持超时（默认 10s）与重试（最多 2 次）。

### Requirement 7：测试与回归

**User Story：** 作为维护者，我希望 filter 引擎有充分的 fixture 覆盖各类误报与漏报边界。

#### Acceptance Criteria

1. WHEN 单元测试时 THEN THE SYSTEM SHALL 覆盖 12 条规则各至少一个正例（命中）和一个反例（不误报）。
2. WHEN 集成测试时 THEN THE SYSTEM SHALL 使用来自人类畅销网文的样本（如《凡人修仙传》段落）验证本地评分 < 30。
3. WHEN 使用 LLM 生成的典型样本时 THEN THE SYSTEM SHALL 验证本地评分 > 50。
4. WHEN 朱雀 API 不可用时 THEN THE SYSTEM SHALL 降级路径有测试覆盖。
5. WHEN 运行 typecheck 时 THEN THE SYSTEM SHALL 无错误。

### Requirement 8：与 novel-bible-v1 / PGI 的跨 spec 接口

**User Story：** 作为 PM，我希望 filter 与 Bible / PGI 系统有清晰的数据接口契约，双方按约定读写，不互相侵入。

#### Acceptance Criteria

1. WHEN 章节生成完成并写入 `bible_chapter_summary` 时 THEN THE SYSTEM SHALL 将 `filter_report.id` 写入 `bible_chapter_summary.metadataJson.filterReportId`，形成 1:1 关联。
2. WHEN `bible_chapter_summary.metadataJson` 中存在 `pgi_answers`（来自 `novel-bible-v1` Phase C 的 Pre-Generation Interrogation）时 THEN THE SYSTEM SHALL 在 `filter_report.details` 中记录 `pgiUsed: true | false`；未走 PGI 的章节标注 `pgiUsed: false`。
3. WHEN 全书报告页展示时 THEN THE SYSTEM SHALL 支持按 `pgiUsed` 分组对比：走 PGI 的章节平均分 vs 未走 PGI 的章节平均分（可辅助作者判断 PGI 是否有价值）。
4. WHEN 本地检测的 `aiTasteScore` 与 Conflict 的 `resolution_state` 出现相关性（如连续 3 章 escalating 矛盾的评分比非矛盾章显著高）时 THEN THE SYSTEM SHALL 在报告中标注"矛盾密集章节 AI 味偏高"提示（Phase C+ 可选，v1 仅预留字段不实现分析逻辑）。
5. WHEN filter 的 migration 编号与 bible 的 migration 冲突时 THEN THE SYSTEM SHALL 使用独立编号序列：bible = `0002/0003/0004`，filter = `0005_filter_v1.sql`（或在开发时按实际先后调整，确保 drizzle-kit 生成的文件名无冲突）。

### Requirement 9：明确不做

**User Story：** 作为 PM，我希望 v1 边界清晰。

#### Acceptance Criteria

1. WHEN 定义 v1 边界时 THEN THE SYSTEM SHALL 明确不包含：
   - 自训练本地检测模型（仅用规则 + 第三方 API）
   - 多语言（仅中文）
   - 图像 / 音频 AI 检测（仅文本）
   - 自动改写执行（仅建议）—— 留给后续 `auto-dehumanize` spec
   - 与晋江 / 起点的直投接口
   - PGI / Conflict 分析逻辑（仅预留字段，实际分析留给 `novel-bible-v1` Phase C+ 或 `analytics-v1`）
2. WHEN 未列入的需求被提出时 THEN THE SYSTEM SHALL 在文档中明确 defer 到哪个 spec。
