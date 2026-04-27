# Implementation Plan

## Overview

本计划从已确认的 `studio-frontend-rewrite` requirements/design 生成。目标不是继续修旧前端，也不是重造所有功能，而是在冻结旧前端 UIUX patch 的前提下，旁路建设新前端第一阶段三条闭环：

1. **创作工作台**：小说专用资源管理器 + 正文编辑 + 生成章节/草稿 + AI/经纬面板。
2. **设置页**：学习 NarraFork 的管理型设置哲学，尤其是 AI 供应商页范式，并将同一范式应用到所有设置分区。
3. **套路页**：直接学习 NarraFork 的固定 AI 专业功能集合，同时复用旧 Routines API、类型和表单逻辑。

执行原则：先复用，再重写；先垂直切片，再扩展；旧前端保留回退，不做新的 UIUX patch。

## Tasks

- [x] 1. 建立前端重写边界与旧前端冻结说明
  - 在 spec 或项目开发说明中明确：旧 `packages/studio/src` 页面只允许构建/安全/阻塞级 bug 修复，不继续做 UIUX patch。
  - 记录新前端入口、旧前端回退策略、旧页面删除条件。
  - 验收：开发文档中能看到“冻结旧前端 → 旁路重写 → 验收替换 → 删除旧页面”的执行顺序。
  - 覆盖 Requirements 1、9、10。

- [x] 2. 创建新前端隔离入口骨架
  - 在 `packages/studio/src/app-next/` 下创建新前端入口、路由和顶层 shell。
  - 新入口只复用 API client、基础 shadcn/ui、主题 token，不引用旧 `App.tsx` 的页面组织。
  - 提供临时开发入口，例如 `/next` 或可切换的 dev route。
  - 验收：浏览器能打开新入口，显示空的 Studio Next shell，旧前端仍可访问。
  - 覆盖 Requirements 1、8、9。

- [x] 3. 实现新前端通用布局基元
  - 新增或迁移 `NextShell`、`SectionLayout`、`SettingsLayout`、`ResourceWorkspaceLayout`。
  - `SettingsLayout` 必须支持左侧固定分区导航、右侧当前分区详情。
  - `ResourceWorkspaceLayout` 必须支持左侧资源管理器、中间主编辑器、右侧 AI/经纬面板。
  - 统一 Dialog/Overlay 层级，避免弹窗与背景文字重叠。
  - 验收：布局 story/test 覆盖三个区域、滚动边界、弹窗层级。
  - 覆盖 Requirements 2、3、4、8、13。

- [x] 4. 梳理并固化可复用旧代码清单
  - 建立实现前检查表，逐项引用已有代码：`SettingsView`、`RuntimeControlPanel`、`ReleaseOverview`、`Routines`、`types/routines.ts`、`api/routes/routines.ts`、`components/writing-tools/*`、`components/compliance/*`、`BibleView`、`api/routes/bible.ts`、`BookDetail`、`ChapterReader`。
  - 对每一项标记：直接复用、迁移包裹、重写布局但复用逻辑、暂不接入。
  - 明确吸收仍在进行的前端任务边界：`writing-modes-v1` Tasks 12-16、`writing-tools-v1` Tasks 21-24、`platform-compliance-v1` 已完成组件。
  - 验收：`tasks.md` 执行前有明确复用矩阵，后续任务不得无理由新建第二套模型。
  - 覆盖 Requirement 10。

- [x] 5. 扩展 Provider 数据模型以支持 NarraFork AI 供应商范式
  - 在现有 `shared/provider-catalog.ts`、`api/lib/provider-manager.ts`、`api/routes/providers.ts` 基础上扩展，而不是新建 provider 系统。
  - 增加供应商字段：`prefix`、`compatibility`（OpenAI compatible / Anthropic compatible）、`apiMode`（Completions / Responses / Codex）、`baseUrl`、`accountId`、`useResponsesWebSocket`、`thinkingStrength`。
  - 明确内部映射：UI 的 `Completions` 对应现有 Chat Completions / `apiFormat: chat`；`Responses` 对应 `apiFormat: responses`；`Codex` 走 Codex 反代模式并暴露思考强度。
  - 增加模型级字段：enabled、contextWindow、lastTestStatus、lastTestLatency、lastTestError、lastRefreshedAt。
  - 添加 provider model 单测，验证旧 provider 数据可兼容迁移。
  - 覆盖 Requirements 7、10、12、13。

- [x] 6. 实现 Provider API 的保存、刷新模型、单模型测试与模型开关
  - 扩展 `/api/providers/:id` 保存供应商详情。
  - 新增或扩展刷新模型接口，按 OpenAI-compatible / Anthropic-compatible / Codex 模式拉取模型列表。
  - 新增单模型测试接口，测试结果写回模型级状态。
  - 新增模型启用/禁用与上下文长度更新接口。
  - 保留现有 `/api/providers`、`/api/providers/models`、`/api/providers/:id/test` 的兼容路径。
  - 验收：API 测试覆盖新增供应商、保存、刷新模型、测试模型、设置上下文长度、禁用模型。
  - 覆盖 Requirements 7、10、12、13。

- [x] 7. 实现设置页壳层与统一交互模式
  - 在新前端实现 Settings page，左侧分组为个人设置与实例管理。
  - 右侧所有分区统一遵循：总览指标 → 资源卡片/列表 → 单项详情 → 保存/刷新/测试/禁用/删除。
  - 未接入后端的设置项显示“未接入/只读”，不得伪造保存成功。
  - 验收：设置页所有分区切换只更新右侧详情，不出现所有配置铺满一页。
  - 覆盖 Requirements 7、12、13。

- [x] 8. 实现 AI 供应商设置页
  - 复用 `providerManager`、`createProvidersRouter` 和 provider catalog，不新建第二套 provider store。
  - 页面包含供应商总览：供应商总数、已启用、可用模型数。
  - 按“平台集成 / API key 接入”分组展示供应商卡片。
  - 添加供应商使用短表单：供应商名称、前缀、API Key、Base URL、API 模式、兼容格式。
  - 详情页支持 ChatGPT 账户 ID、Responses WebSocket、Codex 思考强度等高级字段。
  - 保存后可刷新模型列表；每个模型行支持单独测试、设置上下文长度、禁用/启用。
  - 验收：完成“添加供应商 → 保存 → 刷新模型 → 测试模型 → 设置上下文长度 → 禁用模型”路径。
  - 覆盖 Requirements 7、8、12、13。

- [x] 9. 迁移设置页其他分区
  - 个人资料：复用/迁移 `ProfilePanel`，支持 Git 用户名、Git 邮箱，头像上传未接入时明确标注。
  - 模型：展示默认模型、摘要模型、Explore/Plan 子代理模型偏好、模型池限制、全局/Codex 推理强度。
  - AI 代理：迁移 `RuntimeControlPanel` 的权限、恢复、上下文、调试配置。
  - 外观与界面：迁移 `AppearancePanel`。
  - 服务器与系统、存储空间、运行资源：复用 Admin Resources / startup diagnostics。
  - 使用历史：复用 Admin Requests / AI request observability。
  - 关于：复用 `ReleaseOverview`。
  - 验收：每个分区至少有总览/状态/可操作项之一，未接入项明确标注。
  - 覆盖 Requirements 7、10、12、13。

- [x] 10. 建立套路页新布局并复用 Routines 读写链
  - 新套路页使用 NarraFork 固定 10 分区：命令、可选工具、工具权限、全局技能、项目技能、自定义子代理、全局提示词、系统提示词、MCP 工具、钩子。
  - 复用 `types/routines.ts`、`api/routes/routines.ts`、`use-routines-editor` 的 global / project / merged scope。
  - 保留保存、重置、scope 切换和只读 merged 视图。
  - 验收：global/project/merged 三种 scope 可切换，merged 只读，保存写回原 API。
  - 覆盖 Requirements 6、10、11。

- [x] 11. 迁移并拆分旧 Routines tabs
  - `CommandsTab` 迁移为命令分区，保留增删改、启用、prompt 表单。
  - `SkillsTab` 拆为全局技能与项目技能两个分区。
  - `PromptsTab` 拆为全局提示词与系统提示词两个分区。
  - `SubAgentsTab` 补工具权限字段和创建入口。
  - `ToolsTab` 扩展工具 catalog，显示 `/LOAD` 命令或等价加载入口。
  - `PermissionsTab` 补规则来源、Bash allowlist/blocklist、MCP 工具权限分类。
  - 验收：旧 Routines 的核心表单逻辑仍可用，但页面分区与 NarraFork 对齐。
  - 覆盖 Requirements 6、10、11。

- [x] 12. 实现 MCP 工具服务器级管理与钩子分区
  - MCP 分区从旧 `MCPToolsTab` 的工具审批升级为服务器级管理。
  - 支持导入 JSON、添加 MCP 服务器、查看连接状态、传输方式、工具数量、断开、编辑。
  - 复用现有 MCP 管理/registry 能力；若旧能力只存在于 Workbench/MCP 页面，迁移逻辑但重写布局。
  - 新增钩子分区，展示生命周期节点、Shell/Webhook/LLM 类型、创建入口。
  - 验收：套路页可完成“导入 MCP JSON / 添加服务器入口 / 查看工具数量 / 打开钩子创建入口”。
  - 覆盖 Requirements 6、10、11。

- [x] 13. 建立创作工作台资源适配层
  - 从现有书籍/章节 API、`BookDetail`、`ChapterReader`、Bible API 中抽象资源节点适配器。
  - 生成 `StudioResourceNode`：作品、卷、已有章节、生成章节、草稿、大纲、经纬/资料库分组。
  - 资源树必须区分已有章节、生成章节和草稿。
  - 空数据时提供 CTA：创建章节、生成下一章、创建经纬条目、导入章节。
  - 验收：给定一本已有书，资源树能显示章节；无章节时显示可执行空态。
  - 覆盖 Requirements 2、3、10。

- [x] 14. 实现生成章节/草稿候选存储
  - 在不破坏正式章节树的前提下，设计并实现生成章节候选存储。
  - 候选稿字段包含 bookId、targetChapterId、title、content、source、createdAt、status。
  - 提供读取、创建、接受、拒绝、归档接口。
  - 接受候选稿时必须提供合并/替换/另存草稿动作，不得自动覆盖正式正文。
  - 验收：AI 生成内容进入候选区，用户确认前正式章节文件/API 不变。
  - 覆盖 Requirements 2、3、4、5。

- [x] 15. 实现创作工作台主页面骨架
  - 使用 `ResourceWorkspaceLayout` 实现左侧资源管理器、中间编辑器、右侧 AI/经纬面板。
  - 顶栏提供作品选择、搜索、当前运行状态、设置入口、套路入口。
  - 点击资源节点后，中间区域根据类型打开章节编辑、候选稿、草稿或经纬详情。
  - 验收：打开新前端 → 进入一本书 → 点击已有章节 → 中央显示正文编辑器。
  - 覆盖 Requirements 2、3、4、8。

- [x] 16. 迁移章节编辑与保存能力
  - 从 `ChapterReader` / `BookDetail` 迁移真实章节打开、编辑、保存、状态和字数显示逻辑。
  - 编辑器显示章节标题、章节状态、字数、保存状态。
  - 支持未保存提示和保存失败反馈。
  - 验收：修改已有章节内容后保存，重新打开仍能读取；保存失败时显示错误。
  - 覆盖 Requirements 4、8、10。

- [x] 17. 实现候选稿对照与合并路径
  - 中央编辑区支持至少一种对照视图：优先实现“生成稿 vs 已有章节”。
  - 候选稿提供合并、替换、另存为草稿、放弃动作。
  - 合并/替换前必须提示目标章节和影响范围。
  - 验收：生成稿可打开、可对照、可另存草稿、可合并到已有章节。
  - 覆盖 Requirements 4、5、8。

- [x] 18. 实现 AI/经纬右侧面板第一批动作
  - AI 动作优先接入：生成下一章、续写当前段落、审校当前章、改写选中段落、去 AI 味、连续性检查。
  - 复用现有 AI gate、写作工具、writing-modes-v1 已定义上下文输入，不伪造未接入能力。
  - AI 输出统一进入生成章节/草稿候选。
  - 运行中显示状态，失败显示错误和可恢复动作。
  - 验收：点击“生成下一章”后，结果进入生成章节候选；模型缺失时进入 AI gate。
  - 覆盖 Requirements 5、8、9、10。

- [x] 19. 复用 Bible/经纬资料作为工作台资料面板
  - 右侧经纬面板从 `api/routes/bible.ts` 和 Bible repositories 读取人物、地点、伏笔、大纲、前文摘要等信息。
  - 当前章节相关资料优先展示；无关联时提供创建/关联 CTA。
  - AI 输出包含新人物、地点、伏笔或设定时，提供“抽取到经纬”入口；未实现自动抽取时显示未接入。
  - 验收：打开章节时右侧能显示对应经纬资料或创建入口。
  - 覆盖 Requirements 3、5、10。

- [ ] 20. 接入已实现写作工具组件
  - 在创作工作台中承接 `ChapterHookGenerator`、`DailyProgressTracker`、`DialogueAnalysis`、`PovDashboard`、`RhythmChart`。
  - 不重复实现节奏分析、对话分析、POV、日更、钩子生成算法。
  - 将工具入口放入当前章节上下文或工作台状态区。
  - 验收：至少能在新工作台打开节奏分析、对话分析、钩子生成中的两个已实现组件。
  - 覆盖 Requirements 5、8、10。

- [ ] 21. 接入发布/合规与预设入口但不重写完整页面
  - 创作工作台提供发布就绪入口，复用 `PublishReadiness` 和 `components/compliance/*`。
  - 提供预设入口或当前启用预设摘要，但不在第一阶段重写 `PresetManager`。
  - 明确未接入或外部页面跳转状态。
  - 验收：用户能从创作工作台进入现有发布就绪页面；预设入口不造成第二套预设 UI。
  - 覆盖 Requirements 9、10。

- [ ] 22. 统一空态、错误态、运行态和反馈组件
  - 为创作工作台、设置页、套路页建立统一 `EmptyState`、`InlineError`、`RunStatus`、`SaveStatus`、`ConnectionFeedback`。
  - 空态必须有 CTA；错误态必须有错误原因；运行态必须有当前动作名称。
  - 验收：三个主页面无“暂无”裸文本空态。
  - 覆盖 Requirement 8。

- [ ] 23. 添加新前端路由与导航测试
  - 为新入口、创作工作台、设置页、套路页添加路由测试。
  - 确认旧前端路由不被破坏。
  - 确认设置页分区切换、套路页分区切换、工作台资源点击均可测试。
  - 覆盖 Requirements 1、2、6、7、8、9。

- [ ] 24. 添加 Provider 设置页集成测试
  - 测试供应商总览指标。
  - 测试添加供应商表单：OpenAI compatible、Anthropic compatible、Completions、Responses、Codex。
  - 测试保存、刷新模型、单模型测试、上下文长度更新、禁用模型。
  - 测试未接入/失败状态显示。
  - 覆盖 Requirements 7、12、13。

- [ ] 25. 添加套路页集成测试
  - 测试 global/project/merged scope。
  - 测试 10 个固定分区存在。
  - 测试命令增删改复用旧 API。
  - 测试技能/提示词拆分为全局与项目/系统。
  - 测试 MCP 服务器级管理入口与钩子入口。
  - 覆盖 Requirements 6、10、11。

- [ ] 26. 添加创作工作台集成测试
  - 测试资源管理器显示已有章节、生成章节、草稿、经纬分组。
  - 测试打开已有章节、编辑、保存、字数/保存状态。
  - 测试 AI 生成进入候选稿，不自动覆盖正式章节。
  - 测试候选稿合并/另存/放弃。
  - 测试右侧经纬面板读取 Bible API。
  - 覆盖 Requirements 2、3、4、5、8、10。

- [ ] 27. 执行第一阶段浏览器验收
  - 路径 1：打开新前端 → 进入创作工作台 → 点击已有章节 → 编辑正文 → 生成下一章 → 结果进入候选稿 → 合并/另存/放弃。
  - 路径 2：打开设置 → AI 供应商 → 添加供应商 → 保存 → 刷新模型 → 单模型测试 → 设置上下文长度 → 禁用模型。
  - 路径 3：打开套路 → 查看 10 分区 → 添加命令 → 查看 MCP 服务器入口 → 查看钩子入口。
  - 记录失败项，不得把未接入能力标记为完成。
  - 覆盖 Requirements 8、9、13。

- [ ] 28. 执行自动化验证
  - 运行相关 unit/integration tests。
  - 运行 studio typecheck。
  - 若新前端引入新入口或构建配置，运行对应 build/dev smoke。
  - 记录未运行项和失败项。
  - 覆盖 Requirements 1、8、9、10。

## Done Definition

第一阶段完成必须同时满足：

- 旧前端仍可作为回退访问，且未继续进行 UIUX patch。
- 新前端入口可访问，包含创作工作台、设置页、套路页。
- 设置页所有分区遵循 NarraFork 管理型设计哲学，AI 供应商页完成添加、保存、刷新模型、单模型测试、上下文长度、禁用模型路径。
- 套路页包含 10 个 NarraFork 固定分区，并复用旧 Routines API/类型/scope。
- 创作工作台能查看已有章节、生成章节、草稿、经纬资料，AI 输出不会直接覆盖正式正文。
- 已实现写作工具、合规、经纬、请求历史、运行资源等旧能力被复用或明确标记未接入，没有重复造第二套系统。
- 三条浏览器验收路径通过，相关测试和 typecheck 通过或明确记录阻塞原因。
