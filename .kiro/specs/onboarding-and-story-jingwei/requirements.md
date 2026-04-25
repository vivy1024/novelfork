# Requirements Document

## Introduction

本 spec 定义 NovelFork 的首用体验与「故事经纬」产品化改造：首次打开软件时通过新手指导让作者知道模型配置、建书、故事经纬、AI 写作、AI 味检测与工作台模式在哪里；同时将现有 Bible 概念在 UI 与作者心智中重命名为 **故事经纬 / 经纬**，并要求经纬结构可编辑、可裁剪、可扩展，而不是把某一本书或某一类小说的设定结构固化为所有项目的默认 schema。

设计依据：

- `docs/03-代码参考/06-NarraFork-UIUX与交互功能调研.md`
  - 学习 NarraFork 的信息架构、配置后置、能力透明化与管理入口组织。
  - 不机械照抄 coder 向节点图和 Admin 面板。
- `docs/03-代码参考/07-小说写作与AI调研.md`
  - v1.0 最终定位：通用网文 AI 写作软件，核心是 4 表、动态追踪、AI 味过滤、按需 coding agent。
  - 4 表共性：人物 / 事件 / 设定 / 章节摘要。
  - 可选能力：流派模板、节拍模板、文风预设、消 AI 味预设。
- `docs/03-代码参考/07-小说写作与AI调研-v0.1-v0.4-archive.md`
  - v0.4 纠偏优先：不要把《没钱修什么仙》或 v0.3 的 10 维度 / 两级 RAG / 大型预制资产包误当全体作者共性。
  - 《没钱修什么仙》只能作为高级范本 / 导入样例，不作为默认标准。

UI 技术基础：Studio 前端以 **React 19 + Tailwind CSS + shadcn/ui 组件体系** 为基础。新增 UI 应优先使用 shadcn/ui 的 Dialog、Card、Button、Badge、Tabs、Sheet、Accordion、Alert、Form、Input、Textarea、Select、Switch、Checkbox、DropdownMenu、Tooltip、ScrollArea、Table 等组件组合，不新增重型 UI 框架。

## Requirements

### Requirement 1：首次欢迎与新手指导

**User Story：** 作为第一次打开 NovelFork 的作者，我希望软件先用轻量引导告诉我模型配置、建书、故事经纬、AI 能力和工作台模式在哪里，而不是直接把我丢进空页面或强迫我先配置完所有东西。

#### Acceptance Criteria

1. WHEN 用户第一次打开 Studio 且没有完成过新手引导 THEN THE SYSTEM SHALL 显示可关闭的首次欢迎弹窗。
2. WHEN 首次欢迎弹窗显示时 THEN THE SYSTEM SHALL 明确说明：建议第一步配置 AI 模型，但未配置模型也可以先创建本地书籍、整理故事经纬、编辑章节。
3. WHEN 首次欢迎弹窗显示时 THEN THE SYSTEM SHALL 至少包含三个入口卡片：`配置 AI 模型`、`创建第一本书`、`了解工作台模式`。
4. WHEN 用户点击 `配置 AI 模型` THEN THE SYSTEM SHALL 跳转或打开模型配置入口，并在完成后返回原上下文。
5. WHEN 用户点击 `暂时跳过` 或关闭弹窗 THEN THE SYSTEM SHALL 允许进入首页，不阻断使用。
6. WHEN 用户关闭首次欢迎弹窗 THEN THE SYSTEM SHALL 持久化 dismissed 状态；用户仍可从帮助 / 新手引导入口重新打开。
7. WHEN 本地没有可用 provider 配置 THEN THE SYSTEM SHALL 不把该状态渲染为启动失败，只在引导和相关 AI 动作处提示。

### Requirement 2：首页开始使用任务清单

**User Story：** 作为新用户，我希望首页有一个清晰的开始使用清单，按顺序告诉我先配置模型、再建书、再认识故事经纬和 AI 功能。

#### Acceptance Criteria

1. WHEN 首页没有被用户关闭新手任务区 THEN THE SYSTEM SHALL 显示 `开始使用 NovelFork` 任务清单。
2. WHEN 任务清单显示时 THEN THE SYSTEM SHALL 按以下顺序展示任务：
   - 配置 AI 模型
   - 创建第一本书
   - 认识故事经纬
   - 创建第一章 / 导入正文
   - 试用 AI 写作与评点
   - 试用 AI 味检测
   - 了解工作台模式
3. WHEN `配置 AI 模型` 任务展示时 THEN THE SYSTEM SHALL 把它置为第一项，并标注为推荐第一步。
4. WHEN AI 模型未配置时 THEN THE SYSTEM SHALL 在第一项显示 `未配置模型，不影响本地写作`，而不是错误状态。
5. WHEN AI 模型已配置且连接测试成功 THEN THE SYSTEM SHALL 显示当前默认 provider / model 摘要。
6. WHEN 用户完成任务 THEN THE SYSTEM SHALL 将任务标记为完成并持久化。
7. WHEN 用户关闭任务清单 THEN THE SYSTEM SHALL 不再默认展示，但提供入口重新打开。
8. WHEN `试用 AI 写作与评点` 被点击但模型未配置 THEN THE SYSTEM SHALL 引导用户回到模型配置任务，不清空当前书籍或章节上下文。

### Requirement 3：模型配置第一步但不作为硬阻断

**User Story：** 作为作者，我接受模型配置是 AI 软件的第一步，但我不希望没配置模型时连软件都看不了、书都建不了。

#### Acceptance Criteria

1. WHEN provider / model 未配置 THEN THE SYSTEM SHALL 允许用户进入 Studio、浏览首页、创建本地书籍、维护故事经纬、编辑章节。
2. WHEN provider / model 未配置且用户触发需要模型的 AI 动作 THEN THE SYSTEM SHALL 显示轻量提示：该功能需要配置 AI 模型。
3. WHEN 需要模型的 AI 动作被拦截 THEN THE SYSTEM SHALL 提供 `配置模型` 与 `取消` 两个动作，并保留用户当前输入、选区和页面位置。
4. WHEN 用户进入模型配置页 THEN THE SYSTEM SHALL 解释 provider、API Key、默认模型、连接测试分别用于什么。
5. WHEN 模型配置测试失败 THEN THE SYSTEM SHALL 显示可读错误摘要，不把整个应用标记为不可用。
6. WHEN 新建书籍流程运行时 THEN THE SYSTEM SHALL 不因 provider / model 未配置而失败。

### Requirement 4：新建书籍本地优先

**User Story：** 作为还没配置 AI 的作者，我希望可以先创建一本本地书籍，进入软件看看结构和功能，之后再补 AI 能力。

#### Acceptance Criteria

1. WHEN 用户打开新建书籍弹窗 THEN THE SYSTEM SHALL 提供书籍基础信息：书名、题材、平台、每章字数、目标章数、工作流模式。
2. WHEN 用户填写必需的本地字段 THEN THE SYSTEM SHALL 始终允许点击 `创建本地书籍`。
3. WHEN provider / model 未配置 THEN THE SYSTEM SHALL 禁用或折叠 AI 初始化选项，并显示 `尚未配置 AI 模型，仍可先创建本地书籍`。
4. WHEN provider / model 已配置 THEN THE SYSTEM SHALL 提供可选 AI 初始化项：生成初始故事经纬、生成简介 / 卖点、生成前三章方向。
5. WHEN AI 初始化失败 THEN THE SYSTEM SHALL 保留已创建的本地书籍，并提示 AI 初始化可稍后重试。
6. WHEN 本地书籍创建成功 THEN THE SYSTEM SHALL 进入书籍总览，而不是停留在建书弹窗。
7. WHEN 当前逻辑遇到 `后端写作运行时尚未配置完成` 类错误 THEN THE SYSTEM SHALL 将其降级为 AI 功能不可用提示，不阻断本地书籍创建。

### Requirement 5：故事经纬命名与兼容

**User Story：** 作为中文网文作者，我希望产品不要直接叫 Bible，而是用更符合中文写作气质的「故事经纬」。

#### Acceptance Criteria

1. WHEN UI 展示原 Bible 模块入口时 THEN THE SYSTEM SHALL 使用 `经纬` 作为侧边栏短名。
2. WHEN UI 展示模块页面标题时 THEN THE SYSTEM SHALL 使用 `故事经纬`。
3. WHEN UI 需要解释该模块时 THEN THE SYSTEM SHALL 使用说明：故事经纬是本书的长期记忆与结构脉络，用来统摄人物、事件、设定、章节摘要、伏笔、名场面与核心记忆，使长篇不乱，AI 不忘。
4. WHEN 代码层仍存在历史 `bible_*` schema / API / 类型名 THEN THE SYSTEM SHALL 允许内部暂存为 legacy 命名，但 UI、文案、用户可见路由应优先使用故事经纬 / jingwei 命名。
5. WHEN 文档引用旧调研或旧 spec 中的 Bible THEN THE SYSTEM SHALL 明确说明它在用户侧对应 `故事经纬`。
6. WHEN 新增用户可见文案 THEN THE SYSTEM SHALL 不再直接把 Bible 作为主名称。

### Requirement 6：故事经纬结构可编辑

**User Story：** 作为不同类型小说的作者，我希望故事经纬不是固定 10 个栏目，而是我可以按自己的书新增、删除、改名、排序和禁用栏目。

#### Acceptance Criteria

1. WHEN 创建新书时 THEN THE SYSTEM SHALL 允许用户选择故事经纬结构：空白经纬、基础经纬、增强经纬、按题材推荐、导入已有经纬。
2. WHEN 用户选择基础经纬 THEN THE SYSTEM SHALL 创建默认栏目：人物、事件、设定、章节摘要。
3. WHEN 用户选择增强经纬 THEN THE SYSTEM SHALL 在基础栏目外追加：伏笔、名场面、核心记忆。
4. WHEN 用户进入故事经纬管理页 THEN THE SYSTEM SHALL 支持栏目层编辑：新增、删除、重命名、排序、启用 / 禁用。
5. WHEN 用户编辑栏目 THEN THE SYSTEM SHALL 支持设置栏目说明、字段定义、默认可见性、是否参与 AI 上下文、是否在侧栏显示。
6. WHEN 用户禁用某栏目 THEN THE SYSTEM SHALL 保留数据但默认隐藏，并从 AI 上下文装配中排除，除非用户重新启用。
7. WHEN 用户删除栏目 THEN THE SYSTEM SHALL 要求确认，并优先执行软删除或归档，避免误删数据。
8. WHEN 用户需要特定小说结构 THEN THE SYSTEM SHALL 支持自定义栏目，不要求所有书拥有相同结构。

### Requirement 7：故事经纬条目通用模型

**User Story：** 作为作者，我希望不同栏目能有自己的字段，但所有条目又能统一参与搜索、关联、AI 上下文和时间线控制。

#### Acceptance Criteria

1. WHEN 创建任何故事经纬条目 THEN THE SYSTEM SHALL 支持通用字段：标题、正文、标签、所属栏目、关联章节、创建时间、更新时间。
2. WHEN 栏目定义了自定义字段 THEN THE SYSTEM SHALL 在条目表单中渲染对应字段，并把值保存为结构化 JSON。
3. WHEN 条目参与 AI 上下文 THEN THE SYSTEM SHALL 支持可见性：tracked、global、nested。
4. WHEN 条目设置 `visible_after_chapter` THEN THE SYSTEM SHALL 仅在当前章节达到该章节后注入 AI 上下文。
5. WHEN 条目关联其他条目 THEN THE SYSTEM SHALL 支持 nested 引用，不限于人物 / 事件 / 设定四类。
6. WHEN 历史 `bible_character`、`bible_event`、`bible_setting`、`bible_chapter_summary` 数据存在 THEN THE SYSTEM SHALL 能以故事经纬栏目和条目方式展示，不要求立即破坏性迁移。
7. WHEN AI 上下文构建读取故事经纬 THEN THE SYSTEM SHALL 以当前书启用的栏目和条目为准，而不是写死固定 10 维度。

### Requirement 8：模板与高级范本边界

**User Story：** 作为产品负责人，我希望《没钱修什么仙》和各种题材模板能提供灵感，但不要强行变成所有作者的默认结构。

#### Acceptance Criteria

1. WHEN 系统提供题材推荐 THEN THE SYSTEM SHALL 仅作为可选导入，不作为强制建书步骤。
2. WHEN 用户选择按题材推荐 THEN THE SYSTEM SHALL 展示推荐栏目清单，并允许用户逐项勾选 / 取消。
3. WHEN 用户选择修仙 / 玄幻 THEN THE SYSTEM MAY 推荐境界体系、功法、势力、资源、法宝、秘境等栏目，但不得默认锁死。
4. WHEN 用户选择悬疑 / 盗墓 THEN THE SYSTEM MAY 推荐线索、谜团、误导项、案件时间线、真相层等栏目。
5. WHEN 用户选择女频 / 感情流 THEN THE SYSTEM MAY 推荐关系变化、情感节点、误会与和解、家庭关系、人物成长等栏目。
6. WHEN 用户导入 `D:/DESKTOP/novelfork/没钱修什么仙` 式目录 THEN THE SYSTEM SHALL 把它识别为高级范本 / 现有经纬导入，而不是默认模板。
7. WHEN 文案介绍高级范本 THEN THE SYSTEM SHALL 明确说明：范本是参考，不代表所有小说都需要这些栏目。

### Requirement 9：功能页空态教学

**User Story：** 作为新用户，我希望进入任何还没有内容的功能页时，页面能告诉我这个功能是干什么的、什么时候用、下一步点哪里，而不是只显示暂无数据。

#### Acceptance Criteria

1. WHEN 故事经纬为空 THEN THE SYSTEM SHALL 显示功能说明和入口：创建栏目、使用基础经纬、导入经纬、查看示例。
2. WHEN 人物为空 THEN THE SYSTEM SHALL 说明人物用于记录主角、配角、反派、群像、关系和阶段变化，并提供新建 / 从正文提取 / 导入入口。
3. WHEN 设定为空 THEN THE SYSTEM SHALL 说明设定用于世界观、力量体系、地图、规则、组织、物品和术语，并提供新建 / 导入 / AI 生成入口。
4. WHEN 伏笔为空 THEN THE SYSTEM SHALL 说明伏笔用于记录线索的埋设、推进、回收和遗落，并提供新建 / 从章节标记 / 检查未回收入口。
5. WHEN 名场面为空 THEN THE SYSTEM SHALL 说明名场面用于收束爆点、反差桥段、成梗场景和高传播片段，并提供记录 / 提取 / 设计入口。
6. WHEN 核心记忆为空 THEN THE SYSTEM SHALL 说明核心记忆是给 AI 常驻使用的小而硬书设，不替代完整经纬，并提供创建 / 生成 / 示例入口。
7. WHEN AI 味报告为空 THEN THE SYSTEM SHALL 说明基础检测与深度检测差异，并提供检测一段文字 / 检测当前章节 / 查看 12 特征入口。
8. WHEN 工作台模式未开启 THEN THE SYSTEM SHALL 说明其用于 Coding Agent、扫榜、批量资料整理、一致性审计和提示词 A/B 测试，并提供开启 / 查看能力 / 查看权限入口。
9. WHEN 空态涉及 AI 功能且模型未配置 THEN THE SYSTEM SHALL 显示模型需求提示，但仍保留本地可用动作。

### Requirement 10：作者模式与工作台模式

**User Story：** 作为普通作者，我希望默认界面专注写作；作为高级用户，我又希望需要时能开启 Coding Agent 工作台。

#### Acceptance Criteria

1. WHEN 用户处于默认作者模式 THEN THE SYSTEM SHALL 显示书籍列表、书籍总览、章节编辑、故事经纬、AI 写作、AI 味检测、写作预设、设置。
2. WHEN 用户处于默认作者模式 THEN THE SYSTEM SHALL 不把 Terminal、MCP、Browser、Git worktree、Agent 原始日志、Shell 权限作为一等入口展示。
3. WHEN 用户选择开启工作台模式 THEN THE SYSTEM SHALL 显示确认说明：工作台模式会暴露高级工具和更高 token 消耗，普通写作不需要开启。
4. WHEN 工作台模式开启 THEN THE SYSTEM SHALL 展示 Agent 控制台、工具调用记录、文件树、终端、MCP 工具、扫榜任务、批量资料任务、一致性审计任务、提示词 A/B 测试等入口。
5. WHEN 用户关闭工作台模式 THEN THE SYSTEM SHALL 返回作者模式，并隐藏高级工具入口。
6. WHEN 工作台模式状态改变 THEN THE SYSTEM SHALL 持久化到用户设置，而不是每次刷新丢失。

### Requirement 11：AI 上下文按当前经纬动态装配

**User Story：** 作为维护者，我希望 AI 写作、评点、审校和 Agent 不假设每本书都有同样的栏目，而是读取当前书启用的故事经纬结构。

#### Acceptance Criteria

1. WHEN AI 写作请求构建上下文 THEN THE SYSTEM SHALL 查询当前书启用的故事经纬栏目与条目。
2. WHEN 条目 `participatesInAi = false` 或所属栏目未启用 THEN THE SYSTEM SHALL 不把该条目注入 AI 上下文。
3. WHEN 条目可见性为 global THEN THE SYSTEM SHALL 在符合章节时间线时始终注入。
4. WHEN 条目可见性为 tracked THEN THE SYSTEM SHALL 仅在当前正文 / 场景文本命中标题、别名或关键词时注入。
5. WHEN 条目可见性为 nested THEN THE SYSTEM SHALL 在被已注入条目引用时连带注入，并限制递归深度防循环。
6. WHEN 当前章节号小于条目 `visible_after_chapter` THEN THE SYSTEM SHALL 不注入，防止剧透和未来认知污染。
7. WHEN 当前书有核心记忆栏目且已启用 THEN THE SYSTEM SHALL 优先把核心记忆纳入全局上下文预算。
8. WHEN 当前书没有某个高级栏目 THEN THE SYSTEM SHALL 不要求用户补齐，也不让 AI prompt 假装该栏目存在。

### Requirement 12：shadcn/ui 设计系统约束

**User Story：** 作为维护者，我希望新增 UI 跟现有 Studio 视觉体系一致，使用 shadcn/ui 组合，而不是引入新的组件风格。

#### Acceptance Criteria

1. WHEN 实现首次欢迎弹窗 THEN THE SYSTEM SHALL 使用 shadcn/ui Dialog + Card + Button + Badge 等组件组合。
2. WHEN 实现首页任务清单 THEN THE SYSTEM SHALL 使用 Card、Checkbox 或状态 Badge、Button、Progress / Separator 等组件组合。
3. WHEN 实现故事经纬栏目管理 THEN THE SYSTEM SHALL 使用 Tabs、Table、DropdownMenu、Dialog、Form、Input、Textarea、Select、Switch、Checkbox 等组件组合。
4. WHEN 实现空态说明 THEN THE SYSTEM SHALL 使用 Card / Alert / Button 组合，保证说明、动作和配置提示层次清晰。
5. WHEN 实现工作台模式说明 THEN THE SYSTEM SHALL 使用 Alert / Dialog / Sheet 展示风险提示和能力说明。
6. WHEN 新增组件 THEN THE SYSTEM SHALL 复用现有 Tailwind token、主题变量、圆角、间距和暗色模式，不新增独立 CSS 体系。
7. WHEN 设计交互组件 THEN THE SYSTEM SHALL 满足键盘可达、焦点可见、aria label 完整、深浅色主题可读。

### Requirement 13：测试与回归

**User Story：** 作为维护者，我希望首用流程、模型未配置降级、故事经纬可编辑和 shadcn/ui 页面状态都有回归测试，避免再次出现不配置就无法建书的问题。

#### Acceptance Criteria

1. WHEN 运行单元测试 THEN THE SYSTEM SHALL 覆盖模型未配置时的本地建书路径。
2. WHEN 运行集成测试 THEN THE SYSTEM SHALL 验证未配置 provider 时可以打开首页、关闭欢迎弹窗、创建本地书籍、进入书籍总览。
3. WHEN 运行集成测试 THEN THE SYSTEM SHALL 验证点击 AI 动作但未配置模型时出现配置提示且不清空用户输入。
4. WHEN 运行集成测试 THEN THE SYSTEM SHALL 验证基础经纬、增强经纬、自定义栏目创建和禁用行为。
5. WHEN 运行 E2E smoke THEN THE SYSTEM SHALL 覆盖首次欢迎弹窗、首页任务清单、新建书籍、故事经纬空态和模型配置入口。
6. WHEN 运行 typecheck THEN THE SYSTEM SHALL 无错误。
7. WHEN 运行 lint / format THEN THE SYSTEM SHALL 不引入新的样式或类型问题。

### Requirement 14：明确不做

**User Story：** 作为 PM，我希望本 spec 不把后续大功能偷渡进首用体验改造。

#### Acceptance Criteria

1. WHEN 定义本 spec 边界 THEN THE SYSTEM SHALL 明确不包含：
   - 自动完成 provider 凭据获取或第三方登录授权。
   - 完整模板市场实现。
   - 大型预制世界资产包。
   - 将所有 legacy `bible_*` 数据表立即破坏性重命名。
   - 关系图可视化。
   - 多人协作。
   - 自动重写已写章节。
   - 工作台模式内的完整 Coding Agent 实现。
2. WHEN 遇到模板市场、关系图、完整 Agent 工作台等需求 THEN THE SYSTEM SHALL defer 到后续独立 spec。
3. WHEN 本 spec 涉及《没钱修什么仙》 THEN THE SYSTEM SHALL 仅作为导入样例 / 高级范本处理，不把其结构设为默认。
