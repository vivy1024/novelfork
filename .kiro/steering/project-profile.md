# NovelFork Project Profile

## 产品身份

| 字段 | 内容 |
|---|---|
| 项目 | NovelFork — 中文网文小说 AI 辅助创作工作台 |
| 上游 | Fork 自 InkOS；选择性合并通用改进，不自动同步 |
| 开发者 | 薛小川 / GitHub `vivy1024`，禁止虚构 |
| 主要入口 | Studio `/next`、作品工作台、叙述者会话、`novelfork` CLI/headless |
| 当前目标 | v0.1.0 发布前继续完成 release readiness 重新验收；GitHub Release 尚未创建 |

## 技术栈与仓库边界

| 层 | 事实 |
|---|---|
| 运行时 | Bun 推荐；Node.js >= 22.5.0 |
| 包管理 | pnpm workspace |
| 语言 | TypeScript strict |
| Web | React 19 + Hono + Vite |
| 数据 | SQLite 本地存储 |
| 分发 | Bun compile 单文件 + GitHub Release 版本化产物 |
| 目录 | `packages/cli`、`packages/studio`、`packages/core` |
| 当前前端 | `packages/studio/src/main.tsx` 与 `packages/studio/src/app-next/**` |
| 废弃边界 | 不恢复旧 routes、旧 provider、旧 shell、旧三栏 WorkspacePage、旧 ChatWindow |

## 任务分类与完成标准

| Class | 定义 | 可声明完成的证据 |
|---|---|---|
| FEATURE | 用户可见能力或产品工作流 | `/next`、CLI/headless 或真实浏览器/命令端到端证据；可见结果；持久化回读；失败路径透明 |
| ENABLER | API、类型、adapter、contract、route、service、refactor 等底座 | 聚焦测试、typecheck、合同测试；不得单独宣称功能完成 |
| GUARD | mock/hardcoded/security/contract/regression 守卫 | RED/GREEN 测试或脚本输出；不得单独宣称功能完成 |
| DOCS | README、docs、CLAUDE、AGENTS、规则、状态口径 | 受影响文档同步；CHANGELOG Unreleased 记录；旧口径搜索清理 |
| RELEASE | 版本号、compile、smoke、tag、GitHub Release | typecheck/test/compile/smoke、release commit、tag push、exe + SHA256 上传证据 |
| OPS | 本地运行、环境、配置、外部网关排障 | 实际命令/日志/健康检查；不得虚构部署或环境变量 |

## NovelFork 功能闭环门槛

用户可见功能只有满足以下条件时才算 FEATURE 完成：

1. 有真实用户入口：Studio `/next`、作品工作台、叙述者会话、CLI 或 headless API。
2. 走真实合同或运行时：不得用 fake/noop/mock/hardcoded 成功冒充。
3. 有用户可见结果：UI、CLI 输出、JSONL/transcript、工具卡或资源节点。
4. 涉及持久化时必须回读：文件、SQLite、章节、候选稿、草稿、Truth/story 资源。
5. AI 输出默认进入候选区/草稿区；用户确认后才影响正式正文。
6. 破坏性操作必须有确认门、checkpoint 或审计记录。
7. 模型/工具不支持时必须显示 unsupported/planned/prompt-preview 等透明降级，不伪造 current。
8. 单元测试、组件测试、合同测试、文档和 mock guard 只能作为辅助证据。

## Agent 与写作管线事实

### 管线

```text
首章：Architect → FoundationReviewer → Planner → Composer → Writer → PostWriteValidator → ContinuityAuditor → [Reviser] → StateValidator
续章：Planner → Composer → Writer → PostWriteValidator → ContinuityAuditor → [Reviser] → StateValidator
```

Reviser 仅在 ContinuityAuditor 发现 blocking issue 时触发。

### Agent 职责

| Agent | 类 | 产物 |
|---|---|---|
| Architect | `ArchitectAgent` | story_bible、volume_outline、book_rules、current_state、pending_hooks |
| FoundationReviewer | `FoundationReviewerAgent` | 首章基础设定审核意见 |
| Planner | `PlannerAgent` | `runtime/intent_ch{N}.md` |
| Composer | `ComposerAgent` | `runtime/context_ch{N}.yaml`、`rule_stack`、`trace` |
| Writer | `WriterAgent` | 章节正文 + RuntimeStateDelta |
| ContinuityAuditor | `ContinuityAuditor` | 审计结果和 blocking issues |
| Reviser | `ReviserAgent` | 修订后正文 |
| StateValidator | `StateValidatorAgent` | 状态一致性验证 |

### Truth Files

位于 `books/<id>/story/`：

| 文件 | 用途 |
|---|---|
| `author_intent.md` | 用户手写创作意图、核心卖点、目标读者、禁用元素 |
| `current_focus.md` | 用户手写当前卷冲突、近章推进、伏笔 |
| `story_bible.md` | 世界观、角色、势力 |
| `volume_outline.md` | 卷/章大纲 |
| `book_rules.md` | 写作规则约束 |
| `current_state.md` | 当前世界状态快照 |
| `particle_ledger.md` | 数值/资源账本 |
| `pending_hooks.md` | 伏笔追踪 |
| `chapter_summaries.md` | 已写章节摘要 |
| `runtime/` | 每章 intent/context/rule_stack/trace 中间产物 |

章节状态：`ready-for-review`、`audit-failed`、`state-degraded`。

ContinuityAuditor 关注 OOC、时间线、设定冲突、战力崩坏、数值、伏笔、节奏、文风、信息越界、词汇疲劳、利益链、年代考据、配角降智/工具人化、爽点虚化、台词失真、流水账等维度。

## 写作工作流事实

```bash
novelfork init <book-id>
novelfork write next <book-id>
novelfork write next <book-id> --count 5
novelfork write next <book-id> --context "这章要写..."
novelfork write next <book-id> --context-file ./guidance.txt
novelfork write next <book-id> --words 4000
novelfork audit <book-id> [chapter-number]
novelfork revise <book-id> <chapter-number> --mode spot-fix
novelfork import <book-id> --file ./existing-novel.txt
novelfork style analyze <book-id> --reference ./sample.txt
novelfork detect <book-id> [chapter-number]
novelfork daemon start
```

内置题材 profile 包括玄幻、仙侠、修真、都市、科幻、LitRPG、系统流、异世界、塔攀、地下城、进化流、恐怖、言情奇幻、日常、其他。

## 代码规范

- TypeScript strict。
- 所有 interface 字段用 `readonly`。
- 优先 `type` 而非 `interface`，除非需要 extends。
- Zod schema 命名：`type Xxx` 对应 `XxxSchema`。
- 内部模块导入使用 `.js` 后缀。
- 不用 `enum`，用 `as const` 对象或 union type。
- 不用 `class` 做数据容器；class 只用于有行为的 Agent/Manager。
- `core` 不依赖上层包；`studio → core`，`cli → studio/core`。
- prompt 复杂时抽独立文件；parser 独立文件；改 Writer/Settler prompt 必须同步 parser。
- 不在 Agent 内部直接读写 truth files，通过 PipelineRunner 协调。

## 测试与构建命令

```bash
pnpm typecheck
pnpm --dir packages/studio exec vitest run
pnpm --dir packages/studio exec vitest run src/app-next
pnpm --dir packages/studio exec vitest run src/app-next/backend-contract
pnpm --dir packages/cli test
pnpm exec playwright test
pnpm --dir packages/studio compile
bun run docs:verify
```

单元测试中 mock LLM 调用；核心 Agent 管线必须有集成测试。具体当前测试数量以 `CLAUDE.md` / `AGENTS.md` 和 `docs/08-测试与质量/01-当前测试状态.md` 为准。

## Git、文档与发布规则

- 提交格式：`type(scope): description`。
- `origin` 是 `vivy1024/novelfork`；GitHub CLI release/issue/PR/api 命令必须显式带 `--repo vivy1024/novelfork`。
- 不 force push master；回滚用 `git revert`，不用 `git reset --hard` + force push。
- 不提交 `.env`、API Key、密码、Token。
- 用户要求提交、验收完成或明确要求收尾时，视为授权执行验证、Git 提交与 `git push origin <branch>`。
- 代码、配置、流程、测试数量、构建命令、产物路径、发布状态任一变化，必须同步相关 README、docs、包级 README、CLAUDE、AGENTS，并记录到 CHANGELOG Unreleased。
- 正式发版必须完成版本资料同步、typecheck/test/compile/smoke、release commit、tag、push、GitHub Release 上传 `dist/novelfork-vX.Y.Z-windows-x64.exe` 与 SHA256。

## MCP 边界

项目内 MCP client 位于 `packages/core/src/mcp/`：`MCPManager → MCPClientImpl → Transport (Stdio | SSE)`。

开发时 MCP 工具（如 aivectormemory、browser/chromedevtools、github mcp）属于 IDE 层，不影响项目代码；不要把开发时 MCP 配置混入项目配置。

## 关联项目

| 项目 | 路径 | 触发场景 |
|---|---|---|
| Sub2API | `D:\DESKTOP\sub2api` | AI API 网关、代理、API 报错 |
| 文字修仙 | `D:\DESKTOP\文字修仙` | 修仙世界观、Electron 桌面壳、叙事经验 |
| OpenClaw | `D:\DESKTOP\openclaw` | 小说原文、GraphRAG、羽书 agent 架构 |

## 禁止事项

- 禁止虚构部署结果、环境变量、API 行为、配置。
- 禁止引用上游 InkOS 已废弃口径。
- 禁止为废弃代码新增 shim/noop/fake adapter 或假 provider/routes。
- 禁止把本应 unsupported/planned/prompt-preview 的能力写成 current。
- 禁止只用局部测试声明完整功能完成。
