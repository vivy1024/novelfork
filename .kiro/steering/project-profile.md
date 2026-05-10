# NovelFork Project Profile

## 产品身份

| 字段 | 内容 |
|---|---|
| 项目 | NovelFork — 中文网文小说 AI 辅助创作工作台 |
| 上游 | Fork 自 InkOS；选择性合并通用改进，不自动同步 |
| 开发者 | 薛小川 / GitHub `vivy1024`，禁止虚构 |
| 主要入口 | Studio `/next`、作品工作台、叙述者会话、`novelfork` CLI/headless |
| 当前目标 | 小说写作功能已接入新前端（novel-writing-features Phase 1-7 完成）；下一步：浏览器端到端验证 + v0.1.0 发布 |

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
| 当前前端 | `packages/studio/src/app-next/**` |
| 废弃边界 | 不恢复旧 routes、旧 provider、旧 shell、旧三栏 WorkspacePage、旧 ChatWindow |

## 任务分类与完成标准

| Class | 定义 | 可声明完成的证据 |
|---|---|---|
| FEATURE | 用户可见能力或产品工作流 | `/next`、CLI/headless 或真实浏览器/命令端到端证据 |
| ENABLER | API、类型、adapter、contract、route、service | 聚焦测试、typecheck、合同测试 |
| GUARD | mock/hardcoded/security/contract/regression 守卫 | RED/GREEN 测试或脚本输出 |
| DOCS | README、docs、规则、状态口径 | 受影响文档同步；CHANGELOG 记录 |
| RELEASE | 版本号、compile、smoke、tag、GitHub Release | typecheck/test/compile/smoke、tag push、exe 上传 |

## 当前已实现的核心功能

### 写作工作台
- 三栏布局：资源树 / 画布 / 叙述者会话
- 资源树 8 分组：章节/候选稿/草稿/大纲设定/真相文件/经纬/叙事线
- 章节 CRUD + 批准/拒绝
- 驾驶舱总览（CockpitOverview）：进度/字数/审校/风险/建议/经纬摘要/候选稿摘要
- 经纬资料编辑（JingweiEntryEditor）
- 候选稿管理（CandidateActionsBar）：接受(merge/replace/draft)/拒绝/归档/删除
- 写作工具面板（WritingToolsPanel）：7 种工具
- Checkpoint/Rewind（CheckpointPanel）

### AI 写作
- 写作模式：续写/扩写/过渡/对话/变体/大纲分支（真实 LLM 调用）
- AI 动作：write-next/draft/audit/revise/rewrite/detect（真实 LLM 调用）
- 选区变换：polish/condense/expand/audit
- 行内续写（SSE 流式）
- 智能大纲：generate/check/suggest

### 引导式生成
- PGI（Pre-Generation Interview）：后端生成追问 + 前端 UserQuestionGate 回答
- Guided Plan：后端生成计划 + 前端批准/拒绝
- Tier 1 问卷：建书时可选问卷（QuestionnaireWizard）
- 机制：复用 ToolConfirmationRequest + confirmTool（与 NarraFork AskUserQuestion 一致）

### 叙述者对话
- NarratorStatusBar：Context Ring / 模型切换 / 推理强度 / 权限模式
- Slash 命令：/help /status /model /permission /compact /fork /resume
- 确认门（ConfirmationGate）+ 用户问题门（UserQuestionGate）
- 消息右键菜单：回退/分叉/压缩/编辑重生成/删除
- 文件修改追踪（FileChangesPanel）
- 段落压缩（compact-before 接通）

### Agent 管线
- PipelineRunner：writeNextChapter/writeDraft/reviseDraft/audit/detect/style
- 5 种 Agent 角色：Writer/Planner/Auditor/Architect/Explorer
- 多 Agent 编排：workflow-executor + WorkflowProgressCard 可见执行链
- 工具链：cockpit → PGI → guided → candidate

### 设置与套路
- 供应商配置：API 供应商 + 平台集成
- 套路系统：命令/工具/MCP/权限/技能/子代理/提示词
- 全局 vs 项目配置，合并策略
- 新建会话时继承 routines 到 sessionConfig

### Onboarding
- 首次运行欢迎弹窗（FirstRunDialog）
- 仪表盘空态三步引导
- 学习中心（9 篇文档 + /next/learn 页面）
- 新书引导式创作向导（NewBookGuide，11题三模式：预设选择/自定义/跳过随机）

### 小说写作工具面板
- 写作预设面板（PresetsPanel）：流派/文风/基底/逻辑规则预设管理
- AI 味检测报告（AiTasteReport）：12 规则本地检测 + 朱雀 API
- 章节健康度（ChapterHealthCard + BookHealthSummary）：节奏/对话/句长直方图
- 选段写作（InlineWritePanel）：续写/扩写/补写 + 多版本变体（VariantsPanel）
- 日更进度追踪（DailyProgressCard）+ 节拍表（BeatProgressBar）
- 平台合规检查（CompliancePanel）+ 导出（ExportPanel）：TXT/Word/ePub
- 角色弧线（CharacterArcsPanel）+ 文风漂移检测（StyleDriftPanel）
- 模板市场（TemplateMarketPanel）

## Agent 与写作管线事实

### 管线

```text
首章：Architect → FoundationReviewer → Planner → Composer → Writer → ContinuityAuditor → [Reviser]
续章：Planner → Composer → Writer → ContinuityAuditor → [Reviser]
```

### Agent 职责

| Agent | 产物 |
|---|---|
| Architect | story_bible、volume_outline、book_rules、current_state、pending_hooks |
| Planner | `runtime/intent_ch{N}.md` |
| Composer | `runtime/context_ch{N}.yaml`、rule_stack |
| Writer | 章节正文 + 候选稿 |
| ContinuityAuditor | 审计结果（17+ 维度） |
| Reviser | 修订后正文 |

### Truth Files

位于 `books/<id>/story/`：

| 文件 | 用途 |
|---|---|
| `author_intent.md` | 创作意图、核心卖点、目标读者 |
| `current_focus.md` | 当前卷冲突、近章推进、伏笔 |
| `story_bible.md` | 世界观、角色、势力 |
| `volume_outline.md` | 卷/章大纲 |
| `book_rules.md` | 写作规则约束 |
| `current_state.md` | 当前世界状态快照 |
| `particle_ledger.md` | 数值/资源账本 |
| `pending_hooks.md` | 伏笔追踪 |
| `chapter_summaries.md` | 已写章节摘要 |

## 代码规范

- TypeScript strict，所有 interface 字段用 `readonly`
- 优先 `type` 而非 `interface`
- Zod schema：`type Xxx` 对应 `XxxSchema`
- 内部模块导入使用 `.js` 后缀
- 不用 `enum`，用 `as const` 或 union type
- `core` 不依赖上层包；`studio → core`，`cli → studio/core`
- 不在 Agent 内部直接读写 truth files，通过 PipelineRunner 协调

## 测试与构建命令

```bash
pnpm --dir packages/studio typecheck
pnpm --dir packages/studio exec vitest run
pnpm --dir packages/studio compile
pnpm --dir packages/cli test
bun run docs:verify
```

## Git、文档与发布规则

- 提交格式：`type(scope): description`
- `origin` 是 `vivy1024/novelfork`
- 不 force push master；回滚用 `git revert`
- 不提交 `.env`、API Key、密码、Token
- 代码变化必须同步文档和 CHANGELOG
- 正式发版：typecheck/test/compile/smoke → release commit → tag → push → GitHub Release

## MCP 边界

项目内 MCP client 位于 `packages/core/src/mcp/`。开发时 MCP 工具属于 IDE 层，不混入项目配置。

## 关联项目

| 项目 | 路径 | 触发场景 |
|---|---|---|
| Sub2API | `D:\DESKTOP\sub2api` | AI API 网关、代理、API 报错 |
| 文字修仙 | `D:\DESKTOP\文字修仙` | 修仙世界观、Electron 桌面壳 |
| OpenClaw | `D:\DESKTOP\openclaw` | 小说原文、GraphRAG、羽书 agent |

## 禁止事项

- 禁止虚构部署结果、环境变量、API 行为
- 禁止引用上游 InkOS 已废弃口径
- 禁止为废弃代码新增 shim/noop/fake adapter
- 禁止把 planned/unsupported 能力写成 current
- 禁止只用局部测试声明完整功能完成
