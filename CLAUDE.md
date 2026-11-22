# NovelFork 开发约定

NovelFork 是网文小说 AI 辅助创作工作台。本文件是本仓库唯一维护的项目规则正文，描述开发、验证与发布时的长期约定；根 `AGENTS.md` 仅作为读取本文件的兼容入口，不维护另一套规则。

## 指令优先级

```text
NarraFork 宿主系统与开发者规则
  > 当前用户指令
  > 当前 Dynamic Spec 任务
  > 用户明确指定的当前 Kiro Spec
  > 本文件
  > 历史计划、历史 Spec、历史记忆与上游参考文档
```

- 当前用户指令始终可以覆盖历史架构与计划。
- 始终使用简体中文回复。
- 根 `package.json`、根 `main.ts` 和当前源码是启动、构建及运行行为的事实来源。

## 工作目录与仓库边界

日常开发**只在** `D:\DESKTOP\novelfork`（本仓库根）进行。不要把临时脱敏镜像、公开候选 worktree 或旁路目录当成主开发环境。

```text
本仓库（NovelFork 产品）
├─ 公开跟踪：产品代码、Bridge、构建与发布脚本
└─ 本地存在、Git 忽略：packages/narrafork-runtime-private/（唯一生产 Runtime 来源）

Runtime 源头权威（公开仓库，不在本仓库内）
└─ NarraFork/novelfork-runtime（NarraFork/NarraFork 的 fork，MPL-2.0）
   当前 fork 分支：novelfork/upgrade-0.9.15（头 a4c7c709 = MPL 快照 source/v0.1.1 = v0.1.1 发货树（同版本重发，首发为 48d445ac），已推送；
   上游锚点 release: v0.9.15 = d2fcd4c8a）

本地辅助（均不提交）
├─ packages/.narrafork-runtime-sync/          宿主 git 库：公开上游镜像 + 公开 fork 分支（worktree 从这里开）
├─ packages/.narrafork-runtime-baseline-<版本>/  纯上游同锚点基线 worktree（0.8.3、0.9.11、0.9.15，对照 tsgo / 测试用）
├─ packages/.narrafork-runtime-upgrade-<名>/    fork 分支 worktree（0.9.15 为当前主线，其余为旧版或专项分支）
├─ packages/.narrafork-runtime-wt-<名>/         功能分支 worktree（如 self-update、startup-ux，合入主线后可保留留档）
├─ packages/.narrafork-runtime-upstream-pr/     向上游提 PR 的 worktree（经 vivy-public = vivy1024/NarraFork）
├─ .runtime-backup-v0.9.11-20261122/          升级 0.9.15 前的物化目录备份（回滚用）
└─ .runtime-backup-v0.7.12-20261008/          更早的物化目录备份
```

| 路径 | 角色 | Git |
|---|---|---|
| `packages/core/` | 通用基础设施 | 跟踪（公开） |
| `packages/studio/` | 产品前端与工作台 | 跟踪（公开） |
| `packages/novel-plugin/` | 小说领域逻辑与写作 UI | 跟踪（公开） |
| `packages/novelfork-product-runtime/` | 产品 Runtime 适配、书籍绑定、产品路由 | 跟踪（公开） |
| `packages/narrafork-runtime-bridge/` | Studio/产品层与 Runtime 的窄契约 | 跟踪（公开） |
| `packages/fitness-plugin/` | 示例/扩展插件 | 跟踪（公开） |
| `packages/narrafork-runtime-private/` | 可运行的完整 Runtime 物化树（= 公开 fork 分支内容） | **ignore，仅本地**（例外：`UPSTREAM.lock.json` 作为来源元数据被跟踪） |
| `packages/.narrafork-runtime-sync/` | 宿主 git 库：公开上游镜像 + 公开 fork 分支 | **ignore，仅本地** |
| `NarraFork/novelfork-runtime` | Runtime fork 权威仓库，当前分支 `novelfork/upgrade-0.9.15` | **独立公开仓库（MPL-2.0，不在本仓库内）** |

### 公开边界（硬约束）

- 上游 Runtime 已开源（`NarraFork/NarraFork`，MPL-2.0，2026-02 起），我们的 Runtime 定制也全部公开在 fork `NarraFork/novelfork-runtime`——**「Runtime 源码不可公开」的时代已结束**，公开边界收敛为两条：
  1. **单一权威源**：本仓库不得跟踪物化树（`packages/narrafork-runtime-private/` 仅 `UPSTREAM.lock.json` 例外）。Runtime 改动只能在 fork `NarraFork/novelfork-runtime` 的分支上落下、导出物化；两边同时长就是双权威。
- 不提交密钥、Token、`.env`、用户数据；本地辅助目录（`packages/.narrafork-runtime-*`、`.runtime-backup-*`）不进入 Git。
- 历史遗留的 `NarraFork/novelfork-runtime-private` 已于 2026-10-09 archive 只读封存（**仍存在**：`gh api` 查得 `archived=true, private=true`，`git ls-remote` 仍可读到 HEAD），不再作为 Runtime 远端。本地宿主库 `packages/.narrafork-runtime-sync` 的 `origin` 已于 2026-10-16 改指公开 fork。见「已知的假象与坑」。
- 边界检查：`pnpm check:boundary`（当前文件）、`.githooks/`（提交 / 推送前，`git config core.hooksPath .githooks` 启用）、公开 CI（PR 的每个提交）共用 `scripts/check-public-boundary.mjs`。
- 公开 GitHub Actions **不负责**完整 Runtime 构建。发版门禁是：主仓库本地完整测试 + 本地编译发布产物 + 用 Windows EXE 做功能核验（详见「多平台发版流程」）。

## 架构边界

```text
packages/studio/                     NovelFork 产品前端与通用工作台
packages/novel-plugin/               小说领域：写作、章节、Lore、Narrative Memory、工作台
packages/core/                       通用基础设施
packages/novelfork-product-runtime/  产品 Runtime 适配、书籍绑定与领域路由
packages/narrafork-runtime-bridge/   Runtime 与产品层之间的受控契约（可公开）
packages/narrafork-runtime-private/  本地 ignore：唯一生产 Runtime 物化树
```

- NovelFork 产品前端和写作工作台保持为产品界面。
- NarraFork Runtime 提供 Agent、权限、工具循环、会话持久化和实时通信等后端能力。
- 小说领域逻辑归属 `packages/novel-plugin/`；`core`、`studio` 与 Bridge 仅提供通用契约和宿主能力。
- Runtime 通过受控产品契约及可信书籍绑定访问小说数据；前端或模型不应直接构造书籍路径、项目或 narrator 标识。
- `packages/narrafork-runtime-private/CLAUDE.md` 只是上游迁入树内的参考，**不能**覆盖本文件或当前产品决策。

## 在 NovelFork 里怎么开发

### 1. 起手必做

1. 工作目录确认在仓库根：`D:\DESKTOP\novelfork`。
2. 需要完整本地可运行能力时，确认 `packages/narrafork-runtime-private/` 已物化存在（唯一生产 Runtime，来源为公开 fork `NarraFork/novelfork-runtime` 的 fork 分支，经 `pnpm runtime:sync` 导出）。
3. 先读当前用户目标与相关源码/报错；不要假设旁路仓库或历史计划就是待办。

### 2. 改哪里

| 目标 | 优先改动位置 |
|---|---|
| 写作工作台 / 书籍章节 UI | `packages/studio/`、`packages/novel-plugin/` |
| 书籍绑定、产品权限、产品 API | `packages/novelfork-product-runtime/` |
| 通用模型/存储/插件契约 | `packages/core/` |
| 与 Runtime 的类型/面板契约 | `packages/narrafork-runtime-bridge/` |
| Runtime 通用接入补丁 / 嵌入面板 / Product Host SPI | **公开 fork** `NarraFork/novelfork-runtime` 的 fork 分支（宿主库 `packages/.narrafork-runtime-sync` 开 worktree 改动），提交推送后经 `pnpm runtime:sync` 导出物化目录 |
| Runtime 本体行为 | 上游 `NarraFork/NarraFork`（公开，MPL-2.0）；升级见「Runtime 上游同步与 Fork 升级」，**禁止**为图方便把产品逻辑写进 Runtime fork 层解决（fork 层只放接入补丁） |

### 3. 实现原则

1. 选择当前任务需要的最小改动。
2. 沿用现有模块边界、类型约定和错误处理方式。
3. 需要独立调查或隔离上下文时再使用 subagent；不把 subagent、Skill 或计划流程当成固定步骤。
4. 不以 mock、假数据或临时旁路代替真实能力。
5. 未经授权不 `git reset --hard`、不清理用户工作区、不强制推送、不删除数据库文件。

### 4. 验证

- 后端：真实 HTTP/API、运行日志或目标测试。
- 前端：实际启动应用并用 Browser 验证；必要时保留截图。
- 打包：`pnpm build` / `pnpm compile` 等当前 scripts；发版前用生成的 Windows EXE 做功能核验（见「多平台发版流程」）。
- 类型检查是辅助证据；用户可见功能要有实际运行证据。
- **不要**用公开 CI 代替本地 Runtime 完整能力验证。

#### 隔离验证实例（写数据前必读）

任何需要注册账号、改用户偏好或写数据的验证，**必须**用隔离实例：

```bash
bun scripts/start-isolated-verify.ts --port=4613
# 前端连它：NOVELFORK_RUNTIME_PORT=4613 pnpm run --cwd packages/studio dev
```

只设 `NOVELFORK_PROJECT_ROOT` **不构成隔离**。`main.ts` 把 `NOVELFORK_RUNTIME_DIR` 与 `NOVELFORK_STORAGE_DB_PATH` 默认到 `NOVELFORK_HOME`（未设置时为 `~/.novelfork`；用户可能已把它指向其他盘的真实数据），因此账号、用户偏好仍会写进用户真实的 `<NOVELFORK_HOME>/.runtime/narrafork.db`。历史上已有多个测试账号因此残留在用户库里。必须同时设置的变量：`NOVELFORK_HOME`、`NOVELFORK_PROJECT_ROOT`、`NOVELFORK_BOOKS_ROOT`、`NOVELFORK_RUNTIME_DIR`、`NOVELFORK_SESSION_STORE_DIR`、`NOVELFORK_STORAGE_DB_PATH`（上面的脚本已固化）。

Runtime 的 `NARRAFORK_HOME` 由 `main.ts` 从 `NOVELFORK_RUNTIME_DIR` 推导并强制覆盖；用户环境里继承的 `NARRAFORK_HOME` 属于同机独立运行的 NarraFork 宿主，产品不得读取。直接在 `packages/narrafork-runtime-private/` 里跑 `bun test` 时，先清掉继承的 `NARRAFORK_HOME` 与 `NOVELFORK_HOME`（`env -u NARRAFORK_HOME -u NOVELFORK_HOME bun test ...`）：测试 preload 遇到继承的 `NARRAFORK_HOME` 会报错，但 `bun test` 不会因此中止，后续测试文件会打开那个宿主的真实数据库。`pnpm test` 已处理这一点。

其他约束：

- 端口避开用户常用的 `4567` 与开发 Runtime 的 `7778`；验证前先确认目标端口没有正在运行的实例，不要连到用户自己的进程上。
- 始终带 `NOVELFORK_NO_BROWSER=1`，不弹窗占用用户屏幕。
- 验证结束后停掉自己启动的全部进程并清理临时数据目录。
- 已经写进用户真实数据库的残留数据，属于用户数据：先如实报告并取证（影响了哪些表、哪些行），**取得明确授权后**才能删除，并先导出可回滚的行快照。

### 5. 交付

简要说明：实际修改的文件与行为；实际执行的验证；已知限制或未完成项。

## Skill 使用原则

NarraFork 宿主的 Skill 机制是方法论补充，不是另一套任务或审批系统。宿主规则和当前任务始终优先。

- 顶层对话由宿主处理 `arming-thought`；它只用于建立事实优先的工作方式，不创建额外任务或计划。
- 信息不足、需要一手事实时使用 `investigation-first`；已有明确源码、日志或验收证据时不重复调用。
- 存在多个冲突目标、根因或优先级不清时使用 `contradiction-analysis`；资源和注意力分散时使用 `concentrate-forces`。
- 方案需要真实运行验证或迭代时使用 `practice-cognition`；阶段验收、评审或收到明确反馈时使用简短的 `criticism-self-criticism`。
- 只有确有对应场景时使用 `overall-planning`、`mass-line`、`protracted-strategy` 或 `spark-prairie-fire`。
- UI 实现才使用 `shadcn`；寻找可复用组件时使用 `shadcn-component-discovery`；完成自定义 UI 后使用 `shadcn-component-review`。
- 用户引用某个 slash command 或明确点名 Skill 时，调用对应 Skill。
- 一次选择最少且最相关的 Skill。Skill 不能改变用户目标、扩大范围、替代真实验证，或自动创建任务、记忆、提交和发布。

## 任务与规划

- 对非平凡执行工作，使用 `spec://tasks.json` 记录当前任务；保持一个明确的 `doing` 主任务。
- 任务应包含目标、范围和可验证完成条件。
- `spec://index.md` 可记录当前有效的事实和简短设计说明。
- Kiro requirements/design/tasks 仅在用户明确指定为当前工作时作为执行规格。
- `.narrafork/plan-*.md`、历史 Kiro Spec、Engram 与 `.narrafork/memory/` 用于查阅背景，不自动构成待办事项。
- `spec://behavior_fence` 仅在用户明确要求记录持久行为约束时修改。

## Runtime 接入原则

- Runtime 负责 narrator、消息、工具调用、权限、WebSocket 恢复和运行时状态。
- NovelFork 继续管理书籍、章节、Lore、Narrative Memory 与写作业务数据。
- 复用 Runtime 的 Agent Loop、Permission、Prompt、Compact、WebSocket 和 Tool Executor；不要平行实现第二套通用 Agent 引擎。
- 书籍与 Runtime 的关联必须经由服务端可信绑定解析，并在读取、执行和写入时遵守访问控制。
- Runtime 接入不自动触发前端替换、数据迁移、旧功能删除或发布；这些工作需要独立任务。

### Runtime、Studio 与小说产品的实际组合

```text
NovelFork Studio（产品壳）
  ├─ 写作工作台、书籍/章节/Lore 界面：Novel Plugin
  ├─ 原生叙述者面板：运行时复用 Runtime 的 EmbeddedNarratorDockHost
  └─ API / WebSocket：连接 NarraFork Runtime

NarraFork Runtime（本地 ignore 的物化树；源头在公开 fork NarraFork/novelfork-runtime 的 fork 分支）
  ├─ Agent Loop、Provider、权限（统一 ACL 内核）、会话、消息、工具循环、WebSocket 与运行时状态
  ├─ 维护 NarratorPanel 的核心行为、状态与通用前端依赖
  └─ 经由 Product Host SPI 调用 NovelFork 产品能力

NovelFork Product Runtime
  ├─ 解析服务端可信的书籍与 narrator 绑定
  ├─ 提供产品路由、领域工具、访问控制与产品上下文
  └─ 调用 Novel Plugin / Core 管理书籍、章节、Lore 与 Narrative Memory
```

- **Runtime 的职责**：拥有 Agent 真实执行、Provider、权限、会话、消息、通用工具执行器和实时连接。禁止在 Studio、Novel Plugin 或 Product Runtime 中平行实现第二套通用 Agent Loop、权限系统或消息同步层。
- **NovelFork 的职责**：`novel-plugin`、`core`、`novelfork-product-runtime` 拥有书籍、章节、Lore、Narrative Memory、写作业务、领域工具和产品权限。Runtime 不得直接承载这些产品数据、迁移或业务路由。
- **Studio 的职责**：产品壳与写作界面；开发环境通过 Vite 代理把 `/api` 与 WebSocket 转给 Runtime（默认端口 `7778`）；生产由 Runtime 服务 Studio 产物。产品验收必须使用已认证的 Studio 浏览器上下文。
- **原生面板复用**：`RuntimeNarratorPanelMount` 必须运行时复用 Runtime 的 `EmbeddedNarratorDockHost`，而不是复制/mock `NarratorPanel`。NovelFork 只通过正式扩展点注入 capability 守卫、可信书籍上下文和领域工具结果渲染。
- **受控 Bridge**：`packages/narrafork-runtime-bridge/` 是稳定窄契约层。Vite/Vitest 运行时 alias 可解析到本地 Runtime 真实实现；TypeScript 类型契约只依赖 Bridge，禁止在 Studio `tsconfig` 用 `@frontend/*` / `@shared/*` 宽映射扫进整个 Runtime 前端树。
- **可信绑定**：前端、模型或工具调用不得自行拼装书籍路径、项目路径或 narrator 标识。

## Runtime 上游同步与 Fork 升级（严格）

Runtime 自 2026-10-08 起采用**公开线 git fork 模式**（此前的私有线流程及更早的 archive+overlay 重放均已停用，留档在本节末「变迁历史」）：

```text
NarraFork/NarraFork              上游公开 main（MPL-2.0，无 tag；版本锚点 = main 上 release: vX.Y.Z 提交）
        │ git merge（常规三方）／历史再被重写时退回树级移植
NarraFork/novelfork-runtime      公开 fork，分支 novelfork/upgrade-<版本>
        │ git archive（pnpm runtime:sync）
本地物化 packages/narrafork-runtime-private/   fork 分支导出物（gitignore，只认 UPSTREAM.lock.json）
        ▲
宿主库 packages/.narrafork-runtime-sync/   公开上游镜像 + 公开 fork 分支，worktree 从这里开
```

- fork 层 = product-host SPI + runtime-migrations + 宿主组件 + 嵌入宿主接线；逐文件明细与移植记录见 `UPSTREAM.lock.json` 的 `provenance`。
- 本地物化目录是 fork 分支的**导出物**：不直接改物化目录；改动在宿主库 fork 分支提交 → 推送公开 fork → 更新 `UPSTREAM.lock.json` → `pnpm runtime:sync` 导出。物化目录不进公开仓库（例外 `UPSTREAM.lock.json`）。
- `runtime-migrations/` 在 fork 仓库与物化目录各有一份：`server/db/run-migrations.ts` **优先读 runtime-migrations/**（fork 层资产），新迁移必须两处同步。
- **远端都用 HTTPS**：本机 SSH 被代理阻断（`Connection closed by 198.18.0.18`），`git@github.com:` 形式的 remote 会直接失败。

### 升级流程（当前有效，2026-10-08 起为公开线流程）

上游 Runtime 已开源（`NarraFork/NarraFork`，MPL-2.0，main 无 tag，版本锚点 = main 上 `release: vX.Y.Z` 提交）。fork 已切换到公开线（0.8.3 由树级移植完成，见 `docs/design/Runtime-0.8.3-升级评估.md` 与 `docs/design/上游开源跟进策略.md`）。

1. `GIT_DIR=packages/.narrafork-runtime-sync git fetch upstream-public main`，例行先查锚点：`git log --grep='^release: v' upstream-public/main`；再查历史连续性：`git merge-base --is-ancestor <上次基点> upstream-public/main`——若上次基点不在公开历史（上游又重写了），退回树级移植而非 merge。
2. 从公开锚点开分支 `novelfork/upgrade-<版本>`（worktree 放 `packages/.narrafork-runtime-upgrade-<版本>`，纯基线对照 worktree 另开 `--detach`）。
3. `git merge upstream-public/main`——常规三方合并（公开线fork 层冲突面以当次评估为准）；首次从私有线换轨按 0.8.3 的树级移植（49 独有 checkout / 单边重放 / 手工冲突 / 删除跟随）。
4. 补齐上游缺失项：上游自 0.9.12 前后已跟踪 SQLite `drizzle/`，合并时原样跟上游，**不要往 `drizzle/` 加文件**；只对 fork 层的 `runtime-migrations/` 以其末版快照为基线 `bunx drizzle-kit generate` 生成增量（输出指向临时副本再拷回，不手改），生成的快照应与上游 `drizzle/meta` 末版除 id/prevId 外一致；语义期 typecheck 本机可能 OOM，可按 server/frontend 拆分 include 分段跑）。
5. 验证：与**纯上游同锚点基线** worktree 对照 tsgo（合并独有错误应为 0，已知 codegen 恒红家族豁免）；权限/agent 工具/迁移缺口相关套件由红转绿；双路径迁移（新库从零 + 旧库升级哨兵）；隔离实例冷启动 + 工序闸门拦/放 + 权限过滤各一例；EXE 冒烟（Bun 版本按 Runtime `packageManager`，0.9.11 起 1.4.3；`bun run compile`，旧库副本升级 + health + 零 error）。
6. 推送 fork 分支到公开仓 `NarraFork/novelfork-runtime` → 备份旧物化目录到 `.runtime-backup-v<旧版本>-<日期>/` → 更新 `UPSTREAM.lock.json`（repository/remote 指公开仓，provenance 记 publicBase/virtualBase/移植方式）→ `pnpm runtime:sync` 导 → `bun install` → 主仓定向契约（`RUNTIME_WORKER_ENTRIES` 随上游 Worker 增减对齐，契约测试先行报缺）→ 全仓 typecheck + 测试 → master 提交推送 → MPL 快照：**`source/vX` 分支必须等于 vX 实际发货 EXE 里的 Runtime 树**（与 `UPSTREAM.lock.json` 的 commit 核对一致后再打；只追加不 force-push）。2026-10-09 教训：升级窗口顺移后快照分支名与实际发货树错位过一次，发版前一刻必须核对这个等式。
7. 已知锚点：公开 v0.7.12 = `f275816a4`；公开 v0.8.3 = `be6240400`；公开 v0.9.11 = `5c6cbebb5`；公开 v0.9.15 = `d2fcd4c8a`（当前 fork 分支 `novelfork/upgrade-0.9.15` 的合并基点，2026-11-22 合并 816 个上游提交、22 个冲突）。
   - 0.9.11 → 0.9.15 升级记录见 `CHANGELOG.md` 的 v0.1.1 节与 `UPSTREAM.lock.json` 的 provenance。上游 main 在 0.9.15 之后加了 Teams（`server/services/teams/`、`Team` 工具、删项目的 `projectHasTeams` 守卫与单事务）；下次升级时 fork 的 `deleteProjectById` 导出要并入该守卫。
   - 产品编译定义的编译期常量（`packages/studio/product-build-identity.ts`）让 Runtime 更新器只认 NovelFork 自己的 Release；fork 的 `shared/build-product.ts` 未注入时保持上游行为。
   - 0.8.3 → 0.9.11 升级记录见 `CHANGELOG.md` 的 v0.1.0 节（上游删除 chapters 层、叙述者改挂项目，产品层改按 `context_project_id` 认书）。
   - 注意公开 0.8.3 锚点树自带 3 处历史重写的文本损坏（settings/index.ts 声明丢失、narrator-event-handler 截断、malformed-request-dump 残片），已在 fork 分支用 main 头文本修复；纯基线对照跑测试会复现这些损坏，属上游重写残损非 fork 问题。
   - 0.7.x 起 Agent 循环主体在 `server/services/agent-runtime/orchestrator.ts`，fork 的产品叙述者判断收在 `server/services/product-narrator-tools.ts`；上游不跟踪 SQLite `drizzle/`。

### 已知环境噪声（不要当成缺陷追查）

- **宿主库 `git status` 会报约 2689 个"已修改"文件，是假的。** 内容哈希与索引、HEAD 三方一致，`git diff HEAD` 只有个位数真实改动；`update-index --really-refresh` 与 `git reset` 都清不掉，属文件系统层 stat 问题。以真实 `git diff` 为准。
- **物化树的 tsgo typecheck 恒红**，源于 `frontend/routeTree.gen.ts`、`server/generated/embedded-licenses.ts` 等构建期 codegen 产物不在跟踪文件里（0.6.5 时代同样如此）。判断合并是否引入问题，要与**纯上游同版本基线**对照，不是看绝对错误数。
- 上游 0.6.6 的 `bash-analyze.test.ts` 有一条假设 POSIX 路径解析的测试，在 Windows 上必然失败，非本地引入。
- Runtime 全量测试在本机：`memory-snapshot.test.ts` 会卡死（纯上游 0.9.15 基线同样），全量跑需排除它；`pool-user-browser.test.ts` 会从本机 Puppeteer 缓存找到 Chrome 并**真的弹出有头窗口**约 1 秒，用户在用屏幕时不要跑；`db-worker pool` 部分用例在 Windows 上漂移；`shutdown-activity` / `sqlite-template` / `remote-access/supervisor` 各有因 fork 结构导致的固定失败。
- 主仓 `bun test scripts/<名>` 会按文件名顺带扫到 `tmp/`、`酒馆预设兼容/` 下的旧副本而报失败，用显式 `./scripts/<名>` 路径；`scripts/start-isolated-verify.postgres-contract.test.ts` 有 4 条测试写法导致的固定失败。
- **停止验证用的 EXE 只能按自己启动的 PID**（`taskkill /PID <pid> /T`），不要按进程名 `/IM` 结束，用户可能开着自己的 NovelFork。
- **`packages/.narrafork-runtime-sync` 的 `origin` 已于 2026-10-16 改指公开 fork `NarraFork/novelfork-runtime`**（原先指向已 archive 的私有仓 `NarraFork/novelfork-runtime-private`，那个仓仍在、archived+private，但不再是 Runtime 远端）。改指后 `bun scripts/sync-runtime.ts --check` 实测仍对齐（退出 0）。`upstream-public` 仍指向上游 `NarraFork/NarraFork`，未动。

### 变迁历史（均已停用，仅历史排查参考）

**私有线 fork 模式（2026-08-20 → 2026-10-08，已停用）**。当时的 Runtime 源头是私有 fork `NarraFork/novelfork-runtime-private`（分支 `novelfork/integration-v0.6.6` 起），宿主库为 `packages/.narrafork-runtime-fork-staging/`，升级 = 私有 fork 上 git merge 上游。上游 2026-02 开源（公开历史全量重写、与私有线不相交）后，0.8.3 起改走公开线（见上文流程）。**私有仓已于 2026-10 删除**，仅作历史记录；fork 层原始出处 `42641a32`（2026-08-20 `feat(runtime): materialize`）。

**archive+overlay 重放（更早期）**。当时以 `UPSTREAM.lock.json` 的 commit/tree 为哈希绑定基线、以 overlay manifest 的 SHA-256 精确补丁重放；fork 化后这些约束由 git 天然满足。`bun scripts/import-narrafork-runtime.ts --source <checkout> --report-only` 的影响报告仍可用于冲突预估，但它引用的 `packages/.narrafork-runtime-import/`（含 zstd 工具链）已在 2026-10-09 目录大扫除时删除，要用须重新准备工具链。该时代的残留缓存与 `packages/narrafork-runtime-overlay/` 已于 2026-09-17 清理，overlay 私有仓库同日删除。

## 单一权威源（硬纪律）

每类信息只有一个权威源；其他位置只能是**导出物**或**派生视图**，不得双向同步。

| 信息 | 唯一权威源 | 其他位置的角色 |
|---|---|---|
| 卷纲 | 经纬 `outline` 条目（`fields_json.volumes`） | `story/volume_outline.md` 仅导出 |
| 伏笔 | 经纬 `foreshadowing` 条目（状态存 `fields_json`） | `story/pending_hooks.md` 仅导出；记忆 `hook` fact 只作证据 |
| 章摘要 | 经纬 `chapter-summaries` 条目 | 记忆事件摘要仅在经纬缺失时兜底 |
| 角色/关系/世界「当前设定」 | 经纬对应分类（`layer=dynamic` 可变） | 拆书 JSON 仅调试快照 |
| 章后事实与事件流 | Narrative Memory（`narrative_fact` / `narrative_event`） | 无文件权威源 |
| 角色弧 beats | `jingwei_character_arc` | 无 |
| 文风 | 每书一份 `story/style_preset.json`：通用写法、带证据及审核状态的来源规则/范文、本书声音与原则、统计指纹、作者硬约束（`customConstraints`）。指南由已确认且可迁移的规则派生；本书设定仍归经纬 | 旧 `story/style_profile.json` 仅在没有新预设时只读兼容，首次显式保存后不再生效；导入正文不得覆盖文风。自动蒸馏与按场景范文检索见 T2.2 / T2.4；硬约束不进合成指南，只随人文化润色与划词 AI 的叙述者指令注入 |
| 诊断结果（preflight / publish / audit） | 不落盘，一次性返回 | 无 |

配套规则：

- **发现重复表达时删掉弱的一方，不加同步逻辑。**
- **能派生的状态不存储**（如伏笔阶段应由推进记录算出，而非另存一列）。
- 分类的层级由 `CATEGORY_META.defaultLayer` / `allowCanon` 表态决定，不靠内容正则猜测；随剧情推进的分类禁止写 canon。
- 机器抽取的产物一律写 `layer=dynamic` + `status=needs-review`，作者确认后才可升 canon。
- 所有拦截与告警必须带 `explanation`（发生了什么 / 为什么要看 / 建议怎么做）；前端与叙述者不得按 code 自造文案。

## 交付定义（DoD 补充）

- **旧入口必须同步下线**：新功能取代旧功能时删除旧入口，不允许侧栏/面板新旧并存。
- **半成品默认隐藏**：做不完的功能标注实验性并默认不可见，不摆在正式 UI 里误导用户。
- 工具在 `tool-registry` 声明的 `renderer` 必须已在 Studio 侧注册，或显式声明走 generic。

## 代码质量与安全

- 先读取事实再作判断，避免基于假设修改行为。
- 保持用户已有的工作区改动；未经授权不还原、删除或覆盖。
- 使用宿主提供的代码图谱、文件搜索和编辑工具；工具名称和参数以当前宿主实际提供的版本为准。
- 数据库结构变更遵循目标 package 的 schema 与迁移生成流程；不手改生成迁移，不删除数据库文件。
- 产品库迁移（`packages/core/src/storage/migrations/`）新增或改动后运行 `bun scripts/generate-embedded-migrations.ts` 重新生成 `embedded-migrations.ts`（EXE 唯一的迁移来源），不要手改。迁移校验和连注释一起算；嵌入副本与文件走样会让开发环境与 EXE 迁移过的库互相打不开，一致性测试会逐字比对。已应用的迁移文件不要再改。
- 不提交密钥、Token、`.env`、用户数据，以及 Runtime/overlay 私有源码。

## 常见错误行为（不可重犯）

1. **别把调研/了解当成被要求的任务**：用户说"看看 X"时，是要你了解 X 然后按用户真正的目标行动，不是要你写一份审计报告。
2. **别替用户做决定后再问确认**：用户说"你来做"就直接做；只在需要不可逆操作或真的缺信息时问。
3. **别在同一个会话里重复解释同一个阻塞**：blocked 任务如果自己能解就解，只报告一次。
4. **构建和测试路径以根 package.json scripts 为准**：不要自行猜测命令。
5. **全程中文回复**：包括 commit message、注释、文案，除非代码本身是英文变量名。
6. **不要操作用户正在使用的屏幕**：不启动 GUI、不打开浏览器窗口、不移动鼠标，除非明确授权。
7. **不要把视频制作停在"写完代码"**：必须 headless 渲染出 MP4 并报告路径。
8. **不要用用户的真实数据库做验证**：需要注册账号或写数据时用 `bun scripts/start-isolated-verify.ts`；只设 `NOVELFORK_PROJECT_ROOT` 会把测试账号写进 `~/.novelfork/.runtime/narrafork.db`（详见「隔离验证实例」）。

## Git 与发布

- 不执行 `git reset --hard`、`git checkout --`、`git clean`、强制推送、历史重写或其他破坏性操作，除非用户明确授权。
- 只有在用户明确要求时才创建 commit、push、tag 或 Release。
- 主仓库提交不得重新引入 `packages/narrafork-runtime-private/` 的源码；该目录仅 `UPSTREAM.lock.json` 被跟踪，提交它需 `git add -f` 并逐次核对暂存集只含这一个文件。
- Runtime 本体变更：先在宿主库的 fork 分支上提交、推送到公开 fork `NarraFork/novelfork-runtime`，再更新 `UPSTREAM.lock.json` 并 `pnpm runtime:sync` 导出物化目录。私有仓已 archive（2026-10-09），不再作为远端；overlay submodule 已于 2026-09-17 随目录与远端仓库一并移除（`.gitmodules` 现为空文件）。
- 推送主仓库前跑 `pnpm check:boundary`（启用 `.githooks` 后自动检查即将推送的每个提交）。
- **改动 `.github/workflows/` 的推送需要 `workflow` 权限。** 本机 `git` 默认用 Git Credential Manager 的令牌，没有这个权限，GitHub 会拒收并报 `refusing to allow an OAuth App to create or update workflow ... without workflow scope`（新增、修改、删除工作流文件都算）。做法：先一次性执行 `gh auth refresh -h github.com -s workflow`（按提示在浏览器确认），之后这类推送改用 gh 的凭据：`git -c credential.helper= -c "credential.helper=!gh auth git-credential" push origin master`。不涉及工作流文件的推送不受影响。一次推送多个分支或标签时，只有含工作流改动的那个会被拒、其余照常推上去，必须逐行核对推送输出。
- 发布前完成与改动相称的本地构建/测试，并用 Windows EXE 做发版前功能核验。
- 公开仓库可见性变更前，必须确认：当前 tip 无私有 Runtime 源码，且历史策略已明确（清理历史或接受风险——默认不接受历史泄露）。

### 多平台发版流程

发布产物与 NarraFork 通用 Runtime 的目标矩阵一致，共 7 个：

| 平台 | 产物名（`dist/`） |
|---|---|
| Windows x64 | `novelfork-v<版本>-windows-x64.exe` |
| Windows x64 baseline | `novelfork-v<版本>-windows-x64-baseline.exe` |
| Linux x64 | `novelfork-v<版本>-linux-x64` |
| Linux x64 baseline | `novelfork-v<版本>-linux-x64-baseline` |
| Linux arm64 | `novelfork-v<版本>-linux-arm64` |
| macOS arm64 | `novelfork-v<版本>-macos-arm64` |
| macOS x64 | `novelfork-v<版本>-macos-x64` |

baseline 变体面向不支持 AVX2 的旧 CPU 与部分虚拟机，缺它会让老机器直接崩在启动阶段，属于必发资产。

命令（以根 `package.json` 为准）：

```bash
pnpm compile            # 仅本机 Windows x64，日常核验用
pnpm run compile:windows # Windows x64 + baseline
pnpm run compile:linux   # Linux x64 + baseline + arm64
pnpm run compile:macos   # macOS arm64 + x64
pnpm run compile:all     # 全部 7 个平台，发版用
```

全部平台都在 Windows 本机交叉编译，无需 Linux/macOS 机器或 CI。

发版步骤：

1. `pnpm test` 与相关 typecheck 通过，工作区无意外改动。
2. 更新版本号与 CHANGELOG，`pnpm run compile:all` 一次性产出 7 个平台产物。
3. 用当次编译出的 `windows-x64.exe` 做功能核验（不是旧产物），核验必须含两条路径：
   - **真实库副本升级**：把 `<NOVELFORK_HOME>` 整个复制到临时目录再启动（v0.0.4 曾借此抓到迁移哈希误报阻断项，光测空库测不出来）；
   - 空库冷启动 + health ready、首页 200、日志零 error。
4. MPL 快照核对：`UPSTREAM.lock.json` 的 commit == 公开 fork `source/v<版本>` 分支头——该分支就是随 EXE 分发的 MPL §3.2 源码提供载体，Release 说明须附链接。
5. 只有在用户明确要求时才 commit、tag、push 与创建 Release；上传时带上聚合校验和文件。

产物校验：每个产物旁生成 `<产物名>.sha256` 与 `<产物名>.metadata.json`（自动更新用，必须上传）；多平台构建额外生成 `dist/novelfork-v<版本>-SHA256SUMS` 汇总全部产物，Release 资产以它为准。

Bun 版本：编译用的 Bun 必须与 Runtime `package.json` 的 `packageManager` 完全一致（Runtime 0.7.10–0.8.3 为 1.4.2，0.9.11 起为 1.4.3，脚本常量 `REQUIRED_RUNTIME_BUN_VERSION`），不一致时编译在开头就报错。产物内嵌的就是这个 Bun，与上游发布和测试用的版本对齐。注意版本检查的是**每个进程**的 `Bun.version`：本机 PATH 上是旧版（1.3.13）时，光用绝对路径调 1.4.3 不够——编译脚本嵌套 spawn `bun` 子进程仍按 PATH 解析，会在中途炸掉。正确姿势是把 1.4.3 目录前置 PATH 跑整条链（官方 zip 解压到 `tmp/bun-1.4.3/extracted/`，按 release 的 SHASUMS256.txt 校验）：

```bash
PATH="$PWD/tmp/bun-1.4.3/extracted/bun-windows-x64:$PATH" bun run compile:all
```

`.build-tmp/` 是构建脚本 `statfs` 的常驻 scratch 目录（已在 `.gitignore`），目录大扫除时也不得删除，否则编译炸在 `statfs ENOENT`（2026-10-09 实例）。

Runtime 的 Worker：`new Worker()` 的路径打包器不跟随，Runtime 自己的编译脚本把这些模块列为额外入口。产品编译在临时工作区的 `server/…` 下生成一行导入的垫片作为额外入口（`RUNTIME_WORKER_ENTRIES`），使它们嵌在 Runtime 会探测的路径上；契约测试核对这份清单与 Runtime 编译脚本一致。上游新增 Worker 时测试会失败，照着补上即可。

交叉编译前置条件：Bun 会为每个非本机目标下载独立运行时并缓存在 `~/.bun/install/cache/bun-<target>-v<bun版本>`。首次或网络中断时会出现 `Failed to extract executable for 'bun-darwin-aarch64-...'`。`compile-product-runtime.ts` 因此在准备任何产物之前先用一次性最小编译探测全部目标（失败重试 3 次），所以这类问题会在几秒内失败，而不是在几十分钟的矩阵构建中途炸掉。真的探测失败时，先确认能访问 npm registry，再重跑同一命令即可。

EXE 核验注意：产物启动时会自动打开产品窗口。无头核验必须带 `NOVELFORK_NO_BROWSER=1`，不要在用户使用屏幕时弹窗；同时用 `NOVELFORK_HOME` 指向临时目录，产品各数据路径（两个数据库、Runtime 目录、全局配置、技能、市场数据、窗口配置）随之隔离，不碰用户真实数据。前提是环境里没有单独设置 `NOVELFORK_RUNTIME_DIR`、`NOVELFORK_STORAGE_DB_PATH`、`NOVELFORK_MARKET_DIR` 这类更具体的路径变量，它们优先于 `NOVELFORK_HOME`：

```bash
NOVELFORK_HOME="$(mktemp -d)" NOVELFORK_NO_BROWSER=1 PORT=4599 ./dist/novelfork-v<版本>-windows-x64.exe
```

产物在 Windows 上绑定的是 IPv6 loopback（`[::1]:<port>`）：脚本探测健康端点时用 `localhost` 或 `[::1]`，`curl 127.0.0.1:<port>` 会被拒（浏览器访问不受影响）。

已知限制：非 Windows 产物在本机只能验证交叉编译成功与目标格式（Mach-O / ELF），真实运行行为需要在对应系统上核验。上游 Runtime 的 `latest*.yml`、update-index 分支、zstd 增量补丁与 NarraFork 官方更新服务器都不属于 NovelFork 发版流程。

程序内自动更新（v0.1.1 起）：产品编译把仓库 `vivy1024/novelfork`、产品名 `novelfork`、资产前缀 `novelfork-v` 写入编译期常量，Runtime 更新器经 GitHub Releases API 找 `novelfork-v<版本>-<平台>` 并用同名 `<产物>.metadata.json`（sha256/sha512/size/version/commit）校验后替换 EXE（替换进程沿用 `--serve`）。因此发版硬性要求：**tag 用 `v<semver>`、版本号递增、Release 不能标 prerelease、7 个 `.metadata.json` 必须随产物上传**，缺了该平台就无法自动更新。存量设置里指向 `NarraFork/NarraFork` 或更新服务器的 `settings.update` 会在启动时改写。v0.1.0 的更新器仍指向上游 NarraFork（点更新会被换成 NarraFork），只能手动升级到 v0.1.1。rg/zstd/执行器等辅助组件仍取自 NarraFork 公开 Release（`PRODUCT_HELPER_REPOSITORY`）。

## 当前方向与近期改动（快照：2026-11-22）

本节是状态快照，便于协作者对齐。「后续方向」须经当前用户确认后才执行，不自动构成待办；与当前指令冲突时以当前指令为准。内容过时后直接改写本节，不追加历史。

### 当前版本

- 最新发版 **v0.1.1**（2026-11-22，tag `v0.1.1`，22 个资产含 7 个 `.metadata.json`）：内嵌 Runtime 0.9.11 → 0.9.15、NovelFork 自有自动更新、重复启动聚焦已有窗口与品牌化启动状态页、长任务实时进度与可中断、文风蒸馏后台化、工作流原生写入越界拦截、内置叙述者提示单一来源，以及阶段 9 专项升级。详见 `CHANGELOG.md` 的 v0.1.1 节。
- 上一版 v0.1.0（2026-11-07）：内嵌 Runtime 0.8.3 → 0.9.11、可配置写作工作流与 13 位内置写作帮手、百万字长篇记忆。
- 上游 PR：NarraFork/NarraFork#576（已落盘仍在执行的工具卡显示实时输出）、#577（通用工具运行中进度条），待合并；合并后下次升级 fork 可去掉对应补丁。

### 仍有效的长期事实

| 主题 | 内容 |
|---|---|
| 主题与设计令牌 | 五套书房主题（绿格稿纸默认 / 书函藏青 / 夜更烛光 / 朱砂印谱 / 天青汝窑），各含浅色深色，嵌入的 Runtime 界面一同切换（`runtime-host-theme.css`）。令牌唯一权威源是根 `DESIGN.md`，`pnpm --dir packages/studio run design:tokens` 生成 `novelfork-themes.css`，测试校验一致 |
| 叙述者工具 | 小说工具已收口为 25 个精简工具（`fd2ad7f2`）；产品叙述者默认不带 Bash / Write / Terminal / Browser，按套路装载 |
| 工作流 | 方案是节点图（起点 / 工序 / 汇合 / 终点，按结果分支、打回上游），分草稿 / 已发布并带版本号；越出当前工序的写类小说工具会被拦下（只约束小说工具） |
| 伏笔 | 债务判定收敛到 `foreshadow-debts`；临近 / 超期阈值按书由作者设置（`book.json` 的 `foreshadowDebtThresholds`，默认 5 / 12 章） |
| 画布 | 工作流画布、因果画布与其余故事树统一用 React Flow；视口按「作品 + 视图」记在浏览器里，节点坐标不存（工作流方案的节点位置除外） |
| 仓库历史 | 2026-09-27 改写过本仓库全部分支与标签的历史，此前的提交号全部失效：旧 clone 不要再推送，查历史以新提交号为准 |

### 后续方向

完整任务与完成标准见 [`docs/路线与任务.md`](docs/路线与任务.md)，参考依据见 [`docs/90-参考资料/参考项目学习-2026-09.md`](docs/90-参考资料/参考项目学习-2026-09.md)：

- 阶段 10 · v0.2.0 发版抛光：阶段 9 改动实机验收与 CHANGELOG、浮层与表单控件巡检、章后新会话轻提示、多平台发版准备（发版须作者明确指令）。
- 阶段 11 叙事时空可视化 → 阶段 12 本体与双时态记忆 → 阶段 13 生态增值出口（卷末视频、人物档案卡、分镜预演）。
- 2026-09-28 与作者确认的定位不变：面向公开用户发布；通用能力归 Runtime，NovelFork 只做小说领域。学参考项目的机制不抄原文：PlotPilot（Commons Clause）、笔枢 / Scriverse / InkOS（AGPL）、MuMuAINovel（GPL）的代码与提示词不进仓库。

## 持久记忆

Engram 仅在宿主提供时使用（Claude Code 已配置；Devin Desktop 当前没有），用于保存对后续工作有长期价值的信息，例如：

- 已验证的 bug 根因和修复；
- 已确认的架构或产品决策；
- 影响安全、数据一致性或实现路径的稳定约束。

临时调查、未验证方案和普通操作不需要持久化。需要修订既有记录时，更新对应事实，避免形成相互矛盾的重复结论。

## 视频制作

本仓库需要定期产出宣传与技术演示视频。以下是长期有效的制作规约。

### 工具链与环境（已验证可用）

| 工具 | 版本 | 用途 |
|---|---|---|
| Node | v25.2.1 | Remotion / HyperFrames 宿主 |
| npx | 11.6.2 | 运行视频 CLI |
| Bun | PATH 上 1.3.13；编译用 1.4.3（`tmp/bun-1.4.3/`，见「多平台发版流程」） | 项目构建 |
| FFmpeg | 不在 PATH；可用 `D:\DESKTOP\career-ops-1.5.0\yt_dlp_rc\ffbin\ffmpeg.exe`（OpenClaw `video/mg.ps1` 同一份） | 转码、拼接、压制、音频合流 |
| Python | 3.14.2 | Manim / ASCII-video / 脚本 |

### 出片引擎选择

| 引擎 | 技术栈 | 最适合 | 命令 |
|---|---|---|---|
| **Remotion** | React + TypeScript | 数据驱动动效、字幕、版本角标、信息卡、产品 demo 叠图 | `npx remotion render <id> out/final.mp4` |
| **HyperFrames** | HTML + CSS + GSAP → MP4 | 电影感片头、HUD 科技风、产品 trailer | `npx hyperframes render --output final.mp4 --quality high` |
| **Manim CE** | Python | 原理讲解、算法/架构动画、3Blue1Brown 风格 | `manim -qh script.py SceneName` |
| **ASCII-video** | Python + NumPy + FFmpeg | 极客风转场、音频可视化 | 单 Python 脚本 → ffmpeg pipe |

**默认选择**：产品宣传用 Remotion；技术原理讲解用 Manim；片头/trailer 用 HyperFrames。

### 辅助素材技能

| 技能 | 路径 | 用途 |
|---|---|---|
| `architecture-diagram` | 深色 SVG 架构图 HTML | 四层结构图 |
| `excalidraw` | 手绘风流程图 JSON | 写作管线 |
| `baoyu-infographic` | 21 布局 × 21 风格信息图 | 封面、对比图 |
| `apikey-image-gen` | 生成/编辑图片 | 封面意象 |
| `grok-image-to-video` | 静图 → 短视频 | 氛围镜头 |
| `heartmula` | 歌词 + tags → MP3 | BGM 生成 |
| `media/songsee` | 频谱分析 | 音频可视化 |
| `creative/humanizer` | 去 AI 味 | 旁白文案打磨 |

### 制作硬规则

1. **全程 headless**：不启动 Remotion Studio、不开 HyperFrames preview、不打开浏览器窗口。只用 CLI `render` / `still` / `inspect`。用户明确授权 GUI 时例外。
2. **不操作用户屏幕**：不移动鼠标、不使用 computer-use、不进行屏幕捕获。录屏由用户手动完成。
3. **渲染前先验证**：Remotion 先 `npx remotion still` 一帧确认编译通过；HyperFrames 先 `lint` + `inspect`；Manim 先 `-ql` 草稿。
4. **物料独立目录**：视频项目不写入产品 git 仓库。当前 NovelFork 宣传片在 OpenClaw 视频管线里（`D:/DESKTOP/openclaw/video/projects/novelfork-intro/`，规则见 `D:/DESKTOP/openclaw/video/RULES.md`）。
5. **事实来源唯一**：所有数字（版本号、平台数、能力数）从 `01-事实核查表.md` 或代码中的 `theme.ts` / `FACTS` 常量取，不手写。
6. **未提交功能禁止出镜**：录屏和动效均不得展示不属于当前 tag 版本的 UI 或工具。
7. **交付必须含 MP4**：视频任务不以"写完代码"结束，必须 headless 渲染出实际 MP4 文件并报告路径和参数。

### Remotion 项目规范

```text
novelfork-video/remotion/
├── src/
│   ├── theme.ts         ← 设计常量、FACTS 事实数字、sec() 工具
│   ├── Root.tsx         ← Composition 注册
│   └── Composition.tsx  ← 场景组件（每段一个函数组件）
└── out/                 ← 渲染产物
```

- 颜色、字体、时长统一在 `theme.ts`。
- 每个场景是独立 React 函数组件，接收 Remotion 的 `useCurrentFrame` / `useVideoConfig`。
- 使用 `Sequence` 编排时间线，`interpolate` 和 `spring` 做动画。
- 不使用 `Math.random()` 或 `Date.now()`，保证渲染确定性。
- 默认 1920×1080 / 30fps / H.264 + AAC。

### HyperFrames 项目规范

- 根元素带 `data-composition-id`、`data-width`、`data-height`。
- 用 GSAP 注册在 `window.__timelines`，不用 `requestAnimationFrame`。
- 验证流程：`npx hyperframes lint` → `npx hyperframes inspect --samples 15` → `render`。

### 拼接与压制

多段素材最终用 FFmpeg concat 拼接：

```bash
# 写 concat 列表
printf "file '%s'\n" clip1.mp4 clip2.mp4 clip3.mp4 > concat.txt
# 拼接（同编码可无损）
ffmpeg -y -f concat -safe 0 -i concat.txt -c copy final.mp4
# 不同编码时重编码
ffmpeg -y -f concat -safe 0 -i concat.txt -c:v libx264 -crf 18 -preset slow -c:a aac -b:a 192k final.mp4
```

### 音频合流

```bash
# 加 BGM（降到 -18dB 背景）
ffmpeg -y -i video.mp4 -i bgm.mp3 \
  -filter_complex "[1:a]volume=0.12[bg];[0:a][bg]amix=inputs=2:duration=first" \
  -c:v copy -c:a aac -b:a 192k output.mp4

# 加旁白（替换原音轨）
ffmpeg -y -i video.mp4 -i voiceover.wav \
  -map 0:v -map 1:a -c:v copy -c:a aac -b:a 192k output.mp4
```

### 当前视频物料位置

旧的 `D:/DESKTOP/novelfork-video/`（Remotion 项目与 01–05 文档）已不存在。当前物料：

```text
D:/DESKTOP/openclaw/video/projects/novelfork-intro/   index.html（renderAt）+ cues.json + lines.json + audio.py
```

用法：`pwsh -File video/mg.ps1 probe|audio|render|qa projects/novelfork-intro`（在 `D:/DESKTOP/openclaw` 下执行，详见 OpenClaw `CLAUDE.md` 的「视频制作」）。

## 常用事实来源

| 问题 | 首选来源 |
|---|---|
| 当前目标与验收 | 当前用户指令、当前 Dynamic Spec 任务 |
| 运行、构建与打包命令 | 根 `package.json` |
| 颜色、字体、圆角等设计令牌 | 根 `DESIGN.md`（生成 `packages/studio/src/styles/novelfork-themes.css`） |
| 产品与包边界 | 本文件与当前源码 |
| 函数位置、调用链、影响范围 | 代码图谱工具或 `docs/codegraph/CODEMAP.md`（当前未生成，先跑 `pnpm codegraph`） |
| 小说写作流程 | `packages/novel-plugin/` 的当前实现与测试 |
| Runtime 行为 | 本地 `packages/narrafork-runtime-private/`（勿提交） |
| Runtime 物化来源与升级历史 | `packages/narrafork-runtime-private/UPSTREAM.lock.json` 的 `provenance` 字段 |
| Runtime fork 分支与上游镜像 | 宿主库 `packages/.narrafork-runtime-sync/`（`upstream-public` = 公开上游镜像，fork 分支与私有血统完整历史同库） |
| 上游 Runtime 源码对照 | 上游公开无 tag：从宿主库 `git worktree add` 检出 main 上的 `release: vX.Y.Z` 锚点或 fork 分支，不要另行 clone |
| 历史背景 | Kiro、Engram 与历史计划，且须与当前指令核对 |
