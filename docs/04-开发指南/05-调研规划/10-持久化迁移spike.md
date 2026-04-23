# 10 - 本地持久化升级可行性 Spike：better-sqlite3 + drizzle

> **范围声明**：本文是 Package 6 / 7.5 的**纯调研产物**。
> 不改生产代码，不进行数据迁移，只回答"如果将来要迁，代价/收益/风险是什么"。
> 决定权留给后续独立 spec，不在本包实现。

**创建日期**: 2026-04-24
**对应任务**: `.kiro/specs/novelfork-narrafork-closure/tasks.md` § 7.5
**上游依据**: `06-Studio-UIUX改造清单.md` § 0.1（"NarraFork 启动时会执行 Drizzle migration"）

---

## 0. 结论速览（TL;DR）

| 维度 | 结论 |
|---|---|
| 是否应迁 | **暂不迁**。当前量级与访问模式下，文件系统方案的稳定性/可读性/排障成本仍优于引入数据库 |
| 迁了能得到什么 | FTS 搜索、事务保证、并发读写、启动迁移化、history 翻页 O(1) |
| 迁了会失去什么 | 可手动 `cat`/`git diff` 的纯文本资产、低门槛恢复路径、跨平台构建简单性 |
| 若要迁，首选方案 | Tauri 侧用 `@tauri-apps/plugin-sql`（SQLCipher 可选），Node/Bun 侧用 `better-sqlite3 + drizzle-orm`；通过 `packages/core/src/storage/adapter.ts` 接口层隔离 |
| 首个迁移对象 | **sessions + session-history**（JSON 文件已暴露扩展瓶颈），而非章节正文 |

---

## 1. 现状盘点

### 1.1 文件系统落盘结构

当前持久化全部由 `FileSystemStorageAdapter`（`packages/core/src/storage/fs-adapter.ts`）承担：

| 数据类别 | 落盘形态 | 存放路径 |
|---|---|---|
| 书籍配置 | `book.yaml` | `<project>/<bookId>/book.yaml` |
| 章节正文 | `<NNNN>_<title>.md` | `<project>/<bookId>/chapters/` |
| 章节索引 | `index.yaml` | `<project>/<bookId>/` |
| Truth 文件（6 份） | markdown | `<project>/<bookId>/story/*.md` |
| 风格画像 | `style_profile.json` | `<project>/<bookId>/story/` |
| 写锁 | `.write.lock`（pid + lockId） | `<project>/<bookId>/` |

Studio 层（`packages/studio/src/api/lib/`）另外维护：

| 数据类别 | 落盘形态 | 路径策略 |
|---|---|---|
| 会话元数据 | `sessions.json`（全量数组） | `resolveRuntimeStoragePath("sessions.json")` → `~/.novelfork/` |
| 会话消息历史 | `session-history/<sessionId>.json` | `~/.novelfork/session-history/` |
| Pipeline run / event | JSON / NDJSON | `~/.novelfork/runs/`（见 `run-event-store`） |
| state projection | JSON 快照 | 运行期内存 + 周期性落盘 |

### 1.2 并发与一致性

- 章节写入走 **进程级文件锁**（`.write.lock`），挂了还要靠 pid alive 检测回收（`fs-adapter.ts:304-361`）
- 会话更新走 **单进程内 Promise 串行队列**（`session-service.ts` 的 `sessionStoreMutationQueue`），跨进程不安全
- `sessions.json` 是**整表重写**（每次 update 全量 `JSON.stringify` 再 `writeFile`），session 数量一上百会出现肉眼可见的写入毛刺

### 1.3 查询能力

- 无索引：列会话要 load 整个 `sessions.json` 再 `filter`
- 无 FTS：truth/chapter 搜索目前走全文件 `readFile` + `grep`，有专门的 `SearchView`，性能依赖 OS 文件缓存
- 无范围/分页：`session-history/<id>.json` 必须整文件读出

---

## 2. NarraFork 的做法参考

> 依据：`06-Studio-UIUX改造清单.md` 明确提到 NarraFork 启动阶段跑 **Drizzle migration**，异常退出后会 **重建 FTS 索引**。

- 栈：`better-sqlite3` + `drizzle-orm` + `drizzle-kit`（migration 生成）
- 部署形态：embedded SQLite 文件 + migration 文件夹随二进制一起分发
- 启动流程：
  1. 打开 db 文件 → 跑 pending migration（drizzle-kit 生成的 `.sql`）
  2. 校验 FTS 索引完整性，缺失则 rebuild
  3. 进入业务读写
- 额外能力：FTS5（全文搜索）、WAL journal（并发读写）、`JSON1` 扩展（半结构化字段）

---

## 3. 候选方案对比

### 方案 A：纯 better-sqlite3 + drizzle（Node/Bun 原生）

| 维度 | 评价 |
|---|---|
| 性能 | 同步 API，单线程极快；WAL 模式下读写可并发 |
| 打包 | **native binding**，每个 OS/架构需预编译 `.node`；`pnpm install` 时 `node-gyp` 失败是常态 |
| Tauri 兼容 | ❌ **不直接可用**。Tauri 前端是 WebView；要用需要把 db 访问放到 Rust 或 Node sidecar |
| 生态 | drizzle schema + migration + type inference 成熟，zod 集成直接 |
| 迁移 | `drizzle-kit generate:sqlite` → `.sql` 随包分发，启动时 `drizzle.migrate()` |

### 方案 B：`@tauri-apps/plugin-sql`（Tauri 官方）

| 维度 | 评价 |
|---|---|
| 性能 | 透传 Rust `rusqlite`，异步 IPC 往返但桌面端可忽略 |
| 打包 | Rust 编译一次即跨平台（配合 Tauri 现有构建管线） |
| Tauri 兼容 | ✅ 一级支持，与现有 `@tauri-apps/plugin-fs` 同级 |
| 生态 | 只有 SQL 字符串接口，**没有** drizzle 那套类型推导 |
| 迁移 | 需自己维护 `migrations: [{ version, description, sql }]` 数组 |

### 方案 C：双端抽象，分头实现

- 定义 `SessionPersistence` 接口（已在 `storage/adapter.ts` 的思路上）
- Node/server 模式：方案 A
- Tauri 模式：方案 B
- 迁移脚本双端共用（纯 SQL）

**推荐方案 C**，理由：
1. NovelFork 已经同时有 Node server（`dev:api`）与 Tauri 桌面两条运行态
2. 现有 `resolveRuntimeStoragePath` 已经按环境返回不同目录，扩展为按环境返回不同 db 驱动是自然延伸
3. 类型安全（drizzle）与 Tauri 原生集成这两个收益**无法同时拿到**，分端拿各自刚需是最小代价组合

---

## 4. 迁移代价/收益/风险

### 4.1 代价

- **新增维护面**：migration 文件夹、schema DSL、两份驱动实现
- **调试复杂度**：出问题不能再 `cat sessions.json` 直接看，要 `sqlite3 .dump`
- **打包风险**：better-sqlite3 的 native binding 在 CI 矩阵里容易翻车，现有 `pnpm-workspace` + Turbo 构建要额外处理 `node-gyp`
- **user data 迁移**：已有 `~/.novelfork/sessions.json` 的用户，首次启动要跑一次 JSON → SQLite 导入，失败回滚策略需要设计
- **测试基础设施**：现有 fs-based 测试全部用 `tmp-dir` 方案，要新增 **in-memory SQLite**（`":memory:"`）测试夹具

### 4.2 收益

- **sessions 查询 O(n) → O(log n)**：按 bookId / sessionMode / updatedAt 建索引后，Admin SessionsTab 长列表不再卡
- **history 翻页**：`session-history/<id>.json` 当前是全量读，迁库后可 `WHERE session_id=? ORDER BY seq LIMIT ? OFFSET ?`
- **事务一致性**：session 更新 + 消息追加 + cursor 推进可以落在一个事务里，不再需要 JS 侧的 `sessionStoreMutationQueue`
- **FTS**：truth/chapter 搜索可以接 FTS5 virtual table，`SearchView` 性能上一个台阶
- **并发**：WAL 模式下多读单写天然支持，去掉现有的 pid-based `.write.lock` 脏逻辑

### 4.3 风险

- **不可逆性**：一旦用户数据落到 SQLite，`git diff` 友好度直接归零；要保留"导出为 markdown"能力，工作量不小
- **章节正文不应迁**：章节 `.md` 文件的"可手动 git 管理"是 NovelFork 区别于 NarraFork 的**核心卖点**，迁库会破坏这个心智
- **BLOB 写放大**：章节正文若存库，单行 MB 级 update 在 WAL checkpoint 时有写放大
- **备份策略变更**：现有 `BackupView` 是 tar 整个目录，迁库后需要额外导出 SQL dump

---

## 5. 建议的最小落地路径（若未来决定推进）

**分三阶段，每阶段独立可回退**：

### Phase 1：sessions + session-history 入库（最小可验证）

- 建表：`sessions`, `session_messages`, `session_cursors`
- 迁移脚本：一次性读 `sessions.json` + `session-history/*.json` → insert
- 保留 JSON 文件作为只读历史快照一个版本周期
- 验收：`session-service.test.ts` / `session-chat-service.test.ts` 全绿，`SessionCenter` / `Admin SessionsTab` 手工冒烟无回归

### Phase 2：run / pipeline event 入库

- 建表：`runs`, `run_events`（NDJSON → 行）
- 利用 `INDEX(run_id, seq)` 做快速回放
- 验收：Admin Requests / Pipeline 可视化不变，事件顺序严格

### Phase 3（可选）：FTS 搜索 + truth 文件索引

- **不**把 truth / 章节正文迁进 SQLite
- 用 FTS5 **虚拟表** 只存正文倒排索引，正文本体仍是 `.md`
- 验收：`SearchView` 在 10k 条目下 < 100ms

---

## 6. 最小 spike demo 说明

> 本次**未**在 repo 内新增运行时代码，不创建 `packages/core/src/persistence/sqlite-spike.ts`。
> 若后续立项，该 demo 应在独立 spec 的第一条任务里补，目标是：
>
> - 用 `better-sqlite3@^11` 建三张表（sessions / session_messages / session_cursors）
> - 读现有 `sessions.json` + `session-history/` 灌入
> - 跑 `SELECT count(*)` 与 `WHERE session_id=? ORDER BY seq DESC LIMIT 100` 基准
> - 产出 p50 / p99 毫秒数，与现有 JSON 方案同数据集对比

保留这个"未来第一条任务"占位，让本 spike 的结论可被后续立刻对齐验证。

---

## 7. 决策建议

**当前应做的事**：
1. **不迁库**。session / session-history 的规模瓶颈还没触及用户可感知的阈值
2. 把 `sessions.json` 全量重写的热点先改为 **追加+紧凑** 双文件（append log + snapshot），拿掉 80% 的迁库动机
3. 给 `storage/adapter.ts` 补一个 `SessionPersistenceAdapter` 子接口，便于将来切换

**触发迁库的信号**：
- 单用户 session 数 > 500 且 `SessionCenter` 首屏 > 500 ms
- Admin 长跑 run 的 event 单文件 > 20 MB
- 出现"需要跨 session 做 SQL 聚合"的真实产品需求

其中任意一条先出现，再启动 Phase 1。

---

**完**
