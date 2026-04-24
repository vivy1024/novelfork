# Design Document

## Overview

把 NovelFork 会话与消息持久层从 JSON 文件迁移为 SQLite + drizzle ORM。对外保持 session-chat-service 协议不变，对内提供稳定的 schema 与 migration 基础设施，为后续 Bible / Filter / Template 等 spec 新增表提供统一底座。

## Goals

- 零行为差异地替换 `session-service.ts` / `session-history-store.ts` 的底层实现
- 提供稳定的 drizzle schema 与 migration 基础设施
- 首次启动一次性导入老 JSON 数据，幂等重跑
- 保留 Promise 队列 API 签名但改为事务驱动
- 为后续 spec 新表扩展提供清晰模式

## Non-Goals

- 不改变 snapshot / state / history / ack / resetRequired 语义
- 不做分布式 / 多进程访问（仅本地单进程）
- 不引入全文索引 / 向量检索（留给后续 spec）
- 不预建 Bible / filter / template 表（由对应 spec 自行扩展）

## Architecture

### 分层

```
packages/studio/src/api/lib/
  session-service.ts          ← 对外 API 签名不变
  session-history-store.ts    ← 对外 API 签名不变
  ↓ 调用
packages/core/src/storage/
  db.ts                       ← 单例 SQLite 连接 + WAL
  schema.ts                   ← drizzle schema 入口
  migrations/                 ← 版本化 SQL
    0001_initial.sql
  repositories/
    session-repo.ts
    session-message-repo.ts
    kv-repo.ts
  migrations-runner.ts        ← 启动时执行 migration
  json-import-migration.ts    ← 一次性 JSON → SQLite
```

### 关键决策

| 点 | 方案 | 原因 |
|---|---|---|
| SQLite 驱动 | `better-sqlite3` (同步) | Bun 兼容 + 零依赖本地、事务 API 简洁 |
| ORM | drizzle-orm | 类型安全、schema 即代码、migration 工具成熟 |
| Migration 工具 | drizzle-kit | 自动生成 diff、版本化 |
| 事务模型 | 同步事务（better-sqlite3 风格） | 简化并发模型、避免异步 race |
| journal mode | WAL | 读写并发、崩溃安全 |
| 存储位置 | `resolveRuntimeStorageDir()/novelfork.db` | 复用现有目录约定 |

### 数据库连接生命周期

- `getDb()` 惰性初始化，返回 drizzle 实例（单例）
- Studio 启动时 `runMigrations()` + `runJsonImportMigrationIfNeeded()`
- 进程退出 hook 关闭连接并 checkpoint WAL

## Schema（初始版本）

```ts
// packages/core/src/storage/schema.ts
export const session = sqliteTable("session", {
  id: text("id").primaryKey(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  messageCount: integer("message_count").notNull().default(0),
  configJson: text("config_json").notNull().default("{}"),
  metadataJson: text("metadata_json").notNull().default("{}"),
  deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
});

export const sessionMessage = sqliteTable("session_message", {
  sessionId: text("session_id").notNull().references(() => session.id, { onDelete: "cascade" }),
  seq: integer("seq").notNull(),
  id: text("id").notNull(),
  role: text("role").notNull(),       // user | assistant | system
  content: text("content").notNull(),
  timestamp: integer("timestamp", { mode: "timestamp_ms" }).notNull(),
  metadataJson: text("metadata_json").notNull().default("{}"),
}, (t) => ({
  pk: primaryKey({ columns: [t.sessionId, t.seq] }),
  byId: uniqueIndex("idx_session_message_by_id").on(t.sessionId, t.id),
}));

export const kvStore = sqliteTable("kv_store", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const drizzleMigrations = sqliteTable("drizzle_migrations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  hash: text("hash").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});
```

## 关键流程

### 启动流程

1. 解析 storage 目录
2. 打开 SQLite，启用 WAL / synchronous=NORMAL
3. 运行 pending migrations（从 `migrations/` 目录扫描）
4. 检查 `kv_store[migration:json-to-sqlite:done]`：
   - 为空 且 `sessions.json` / `session-history/` 存在 → 执行 JSON 导入
   - 导入完成 → 写入 done 标记 + 把原 JSON 重命名为 `.migrated-<ts>.bak`
5. 启动完成

### append 消息流程（事务化）

```ts
// 在事务中
const maxSeq = select max(seq) from session_message where session_id = ?;
const nextSeq = maxSeq + 1;
insert into session_message (...) values (..., nextSeq, ...);
update session set message_count = ?, updated_at = ? where id = ?;
```

冲突处理：`(session_id, seq)` 唯一索引保证并发下最多一个插入成功，另一个事务回滚后重试一次拿下一个 seq；二次冲突直接抛出。

### getSessionChatHistory 流程

```ts
const availableFromSeq = select min(seq) from session_message where session_id = ?;
const lastSeq = select max(seq);
const resetRequired = sinceSeq > 0 &&
  ((availableFromSeq > 0 && sinceSeq < availableFromSeq - 1) || sinceSeq > lastSeq);
const messages = resetRequired ? [] :
  select * from session_message where session_id = ? and seq > sinceSeq order by seq;
```

### replaceSessionChatState 流程

```ts
db.transaction(() => {
  delete from session_message where session_id = ?;
  insert into session_message (...) values (...), (...), ...;  // 批量
  update session set message_count = ?, updated_at = ?;
});
broadcast server-reset signal;
```

## 兼容层

保留 `appendSessionChatHistory` / `loadSessionChatHistory` / `saveSessionChatHistory` 签名，内部改为 repository 调用：

```ts
// session-history-store.ts (after migration)
export async function appendSessionChatHistory(sessionId, messages, seedMessages = []) {
  return sessionMessageRepo.appendMessages(sessionId, messages, seedMessages);
}
```

`historyWriteQueues` / `sessionStoreMutationQueue` 等进程内队列 API 保留为 no-op 包装或直接移除，按渐进迁移策略在 tasks 中分步替换。

## JSON 导入策略

```ts
async function runJsonImportMigrationIfNeeded(db) {
  if (await kvRepo.get("migration:json-to-sqlite:done")) return;
  const sessions = await safeLoadJson("sessions.json", []);
  for (const record of sessions) {
    try {
      db.transaction(() => {
        sessionRepo.insertIfNotExists(record);
        const history = safeLoadJson(`session-history/${record.id}.json`, []);
        sessionMessageRepo.bulkInsert(record.id, history);
      });
    } catch (err) {
      logger.warn(`[json-import] skip session ${record.id}`, err);
    }
  }
  await kvRepo.set("migration:json-to-sqlite:done", "true");
  await kvRepo.set("migration:json-to-sqlite:completed_at", Date.now().toString());
  await renameJsonFilesToBackup();
}
```

## 错误处理与可观测

- Migration 失败 → throw + 阻止启动（不降级）
- JSON 导入单条失败 → warn + skip，整体继续
- Repository 层统一抛 `StorageError`，包含 `op` / `sessionId` / `cause`
- 启动日志打印：SQLite 版本 / WAL 状态 / 已应用 migration / 导入结果摘要

## 测试策略

| 层 | 手段 |
|---|---|
| Schema | 对 migration SQL 做静态 parse + lint |
| Repository | in-memory SQLite fixture，每个 case 新实例 |
| 协议兼容 | 用现有 session-chat-service 的单测跑在新后端上 |
| JSON 导入 | fixture：有效 + 损坏 + 部分缺失的 JSON 目录 |
| 并发 | 起 N 个同步 append 检查 seq 单调 + 无空洞 |
| 崩溃安全 | mock 在 commit 前抛出，断言无半写 |

## 部署与回滚

- 新版本首次启动自动导入、原 JSON 保留 `.bak` 可回滚
- 若需回滚：删除 `novelfork.db` + 重命名 `.bak` 回原名 + 删除 kv_store 标记 → 下次启动走 JSON 路径（保留 JSON 兼容层作为 fallback 一段时间）
- tasks 中会明确 JSON 兼容层的移除时机（至少保留 2 个版本）

## 后续 spec 扩展模式

新 spec 需要新表：
1. 在 `packages/core/src/storage/schema.ts` 追加 `export const newTable = sqliteTable(...)`
2. `pnpm drizzle-kit generate:sqlite --config=...` 生成新 migration
3. 在自己的 `repositories/` 下新增 repo
4. 在 design.md 中引用 schema.ts 的具体表名

禁止绕过 schema.ts / migration 机制直接跑 DDL。
