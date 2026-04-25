# Implementation Plan

## Overview

本任务文件从已批准的 Kiro spec `onboarding-and-story-jingwei` 生成，目标是在不漂移出 requirements/design 的前提下，完成 NovelFork 首用引导、模型配置优雅降级、本地建书兜底、用户侧 Bible → 故事经纬命名迁移、可编辑经纬栏目、功能页教学空态、作者模式 / 工作台模式边界，以及基于 shadcn/ui 的一致 UI 实现。

关键执行原则：

- 配置 AI 模型是新手引导第一步，但未配置模型不得阻断启动、浏览、建书、经纬维护和章节编辑。
- 故事经纬是可编辑结构，不把《没钱修什么仙》或固定 10 维度当默认标准。
- UI 使用 shadcn/ui + Tailwind 组合，复用现有 Studio 设计 token，不引入新 UI 框架。
- 旧 `bible_*` 内部命名可以兼容保留；用户可见层统一为故事经纬 / 经纬。

## Tasks

- [ ] 1. 建立首用体验与经纬任务的回归测试基线
  - 新增或扩展测试 fixture：未配置 provider / model 的 Studio 状态。
  - 增加测试用例描述：未配置模型时可打开首页、关闭欢迎弹窗、创建本地书籍、进入书籍总览。
  - 增加测试用例描述：点击 AI 动作但未配置模型时弹出配置提示且不清空当前输入。
  - 覆盖 Requirements 1、2、3、4、13。

- [x] 2. 实现 provider 状态读取与 AI 动作 gate
  - 在现有 provider / settings 能力上提供统一状态读取：是否有可用模型、默认 provider/model、最近连接错误。
  - 新增 `requireModelForAiAction()` 或等价 gate，返回 `ok | model-not-configured`。
  - 将 gate 设计为只拦截 AI 续写、改写、评点、AI 生成经纬、深度 AI 味检测、工作台 Agent，不拦截本地功能。
  - 为 gate 添加单测：已配置、未配置、连接失败三类。
  - 覆盖 Requirements 3、11、13。

- [x] 3. 持久化新手引导与首页任务状态
  - 设计并实现 onboarding 状态存储，包含首次弹窗 dismissed、任务清单 dismissed、各任务完成状态。
  - 提供 `GET /api/onboarding/status` 与 `PATCH /api/onboarding/status`，或接入现有用户设置 API 达到同等效果。
  - 任务状态至少包含：modelConfigured、hasAnyBook、hasOpenedJingwei、hasAnyChapter、hasTriedAiWriting、hasTriedAiTasteScan、hasReadWorkbenchIntro。
  - 添加 API / repository 测试。
  - 覆盖 Requirements 1、2。

- [x] 4. 实现首次欢迎弹窗 `FirstRunDialog`
  - 在 `packages/studio/src/components/onboarding/` 下新增 `FirstRunDialog.tsx` 和必要 provider/hook。
  - 使用 shadcn/ui `Dialog`、`Card`、`Button`、`Badge` 实现三个入口卡片：配置 AI 模型、创建第一本书、了解工作台模式。
  - 文案明确：建议第一步配置模型；未配置也能创建本地书籍、整理故事经纬、编辑章节。
  - 实现关闭 / 暂时跳过后持久化 dismissed；提供从帮助 / 新手引导重新打开的入口预留。
  - 验证键盘可达、Escape 可关闭、焦点回收正确。
  - 覆盖 Requirements 1、12、13。

- [x] 5. 实现首页 `GettingStartedChecklist`
  - 在首页 / 书籍列表页添加 `开始使用 NovelFork` 任务清单组件。
  - 任务顺序固定为：配置 AI 模型、创建第一本书、认识故事经纬、创建第一章 / 导入正文、试用 AI 写作与评点、试用 AI 味检测、了解工作台模式。
  - 使用 shadcn/ui `Card`、`Button`、`Badge`、`Checkbox` 或状态标记实现任务状态。
  - 未配置模型时第一项显示 `未配置模型，不影响本地写作`；AI 写作任务点击时引导到模型配置。
  - 支持关闭任务清单并持久化，同时保留重新打开入口。
  - 覆盖 Requirements 2、3、12、13。

- [x] 6. 改造新建书籍流程为本地优先
  - 调整 BookCreate / 新建书籍弹窗：主按钮改为 `创建本地书籍`。
  - 将书名、题材、平台、每章字数、目标章数、工作流模式作为本地建书字段处理。
  - 移除或降级 provider 未配置导致的硬失败；遇到后端写作运行时未配置时，只提示 AI 功能不可用。
  - 已配置模型时展示 AI 初始化选项；未配置模型时折叠或禁用 AI 初始化选项并显示说明。
  - AI 初始化失败时保留本地书籍并允许稍后重试。
  - 添加集成测试：未配置模型也可创建本地书籍并进入书籍总览。
  - 覆盖 Requirements 3、4、13。

- [x] 7. 增加故事经纬模板定义与应用逻辑
  - 在 `packages/core/src/jingwei/templates.ts` 或等价位置定义空白经纬、基础经纬、增强经纬、题材推荐模板。
  - 基础经纬创建栏目：人物、事件、设定、章节摘要。
  - 增强经纬追加栏目：伏笔、名场面、核心记忆。
  - 题材推荐仅生成可勾选候选项，不自动锁死结构。
  - 在新建书籍流程 Step 2 接入经纬结构选择。
  - 添加单测：空白 / 基础 / 增强 / 题材推荐应用结果正确。
  - 覆盖 Requirements 6、8、13。

- [x] 8. 建立故事经纬通用数据模型与 repository
  - 新增 `story_jingwei_section` 与 `story_jingwei_entry` schema / migration，字段按 design 中 Data Model 落地。
  - 新增 section repository：列表、新增、更新、软删、排序、启用 / 禁用。
  - 新增 entry repository：列表、新增、更新、软删、按 section 查询。
  - 自定义字段使用 JSON 存储；条目支持 aliases、tags、relatedChapterNumbers、relatedEntryIds、visibilityRule、participatesInAi、tokenBudget。
  - 添加 repository 单测：多 book 隔离、软删过滤、栏目禁用、条目关联。
  - 覆盖 Requirements 6、7、11、13。

- [ ] 9. 实现 legacy Bible 到故事经纬的适配层
  - 新增 `section-adapter.ts` 或等价模块，将 `bible_character`、`bible_event`、`bible_setting`、`bible_chapter_summary` 映射为人物、事件、设定、章节摘要栏目和条目。
  - 首次进入经纬页时，如果存在 legacy 数据但不存在经纬栏目，生成默认栏目映射。
  - 保持非破坏性兼容，不删除、不重命名旧 `bible_*` 表。
  - 确保用户可见 UI 不再把 legacy 名称作为主名称展示。
  - 添加测试：已有 legacy 数据可以在故事经纬页面展示。
  - 覆盖 Requirements 5、7、14。

- [ ] 10. 提供故事经纬 API 路由
  - 新增 `/api/books/:bookId/jingwei/sections` 的 GET/POST/PUT/DELETE。
  - 新增 `/api/books/:bookId/jingwei/entries` 的 GET/POST/PUT/DELETE。
  - 新增 `/api/books/:bookId/jingwei/templates/apply` 用于应用空白 / 基础 / 增强 / 题材推荐模板。
  - 新增 `/api/books/:bookId/jingwei/preview-context` 用于预览当前章节 AI 上下文。
  - 使用现有 zod / API 错误风格校验入参和错误返回。
  - 添加 API 测试：栏目 CRUD、条目 CRUD、模板应用、软删、非法 bookId。
  - 覆盖 Requirements 6、7、8、11、13。

- [ ] 11. 实现故事经纬 AI 上下文动态装配
  - 新增 `buildJingweiContext()`，以当前书启用且 participatesInAi=true 的栏目和条目为输入。
  - 实现章节时间线过滤：visibleAfterChapter / visibleUntilChapter。
  - 实现 global / tracked / nested 三类可见性；tracked 扫描标题、别名、关键词；nested 限制递归深度。
  - 核心记忆栏目在预算裁剪中优先保留。
  - 格式化输出使用 `【栏目名】标题：内容`，支持 `【自定义-栏目名】`。
  - 不假设羽书系统、现实映射、势力机构等特定栏目存在。
  - 添加单测：栏目禁用、不参与 AI、global/tracked/nested、时间线、核心记忆优先、无高级栏目不报错。
  - 覆盖 Requirement 11、13。

- [ ] 12. 将用户可见 Bible 文案迁移为故事经纬 / 经纬
  - 扫描 Studio 用户可见文案、侧栏入口、页面标题、空态、按钮、帮助说明，将主名称改为故事经纬 / 经纬。
  - 保留内部 legacy `bible_*` 命名和旧 spec 引用，但用户侧不再把 Bible 作为主名称。
  - 侧边栏短名使用 `经纬`，页面标题使用 `故事经纬`。
  - 文案保留惯用词：人物、事件、设定、章节摘要、伏笔、名场面、核心记忆。
  - 添加快照或文本断言，确保关键页面不再显示用户侧主名称 `Bible`。
  - 覆盖 Requirement 5、12。

- [ ] 13. 实现故事经纬页面与栏目管理 UI
  - 新增或改造 `JingweiPage.tsx`、`JingweiSectionTabs.tsx`、`JingweiSectionManager.tsx`。
  - 使用 shadcn/ui `Tabs`、`Table`、`DropdownMenu`、`Dialog`、`Form`、`Input`、`Textarea`、`Select`、`Switch`、`Checkbox`。
  - 支持栏目新增、删除/归档、重命名、排序、启用 / 禁用、是否参与 AI、默认可见性、字段定义编辑。
  - 禁用栏目后默认隐藏并从上下文装配排除；重新启用可恢复。
  - 添加组件测试：栏目新增、改名、禁用、排序、字段定义保存。
  - 覆盖 Requirements 6、7、12、13。

- [ ] 14. 实现故事经纬条目列表与条目表单 UI
  - 新增或改造 `JingweiEntryList.tsx`、`JingweiEntryForm.tsx`、`VisibilityRuleEditor.tsx`、`CustomFieldEditor.tsx`。
  - 条目表单支持：标题、正文 Markdown、标签、别名/关键词、关联章节、关联条目、自定义字段、可见性规则、是否参与 AI、token 预算。
  - 按栏目字段定义动态渲染自定义字段。
  - 可见性编辑器支持 tracked / global / nested、visible_after_chapter、visible_until_chapter、关键词、父条目。
  - 添加组件测试：自定义字段渲染、可见性切换、关联条目、表单保存。
  - 覆盖 Requirements 7、11、12、13。

- [ ] 15. 实现功能页教学空态组件
  - 新增通用 `JingweiEmptyState` / `FeatureEmptyState` 组件。
  - 为故事经纬、人物、设定、伏笔、名场面、核心记忆、AI 味检测、工作台模式分别提供空态文案和动作。
  - 空态涉及 AI 生成时，未配置模型显示配置提示，但保留本地动作。
  - 使用 shadcn/ui `Card`、`Alert`、`Button`、`Badge`。
  - 添加组件测试：各空态标题、说明、动作按钮、未配置模型提示。
  - 覆盖 Requirements 9、12、13。

- [ ] 16. 实现作者模式 / 工作台模式门控
  - 新增或改造 `WorkbenchModeGate.tsx`、`WorkbenchIntroEmptyState.tsx`。
  - 默认作者模式隐藏 Terminal、MCP、Browser、Git worktree、Shell 权限、Agent 原始日志、NarraForkAdmin 等一等入口。
  - 开启工作台模式前显示确认说明：高级工具、更高 token 消耗、普通写作不需要开启。
  - 工作台模式状态持久化到用户设置。
  - 关闭工作台模式后恢复作者模式并隐藏高级入口。
  - 添加测试：默认隐藏、高级模式开启/关闭、状态持久化。
  - 覆盖 Requirements 10、12、13。

- [ ] 17. 接入模型未配置提示到 AI 功能入口
  - 在 AI 续写、改写、评点、AI 生成经纬、深度 AI 味检测、工作台任务入口调用统一 gate。
  - 未配置模型时显示 shadcn/ui Dialog 或 Alert：`此功能需要配置 AI 模型`，提供 `配置模型` 与 `取消`。
  - 保证当前编辑器内容、选中文本、当前页面和弹窗上下文不丢失。
  - 添加集成测试：章节编辑器中选中文本触发 AI 改写，被拦截后取消，选区/文本仍在。
  - 覆盖 Requirements 3、9、11、12、13。

- [ ] 18. 支持高级范本 / Markdown 目录导入的最小入口
  - 在导入已有经纬入口提供 Markdown 目录导入能力的最小实现或可执行接口。
  - 将《没钱修什么仙》式目录识别为高级范本导入样例，导入说明中明确“范本是参考，不代表所有小说都需要这些栏目”。
  - 第一版只需完成目录识别、栏目候选预览、用户勾选后创建栏目；不要求完整解析所有 Markdown 内容为精细字段。
  - 添加测试 fixture 覆盖一个小型目录样例，不直接依赖大体量真实目录。
  - 覆盖 Requirements 8、14。

- [ ] 19. 更新文档与旧入口说明
  - 更新相关开发文档，说明 Bible 用户侧命名已改为故事经纬 / 经纬，内部 legacy 命名暂时保留。
  - 在 `docs/04-开发指南/Bible开发指引.md` 或新增经纬段落中记录：可编辑栏目、通用条目、动态上下文装配、shadcn/ui 约束。
  - 更新快速开始 / 运行文档中首次打开流程：配置模型第一步但可跳过。
  - 明确《没钱修什么仙》为高级范本 / 导入样例，不是默认标准。
  - 覆盖 Requirements 5、8、12、14。

- [ ] 20. 执行验证与真实烟测
  - 运行相关单元测试、集成测试、typecheck、lint / format。
  - 真实烟测：在未配置 provider 的环境启动 Studio，确认可打开首页、关闭欢迎弹窗、创建本地书籍、进入书籍总览、打开故事经纬空态。
  - 真实烟测：点击 AI 写作入口，确认弹模型配置提示且不丢失当前输入。
  - 真实烟测：创建基础经纬和增强经纬，确认栏目数量和名称正确。
  - 真实烟测：开启/关闭工作台模式，确认高级入口显隐正确。
  - 记录任何未完成或环境限制，不虚构通过结果。
  - 覆盖 Requirement 13 与全 spec 完成定义。

## Done Definition

- 首次欢迎弹窗可关闭、可持久化、可重新打开。
- 首页任务清单第一项是配置 AI 模型，未配置时显示“不影响本地写作”。
- 未配置 provider / model 时，用户仍可打开 Studio、创建本地书籍、进入书籍总览。
- 新建书籍主按钮是 `创建本地书籍`，AI 初始化是可选增强。
- 用户可见层使用故事经纬 / 经纬，不再以 Bible 作为主名称。
- 基础经纬生成 4 个栏目：人物、事件、设定、章节摘要。
- 增强经纬生成 7 个栏目：人物、事件、设定、章节摘要、伏笔、名场面、核心记忆。
- 用户可新增、改名、排序、禁用栏目，并配置字段与 AI 参与方式。
- AI 上下文按当前书启用栏目动态装配，不依赖固定 10 维度。
- 功能页空态具有教学文案与可执行动作。
- 作者模式默认隐藏工作台高级工具；工作台模式需显式开启。
- 新增 UI 使用 shadcn/ui + Tailwind，满足基本可访问性。
- 相关测试、typecheck、lint / format 通过；真实烟测结果有记录。
