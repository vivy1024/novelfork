# Implementation Plan

## Overview

把会话与消息持久化从 JSON 文件迁移到 SQLite + drizzle。共 7 个主任务，约 5-7 个工作日。

## Tasks

- [x] 1. 接入 SQLite + drizzle 基础设施
  - 在 `packages/core` 新增依赖：`better-sqlite3`、`drizzle-orm`、`drizzle-kit`（dev）
  - 新建 `packages/core/src/storage/db.ts`：单例 SQLite 连接，启用 WAL + synchronous=NORMAL
  - 新建 `packages/core/src/storage/schema.ts`：首批表按 requirements 补齐为 session / session_message / session_message_cursor / kv_store / drizzle_migrations
  - 配置 `drizzle.config.ts` 指向 migrations 目录
  - 生成 `migrations/0001_initial.sql`
  - 验证：`src/__tests__/storage-db.test.ts` 覆盖打开 DB、WAL/NORMAL、migration 幂等、drizzle insert/select

- [x] 2. 迁移 runner + 启动集成
  - 实现 `migrations-runner.ts`：扫描 migrations 目录、按哈希去重、写入 `drizzle_migrations` 表
  - 实现进程退出 hook：checkpoint WAL + 关闭连接
  - 在 Studio 启动总控 `packages/studio/src/api/server.ts` 的 `startHttpServer()` 前置调用 migration（`start-http-server.ts` 仅保留 HTTP adapter 职责）
  - 单测：migration 幂等（多次运行结果一致）
  - 单测：migration SQL 失败时抛 + 不标记 applied；Studio 启动测试覆盖迁移先于 HTTP listen

- [x] 3. Repository 层与协议兼容
  - 新建 `repositories/session-repo.ts`：create / getById / list / update / softDelete
  - 新建 `repositories/session-message-repo.ts`：appendMessages（事务）/ loadAll / loadSinceSeq / replaceAll（事务）/ deleteAllBySession / getCursor
  - 新建 `repositories/kv-repo.ts`：get / set
  - 重写 `packages/studio/src/api/lib/session-service.ts` 与 `session-history-store.ts`：API 签名不变，内部改走 repo
  - 保留 `historyWriteQueues` / `sessionStoreMutationQueue` 导出符号作 no-op 兼容壳（后续 spec 清理）
  - 单测：所有 session-chat-service 协议测试通过

- [x] 4. 并发与原子性验证
  - 实现 append 的唯一索引冲突重试（最多 1 次）
  - 单测：并发 N=50 append 同一 session，断言 seq 严格单调、无空洞、无丢失
  - 单测：事务中 commit 前抛出 → 无半写
  - 单测：WAL checkpoint 行为正常
  - 压测：1000 条消息 append 总耗时记录到测试日志

- [ ] 5. JSON → SQLite 一次性导入
  - 实现 `json-import-migration.ts`
  - 读 `sessions.json` + `session-history/*.json` → 事务化批量插入
  - 损坏 JSON → warn + skip，继续下一条
  - 成功后：kv_store 写 done 标记 + 重命名 JSON 为 `.migrated-<ts>.bak`
  - 单测 fixture：三类场景（全新 / 部分损坏 / 已迁移）
  - 单测：已 done 时再次启动不重复导入

- [ ] 6. 协议回归与性能验证
  - 运行 `pnpm --filter @vivy1024/novelfork-studio test`
  - 运行 `pnpm --filter @vivy1024/novelfork-studio typecheck`
  - 针对 session-chat-service 的 snapshot / history / resetRequired / replaceState 全部断言不变
  - 针对 recovery 流程（`recoveryStatus` 五态）无回归

- [ ] 7. 文档与后续 spec 扩展模式
  - 新建 `docs/04-开发指南/存储层开发指引.md`：schema 扩展步骤 / migration 生成命令 / 测试模式 / 禁用事项
  - 更新 `CLAUDE.md` 引用该指引
  - 在 07 调研文档的路线图中勾选 storage-migration 完成
  - 记忆 MCP remember：存储层关键约束（事务边界 / seq 生成策略 / WAL 约定）

## Done Definition

- 所有现有 session / chat / recovery 测试通过
- typecheck 通过
- 新增 SQLite 层测试 ≥ 20 个，覆盖 schema / migration / 并发 / JSON 导入
- 老 JSON 文件被重命名为 `.bak`，原数据 100% 导入 SQLite
- 文档更新完成
- 至少一次手动烟测：创建会话 → 发消息 → 重启 Studio → 会话恢复 → 消息序列正确
