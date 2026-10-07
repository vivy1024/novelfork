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

私有 fork 仓库（Runtime 源头权威，不在本仓库内）
└─ NarraFork/novelfork-runtime-private @ novelfork/integration-v0.6.6

本地辅助（均不提交）
├─ packages/.narrafork-runtime-fork-staging/  Runtime 宿主 git 库（接缝分支与上游镜像的本地唯一副本）
├─ packages/.narrafork-runtime-import/        导入脚本暂存区，含 zstd 工具链（仍被引用，勿删）
└─ .runtime-backup-v0.6.6-20260928/           上一次物化目录备份（回滚用；更早的 v0.6.5 等备份也在根目录）
```

| 路径 | 角色 | Git |
|---|---|---|
| `packages/core/` | 通用基础设施 | 跟踪（公开） |
| `packages/studio/` | 产品前端与工作台 | 跟踪（公开） |
| `packages/novel-plugin/` | 小说领域逻辑与写作 UI | 跟踪（公开） |
| `packages/novelfork-product-runtime/` | 产品 Runtime 适配、书籍绑定、产品路由 | 跟踪（公开） |
| `packages/narrafork-runtime-bridge/` | Studio/产品层与 Runtime 的窄契约 | 跟踪（公开） |
| `packages/fitness-plugin/` | 示例/扩展插件 | 跟踪（公开） |
| `packages/narrafork-runtime-private/` | 可运行的完整 Runtime 物化树（= 私有 fork 分支内容） | **ignore，仅本地**（例外：`UPSTREAM.lock.json` 作为来源元数据被跟踪） |
| `packages/.narrafork-runtime-fork-staging/` | Runtime 宿主 git 库：接缝分支 + 上游镜像，worktree 从这里开 | **ignore，仅本地** |
| `NarraFork/novelfork-runtime-private` | Runtime fork 权威仓库，分支 `novelfork/integration-v0.6.6` | **独立私有仓库（不在本仓库内）** |

### 公开边界（硬约束）

- **不公开**完整 NarraFork Runtime 源码树。
- **不公开**完整 Runtime 实现（Product Host、嵌入 Narrator 面板、Provider、Runtime 迁移等）；它们只存在于私有 fork 和本地 ignore 物化树。
- 公开树可包含产品代码与 Bridge 契约；不得把 `packages/narrafork-runtime-private/` 重新加入跟踪。
- 仅把当前 tip 改公开**不够**：若 Git 历史仍含 Runtime/overlay 源码，公开 clone 仍会泄露。公开前必须确认历史已清理，或改用无敏感历史的公开镜像。
- `NarraFork/novelfork-runtime-private` 必须保持**私有**（它含完整上游源码）。协作者在该仓库内部建分支提 PR（给写入权限），**不要** fork 到个人账号：原仓库切换可见性时，已有个人 fork 会脱离并保持原可见性。2026-09-26 曾误设为公开并被 fork 成公开仓库，已于 09-27 改回私有。
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
2. 需要完整本地可运行能力时，确认 `packages/narrafork-runtime-private/` 已物化存在（唯一生产 Runtime，来源为 `NarraFork/novelfork-runtime-private` fork 分支）。
3. 先读当前用户目标与相关源码/报错；不要假设旁路仓库或历史计划就是待办。

### 2. 改哪里

| 目标 | 优先改动位置 |
|---|---|
| 写作工作台 / 书籍章节 UI | `packages/studio/`、`packages/novel-plugin/` |
| 书籍绑定、产品权限、产品 API | `packages/novelfork-product-runtime/` |
| 通用模型/存储/插件契约 | `packages/core/` |
| 与 Runtime 的类型/面板契约 | `packages/narrafork-runtime-bridge/` |
| Runtime 通用接入补丁 / 嵌入面板 / Product Host SPI | **私有 fork 仓库** `NarraFork/novelfork-runtime-private`（fork 层），改动经 fork 分支提交后同步物化目录 |
| Runtime 本体行为 | 上游 `NarraFork/narrafork-private`；升级走私有 fork 的 git merge，**禁止**为图方便把产品逻辑写回 Runtime 并提交到公开树 |

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

NarraFork Runtime（本地 ignore 的物化树；源头在私有 fork 仓库 novelfork/integration-v0.6.6）
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

Runtime 采用 **git fork 模式**（2026-08-20 起，取代早期的 archive+overlay 重放）：

```text
NarraFork/narrafork-private          上游 main（domexie 维护）
        │ git merge
NarraFork/novelfork-runtime-private  私有 fork，分支 novelfork/integration-v0.6.6
        │                             （fork 层 = product-host SPI + runtime-migrations + 宿主组件）
本地宿主库 packages/.narrafork-runtime-fork-staging/   接缝分支与上游镜像的本地唯一 git 副本
        │ git archive
本地物化 packages/narrafork-runtime-private/   从 fork 分支导出而来（gitignore，不进公开仓库）
```

- fork 层内容以 fork 分支上的 `feat(runtime): materialize` 提交为准（原始出处 `42641a32`，2026-08-20）。
- 本地物化目录是 fork 分支内容的**导出物**：升级 = 在宿主库开 worktree → merge 上游 → 解决冲突 → 验证 → `git archive` 导出到物化目录。**不是**公开仓库提交（该目录被主仓库 `.gitignore` 忽略；例外是 `UPSTREAM.lock.json`，它作为来源元数据被跟踪）。
- `runtime-migrations/` 在 fork 仓库与物化目录各有一份：`server/db/run-migrations.ts` **优先读 runtime-migrations/**（fork 层资产），新迁移必须两处同步。
- **两个远端都用 HTTPS**：本机 SSH 被代理阻断（`Connection closed by 198.18.0.18`），`git@github.com:` 形式的 remote 会直接失败。

### 升级流程（当前有效）

1. 在宿主库 `packages/.narrafork-runtime-fork-staging/` 里 `git fetch upstream`，然后 `git worktree add` 开一个工作区（**不要**重新 clone——接缝分支只存在于这个本地库和 fork 远端）。
2. `git merge upstream/main`——常规三方合并；fork 层约 169 个文件是冲突面。
3. 补齐上游缺失项（上游可能不带 drizzle 迁移：用 Terminal 交互跑 `bunx drizzle-kit generate`，产物同步进 `drizzle/` 与 `runtime-migrations/` 两处并提交）。
4. 验证：`bun run typecheck`（注意 runtime 用 tsgo、bridge 用 tsc，tsc 更严格会暴露 tsgo 漏报的上游缺陷）；权限/agent 工具测试套件；失败项须在**纯上游同版本基线** worktree 复跑对比，确认是否为上游自身缺陷或 Windows 环境既有问题。
5. 推送 fork 分支 → 备份旧物化目录到 `.runtime-backup-v<旧版本>-<日期>/` → 更新 `UPSTREAM.lock.json`（`commit`/`tree`/`branch` 与 provenance：接缝基线、上游提交、合并基点、冲突处理、物化后偏离）→ `pnpm runtime:sync` 导出到 `packages/narrafork-runtime-private/` 并 `bun install`（只改两版之间变化的文件；不要再手工 `git archive` 覆盖，否则同步脚本记录的状态会与目录不一致）→ typecheck + 冒烟测试 → 全工作区 `pnpm run typecheck` → 用隔离实例做真实启动验证。
6. 已知基线：上游 v0.6.6（`751ad11b`，注意 0.6.6 发布过两次，`13e9c88d` 被 `78d739d1` 回滚后由 `751ad11b` 重发），fork 分支头 `dda73094`（2026-09-26，由 `f779ff11` 快进合入 Runtime PR #1）。接缝基线提交 `5ab50ffe`（上游 v0.6.5 + 产品定制）。
   - 2026-09-28 本地已合并上游 v0.7.10（`24f2436a`，无 tag）：宿主库分支 `novelfork/upgrade-0.7.10` 的 `bc6347b9`，物化目录已同步到它。`pnpm runtime:sync` 只能从本机宿主库取到该提交（做法见 `UPSTREAM.lock.json` 的 `provenance.note`）。**私有血统分支不推公开**（含上游开源前未消毒历史）；随 v0.0.4 发行的 MPL 源码提供改为公开仓 `NarraFork/novelfork-runtime`（公开 v0.7.12 原树 + fork delta 树级重建）。下一版本窗口按 `docs/design/Runtime-0.8.3-升级评估.md` 切公开线升级（树级移植，真实冲突 10 处）。
   - 0.7.x 起 Agent 循环主体在 `server/services/agent-runtime/orchestrator.ts`，fork 的产品叙述者判断收在 `server/services/product-narrator-tools.ts`；上游不跟踪 SQLite `drizzle/`，纯上游基线跑数据库测试前要把同一套迁移复制进基线 worktree。

### 已知环境噪声（不要当成缺陷追查）

- **宿主库 `git status` 会报约 2689 个"已修改"文件，是假的。** 内容哈希与索引、HEAD 三方一致，`git diff HEAD` 只有个位数真实改动；`update-index --really-refresh` 与 `git reset` 都清不掉，属文件系统层 stat 问题。以真实 `git diff` 为准。
- **物化树的 tsgo typecheck 恒红**，源于 `frontend/routeTree.gen.ts`、`server/generated/embedded-licenses.ts` 等构建期 codegen 产物不在跟踪文件里（0.6.5 时代同样如此）。判断合并是否引入问题，要与**纯上游同版本基线**对照，不是看绝对错误数。
- 上游 0.6.6 的 `bash-analyze.test.ts` 有一条假设 POSIX 路径解析的测试，在 Windows 上必然失败，非本地引入。

### 早期 overlay 重放流程（已废弃，仅历史排查时参考）

以下命令与约定属于 archive+overlay 时代，**不再用于日常升级**：

```bash
bun scripts/import-narrafork-runtime.ts --source <checkout> --report-only   # 影响报告仍可用于冲突预估
```

- 当时以 `UPSTREAM.lock.json` 的 commit/tree 为哈希绑定基线、以 overlay manifest 的 SHA-256 精确补丁重放；fork 化后这些约束由 git merge 天然满足。
- 该时代的残留缓存（`packages/.narrafork-runtime-{fork-replay,policy-base,policy-staging,policy-test-home,*-check-*}` 与 `packages/narrafork-runtime-overlay/`）已于 2026-09-17 清理。overlay 私有仓库 `NarraFork/novelfork-runtime-overlay-private` 同日删除。
- **`packages/.narrafork-runtime-*` 下现存两个目录都不能删**：`fork-staging` 托管接缝分支与上游镜像；`import` 被 `scripts/import-narrafork-runtime.ts:27` 引用且含不易重下的 zstd 工具链。

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
- Runtime 本体变更：先在宿主库的 fork 分支上提交、推送到 `NarraFork/novelfork-runtime-private`，再更新 `UPSTREAM.lock.json` 并 `pnpm runtime:sync` 同步物化目录。overlay submodule 已于 2026-09-17 随目录与远端仓库一并移除（`.gitmodules` 现为空文件）。
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
3. 用当次编译出的 `windows-x64.exe` 做功能核验（不是旧产物）。
4. 只有在用户明确要求时才 commit、tag、push 与创建 Release；上传时带上聚合校验和文件。

产物校验：每个产物旁生成 `<产物名>.sha256`；多平台构建额外生成 `dist/novelfork-v<版本>-SHA256SUMS` 汇总全部产物，Release 资产以它为准。

Bun 版本：编译用的 Bun 必须与 Runtime `package.json` 的 `packageManager` 完全一致（Runtime 0.7.10 起为 1.4.2，脚本常量 `REQUIRED_RUNTIME_BUN_VERSION`），不一致时编译在开头就报错。产物内嵌的就是这个 Bun，与上游发布和测试用的版本对齐。

Runtime 的 Worker：`new Worker()` 的路径打包器不跟随，Runtime 自己的编译脚本把这些模块列为额外入口。产品编译在临时工作区的 `server/…` 下生成一行导入的垫片作为额外入口（`RUNTIME_WORKER_ENTRIES`），使它们嵌在 Runtime 会探测的路径上；契约测试核对这份清单与 Runtime 编译脚本一致。上游新增 Worker 时测试会失败，照着补上即可。

交叉编译前置条件：Bun 会为每个非本机目标下载独立运行时并缓存在 `~/.bun/install/cache/bun-<target>-v<bun版本>`。首次或网络中断时会出现 `Failed to extract executable for 'bun-darwin-aarch64-...'`。`compile-product-runtime.ts` 因此在准备任何产物之前先用一次性最小编译探测全部目标（失败重试 3 次），所以这类问题会在几秒内失败，而不是在几十分钟的矩阵构建中途炸掉。真的探测失败时，先确认能访问 npm registry，再重跑同一命令即可。

EXE 核验注意：产物启动时会自动打开产品窗口。无头核验必须带 `NOVELFORK_NO_BROWSER=1`，不要在用户使用屏幕时弹窗；同时用 `NOVELFORK_HOME` 指向临时目录，产品各数据路径（两个数据库、Runtime 目录、全局配置、技能、市场数据、窗口配置）随之隔离，不碰用户真实数据。前提是环境里没有单独设置 `NOVELFORK_RUNTIME_DIR`、`NOVELFORK_STORAGE_DB_PATH`、`NOVELFORK_MARKET_DIR` 这类更具体的路径变量，它们优先于 `NOVELFORK_HOME`：

```bash
NOVELFORK_HOME="$(mktemp -d)" NOVELFORK_NO_BROWSER=1 PORT=4599 ./dist/novelfork-v<版本>-windows-x64.exe
```

已知限制：非 Windows 产物在本机只能验证交叉编译成功与目标格式（Mach-O / ELF），真实运行行为需要在对应系统上核验。上游 Runtime 的 `latest*.yml` 自动更新清单与二进制签名不属于 NovelFork 发版流程——产品层未接自动更新服务，不要顺手引入。

## 当前方向与近期改动（快照：2026-09-28）

本节是状态快照，便于协作者对齐。「后续方向」须经当前用户确认后才执行，不自动构成待办；与当前指令冲突时以当前指令为准。内容过时后直接改写本节，不追加历史。

### 近期改动（v0.0.4 之后）

| 主题 | 内容 |
|---|---|
| 叙事结构 | 场景与剧情线的表、存取、接口与读模型；承载树；叙事结构聚合快照；推进看板以真剧情线为行，可就地新建剧情线；写作管线把场景蓝图落盘为 `narrative_scene`（同章重写幂等，保留作者手建、已确认、已挂线的场景） |
| 工作台 | 面板归入四大镜头，下线重复入口与四个废弃画布；工具树按写作时机重组；划词 AI 指令注入全书文风基准；字号统一收进 `text-2xs` 令牌 |
| 伏笔 | 债务判定收敛到 `foreshadow-debts`；临近 / 超期阈值按书由作者设置（`book.json` 的 `foreshadowDebtThresholds`，默认 5 / 12 章） |
| 工作流 | 方案改为节点图（起点 / 工序 / 汇合 / 终点，下一步 / 打回连线，按结果分支），按图运行：并行、分支、汇合、打回上游（迁移 0038 记录工序结果）；方案分草稿 / 已发布并带版本号。叙述者可列出、查看、用编辑指令改草稿、启动已发布方案；越出当前工序的写类小说工具被拦下。「故事推进 › 执行」的工作流画布编辑、发布与监视运行（并行时每道待确认 / 受阻工序各一张卡）；「套路 › 工作流装配」已下线。限制：只约束小说工具，Runtime 自带工具不受约束；运行状态靠轮询 |
| 画布 | 三张画布统一用 React Flow：工作流画布、因果画布（故事树 › 因果树：剧情线 × 场景泳道，场景只画一次、拖动换主剧情线、伏笔回收线）、其余故事树（tidy 自动排版不变，换引擎后有小地图、适应视图、展开自动平移）。视口按「作品 + 视图」记在浏览器里，节点坐标不存（工作流方案的节点位置除外，存在方案里）。叙述者结果卡「在画布打开」可打开对应章节 |
| 接口安全 | 场景挂载 / 摘除接口核对场景与剧情线属于路径上的书（此前可跨书改挂载）；新增 `PUT …/scenes/:sceneId/primary-storyline` |
| 协作者贡献 | 产品数据目录由 `NOVELFORK_HOME` 决定；NUG 等未填默认模型的配置不再判为未配置；Runtime 全局技能跟随 `NOVELFORK_HOME`（fork `dda73094`） |
| 主题 | 三套书房主题（绿格稿纸默认 / 书函藏青 / 夜更烛光），各含浅色深色，在「设置 › 外观与界面」切换，嵌入的 Runtime 界面一同切换（`runtime-host-theme.css` 把 `--mantine-*` 接到 Studio 令牌，明暗经 fork 层 `colorScheme` 参数强制跟随）。令牌唯一权威源是根 `DESIGN.md`（Google DESIGN.md 格式，`designmd lint` 零告警），`pnpm --dir packages/studio run design:tokens` 生成 `novelfork-themes.css`，测试校验一致；纹样（稿面格线 / 烛光、书封、函套）在 `novelfork-motifs.css`，全部写成 `--nf-*` 变量。字体随产品打包（思源宋体、站酷小薇、JetBrains Mono），界面文字用系统字体。顺带修复：Tailwind 带透明度的令牌色（`bg-primary/10` 等）此前从不生成；OLED 纯黑重启后失效 |
| 工程 | react / react-dom 统一 19.2.5（修复全新安装下的双 React）；公开边界检查（脚本 + `.githooks` + 公开 CI）；`pnpm runtime:sync`；公开 CI 跑 core / novel-plugin（装 bun 仅供测试）；`NOTICE` 写明许可证边界 |
| 仓库历史 | 2026-09-27 改写了本仓库全部分支与标签的历史，清除不应公开的本地资料。**此前的提交号全部失效**：旧 clone 不要再推送，请重新 clone；查历史以新提交号为准 |

### 后续方向

完整任务与完成标准见 [`docs/路线与任务.md`](docs/路线与任务.md)，依据见 [`docs/90-参考资料/参考项目学习-2026-09.md`](docs/90-参考资料/参考项目学习-2026-09.md)。要点：

- 2026-09-28 与作者确认：面向公开用户发布；上游不做小说方向（团队协作用官方插件 `NarraFork/narrator-team`，需宿主 0.7.7+）。通用能力归 Runtime，NovelFork 只做小说领域；OpenWrite 已按同样边界改为宿主插件。
- 阶段：0 准备（本地并入 fork 提交 `006bf829`）→ 1 边界与升级到 v0.7.10（先评估 fork 层能否改用官方插件接口；上游 v0.7.9 / v0.7.10 无 tag，按 `upstream/main` 的 `24f2436a` 合并）→ 2 人味链（重定文风预设、自动蒸馏、角色声线、人文化环节、文风金库、朱雀检测验收）→ 3 自有技能（创作预设只留约 8 个作者入口，内置 378 个技能目录收到约 15–20 个）→ 4 记忆链（实体身份、正文接纳、状态与知识边界、关系图谱、重做故事推进）→ 5 工作流交给 narrator-team 执行 → 6 公开发布必需项（项目档案、保存可靠性）→ 7 基线与试用（推送、七平台编译、EXE 核验、作者真书试用）。作者决定先做完阶段 1–6 再统一出基线，中途不单独发版。
- 学参考项目的机制不抄原文：PlotPilot（Commons Clause）、笔枢 / Scriverse / InkOS（AGPL）、MuMuAINovel（GPL）的代码与提示词不进仓库。

## 持久记忆

Engram 用于保存对后续工作有长期价值的信息，例如：

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
| Bun | 1.3.13 | 项目构建 |
| FFmpeg | 8.1.1 full build | 转码、拼接、压制、音频合流 |
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
4. **物料独立目录**：视频项目放在 `D:/DESKTOP/novelfork-video/`（或用户指定目录），不写入产品 git 仓库。
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

```text
D:/DESKTOP/novelfork-video/
├── 00-README.md             总览
├── 01-事实核查表.md          口径与证据
├── 02-脚本-主片90秒.md       主片分镜与旁白
├── 03-脚本-技术向补充片.md    NarraFork 技术片
├── 04-录屏清单.md            素材编号与脱敏
├── 05-发布文案包.md          标题/简介/社媒/QA
└── remotion/                Remotion 项目（已渲染 novelfork-promo-v1.mp4）
```

## 常用事实来源

| 问题 | 首选来源 |
|---|---|
| 当前目标与验收 | 当前用户指令、当前 Dynamic Spec 任务 |
| 运行、构建与打包命令 | 根 `package.json` |
| 颜色、字体、圆角等设计令牌 | 根 `DESIGN.md`（生成 `packages/studio/src/styles/novelfork-themes.css`） |
| 产品与包边界 | 本文件与当前源码 |
| 函数位置、调用链、影响范围 | 代码图谱工具或 `docs/codegraph/CODEMAP.md` |
| 小说写作流程 | `packages/novel-plugin/` 的当前实现与测试 |
| Runtime 行为 | 本地 `packages/narrafork-runtime-private/`（勿提交） |
| Runtime 物化来源与升级历史 | `packages/narrafork-runtime-private/UPSTREAM.lock.json` 的 `provenance` 字段 |
| Runtime fork 分支与上游历史 | 宿主库 `packages/.narrafork-runtime-fork-staging/`（`origin` = fork，`upstream` = 上游本体） |
| 上游 Runtime 源码对照 | 从宿主库 `git worktree add` 检出对应 tag，不要另行 clone |
| 历史背景 | Kiro、Engram 与历史计划，且须与当前指令核对 |
