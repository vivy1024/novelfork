# NovelFork 开发约定

NovelFork 是网文小说 AI 辅助创作工作台。本文件描述在本仓库内开发、验证与发布时的长期约定。

## 指令优先级

```text
当前用户指令
  > NarraFork 宿主系统与开发者规则
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
├─ 私有子仓库：packages/narrafork-runtime-overlay/
└─ 本地存在、Git 忽略：packages/narrafork-runtime-private/

可选本地辅助（均不提交）
├─ narrafork-private-main/     上游 NarraFork 完整 checkout（用于对照/导入）
└─ packages/.narrafork-runtime-*  导入 staging / 备份缓存
```

| 路径 | 角色 | Git |
|---|---|---|
| `packages/core/` | 通用基础设施 | 跟踪（公开） |
| `packages/studio/` | 产品前端与工作台 | 跟踪（公开） |
| `packages/novel-plugin/` | 小说领域逻辑与写作 UI | 跟踪（公开） |
| `packages/novelfork-product-runtime/` | 产品 Runtime 适配、书籍绑定、产品路由 | 跟踪（公开） |
| `packages/narrafork-runtime-bridge/` | Studio/产品层与 Runtime 的窄契约 | 跟踪（公开） |
| `packages/fitness-plugin/` | 示例/扩展插件 | 跟踪（公开） |
| `packages/narrafork-runtime-overlay/` | Runtime 适配补丁、嵌入面板、Product Host SPI、迁移 | **私有 submodule** |
| `packages/narrafork-runtime-private/` | 可运行的完整 Runtime 物化树 | **ignore，仅本地** |
| `narrafork-private-main/` | 上游私有 Runtime 完整 Git checkout | **ignore，仅本地** |

### 公开边界（硬约束）

- **不公开**完整 NarraFork Runtime 源码树。
- **不公开** Runtime overlay 实现（补丁上下文、嵌入 Narrator 面板、Provider、Runtime 迁移等）；overlay 走私有子仓库。
- 公开树可包含产品代码与 Bridge 契约；不得把 `packages/narrafork-runtime-private/` 重新加入跟踪。
- 仅把当前 tip 改公开**不够**：若 Git 历史仍含 Runtime/overlay 源码，公开 clone 仍会泄露。公开前必须确认历史已清理，或改用无敏感历史的公开镜像。
- 公开 GitHub Actions **不负责**完整 Runtime 构建。发版门禁是：主仓库本地完整测试 + 编译 Windows EXE + 用 EXE 做功能核验。

## 架构边界

```text
packages/studio/                     NovelFork 产品前端与通用工作台
packages/novel-plugin/               小说领域：写作、章节、Lore、Narrative Memory、工作台
packages/core/                       通用基础设施
packages/novelfork-product-runtime/  产品 Runtime 适配、书籍绑定与领域路由
packages/narrafork-runtime-bridge/   Runtime 与产品层之间的受控契约（可公开）
packages/narrafork-runtime-overlay/  私有 submodule：Runtime 通用 overlay
packages/narrafork-runtime-private/  本地 ignore：完整 Runtime 物化树
```

- NovelFork 产品前端和写作工作台保持为产品界面。
- NarraFork Runtime 提供 Agent、权限、工具循环、会话持久化和实时通信等后端能力。
- 小说领域逻辑归属 `packages/novel-plugin/`；`core`、`studio` 与 Bridge 仅提供通用契约和宿主能力。
- Runtime 通过受控产品契约及可信书籍绑定访问小说数据；前端或模型不应直接构造书籍路径、项目或 narrator 标识。
- `packages/narrafork-runtime-private/CLAUDE.md` 只是上游迁入树内的参考，**不能**覆盖本文件或当前产品决策。

## 在 NovelFork 里怎么开发

### 1. 起手必做

1. 工作目录确认在仓库根：`D:\DESKTOP\novelfork`。
2. 需要完整本地可运行能力时，确认：
   - `packages/narrafork-runtime-private/` 已物化存在；
   - `packages/narrafork-runtime-overlay/` 子仓库已初始化（`git submodule update --init --recursive`）。
3. 先读当前用户目标与相关源码/报错；不要假设旁路仓库或历史计划就是待办。

### 2. 改哪里

| 目标 | 优先改动位置 |
|---|---|
| 写作工作台 / 书籍章节 UI | `packages/studio/`、`packages/novel-plugin/` |
| 书籍绑定、产品权限、产品 API | `packages/novelfork-product-runtime/` |
| 通用模型/存储/插件契约 | `packages/core/` |
| 与 Runtime 的类型/面板契约 | `packages/narrafork-runtime-bridge/` |
| Runtime 通用接入补丁 / 嵌入面板 | **私有** `packages/narrafork-runtime-overlay/`（子仓库内） |
| Runtime 本体行为 | 上游私有 Runtime；经 import + overlay 物化到 `runtime-private`，**禁止**为图方便把产品逻辑写回 Runtime 并提交到公开树 |

### 3. 实现原则

1. 选择当前任务需要的最小改动。
2. 沿用现有模块边界、类型约定和错误处理方式。
3. 需要独立调查或隔离上下文时再使用 subagent；不把 subagent、Skill 或计划流程当成固定步骤。
4. 不以 mock、假数据或临时旁路代替真实能力。
5. 未经授权不 `git reset --hard`、不清理用户工作区、不强制推送、不删除数据库文件。

### 4. 验证

- 后端：真实 HTTP/API、运行日志或目标测试。
- 前端：实际启动应用并用 Browser 验证；必要时保留截图。
- 打包：`pnpm build` / `pnpm compile` 等当前 scripts；发版前用生成的 Windows EXE 做功能核验。
- 类型检查是辅助证据；用户可见功能要有实际运行证据。
- **不要**用公开 CI 代替本地 Runtime 完整能力验证。

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

NarraFork Runtime（本地 ignore 的物化树 + 私有 overlay 子仓库）
  ├─ Agent Loop、Provider、权限、会话、消息、工具循环、WebSocket 与运行时状态
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

## Runtime 上游同步与 Overlay 更新（严格）

`packages/narrafork-runtime-private/` 是本地物化的上游 Runtime 树，不是公开产品实现层。  
`packages/narrafork-runtime-overlay/` 是**私有 submodule**，承载可重放的通用 overlay。

### 不可突破的边界

- 书籍、章节、Lore、Narrative Memory、产品权限、产品路由、领域工具、产品数据库表和迁移必须留在产品包内，不得写回 Runtime 上游。
- AI Provider 的产品页面与体验默认只改 `packages/studio/`；Runtime 已有 API 时只补 Studio client 与渲染。
- 不得为构建/启动方便直接手改 `runtime-private` 后把改动冒充“公开产品提交”。Runtime 本体改动必须回到上游或正式 overlay 流程。
- overlay 修改在私有子仓库内完成并推送到私有远端；主仓库只更新 gitlink 指针。

### 唯一事实基线

1. `packages/narrafork-runtime-private/UPSTREAM.lock.json` 的 `commit` 和 `tree` 是唯一上游基线。
2. **禁止**用根仓库 `git diff`、备份数量或主观“看起来差不多”判断 Runtime 是否干净。
3. 判断 Runtime 实际状态只能使用：

   ```bash
   bun scripts/import-narrafork-runtime.ts --source <干净的上游 checkout> --report-only
   ```

   以锁定提交的 `git archive -c core.autocrlf=false` 为基线；输出中的 `target local modifications` 是是否可替换的唯一判据。
4. 上游 checkout 必须是 clean Git toplevel，并包含锁定基线提交。不要把 LF/CRLF 字节差误判为业务差。
5. 子仓库内的 `runtime-overlay.manifest.json` 定义可重放 overlay；`UPSTREAM.lock.json.managedOverlay.operations` 记录当前 Runtime 已物化且被允许的输出。两者不能混用。

### 上游更新唯一流程

1. 准备干净上游 checkout（通常是 `narrafork-private-main` 或等价私有 clone），先 `--report-only`。
2. 只要 `target local modifications` 非零，立即停止：禁止盲目 `--replace` / `reset` / 手工清空。
3. overlay 基线不匹配时，只在私有 overlay 子仓库重做对应单文件 patch/add，保持允许路径与精确 SHA-256。
4. 先验证再替换：

   ```bash
   bun test scripts/runtime-overlay.test.ts scripts/import-narrafork-runtime.test.ts
   bun scripts/import-narrafork-runtime.ts --source <干净的上游 checkout> --dry-run
   ```

5. 通过后再 `--replace`；替换后再次 `--report-only` 与 `bun run runtime:parity:verify`。

### Submodule 与本地 Runtime 日常命令

```bash
# 初始化/更新私有 overlay 子仓库（需要私有仓库访问权限）
git submodule update --init --recursive

# 仅在有上游 checkout 时检查 Runtime 物化是否干净
bun scripts/import-narrafork-runtime.ts --source ./narrafork-private-main --report-only
```

## 代码质量与安全

- 先读取事实再作判断，避免基于假设修改行为。
- 保持用户已有的工作区改动；未经授权不还原、删除或覆盖。
- 使用宿主提供的代码图谱、文件搜索和编辑工具；工具名称和参数以当前宿主实际提供的版本为准。
- 数据库结构变更遵循目标 package 的 schema 与迁移生成流程；不手改生成迁移，不删除数据库文件。
- 不提交密钥、Token、`.env`、用户数据，以及 Runtime/overlay 私有源码。

## Git 与发布

- 不执行 `git reset --hard`、`git checkout --`、`git clean`、强制推送、历史重写或其他破坏性操作，除非用户明确授权。
- 只有在用户明确要求时才创建 commit、push、tag 或 Release。
- 主仓库提交不得重新引入 `packages/narrafork-runtime-private/`。
- overlay 变更：先在私有 submodule 仓库提交并推送，再在主仓库更新 gitlink。
- 发布前完成与改动相称的本地构建/测试，并用 Windows EXE 做发版前功能核验。
- 公开仓库可见性变更前，必须确认：当前 tip 无私有 Runtime 源码，且历史策略已明确（清理历史或接受风险——默认不接受历史泄露）。

## 持久记忆

Engram 用于保存对后续工作有长期价值的信息，例如：

- 已验证的 bug 根因和修复；
- 已确认的架构或产品决策；
- 影响安全、数据一致性或实现路径的稳定约束。

临时调查、未验证方案和普通操作不需要持久化。需要修订既有记录时，更新对应事实，避免形成相互矛盾的重复结论。

## 常用事实来源

| 问题 | 首选来源 |
|---|---|
| 当前目标与验收 | 当前用户指令、当前 Dynamic Spec 任务 |
| 运行、构建与打包命令 | 根 `package.json` |
| 产品与包边界 | 本文件与当前源码 |
| 函数位置、调用链、影响范围 | 代码图谱工具或 `docs/codegraph/CODEMAP.md` |
| 小说写作流程 | `packages/novel-plugin/` 的当前实现与测试 |
| Runtime 行为 | 本地 `packages/narrafork-runtime-private/`（勿提交） |
| Overlay 定义 | 私有 submodule `packages/narrafork-runtime-overlay/` |
| 历史背景 | Kiro、Engram 与历史计划，且须与当前指令核对 |
