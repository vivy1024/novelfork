**版本**: v3.0.0
**创建日期**: 2026-06-25
**更新日期**: 2026-06-25
**状态**: current
**文档类型**: current

# 叙事回写流程

## 目标

叙事回写负责把写作动作产生的动态事实变更写入叙事记忆。

## 推荐流程

```text
写作或修订完成
  → 提取 NarrativeEvent
  → 校验事件风险
  → 低风险自动应用
  → 高风险进入 pending
  → 用户或审计确认
  → 更新叙事记忆
```

## 应回写的内容

- 新发生的事件
- 角色状态变化
- 关系变化
- 伏笔变化
- 时间线变化
- 冲突状态变化

## 不应回写的内容

- 纯文风变化
- 纯表达差异
- 未被用户采纳的版本
- 静态设定修改建议

## 设计原则

1. LLM 只提出候选事件
2. reducer 决定事件应用方式
3. 高风险事实必须 pending
4. 回写结果必须可诊断

## 相关代码

- `packages/novel-plugin/src/engine/narrative-memory/events.ts`：`createNarrativeEvent()` 按事件类型、layer、confidence 生成 risk/status。
- `packages/novel-plugin/src/engine/narrative-memory/reducer.ts`：`applyNarrativeEvents()` 将可应用事件转为 `narrative_fact`，高风险保持 pending。
- `packages/novel-plugin/src/engine/narrative-memory/storage.ts`：NarrativeEvent / NarrativeFact 持久化。
- `packages/novel-plugin/src/handlers/lore-memory-boundary-handlers.ts`：`memory.read` / `memory.graph` / `memory.events` 工具入口。
- `packages/novel-plugin/src/engine/writing-resource/service.ts`：`applyNarrativeEventsOnAccept()` 让正式章节结算兼容触发 NarrativeEvent 回写。
- `packages/novel-plugin/src/handlers/pipeline-write-service.ts`：写作管线产生/携带结算事件。
- `packages/novel-plugin/src/pages/writing-workbench/NarrativeMemoryPanel.tsx`

## 当前状态

- 旧候选稿接受流程不再是唯一回写入口；正式章节结算和 `memory.events` 工具都能承载回写。
- 高风险 canon/world/relationship 事件保持 pending，经用户或审计确认后再应用。
