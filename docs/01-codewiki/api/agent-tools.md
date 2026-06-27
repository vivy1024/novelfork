**版本**: v3.0.0
**创建日期**: 2026-06-26
**更新日期**: 2026-06-26
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
| `style.import` | 配置层 | 生成待确认的写作预设建议 |
| `pipeline.write` | 结果层 | 写作管线入口，稳定结果进入正式章节/结算流程 |
| `candidate.create_chapter` | deprecated | 不再作为 executor 主入口 |

## 维护规则

1. 工具输出只能进入正式章节、多版本、预设建议或 NarrativeEvent。
2. 工具注册描述必须避免“候选稿/草稿主流程”。
3. 旧工具如果保留，必须标记 deprecated 或返回兼容错误。
