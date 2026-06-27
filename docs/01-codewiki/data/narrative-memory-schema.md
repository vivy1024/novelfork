**版本**: v3.0.0
**创建日期**: 2026-06-26
**更新日期**: 2026-06-26
**状态**: current
**文档类型**: current

# Narrative Memory Schema

## 真实代码路径

- `packages/novel-plugin/src/engine/narrative-memory/types.ts`
- `packages/novel-plugin/src/engine/narrative-memory/storage.ts`
- `packages/novel-plugin/src/engine/narrative-memory/events.ts`
- `packages/novel-plugin/src/engine/narrative-memory/facts.ts`
- `packages/novel-plugin/src/engine/narrative-memory/reducer.ts`

## 核心对象

| 对象 | 语义 |
|------|------|
| `NarrativeEvent` | 写作/修订产生的动态事实候选或已应用事件 |
| `NarrativeFact` | reducer 应用后的动态事实 |
| `ContextCard` | 召回给写作/修订/审计的上下文卡片 |
| diagnostics | 召回预算、去重、通道权重等诊断 |

## 风险规则

- `world_fact_introduced` / canon layer：high risk，pending。
- `relationship_changed`：high risk，pending。
- confidence < 0.6：pending。
- location/timeline/hook progress 等低风险事件可自动 applied。

## 维护规则

1. 事件先入 NarrativeEvent，再由 reducer 应用为 fact。
2. 高风险事件不能直接写入 fact。
3. 动态事实不写经纬。
