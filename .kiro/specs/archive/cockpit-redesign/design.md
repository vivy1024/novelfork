# 驾驶舱重构 — Design

## 架构概览

```
WorkbenchCanvas（画布区域）
├── 无选中资源时 → CockpitWorkspace（新驾驶舱）
│   ├── JingweiGraphWorkspace（经纬图谱主区域）
│   │   ├── CategorySidebar（左侧分类筛选）
│   │   ├── GraphCanvas（react-flow 图谱）
│   │   └── ViewSwitcher（图谱/列表/时间线切换）
│   ├── StatusBar（底部状态条，固定）
│   └── ExpandablePanel（可展开面板，互斥）
│       ├── PresetPanel（预设配置）
│       ├── BeatPanel（节拍进度）
│       ├── QualityPanel（质量监控）
│       └── AlertPanel（警告）
├── 选中章节时 → ChapterEditor（不变）
├── 选中经纬条目时 → JingweiEntryEditor（不变）
└── 选中其他资源时 → 对应 viewer（不变）
```

## 组件设计

### CockpitWorkspace

替代当前的 `CockpitOverview`。布局：

```
┌─────────────────────────────────────────────┐
│ CategorySidebar │ GraphCanvas               │ ← flex, sidebar 固定宽度
│ (120px fixed)   │ (flex-1, 占满剩余)         │
│                 │                            │
│                 │                            │
│                 │                            │
│                 ├────────────────────────────┤
│                 │ ViewSwitcher (底部工具条)   │
├─────────────────┴────────────────────────────┤
│ StatusBar (36px fixed)                       │ ← 始终可见
├──────────────────────────────────────────────┤
│ ExpandablePanel (0~50% height, 可拖拽)       │ ← 默认收起
└──────────────────────────────────────────────┘
```

### StatusBar

```tsx
interface StatusBarProps {
  totalChapters: number;
  targetChapters: number;
  currentBeat: { index: number; total: number; name: string };
  qualityAvg: number;
  aiTasteAvg: number;
  alertCount: number;
}
```

渲染为一行：
```
42/200章 │ 节拍 8/15 游戏时间 │ 质量 89 │ AI味 11% │ ⚠ 1
```

每个区段可点击，点击后 toggle 对应面板。当前展开的面板对应区段高亮。

### ExpandablePanel

```tsx
interface ExpandablePanelProps {
  activePanel: 'preset' | 'beat' | 'quality' | 'alert' | null;
  height: number; // 用户拖拽设定的高度
  onClose: () => void;
  onMaximize: () => void; // 独占画布
  onHeightChange: (h: number) => void;
}
```

行为：
- `activePanel = null` 时面板不渲染，图谱占满
- 展开时图谱高度 = 画布高度 - statusBar高度 - panel高度
- 最大化时图谱隐藏，面板占满画布（statusBar 仍可见）
- 面板顶部拖拽条支持调整高度（min 150px, max 50% 画布）

### JingweiGraphWorkspace

复用现有 `JingweiPanel` 的图谱逻辑，但改为内嵌画布而非 Dialog：

- `CategorySidebar`：复用 `JingweiCategorySidebar`，竖向排列分类按钮
- `GraphCanvas`：复用 `JingweiGraphView`（react-flow），增加：
  - 节点上显示 lifecycle 状态色（active=绿, dormant=灰, retired=红）
  - 点击节点 → 右侧滑出编辑面板（overlay，不离开图谱）
  - 双击节点 → 跳转到资源树中对应条目
- `ViewSwitcher`：底部三个按钮切换视图模式
  - 图谱（默认）→ react-flow
  - 列表 → 复用 `JingweiEntryList`
  - 时间线 → 复用 `JingweiProgressions`（按章节展示变更）

### PresetPanel

```
┌──────────────────────────────────────────────────┐
│ ⚙ 预设配置                    [□ 最大化] [× 关闭]│
├──────────────────────────────────────────────────┤
│ 流派套装                                         │
│ ┌──────────┐ ┌──────────┐                       │
│ │☑凡人宗门 │ │          │ [+ 添加套装]           │
│ │修仙      │ │          │                       │
│ └──────────┘ └──────────┘                       │
│                                                  │
│ 文风: ☑冷峻质朴  基底: ☑宗门家族修仙社会         │
│ 逻辑风险: ☑信息传播 ☑经济资源 ☑机构响应 ...      │
│ AI过滤: ☑12特征全扫 ☑句长方差                    │
│                                                  │
│ ─── 最近命中 ───                                 │
│ 第41章: 信息传播速度(违规) + 句长方差(通过)       │
│ 第40章: 经济资源(通过)                           │
└──────────────────────────────────────────────────┘
```

### BeatPanel

```
┌──────────────────────────────────────────────────┐
│ ♪ 节拍进度 — 救猫咪 15 节拍    [切换模板] [× 关闭]│
├──────────────────────────────────────────────────┤
│ ●●●●●●●●○○○○○○○                                 │
│ 1  2  3  4  5  6  7  [8]  9  10 11 12 13 14 15 │
│                                                  │
│ 当前：第 8 节拍 — 游戏时间 (Fun and Games)        │
│ 情绪基调：爽感                                    │
│ 字数分配：15%（约 4.5 万字 / 30 万字总量）        │
│ 网文建议：主角能力展示、金手指发威、读者爽点密集   │
│                                                  │
│ 对应章节：第 28-52 章（预估）                     │
│ 当前进度：第 42 章（节拍内 60%）                  │
└──────────────────────────────────────────────────┘
```

### QualityPanel

```
┌──────────────────────────────────────────────────┐
│ 📊 质量监控                    [□ 最大化] [× 关闭]│
├──────────────────────────────────────────────────┤
│ AI味趋势 (最近20章)     │ 文风漂移 (与基线偏离)  │
│ ┌────────────────┐      │ ┌────────────────┐    │
│ │    ╱╲  ╱╲     │      │ │  ──────────    │    │
│ │ ──╱──╲╱──╲──  │      │ │        ╱╲     │    │
│ │                │      │ │       ╱  ╲    │    │
│ └────────────────┘      │ └────────────────┘    │
│ 均值: 11% (良好)         │ 当前: 低漂移 ✅        │
│                                                  │
│ 审校: 38/41 通过 │ 逻辑风险: 信息传播x3 经济x1   │
│                                                  │
│ 章节列表:                                        │
│ #41 质量92 AI12% ⚠审校  #40 质量88 AI8% ✅      │
│ #39 质量91 AI9%  ✅     #38 质量85 AI15% ✅      │
└──────────────────────────────────────────────────┘
```

## 数据流

```
StatusBar 数据来源：
  - 章数/目标 → book 配置 + chapters 计数
  - 节拍位置 → beatStore（localStorage）+ 当前章号推算
  - 质量均分 → GET /api/books/:bookId/health
  - AI味均值 → GET /api/books/:bookId/health
  - 警告数 → 审校未通过 + 逾期伏笔 + 漂移超阈值

PresetPanel 数据来源：
  - 启用预设 → GET /api/books/:bookId/presets
  - 命中报告 → GET /api/books/:bookId/chapters/:ch/preset-hits（新 API）

BeatPanel 数据来源：
  - 节拍模板 → beatStore（内存 + localStorage）
  - 当前位置 → 章号 + wordRatio 累加推算

QualityPanel 数据来源：
  - AI味趋势 → GET /api/books/:bookId/health（含 per-chapter 数据）
  - 文风漂移 → GET /api/books/:bookId/chapters/:ch/tone-check
  - 审校状态 → chapters 列表 + audit 状态字段
```

## 新增 API

| 端点 | 方法 | 用途 |
|------|------|------|
| `/api/books/:bookId/chapters/:ch/preset-hits` | GET | 返回该章写作时触发的预设约束列表 |
| `/api/books/:bookId/quality-trend` | GET | 返回最近 N 章的质量/AI味/漂移数据（供图表用） |

## 迁移策略

1. 新建 `CockpitWorkspace` 组件，与 `CockpitOverview` 并存
2. 用 feature flag 切换（`localStorage.cockpitV2 = true`）
3. 验证稳定后删除 `CockpitOverview`
4. `DailyProgressCard`、`NextChapterSuggestionCard`、`BookHealthSummary` 标记废弃
5. `JingweiPanel`（Dialog 模式）保留，但默认不再从资源树触发 Dialog，改为画布内嵌
6. `WritingToolsPanel`（Dialog）废弃，功能拆散：
   - 预设管理 → PresetPanel（驾驶舱底部面板）
   - 节拍表 → BeatPanel（驾驶舱底部面板）
   - 角色弧线/矛盾地图 → 经纬图谱视图模式
   - AI味/文风漂移/段落节奏/对话比例/全书健康 → QualityPanel
   - 选段写作/多版本变体/章末钩子/审校/伏笔建议 → Agent 对话面板按钮
   - 合规检查/导出 → 顶部工具栏保留
7. 顶部工具栏精简：移除写作动作按钮，仅保留合规/导出/快照

## 经纬图谱视图模式

GraphCanvas 支持多种视图模式（ViewSwitcher 切换）：

| 模式 | 内容 | 数据源 |
|------|------|--------|
| 关系图谱（默认） | 所有条目节点 + 关系连线 | jingwei entries + relations |
| 角色弧线 | 角色节点按章节横向展开，显示状态变化 | jingwei progressions |
| 矛盾地图 | 冲突关系高亮，protagonist/antagonist/stakes | bible_conflict 表 |
| 列表 | 扁平条目列表（复用 JingweiEntryList） | jingwei entries |
| 时间线 | 按章节展示变更历史 | jingwei progressions |

## Agent 对话面板设计

每个 Agent 对话页面采用"对话为主 + 右侧资源管理器"布局：

```
┌──────────────────────────────────────────────────┐
│ [快捷按钮1] [快捷按钮2] [快捷按钮3] ...          │
├────────────────────────────┬─────────────────────┤
│                            │ 资源管理器           │
│   对话区域（主）            │ ├─ 章节             │
│                            │ │  ├─ 第1章         │
│   用户消息                  │ │  ├─ 第2章         │
│   Agent 回复               │ │  └─ ...           │
│   工具调用结果              │ ├─ 大纲与设定       │
│                            │ ├─ 经纬资料         │
│                            │ └─ 伏笔             │
│                            │                     │
│                            │ ─── 内容预览 ───    │
│                            │ （点击文件后显示）    │
│                            │ Agent 修改时实时更新 │
└────────────────────────────┴─────────────────────┘
```

### 核心原则

- **不增实体**：复用对话页面已有的"文件修改"按钮机制，扩展为常驻资源树
- **对话为主**：左侧对话区占主要空间，右侧资源管理器可折叠
- **实时联动**：Agent 执行 Write/Edit 工具时，右侧资源管理器实时显示变更内容

### 每个 Agent 的快捷按钮

| Agent | 快捷按钮 |
|-------|---------|
| 写书 | 生成下一章、续写草稿、选段写作、多版本变体 |
| 伏笔 | 伏笔建议、章末钩子生成 |
| 审校 | 连续性审校、AI味检测 |
| 大纲与经纬 | 生成大纲、重建经纬 |
| 章末钩子 | 生成钩子、应用钩子 |

按钮点击 → 自动发送对应指令到 Agent 对话 → Agent 执行工具调用 → 右侧资源管理器显示结果。

### 资源管理器

- 复用 `WorkbenchResourceTree` 的数据结构和节点类型
- 点击文件节点 → 右侧下方显示内容预览（只读）
- Agent 修改文件时 → 内容预览自动刷新，高亮变更部分
- 资源管理器可通过按钮折叠/展开（默认展开）

## 文件变更清单

| 操作 | 文件 |
|------|------|
| 新建 | `pages/writing-workbench/CockpitWorkspace.tsx` |
| 新建 | `pages/writing-workbench/StatusBar.tsx` |
| 新建 | `pages/writing-workbench/ExpandablePanel.tsx` |
| 新建 | `pages/writing-workbench/panels/PresetPanel.tsx` |
| 新建 | `pages/writing-workbench/panels/BeatPanel.tsx` |
| 新建 | `pages/writing-workbench/panels/QualityPanel.tsx` |
| 新建 | `pages/writing-workbench/panels/AlertPanel.tsx` |
| 新建 | `pages/writing-workbench/JingweiGraphWorkspace.tsx` |
| 修改 | `pages/writing-workbench/WorkbenchCanvas.tsx`（切换到 CockpitWorkspace） |
| 修改 | Agent 对话面板组件（添加快捷按钮组） |
| 新建 | `routes/quality-trend.ts`（新 API） |
| 新建 | `routes/preset-hits.ts`（新 API） |
| 废弃 | `pages/writing-workbench/CockpitOverview.tsx` |
| 废弃 | `pages/writing-workbench/DailyProgressCard.tsx` |
| 废弃 | `pages/writing-workbench/WritingToolsPanel.tsx` |
| 废弃 | `pages/writing-workbench/WorkbenchWritingActions.tsx`（顶部写作按钮） |
