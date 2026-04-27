# Requirements Document

## Introduction

本 spec 定义 NovelFork 的多种 AI 写作模式。当前系统只有"写整章"（`writeChapter`）和"修订整章"（`reviseDraft` 的 5 种 mode），缺少精细化的 AI 辅助模式。真实的网文作者写作场景远比"一口气写完一章"复杂——有时只需要 AI 帮忙接一段话、扩展一个战斗场景、生成几句角色对话，或者对同一段话看几个不同版本。

现有修订模式：`polish`（润色）/ `rewrite`（改写）/ `rework`（重写）/ `anti-detect`（反检测）/ `spot-fix`（定点修复），这些都是针对已写章节的后置处理。本 spec 补充的是**前置/中途辅助**模式。

设计依据：

- 现有代码：`WriterAgent.writeChapter()`、`ReviserAgent.reviseChapter()`（5 种 mode）、`PipelineRunner.reviseDraft()`
- 真实作者场景：选段续写、场景扩写、对话生成、多版本对比、大纲分支、段落补写
- 现有上下文系统：style_guide / style_profile / genre_profile / book_rules / 经纬上下文 / 真相文件全部可复用

## Requirements

### Requirement 1：选段续写

**User Story：** 作为写到一半卡住的作者，我希望选中正文中的某个段落，让 AI 从这里接着往下写 500-2000 字，保持前文风格和情节连贯，而不是必须写完整章。

#### Acceptance Criteria

1. WHEN 作者选中章节正文中的一段文字 THEN THE SYSTEM SHALL 提供"从这里续写"入口。
2. WHEN 续写触发 THEN THE SYSTEM SHALL 读取选中段落之前的全部正文作为上下文。
3. WHEN 续写时 THEN THE SYSTEM SHALL 注入当前书的 style_guide、style_profile、genre_profile、book_rules、经纬上下文。
4. WHEN 续写结果生成 THEN THE SYSTEM SHALL 展示预览，作者可接受/编辑/丢弃。
5. WHEN 作者接受续写 THEN THE SYSTEM SHALL 将续写文本插入选中段落之后。
6. WHEN 续写时 THEN THE SYSTEM SHALL 允许作者指定续写方向（一句话提示，可选）。
7. WHEN 续写时 THEN THE SYSTEM SHALL 允许作者指定续写字数范围（默认 500-1500 字）。
8. WHEN 模型未配置 THEN THE SYSTEM SHALL 走 AI gate。

### Requirement 2：场景扩写

**User Story：** 作为觉得战斗场景太短的作者，我希望选中一段打斗描写，让 AI 把它扩展到 2000 字，增加细节、动作、环境和角色反应。

#### Acceptance Criteria

1. WHEN 作者选中一段正文 THEN THE SYSTEM SHALL 提供"扩写此段"入口。
2. WHEN 扩写触发 THEN THE SYSTEM SHALL 保持扩写段前后的正文不变，只扩展选中内容。
3. WHEN 扩写时 THEN THE SYSTEM SHALL 保持原段的核心事件和角色行为不变，只增加细节。
4. WHEN 扩写时 THEN THE SYSTEM SHALL 允许作者指定扩写目标字数和扩写方向（五感细节/动作分解/心理活动/环境描写/对话补充）。
5. WHEN 扩写完成 THEN THE SYSTEM SHALL 展示对比（原文 vs 扩写），作者可接受/编辑/丢弃。
6. WHEN 扩写内容注入 THEN THE SYSTEM SHALL 替换选中段落，不影响其余正文。

### Requirement 3：对话生成

**User Story：** 作为需要写一段角色对白的作者，我希望指定参与角色和场景背景，AI 帮我生成一段符合角色性格的对话。

#### Acceptance Criteria

1. WHEN 作者触发对话生成 THEN THE SYSTEM SHALL 提供角色选择（从 character_matrix 中选取）和场景描述输入。
2. WHEN 对话生成时 THEN THE SYSTEM SHALL 从经纬中读取角色性格、说话风格、关系矩阵。
3. WHEN 对话生成时 THEN THE SYSTEM SHALL 允许作者指定对话目的（日常/争执/告白/商议/谈判/...）和对话轮数（3-20 轮）。
4. WHEN 对话生成时 THEN THE SYSTEM SHALL 遵守 style_guide 的对话风格描述。
5. WHEN 对话结果展示 THEN THE SYSTEM SHALL 标注每个角色的台词，作者可逐句编辑。
6. WHEN 作者确认 THEN THE SYSTEM SHALL 将对话插入光标位置或选中位置之后。
7. WHEN 角色经纬信息不足 THEN THE SYSTEM SHALL 使用已有的 extractDialogueFingerprints 提取最近章节的对话特征作为补充。

### Requirement 4：多版本对比生成

**User Story：** 作为对某段话不满意的作者，我希望 AI 给我同一段话的 3 个不同版本，让我挑最好的或者组合使用。

#### Acceptance Criteria

1. WHEN 作者选中一段正文 THEN THE SYSTEM SHALL 提供"生成多版本"入口。
2. WHEN 多版本生成时 THEN THE SYSTEM SHALL 默认生成 3 个版本（可选 2-5），每个版本使用不同的写作角度或风格强度。
3. WHEN 版本展示时 THEN THE SYSTEM SHALL 并排或切换展示各版本，高亮与原文的差异。
4. WHEN 版本标注时 THEN THE SYSTEM SHALL 为每个版本标注特点（如"更克制"/"更激烈"/"更口语化"）。
5. WHEN 作者选择版本 THEN THE SYSTEM SHALL 替换选中段落。
6. WHEN 作者希望组合 THEN THE SYSTEM SHALL 允许从多个版本中逐句挑选组合。

### Requirement 5：段落补写

**User Story：** 作为发现两段之间缺少过渡的作者，我希望在两段之间插入 AI 生成的过渡段落，保持上下文衔接自然。

#### Acceptance Criteria

1. WHEN 作者将光标放在两段之间 THEN THE SYSTEM SHALL 提供"在此补写"入口。
2. WHEN 补写触发 THEN THE SYSTEM SHALL 读取前一段和后一段作为上下文。
3. WHEN 补写时 THEN THE SYSTEM SHALL 生成衔接自然的过渡段落，不重复前后内容。
4. WHEN 补写时 THEN THE SYSTEM SHALL 允许作者指定补写目的（场景转换/时间推进/情绪过渡/悬念铺垫）。
5. WHEN 补写结果展示 THEN THE SYSTEM SHALL 在前后段落之间预览，作者可接受/编辑/丢弃。

### Requirement 6：大纲续写与分支

**User Story：** 作为写了 50 章开始规划下一卷的作者，我希望 AI 基于当前进度和伏笔状态，给我 2-3 条下一卷的走向建议。

#### Acceptance Criteria

1. WHEN 作者触发大纲续写 THEN THE SYSTEM SHALL 读取当前 volume_outline、pending_hooks、current_state、chapter_summaries。
2. WHEN 大纲续写时 THEN THE SYSTEM SHALL 生成 2-3 条走向建议，每条包含核心冲突、关键转折、预计章数。
3. WHEN 走向建议展示 THEN THE SYSTEM SHALL 标注每条走向消耗/回收的伏笔。
4. WHEN 作者选择走向 THEN THE SYSTEM SHALL 将选中走向扩展为完整的下一卷大纲。
5. WHEN 大纲生成 THEN THE SYSTEM SHALL 遵守已有的节拍模板（如果启用）。
6. WHEN 大纲分支保存 THEN THE SYSTEM SHALL 支持保存多个大纲分支，作者可在分支间切换。

### Requirement 7：作品导入与文风分析增强

**User Story：** 作为有 3 本已完结作品的作者，我希望把它们拖进来，系统分析我三本书的共同文风特征，以后 AI 按我自己的风格写。

#### Acceptance Criteria

1. WHEN 作者触发作品导入 THEN THE SYSTEM SHALL 支持拖放 .txt/.docx/.epub 文件或粘贴文本。
2. WHEN 导入完结作品 THEN THE SYSTEM SHALL 只分析文风，不创建写作任务。
3. WHEN 导入在写作品 THEN THE SYSTEM SHALL 分析文风 + 重建真相文件，支持后续 AI 续写。
4. WHEN 多本作品导入 THEN THE SYSTEM SHALL 合并分析，提取共同文风指纹（句长/段落/修辞的交集特征）。
5. WHEN 导入作品后 THEN THE SYSTEM SHALL 生成统一的个人风格 profile（跨书籍），可应用到新书。
6. WHEN 新书使用个人风格 THEN THE SYSTEM SHALL 将个人风格 profile 作为 style_guide 的基础模板。
7. WHEN 在写作品需要续写 THEN THE SYSTEM SHALL 支持从最后一章继续写（使用重建的真相文件+提取的文风）。
8. WHEN 作品正在连载 THEN THE SYSTEM SHALL 定期检测文风漂移（与初始 style_profile 对比），偏差过大时提醒。

### Requirement 8：测试与回归

#### Acceptance Criteria

1. WHEN 运行单元测试 THEN THE SYSTEM SHALL 验证每种写作模式的输入/输出格式正确。
2. WHEN 运行单元测试 THEN THE SYSTEM SHALL 验证续写/扩写不破坏上下文连贯性标记。
3. WHEN 运行单元测试 THEN THE SYSTEM SHALL 验证对话生成遵守角色指纹。
4. WHEN 运行单元测试 THEN THE SYSTEM SHALL 验证多版本生成的版本数量正确且各不相同。
5. WHEN 运行 typecheck THEN THE SYSTEM SHALL 无错误。
