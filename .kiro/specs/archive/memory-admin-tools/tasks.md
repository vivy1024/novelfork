# Implementation Plan

## Overview

本计划实现 Memory Admin Tools：在不改变 `memory.read` / `memory.graph` / `memory.events` 主链路语义的前提下，新增一组小说域 session tools，用于列出、读取、搜索、更新、删除、去重、导出、统计和批量处理 Narrative Memory 条目。

实现范围严格限定在工具层、handler 层、现有 narrative-memory 存储访问和文档/测试，不新增 HTTP 路由，不新增前端 UI，不引入软删除 schema 迁移。

## Tasks

- [x] 1. ENABLER: 建立 `memory-admin-handlers` 基础结构
  - 新增 `packages/novel-plugin/src/handlers/memory-admin-handlers.ts`。
  - 定义统一输入/输出类型、`ToolResult`、`MemoryEntryKind`、分页/过滤参数和结构化错误 helper。
  - 统一支持 `kind = fact | event | log | vector`，其中写删阶段仅允许 `fact | event`。
  - 复用 `getStorageDatabase()` 与 `ensureNarrativeMemorySchema()`。
  - 验证：新增基础单测文件能初始化临时 storage，并插入 fact/event/log/vector fixture。

- [x] 2. FEATURE: 实现只读条目枚举 `memory.list`
  - 在 `memory-admin-handlers.ts` 实现 `handleMemoryList`。
  - 支持 `bookId`、`kind`、`status`、`layer`、`category`、`chapterRange`、`query`、`limit`、`offset`。
  - 返回统一摘要条目：`kind`、`id`、`title/summary`、`status/layer/category`、`chapterNumber/sourceChapter`、`updatedAt/createdAt`。
  - 查询范围覆盖 facts、events、retrieval logs、context vectors 的摘要/元数据。
  - 验证：list 能按 kind/status/layer/category/chapterRange 分页过滤，且不会跨 bookId 泄漏。

- [x] 3. FEATURE: 实现单条读取 `memory.read_entry`
  - 实现 `handleMemoryReadEntry`。
  - 输入要求 `bookId + kind + id`。
  - 返回单条完整对象，并确认对象属于指定 bookId。
  - 对不存在条目返回 `not-found`。
  - 验证：能读取 fact/event/log/vector；跨书籍 id 不可读。

- [x] 4. FEATURE: 实现搜索 `memory.search`
  - 实现 `handleMemorySearch`。
  - 对 facts 搜索 `subject/predicate/object/category/layer/evidenceText`。
  - 对 events 搜索 `eventType/subject/predicate/object/evidenceText/status/source/riskLevel`。
  - 对 logs 搜索 `purpose/diagnostics_json` 摘要。
  - 对 vectors 搜索 `cardId/embeddingModelId/sourceCardJson` 元数据。
  - 返回 `matchedFields` 与 `matchReason`，不做新 embedding 计算。
  - 验证：关键词搜索能命中事实、事件、日志、向量元数据，并支持 kind 限定。

- [x] 5. FEATURE: 实现统计 `memory.stats`
  - 实现 `handleMemoryStats`。
  - 返回按 kind 的总数、event status 分布、fact layer/category 分布、最近更新时间、pending 数量、基础重复风险计数。
  - 不修改数据。
  - 验证：fixture 下统计结果精确匹配。

- [x] 6. FEATURE: 实现导出 `memory.export`
  - 实现 `handleMemoryExport`。
  - 默认输出 JSON 结构，覆盖 facts、events、retrievalLogs、contextVectors metadata。
  - 支持 `kind` 过滤；format 先支持 `json`，其它 format 返回 unsupported-format。
  - 不导出向量完整大数组，默认只导出 vector metadata 和 sourceCard 摘要，避免工具结果膨胀。
  - 验证：导出结构完整、可按 kind 过滤、不会输出跨书籍数据。

- [x] 7. FEATURE: 实现去重候选 `memory.dedup`
  - 实现 `handleMemoryDedup`。
  - facts 使用标准化签名：`subject + predicate + object + category + layer`。
  - events 使用标准化签名：`eventType + subject + predicate + object + status`。
  - 返回重复候选组，不执行删除。
  - 支持 `kind` 和 `limit`。
  - 验证：重复 fixture 能产生候选组，非重复数据不误报为删除结果。

- [x] 8. FEATURE: 实现受控更新 `memory.update`
  - 实现 `handleMemoryUpdate`。
  - 仅支持 `kind=fact|event`。
  - fact 允许更新 subject/predicate/object/category/layer/confidence/sourceId/sourceChapter/evidenceText/validFromChapter/validUntilChapter。
  - event 允许更新 chapterNumber/eventType/subject/predicate/object/evidenceText/confidence/source/riskLevel；禁止直接更新 status/appliedAt，状态流转走 memory.events 或 memory.bulk_approve。
  - log/vector 返回 forbidden 或 unsupported-kind。
  - 更新前确认目标存在且属于 bookId；更新后返回完整对象和审计摘要。
  - 验证：fact/event 可更新；log/vector 被拒绝；非法 patch 字段被拒绝。

- [x] 9. FEATURE: 实现受控硬删除 `memory.delete`
  - 实现 `handleMemoryDelete`。
  - 仅支持 `kind=fact|event`。
  - 输入必须包含 `reason`。
  - 删除前读取目标并确认 bookId；删除后返回 deleted id、kind、reason 与原摘要。
  - log/vector 删除请求返回 forbidden。
  - 验证：fact/event 可删除且后续读不到；跨书籍删除失败；缺 reason 失败。

- [x] 10. FEATURE: 实现批量批准 `memory.bulk_approve`
  - 实现 `handleMemoryBulkApprove`。
  - 支持 `eventIds` 或显式 filter；只处理 `status=pending` 的事件。
  - 对每个 pending event 复用 `applyNarrativeEvents` / `updateNarrativeEventStatus` 的既有审批语义。
  - 返回 `approved`、`failed`、`skipped` 明细。
  - 对非 pending 事件跳过并说明原因。
  - 验证：批量批准 pending events 会写入 facts；已 applied/rejected 被跳过；部分失败不吞没其它结果。

- [x] 11. FEATURE: 实现批量删除 `memory.bulk_delete`
  - 实现 `handleMemoryBulkDelete`。
  - 仅支持 `kind=fact|event`。
  - 必须包含显式 filter 和 `reason`；空 filter 拒绝。
  - 执行前先枚举候选并应用 `limit` 上限。
  - 返回 deleted/failed/skipped 明细。
  - 验证：按 status/layer/category/chapterRange 删除目标集合；空 filter、log/vector、超 limit 请求均被拒绝。

- [x] 12. ENABLER: 在工具 schema 中声明新工具
  - 修改 `packages/novel-plugin/src/tool-schemas.ts`。
  - 为 10 个新工具添加严格 JSON schema，`additionalProperties: false`。
  - 明确 `bookId`、`kind`、`id`、`reason`、`filter`、`limit`、`offset`、`patch`、`format` 等字段。
  - 验证：schema 单测或 executor validation 能拒绝多余字段和缺失字段。

- [x] 13. ENABLER: 注册新工具并设置风险级别
  - 修改 `packages/novel-plugin/src/handlers/tool-registry.ts`。
  - 注册 `memory.list/read_entry/search/dedup/export/stats` 为 read 风险。
  - 注册 `memory.update/delete/bulk_approve/bulk_delete` 为 confirmed-write 风险。
  - 工具描述明确“管理层能力”，不得替代 `memory.read` 的写作召回语义。
  - 更新 `packages/novel-plugin/src/handlers/tool-registry.test.ts`。
  - 验证：新工具都出现在 registry；原 `memory.read/graph/events` 描述不被改坏。

- [x] 14. ENABLER: 接入 handler registry 与 Studio executor
  - 修改 `packages/novel-plugin/src/handler-registry.ts`，为新工具添加 direct handler 声明。
  - 修改 `packages/studio/src/api/lib/session-tool-executor.ts`，新增 10 个 case，动态 import `memory-admin-handlers`。
  - 不新增 HTTP 路由。
  - 验证：`session-tool-executor.test.ts` 能确认新工具可分发，confirmed-write 工具走现有确认门禁。

- [x] 15. GUARD: 保护现有 memory 主链路不回归
  - 更新或新增 `lore-memory-boundary-handlers.test.ts` 断言：`memory.read` 仍只做 ContextCard 召回，`memory.graph` 只读，`memory.events` 仍支持 list/create/approve/reject。
  - 确认新增管理工具没有把 `memory.events` 变成 CRUD。
  - 验证：原有 lore/memory boundary 测试全部通过。

- [x] 16. DOCS: 更新工具文档和学习文档
  - 更新 `docs/01-codewiki/api/agent-tools.md`，加入管理层工具表。
  - 更新 `docs/01-codewiki/modules/narrative-memory.md`，说明主链路工具与管理工具的区别。
  - 更新 `docs/03-产品与流程/01-小说创作流程.md` 或相关 learning 文档，避免把管理工具写成写作必经链路。
  - 验证：`pnpm docs:verify` 与 `pnpm docs:drift` 通过。

- [x] 17. GUARD: 全量验证
  - 运行与本功能相关的单测：novel-plugin handler/tool-registry 测试、studio session-tool-registry/executor 测试。
  - 运行 `pnpm typecheck`。
  - 如改了文档，运行 `pnpm docs:verify` 与 `pnpm docs:drift`。
  - 记录验证输出；本 spec 不新增前端 UI，因此无需 Browser 截图。

- [x] 18. FEATURE-CLOSURE: 完成能力闭环验收
  - 用测试或最小工具调用 fixture 证明以下能力可用：list、read_entry、search、update、delete、dedup、export、stats、bulk_approve、bulk_delete。
  - 证明 `memory.read/graph/events` 原行为仍通过测试。
  - 确认未新增 HTTP 路由、未引入软删除迁移、未重写前端 UI。
  - 满足后再声明 Memory Admin Tools 完成。
