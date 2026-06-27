# Memory Admin Tools — Requirements

## 背景

NovelFork 当前的动态记忆体系已经分成两层：

- **Narrative Memory 主链路**：`memory.read` / `memory.graph` / `memory.events`，用于写作前召回、图谱查看和 Pending NarrativeEvents 审批。
- **存储层**：`narrative_fact`、`narrative_event`、`narrative_retrieval_log`、`narrative_context_vector`，用于记录动态事实、待确认事件、检索日志和向量元数据。

现有体系已经能满足写作链路，但缺少一组面向管理与运维的工具：

- 无法按书籍或条件列出全部记忆条目。
- 无法读取单条事实/事件的完整内容。
- 无法搜索、统计、导出和去重记忆。
- 无法批量批准或批量清理 pending events。
- 无法对事实和事件执行受控更新/删除。

本 spec 目标是在**不改变现有三件套主链路语义**的前提下，补齐一组 `memory.*` 管理工具，让系统具备完整的记忆管理能力。

本 spec 不要求新增 HTTP 路由，不要求重写前端主 UI，不要求引入软删除 schema 迁移。

---

## R1：新增一组 memory 管理工具

1. 系统 SHALL 新增 `memory.list`、`memory.read_entry`、`memory.search`、`memory.update`、`memory.delete`、`memory.dedup`、`memory.export`、`memory.stats`、`memory.bulk_approve`、`memory.bulk_delete`。
2. 这些工具 SHALL 与现有 `memory.read`、`memory.graph`、`memory.events` 共存，不得破坏现有写作链路。
3. 新工具 SHALL 作为管理层能力，面向书籍记忆的查询、维护、批处理和导出。
4. 新工具 SHALL 仅在小说域工具体系内注册，不得扩展为通用 Studio HTTP API。

---

## R2：工具语义必须明确分层

1. `memory.read` SHALL 继续承担 ContextCard 召回，不得被改造成列表/CRUD 入口。
2. `memory.graph` SHALL 继续承担关系图/时间线/弧线/事件链读取，不得加入写操作。
3. `memory.events` SHALL 继续承担 Pending NarrativeEvents 的 list/create/approve/reject，不得合并为全能 CRUD。
4. `memory.list` SHALL 用于列出指定书籍下的记忆条目。
5. `memory.read_entry` SHALL 用于读取单条记忆条目的完整内容。
6. `memory.search` SHALL 用于跨事实、事件、日志、向量元数据的条件搜索。
7. `memory.stats` SHALL 用于返回记忆条目数量、状态分布、最近更新时间、pending 数量等统计信息。

---

## R3：支持受控更新与删除

1. `memory.update` SHALL 允许对单条 `narrative_fact` 或 `narrative_event` 进行受控修改。
2. `memory.delete` SHALL 允许对单条 `narrative_fact` 或 `narrative_event` 进行硬删除。
3. `memory.update` / `memory.delete` SHALL 默认拒绝修改 `narrative_retrieval_log` 和 `narrative_context_vector`。
4. `memory.update` / `memory.delete` SHALL 要求显式目标类型与 id，避免误改不同表。
5. 删除行为 SHALL 保留审计可追溯性：事件状态变更、执行结果和原因必须在返回结果中说明。
6. 本 spec 阶段 SHALL 不引入 `deleted_at` 软删除迁移；对事实和事件采用现有 schema 上的直接更新/删除策略。

---

## R4：批处理能力

1. `memory.bulk_approve` SHALL 仅允许批准 `status = pending` 的事件。
2. `memory.bulk_delete` SHALL 仅允许对显式筛选出的事实/事件集合执行删除。
3. 批处理工具 SHALL 需要清晰的过滤条件，避免对全库执行隐式破坏操作。
4. 批处理工具 SHALL 返回成功项、失败项、跳过项和原因。
5. 批处理工具 SHALL 对超大结果集进行限制或分页，避免一次性误操作。

---

## R5：去重、导出与统计

1. `memory.dedup` SHALL 识别同书籍范围内的重复或高度相似记忆候选。
2. `memory.dedup` SHALL 返回候选重复组，而不是自动删除。
3. `memory.export` SHALL 导出指定书籍的记忆数据为可读结构化结果。
4. `memory.export` SHALL 至少覆盖 facts、events、retrieval logs、context vectors 的摘要/元数据。
5. `memory.stats` SHALL 返回按类型、状态、层级、时间范围的统计信息。
6. 这些工具 SHALL 默认只读，除非其语义明确是批量批准或删除。

---

## R6：错误与安全约束

1. 所有管理工具 SHALL 校验 `bookId` 或等价作用域参数。
2. 所有管理工具 SHALL 在参数缺失、类型不匹配或目标不存在时返回结构化错误。
3. `memory.update`、`memory.delete`、`memory.bulk_approve`、`memory.bulk_delete` SHALL 采用 confirmed-write 风险级别或等价安全门禁。
4. 工具 SHALL 明确拒绝对 `narrative_retrieval_log` 和 `narrative_context_vector` 的写删除操作，除非后续 spec 显式放开。
5. 工具描述 SHALL 避免把管理层能力伪装成写作链路的一部分。

---

## R7：兼容性与边界

1. 现有 `memory.read` / `memory.graph` / `memory.events` SHALL 保持输入输出语义稳定。
2. 现有 `jingwei.read` / `jingwei.write` 静态 Lore 边界 SHALL 不被新工具破坏。
3. 新工具 SHALL 只在小说域工具注册表与 executor 中加入，不新增独立公开 HTTP 端点。
4. 新工具 SHALL 与现有 docs / learn 文档中的静态 Lore vs 动态 Narrative Memory 边界保持一致。
5. 本 spec SHALL 不要求前端新增专门管理面板；仅要求工具层与后端执行层完成。

---

## Non-Goals

本 spec 不做以下事项：

- 不新增 HTTP 路由。
- 不重写 Narrative Memory 主 UI。
- 不把 `memory.events` 改成全能 CRUD。
- 不引入软删除 schema 迁移。
- 不重构 `narrative_fact` / `narrative_event` 的基础存储模型。
- 不把管理工具扩展到通用 Studio 工具箱。

---

## Success Criteria

1. 能通过工具列出、读取、搜索、更新、删除单条事实/事件。
2. 能批量批准 pending events。
3. 能批量删除显式筛选的事实/事件。
4. 能去重、导出、统计书籍记忆。
5. 现有写作链路不受影响，`memory.read` / `memory.graph` / `memory.events` 仍按原语义工作。
6. 新工具在注册表、executor、handler、测试和文档中都能被清晰发现。
