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
packages/studio/                    NovelFork 现有产品前端与通用工作台
packages/novel-plugin/              小说领域：写作、章节、Lore、Narrative Memory、工作台
packages/core/                      通用基础设施
packages/narrafork-runtime-private/ 私有 NarraFork Agent Runtime
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
