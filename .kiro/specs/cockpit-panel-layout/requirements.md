# 驾驶舱面板布局规划 — Requirements + Design

**版本**: v1.0.0
**创建日期**: 2026-06-15
**定位**: 统一规划 15 个孤儿面板在总览/写作/设定三区的归位、布局形式和跨区联动。反向更新 cockpit-overview / writing-scene-spec-ui 的 tasks。

---

## 问题陈述

15 个已实现的写作面板从未接入 UI（孤儿）。前三个 spec 各自规划了骨架，但没有回答"15 个工具在哪、怎么摆、怎么联动"。本 spec 统一解决。

---

## 面板归位（权威分配）

### 总览区（全书层：一眼看全局）

| 面板 | 承载方式 | 数据源 |
|------|---------|--------|
| **StatCard 网格**（进度/伏笔/情节/字数/平台） | 仪表盘顶部 2×3 网格 | /overview-stats |
| **QualityPanel** | ExpandablePanel "quality" | /quality-trend + /health |
| **BookHealthSummary** | ExpandablePanel "health" | /health |
| **DailyProgressCard** | ExpandablePanel "progress" | /overview-stats.wordCount |
| **CharacterArcsPanel** | ExpandablePanel "arcs" | /arcs |
| **StyleDriftPanel** | ExpandablePanel "drift" | /style/drift-check |
| **CompliancePanel** | ExpandablePanel "compliance" | /compliance/publish-readiness |
| **BeatProgressBar** | StatCard 行内嵌入（进度条形式） | beats 数据 |

**布局**：顶部 StatCard 网格（含 BeatProgressBar 内嵌）+ 底部 ExpandablePanel（7 个 panel type，底部 StatusBar 切换）。

### 写作区（单章层：围绕正在写的章节）

| 面板 | 承载方式 | 触发 |
|------|---------|------|
| **SceneSpecPanel** | 编辑器右侧可收起面板 | "生成蓝图"按钮 |
| **ChapterHealthCard** | 编辑器底部工具栏展开 | 自动（保存后刷新） |
| **AiTasteReport** | 编辑器底部工具栏展开 tab | 自动（保存后刷新） |
| **InlineWritePanel** | 编辑器内联浮层（光标位置） | Tab 键 / 工具栏按钮 |
| **VariantsPanel** | 编辑器右侧面板（和 SceneSpec 共用 slot，tab 切换） | "生成变体"按钮 |

**布局**：编辑器 = 中间正文 + 右侧可收起面板（SceneSpec / Variants tab 切换）+ 底部可展开工具栏（ChapterHealth / AiTaste tab 切换）。InlineWrite 是光标位置的浮层。

### 设定区 → 已完成（经纬编辑 + 伏笔看板）

| 面板 | 承载方式 |
|------|---------|
| ForeshadowingBoard | 伏笔分类下"看板视图"切换 ✅ |
| JingweiEntryEditor 多 tab | 条目编辑 ✅ |

### 方法论/市场（独立入口）

| 面板 | 承载方式 | 入口 |
|------|---------|------|
| **PresetsPanel** | 设定区 rules 分类下"预设库"子视图 | 经纬侧栏 rules 分类 |
| **PresetSuggestionCard** | 建书向导完成后的"推荐预设"弹窗 | guided-setup 返回后 |
| **TemplateMarketPanel** | Routines 页 plugin section | 套路标签页 |

### 对话关联

| 面板 | 承载方式 | 入口 |
|------|---------|------|
| **ConversationResourcePanel** | agent 对话侧栏的"资源"tab | 对话面板工具栏 |

---

## 跨区联动

| 触发 | 动作 |
|------|------|
| 总览 StatCard "伏笔回收率" 点击 | → 设定区 foreshadowing 分类 ForeshadowingBoard |
| 总览 "文风漂移" 告警点击 | → 写作区打开对应章节 + StyleDriftPanel |
| 总览 "角色弧线" 点击 | → 设定区 characters 分类 CharacterArcsPanel |
| 总览 "平台就绪" 点击 | → 展开 CompliancePanel |
| 写作区 AiTasteReport 告警 | → 标红正文中 AI 味句段（后续正文联动） |
| 设定区伏笔"目标章节"点击 | → 写作区打开该章 |

联动机制：URL 路由参数（`?panel=foreshadowing&chapter=5`）或 context state 传递。

---

## 更新现有 spec 的 Tasks

### cockpit-overview 追加 tasks：

- Task 3（已有）：接入 BookHealthSummary + DailyProgressCard → **扩展为接入全部 7 个面板**
- Task 4（已有）：ExpandablePanel 扩展 PanelType → **从 2 扩展到 7**（quality/health/progress/arcs/drift/compliance/alert）
- Task 新增：StatusBar 加全部面板切换入口（7 个 icon button）
- Task 新增：StatCard "伏笔/弧线/平台" 点击联动（跳转对应面板/区域）

### writing-scene-spec-ui 追加 tasks：

- Task 新增：编辑器底部工具栏（ChapterHealthCard + AiTasteReport tab 切换）
- Task 新增：右侧面板 tab 化（SceneSpec + Variants 共用 slot）
- Task 新增：InlineWritePanel 浮层集成（Tab 键触发）
- Task 新增：VariantsPanel 接入（"生成变体"按钮）

### 新增独立 tasks：

- PresetsPanel 接入设定区 rules 分类
- TemplateMarketPanel 接入 Routines 页 plugin section
- ConversationResourcePanel 接入对话面板侧栏
- 跨区联动路由参数设计

---

## 验收标准

- AC1：总览区 ExpandablePanel 可切换 7 个面板，各面板数据正常加载
- AC2：写作区编辑章节时底部显示 ChapterHealth/AiTaste，右侧显示 SceneSpec/Variants
- AC3：InlineWritePanel Tab 键触发续写浮层
- AC4：PresetsPanel 在设定区 rules 分类可访问
- AC5：跨区联动至少 2 条生效（伏笔→看板、平台→CompliancePanel）
- AC6：15 个孤儿面板全部有 UI 入口（无一遗漏）
