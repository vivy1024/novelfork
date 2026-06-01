# Requirements Document

## Introduction

本 spec 定义 NovelFork 的写作辅助工具集：章节钩子生成器、POV 视角管理、日更进度追踪、段落节奏可视化和对话比例分析。这些工具直接回应调研中发现的真实作者痛点（日更压力、长篇崩盘、节奏失控），补齐"写得更好、写得更稳"的产品能力。

设计依据：

- `docs/03-代码参考/07-小说写作与AI调研.md` §5（真实作者痛点）、§2.4（AI味12特征之句长方差）
- 现有代码：`hook-lifecycle.ts`（伏笔时序）、`style-analyzer.ts`（句长/段落统计）、`pov-filter.ts`（POV 基础）、`emotional_arcs.md`（情绪弧）

## Requirements

### Requirement 1：章节钩子生成器

**User Story：** 作为每天写完章节后想留悬念的作者，我希望系统能根据本章内容推荐 3-5 个章末钩子方案，帮我选一个最好的悬念结尾。

#### Acceptance Criteria

1. WHEN 作者写完一章正文 THEN THE SYSTEM SHALL 提供"生成章末钩子"入口。
2. WHEN 生成章末钩子时 THEN THE SYSTEM SHALL 基于本章内容、当前伏笔状态和下一章意图，生成 3-5 个备选钩子方案。
3. WHEN 钩子方案展示时 THEN THE SYSTEM SHALL 标注钩子类型（悬念型/反转型/情感型/信息型/动作型/...）和预估读者留存效果。
4. WHEN 作者选择钩子方案 THEN THE SYSTEM SHALL 将钩子文本插入章节末尾，并同步更新 `pending_hooks.md`。
5. WHEN 作者不使用钩子生成器 THEN THE SYSTEM SHALL 不阻断正常写作流程。
6. WHEN 模型未配置 THEN THE SYSTEM SHALL 在入口处显示模型配置提示（复用 AI gate）。

### Requirement 2：POV 视角管理

**User Story：** 作为写多视角小说的作者，我希望系统帮我追踪每个视角角色写了多少章、上次出现在第几章，避免某个视角被遗忘太久。

#### Acceptance Criteria

1. WHEN 书籍有多个 POV 角色 THEN THE SYSTEM SHALL 在书籍总览页展示 POV 仪表盘：各视角章节数、最近出现章节、间隔章数。
2. WHEN 某个 POV 角色超过 N 章未出现 THEN THE SYSTEM SHALL 在仪表盘中标注警告。
3. WHEN 作者规划新章节 THEN THE SYSTEM SHALL 建议下一章适合切换到的 POV 角色（基于间隔和情节需要）。
4. WHEN POV 角色列表变化 THEN THE SYSTEM SHALL 从 `character_matrix.md` 中自动提取有 POV 标记的角色。
5. WHEN 章节写作完成 THEN THE SYSTEM SHALL 自动更新 POV 统计。
6. WHEN 书籍只有单一视角 THEN THE SYSTEM SHALL 不显示 POV 仪表盘。

### Requirement 3：日更进度追踪

**User Story：** 作为需要日更 6000 字的签约作者，我希望有个仪表盘告诉我今天写了多少字、本周完成度、离目标还差多少，帮我维持稳定输出节奏。

#### Acceptance Criteria

1. WHEN 作者打开书籍总览 THEN THE SYSTEM SHALL 展示写作进度仪表盘：今日字数、本周字数、目标完成率。
2. WHEN 作者设置日更目标 THEN THE SYSTEM SHALL 持久化目标值（默认 6000 字/天）。
3. WHEN 作者完成章节写作 THEN THE SYSTEM SHALL 自动记录章节字数、完成时间到写作日志。
4. WHEN 展示写作趋势 THEN THE SYSTEM SHALL 提供最近 30 天的每日字数折线图。
5. WHEN 今日字数达到目标 THEN THE SYSTEM SHALL 显示达标状态。
6. WHEN 连续 N 天达标 THEN THE SYSTEM SHALL 显示连续达标天数（streak）。
7. WHEN 书籍设置了总目标章数 THEN THE SYSTEM SHALL 显示预计完成日期（基于当前日均字数）。

### Requirement 4：段落节奏可视化

**User Story：** 作为想改善文章节奏的作者，我希望看到我当前章节和参考文本的句长/段落分布对比图，直观发现节奏问题。

#### Acceptance Criteria

1. WHEN 作者打开章节分析 THEN THE SYSTEM SHALL 展示当前章节的句长分布直方图。
2. WHEN 书籍有 `style_profile.json` THEN THE SYSTEM SHALL 在同一图表中叠加参考文本的句长分布，方便对比。
3. WHEN 句长标准差低于阈值 THEN THE SYSTEM SHALL 标注"节奏过于均匀，可能有 AI 味"并高亮均匀段落。
4. WHEN 展示段落分析 THEN THE SYSTEM SHALL 显示段落长度分布和当前章节的段落长度序列。
5. WHEN 作者点击直方图的某个区间 THEN THE SYSTEM SHALL 高亮正文中属于该句长区间的句子。

### Requirement 5：对话比例分析

**User Story：** 作为担心章节节奏的作者，我希望系统告诉我当前章节的对话占比是否健康，帮我平衡叙述与对话。

#### Acceptance Criteria

1. WHEN 分析章节 THEN THE SYSTEM SHALL 计算对话文本占总字数的比例。
2. WHEN 对话比例展示 THEN THE SYSTEM SHALL 标注参考范围（战斗章 10-25%、日常章 30-50%、过渡章 15-35%）。
3. WHEN 对话比例明显偏离参考范围 THEN THE SYSTEM SHALL 提示作者注意。
4. WHEN 章节有角色对话 THEN THE SYSTEM SHALL 展示各角色的对话字数占比，帮助发现"某角色说太多/太少"。
5. WHEN 展示对话分析 THEN THE SYSTEM SHALL 复用 Writer Agent 中已有的 `extractDialogueFingerprints` 逻辑。

### Requirement 6：全书健康仪表盘

**User Story：** 作为写了 50 章、30 万字的作者，我希望有一个全局视图让我看到这本书的整体健康度——伏笔回收了多少、矛盾推进到哪了、AI 味是不是越来越重、节奏有没有坍缩，而不是翻每章的审计报告。

#### Acceptance Criteria

1. WHEN 作者打开书籍总览 THEN THE SYSTEM SHALL 展示全书健康仪表盘，包含以下聚合指标：
   - 人设一致性得分（基于连续性审计通过率）
   - 伏笔回收率（已回收 / 总伏笔数）+ 待回收伏笔清单
   - AI 味均值（全书平均 AI 味评分）+ 趋势折线
   - 节奏多样性得分（章节类型分布熵）
   - 情绪曲线（全书情绪弧线可视化）
   - 敏感词累计命中数
2. WHEN 有监控引擎触发预警 THEN THE SYSTEM SHALL 在仪表盘上方汇总显示：
   - 矛盾停滞预警（`detectStalledConflicts` 结果）
   - 伏笔债务预警（`analyzeHookHealth` 结果）
   - 节奏单调预警（`analyzeLongSpanFatigue` 章节类型/情绪/标题结果）
   - 开头/结尾同构预警
   - POV 遗忘预警（某角色超过 N 章未出场）
3. WHEN 展示趋势图 THEN THE SYSTEM SHALL 提供最近 20 章的 AI 味趋势、章节字数趋势、伏笔开/收比趋势。
4. WHEN 审计数据不足（<5 章） THEN THE SYSTEM SHALL 降级显示已有数据，不展示需要足够样本的指标。
5. WHEN 仪表盘数据源 THEN THE SYSTEM SHALL 复用已有的 `ContinuityAuditor`、`analyzeHookHealth`、`analyzeLongSpanFatigue`、`detectStalledConflicts`、`analyzeAITells` 引擎结果，不重新计算。

**关键前置**：需要持久化每章审计结果（当前只在 pipeline 运行时存在），新增 `chapter_audit_log` 表。

### Requirement 7：矛盾生命周期与辩证追踪

**User Story：** 作为写到中期开始感觉"不知道矛盾推到哪了"的作者，我希望系统按辩证法的视角帮我管理矛盾——每本书有一条主要矛盾、多条次要矛盾，矛盾有转化、有升级、有统一，不是简单的"冲突→解决"。

#### Acceptance Criteria

1. WHEN 创建书籍时 THEN THE SYSTEM SHALL 引导作者声明主要矛盾（一句话描述 + 矛盾双方 + 矛盾性质：对抗性/非对抗性）。
2. WHEN 创建矛盾条目时 THEN THE SYSTEM SHALL 支持标注矛盾层级：主要矛盾 / 次要矛盾。
3. WHEN 矛盾推进时 THEN THE SYSTEM SHALL 追踪矛盾的辩证转化：
   - escalating（矛盾激化）→ transforming（矛盾转化，次要变主要）→ unifying（矛盾统一/解决）
   - 每次状态变化记录发生章节、触发事件、转化原因
4. WHEN 全书的主要矛盾被忽视超过 N 章 THEN THE SYSTEM SHALL 触发"主线偏离"预警（比停滞检测更严格）。
5. WHEN 次要矛盾转化为主要矛盾 THEN THE SYSTEM SHALL 自动更新矛盾层级并通知作者确认。
6. WHEN 展示矛盾地图 THEN THE SYSTEM SHALL 以可视化方式展示所有矛盾的当前状态、层级关系和推进时间线。
7. WHEN 章节写完后 THEN THE SYSTEM SHALL 在审计报告中标注本章推进了哪些矛盾、是否涉及转化。

### Requirement 8：角色弧线长程追踪

**User Story：** 作为写群像小说的作者，我希望系统追踪每个重要角色的成长弧线——不是简单的"出场/未出场"，而是"TA 这一段经历了什么、变了什么、离最终的升华还差多远"。

#### Acceptance Criteria

1. WHEN 创建角色时 THEN THE SYSTEM SHALL 支持声明角色弧线类型（正向成长/堕落/扁平/转变/救赎）和弧线起终点。
2. WHEN 章节涉及角色关键行为 THEN THE SYSTEM SHALL 记录弧线推进事件（arc beat）：什么事 + 角色发生了什么变化。
3. WHEN 展示角色仪表盘 THEN THE SYSTEM SHALL 按时间线展示角色弧线进度条和关键事件。
4. WHEN 角色弧线长期无推进 THEN THE SYSTEM SHALL 触发预警（"角色 X 已 N 章无弧线推进"）。
5. WHEN 角色弧线发生矛盾 THEN THE SYSTEM SHALL 检测并标注（如"角色声明为正向成长型，但连续 3 次行为退行"）。
6. WHEN 展示群像总览 THEN THE SYSTEM SHALL 并排展示所有重要角色的弧线进度和最近动态。

### Requirement 9：题材文风一致性守护

**User Story：** 作为选了"悲苦仙侠"基调的作者，我希望系统帮我守住这个基调——如果我某章突然写得太轻快，或者文风开始漂向另一个题材，系统应该提醒我。

#### Acceptance Criteria

1. WHEN 建书选择流派+文风时 THEN THE SYSTEM SHALL 将声明的基调（tone）存入 book_rules 并注入每章 Writer prompt。
2. WHEN 章节写完后审计 THEN THE SYSTEM SHALL 检测本章文风与声明基调的偏离度。
3. WHEN 文风偏离超过阈值 THEN THE SYSTEM SHALL 标注偏离方向（"本章偏向轻快，声明基调为悲苦"），作者可选择接受或调整。
4. WHEN 连续 3 章偏离基调 THEN THE SYSTEM SHALL 建议作者是否要更新基调声明。
5. WHEN 建书时选择流派 THEN THE SYSTEM SHALL 自动推荐匹配的文风 tone（仙侠→古典/悲苦、都市→口语/冷峻、科幻→质朴/硬朗），作者可覆盖。

### Requirement 10：测试与回归

**User Story：** 作为维护者，我希望写作工具有测试覆盖。

#### Acceptance Criteria

1. WHEN 运行单元测试 THEN THE SYSTEM SHALL 验证钩子生成器输出格式正确。
2. WHEN 运行单元测试 THEN THE SYSTEM SHALL 验证 POV 统计计算正确（多视角/单视角/角色缺失）。
3. WHEN 运行单元测试 THEN THE SYSTEM SHALL 验证日更进度计算正确（跨天/时区/streak）。
4. WHEN 运行单元测试 THEN THE SYSTEM SHALL 验证句长分布和对话比例计算正确。
5. WHEN 运行 typecheck THEN THE SYSTEM SHALL 无错误。
