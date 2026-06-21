# 驾驶舱面板布局 — Tasks

**依赖**: cockpit-overview Task 1 ✅ + jingwei-settings-ui ✅ + 本 spec 布局设计

---

## Phase A：总览区面板集成（扩展 cockpit-overview）

- [x] A1. ExpandablePanel PanelType 扩展为 7 个（quality/health/progress/arcs/drift/compliance/alert）
- [x] A2. PanelContent switch 加 CharacterArcsPanel / StyleDriftPanel / CompliancePanel 渲染
- [x] A3. StatusBar 加 7 个面板切换 icon button（替代当前仅 quality+alert 的 2 个）
- [ ] A4. BeatProgressBar 嵌入 StatCard 网格（进度条形态）
- [x] A5. DefaultCockpitView 重写上半区为 StatCard 2×3 网格（fetch overview-stats）
- [ ] A6. StatCard 点击联动（伏笔→展开 foreshadowing panel / 平台→展开 compliance / 弧线→展开 arcs）

## Phase B：写作区面板集成（扩展 writing-scene-spec-ui）

- [ ] B1. 编辑器底部可展开工具栏组件 ChapterToolbar（ChapterHealthCard + AiTasteReport tab 切换）
- [x] B2. 右侧面板 tab 化：SceneSpecPanel + VariantsPanel 共用 slot（tab "蓝图" / "变体"）
- [ ] B3. InlineWritePanel 浮层：Tab 键触发光标位置续写浮层
- [ ] B4. "生成变体" 按钮（编辑器工具栏）→ 调 /variants/generate → VariantsPanel 渲染结果
- [x] B5. WorkbenchCanvas 集成（底部 ChapterToolbar + 右侧 tab 面板 + InlineWrite 浮层）

## Phase C：方法论/对话面板入口

- [ ] C1. PresetsPanel 接入设定区 rules 分类下子视图
- [ ] C2. TemplateMarketPanel 注册为 Routines 页 plugin section
- [x] C3. ConversationResourcePanel 接入 agent 对话面板侧栏
- [ ] C4. PresetSuggestionCard：建书完成后弹推荐预设提示

## Phase D：跨区联动 + 验证

- [ ] D1. URL 路由参数联动设计（?area=overview&panel=compliance）
- [ ] D2. StatCard 点击→ExpandablePanel 展开（A6 的路由版）
- [ ] D3. 设定区伏笔"目标章节"→跳写作区打开该章
- [ ] D4. 全量 typecheck + Browser 验证 15 个面板全有入口
