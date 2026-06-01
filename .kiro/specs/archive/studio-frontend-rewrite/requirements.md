# Studio Frontend Rewrite Requirements

## 背景

NovelFork Studio 旧前端经历多轮 UIUX、NarraFork 对齐、会话中心、工作台、预设与设置改造后，仍未形成稳定可用的创作体验。后续不再继续对旧前端做 UIUX patch，而是冻结旧前端，旁路重写新前端，待新前端可替代后再删除旧页面。

本次重写的关键边界：

- NarraFork 只作为 **设置页、套路页、管理型布局** 的参考。
- NarraFork 的叙事线、叙述者、章节节点图不作为 NovelFork 小说创作主流程参考。
- 小说创作主流程应参考小说写作软件：资源管理器、卷/章节树、已有章节、生成章节、草稿、主编辑器、资料库、对照视图。
- 套路页应直接学习 NarraFork 的 AI 专业功能集合；这些能力是固定的 AI 工作台基础设施，不应为了小说场景而改成另一套概念。
- NovelFork 需要新增一个专门为小说创作设计的页面，承载资源管理器、章节编辑、AI 生成稿与经纬资料。

## 术语

- **旧前端**：当前 `packages/studio/src` 下已存在的 Studio React 前端页面与壳层。
- **新前端**：本 spec 要求旁路建设的新 Studio 前端入口。
- **创作工作台**：专门为小说创作设计的新主页面。
- **套路页**：AI 工作台资源管理页，学习 NarraFork 的 Routines 页面。
- **设置页**：运行时、模型、个人资料、系统与外观配置页，学习 NarraFork 的 Settings 页面。
- **已有章节**：已纳入作品正文树、被用户视为正式资产的章节。
- **生成章节**：AI 生成的候选稿，必须先进入独立区域，不能直接覆盖已有章节。
- **草稿**：用户或 AI 产生但尚未定稿的章节/片段。
- **经纬/资料库**：人物、地点、势力、物品、伏笔、大纲、世界规则等结构化小说资料。

## 已确认参考事实

### NarraFork 设置页必须学习的具体功能

调研来源：`docs/03-代码参考/06-NarraFork-UIUX与交互功能调研.md` §7、§14，以及本轮截图反馈。

设置页学习 NarraFork 的重点不是“有哪些菜单”，而是完整的管理型设计哲学：

- 左侧固定分区导航，分为个人设置与实例管理，不把所有配置摊在一个页面。
- 右侧只显示当前分区的可操作详情，避免配置堆叠。
- 复杂分区先给总览，再给分组卡片，再进入单项详情。
- 单项详情必须提供明确动作：添加、编辑、保存、刷新、测试、禁用、删除。
- 系统级能力要展示状态和反馈：启用状态、可用数量、连接结果、错误信息、延迟、模型数量、资源使用。
- 表单必须短路径完成任务，例如“添加供应商”应简洁明了，不让用户理解底层工程结构后才能配置。
- 该哲学适用于所有设置分区，不只 AI 供应商。

- 个人资料：头像上传、Git 用户名、Git 邮箱。
- AI 供应商：左侧设置导航进入“提供商”，右侧先显示供应商总览，再按“平台集成 / API key 接入”分组展示卡片；支持添加供应商、启用/禁用、删除、保存、刷新模型列表。
- 供应商配置表单：名称、前缀、API Key、Base URL、ChatGPT 账户 ID、是否使用 Responses WebSocket；支持 OpenAI 兼容与 Anthropic 兼容两种主流自定义格式。
- API 模式：必须支持 `Completions`、`Responses`、`Codex` 三种模式。GPT-4 及更老模型、国产模型选择 Completions；GPT-4o 及更新模型选择 Responses；Codex 反代选择 Codex，并支持思考强度。
- 模型管理：保存供应商配置后可刷新可用模型；每个模型行必须能单独测试、设置上下文长度、禁用/启用；模型列表显示可用模型数量。
- 模型：默认模型、摘要模型、Explore / Plan 子代理模型偏好、各类型子代理模型池限制、全局默认推理强度、Codex 默认推理强度、模型列表入口。
- AI 代理：默认权限模式、每条消息最大轮次、旧编码支持、刷新 Shell 环境、翻译思考内容、Dump 每条 API 请求、默认展开推理内容、默认宽松规划、智能检查输出中断、可恢复错误最大重试次数、重试退避时间上限、自定义可重试错误规则、WebFetch 代理模式、上下文窗口阈值、会话行为、显示 token 用量、实时 AI 输出速率、全局目录/命令白名单黑名单。
- 关于：版本、commit、平台、作者、更新日志入口。

### NarraFork 套路页必须学习的具体功能

调研来源：`docs/03-代码参考/06-NarraFork-UIUX与交互功能调研.md` §8。

- 顶层分区必须是：命令、可选工具、工具权限、全局技能、项目技能、自定义子代理、全局提示词、系统提示词、MCP 工具、钩子。
- 命令：用户级斜杠命令、输入框 `/命令名` 说明、空态、添加命令。
- 可选工具：每个工具一行，展示名字、`/LOAD` 命令、说明、开关；已实测到 Terminal / ShareFile / Recall / Browser / ForkNarrator / NarraForkAdmin。
- 工具权限：统一查看内置工具和 MCP 工具权限分类，以及 Bash 白名单/黑名单规则。
- 技能：全局技能和项目技能分开；支持扫描路径说明、刷新、创建技能。
- 自定义子代理：定义专用提示词和工具权限；支持创建子代理。
- MCP 工具：导入 JSON、添加 MCP 服务器；每个服务器展示连接状态、传输方式、工具数量、断开、编辑。
- 钩子：生命周期节点运行 Shell / Webhook / LLM 提示词；支持创建钩子。

### 当前旧前端已有实现基线

- 设置页：`packages/studio/src/pages/SettingsView.tsx`，已有 profile / appearance / editor / shortcuts / notifications / monitoring / data / advanced / about 分区；`RuntimeControlPanel` 和 `ReleaseOverview` 已可复用。
- 旧高级设置弹窗：`packages/studio/src/components/Settings/Settings.tsx` 及 `Config.tsx`、`Status.tsx`、`Usage.tsx`。
- 套路页：`packages/studio/src/components/Routines/Routines.tsx`，已有 commands / tools / permissions / skills / subagents / prompts / mcp 七个前端 tab。
- 套路数据模型：`packages/studio/src/types/routines.ts`，已有 `Command`、`Tool`、`ToolPermission`、`Skill`、`SubAgent`、`Prompt`、`MCPTool`。
- 套路 API：`packages/studio/src/api/routes/routines.ts`，已有 global / project / merged / reset 读写接口。
- 写作工具 UI：`packages/studio/src/components/writing-tools/` 已有 `ChapterHookGenerator`、`DailyProgressTracker`、`DialogueAnalysis`、`PovDashboard`、`RhythmChart`。
- 合规 UI：`packages/studio/src/components/compliance/` 已有敏感词、AI 比例、AI 标注相关组件；`PublishReadiness.tsx` 已存在。
- 经纬/资料库：`packages/studio/src/pages/BibleView.tsx` 与 `packages/studio/src/api/routes/bible.ts` 已有人物、事件、设定、章节摘要、冲突、世界模型、核心命题、角色弧线、问卷等 API/页面基础。

### 当前活跃 spec 边界

- `narrafork-platform-upgrade`：任务 1-15 已完成，提供 Bun/SQLite 底座、会话恢复、AI 请求历史、Admin Requests/Resources、权限模式、高级工作台等基础能力；新前端应复用，不得重建。
- `writing-presets-v1`：定义 genre/tone/settingBase/logicRisk/bundle/beat/anti-ai/literary 与 PresetManager；新前端第一阶段不重写预设中心，只预留入口。
- `writing-tools-v1`：任务 1-12 已完成，任务 13-25 仍在推进；新创作工作台应承接这些写作工具组件与 API，不重复实现节奏、对话、钩子、POV、日更、健康仪表盘、矛盾、角色弧线、文风偏离。
- `platform-compliance-v1`：任务 1-12 已完成，任务 13 验证待执行；新前端应复用合规组件和 `PublishReadiness` 页面能力。
- `writing-modes-v1`：定义选段续写、场景扩写、对话生成、多版本、段落补写、大纲续写与分支、作品导入与文风分析；新创作工作台的 AI 面板应为这些模式预留交互位置。

## Requirements

### Requirement 1：冻结旧前端并建立旁路重写入口

**User Story:** 作为开发者，我希望旧 Studio 前端不再被持续 UIUX patch，以便重写工作不会继续受旧架构惯性影响。

#### Acceptance Criteria

1. WHEN 新前端开发开始 THEN 系统 SHALL 保留旧前端作为可回退基线。
2. WHEN 开发者修改旧前端 THEN 只允许修复构建失败、安全问题或阻塞级运行错误。
3. WHEN 新前端尚未达到替代标准 THEN 系统 SHALL NOT 物理删除旧前端页面。
4. WHEN 新前端启动 THEN 它 SHALL 使用独立入口或隔离路由，不依赖旧 `App.tsx` 的复杂页面组织。
5. WHEN 新前端完成替代验收 THEN 开发者 MAY 计划删除旧页面。

### Requirement 2：新前端必须以小说创作工作台为第一主页面

**User Story:** 作为网文作者，我希望进入 Studio 后首先看到作品资源、章节、正文与 AI 写作工具，而不是会话中心或配置堆叠页面。

#### Acceptance Criteria

1. WHEN 用户打开新前端 THEN 系统 SHALL 默认进入创作工作台或作品选择后的创作工作台。
2. WHEN 创作工作台加载作品 THEN 左侧 SHALL 显示小说资源管理器。
3. WHEN 用户查看资源管理器 THEN 系统 SHALL 区分已有章节、生成章节和草稿。
4. WHEN 用户点击已有章节 THEN 中央主区域 SHALL 打开正文编辑器。
5. WHEN 用户点击生成章节 THEN 中央主区域 SHALL 以候选稿/草稿身份打开，不得自动覆盖正式章节。
6. WHEN 用户需要 AI 辅助 THEN 右侧 SHALL 提供生成、续写、审校、改写、去 AI 味、连续性检查等小说创作动作。
7. WHEN 用户需要查看资料 THEN 右侧或辅助面板 SHALL 显示与当前章节相关的人物、地点、伏笔、大纲、前文摘要等经纬信息。

### Requirement 3：创作工作台必须提供小说资源管理器

**User Story:** 作为作者，我希望像使用小说写作软件一样管理书、卷、章节、草稿和资料，方便查看生成章节与已有章节。

#### Acceptance Criteria

1. WHEN 用户查看资源管理器 THEN 系统 SHALL 至少支持作品、卷、已有章节、生成章节、草稿、大纲、经纬/资料库分组。
2. WHEN 用户展开作品 THEN 系统 SHALL 显示卷与章节层级。
3. WHEN 用户查看生成章节分组 THEN 系统 SHALL 显示 AI 候选稿并标记其来源、目标章节和生成时间。
4. WHEN 用户查看草稿箱 THEN 系统 SHALL 显示未定稿片段或章节。
5. WHEN 用户查看经纬/资料库 THEN 系统 SHALL 显示人物、地点、势力、物品、伏笔、世界规则等分类入口。
6. WHEN 用户选择章节或资料条目 THEN 中央区域 SHALL 根据对象类型打开编辑器、预览或详情。
7. WHEN 系统没有对应数据 THEN 页面 SHALL 显示可执行空态 CTA，而不是仅显示“暂无”。

### Requirement 4：创作工作台必须以正文编辑器为中心

**User Story:** 作为作者，我希望正文编辑器是主视图，AI 和资料库围绕正文服务，而不是抢占主对象位置。

#### Acceptance Criteria

1. WHEN 用户打开已有章节 THEN 中央主区域 SHALL 显示正文编辑器。
2. WHEN 正文编辑器打开 THEN 系统 SHALL 显示章节标题、章节状态、字数、保存状态。
3. WHEN 用户编辑正文 THEN 系统 SHALL 支持稳定保存或明确提示未保存状态。
4. WHEN 用户需要核对内容 THEN 系统 SHALL 支持至少一种对照视图：大纲 vs 正文、前文 vs 当前章、生成稿 vs 已有稿、原文 vs 修订稿。
5. WHEN 用户确认生成稿可用 THEN 系统 SHALL 提供合并/替换/另存为草稿的明确动作。
6. WHEN 用户未确认生成稿 THEN 系统 SHALL NOT 自动写入正式章节。

### Requirement 5：AI 创作能力必须服务章节与资料库

**User Story:** 作为作者，我希望 AI 生成、审校和抽取都围绕当前章节与经纬资料工作，而不是变成独立聊天。

#### Acceptance Criteria

1. WHEN 用户在章节上下文中点击生成下一章 THEN 系统 SHALL 使用当前作品、前文摘要、大纲、经纬资料与目标章节信息作为输入。
2. WHEN AI 返回正文 THEN 系统 SHALL 将结果保存为生成章节或草稿候选。
3. WHEN 用户点击审校 THEN 系统 SHALL 针对当前章节输出问题、建议和可应用修改。
4. WHEN 用户点击去 AI 味 THEN 系统 SHALL 生成候选修订，不得直接覆盖正文。
5. WHEN 用户点击连续性检查 THEN 系统 SHALL 对照经纬资料、前文、人物设定、地点与伏笔输出冲突信息。
6. WHEN AI 输出包含新人物、地点、伏笔或设定 THEN 系统 SHOULD 提供抽取到经纬/资料库的动作。
7. WHEN AI 正在运行 THEN 系统 SHALL 显示运行态、错误态和可恢复信息。

### Requirement 6：套路页必须直接学习 NarraFork 的 AI 专业功能集合

**User Story:** 作为高级用户，我希望在套路页管理 AI 工作流基础设施，而不是被小说化文案打散固定能力。

#### Acceptance Criteria

1. WHEN 用户打开套路页 THEN 系统 SHALL 提供与 NarraFork Routines 同类的顶层能力分区。
2. THE 套路页 SHALL 包含：命令、可选工具、工具权限、全局技能、项目技能、自定义子代理、全局提示词、系统提示词、MCP 工具、钩子。
3. WHEN 用户查看命令 THEN 系统 SHALL 支持查看、添加、编辑和删除命令。
4. WHEN 用户查看可选工具 THEN 系统 SHALL 显示工具名称、说明、加载/启用状态。
5. WHEN 用户查看工具权限 THEN 系统 SHALL 管理内置工具和 MCP 工具权限分类。
6. WHEN 用户查看技能 THEN 系统 SHALL 区分全局技能与项目技能。
7. WHEN 用户查看子代理 THEN 系统 SHALL 支持自定义子代理类型、提示词和工具权限。
8. WHEN 用户查看提示词 THEN 系统 SHALL 区分全局提示词与系统提示词。
9. WHEN 用户查看 MCP 工具 THEN 系统 SHALL 支持添加、导入 JSON、编辑、连接状态展示和工具数量展示。
10. WHEN 用户查看钩子 THEN 系统 SHALL 支持生命周期钩子管理。
11. THE 套路页 SHALL NOT 将这些 AI 专业功能改名为仅适合小说场景的临时概念。

### Requirement 7：设置页必须学习 NarraFork 的管理型设置布局

**User Story:** 作为用户，我希望设置页稳定、清晰地管理个人资料、模型、AI 代理、外观、系统与运行时配置。

#### Acceptance Criteria

1. WHEN 用户打开设置页 THEN 系统 SHALL 显示清晰的分组导航。
2. THE 设置页 SHALL 至少包含：个人资料、模型、AI 代理、通知、外观与界面、服务器与系统、存储空间、运行资源、使用历史、关于。
3. WHEN 用户查看模型设置 THEN 系统 SHALL 支持默认模型、摘要模型、子代理模型偏好、推理强度等配置展示或编辑。
4. WHEN 用户查看 AI 代理设置 THEN 系统 SHALL 支持权限模式、重试/恢复、上下文阈值、调试开关等运行时配置展示或编辑。
5. WHEN 用户查看关于页面 THEN 系统 SHALL 显示版本、commit、平台、作者和更新入口。
6. WHEN 设置项尚未接入后端 THEN 系统 SHALL 显示明确“未接入”状态和后续动作，而不是伪造可用配置。

### Requirement 8：新前端视觉与布局必须以功能闭环验收

**User Story:** 作为产品使用者，我希望页面看起来简洁专业，但更重要的是每个页面能完成真实任务。

#### Acceptance Criteria

1. WHEN 页面完成 THEN 它 SHALL 有至少一条可点击完成的用户路径。
2. WHEN 页面仅展示卡片、说明、Badge 或空列表且无法完成任务 THEN 该页面 SHALL NOT 被标记为完成。
3. WHEN 开发者提交新页面 THEN 提交说明 SHALL 包含用户路径验收，而不仅是构建通过。
4. WHEN UI 使用弹窗 THEN 背景文字 SHALL NOT 与弹窗内容视觉重叠。
5. WHEN 页面存在空状态 THEN 空状态 SHALL 提供下一步 CTA。
6. WHEN 页面使用 shadcn 组件 THEN 组件 SHALL 形成统一视觉语言，而不是混用大量手写样式。

### Requirement 9：重写过程必须按垂直切片推进

**User Story:** 作为开发者，我希望每一阶段都能产生可验收功能，避免再次进入大而全失败循环。

#### Acceptance Criteria

1. WHEN 开始实现 THEN 第一阶段 SHALL 只包含创作工作台、设置页、套路页的新前端最小闭环。
2. WHEN 创作工作台未完成 THEN 团队 SHALL NOT 开始预设中心、发布系统或复杂数据看板重写。
3. WHEN 设置页和套路页实现 THEN 它们 SHALL 先达到 NarraFork 对标功能分区，不要求一次完成所有后端配置写入。
4. WHEN 第一阶段完成 THEN 系统 SHALL 能通过浏览器实测三条路径：打开章节编辑、打开设置项、打开套路功能分区。
5. WHEN 第一阶段验收失败 THEN 不得继续扩展第二阶段页面。

### Requirement 10：新前端必须复用旧前端已实现能力

**User Story:** 作为维护者，我希望新前端不要重复实现旧前端已经可用的 API、类型和组件，避免把重写变成第二套不兼容系统。

#### Acceptance Criteria

1. WHEN 新前端需要套路数据 THEN 系统 SHALL 优先复用 `types/routines.ts` 和 `/api/routines/*`。
2. WHEN 新前端实现命令、工具、权限、技能、子代理、提示词、MCP 页面 THEN 它 SHALL 先评估复用或迁移 `components/Routines/*Tab.tsx`，不得无理由新建第二套数据模型。
3. WHEN 新前端需要设置/运行时信息 THEN 它 SHALL 优先复用 `RuntimeControlPanel`、`ReleaseOverview`、旧高级设置弹窗中已接入的真实配置。
4. WHEN 新前端需要写作工具 THEN 它 SHALL 优先复用 `components/writing-tools/`、`api/routes/writing-tools.ts` 和 `writing-tools-v1` 已完成任务。
5. WHEN 新前端需要经纬/资料库 THEN 它 SHALL 优先复用 `BibleView`、`api/routes/bible.ts` 和核心 Bible repositories。
6. WHEN 新前端需要发布/合规能力 THEN 它 SHALL 优先复用 `PublishReadiness`、`components/compliance/` 和 `api/routes/compliance.ts`。
7. WHEN 旧实现功能不满足新 UI THEN spec 或任务 SHALL 明确写出“迁移/包裹/替换”的理由。

### Requirement 11：套路页必须补齐 NarraFork 细节而不重复造轮子

**User Story:** 作为高级用户，我希望新套路页比旧 Routines 更接近 NarraFork 的完整能力，同时复用旧代码中的读写、scope 和表单逻辑。

#### Acceptance Criteria

1. WHEN 新套路页实现 THEN 它 SHALL 保留 global / project / merged 三种 scope 口径。
2. WHEN 新套路页实现 THEN 它 SHALL 将旧的合并 tab 拆到 NarraFork 对应分区：全局技能、项目技能、全局提示词、系统提示词。
3. WHEN 新套路页实现 THEN 它 SHALL 新增旧 Routines 缺失的钩子分区。
4. WHEN 新套路页实现 MCP 工具 THEN 它 SHALL 从“工具列表审批”升级为“服务器级管理”：导入 JSON、添加服务器、连接状态、传输方式、工具数量、断开、编辑。
5. WHEN 新套路页实现可选工具 THEN 它 SHALL 显示 `/LOAD` 命令或等价加载入口，而不仅是开关。
6. WHEN 新套路页实现工具权限 THEN 它 SHALL 覆盖内置工具、MCP 工具、Bash allowlist/blocklist 和默认 ask/allow/deny 规则来源。
7. WHEN 旧 Routines 组件只能满足部分能力 THEN 新前端 SHALL 迁移其表单逻辑和 API 调用，但重写页面布局。

### Requirement 12：设置页必须补齐 NarraFork 细节并映射到现有配置源

**User Story:** 作为用户，我希望设置页不是空导航，而是真正能查看和调整模型、AI 代理、运行时、存储和使用历史。

#### Acceptance Criteria

1. WHEN 新设置页实现个人资料 THEN 它 SHALL 支持头像、Git 用户名、Git 邮箱；若头像上传暂未接入，必须显示未接入状态。
2. WHEN 新设置页实现模型 THEN 它 SHALL 显示默认模型、摘要模型、Explore / Plan 子代理模型偏好、模型池限制、全局推理强度、Codex 推理强度和模型列表入口。
3. WHEN 新设置页实现 AI 代理 THEN 它 SHALL 显示默认权限模式、最大轮次、恢复/重试、退避、自定义可重试错误、上下文阈值、WebFetch 代理、调试项、token/输出速率、白名单/黑名单。
4. WHEN 新设置页实现服务器与系统 THEN 它 SHALL 复用 `narrafork-platform-upgrade` 已完成的启动诊断、资源扫描、自愈动作和运行时信息。
5. WHEN 新设置页实现使用历史 THEN 它 SHALL 复用 Admin Requests / AI request observability，而不是新建日志统计。
6. WHEN 设置项已经有旧前端或后端实现 THEN 新前端 SHALL 引用其路径并复用；未实现项 SHALL 明确标记未接入。

### Requirement 13：设置页所有分区都必须遵循 NarraFork 管理型设计哲学

**User Story:** 作为用户，我希望设置页的每个分区都像 NarraFork 一样全面、好用、便捷，而不是只有模型供应商页面做得细。

#### Acceptance Criteria

1. WHEN 用户打开设置页 THEN 左侧 SHALL 固定显示分区导航，右侧 SHALL 只显示当前分区详情。
2. WHEN 设置分区包含复杂资源 THEN 该分区 SHALL 先显示摘要指标，再显示资源卡片或列表，再允许进入单项详情。
3. WHEN 设置分区包含可配置对象 THEN 每个对象 SHALL 提供清晰的启用/禁用、编辑、保存、删除或测试动作。
4. WHEN 设置分区涉及连接或运行状态 THEN 页面 SHALL 显示状态、错误、延迟、数量、刷新动作或最近更新时间。
5. WHEN 设置分区有新增流程 THEN 添加入口 SHALL 使用短表单或分步表单，避免把所有高级字段一次性暴露。
6. WHEN 设置分区尚未接入后端 THEN 页面 SHALL 明确显示未接入，且不得伪造保存成功。
7. WHEN 设计设置分区 THEN 团队 SHALL 以 AI 供应商页的模式作为范式：总览 → 分组卡片 → 单项详情 → 保存/刷新/测试/禁用。
8. THE 设置页 SHALL NOT 回到“把所有配置项铺在一个大页面”的旧模式。
