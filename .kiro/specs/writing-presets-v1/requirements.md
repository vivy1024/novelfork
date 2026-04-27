# Requirements Document

## Introduction

本 spec 定义 NovelFork 的写作预设体系：为空壳的流派配置、文风预设、时代/社会基底、逻辑风险自检、节拍模板和故事经纬题材推荐填充真实内容，使产品从“骨架可用”进入“开箱即写”状态。

本次升级后的核心判断：

- 文风不是孤立的句式或语气；文风通常由题材、时代基底、制度逻辑、人物阶层、生产力水平和叙事视角共同挤压出来。
- `tone` 只负责语言气质，不负责时代设定。
- `settingBase` 负责时代/社会/制度/技术/生活材料的现实参照与架空边界。
- `logicRisk` 负责检测时代错位、制度失效、经济崩坏、技术边界混乱、人物动机跳变等违和点。
- `bundle` 负责把流派、文风、时代基底和逻辑风险组合成可选的创作基底包。

设计依据：

- `docs/03-代码参考/07-小说写作与AI调研.md` §7（产品定位与内置预设）、§8（网文作品与作者技法）、§9（叙事学参考）
- 现有代码：`GenreProfile`（genre-profile.ts）、`BookRules`（book-rules.ts）、`style-analyzer.ts`、`writer-prompts.ts`
- 已落地的 `onboarding-and-story-jingwei` spec 中的经纬模板骨架（空白/基础/增强/题材推荐）
- 跨 spec 关系：`writing-modes-v1` 负责生成时注入预设；`writing-tools-v1` 负责写完后的文风/设定/逻辑偏离检测；`platform-compliance-v1` 只做平台合规，不替代内部逻辑自检。

## Requirements

### Requirement 1：流派配置内容填充

**User Story：** 作为选择了“修仙”题材的作者，我希望系统自动加载修仙流派的章节类型、疲劳词、数值体系开关和节奏规则，而不是一片空白等我自己从零填。

#### Acceptance Criteria

1. WHEN 系统提供流派配置 THEN THE SYSTEM SHALL 至少预置以下热门流派的完整 `GenreProfile`：修仙/玄幻、都市异能、悬疑/盗墓、女频/宅斗、科幻、历史穿越。
2. WHEN 流派配置加载时 THEN THE SYSTEM SHALL 包含 `chapterTypes`（战斗/日常/过渡/高潮/...）、`fatigueWords`（该流派常见 AI 疲劳词）、`pacingRule`（节奏规则）、`satisfactionTypes`（爽点类型）。
3. WHEN 流派配置包含数值体系 THEN THE SYSTEM SHALL 设置 `numericalSystem=true` 和 `powerScaling=true`（修仙/玄幻/科幻）。
4. WHEN 流派配置包含时代考据 THEN THE SYSTEM SHALL 设置 `eraResearch=true`（历史穿越）。
5. WHEN 作者选择流派 THEN THE SYSTEM SHALL 自动在 `book_rules.md` 中预填 `genreLock.primary` 和推荐的 `prohibitions`。
6. WHEN 作者不选择任何流派 THEN THE SYSTEM SHALL 仍可正常写作，不阻断。
7. WHEN 新增流派 THEN THE SYSTEM SHALL 允许作者在已有流派基础上自定义修改。

### Requirement 2：文风 tone 预设

**User Story：** 作为想让新书保持“冷峻质朴”或“悲苦孤独”基调的作者，我希望选择 tone 后，AI 写作自动保持叙事声音、句式节奏和情绪表达方式，而不是每次手动写提示词。

#### Acceptance Criteria

1. WHEN 系统提供文风预设 THEN THE SYSTEM SHALL 至少包含 5 类 tone 预设：悲苦孤独、冷峻质朴、古典意境、黑色幽默+社会批判、沙雕轻快。
2. WHEN 文风预设被选择 THEN THE SYSTEM SHALL 生成对应的 `style_guide.md` 模板，包含叙事声音、对话风格、场景描写、转折手法、节奏特征、词汇偏好、情绪表达方式、禁止漂移方向。
3. WHEN tone 模板描述参考作者或作品 THEN THE SYSTEM SHALL 注明参考来源与可学习技法，但不得抄袭原文或声称复刻作者。
4. WHEN 文风预设模板生成后 THEN THE SYSTEM SHALL 允许作者在模板基础上自由修改。
5. WHEN 作者已通过文本分析导入了自定义 style_guide THEN THE SYSTEM SHALL 不覆盖已有内容，而是提示合并或替换。
6. WHEN tone 与时代/社会基底有关 THEN THE SYSTEM SHALL 只引用 `settingBase`，不在 tone 内混写完整时代设定。

### Requirement 3：时代/社会基底 Setting Base 预设

**User Story：** 作为想写工业时代神秘学小说的作者，我希望系统提供一个类似“维多利亚工业神秘”的时代基底，让我知道社会阶层、交通、报纸、警察、教会、工厂和神秘体系如何共同运转，而不是只得到一句“冷峻质朴”。

#### Acceptance Criteria

1. WHEN 系统提供 setting base THEN THE SYSTEM SHALL 至少包含 6 类时代/社会基底：
   - `victorian-industrial-occult`：维多利亚/工业革命影子的神秘学城市。
   - `classical-travelogue-jianghu`：古典游历、志怪、江湖与地方秩序。
   - `sect-family-xianxia`：宗门/家族/资源分配驱动的修仙社会。
   - `modern-platform-economy-satire`：现代平台经济、教育内卷、贷款与绩效讽刺。
   - `historical-court-livelihood`：历史穿越中的朝堂、民生、军政与技术差。
   - `near-future-industrial-scifi`：近未来工业、科技组织、实验与社会治理。
2. WHEN setting base 被选择 THEN THE SYSTEM SHALL 输出可写入 `book_rules.md` 或 `setting_guide.md` 的模板。
3. WHEN setting base 模板生成 THEN THE SYSTEM SHALL 至少包含：现实/历史参照、社会阶层、权力结构、经济系统、技术/魔法边界、交通与信息传播、日常生活材料、可借用元素、不可照搬元素、常见违和点。
4. WHEN setting base 使用现实历史 THEN THE SYSTEM SHALL 明确“参考而非复刻”，允许架空改造，但必须保留足够的制度逻辑。
5. WHEN 作者选择纯架空 THEN THE SYSTEM SHALL 仍要求选择或自定义一个现实参照锚点，避免无来源的时代拼贴。
6. WHEN setting base 与 genre/tone 冲突 THEN THE SYSTEM SHALL 在推荐组合中提示风险，而不是静默启用。

### Requirement 4：逻辑风险自检 Logic Risk 预设

**User Story：** 作为写架空长篇的作者，我希望系统提醒我常见逻辑谬误，例如维多利亚背景却出现现代移动支付、宗门社会没有资源约束、科幻技术无成本扩张、角色掌握信息的速度不合理。

#### Acceptance Criteria

1. WHEN 系统提供 logic risk 预设 THEN THE SYSTEM SHALL 至少覆盖：时代错位、信息传播速度、交通与地理、经济/资源体系、技术/魔法边界、权力机构响应、阶层行为、人物动机、组织成本、爽点代价。
2. WHEN logic risk 被启用 THEN THE SYSTEM SHALL 输出可注入 Writer prompt 的写前约束，以及可供 `writing-tools-v1` 后置审计复用的检查规则。
3. WHEN 检查时代错位 THEN THE SYSTEM SHALL 基于已选 setting base 的技术/制度边界，而不是固定现实历史。
4. WHEN 检查制度逻辑 THEN THE SYSTEM SHALL 关注“机构为什么这样行动、成本从哪里来、普通人如何受影响”。
5. WHEN 检查人物动机 THEN THE SYSTEM SHALL 标注“角色行为是否符合其阶层、信息、利益、恐惧和前史”。
6. WHEN 检查结果不确定 THEN THE SYSTEM SHALL 输出“需要作者确认”而不是替作者强行改写。

### Requirement 5：预设组合 Bundle 推荐

**User Story：** 作为新书作者，我希望选择“工业神秘悬疑”或“制度修仙讽刺”这样的创作方向后，系统能自动推荐匹配的流派、文风、时代基底和逻辑自检组合。

#### Acceptance Criteria

1. WHEN 系统提供 bundle THEN THE SYSTEM SHALL 至少包含 6 个推荐组合：
   - 工业神秘悬疑：悬疑/科幻 + 冷峻质朴 + 维多利亚工业神秘 + 制度/信息/技术边界检查。
   - 古典游历仙侠：仙侠 + 古典意境 + 古典游历江湖 + 交通/民俗/日常材料检查。
   - 凡人宗门修仙：修仙 + 悲苦/克制 + 宗门家族修仙社会 + 资源/境界/组织成本检查。
   - 制度修仙讽刺：都市/修仙 + 黑色幽默 + 现代平台经济讽刺 + 制度/贷款/绩效逻辑检查。
   - 历史穿越治世：历史穿越 + 古典/质朴 + 朝堂民生 + 技术差/财政/军政检查。
   - 近未来硬科幻：科幻 + 冷峻质朴 + 近未来工业科幻 + 技术成本/组织响应检查。
2. WHEN bundle 被启用 THEN THE SYSTEM SHALL 展示其包含的 genre、tone、settingBase、logicRisks 和适用/不适用场景。
3. WHEN 作者启用 bundle THEN THE SYSTEM SHALL 允许逐项取消或替换其中的预设，不强制全量启用。
4. WHEN bundle 包含高难度创作方向（如黑色幽默+现实映射）THEN THE SYSTEM SHALL 标注难度与必要前提。

### Requirement 6：叙事节拍模板

**User Story：** 作为新手作者，我希望选择“救猫咪 15 节拍”后，大纲规划 Agent 自动按该结构组织卷/章节点，帮我搭好骨架。

#### Acceptance Criteria

1. WHEN 系统提供节拍模板 THEN THE SYSTEM SHALL 至少包含：英雄之旅（17 阶段）、救猫咪（15 节拍）、三幕结构、网文开篇钩子 12 式、章节结尾钩子生成器。
2. WHEN 节拍模板被应用 THEN THE SYSTEM SHALL 在 `volume_outline.md` 中生成对应的结构框架。
3. WHEN 节拍模板被应用 THEN THE SYSTEM SHALL 标注每个节拍的目的、典型字数占比和情绪走向。
4. WHEN 作者选择了节拍模板 THEN THE SYSTEM SHALL 允许跳过、合并或自定义节拍，不强制全部填充。
5. WHEN Architect Agent 规划大纲时 THEN THE SYSTEM SHALL 参考已选节拍模板的结构，但不替代作者意图。

### Requirement 7：AI 味过滤预设

**User Story：** 作为担心 AI 味的作者，我希望选择“句长方差修复”预设后，AI 写作自动打破 AI 常见的“句长均质”模式。

#### Acceptance Criteria

1. WHEN 系统提供 AI 味过滤预设 THEN THE SYSTEM SHALL 至少包含：12 特征全量扫描、句长方差修复、情感具体化、口语化对话。
2. WHEN 预设被应用 THEN THE SYSTEM SHALL 在 Writer Agent 的 system prompt 中注入对应的写作约束。
3. WHEN 句长方差修复预设启用 THEN THE SYSTEM SHALL 要求 AI 在同一段落内混合 5-80 字的句子，并在后置检测中验证句长标准差。
4. WHEN 情感具体化预设启用 THEN THE SYSTEM SHALL 要求 AI 用具体动作和五感替代“感到开心/难过”类抽象表述。
5. WHEN 口语化对话预设启用 THEN THE SYSTEM SHALL 要求对话符合角色身份和年龄，避免书面语。

### Requirement 8：文学技法预设

**User Story：** 作为想学习伏笔技巧的作者，我希望启用“伏笔四态追踪”预设后，系统帮我管理伏笔从埋设到回收的完整生命周期。

#### Acceptance Criteria

1. WHEN 系统提供文学技法预设 THEN THE SYSTEM SHALL 至少包含：人物多维度展开、伏笔四态追踪、一致性审计、控制观念锚定。
2. WHEN 人物多维度展开预设启用 THEN THE SYSTEM SHALL 要求每个重要角色至少有 2 个身份标签和 1 个反差细节。
3. WHEN 伏笔四态追踪预设启用 THEN THE SYSTEM SHALL 在 `pending_hooks.md` 中标注每个伏笔的状态（埋/暗/半明/收）。
4. WHEN 控制观念锚定预设启用 THEN THE SYSTEM SHALL 在 `book_rules.md` 中要求作者填写一句话哲学命题，并在每章审计中检查是否偏离。
5. WHEN 一致性审计预设启用 THEN THE SYSTEM SHALL 在每 N 章后自动触发人设/时间线/伏笔一致性检查。

### Requirement 9：经纬题材推荐内容填充

**User Story：** 作为写修仙小说的作者，我在建书时选择“按题材推荐”后，希望看到境界体系、功法、势力等修仙专属推荐栏目，而不是空的推荐列表。

#### Acceptance Criteria

1. WHEN 题材推荐为修仙/玄幻 THEN THE SYSTEM SHALL 推荐栏目：境界体系、功法、势力/宗门、资源/灵材、法宝/神器、秘境/副本。
2. WHEN 题材推荐为悬疑/盗墓 THEN THE SYSTEM SHALL 推荐栏目：线索、谜团、误导项、案件时间线、真相层。
3. WHEN 题材推荐为女频/感情流 THEN THE SYSTEM SHALL 推荐栏目：关系变化、情感节点、误会与和解、家庭关系、人物成长。
4. WHEN 题材推荐为科幻 THEN THE SYSTEM SHALL 推荐栏目：科技树、星图/地理、组织/阵营、术语表、实验记录。
5. WHEN 题材推荐为都市 THEN THE SYSTEM SHALL 推荐栏目：职业线、关系网、资产/经济、城市地图、社会身份。
6. WHEN 题材推荐为历史穿越 THEN THE SYSTEM SHALL 推荐栏目：时代背景、历史人物、朝堂势力、科技差、蝴蝶效应。
7. WHEN 推荐栏目展示时 THEN THE SYSTEM SHALL 允许作者逐项勾选/取消，不强制全部创建。
8. WHEN 推荐栏目被勾选创建 THEN THE SYSTEM SHALL 为每个栏目预填说明文本和推荐的自定义字段定义。

### Requirement 10：预设管理 UI

**User Story：** 作为作者，我希望在 Studio 中有统一的入口查看、启用、禁用和编辑所有预设。

#### Acceptance Criteria

1. WHEN 打开预设管理页 THEN THE SYSTEM SHALL 展示六类预设（节拍/文风/时代基底/逻辑自检/AI味过滤/文学技法）和推荐组合 bundle 的卡片列表。
2. WHEN 预设卡片展示时 THEN THE SYSTEM SHALL 包含预设名称、一句话说明、适用流派标签、启用/禁用开关。
3. WHEN 预设启用时 THEN THE SYSTEM SHALL 持久化到书籍配置，在后续写作中自动生效。
4. WHEN 作者编辑预设 THEN THE SYSTEM SHALL 保存为自定义版本，不覆盖内置预设。
5. WHEN 多个预设冲突（如两个 tone 同时启用、settingBase 与 genre 明显冲突）THEN THE SYSTEM SHALL 提示冲突并要求选择。

### Requirement 11：测试与回归

**User Story：** 作为维护者，我希望所有预设内容有自动化测试，确保格式正确、字段完整、流派规则不遗漏。

#### Acceptance Criteria

1. WHEN 运行单元测试 THEN THE SYSTEM SHALL 验证每个 GenreProfile 的 YAML 解析正确且必填字段完整。
2. WHEN 运行单元测试 THEN THE SYSTEM SHALL 验证每个 tone 预设的 style_guide 模板包含规定维度，且不混写完整 setting base。
3. WHEN 运行单元测试 THEN THE SYSTEM SHALL 验证每个 setting base 包含历史/现实参照、制度结构、技术边界和常见违和点。
4. WHEN 运行单元测试 THEN THE SYSTEM SHALL 验证每个 logic risk 规则包含 prompt 约束和后置检查说明。
5. WHEN 运行单元测试 THEN THE SYSTEM SHALL 验证每个 bundle 能解析到存在的 genre、tone、settingBase 和 logicRisk。
6. WHEN 运行单元测试 THEN THE SYSTEM SHALL 验证每个节拍模板的结构层次和节拍数量正确。
7. WHEN 运行单元测试 THEN THE SYSTEM SHALL 验证经纬题材推荐生成的栏目数量和名称正确。
8. WHEN 运行 typecheck THEN THE SYSTEM SHALL 无错误。
