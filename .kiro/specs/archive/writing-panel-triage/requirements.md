# 写作面板去向裁决 — Requirements

## 背景

归档 spec `archive/cockpit-panel-layout` 曾提出“15 个孤儿面板全部归位”。随着 IDE 工作台、Narrative Memory、经纬/Lore 职责拆分逐步形成，继续机械恢复 15 个独立面板会造成 UI 入口膨胀和职责混乱。

本 spec 目标不是“恢复 15 个面板”，而是：

> 对 `archive/cockpit-panel-layout` 提到的孤儿面板逐项裁决：哪些保留为独立入口，哪些合并，哪些只保留为上下文组件，哪些删除或弱化。

本 spec 只做面板去向与入口策略，不实现 Lore / Narrative Memory 迁移，不恢复市场雷达，不重构写作工具协议。

---

## R1：面板去向必须按产品职责裁决

1. 每个历史孤儿面板 SHALL 被标记为以下去向之一：
   - `independent-entry`：保留为独立入口。
   - `merged`：能力合并到其他面板。
   - `contextual-only`：只在特定上下文出现，不放全局入口。
   - `defer`：暂不处理，另立 spec。
   - `remove`：删除或废弃独立能力。
2. 裁决 SHALL 基于用户场景，而不是基于已有组件是否存在。
3. 入口数量 SHALL 尽量减少，功能能力可以保留但不一定保留独立面板。
4. 不得把所有工具塞进 Narrative Memory；Narrative Memory 只接收动态记忆相关面板。

---

## R2：不需要独立入口的面板

以下面板 / 能力 SHALL NOT 保留为独立全局面板入口：

| 面板 / 能力 | 裁决 | 原因 |
|---|---|---|
| `StatCard` 网格 | `merged` | 是摘要展示，不是工具面板 |
| `DailyProgressCard` | `merged` 或 `remove` | 日更字数是旧人工作者模式遗留，不适合作为 AI 写作核心面板 |
| `BookHealthSummary` | `merged` | 与质量/健康诊断重叠 |
| `ChapterHealthCard` | `contextual-only` | 只在打开章节时有意义 |
| `AiTasteReport` | `contextual-only` / `merged` | 单章报告放章节上下文，全书趋势放诊断，不做独立入口 |
| `BeatProgressBar` | `merged` | 节拍是状态组件，不是独立工作区 |
| `PresetSuggestionCard` | `contextual-only` | 建书完成后的推荐卡，不是常驻面板 |
| `ConversationResourcePanel` | `contextual-only` | 属于 Agent 对话侧栏资源预览，不属于写作面板收口 |
| `InlineWritePanel` | `contextual-only` | 依赖光标/选区，只应作为编辑器内联工具 |
| `VariantsPanel` | `contextual-only` | 依赖当前章节/候选稿，只应作为章节编辑器或候选稿工作流 companion |

这些能力可以继续存在，但 SHALL NOT 出现在 IDE 左侧全局面板清单中。

---

## R3：动态记忆相关面板交给 Narrative Memory spec

以下能力与动态叙事记忆直接相关，本 spec 只记录去向，实际迁移由 `lore-memory-boundary` 或后续 Narrative Memory 任务负责：

| 面板 / 能力 | 裁决 | 目标位置 |
|---|---|---|
| `CharacterArcsPanel` | `defer` | Narrative Memory / 角色弧线 |
| `ForeshadowingBoard` | `defer` | Narrative Memory / 伏笔网络 |
| `JingweiGraphWorkspace` 关系图 | `defer` | Narrative Memory / 关系图 |
| `JingweiGraphWorkspace` 时间线 | `defer` | Narrative Memory / 时间线 |
| `JingweiGraphWorkspace` 矛盾地图 | `defer` | Narrative Memory / 矛盾地图 |
| `CoreShiftPanel` | `defer` | 需判定是否属于动态叙事状态 |
| `RuntimeStatePanel` | `defer` | 需拆分为叙事状态摘要与开发调试信息 |

---

## R4：诊断类面板另立作品诊断 spec

以下能力不属于 Narrative Memory，也不属于 Lore 拆分。本 spec 只裁决为“诊断类”，后续应另立作品诊断 spec：

| 面板 / 能力 | 裁决 | 说明 |
|---|---|---|
| `QualityPanel` | `defer` | 作品诊断主入口候选 |
| `BookHealthSummary` | `merged` | 合并进作品诊断 |
| `StyleDriftPanel` | `defer` | 文风诊断，合入作品诊断 |
| `CompliancePanel` | `defer` | 发布/平台合规诊断，合入作品诊断或发布检查 |
| `AlertPanel` | `defer` | 警告聚合，合入作品诊断 |
| `AiTasteReport` 全书趋势 | `merged` | 合入作品诊断 |
| `ChapterHealthCard` 摘要 | `merged` | 全书/章节摘要合入作品诊断，卡片留章节上下文 |

---

## R5：章节上下文工具不做全局面板

以下能力 SHALL 留在章节编辑器上下文，不做 IDE 左侧全局入口：

| 面板 / 能力 | 位置 |
|---|---|
| `SceneSpecPanel` | 章节编辑器右侧 companion |
| `InlineWritePanel` | 编辑器光标/选区内联浮层 |
| `VariantsPanel` | 章节编辑器右侧 companion 或候选稿工作流 |
| `ChapterHealthCard` | 章节编辑器底部/侧边工具 |
| 单章 `AiTasteReport` | 章节编辑器底部/侧边工具 |

这些能力可以在命令面板中有命令，但命令执行时必须要求当前章节上下文。

---

## R6：方法、预设、市场类另立 spec

以下能力不属于 Narrative Memory，不属于作品诊断，不属于章节上下文工具。本 spec 只记录为后续“方法与市场”方向：

| 面板 / 能力 | 裁决 |
|---|---|
| `PresetsPanel` | `defer`，后续预设/方法 spec |
| `PresetSuggestionCard` | `contextual-only`，建书完成后或预设页内展示 |
| `TemplateMarketPanel` | `defer`，后续模板市场 spec |
| 市场雷达 / 扫榜 | `defer`，后续 market-radar spec |

---

## R7：裁决表必须成为后续实现依据

1. 后续 spec 或 tasks 引用 archive 15 面板时 SHALL 引用本裁决表。
2. 已裁决为 `contextual-only` 的面板 SHALL NOT 再被加入 IDE 左侧全局入口，除非新 spec 明确推翻本裁决。
3. 已裁决为 `merged` 的面板 SHALL 优先复用其内部组件或数据逻辑，而不是恢复独立 UI。
4. 已裁决为 `defer` 的能力 SHALL 单独立 spec，不得混入 Narrative Memory。

---

## Non-Goals

本 spec 不做以下事项：

- 不实现 UI 迁移。
- 不恢复市场雷达 / 扫榜。
- 不整合作品诊断。
- 不改造章节编辑器。
- 不修改工具定义或 Agent prompt。
- 不删除任何组件文件。

---

## Success Criteria

1. archive 15 面板及附带面板均有明确去向。
2. 用户能知道哪些面板不需要独立入口。
3. Narrative Memory 不再被错误规划为诊断、市场、章节工具的收纳区。
4. 后续实现可以按本裁决拆成多个小 spec，而不是一个大杂烩。
