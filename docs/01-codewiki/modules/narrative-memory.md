**版本**: v3.0.0
**创建日期**: 2026-06-26
**更新日期**: 2026-07-02
**状态**: current
**文档类型**: current

# Narrative Memory

## 职责

保存动态叙事事实：事件推进、角色状态、关系变化、地点变化、伏笔状态、时间线和诊断图谱。

## 真实代码路径

- `packages/novel-plugin/src/engine/narrative-memory/`
- `packages/novel-plugin/src/engine/narrative-memory/events.ts`
- `packages/novel-plugin/src/engine/narrative-memory/chapter-event-extractor.ts`
- `packages/novel-plugin/src/engine/narrative-memory/settlement-risk-gate.ts`
- `packages/novel-plugin/src/engine/narrative-memory/reducer.ts`
- `packages/novel-plugin/src/engine/narrative-memory/storage.ts`
- `packages/novel-plugin/src/engine/narrative-memory/build-narrative-context.ts`
- `packages/novel-plugin/src/handlers/lore-memory-boundary-handlers.ts`
- `packages/novel-plugin/src/handlers/memory-admin-handlers.ts`
- `packages/novel-plugin/src/routes/narrative-memory.ts`
- `packages/novel-plugin/src/pages/writing-workbench/NarrativeMemoryPanel.tsx`

## 主要入口

- `handleMemoryRead()`：按 write/revise/audit/outline/diagnose 召回 ContextCard。
- `handleMemoryGraph()`：读取 relationship/timeline/character_arc/foreshadowing/conflict/event_chain/wave 视图。
- `handleMemoryEvents()`：list/create/approve/reject Pending NarrativeEvents。
- `extractNarrativeEventsFromChapter()`：从正式章节正文抽取动态叙事变化草案，支持 LLM JSON 抽取、结构化标记兜底、schema 校验、正文证据检查和同章去重。
- `decideSettlementRisk()`：将 settlement 草案分流为 low/medium/high，低风险允许 auto apply，中高风险 pending。
- `createNarrativeEvent()`：按类型、层级和 confidence 分类 risk/status。
- `applyNarrativeEvents()`：将可应用事件转为 `narrative_fact`，高风险保持 pending。

## 输入 / 输出

- 输入：bookId、purpose、chapterNumber、entities、sceneText、budgetTokens、事件字段。
- 输出：ContextCard 包、动态图谱、Pending Events、Narrative Facts。

## 管理层工具

Memory Admin Tools 直接面向 Narrative Memory 存储层治理，不改变 `memory.read` / `memory.graph` / `memory.events` 的主链路语义：

- 只读：`memory.list`、`memory.read_entry`、`memory.search`、`memory.dedup`、`memory.export`、`memory.stats`。
- 写删：`memory.update`、`memory.delete`、`memory.bulk_approve`、`memory.bulk_delete`，全部为 `confirmed-write` 风险。
- 范围：可查看 fact/event/log/vector；更新和硬删除仅允许 fact/event，并保留工具调用审计摘要。
- 边界：不新增 HTTP 路由，不引入软删除迁移，不把管理工具放进写作必经链路。

## 当前问题

- 高风险 canon/world/relationship 事件必须 pending，不能绕过审核。
- 未被用户采纳的版本不是事实，不应进入记忆。

## 维护规则

1. 动态事实不写经纬。
2. LLM 只提出候选事件；reducer 决定 applied/pending。
3. 正式章节结算或用户确认动作才触发事实回写；未确认正文、候选稿、手工编辑中间态不进入自动结算。
4. 文风/表达偏好进入预设，不进入 Narrative Memory。
