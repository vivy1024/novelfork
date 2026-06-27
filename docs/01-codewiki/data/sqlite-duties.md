**版本**: v3.0.0
**创建日期**: 2026-06-26
**更新日期**: 2026-06-26
**状态**: current
**文档类型**: current

# SQLite 剩余职责

## 职责

SQLite 继续承担运行时状态、索引、诊断日志、Narrative Memory、经纬和会话数据，不作为正式章节正文双主存储。

## 真实代码路径

- `packages/core/src/storage/schema.ts`
- `packages/core/src/storage/migrations/`
- `packages/core/src/storage/db.ts`
- `packages/novel-plugin/src/engine/narrative-memory/storage.ts`
- `packages/novel-plugin/src/engine/jingwei/`
- `packages/studio/src/api/lib/session-chat-service.ts`

## 可保留职责

- Agent 会话、消息、工具结果。
- 经纬 section/entry/relationship 等静态 Lore 数据。
- NarrativeEvent / NarrativeFact / ContextCard 相关动态记忆数据。
- 搜索索引、诊断、设置、运行时状态。

## 不应承担

- 正式章节正文主语义。
- candidate/draft 中心化生命周期。
- 与文件系统并列的章节双主存储。
