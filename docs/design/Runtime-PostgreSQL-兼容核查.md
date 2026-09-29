# Runtime PostgreSQL 兼容核查与验收方案

核查日期：2026-09-29。任务：T1.1b。范围：已物化 Runtime v0.7.10、公开 Bridge、product-runtime 和隔离验证入口。

**结论：继续保留并适配 PostgreSQL；当前不能声明 NovelFork 已支持 PostgreSQL 部署，也不能把 T1.1b 标为验收完成。** 上游已经具备后端选择、真实驱动、迁移、全文检索及部分存储适配，但完整服务器启动仍有 SQLite 依赖，项目写入与叙述者入口明确拒绝 PostgreSQL，产品接缝也尚未适配。目标是 Runtime PostgreSQL 与产品 SQLite 共存，产品领域库不因此改成 PostgreSQL。

本次已完成静态源码核查、本机二进制检查及 S0 隔离配置修复，并执行公开脚本的纯离线回归测试。仅修改隔离验证脚本、对应测试与本文档；产品正式启动后端选择和现有 generated.ts 保持不变。未启动/连接数据库，未启动服务或容器，未运行 Runtime 测试，未下载安装依赖。

## 1. 证据基线与判定方式

- `packages/narrafork-runtime-private/UPSTREAM.lock.json`：版本 `0.7.10`，物化来源提交 `7088e4fb0a4dce82750d7dfe72586c8249e499f1`；上游提交 `24f2436ab01a8785b93a55616d9216276df4cce6`。以锁文件和当前源码为准，不使用旧快照替代。
- 用宿主 Git 库的上游对象与物化文件内容哈希比较：`server/db/postgres-runtime.ts`、`server/services/chapter-batch-merge.ts`、`server/routes/narrators.ts`、`tests/db/pg-test-harness.ts` 与该上游提交相同。`server/main.ts` 有 fork 差异，但上游同一文件也无条件调用下述合并会话清理门禁。
- 下文的“已有接线”只表示真实生产调用链存在；“未验收”表示本机未运行该能力。“静态阻塞”来自当前调用关系，不冒充实际数据库运行日志。
- 本文只记录接口、路径、行为与验收方法，不包含私有 Runtime 实现、迁移 SQL 或表结构副本。

## 2. 上游选择、启动与存储机制

以下路径均相对 `packages/narrafork-runtime-private/`。

| 项目 | 当前契约 | 关键文件 |
| --- | --- | --- |
| 主后端选择 | `NF_DATABASE_BACKEND` 优先于设置项 `database.backend`，默认 `sqlite`。当前实现会去除空白并转小写；非 `sqlite` / `postgres` 值报配置错误 | `server/db/postgres-runtime.ts:157`、`server/lib/settings/defaults.ts` |
| PostgreSQL 连接串 | 显式选择 PostgreSQL 后必须提供 `NF_DATABASE_URL`，其次 `DATABASE_URL`；只提供 URL 不会切换默认 SQLite。只接受 PostgreSQL URL 协议 | `server/db/postgres-runtime.ts` |
| 设置项限制 | PostgreSQL 分支拒绝设置文件中的非空 `database.postgres.url`，连接凭据应走环境。池参数为 `max`、`idleTimeout`、`maxLifetime`、`connectTimeout` | 同上、`server/lib/settings/types.ts` |
| 旧读写选择器 | 主后端为 PostgreSQL 时，非空 `NF_READ_BACKEND` / `NF_WRITE_BACKEND` 都会被拒绝，包括值为 `sqlite` 的情况；不能用它们代替主选择器 | `server/db/postgres-runtime.ts:182` |
| 驱动 | Bun `SQL` 与 Drizzle `bun-sql`，网络操作为异步；不是 `bun:sqlite` 的可替换句柄 | `server/db/postgres-client.ts` |
| 数据库启动 | 实例锁 → 连接探测 → PostgreSQL 迁移 → FTS 目录/触发器 → 有界回填与就绪检查。失败拒绝启动，不回退 SQLite；回填未完成也不能算就绪 | `server/db/index.ts:104`、`server/db/postgres-runtime.ts:323`、`server/db/pg-fts.ts` |
| 存储组合 | 绑定注册、认证会话/MFA、知识读写、章节写、归档主库、项目读、队列、消息引用与搜索等 PostgreSQL 适配器；队列另有启动激活门禁 | `server/services/postgres-composition.ts:58`、`server/main.ts:152` |
| SQLite 句柄 | PostgreSQL 模式不打开主 `narrafork.db`；导出的 `db` / `sqlite` 是访问即抛错的代理。不能给它们换类型声明就当作 PostgreSQL 适配 | `server/db/index.ts:74` |
| 本地目录仍必需 | PostgreSQL 不消除设置、实例锁、书籍文件、Git 工作区等本地资源。`getDbPath()` 在此模式下仍返回本地 SQLite 形状的路径，不是 PostgreSQL DSN | `server/db/connection.ts:40`、`server/db/index.ts` |
| 维护与占用统计 | WAL、SQLite 清理标记等维护返回不适用；PostgreSQL 数据库存储占用细分/清理候选等明确未支持，不能把零值当作成功统计 | `server/db/postgres-runtime.ts:492`、`server/services/storage/store.ts`、`server/services/storage/postgres-database-storage.ts` |
| 停机 | 关闭 PostgreSQL 客户端并拒绝新操作，释放本地实例锁。没有 SQLite 干净关闭标记，不应据此跳过 PostgreSQL 的一致性验收 | `server/db/index.ts`、`server/main.ts` |

“章节写”和“项目读”等适配器已存在，不代表涉及 ACL、Git、叙述者或产品中间件的完整 HTTP 流程已经接通。验收需要覆盖最终调用者。

## 3. 已确认的不兼容路径

### 3.1 选择 PostgreSQL 后仍不能完成完整启动

1. **产品根目录启动的迁移路径不成立。** 根 `main.ts` / `scripts/start-isolated-verify.ts` 从产品仓库根运行；上游 `server/db/run-migrations.ts:183` 的 PostgreSQL 默认目录是相对 cwd 的 `./drizzle-postgres`。本机该根目录不存在；实际四个迁移在 Runtime 自身的 `drizzle-postgres/`。`NARRAFORK_MIGRATIONS_DIR` 只用于 SQLite 解析，不控制 PostgreSQL。当前物化树也没有 `server/generated/embedded-postgres-migrations-data.ts`。因此，连接探测成功后仍会遇到迁移来源缺失，不能把 SQLite 迁移变量当作修复。
2. **完整上游服务器还有必经 SQLite 调用。** `server/main.ts:167` 在 PostgreSQL 组合/队列激活之后、监听之前，无条件调用 `chapterBatchMerge.cleanupStaleSessions()`；`server/services/chapter-batch-merge.ts:656` 立即经 `db.select` 读取合并会话。该句柄在 PostgreSQL 下抛错，外层捕获后重新抛出。即使空库也要先调用 `select`，不会因为“没有陈旧会话”而绕过。上游 `24f2436a` 同样存在此调用，不应归咎于产品新增代码。这里只证明一个确定阻塞，未穷举完整启动图中的全部 SQLite 依赖。
3. **发布产物尚未接通 PostgreSQL 迁移。** 公开 `scripts/lib/prepare-runtime-release-artifacts.ts:133` / `:300` 只生成 SQLite 内嵌迁移；没有 PostgreSQL 内嵌迁移生成接线。私有迁移加载器还使用动态模块路径，不能据源码中存在 fallback 就断言单文件 EXE 会包含它。需在私有 fork 修正可打包入口，并在公开产物准备器调用受控接口生成临时资产；本次没有编译 EXE。

上游 `server/db/__tests__/postgres-runtime.integration.test.ts` 的子进程入口是 `tests/db/pg-runtime-subprocess-entry.ts`，验证数据库模块、部分组合和健康字段形状；它不是完整 `server/index.ts`。这组测试通过仍不能覆盖上面第 2 项。

### 3.2 上游明确拒绝的业务入口

| 路径 | 当前行为 | 含义 |
| --- | --- | --- |
| `server/routes/projects.ts:61` | 项目创建、更新、删除、成员、可见性与归属变更经 `requireSqliteProjectMutation` 返回 `503 / POSTGRES_UNSUPPORTED` | 项目读适配器不能覆盖项目生命周期写入；Bridge 的 `deleteProjectById` 也受此限制 |
| `server/routes/narrators.ts:557` | 叙述者 HTTP 路由统一拒绝 PostgreSQL | 消息引用与队列端口存在，不等于叙述者会话/Agent 流程能用 |
| `server/websocket/ws-handler.ts:59` | `/ws/narrator` 与 `/ws/external/v1/narrators` 拒绝 PostgreSQL 升级，返回同一 503 代码 | 不能承诺嵌入面板发消息、工具权限与实时恢复可用 |
| `server/main.ts:1304` | OAuth / integration 启动回填在 PostgreSQL 下明确门控 | 后续需要单独验收相关通用能力，不应伪报已迁移 |

修复这些入口要补完整存储端口与语义，不能仅删除拒绝检查或捕获异常后继续返回成功。

### 3.3 公开 Bridge 与 product-runtime

| 公开文件 | 当前依赖与具体影响 | 兼容判断 |
| --- | --- | --- |
| `packages/narrafork-runtime-bridge/src/index.ts:158`、`src/index.d.ts:201` | 直接导出 Runtime `db` 与 SQLite schema；声明含 `any` 和同步形状的 `transaction` | 不兼容 Runtime PostgreSQL。类型检查通过无法证明可运行 |
| `packages/narrafork-runtime-bridge/src/runtime-db.ts` / `.d.ts` | 暴露 `BunSQLiteDatabase`、`drizzle/bun-sqlite`、`sqliteTable` | 可继续用于产品 SQLite；不能用它构造 Runtime PostgreSQL 查询 |
| `packages/novelfork-product-runtime/src/db/database.ts`、`src/db/schema.ts`、`src/adapters/storage.ts` | 独立 `NOVELFORK_STORAGE_DB_PATH`，Core 与产品迁移，SQLite 书籍/绑定/操作账本 | 是共存方案的产品侧基础，不需要为 Runtime PostgreSQL 迁移产品领域库；端到端共存仍未验收 |
| `src/services/book-binding.ts:309`、`src/services/book-runtime-access.ts:48` | 通过 Runtime `db` 查询 narrator → chapter → project 及可信工作目录 | 绑定解析与产品访问守卫会触发不可用句柄 |
| `src/services/narrator-access.ts:34` | 用户身份、叙述者存在性、权限请求归属、HTTP/WS 产品守卫均直接查询 Runtime | 认证存储已支持 PostgreSQL也不能覆盖产品授权链 |
| `src/services/book-provision.ts:2492` | 直接查/插 Runtime 项目、章节、叙述者；另有列表、复制、更新、删除 | 新建书及幂等补偿流程未接通；删书仍调用上游受限入口 |
| `src/adapters/runtime-host-adapter.ts:122` | 从 Runtime 工具调用表读取已加载技能证据 | 小说工具的可信上下文链尚未适配，不能以 mock 技能结果验收 |
| `src/routes/runtime-capabilities-default.ts:26` | Runtime 项目配置读写、MCP 覆盖等直接使用 `db` | 产品能力页面及更新流程有同类阻塞 |
| `src/services/legacy-session-migration.ts:272` | 同步 Runtime 事务与 `.run()` 写入旧会话/消息 | 不是 PostgreSQL 导入器；必须显式迁移策略与可重试账本，不能自动搬迁用户数据 |
| `src/db/compatibility-transfer.ts:164` | 只从本地旧 Runtime SQLite 文件只读转存产品表；文件缺失时跳过 | 不会从 PostgreSQL 自动导入；若旧文件存在，也不会因切换后端而自动判断其来源是否仍可信 |

表中 `src/` 简写均相对 `packages/novelfork-product-runtime/`。产品库的 SQLite 与 Runtime 主库是两个存储边界；保留前者并不等于偷偷打开第二个 Runtime 主库。

### 3.4 S0 隔离配置问题已修复

原 `scripts/start-isolated-verify.ts:72` 展开宿主 `process.env`，只覆盖本地目录，会继承外部 PostgreSQL 目标及冲突读写选择器。现已在子进程环境显式设置 `NF_DATABASE_BACKEND=sqlite`，并删除 `NF_DATABASE_URL`、`DATABASE_URL`、`NF_READ_BACKEND`、`NF_WRITE_BACKEND` 四个键。

- 无论宿主未选后端还是显式选 PostgreSQL，验证子进程均使用隔离目录内的 SQLite；主选择器优先于设置文件，避免复用验收目录中的后端设置改变此行为。
- 只修改传给 `Bun.spawn` 的环境副本，不修改宿主 `process.env`，也不修改产品根 `main.ts` 或 Runtime 的真实后端选择逻辑。
- 此脚本用于 SQLite UI 隔离验证。PostgreSQL 后续验收需按 C 显式建立新的隔离数据库目标，不通过继承 URL 使用此脚本。

`scripts/start-isolated-verify.postgres-contract.test.ts` 将**当前公开启动脚本**转译后在 VM 中执行：环境、文件调用与 `Bun.spawn` 全部替换，只观察子进程环境；不导入 Runtime，也不读取真实连接串。测试已从复现错误现状改为三项回归：默认显式 SQLite、覆盖继承的 PostgreSQL 后端并删除主 URL、删除回退 URL 与读写选择器；同时检查本地路径隔离及宿主环境不变。**S0 已修复；这不表示 PostgreSQL 产品兼容或真实实例启动已经验收。**

2026-09-29 收尾时，同一隔离规则也补入 `scripts/run-workspace-tests.ts` 的子进程环境及 `packages/novelfork-product-runtime/src/test-env.ts`，避免只保护手动验证却漏掉测试入口。离线测试执行这两份实际配置逻辑，核对公开包、Runtime 测试子进程和产品 preload 都不继承外部连接；连同既有用例共 10 项通过。显式 PostgreSQL 专项测试仍须自行提供隔离目标。

## 4. 本机隔离测试条件

| 检查项 | 真实结果 | 能证明什么 |
| --- | --- | --- |
| `Get-Command postgres,initdb,pg_ctl,psql,pg_isready,podman -CommandType Application` | PATH 未发现 | 当前无法直接使用这些 CLI |
| 常见安装位置的只读文件查找 | Program Files 下 PostgreSQL / Podman / RedHat，LocalAppData Programs，Scoop PostgreSQL、Chocolatey bin，以及 `F:\tool`、用户 `Tools` 中未找到目标二进制 | 是限定目录检查，不声称全盘绝无安装 |
| `docker.exe --version` | `C:\Program Files\Docker\Docker\resources\bin\docker.exe`，`28.4.0`，build `d8eb465` | 仅客户端存在；未查询 daemon、context、镜像、容器或运行状态，不声称现成隔离服务可用 |
| `bun --version` | `1.3.13` | 可运行本次离线公开测试；不满足 Runtime `packageManager: bun@1.4.2` 的真实集成/编译基线 |
| PostgreSQL 迁移资产 | Runtime 目录内 journal 为 `postgresql`，4 项 SQL 全存在；产品根 `drizzle-postgres` 与物化内嵌 PG 资产均不存在 | 资产存在不等于产品入口找得到或数据库已迁移 |

上游 `tests/db/pg-test-harness.ts` **固定调用 Podman**，默认镜像 `docker.io/library/postgres:17-alpine`；`PG_TEST_IMAGE` 只改镜像，不会改用 Docker。缺镜像时 harness 会尝试 pull。不能直接运行它来“看看有没有环境”，也不能只凭 Docker CLI 已安装就报告上游真实测试具备条件。

## 5. 最小适配切片

S0 已实施；S1–S5 为后续建议，尚未实施或真实验收，不改变主路线。

| 切片 | 准确范围/责任边界 | 独立验收条件 |
| --- | --- | --- |
| S0：隔离配置（已修复） | 启动脚本仅 `scripts/start-isolated-verify.ts`；回归仅 `scripts/start-isolated-verify.postgres-contract.test.ts` | 子进程显式 SQLite，四个继承 URL/读写选择器键已删除；纯离线回归通过，宿主环境不变。产品 PostgreSQL 选择能力保留，真实 PG 验收仍待做 |
| S1：迁移可定位、可打包 | 私有 fork 的 `server/db/run-migrations.ts` / `server/db/postgres-runtime.ts` 及定向测试；公开 `scripts/lib/prepare-runtime-release-artifacts.ts` / `scripts/prepare-runtime-release-artifacts.test.ts` | 不依赖 cwd 定位 PG journal；EXE 从无源码的空工作目录仍能迁移临时 PG；SQLite 迁移入口不变。私有实现与生成资产留在 fork/ignore 树 |
| S2：完整服务器启动 | 私有 fork `server/main.ts`、`server/services/chapter-batch-merge.ts` 及其存储端口/目标测试 | 陈旧合并会话清理有真实 PG 实现；数据库、FTS、队列与清理完成后才监听；修复这一个门禁后继续查后续启动调用，不跳过门禁冒充成功 |
| S3：产品只读接缝 | Bridge `src/index.ts` / `.d.ts`；product-runtime 的 `book-binding.ts`、`book-runtime-access.ts`、`narrator-access.ts`、`runtime-host-adapter.ts`、`runtime-capabilities-default.ts` | 以 Promise 形状的窄能力读取用户、绑定、项目路径、权限归属、技能证据；实现由 Runtime 拥有。先验证真实两后端授权与拒绝分支，不公开 SQL/schema 实现 |
| S4：生命周期与写作闭环 | 私有 Runtime 项目/叙述者 HTTP/WS 与业务写端口；公开 `book-provision.ts`、`legacy-session-migration.ts` 的调用接缝 | 新书创建、幂等重试、失败补偿、删除、叙述者运行/权限/重连都通过；跨 PG 与产品 SQLite 无单库事务，沿用操作账本和补偿协议 |
| S5：恢复与兼容资料 | 产品旧数据转存策略、备份恢复验收；分别处理 PG、产品 SQLite 和书籍文件 | 对全新合成数据完成重启及异地隔离恢复；旧 SQLite 的读取来源显式可控，不自动导入真实用户数据 |

S0 已按用户扩大后的写入范围落地，可供其他代理使用隔离脚本启动 SQLite UI 验证。S1–S5 需要新的写入范围；尤其 S2/S4 不是删几条条件判断的小补丁。

## 6. 可执行验收

### A. 现在可执行的纯离线核查

仓库根 PowerShell：

```powershell
bun test ./scripts/start-isolated-verify.test.ts ./scripts/start-isolated-verify.postgres-contract.test.ts
pnpm check:boundary
git diff --check -- scripts/start-isolated-verify.ts docs/design/Runtime-PostgreSQL-兼容核查.md scripts/start-isolated-verify.postgres-contract.test.ts
```

前两项本次真实结果分别为 **8 pass / 0 fail / 58 expect**、**通过**。边界检查只查已跟踪路径，不证明新文档内容已自动接受审查；本次新文件需另行检查，且不暂存/提交它们。`git diff` 默认也不包含未跟踪新增文件。

离线迁移位置复核（不导入 Runtime、不连接数据库）：

```powershell
$pgRoot = Join-Path $PWD 'packages/narrafork-runtime-private/drizzle-postgres'
$journal = Get-Content -LiteralPath (Join-Path $pgRoot 'meta/_journal.json') -Raw | ConvertFrom-Json
$missingSql = @($journal.entries | Where-Object {
  -not (Test-Path -LiteralPath (Join-Path $pgRoot ($_.tag + '.sql')))
})
[pscustomobject]@{
  Dialect = $journal.dialect
  MigrationCount = $journal.entries.Count
  MissingSql = $missingSql.Count
  RootCwdPgDirectory = (Test-Path -LiteralPath 'drizzle-postgres')
  EmbeddedPgData = (Test-Path -LiteralPath 'packages/narrafork-runtime-private/server/generated/embedded-postgres-migrations-data.ts')
}
```

本次结果：`postgresql / 4 / 0 / False / False`。这验证资产与位置，未执行 SQL。

### B. 上游定向真实存储测试（本次未执行）

前置条件：已有 Bun 1.4.2、可用且获准用于新隔离容器的 Podman、已在本地准备好的指定镜像。当前本机不满足。以下先只读检查镜像；缺失直接停止，禁止自动安装/下载。harness 本身仍有 pull 分支，运行期间若镜像被移除应停止验收，不能借测试偷偷拉取大依赖。

```powershell
if ((bun --version).Trim() -ne '1.4.2') { throw '需要已安装的 Bun 1.4.2' }
if (-not (Get-Command podman -CommandType Application -ErrorAction SilentlyContinue)) {
  throw '缺少 Podman；不要安装或改用现有用户数据库'
}
$pgImage = 'docker.io/library/postgres:17-alpine'
podman image inspect --format '{{.Id}}' $pgImage
if ($LASTEXITCODE -ne 0) { throw '镜像未在本地就绪，停止，不下载' }

$envNames = @('NARRAFORK_HOME','NOVELFORK_HOME','NF_DATABASE_BACKEND',
  'NF_DATABASE_URL','DATABASE_URL','NF_READ_BACKEND','NF_WRITE_BACKEND',
  'NARRAFORK_MIGRATIONS_DIR','NARRAFORK_ALLOW_MULTIPLE','PG_INTEGRATION','PG_TEST_IMAGE')
$savedEnv = @{}
foreach ($name in $envNames) {
  $savedEnv[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
  [Environment]::SetEnvironmentVariable($name, $null, 'Process')
}
Push-Location 'packages/narrafork-runtime-private'
try {
  $env:PG_INTEGRATION = '1'
  $env:PG_TEST_IMAGE = $pgImage
  bun test --isolate server/db/__tests__/postgres-runtime.integration.test.ts tests/server/services/registration/pg-registration-write.test.ts tests/server/services/auth/pg-auth-loop.test.ts tests/server/services/agent-runtime/pg-runtime-queue-startup-activation.test.ts
  if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL 定向真实测试失败' }
} finally {
  Pop-Location
  foreach ($name in $envNames) {
    [Environment]::SetEnvironmentVariable($name, $savedEnv[$name], 'Process')
  }
}
```

通过标准：`PG_INTEGRATION=1` 的真实用例执行，没有 skip/blocked，也没有被吞掉的 callback failure；迁移账本匹配 journal、FTS 无漂移、认证数据确实落到 PG、队列 schema 激活与错误拒绝均符合契约，所有本轮随机命名容器清理成功。不运行全量 Runtime 测试。B 通过只完成数据库层验证，不完成完整服务器或产品验收。

### C. 完整产品实例与 HTTP 验收（本次未执行）

前置条件：S0 已修复，S1–S4 仍需完成并重新核查；已有 Bun 1.4.2；已有可用的测试容器引擎及本地 PostgreSQL 17 镜像。**本机仅发现 Docker CLI，尚不能执行此阶段。** 未来可用 Docker 单独创建新容器验证产品，但不会因此让 B 的 Podman harness 自动兼容。

在专用验收 PowerShell 中执行下列命令。只使用此段新建的容器、目录和账号；不接受用户已有 URL。不要在当前未修复版本上把它当作预期成功命令。

```powershell
Set-Location 'D:/DESKTOP/novelfork'
if ((bun --version).Trim() -ne '1.4.2') { throw '需要 Bun 1.4.2' }
$pgImage = 'postgres:17-alpine'
docker image inspect --format '{{.Id}}' $pgImage
if ($LASTEXITCODE -ne 0) { throw '本地镜像未就绪，停止，不下载' }
if (Get-NetTCPConnection -State Listen -LocalPort 4613 -ErrorAction SilentlyContinue) {
  throw '4613 已被占用，不连接或停止该进程'
}
$acceptanceId = [guid]::NewGuid().ToString('N')
$pgName = 'novelfork-t11b-' + $acceptanceId
$verifyRoot = Join-Path $PWD ('.tmp-t11b-' + $acceptanceId)
New-Item -ItemType Directory -Path $verifyRoot -ErrorAction Stop | Out-Null
$env:POSTGRES_USER = 'nf_t11b'
$env:POSTGRES_PASSWORD = [guid]::NewGuid().ToString('N')
$env:POSTGRES_DB = 'nf_t11b'
$pgId = docker run --detach --pull=never --name $pgName --label "novelfork.t11b=$acceptanceId" --tmpfs /var/lib/postgresql/data -p 127.0.0.1::5432 -e POSTGRES_USER -e POSTGRES_PASSWORD -e POSTGRES_DB $pgImage
if ($LASTEXITCODE -ne 0) { throw '新隔离容器创建失败' }
$pgPortText = docker port $pgId 5432/tcp
if ($LASTEXITCODE -ne 0 -or $pgPortText -notmatch '^127\.0\.0\.1:(\d+)\s*$') {
  throw '无法确认新容器的 loopback 端口'
}
$pgPort = [int]$Matches[1]
$pgReady = $false
for ($attempt = 0; $attempt -lt 120; $attempt++) {
  docker exec $pgId pg_isready -U nf_t11b -d nf_t11b | Out-Null
  if ($LASTEXITCODE -eq 0) { $pgReady = $true; break }
  Start-Sleep -Milliseconds 250
}
if (-not $pgReady) { throw '新容器未就绪' }

# 直接运行产品正式 main.ts；六个本地路径与 PG 目标同时显式隔离。
# 隔离脚本已固定使用 SQLite；PG 验收在此显式配置独立目标。
$env:NOVELFORK_HOME = $verifyRoot
$env:NOVELFORK_PROJECT_ROOT = $verifyRoot
$env:NOVELFORK_BOOKS_ROOT = Join-Path $verifyRoot 'books'
$env:NOVELFORK_RUNTIME_DIR = Join-Path $verifyRoot 'runtime'
$env:NOVELFORK_SESSION_STORE_DIR = Join-Path $verifyRoot 'runtime/sessions'
$env:NOVELFORK_STORAGE_DB_PATH = Join-Path $verifyRoot 'novelfork.db'
$env:NOVELFORK_MARKET_DIR = Join-Path $verifyRoot 'market'
$env:NOVELFORK_DESKTOP_USER_DATA_DIR = Join-Path $verifyRoot 'desktop-browser'
$env:NOVELFORK_NO_BROWSER = '1'
$env:PORT = '4613'
$env:NF_DATABASE_BACKEND = 'postgres'
$env:NF_DATABASE_URL = "postgres://nf_t11b:$($env:POSTGRES_PASSWORD)@127.0.0.1:$pgPort/nf_t11b"
foreach ($name in @('DATABASE_URL','NF_READ_BACKEND','NF_WRITE_BACKEND','NARRAFORK_MIGRATIONS_DIR')) {
  [Environment]::SetEnvironmentVariable($name, $null, 'Process')
}
bun run main.ts
```

前台启动便于保留真实日志与明确进程归属；不打开浏览器、不借用既有监听端口。上述 `tmpfs` 为全新临时数据库，容器停止即丢数据，所以重启/恢复阶段先只重启应用，不先停容器。专用 shell 结束后环境不留给日常开发会话。

另一个验收 PowerShell 在确认该监听确实属于刚启动的进程后执行：

```powershell
$base = 'http://127.0.0.1:4613'
$health = Invoke-RestMethod "$base/api/health"
if ($health.database.backend -ne 'postgres') { throw '实际后端不是 PostgreSQL' }
$credentials = @{ username = 't11b_' + [guid]::NewGuid().ToString('N'); password = [guid]::NewGuid().ToString('N') }
$body = $credentials | ConvertTo-Json -Compress
$registered = Invoke-RestMethod "$base/api/auth/register" -Method Post -ContentType 'application/json' -Body $body
$login = Invoke-RestMethod "$base/api/auth/login" -Method Post -ContentType 'application/json' -Body $body
if (-not $login.token) { throw '登录未得到会话，不能继续产品验收' }
$headers = @{ Authorization = 'Bearer ' + $login.token; 'Idempotency-Key' = 't11b-' + [guid]::NewGuid().ToString('N') }
$bookBody = @{ title = 'T1.1b 隔离验收书'; language = 'zh' } | ConvertTo-Json -Compress
$created = Invoke-RestMethod "$base/api/novelfork/books" -Method Post -Headers $headers -ContentType 'application/json' -Body $bookBody
$bootstrap = Invoke-RestMethod "$base/api/novelfork/bootstrap" -Headers $headers
```

不能只以 HTTP 200 或请求无异常判通过。继续完成以下产品验收矩阵，失败保留阶段、错误代码和去凭据日志：

| 验收 | 必须保留的证据 |
| --- | --- |
| 完整启动 | 从仓库根启动；健康返回 `database.backend=postgres` 且启动恢复就绪；没有 SQLite 代理错误、迁移缺失或产品初始化错误。另验证 EXE 从无源码目录启动 |
| 登录与绑定 | 注册/登录返回真实用户；新书操作最终 `ready`，不是只得到 202；同一 `Idempotency-Key` 重试返回同一书籍/绑定；bootstrap 列出该书和绑定叙述者 |
| 数据分工 | 仅查本轮新容器与新产品 SQLite：Runtime 账号/项目/叙述者在 PG，书籍与绑定在产品库，书籍文件在隔离 books；Runtime 不新建可写的主 `narrafork.db` |
| 小说工具 | 获准使用的真实模型/叙述者执行一次小说写入工具，结果在产品数据及文件可见；技能证据、权限批准和 Runtime 工具记录真实存在。缺模型凭据则该项阻塞，不用 mock 宣称通过 |
| 权限与实时 | 本轮第二个普通账号不能访问第一账号的书籍、叙述者及权限请求；HTTP 与 WS 拒绝语义一致；正确账号的消息、工具权限和断线恢复成功 |
| 重启 | 只停止自己启动的产品进程，保持同一隔离 PG 容器与产品目录，重启后登录、书籍绑定、会话历史、工具结果仍一致；迁移不重复破坏数据 |
| 失败与补偿 | 错误连接串/迁移失败拒绝启动且无 SQLite 回退；创建书中途失败后操作账本可重试/补偿，无重复项目与孤立绑定 |
| 备份与恢复 | 下一节的 PG 备份、停写后的产品 SQLite/书籍/设置一致快照，恢复到第二套全新隔离资源；重新登录并核对上述对象与绑定 |

### D. 备份、恢复与清理（本次未执行）

先停止本轮产品进程，使 PG、产品 SQLite 与书籍文件停止跨库写入，再备份。**不能把复制本地 `narrafork.db` 当作 PG 备份，也不能对运行中的 SQLite 只复制主文件而漏掉 WAL。** 以下 `$pgId`、`$verifyRoot` 必须来自 C；`$restorePgId` 必须属于按 C 同样方式新建的第二个隔离容器。

```powershell
# 应用已停止；容器仍是本轮新建、只给本轮使用的实例。
docker exec $pgId pg_dump -U nf_t11b -d nf_t11b -Fc -f /tmp/t11b.dump
if ($LASTEXITCODE -ne 0) { throw 'PG 备份失败' }
docker cp "${pgId}:/tmp/t11b.dump" (Join-Path $verifyRoot 't11b.dump')
if ($LASTEXITCODE -ne 0) { throw '备份导出失败' }
Get-FileHash -LiteralPath (Join-Path $verifyRoot 't11b.dump') -Algorithm SHA256

# 第二个全新隔离容器已创建；不对源库做覆盖恢复。
docker cp (Join-Path $verifyRoot 't11b.dump') "${restorePgId}:/tmp/t11b.dump"
if ($LASTEXITCODE -ne 0) { throw '备份传入失败' }
docker exec $restorePgId pg_restore -U nf_t11b -d nf_t11b --exit-on-error --no-owner /tmp/t11b.dump
if ($LASTEXITCODE -ne 0) { throw 'PG 恢复失败' }
```

产品 SQLite、书籍文件、必要 Runtime 设置/密钥须在同一停写点复制到另一个全新验收目录，再显式设置全部路径与第二容器 URL 启动；验证文件根路径规范化后的可信绑定，不能只验数据库行数。当前绑定保存路径信息，跨目录恢复需要产品提供可信重绑定/路径迁移，或在隔离环境保持原挂载路径；本次未证明已有此能力，不能直接改数据库字符串绕过校验。凭据与备份不进入公开仓库。

所有成功与失败分支都需要清理自己创建的进程和容器。删除前用 `docker inspect --format '{{ index .Config.Labels "novelfork.t11b" }}' $pgId` 核对本轮 `$acceptanceId`，核对无误再 `docker rm --force $pgId`；恢复容器同样按自己的标签核对。不得通过通配符停止容器或按端口杀用户进程。临时目录递归删除前，先 `Resolve-Path -LiteralPath` 核对绝对路径属于本轮 `.tmp-t11b-<id>` 范围；保留所需脱敏证据后用原生 PowerShell `Remove-Item -LiteralPath`，不跨 shell 拼接删除命令。

## 7. 本次交付与未完成事项

- S0 隔离验证脚本已修复；本文档及纯离线回归测试同步更新。既有 5 项与 PostgreSQL 配置回归 3 项通过；这些测试不提供 PG 产品兼容性背书。
- 文档中 6 个 PowerShell 代码块经 `System.Management.Automation.Language.Parser.ParseInput` 检查，语法错误 0；两个新增文件直接逐行检查，行尾空白 0。指定路径的 `git diff --check` 返回 0，但新增文件未跟踪，因此另做上述内容检查。
- 完成读取当前规则、固定版本上游对照、配置/迁移/存储/调用链核查、本机工具限定目录检查。本次写入限隔离启动脚本、对应测试与本文档；没有改主路线、边界评估、CLAUDE.md、产品正式启动逻辑或其他代理文件；没有 commit/push。
- 未进行 PostgreSQL 连接、迁移执行、完整服务器启动、登录、新书、工具、WS、重启、备份恢复或 EXE 验收。缺少 Podman 与匹配 Bun，Docker 服务/镜像状态未知；此外源码本身有上述确定阻塞。
- **后续继续跟进 PostgreSQL；T1.1b 应保持“兼容核查与 S0 隔离修复完成，其余适配与真实验收待做”。** 本文不是删除 PostgreSQL 路线或自动迁移用户数据库的依据。
