**版本**: v3.0.0
**创建日期**: 2026-06-26
**更新日期**: 2026-06-27
**状态**: current
**文档类型**: current

# Agent Tools

## 真实代码路径

- `packages/novel-plugin/src/handlers/tool-registry.ts`
- `packages/novel-plugin/src/tool-schemas.ts`
- `packages/studio/src/api/lib/session-tool-registry.ts`
- `packages/studio/src/api/lib/session-tool-executor.ts`

## 工具边界

| 工具 | 归属 | 语义 |
|------|------|------|
| `lore.read` / `lore.write` | 静态层 | 经纬/Lore 读取和作者意图明确的写入 |
| `memory.read` | 动态层 | 写作/修订/审计前召回 ContextCard |
| `memory.graph` | 动态层 | 读取动态图谱视图 |
| `memory.events` | 动态层 | 管理 Pending NarrativeEvents |
| `memory.list` / `memory.read_entry` / `memory.search` / `memory.dedup` / `memory.export` / `memory.stats` | 动态管理层 | 只读枚举、读取、搜索、去重候选、导出和统计 Narrative Memory 存储条目 |
| `memory.update` / `memory.delete` / `memory.bulk_approve` / `memory.bulk_delete` | 动态管理层 | 受确认门禁保护的管理操作，仅面向 fact/event 治理，不替代 `memory.read` 写作召回 |
| `style.import` | 配置层 | 生成待确认的写作预设建议 |
| `pipeline.write` | 结果层 | 写作管线入口，稳定结果进入正式章节/结算流程 |
| `candidate.create_chapter` | deprecated | 不再作为 executor 主入口 |

## Memory Admin Tools

| 工具 | 风险级别 | 用途 |
|------|----------|------|
| `memory.list` | read | 按 bookId/kind/status/layer/category/chapterRange/query 分页列出 fact/event/log/vector 摘要。 |
| `memory.read_entry` | read | 读取指定 `bookId + kind + id` 的完整条目。 |
| `memory.search` | read | 对 fact/event/log/vector 元数据做关键词搜索，并返回 matchedFields。 |
| `memory.dedup` | read | 只返回 fact/event 重复候选组，不自动删除。 |
| `memory.export` | read | 以 JSON 导出当前书籍的叙事记忆管理快照，向量只导出 metadata/sourceCard 摘要。 |
| `memory.stats` | read | 统计总数、分布、pending 数量、最近更新时间和基础重复风险。 |
| `memory.update` | confirmed-write | 受控更新 fact/event 白名单字段，要求 reason。 |
| `memory.delete` | confirmed-write | 受控硬删除 fact/event，要求 reason，并返回审计摘要。 |
| `memory.bulk_approve` | confirmed-write | 批量批准 pending NarrativeEvents，复用既有 reducer/apply 语义。 |
| `memory.bulk_delete` | confirmed-write | 显式 filter + reason 批量硬删除 fact/event。 |

这些工具是治理与诊断用管理层能力，不属于写作主链路；写作、修订、审计前仍使用 `memory.read` 召回 ContextCard，动态图谱仍使用 `memory.graph`，事件候选与审批主链路仍使用 `memory.events`。

## 维护规则

1. 工具输出只能进入正式章节、多版本、预设建议或 NarrativeEvent。
2. 工具注册描述必须避免“候选稿/草稿主流程”。
3. 旧工具如果保留，必须标记 deprecated 或返回兼容错误。
4. Memory Admin Tools 必须保持薄工具、厚服务；读工具默认无副作用，写删工具必须走 confirmed-write 门禁。
