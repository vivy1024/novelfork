**版本**: v3.0.0
**创建日期**: 2026-06-26
**更新日期**: 2026-06-26
**状态**: current
**文档类型**: current

# Narrative Memory

## 职责

保存动态叙事事实：事件推进、角色状态、关系变化、地点变化、伏笔状态、时间线和诊断图谱。

## 真实代码路径

- `packages/novel-plugin/src/engine/narrative-memory/`
- `packages/novel-plugin/src/engine/narrative-memory/events.ts`
- `packages/novel-plugin/src/engine/narrative-memory/reducer.ts`
- `packages/novel-plugin/src/engine/narrative-memory/storage.ts`
- `packages/novel-plugin/src/engine/narrative-memory/build-narrative-context.ts`
- `packages/novel-plugin/src/handlers/lore-memory-boundary-handlers.ts`
- `packages/novel-plugin/src/routes/narrative-memory.ts`
- `packages/novel-plugin/src/pages/writing-workbench/NarrativeMemoryPanel.tsx`

## 主要入口

- `handleMemoryRead()`：按 write/revise/audit/outline/diagnose 召回 ContextCard。
- `handleMemoryGraph()`：读取 relationship/timeline/character_arc/foreshadowing/conflict/event_chain/wave 视图。
- `handleMemoryEvents()`：list/create/approve/reject Pending NarrativeEvents。
- `createNarrativeEvent()`：按类型、层级和 confidence 分类 risk/status。
- `applyNarrativeEvents()`：将可应用事件转为 `narrative_fact`，高风险保持 pending。

## 输入 / 输出

- 输入：bookId、purpose、chapterNumber、entities、sceneText、budgetTokens、事件字段。
- 输出：ContextCard 包、动态图谱、Pending Events、Narrative Facts。

## 当前问题

- 高风险 canon/world/relationship 事件必须 pending，不能绕过审核。
- 未被用户采纳的版本不是事实，不应进入记忆。

## 维护规则

1. 动态事实不写经纬。
2. LLM 只提出候选事件；reducer 决定 applied/pending。
3. 正式章节结算或用户确认动作才触发事实回写。
4. 文风/表达偏好进入预设，不进入 Narrative Memory。
