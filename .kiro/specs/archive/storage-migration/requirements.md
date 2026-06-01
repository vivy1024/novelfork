# Requirements Document

## Introduction

本 spec 将 NovelFork 的会话与消息持久化从当前的 **JSON 文件 + Promise 队列串行写入** 迁移为 **SQLite + drizzle ORM**，作为后续所有业务功能（novel-bible-v1 / ai-taste-filter-v1 / template-market 等）的统一底座。

当前实现（见 `packages/studio/src/api/lib/session-service.ts` 和 `session-history-store.ts`）：

- `sessions.json` 全量读写所有 session 记录
- 每会话 `session-history/<sessionId>.json` 存全量消息列表
- 写入通过进程内 Promise 队列串行化
- 缺点：并发下串行瓶颈、崩溃半写风险、多表 join 不可行、分析查询难写、未来给 Bible/章节/设定等新实体扩展会把 JSON 碎片化成几十类文件

迁移目标：

- 接入 SQLite（本地文件）+ drizzle ORM
- 保留现有对外协议：`NarratorSessionChatSnapshot` / `NarratorSessionChatHistory` / `NarratorSessionChatMessage` / `resetRequired` / `sinceSeq` / `MAX_SESSION_MESSAGES=50` 语义不变
- 提供 `session` / `session_message` / `session_message_cursor` / `kv_store` 的最小起步 schema，为后续 Bible 等实体预留扩展位
- 提供从 JSON 文件 **一次性迁移 + 幂等重跑** 的启动自检路径
- 所有现有测试继续通过，无行为差异

## Requirements

### Requirement 1：SQLite 数据库接入与生命周期

**User Story：** 作为维护者，我希望 NovelFork 启动时自动初始化 SQLite 数据库、执行 migration，并在进程退出时干净关闭，这样底层存储不会因为意外重启或半写陷入损坏。

#### Acceptance Criteria

1. WHEN NovelFork Studio 启动时 THEN THE SYSTEM SHALL 在 `resolveRuntimeStorageDir()` 下创建或打开 `novelfork.db` SQLite 文件。
2. WHEN 数据库首次创建时 THEN THE SYSTEM SHALL 执行 migrations 目录下所有未应用的 SQL migration 并在 `drizzle_migrations` 表中记录版本号。
3. WHEN `NOVELFORK_SESSION_STORE_DIR` 环境变量被设置时 THEN THE SYSTEM SHALL 在该目录下创建 `novelfork.db`，与 JSON 路径覆盖语义一致。
4. WHEN NovelFork 进程收到 SIGTERM / 正常退出时 THEN THE SYSTEM SHALL 完成所有挂起写入后关闭 SQLite 连接，避免 WAL 文件残留未回收。
5. WHEN migration 执行失败时 THEN THE SYSTEM SHALL 抛出明确错误并阻止 Studio 启动，不得静默回退到 JSON。

### Requirement 2：Session / Message schema 最小起步

**User Story：** 作为底层设计者，我希望第一版 schema 只覆盖当前已用到的字段，避免过早引入 Bible / 章节等未实现实体，降低 migration 复杂度。

#### Acceptance Criteria

1. WHEN 设计 schema 时 THEN THE SYSTEM SHALL 仅包含以下表：`session`、`session_message`、`session_message_cursor`、`kv_store`、`drizzle_migrations`。
2. WHEN `session` 表被设计时 THEN THE SYSTEM SHALL 至少包含：`id TEXT PRIMARY KEY`、`created_at`、`updated_at`、`message_count`、`config_json`、`metadata_json`，字段名与 `NarratorSessionRecord` 对齐。
3. WHEN `session_message` 表被设计时 THEN THE SYSTEM SHALL 至少包含：`session_id`、`seq INTEGER`、`id TEXT`、`role`、`content`、`timestamp`，并建立 `(session_id, seq)` 唯一索引。
4. WHEN 写入消息时 THEN THE SYSTEM SHALL 保证同一 session 下 `seq` 严格单调递增，不允许空洞。
5. WHEN 读取最近消息时 THEN THE SYSTEM SHALL 支持按 `session_id` + `seq DESC` 取前 N 条（默认 50）且 O(log n) 复杂度。

### Requirement 3：兼容现有 session-chat-service 协议

**User Story：** 作为上层调用方（ChatWindow / session-chat-service），我希望迁移后所有 snapshot / state / history / ack 协议语义不变，这样前端代码零改动。

#### Acceptance Criteria

1. WHEN `getSessionChatSnapshot(sessionId)` 被调用时 THEN THE SYSTEM SHALL 返回与当前 JSON 实现完全等价的 `NarratorSessionChatSnapshot`，包含 `session` / `messages`（最近 50 条）/ `cursor`。
2. WHEN `getSessionChatHistory(sessionId, sinceSeq)` 被调用时 THEN THE SYSTEM SHALL 正确计算 `availableFromSeq` / `resetRequired`，语义与 JSON 实现一致。
3. WHEN `appendSessionChatHistory` 被调用时 THEN THE SYSTEM SHALL 在单个事务内写入消息并更新 `session.message_count` 与 `session.updated_at`。
4. WHEN `replaceSessionChatState` 被调用时 THEN THE SYSTEM SHALL 在事务内清空并重写该 session 的 `session_message` 行，并广播 `server-reset` 信号（上层逻辑不变）。
5. WHEN `deleteSessionChatHistory` 被调用时 THEN THE SYSTEM SHALL 删除该 session 的所有 `session_message` 行；`markSessionChatHistoryDeleted` 的进程内标记行为保留。

### Requirement 4：JSON → SQLite 一次性迁移

**User Story：** 作为老用户升级者，我希望启动新版 NovelFork 时，已有的 `sessions.json` 与 `session-history/*.json` 自动迁移到 SQLite，不丢失任何数据，且多次重启不会重复导入。

#### Acceptance Criteria

1. WHEN NovelFork 首次启动发现 `sessions.json` 或 `session-history/` 存在且 `session` 表为空时 THEN THE SYSTEM SHALL 执行一次性导入。
2. WHEN 导入完成时 THEN THE SYSTEM SHALL 在 `kv_store` 写入 `migration:json-to-sqlite:done=true` 与 `migration:json-to-sqlite:completed_at`。
3. WHEN NovelFork 再次启动检测到上述标记时 THEN THE SYSTEM SHALL 跳过导入。
4. WHEN 导入过程中遇到损坏 JSON 文件时 THEN THE SYSTEM SHALL 记录 warning、跳过该 session、继续导入其余，不中断启动。
5. WHEN 导入完成后 THEN THE SYSTEM SHALL 把 JSON 文件重命名为 `<name>.migrated-<timestamp>.bak`，保留回滚可能；不得直接删除。

### Requirement 5：并发与崩溃安全

**User Story：** 作为服务端维护者，我希望 SQLite 下的会话消息写入不再依赖应用层 Promise 队列来保证顺序与原子性，SQLite 事务提供真正的持久化保证。

#### Acceptance Criteria

1. WHEN 并发 append 同一 session 时 THEN THE SYSTEM SHALL 使用 SQLite 事务 + `(session_id, seq)` 唯一索引避免 seq 冲突，允许至多一次重试获取下一个 seq。
2. WHEN 写入事务提交前进程崩溃时 THEN THE SYSTEM SHALL 保证该次写入要么全部持久化要么完全未写入，不出现半条消息。
3. WHEN 使用 WAL 模式时 THEN THE SYSTEM SHALL 在数据库打开时启用 `PRAGMA journal_mode=WAL` 与 `synchronous=NORMAL` 以平衡性能与安全。
4. WHEN 老代码的 Promise 队列（`historyWriteQueues` / `sessionStoreMutationQueue`）仍被引用时 THEN THE SYSTEM SHALL 保留这些 API 的签名但内部改为事务驱动，以便渐进迁移。

### Requirement 6：测试与回归

**User Story：** 作为维护者，我希望迁移完成后现有 session / chat / recovery 测试全部继续通过，且新增 SQLite 层有独立单元测试。

#### Acceptance Criteria

1. WHEN 运行 `pnpm --filter @vivy1024/novelfork-studio test` 时 THEN THE SYSTEM SHALL 通过所有现有 session / chat / recovery 相关测试。
2. WHEN 运行 `pnpm --filter @vivy1024/novelfork-studio typecheck` 时 THEN THE SYSTEM SHALL 无类型错误。
3. WHEN 新增单元测试时 THEN THE SYSTEM SHALL 覆盖：schema migration 幂等、JSON 导入幂等、并发 append 序号正确、resetRequired 边界、崩溃前事务回滚。
4. WHEN 集成测试触发 `replaceSessionChatState` 时 THEN THE SYSTEM SHALL 验证广播信号与事务原子性。

### Requirement 7：扩展预留与文档

**User Story：** 作为后续 Bible / filter / template 等 spec 的开发者，我希望 storage 层提供清晰的 drizzle schema 文件与扩展指引，以便我的 spec 直接新增表而不破坏核心。

#### Acceptance Criteria

1. WHEN 新 spec 需要新增表时 THEN THE SYSTEM SHALL 提供 `packages/core/src/storage/schema.ts` 作为唯一 schema 入口，支持按 feature 拆分子文件（如 `schema-bible.ts`、`schema-filter.ts`），由 `schema.ts` 统一 re-export。
2. WHEN 新增 migration 时 THEN THE SYSTEM SHALL 通过 drizzle-kit 生成版本化 SQL，放在 `packages/core/src/storage/migrations/`，按 `{序号}_{spec名或phase名}.sql` 命名。
3. WHEN 多个 spec 并行开发时 THEN THE SYSTEM SHALL 维护 migration 编号规划表（见 design.md），避免编号冲突；每个 migration 文件只含该 spec / phase 自己的表。
4. WHEN 一个 spec 分多 Phase 交付时 THEN THE SYSTEM SHALL 每 Phase 独立生成 1 个 migration，Phase N+1 可引用 Phase N 的表但不允许反向依赖。
5. WHEN 文档更新时 THEN THE SYSTEM SHALL 在 `docs/04-开发指南/` 新增 `存储层开发指引.md`，说明 schema 扩展 / migration 编号协调 / 测试模式 / 禁止事项。
