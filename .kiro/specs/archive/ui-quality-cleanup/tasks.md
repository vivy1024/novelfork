# Implementation Plan — UI Quality Cleanup

## 审计来源

基于对 app-next 15 个文件的逐行审计，共发现 50+ 个具体问题。

## Tasks

### 批次 1：全局基础设施

- [x] 1. 统一视觉规范常量 + 共享组件
  - 在 `app-next/components/` 下新建 `shared.tsx`，提取共享 Row 组件（消除 SettingsSectionContent 和 ProjectConfigSection 的重复定义）。
  - 在 `layouts.tsx` 中：
    - header 的 "NOVELFORK STUDIO NEXT" 改为 "NovelFork Studio"。
    - 删除 `status ?? "旁路入口 /next"` fallback，改为空。
    - 主内容区加 `max-w-7xl mx-auto`。
    - SectionLayout description 传 `undefined` 时不渲染空 `<p>`（修复空字符串 truthy 问题）。
  - 验收：header 无 "NEXT"，无 "旁路入口"，内容区有 max-width。

- [x] 2. StudioNextApp 清理
  - 删除 `status="旧前端冻结，旁路建设中"`，不传 status。
  - RoutinesPage 的 SectionLayout 删除 `description="复用旧 Routines API 与类型。"`，改为空或删除 SectionLayout 包裹（RoutinesNextPage 自己有标题）。
  - 验收：无开发者术语。

### 批次 2：仪表盘 + 工作台

- [x] 3. DashboardPage 清理
  - 日更统计从纯文本改为带图标的统计条。
  - 书籍卡片加 hover 效果和最近更新时间。
  - 资源搜索 input 移除（DashboardPage 不需要搜索）。
  - 圆角统一为 `rounded-lg`（卡片）+ `rounded-md`（input/button）。
  - 验收：无纯装饰 input，卡片有 hover。

- [x] 4. WorkspacePage 硬编码清理
  - FALLBACK_BOOK/FALLBACK_CHAPTERS/FALLBACK_GENERATED/FALLBACK_INPUT 移到测试文件（`WorkspacePage.test.tsx`），生产代码中 API 失败时显示空态而非假数据。
  - 删除 `"该 AI 动作尚未接入写作工具"` 错误信息，改为 `"此功能即将推出"`。
  - 删除 `"运行状态：空闲"` 硬编码，改为不显示或从 API 读取。
  - 删除 `href="#presets"` 死链接，改为 disabled 按钮。
  - 删除 `"将复用 Bible / Jingwei API 显示"` 开发者备注。
  - 删除 `"点击已有章节、生成章节、草稿或经纬分类后，这里显示对应编辑器、候选稿或详情。"` 长文案，改为简洁空态。
  - 删除 `"这里会接入 ChapterReader / BookDetail 的真实章节内容与保存能力。"` TODO 文案。
  - 删除 `"生成稿 vs 已有章节"` 占位 div。
  - CandidateEditor 的 textarea defaultValue 从说明文字改为空。
  - 验收：零开发者术语，零 TODO 文案。

- [x] 5. WorkspacePage 空壳修复
  - 资源搜索 input：接入过滤逻辑（过滤资源树节点）或移除。
  - 空态 CTA 按钮（"创建章节"、"生成下一章"等）：加 onClick handler 或 disabled。
  - handleApplyHook：实现为追加到编辑器内容，或 disabled 按钮。
  - WritingModesPanel/WritingToolsPanel 的 noop 回调：对应按钮加 disabled 状态。
  - 验收：无点击无反应的按钮。

- [x] 6. WorkspacePage 样式统一
  - 所有 `rounded-xl` 改为 `rounded-lg`。
  - 所有 `rounded-2xl` 改为 `rounded-lg`。
  - 所有 `border-dashed` 空态统一样式。
  - AI 面板按钮确认在窄侧栏中不截断。
  - 验收：圆角统一。

### 批次 3：工作台子面板

- [x] 7. BiblePanel 修复
  - 列表项加 hover 样式（`hover:bg-muted`）。
  - 列表加 `max-h-[20rem] overflow-auto`。
  - 错误色统一为 `text-destructive`。
  - 验收：列表可滚动，有 hover。

- [x] 8. PublishPanel + DetectPanel + TruthPanel 修复
  - 颜色从原始色改为语义色。
  - TruthPanel 左侧宽度改为响应式。
  - DetectPanel 空态文案从 "API 未接入" 改为 "暂无检测数据"。
  - 验收：无原始色，无 API 术语。

### 批次 4：设置页

- [x] 9. SettingsSectionContent 清理
  - NotificationsSection：从设置导航中隐藏（不显示"通知"入口），或改为"即将推出"一行文字。
  - HistorySection：删除 "Admin Requests" / "AI request observability" 英文标签，改为中文或隐藏。
  - ServerSection：删除 "已加载" 硬编码，显示真实诊断数据或 "—"。
  - ModelsSection 标题从 `text-2xl font-bold` 改为 `text-lg font-semibold`。
  - 提取共享 Row 组件到 `shared.tsx`。
  - 验收：无英文标签混入，标题大小统一。

- [x] 10. ProviderSettingsPage 修复
  - API Key input 改为 `type="password"`。
  - AddProviderForm 验证 name 非空。
  - toggleProvider 调用 API 持久化（`POST /providers/:id/toggle`）。
  - 高级字段根据 apiMode 条件渲染：ChatGPT 账户 ID 仅 OpenAI，Responses WebSocket 仅 responses 模式，Codex 思考强度仅 codex 模式。
  - AddProviderForm 圆角从 `rounded-2xl` 改为 `rounded-lg`。
  - 验收：密码隐藏，开关持久化，高级字段条件渲染。

- [x] 11. ProjectConfigSection 清理
  - 删除 "未接入 · 等待环境变量读取 API"，改为不显示环境变量 section。
  - Row 组件改为 import 共享版本。
  - 验收：无 "未接入" 文案。

### 批次 5：套路页 + 工作流 + 搜索

- [x] 12. RoutinesNextPage 清理
  - HooksSection 创建表单加提交/取消按钮。
  - select 从 `defaultValue` 改为受控组件（`value` + `onChange`）。
  - 加载态圆角从 `rounded-2xl` 改为 `rounded-lg`。
  - 验收：钩子创建表单可提交。

- [x] 13. WorkflowPage 修复
  - NotConnected 组件删除 API 端点路径，改为 "暂无数据"。
  - 三个 tab 加刷新按钮。
  - 验收：无 API 路径暴露。

- [x] 14. SearchPage 修复
  - 搜索结果项加 onClick 跳转（切换到工作台对应章节）。
  - 无结果时显示友好空态。
  - 验收：搜索结果可点击。

### 批次 6：测试适配

- [x] 15. 更新测试
  - FALLBACK 数据移到测试文件后，确认测试仍通过。
  - 被移除的 UI 元素（资源搜索 input、"运行状态：空闲"等）从测试断言中删除。
  - 全量 typecheck + test。
  - 验收：所有测试通过。

## Done Definition（第一阶段）

- 零开发者术语泄露。✅
- 零空壳按钮（每个按钮要么有功能要么 disabled）。✅
- 圆角/颜色/标题/间距全局统一。✅
- API Key 隐藏，表单有验证，开关持久化。✅
- 所有测试通过。✅

---

## 第二阶段：逐模块对标 NarraFork

审计方式：逐个模块截图 NarraFork 7778 端口，与我们 4568 端口对比，记录差距后修复。

### 模块 1：仪表盘/首页

NarraFork 仪表盘特征：
- 左侧 sidebar：叙事线列表（可拖拽排序）+ 叙述者列表（可拖拽排序）+ 新建会话按钮
- 顶栏：品牌名 + 全局搜索框 + GitHub 链接
- 主内容区：欢迎标题 + 3 个统计链接卡片（活跃项目/项目总数/独立会话，数字 + 可点击）+ 最近项目列表（项目名 + ACTIVE 状态标签）
- 底部：退出登录 + 版本号 + 开源协议

我们的差距：
1. 无 sidebar — NarraFork 的 sidebar 是全局导航核心，我们只有顶部 5 个 tab
2. 品牌名全大写 "NOVELFORK STUDIO" — 应改为正常大小写 "NovelFork Studio"
3. 统计是纯文本 "今日 0 字 · 0 章" — 应改为可点击的统计卡片
4. 书籍卡片信息太少 — 缺少状态标签、最近更新时间
5. 无全局搜索框 — NarraFork 顶栏有搜索
6. 无版本号/退出登录

- [x] 16. 仪表盘统计卡片升级
  - "今日 0 字 · 0 章" 改为 2-3 个统计卡片（作品总数/今日字数/今日章节），每个有数字 + 标签 + 可点击。
  - 验收：统计区有视觉层次，可点击跳转。

- [x] 17. 仪表盘书籍卡片增强
  - 每本书卡片加：状态标签（active/paused/outlining 用颜色区分）、最近更新时间、章节进度条。
  - 验收：卡片信息丰富度接近 NarraFork 项目卡片。

- [x] 18. 顶栏加全局搜索框 + 版本号
  - layouts.tsx 的 header 加搜索 input（点击跳转到 /next/search）。
  - header 右侧加版本号（从 /settings/release 读取）。
  - 品牌名确认为正常大小写 "NovelFork Studio"（第一阶段已修）。
  - 验收：顶栏有搜索入口和版本号。

### 模块 2-N：待对比

以下模块待逐个截图对比后补充任务：

- [x] 模块 2：设置页 — 个人资料
  - 差距：缺头像占位（首字母缩写圆形 + 上传按钮）；"分区导航"冗余文字应删除；设置分区切换不更新 URL。
  - 修复：加头像占位区；删"分区导航"文字；分区切换时 pushState 更新 URL。

- [x] 模块 3：设置页 — AI 供应商（第一轮，已完成但方向不完整）
  - 已完成：设置导航加 lucide 图标、卡片列表/详情双视图、API Key 输入隐藏、开关持久化。
  - 问题：仍然把“平台集成”和“API key 接入”混在同一套 Provider/模型详情里。NarraFork 不是这样。

- [x] 20. 供应商架构拆分：平台集成 vs API key 接入
  - 新增前端类型：`PlatformIntegration`、`PlatformCredential`、`ApiProvider`、`ApiModel`。
  - ProviderSettingsPage 内部不再把平台集成和 API key 接入都当成 `ManagedProvider`。
  - 平台集成使用 mock/derived 数据：Codex、Kiro、Cline 等，只展示账号/凭据管理 UI，不展示 API Key/Base URL。
  - API key 接入继续使用现有 `ManagedProvider` / provider-manager 数据。
  - 验收：平台集成详情页没有 API Key/Base URL；API key 接入详情页才有 Base URL/API Key/兼容格式/API 模式。

- [x] 21. 平台集成详情页对标 cockpit-tools/NarraFork
  - 详情页结构：返回按钮、平台名、启用 switch、全局代理 URL（disabled）、默认推理强度（Codex only，disabled）、Responses WebSocket（Codex only，disabled）。
  - 凭据管理区：浏览器添加、设备码添加、JSON 导入按钮（disabled，标注“即将推出”）。
  - 凭据表格列：名称、账号 ID、优先级、状态、成功/失败、配额、最后使用、操作。
  - 空态：暂无账号，提示“添加平台账号后可用于反代调用”。
  - 验收：视觉接近 NarraFork 平台集成展开页，而不是 API Provider 表单。

- [x] 22. API key 接入详情页对标 NarraFork
  - 详情页结构：返回按钮、Provider 名、兼容格式 badge、API 模式 badge、Base URL、API Key（password）、保存按钮。
  - 模型区：刷新模型、模型测试、上下文长度、启用/禁用。
  - 不显示平台凭据字段（账号 ID、优先级、配额）。
  - AddProviderForm 只出现在 API key 接入分区。
  - 验收：API 接入页只处理 BaseURL/APIKey，不出现平台账号导入按钮。

- [x] 模块 0：全局 sidebar（跨模块）
  - NarraFork 所有页面都有左侧 sidebar（仪表盘/监察者/叙事线/项目列表/叙述者列表/套路/设置/退出登录/版本号）。这是最大的结构性差距。
  - 修复：在 layouts.tsx 的 NextShell 中加左侧 sidebar，包含：书籍列表（对应 NarraFork 的叙事线）、页面导航（仪表盘/工作台/工作流/设置/套路）、版本号。顶部 tab 导航移到 sidebar 中。

- [x] 模块 4：设置页 — AI 代理
  - 差距严重：NarraFork 有 ~20 个配置项，我们只覆盖 ~8 个。
  - 缺少的 switch 开关：旧编码支持、刷新 Shell 环境、翻译思考内容、默认展开推理内容、默认宽松规划、智能检查输出中断、滚动加载更早消息、要求使用您的语言回复。
  - 缺少的完整功能：自定义可重试错误规则（CRUD 列表，每条有 switch + 关键词 + 描述 + 删除）、WebFetch 代理模式选择。
  - 上下文窗口阈值应分标准(≤600k)/大窗口(>600k)两组，每组截断起始%+压缩起始%共 4 个值。
  - 白名单/黑名单应有 4 个独立列表管理器（目录白名单/黑名单 + 命令白名单/黑名单），每个有输入框+添加按钮+列表。
  - checkbox 应改为 switch 组件。
  - 修复：扩展 RuntimeControlPanel 或重写 AgentsSection，补齐所有配置项。
- [x] 模块 5：设置页 — 外观
  - 差距严重：NarraFork 有 5 个分组 ~12 个配置项，我们只有 3 个。
  - 缺少的分组和配置项：
    - 主题：OLED 纯黑 switch（深色模式下纯黑背景）
    - 显示：全屏模式 switch、屏幕常亮 switch、高级动画 switch（blur-in 动画）
    - 自动换行：Markdown / 代码 / Diff 三个 switch
    - 终端：终端主题下拉（自动/跟随系统）、终端字体大小滑块（8-32）
    - 语言：下拉选择（简体中文/English）
    - 输入：发送方式 tab（Enter 发送 / Ctrl+Enter 发送）
  - 主题选择器：NarraFork 用 3 个 tab 按钮（浅色/深色/跟随系统），选中态蓝色下划线。我们用 3 个卡片按钮带图标，风格不同但可接受。
  - 修复：在 AppearancePanel 中补齐缺失的分组和配置项，每个 switch 对应 `putApi("/settings/user", { preferences: { ... } })`。
- [x] 模块 6：套路页
  - tab 选中态：NarraFork 用蓝色下划线（`border-b-2 border-primary`），我们用实色背景（`bg-primary text-primary-foreground`）。改为下划线风格。
  - 命令空态：旧 CommandsTab 显示英文 "Define custom commands..."，应中文化或替换为自己的空态。
  - scope 切换按钮（生效视图/全局/项目）+ 保存/重置按钮占据了标题行右侧空间，NarraFork 没有这些。考虑收起到下拉或移到 tab 内容区底部。
  - 修复：tab 样式改下划线；CommandsTab 空态中文化；scope 按钮位置优化。
- [x] 模块 7：创作工作台
  - NarraFork 的项目页是两列章节卡片布局，每个卡片有标题+活跃标签+工具栏+内容预览+底部状态。
  - 我们的工作台是三栏布局（资源树+编辑器+AI面板），这是小说工具的正确设计，不需要照搬 NarraFork 的两列卡片。
  - 但需要学习的：
    - 顶部操作栏：NarraFork 有"删除/清理/批量合并/命令/技能/套路/设置/新建章节"一排操作按钮。我们的工作台顶栏只有作品选择+发布就绪+预设管理，缺少快捷操作。
    - 底部输入框：NarraFork 有全局"发送消息..."输入框+状态栏（思考中/费用/空闲）。我们没有全局 AI 对话入口。
    - 卡片工具栏：NarraFork 每个章节卡片有 6 个操作图标。我们的资源树节点只有点击选中，没有右键菜单或操作图标。
  - 修复：工作台顶栏加快捷操作按钮（新建章节/AI 续写/导出）；资源树节点加右键菜单或 hover 操作图标。

## 跨模块：全局 sidebar

这是所有模块对比中最大的结构性差距。NarraFork 所有页面都有左侧 sidebar，包含：
- 导航入口（仪表盘/监察者/叙事线/叙述者/套路/设置）
- 项目列表（可拖拽排序）
- 会话列表（可拖拽排序）
- 退出登录 + 版本号

我们目前只有顶部 5 个 tab 按钮，没有 sidebar。

- [x] 19. 实现全局 sidebar
  - 在 layouts.tsx 的 NextShell 中，将顶部 tab 导航改为左侧 sidebar。
  - sidebar 内容：品牌名+版本号、导航入口（仪表盘/创作工作台/工作流/设置/套路，每项有 lucide 图标）、书籍列表（从 /books API 加载）、退出/版本号。
  - 主内容区在 sidebar 右侧。
  - sidebar 宽度 ~200px，可折叠。
  - 对标 NarraFork 的 sidebar 设计：图标+文字、分组标题、选中态蓝色背景、底部版本号。
  - 验收：所有页面都有左侧 sidebar，导航从顶部 tab 移到 sidebar。
