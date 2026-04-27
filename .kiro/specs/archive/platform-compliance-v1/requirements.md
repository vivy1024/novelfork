# Requirements Document

## Introduction

本 spec 定义 NovelFork 的平台合规工具：针对各网文平台的敏感词合规扫描、AI 内容比例估算和发布就绪检查。直接回应调研中记录的平台反 AI 监管趋势（起点 100% 人工、晋江仅允许 3 种辅助、番茄多模态检测、国家标识办法 2025-09-01 施行）。

设计依据：

- `docs/03-代码参考/07-小说写作与AI调研.md` §2（平台反 AI 监管）
- 现有代码：`sensitive-words.ts`（基础敏感词）、`ai-taste-filter-v1`（AI 味检测）、`detector.ts`（检测器）
- 国家网信办《人工智能生成合成内容标识办法》2025-09-01

## Requirements

### Requirement 1：平台敏感词扫描

**User Story：** 作为准备投稿起点的作者，我希望在提交前扫描全书敏感词，提前发现可能被平台退稿的内容。

#### Acceptance Criteria

1. WHEN 作者触发敏感词扫描 THEN THE SYSTEM SHALL 支持按平台选择扫描规则集：起点、晋江、番茄、七猫、通用。
2. WHEN 扫描完成 THEN THE SYSTEM SHALL 展示命中的敏感词列表，包含位置（章节号+段落）、敏感词、严重等级（禁用/警告/建议修改）、替代建议。
3. WHEN 扫描内置敏感词库 THEN THE SYSTEM SHALL 至少包含以下类别：政治敏感、色情/擦边、暴力极端、宗教禁忌、种族歧视、违法犯罪美化、未成年保护、医疗误导。
4. WHEN 平台有特定禁词 THEN THE SYSTEM SHALL 支持平台专属词库叠加（如起点的特定屏蔽词、晋江的特定限制表达）。
5. WHEN 扫描结果展示 THEN THE SYSTEM SHALL 支持一键跳转到对应章节位置。
6. WHEN 作者自定义敏感词 THEN THE SYSTEM SHALL 支持添加自定义词条到个人或书籍级别词库。
7. WHEN 敏感词库更新 THEN THE SYSTEM SHALL 支持从外部导入词库（JSON/CSV），不硬编码。

### Requirement 2：AI 内容比例估算

**User Story：** 作为准备向平台投稿的作者，我希望系统估算我全书的 AI 辅助比例，帮我判断是否符合平台规定。

#### Acceptance Criteria

1. WHEN 作者触发 AI 比例估算 THEN THE SYSTEM SHALL 基于已有 AI 味检测结果，估算全书 AI 辅助内容占比。
2. WHEN 估算完成 THEN THE SYSTEM SHALL 展示全书总体比例和每章明细。
3. WHEN 全书 AI 比例展示 THEN THE SYSTEM SHALL 标注各平台的参考阈值（起点 0%、晋江限 3 类、番茄待定、AIGC 办法草案 20%）。
4. WHEN 某章 AI 比例高于阈值 THEN THE SYSTEM SHALL 标注警告并建议人工改写。
5. WHEN 估算方法说明 THEN THE SYSTEM SHALL 明确说明这是基于 AI 味特征的估算，不是精确比例，仅供参考。

### Requirement 3：发布就绪检查

**User Story：** 作为准备投稿的作者，我希望有一个"发布前检查"一键操作，汇总敏感词、AI 比例、格式规范等所有问题。

#### Acceptance Criteria

1. WHEN 作者触发发布就绪检查 THEN THE SYSTEM SHALL 依次执行：敏感词扫描、AI 比例估算、格式规范检查。
2. WHEN 格式规范检查 THEN THE SYSTEM SHALL 验证：章节标题格式、章节字数范围、总字数、空白章节、连续空行/空段。
3. WHEN 检查完成 THEN THE SYSTEM SHALL 汇总为发布就绪报告，按严重等级排序：阻断/警告/建议。
4. WHEN 报告中有阻断项 THEN THE SYSTEM SHALL 明确标注"建议修复后再投稿"。
5. WHEN 报告中无阻断项 THEN THE SYSTEM SHALL 显示"就绪"状态。
6. WHEN 作者选择了目标平台 THEN THE SYSTEM SHALL 按该平台的具体规则进行检查（如起点的首秀要求：8 万字验证 / 10 万字首秀 / 3 周首秀期 / 每日 6000）。

### Requirement 4：AI 使用标注生成

**User Story：** 作为合规意识强的作者，我希望系统自动生成 AI 使用标注声明，方便我在投稿时附上。

#### Acceptance Criteria

1. WHEN 作者触发标注生成 THEN THE SYSTEM SHALL 基于写作日志和 AI 味检测结果，生成 AI 辅助使用声明。
2. WHEN 声明生成 THEN THE SYSTEM SHALL 包含：AI 辅助的类型（大纲/续写/改写/校对）、辅助比例估算、使用的模型名称（如果记录了）、人工修改说明。
3. WHEN 声明展示 THEN THE SYSTEM SHALL 允许作者编辑后导出为文本/Markdown。
4. WHEN 平台要求标注 THEN THE SYSTEM SHALL 提示作者按平台要求格式调整。

### Requirement 5：测试与回归

**User Story：** 作为维护者，我希望合规工具有测试覆盖。

#### Acceptance Criteria

1. WHEN 运行单元测试 THEN THE SYSTEM SHALL 验证敏感词扫描正确命中测试用例。
2. WHEN 运行单元测试 THEN THE SYSTEM SHALL 验证 AI 比例估算逻辑正确。
3. WHEN 运行单元测试 THEN THE SYSTEM SHALL 验证格式规范检查覆盖所有检查项。
4. WHEN 运行单元测试 THEN THE SYSTEM SHALL 验证 AI 使用标注生成格式正确。
5. WHEN 运行 typecheck THEN THE SYSTEM SHALL 无错误。
