# Changelog

本文件记录 **NovelFork** 的版本变更。

---

## Unreleased

### 改进
- 移除当前 Provider Runtime 的虚拟模型 API/UI/store 口径，恢复为真实供应商、真实模型、平台账号与显式模型选择；运行策略不再展示虚拟模型 fallback、配额路由或写作任务虚拟绑定。
- 引入通用 Agent Turn Runtime 与 canonical message/tool_call/tool_result 工具循环协议，session chat 改为通过运行时事件持久化工具调用和结果，并在工具失败时把失败 tool_result 回传给模型生成最终说明。
- 统一 session tools 的确认/写入审计 metadata：confirmed-write 工具记录 confirmationAudit，questionnaire 提交确认前展示 mapping preview，candidate/narrative draft-write 结果记录目标资源与风险。
- 新增会话中心 API 与页面，支持独立/书籍/章节绑定筛选、归档/恢复、模型/权限/状态显示，并从工作台右侧叙述者入口可打开会话中心切换会话。
- 新增高级工作台模式（workbenchMode）隔离：作者模式下隐藏 Terminal/Browser/Bash/MCP/Admin 等高级工具入口和后端调用；高级模式下仍受权限模式与确认门约束。
- 新增 Headless Exec 服务（`POST /api/exec`）：非交互执行写作任务，复用 AgentTurnRuntime，遇确认门停止返回 pending 状态（exitCode=2），失败返回工具链摘要（exitCode=1）。
- 新增 `novelfork exec` CLI 命令：通过 HTTP 调用 Studio headless exec API，支持 `--json` JSONL 事件流、`--model provider:model`、`--book`、`--session`、`--stdin`、`--max-steps`。

### 文档
- 新增 `web-agent-runtime-v1` Kiro spec，将下一阶段统一为 Web 版通用 Agent Runtime：移除虚拟模型方向，保留真实 provider/model 显式选择，并规划结构化工具循环、会话中心、高级工作台模式、headless exec 与统一确认门。
- 更新能力矩阵至 v2.1，新增 Web Agent Runtime 能力段落，记录 Agent Turn Runtime、重复工具保护、会话中心、高级工作台模式、Headless Exec 与 CLI 的真实可用状态。
- 更新 spec 索引进度为 14/16 已完成。

## v0.0.5 (2026-05-03)

### 改进
- 完成 Agent-native Workspace v1 task22-task23 测试矩阵与收尾回归验收：补齐/核对 session tool loop、confirmation gate、GuidedGenerationState、cockpit snapshot、PGI metadata、renderer registry、workspace 三栏布局、canvas 打开候选稿和最小“写下一章”链路覆盖，并修复 Node/jsdom 下 `windowStore` 持久化 fallback；localStorage 写入失败时降级为内存存储并输出 warning，避免静默丢失持久化语义。
- 建立 Agent-native Workspace 共享类型契约，覆盖中间画布资源、工具执行结果、确认门、Guided Generation、PGI、叙事线快照与会话工具结果 metadata，并补齐权限风险映射测试。
- 新增 Studio-facing Session Tool Registry，注册首批 cockpit、questionnaire、PGI、guided、candidate 与 narrative session tools，支持按会话权限模式过滤与 provider tool schema 序列化，并复用 agent-native workspace 共享风险契约。
- 新增 Session Tool Executor 骨架，统一处理工具存在性校验、输入 schema 校验、权限风险拦截、pending confirmation、执行计时与错误包装，避免写入类 session tools 在 read/plan 模式或确认前执行。
- 扩展 LLM runtime 与 provider adapter 工具调用契约，支持向工具能力模型传入 session tools、解析结构化 `tool_use`，并在模型不支持工具循环时返回明确 `unsupported-tools` 降级。
- 在 session chat service 中实现最多 6 步的有界工具循环，持久化 tool-use/tool-result 消息，处理工具失败、pending confirmation、循环上限与 unsupported tools 错误恢复。
- 新增 session tools 确认门 API，支持查询 pending confirmations、提交批准/拒绝决策、记录审计字段，并在拒绝后回灌错误 tool result 且清除待确认状态。
- 抽出 Cockpit 共享数据服务并接入 `cockpit.get_snapshot`、`cockpit.list_open_hooks`、`cockpit.list_recent_candidates` session tools 与 REST drilldown routes，确保缺失焦点、无候选稿、无模型配置等状态返回真实 missing/empty 信息而非 mock 数据。
- 将 Questionnaire 能力接入 session tools，支持列出模板、启动结构化问题卡、提交回答复用现有 Bible/Jingwei mapping 事务写入，并在未配置真实 provider/model 时返回明确 unsupported AI 建议状态。
- 将 PGI 能力接入 session tools，支持基于 escalating 矛盾和临近伏笔生成生成前追问、记录回答/跳过审计 metadata，并格式化为 writer 可用的本章作者指示。
- 实现 Guided Generation Mode 基础状态机与 session tools，支持进入只读引导模式、回答/跳过结构化问题、提交计划到确认门，并在批准或拒绝后记录可恢复的 guided metadata 与画布 artifact。
- 实现 `candidate.create_chapter` session tool，生成内容默认写入 `generated-candidates/` 候选区并返回 `candidate.created` artifact，确保不覆盖正式章节；未配置可用模型时返回 prompt-preview/unsupported 状态。
- 建立 Tool Result Renderer Registry，按 tool result renderer 或工具名渲染驾驶舱快照、开放伏笔、Guided/PGI 问题、引导计划、候选稿产物与经纬变更预览，并保留 generic ToolCallBlock fallback。
- 提取 ChatWindow 可复用结构，新增 docked 叙述者面板宿主，保留 floating 工作台宿主、模型/权限/推理控制、recovery banner、最近执行链、工具调用块与输入状态。
- 将工作台装配为左侧 WorkspaceLeftRail、中间 WorkspaceCanvas 与右侧固定叙述者会话，支持多资源 tab、dirty 切换拦截、Agent artifact 打开、默认 writer 会话自动创建/复用，并将旧驾驶舱/经纬/写作入口降级为画布/工具复用能力而非右侧主 Tab。
- 扩展叙述者会话 canvas context 协议，将当前 active resource、open tabs、选区与 dirty 状态随消息发送给 session runtime，后端净化后注入 system prompt、用户消息 metadata 和 session tool 上下文，并在 dirty 资源存在时阻断写入类工具执行。
- 新增 Narrative Line 只读快照服务、`GET /api/books/:bookId/narrative-line` route 与 `narrative.read_line` session tool，基于章节、章节摘要、经纬事件/设定、冲突、伏笔和人物弧光生成 nodes/edges/threads/warnings，并以画布 artifact 展示。
- 新增 Narrative Line 变更草案与确认写入链路：`narrative.propose_change` 仅生成 mutation preview，`POST /api/books/:bookId/narrative-line/propose|apply` 在用户明确 approve 后写入 `story/narrative_line.json`，并记录批准时间、session ID、confirmation ID、目标节点/边与变更摘要。
- 打通最小「写下一章」session-first 链路：system prompt 明确 cockpit snapshot → PGI → guided plan → 用户批准 → candidate.create_chapter 顺序；确认 guided plan 后可继续执行模型返回的 candidate tool_use，候选生成失败时停止后续写入并保留已完成调查结果。
- 更新主动文档与产品口径为 Agent-native session-first 工作台：右侧固定叙述者会话、中间多资源画布、左侧资源栏；历史驾驶舱/经纬/写作面板降级为工具结果卡片和画布组件，并补充 `unsupported-tools` 模型降级说明。

### 文档
- 同步 README、Studio README、`CLAUDE.md`、`AGENTS.md` 与测试状态文档的 Studio 全量测试数量口径为 156 files / 898 tests，并更新 active spec 进度为 23/23。
- 新增 `agent-native-workspace-v1` spec 与任务文档，明确工作台恢复为右侧叙述者会话主入口、中间画布、左侧资源栏，并将引导式生成定义为 Plan Mode 风格的工具链与确认门；同步 `.kiro/specs/README.md` 当前 active spec 索引。
- 同步 README、Studio README、测试状态与架构总览中的测试数量、编译命令和 release 产物口径。
- 将“代码/配置/流程变更必须同步文档与 CHANGELOG、验收前全仓核对旧口径”的文档纪律写入 `CLAUDE.md` 与 `AGENTS.md`。
- 同步 `.kiro/steering/` 中的项目结构、Tauri 退役、构建测试命令与文档发布纪律口径。

### 修复
- 修复单文件 release 产物入口对 `--root` / `--port` 命名启动参数的解析，保留旧版 positional root fallback，确保 `dist/novelfork-v0.0.5-windows-x64.exe --root=. --port=<port>` 可直接冒烟启动。
- 修复 OpenAI-compatible provider 不能调用含点号 session tool 的问题：发送给上游前将内部工具名映射为 provider-safe function name，并在返回 tool call 时还原内部工具名，确保官方 DeepSeek 等严格校验 function name 的 provider 可执行 `cockpit.get_snapshot`、PGI 与 Guided 工具链。

## v0.0.4 (2026-05-02)

### 改进
- 将 Studio 共享可见 UI 文案统一归入中文口径，覆盖聊天、Routines、Provider、权限、监控、搜索与工具结果等组件。
- 强化 release 版本管理规则，明确版本变动需同步 package、CLAUDE、AGENTS、CHANGELOG，任务验收后需 push，正式发布需推送 tag 并上传 GitHub Release 产物。

### 测试
- 更新 Studio 本地化断言，并新增 UI completion audit，防止核心共享 UI 文案回退为英文。

## v0.0.3 (2026-05-02)

### 修复
- 修复根 `bun:compile` 与 Studio 权威编译链路不一致的问题，删除旧资源生成器入口。
- 修复 Studio Next 搜索、项目模型覆盖、工作流页面与现有 API 的契约断链。
- 修复 CI / release 工作流、CLI 当前文案、Node 版本口径与仓库本地残留追踪问题。
- 清理已退役 Tauri 桥接代码、依赖与前端运行时残留，补充插件生命周期解绑能力。

### 测试与文档
- 新增 compile、search、app-next API、CI/release、仓库卫生、Tauri 退役边界、CLI 口径、插件生命周期回归测试。
- 修正文档头信息与视觉审计标记，恢复 `docs:verify` 与 Studio Next 视觉审计验证。

## v0.0.2 (2026-05-01)

### 桌面应用
- 默认启动 NarraFork 风格应用窗口：底层使用 Edge/Chrome app mode 渲染 Studio，不显示浏览器地址栏、标签页或普通浏览器外壳。
- 新增 `NOVELFORK_NO_BROWSER=1`、`NOVELFORK_WINDOW_MODE=none|browser|app`、`NOVELFORK_BROWSER_PATH` 等窗口启动控制。

### 构建与发布
- 恢复 `bun compile` 前端资源嵌入，单文件产物内置 Studio 静态资源。
- 编译脚本同步生成根目录 `dist/novelfork.exe` 和带版本号的 release 产物。

## v0.0.1 (2026-05-01)

### 创作工作台
- 三栏布局：资源树 / TipTap 富文本编辑器 / 右侧面板
- 资源管理器：章节、候选稿、草稿、大纲、经纬、故事文件、真相文件、素材、发布报告
- Truth/Story 文件全部中文化（18 个映射）
- 章节/草稿/候选稿/文件删除功能（6 个 DELETE API）
- 导出 Markdown/TXT

### 写作模式
- 6 种写作模式接入 LLM 真实生成（续写/扩写/补写/对话/多版本/大纲分支）
- 非破坏性写入：AI 结果只进候选区
- prompt-preview 降级路径（无 session LLM 时）

### AI 动作
- 生成下一章 / 续写段落 / 审校 / 改写 / 去 AI 味 / 连续性检查
- 所有动作返回真实 API 数据（非固定文案）

### Agent 系统
- 5 种 Agent 角色：Writer / Planner / Auditor / Architect / Explorer
- agentId → 专属 system prompt（200+ 行领域知识/角色）
- session-chat-service 自动注入 agent prompt
- 编排函数 runWritingPipeline（Explorer → Planner → Writer → Auditor）
- Explorer Agent 新增（只读探索角色）
- ToolsTab 默认开关调整：9 开 / 13 关

### 驾驶舱
- 右侧面板默认 Tab：总览 / 伏笔 / 设定 / AI
- 总览：日更进度 + 章节进度 + 当前焦点 + 最近摘要 + 风险
- 伏笔：bible foreshadow events + pending_hooks.md 预览
- 设定：bible settings + book_rules.md
- AI：provider/model 状态 + 最近候选稿 metadata

### 故事经纬
- Bible/Jingwei API：人物/事件/设定/章节摘要 CRUD
- 三种可见性：tracked / global / nested
- 时间线纪律（防剧透）
- 经纬模板应用
- 问卷系统 + AI 建议 + 核心设定变更协议

### 合规与预设
- 敏感词扫描（5 平台规则集）
- AI 味检测（12 规则本地 + 朱雀 API）
- 发布就绪检查 + AI 使用声明生成
- 6 流派 / 5 文风 / 6 基底 / 8 逻辑规则预设

### 工程底座
- createAppStore：全局状态 pub/sub（35 行）
- API Client：15+ typed 方法（books/chapters/candidates/progress）
- 统一工具目录：Core 18 + NarraFork 22 = 40 个工具
- bun compile：单文件可执行程序（115MB）

### 平台
- PWA 支持（autoUpdate + standalone）
- Bun + Hono + React 19 + SQLite + Vite
- 137 测试文件 / 801 测试 / typecheck 通过

### 文档
- 能力矩阵 v2.0（覆盖全部 spec）
- 系统架构 / 创作流程 / 使用指南 / API 接口 全部更新
- AI 写作工具对比分析
- 根/包/文档 README 完善

---

## v0.0.0 (2026-04-19)

### 项目基础
- Fork 自 InkOS，专注中文网文创作
- monorepo 结构：core / studio / cli
- Bun + React 19 + Hono + SQLite 技术栈
- 多 Agent 写作管线骨架
- 旧平台纠偏，文档重构
