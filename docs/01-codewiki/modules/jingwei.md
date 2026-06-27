**版本**: v3.0.0
**创建日期**: 2026-06-26
**更新日期**: 2026-06-26
**状态**: current
**文档类型**: current

# Jingwei / Lore

## 职责

经纬是静态 Lore 层，保存作者明确维护的人物、地点、势力、规则、术语和备注。

## 真实代码路径

- `packages/novel-plugin/src/engine/jingwei/`
- `packages/novel-plugin/src/routes/jingwei.ts`
- `packages/novel-plugin/src/handlers/jingwei-read-unified.ts`
- `packages/novel-plugin/src/handlers/jingwei-write-handler.ts`
- `packages/novel-plugin/src/handlers/jingwei-audit-handler.ts`
- `packages/novel-plugin/src/handlers/lore-memory-boundary-handlers.ts`

## 主要入口

- `handleJingweiRead()` / `handleLoreRead()`：读取静态 Lore。
- `handleJingweiWrite()` / `handleLoreWrite()`：在作者意图明确时写入静态 Lore。
- `handleJingweiAudit()`：检查 active + confirmed + participates_in_ai + visibility 门禁。

## 输入 / 输出

- 输入：bookId、section/category、entryIds、chapterNumber、查询范围。
- 输出：经纬条目、读取门禁 findings、Lore 上下文。

## 当前问题

- 旧 accept 流程仍保留 `jingweiDelta` 兼容，但不应再作为动态事实主入口。
- 动态关系、时间线、伏笔进展应进入 Narrative Memory。

## 维护规则

1. 经纬只保存静态参考。
2. 写作过程中的事实变化不要直接覆盖经纬。
3. canon/rules 条目不能被自动 delta 覆盖。
4. Agent 可读经纬，但写经纬必须有明确作者意图。
