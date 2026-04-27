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

## Done Definition

- 零开发者术语泄露。
- 零空壳按钮（每个按钮要么有功能要么 disabled）。
- 圆角/颜色/标题/间距全局统一。
- API Key 隐藏，表单有验证，开关持久化。
- 所有测试通过。
