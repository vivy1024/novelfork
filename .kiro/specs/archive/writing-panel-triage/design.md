# 写作面板去向裁决 — Design

## 设计原则

1. **能力不等于面板。** 功能可以保留，但不一定需要独立入口。
2. **上下文工具留在上下文里。** 选段写作、多版本、章节健康等依赖当前章节/选区，不放左侧全局入口。
3. **Narrative Memory 只收记忆。** 诊断、市场、预设、章节写作工具不进入 Narrative Memory。
4. **先裁决，再实现。** 本 spec 只输出去向表，为后续小 spec 提供依据。

---

## 面板裁决总表

| 面板 / 能力 | 裁决 | 后续位置 / 处理 |
|---|---|---|
| `StatCard` 网格 | `merged` | 作为摘要组件，可被总览/诊断页复用 |
| `QualityPanel` | `defer` | 后续作品诊断 spec 的主入口候选 |
| `BookHealthSummary` | `merged` | 合并进作品诊断，不独立 |
| `DailyProgressCard` | `merged/remove` | 弱化为字数/产能摘要；若无价值可废弃独立 UI |
| `CharacterArcsPanel` | `defer` | Narrative Memory / 角色弧线 |
| `StyleDriftPanel` | `defer` | 作品诊断 / 文风诊断 |
| `CompliancePanel` | `defer` | 作品诊断或发布检查 |
| `BeatProgressBar` | `merged` | 章节/总览状态组件，不独立 |
| `SceneSpecPanel` | `contextual-only` | 章节编辑器右侧 companion |
| `ChapterHealthCard` | `contextual-only` | 章节编辑器上下文；摘要可合并进诊断 |
| `AiTasteReport` | `contextual-only/merged` | 单章在编辑器，全书趋势合并进诊断 |
| `InlineWritePanel` | `contextual-only` | 编辑器光标/选区浮层 |
| `VariantsPanel` | `contextual-only` | 章节编辑器 companion / 候选稿工作流 |
| `ForeshadowingBoard` | `defer` | Narrative Memory / 伏笔网络 |
| `JingweiEntryEditor` | `keep-lore` | 经纬 / Lore 条目编辑器 |
| `PresetsPanel` | `defer` | 后续预设/方法 spec |
| `PresetSuggestionCard` | `contextual-only` | 建书后推荐或预设页内卡片 |
| `TemplateMarketPanel` | `defer` | 后续模板市场 spec |
| `ConversationResourcePanel` | `contextual-only` | Agent 对话侧栏资源预览 |

---

## 不需要独立入口的清单

以下能力不再规划为独立全局面板：

```txt
StatCard 网格
DailyProgressCard
BookHealthSummary
ChapterHealthCard
AiTasteReport
BeatProgressBar
PresetSuggestionCard
ConversationResourcePanel
InlineWritePanel
VariantsPanel
```

其中：

- `InlineWritePanel` 与 `VariantsPanel` 是核心写作能力，但不是全局面板。
- `ChapterHealthCard` 与单章 `AiTasteReport` 是章节上下文诊断，不是左侧入口。
- `BookHealthSummary`、`DailyProgressCard`、`StatCard` 是摘要组件，不是工作区。

---

## 后续 spec 拆分建议

### 1. Lore / Narrative Memory 职责拆分

负责：

```txt
CharacterArcsPanel
ForeshadowingBoard
JingweiGraphWorkspace 关系图 / 时间线 / 矛盾地图
CoreShiftPanel defer：由 lore-memory-boundary 判定是否属于动态叙事状态
RuntimeStatePanel defer：由 lore-memory-boundary 拆分叙事状态摘要与开发调试信息
```

输出：图谱类能力迁入 Narrative Memory，经纬只保留静态设定编辑。

### 2. 作品诊断

负责：

```txt
QualityPanel
BookHealthSummary
StyleDriftPanel
CompliancePanel
AlertPanel
AiTasteReport 全书趋势
ChapterHealth 摘要
```

输出：一个清晰的“作品诊断”入口，而不是多个散面板。

### 3. 章节编辑器上下文工具

负责：

```txt
SceneSpecPanel
InlineWritePanel
VariantsPanel
ChapterHealthCard
单章 AiTasteReport
```

输出：打开章节时出现右侧 companion / 底部工具栏 / 内联浮层，不放左侧全局入口。

### 4. 方法、预设与市场

负责：

```txt
PresetsPanel
PresetSuggestionCard
TemplateMarketPanel
MarketRadarPanel / 扫榜
```

输出：预设、套路、模板、市场情报各自有清晰边界，不混入 Narrative Memory。

---

## UI 入口原则

### 允许放 ActivityBar 的入口

ActivityBar 只放稳定、高频、概念清晰的工作区，例如：

```txt
资源
经纬
叙事记忆
诊断（仅在作品诊断 spec 批准后加入）
工具
搜索
```

### 不允许放 ActivityBar 的入口

以下能力不得作为左侧一级入口：

```txt
日更进度
统计卡片
章节健康
AI味单章报告
选段写作
多版本
推荐预设弹窗
对话资源预览
```

这些应出现在：

- 当前章节编辑器
- 当前候选稿工作流
- 建书完成流程
- Agent 对话侧栏
- 作品诊断聚合页

---

## 与 Narrative Memory 的边界

Narrative Memory 可以包含：

```txt
记忆总览
召回 diagnostics
Pending NarrativeEvents
关系图
时间线
角色弧线
伏笔网络
矛盾地图
事件链
```

Narrative Memory 不包含：

```txt
质量诊断
AI 味
文风漂移
平台合规
市场雷达
扫榜
预设市场
选段写作
多版本
章节蓝图
章节健康
```

---

## 与经纬 / Lore 的边界

经纬保留：

```txt
JingweiEntryEditor
静态设定分类树
静态设定编辑表单
作者手动资料维护
```

经纬不保留：

```txt
关系图
时间线
角色弧线
伏笔网络
矛盾地图
动态状态
```

---

## 验证方式

本 spec 本身不实现代码，但后续实现必须用以下验证标准引用本裁决：

1. 左侧全局入口不得出现 `InlineWritePanel`、`VariantsPanel`、`DailyProgressCard`、`BookHealthSummary` 等被裁决为非独立入口的能力。
2. 章节编辑器中仍可访问选段写作、多版本、章节健康等上下文能力。
3. 诊断类能力不得混入 Narrative Memory。
4. 市场雷达 / 预设 / 模板市场不得混入 Narrative Memory。
5. 组件删除前必须证明无可复用逻辑或已有替代入口。
