# NovelFork 开发约定

NovelFork 是网文小说 AI 辅助创作工作台。本文件描述在 NarraFork 宿主内维护该仓库时的长期开发约定。

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

## 架构边界

```text
packages/studio/                    NovelFork 产品前端与通用工作台
packages/novel-plugin/              小说领域：写作、章节、Lore、Narrative Memory、工作台
packages/core/                      通用基础设施
packages/narrafork-runtime-private/ 受控导入的 NarraFork Agent Runtime
packages/narrafork-runtime-overlay/  可重放的 Runtime 通用 overlay
packages/narrafork-runtime-bridge/  Runtime 与产品层之间的受控契约
packages/novelfork-product-runtime/ NovelFork 的 Runtime 产品适配、书籍绑定与领域路由
```

- NovelFork 的产品前端和写作工作台保持为产品界面。
- NarraFork Runtime 提供 Agent、权限、工具循环、会话持久化和实时通信等后端能力。
- 小说领域逻辑归属 `packages/novel-plugin/`；`core`、`studio` 与 Runtime 通用层仅提供通用契约和宿主能力。
- Runtime 通过受控产品契约及可信书籍绑定访问小说数据；前端或模型不应直接构造书籍路径、项目或 narrator 标识。
- `packages/narrafork-runtime-private/CLAUDE.md` 是迁入上游源码的维护参考。宿主工具语义、当前产品决策和本文件优先于该参考文档。

## 标准开发流程

### 1. 理解任务

1. 读取当前用户目标和相关源码、报错、日志或接口。
2. 确认影响范围、数据边界和现有实现模式。
3. 对多文件、行为变化或存在技术选择的任务，使用 NarraFork 原生 Plan Mode；简单明确的改动可直接处理。

### 2. 实现

1. 选择当前任务需要的最小改动。
2. 沿用现有模块边界、类型约定和错误处理方式。
3. 需要独立调查、复杂执行或隔离上下文时再使用 subagent；不把 subagent、Skill 或计划流程当成固定步骤。
4. 不以 mock、假数据或临时旁路代替真实能力。

### 3. 验证

- 后端改动：通过真实 HTTP/API 调用、运行日志或目标测试验证。
- 前端改动：启动实际应用并使用 Browser 验证；必要时保留截图证据。
- 构建或打包改动：运行对应构建并启动产物验证。
- 类型检查和静态阅读是辅助证据；用户可见功能应有实际运行证据。

### 4. 交付

交付时简要说明：

- 实际修改的文件和行为；
- 实际执行的验证；
- 已知限制或未完成项。

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

NovelFork 不把 NarraFork 当作可替换的外部聊天服务，也不维护第二套 Agent 引擎；它把 NarraFork 作为通用 Agent Runtime，并把小说领域安全地接入其中：

```text
NovelFork Studio（产品壳）
  ├─ 写作工作台、书籍/章节/Lore 界面：Novel Plugin
  ├─ 原生叙述者面板：运行时复用 Runtime 的 EmbeddedNarratorDockHost
  └─ API / WebSocket：连接 NarraFork Runtime

NarraFork Runtime
  ├─ Agent Loop、Provider、权限、会话、消息、工具循环、WebSocket 与运行时状态
  ├─ 维护 NarratorPanel 的核心行为、状态与通用前端依赖
  └─ 经由 Product Host SPI 调用 NovelFork 产品能力

NovelFork Product Runtime
  ├─ 解析服务端可信的书籍与 narrator 绑定
  ├─ 提供产品路由、领域工具、访问控制与产品上下文
  └─ 调用 Novel Plugin / Core 管理书籍、章节、Lore 与 Narrative Memory
```

- **Runtime 的职责**：NarraFork Runtime 拥有 Agent 的真实执行、Provider、权限、会话、消息、通用工具执行器和实时连接。禁止在 Studio、Novel Plugin 或 Product Runtime 中平行实现第二套通用 Agent Loop、权限系统或消息同步层。
- **NovelFork 的职责**：`packages/novel-plugin/`、`packages/core/` 与 `packages/novelfork-product-runtime/` 拥有书籍、章节、Lore、Narrative Memory、写作业务、领域工具和产品权限。Runtime 不得直接承载这些产品数据、迁移或业务路由。
- **Studio 的职责**：`packages/studio/` 是 NovelFork 产品壳与写作界面；它组合小说工作台和 Runtime 叙述者体验，但不重写 Runtime 的对话核心。开发环境中 Studio 通过 Vite 代理把 `/api` 与 WebSocket 转给 Runtime（默认 Runtime 端口为 `7778`）；生产构建由 Runtime 服务 Studio 产物。实际产品验收必须使用已认证的 Studio 浏览器上下文，而不是以未认证的裸 HTTP 调用替代。
- **原生面板复用**：`RuntimeNarratorPanelMount` 必须运行时复用 Runtime 的 `EmbeddedNarratorDockHost`，而不是复制、fork 或以简化 mock 替代 `NarratorPanel`。该面板保留 Runtime 自己的 Provider、React Query、i18n、消息状态和 WebSocket 语义；NovelFork 只通过正式扩展点注入产品 capability 守卫、可信书籍上下文和小说领域工具结果渲染。
- **受控 Bridge**：`packages/narrafork-runtime-bridge/` 是 Studio 与 Runtime 的稳定、窄契约层。其 `frontend` 子路径只声明 Studio 必需的 `NarratorPanel` props、组件签名和 `queryClient` 接口；Vite/Vitest 精确别名仍解析到 Runtime 的真实 `EmbeddedNarratorDockHost.tsx` 与 `query-client.ts`，因此运行时能力随上游更新而更新。
- **编译边界**：禁止在 `packages/studio/tsconfig.json` 中通过 `@frontend/*`、`@shared/*` 或等价宽路径映射暴露整个 `packages/narrafork-runtime-private/frontend` 源码。否则 Studio 的 `tsc` 会沿 Runtime 全量前端依赖树进行不相关类型检查。运行时 alias 与 TypeScript 类型契约必须分离：前者加载真实实现，后者只依赖 Bridge。
- **可信绑定**：前端、模型或工具调用不得自行拼装书籍路径、项目路径或 narrator 标识。所有读取、执行和写入都必须由服务端的 Product Runtime 解析可信绑定并执行访问控制。

## Runtime 上游同步与 Overlay 更新（严格）

`packages/narrafork-runtime-private/` 是受控导入的 NarraFork 上游树，不是 NovelFork 产品实现层。根 `CLAUDE.md` 是此流程的唯一权威；package 内的 `CLAUDE.md` 只可作为上游维护参考，不能覆盖本节。

### 不可突破的边界

- NovelFork 的书籍、章节、Lore、Narrative Memory、产品权限、产品路由、领域工具、产品数据库表和迁移必须留在 `packages/novelfork-product-runtime/`、`packages/novel-plugin/`、`packages/core/` 或 `packages/studio/`，不得写回 Runtime。
- AI Provider 的产品页面、交互和体验对齐默认只改 `packages/studio/`；Runtime 已有 API 时，只补 Studio 的 client 与渲染。
- Runtime 的例外只能是 `packages/narrafork-runtime-overlay/` 中有清单、精确哈希、允许路径和产品内容检查的通用 overlay。不得为构建、启动或调试方便直接改 Runtime 的 `package.json`、迁移、路由、Agent、Provider 或数据库实现。

### 唯一事实基线

1. `packages/narrafork-runtime-private/UPSTREAM.lock.json` 的 `commit` 和 `tree` 是唯一上游基线。
2. **禁止**用仓库根目录的 `git diff`、`git diff --stat`、历史备份数量或 overlay 计划数量判断 Runtime 是否干净。导入树、旧 Git 基线与 Windows LF/CRLF 会产生误导性大 diff。
3. 判断 Runtime 实际状态只能使用：

   ```bash
   bun scripts/import-narrafork-runtime.ts --source <干净的上游 checkout> --report-only
   ```

   该命令以锁定提交的 `git archive -c core.autocrlf=false` 为基线，并忽略 `UPSTREAM.lock.json` 与 lock 中已登记的 `managedOverlay` 输出。输出里的 `target local modifications` 是是否可替换的唯一判据。
4. 上游 checkout 必须是 clean Git toplevel，且包含锁定基线提交。不要把 checkout 工作区的 LF/CRLF 字节差异误判为业务代码差异。
5. `runtime-overlay.manifest.json` 是可重放 overlay 的定义；`UPSTREAM.lock.json.managedOverlay.operations` 是当前 Runtime 已物化且被允许的输出。两者不能混用。

### 上游更新唯一流程

1. 准备干净的 NarraFork 上游 checkout，并先运行 `--report-only`。
2. 只要 `target local modifications` 非零，立即停止：禁止 `--replace`、`reset`、`restore`、覆盖或手工清空 Runtime。每项差异必须先归类为上游改动、受控 overlay、NovelFork 产品层或明确废弃。
3. 上游变更造成 overlay patch 基线不匹配时，只能在 `packages/narrafork-runtime-overlay/` 重做对应的单文件 patch/add，并保持允许路径、精确 base/result SHA-256 和零产品业务内容；不得先手改 active Runtime 再复制。
4. 先验证再替换：

   ```bash
   bun test scripts/runtime-overlay.test.ts scripts/import-narrafork-runtime.test.ts
   bun scripts/import-narrafork-runtime.ts --source <干净的上游 checkout> --dry-run
   ```

5. 只有 `--report-only` 为零、dry-run 成功且 overlay 已重绑到目标上游提交后，才能运行：

   ```bash
   bun scripts/import-narrafork-runtime.ts --source <干净的上游 checkout> --replace
   ```

   导入器会在 staging tree 中从 Git archive 重放验证后的 overlay，再通过原子替换更新 Runtime；target 不干净时必须拒绝覆盖。
6. 替换后再次运行：

   ```bash
   bun scripts/import-narrafork-runtime.ts --source <同一上游 checkout> --report-only
   bun run runtime:parity:verify
   ```

   前者必须不再报告未登记 target 修改。

### 当前已核实状态（2026 年 7 月 20 日）

- 基线为 `NarraFork/narrafork-private@8c3c88cf2f0a7c867c4aa37d0fd070a735ba5a17`，tree 为 `aaa5ce6815f1a06077d5d93029eb04b4d2bbba72`。
- Runtime 没有缺失上游文件；先前所谓“大规模 Runtime 改动”是错误地把根 Git 基线和 LF/CRLF 差异当成语义差异。
- `--report-only` 当前仍报告 5 项待归类的 target local modifications：`ChunkStructureRefreshCtx.ts`、`ChunkedMessageList.tsx`、`MessageBubble.tsx`、`NarratorPanel.tsx`，以及 `server/generated-modules.d.ts` 的 overlay lock/资产哈希漂移。前四项是 Narrator Chunk Store 刷新前端修复。
- 在这 5 项被正式迁移为上游改动、受控 overlay 或产品层实现之前，禁止宣称 Runtime 可直接安全替换。

## 代码质量与安全

- 先读取事实再作判断，避免基于假设修改行为。
- 保持用户已有的工作区改动；未经授权不还原、删除或覆盖。
- 使用宿主提供的代码图谱、文件搜索和编辑工具；工具名称和参数以当前宿主实际提供的版本为准。
- 数据库结构变更遵循目标 package 的 schema 与迁移生成流程；不手改生成迁移，不删除数据库文件。
- 不提交密钥、Token、`.env` 或用户数据。

## Git 与发布

- 不执行 `git reset --hard`、`git checkout --`、`git clean`、强制推送或其他破坏性操作，除非用户明确授权。
- 只有在用户明确要求时才创建 commit、push、tag 或 Release。
- 发布前按照当前 package scripts 完成与改动相称的构建和验证。

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
| Runtime 行为 | `packages/narrafork-runtime-private/` 的当前源码 |
| 历史背景 | Kiro、Engram 与历史计划，且须与当前指令核对 |
