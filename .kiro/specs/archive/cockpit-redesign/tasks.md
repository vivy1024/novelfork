# Implementation Plan

## Overview

基于 cockpit-redesign spec，将当前驾驶舱从"信息堆砌长列表"重构为"经纬图谱为主 + 底部可展开面板"的 AI 写作质量控制台，同时新增 3 个 Agent 工具、重构对话面板布局、精简顶部工具栏。

## Tasks

### Phase 1：基础框架（CockpitWorkspace + StatusBar + ExpandablePanel）

- [x] 1. 新建 `CockpitWorkspace.tsx` 骨架组件，替代 `CockpitOverview` 作为画布默认视图。包含三个区域占位：JingweiGraphWorkspace（主区域）、StatusBar（底部固定 36px）、ExpandablePanel（默认收起）。在 `WorkbenchCanvas.tsx` 中用 feature flag（`localStorage.cockpitV2`）切换新旧组件。
- [x] 2. 实现 `StatusBar.tsx`：一行显示"章数/目标 | 节拍位置 | 质量均分 | AI味均值 | ⚠警告数"。每个区段可点击，点击 toggle 对应面板。数据从 `/api/books/:bookId/health` + localStorage beatStore 读取。当前展开面板对应区段高亮。
- [x] 3. 实现 `ExpandablePanel.tsx`：接收 `activePanel` prop 决定渲染哪个面板。支持关闭（×）、最大化（□）、拖拽调整高度（↕）。面板互斥。高度偏好持久化到 localStorage。最大化时隐藏图谱区域，StatusBar 仍可见。

### Phase 2：经纬图谱工作区（JingweiGraphWorkspace）

- [x] 4. 新建 `JingweiGraphWorkspace.tsx`：左侧 CategorySidebar（120px 固定宽）+ 右侧 GraphCanvas（flex-1）+ 底部 ViewSwitcher。复用现有 `JingweiCategorySidebar` 组件，改为竖向排列。
- [x] 5. 将 `JingweiGraphView`（react-flow）从 Dialog 模式改为内嵌画布模式。增加节点 lifecycle 状态色（active=绿边框, dormant=灰, retired=红）。增加关系连线上的类型标签。
- [x] 6. 实现节点点击交互：点击节点 → 右侧滑出 overlay 编辑面板（复用 `JingweiEntryForm`），不离开图谱。双击节点 → 选中资源树中对应条目（触发 WorkbenchCanvas 切换到 JingweiEntryEditor）。
- [x] 7. 实现 ViewSwitcher：底部按钮组切换 5 种视图模式——关系图谱（默认）、角色弧线、矛盾地图、列表（复用 JingweiEntryList）、时间线（复用 JingweiProgressions）。
- [x] 8. 实现角色弧线视图：角色节点按章节横向展开，从 `jingwei_progressions` 读取状态变化数据，用横向时间线布局渲染。
- [x] 9. 实现矛盾地图视图：从 `bible_conflict` 表或 entries 中读取冲突数据，卡片列表展示 protagonist/antagonist/stakes/resolutionState。

### Phase 3：底部面板实现

- [x] 10. 实现 `panels/PresetPanel.tsx`：按分类分组展示启用预设（流派/文风/基底/逻辑风险/AI过滤/文学技法）。每个预设卡片含名称+分类标签+promptInjection 摘要（可展开）。支持 toggle 启用/禁用。底部"添加套装"按钮打开模板市场选择。
- [x] 11. 实现 `panels/BeatPanel.tsx`：显示当前节拍模板名 + 可视化进度条 + 当前节拍详情（名称/情绪基调/字数分配/网文建议）+ 节拍列表（完成状态+对应章节范围）。支持切换节拍模板。数据从 beatStore 读取。
- [x] 12. 实现 `panels/QualityPanel.tsx`：AI味趋势折线图（最近 20 章）+ 文风漂移曲线 + 审校通过率 + 逻辑风险触发统计 + 章节质量列表。点击章节可跳转编辑器。数据从新 API `/api/books/:bookId/quality-trend` 读取。
- [x] 13. 实现 `panels/AlertPanel.tsx`：汇总审校未通过章节、逾期伏笔、经纬矛盾、文风漂移超阈值。每个警告含操作入口（跳转章节/跳转 Agent 对话）。

### Phase 4：新增后端 API 和工具

- [x] 14. 新增路由 `routes/quality-trend.ts`：`GET /api/books/:bookId/quality-trend`，返回最近 N 章的质量评分、AI味分数、文风漂移度数据（供前端图表渲染）。
- [x] 15. 新增路由 `routes/preset-hits.ts`：`GET /api/books/:bookId/chapters/:ch/preset-hits`，返回该章写作时触发的预设约束列表（从写作日志或审计结果中提取）。
- [x] 16. 新增工具 `presets.get_rules`：在 `tool-schemas.ts` 注册 schema，在 handlers 中实现——读取当前书籍启用的预设列表，返回每条预设的 name + category + promptInjection。
- [x] 17. 新增工具 `presets.check_compliance`：在 `tool-schemas.ts` 注册 schema，在 handlers 中实现——接收章节内容，对照启用的预设规则逐条检查，返回违规项列表（presetName + rule + violation + severity）。
- [x] 18. 新增工具 `beat.get_current`：在 `tool-schemas.ts` 注册 schema，在 handlers 中实现——读取当前书籍的节拍模板 + 当前章号推算节拍位置，返回模板名/当前节拍序号/名称/情绪基调/字数建议/网文提示。

### Phase 5：对话面板重构

- [x] 19. 对话面板顶部添加工具配置栏：一行显示"🔧 经纬+章节(锁定) | ☑预设 ☑节拍 ☑伏笔 | ☐角色一致性 ☐叙事线"。toggle 开关控制 session 工具启用/禁用。配置存储在 session 级别。
- [x] 20. 对话面板顶部添加快捷按钮组：根据 Agent 角色显示对应按钮（写书→生成下一章/续写/选段写作/多版本；审校→连续性审校/AI味检测；伏笔→伏笔建议/章末钩子；大纲与经纬→生成大纲/重建经纬；章末钩子→生成钩子/应用钩子）。按钮点击自动发送指令到对话。
- [x] 21. 对话面板右侧实现资源管理器：通用文件树 + 内容预览。Agent 操作文件时自动跟随显示当前文件（activeFileId 驱动）。按 kind 分组（章节/大纲/经纬/候选稿/草稿）。可折叠。

### Phase 6：清理与迁移

- [x] 22. 精简顶部工具栏：移除写作动作按钮（生成下一章/续写/扩写/审校/AI味/伏笔），仅保留合规检查、导出、快照三个按钮。移除 `WorkbenchWritingActions.tsx` 的引用。
- [x] 23. 废弃旧组件：标记 `CockpitOverview.tsx`、`DailyProgressCard.tsx`、`WritingToolsPanel.tsx`、`WorkbenchWritingActions.tsx` 为 deprecated。移除 feature flag，CockpitWorkspace 成为默认。
- [x] 24. 更新资源树经纬节点行为：点击经纬相关节点不再触发 JingweiPanel Dialog，改为在画布中切换到 CockpitWorkspace 的经纬图谱视图并定位到对应节点。
