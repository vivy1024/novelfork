# Studio IDE Layout v1 Tasks

## Overview

将 NovelFork Studio 前端从固定三栏布局重写为 IDE 风格可拖拽多面板布局。分阶段实现：先搭骨架，再迁移组件，最后接入新功能。

## Tasks

- [x] 1. 实现 SplitView 基础组件
  - 新增 `SplitView` 组件，支持水平分割、拖拽 resize handle、面板折叠/关闭。
  - 支持 `minWidth` 约束、双击恢复默认宽度、面板关闭时相邻面板扩展。
  - 新增 `usePanelLayout` hook，从 preferences 读写面板宽度和折叠状态。
  - 验证：单测覆盖拖拽、折叠、恢复、持久化。
  - 覆盖需求：R1。

- [x] 2. 搭建 StudioApp 骨架与新路由入口
  - 新增 `StudioApp` 组件，使用 `SplitView` 组合 Sidebar + EditorArea + ConversationPanel 三区。
  - 注册新路由入口（替换或并行于现有 `StudioNextApp`）。
  - 三区先用占位组件，确认骨架布局正确。
  - 支持 `Ctrl+B` 切换 Sidebar、`Ctrl+J` 切换对话框。
  - 验证：骨架渲染、快捷键、面板折叠/展开。
  - 覆盖需求：R1、R6。

- [x] 3. 实现左侧 Sidebar 骨架
  - 新增 `Sidebar` 组件，包含叙事线区域、叙述者区域、底部套路/设置入口。
  - 叙事线和叙述者各自可折叠/展开。
  - 底部套路/设置点击跳转到对应页面。
  - 验证：折叠/展开、套路/设置跳转。
  - 覆盖需求：R2。

- [x] 4. 迁移叙事线（书籍资源树）到 Sidebar
  - 将现有 `ResourceTree` 和书籍选择逻辑迁移到 `StorylineTree` 组件。
  - 每本书可展开显示章节、经纬、大纲、故事文件等子节点。
  - 点击子节点在中间 EditorArea 打开 tab。
  - 点击书籍节点展开并显示写书方式入口。
  - 验证：资源树渲染、点击打开 tab、写书方式入口。
  - 覆盖需求：R2。

- [x] 5. 迁移叙述者（会话列表）到 Sidebar
  - 将现有 `SessionCenter` 逻辑迁移到 `NarratorList` 组件。
  - 显示活跃会话列表，支持点击切换、新建、清理。
  - 从叙事线选择写书方式时自动创建绑定会话。
  - 独立会话由摘要模型自动命名。
  - 叙事线和叙述者标题可点击打开全屏历史/归档页面。
  - 验证：会话列表、切换、新建、自动命名、全屏页面。
  - 覆盖需求：R2。

- [x] 6. 实现中间 EditorArea 多 Tab 系统
  - 新增 `EditorArea` 组件，包含 `TabBar` + `TabContent`。
  - 支持多 tab 打开/切换/关闭，dirty 标记，关闭时保存提示。
  - 复用现有编辑器组件：`InkEditor`（章节）、候选稿预览、经纬详情、大纲编辑器。
  - 从对话框工具卡片点击"在画布打开"时在 EditorArea 新开 tab。
  - 验证：多 tab 操作、dirty 拦截、组件复用。
  - 覆盖需求：R3。

- [x] 7. 重写右侧 ConversationPanel 骨架
  - 新增 `ConversationPanel` 组件，包含 ConversationHeader + ConversationBody + GitStatusBar + InputArea。
  - ConversationBody 支持对话视图和 Git 视图切换。
  - 对话视图复用现有 `ChatWindow` 的消息渲染逻辑。
  - 无活跃会话时显示空状态。
  - 验证：骨架渲染、视图切换、空状态。
  - 覆盖需求：R4。

- [x] 8. 实现对话框输入区与上下文监控
  - 新增 `InputArea` 组件，底部固定。
  - 上下文监控指示器：圆圈 + 百分比，点击展开 token 详情、裁剪/压缩/清空按钮。
  - 模型选择器按供应商显示对应配置（Codex fast/推理、DeepSeek 推理模式等）。
  - 权限模式、推理强度选择器。
  - 输入框 + 发送按钮。
  - 验证：上下文展开/收起、模型配置适配、发送消息。
  - 覆盖需求：R4。

- [x] 9. 实现对话框内 Git 面板
  - 新增 `GitChangesView` 组件，在对话框 ConversationBody 内作为切换视图。
  - 显示 git 状态栏（分支名 + 改动统计）。
  - 变更/提交/暂存 tab + 文件变更列表。
  - 支持暂存、提交操作。
  - 验证：git 状态显示、文件列表、暂存/提交。
  - 覆盖需求：R4、R5。

- [x] 10. 实现会话头部（详情/归档）
  - 新增 `ConversationHeader` 组件。
  - 显示会话名称（可编辑）、详情按钮、归档按钮。
  - 详情弹出显示 agent、模型、权限、消息数、创建时间、绑定叙事线等。
  - 归档操作调用现有 session API。
  - 验证：名称编辑、详情展示、归档操作。
  - 覆盖需求：R4。

- [x] 11. 迁移对话流消息渲染
  - 将现有 `ChatWindow` 的消息列表、工具调用卡片、确认门、工具结果卡片迁移到 `ChatFlow` 组件。
  - 保持 Claude Code 风格的单栏垂直对话流，工具调用内联展示。
  - 支持虚拟滚动（长对话性能）。
  - 验证：消息渲染、工具卡片、确认门、滚动性能。
  - 覆盖需求：R4。

- [ ] 12. 退役旧布局并更新文档（延后：新布局骨架已完成，但数据接入和核心逻辑迁移需要后续 spec）
  - 移除 `StudioNextApp` + `NextShell` + `ResourceWorkspaceLayout` 旧布局。
  - 更新路由入口指向新 `StudioApp`。
  - 移除 `DashboardPage`、`WorkflowPage` 等独立页面（功能收入 Sidebar 或设置）。
  - 更新 CHANGELOG、能力矩阵、CLAUDE.md 测试数量。
  - 验证：旧代码不再被引用、typecheck 通过、测试通过。
  - 覆盖需求：R1-R6。

- [x] 13. 实现 Token 计数与上下文监控
  - 新增 `api/lib/token-counter.ts`：`tokenCountFromUsage`、`roughTokenEstimation`、`tokenCountWithEstimation`。
  - 在 `LlmRuntimeService.generate` 返回时提取 API usage 数据并存入会话元数据。
  - 从 provider adapter 的 `capabilities.contextWindow` 读取模型上下文窗口大小。
  - 前端上下文监控指示器：圆圈 + 百分比 + 点击展开详情。
  - 验证：token 计数准确性、上下文百分比显示、粗估 fallback。
  - 覆盖需求：R7。

- [x] 14. 实现 MicroCompact（旧工具结果折叠）
  - 新增 `api/lib/compact/micro-compact.ts`：遍历消息，将旧工具结果替换为摘要占位符。
  - 保留最近 N 条工具结果不折叠。
  - 在 `runAgentTurn` 循环中每次 `generate()` 前执行。
  - 验证：工具结果折叠、最近结果保留、token 节省量。
  - 覆盖需求：R7。

- [x] 15. 实现 Full Compact（AI 摘要压缩）
  - 新增 `api/lib/compact/full-compact.ts`：调用摘要模型生成对话摘要。
  - 小说创作版摘要模板（写作请求、章节进度、经纬变更、工具历史、待办、guided state）。
  - 压缩后恢复最近章节内容和活跃 guided state。
  - 阈值触发：MicroCompact 后仍超过 `contextTruncateTargetPercent`。
  - 连续失败 3 次熔断。
  - 验证：摘要生成、恢复逻辑、熔断机制。
  - 覆盖需求：R7。

- [x] 16. 移除 50 条消息硬上限，改为 token 驱动
  - 移除 `MAX_SESSION_MESSAGES = 50` 和 `trimSessionMessages` 的 `slice(-50)`。
  - 消息上限改为纯 token 阈值驱动（由 MicroCompact + Full Compact 控制）。
  - 验证：长对话不再被截断、压缩正常触发。
  - 覆盖需求：R7。

- [x] 17. Agent 工具循环增强
  - `RuntimeControlSettings` 新增 `maxTurnSteps`（默认 200），替代硬编码 6。
  - 工具失败后回灌给模型继续（连续 3 次相同失败才停止）。
  - 新增智能输出中断检测：空回复重试、非空由摘要模型判断截断。
  - 新增宽松规划模式（`relaxedPlanning`）和 YOLO 跳过只读确认（`yoloSkipReadonlyConfirmation`）。
  - 验证：200 步循环、失败继续、中断检测、宽松规划、YOLO 模式。
  - 覆盖需求：R8。

- [x] 18. AI 代理设置面板重构
  - AI 代理面板新增：每条消息最大轮次、翻译思考内容、默认展开推理、宽松规划、YOLO 跳过只读确认、智能输出中断检测、滚动自动加载、要求用户语言、显示 Token 用量、显示输出速率。
  - 模型 section 改为可编辑：新增 Explore/Plan/General 子代理独立模型选择、Codex 专属推理强度。
  - 从 AI 代理面板移除 MCP 策略和 allowlist/blocklist（统一由套路页管理）。
  - 将行为开关写入核心 `RuntimeControlSettings` 类型。
  - 验证：所有字段可编辑保存、类型安全、套路页不冲突。
  - 覆盖需求：R9。

- [x] 19. 实现流式输出
  - 修改 provider adapter 支持 streaming 模式：OpenAI-compatible adapter 使用 `stream: true`，返回 SSE 事件流。
  - 修改 `LlmRuntimeService.generate` 支持 streaming callback，逐 token 回调。
  - 修改 `AgentTurnRuntime` 支持流式 `assistant_message` 事件（增量推送）。
  - 修改 `session-chat-service` 通过 WebSocket 逐 token 推送给前端。
  - 前端 ChatFlow 组件支持逐字渲染 + 打字动画指示器。
  - 支持 Escape 中断当前流式输出。
  - 不支持流式的 provider 降级为一次性返回。
  - 新增实时输出速率指示器（字符/秒，3 秒滑动窗口）。
  - 验证：流式渲染、中断、降级、速率显示。
  - 覆盖需求：R10。

- [x] 20. 实现每轮 Token 用量与费用追踪
  - 在每条 AI 回复的 runtime metadata 中记录 input_tokens / output_tokens。
  - 前端在每条 AI 回复下方可选显示 token 用量（受"显示每轮 Token 用量"开关控制）。
  - 会话级累计 token 统计，在会话详情中展示。
  - 验证：token 数据准确、显示/隐藏开关、累计统计。
  - 覆盖需求：R11。

- [x] 21. 实现翻译思考内容
  - 检测 AI 回复中的 thinking/reasoning block。
  - 当"翻译思考内容"开关开启且摘要模型已配置时，异步调用摘要模型翻译为用户语言。
  - 前端同时保留原始内容和翻译内容，支持切换查看。
  - 摘要模型未配置时跳过翻译。
  - 验证：翻译触发、双语切换、未配置降级。
  - 覆盖需求：R12。

- [x] 22. 搜索系统升级到 SQLite FTS5
  - 将搜索引擎从内存 `includes()` 迁移到 SQLite FTS5 全文索引。
  - 支持中文分词（使用 simple tokenizer 或 unicode61）。
  - 章节/经纬/大纲内容变更时自动更新索引。
  - 搜索结果按相关度排序，返回匹配片段高亮。
  - 服务重启后索引持久化，不丢失。
  - 验证：中文搜索准确性、自动索引更新、重启后持久化。
  - 覆盖需求：R13。

- [x] 23. 写作工具健康仪表盘补全
  - 连续性分数：从审计结果（`/api/books/:bookId/audit`）聚合。
  - 钩子回收率：从 pending_hooks 和已回收伏笔计算。
  - AI 味均值：从过滤报告（`/api/books/:bookId/filter/report`）聚合。
  - 节奏多样性：从节奏分析（`/api/books/:bookId/rhythm`）聚合。
  - 移除 mock-debt-ledger 中对应的 4 个占位条目。
  - 验证：4 个指标返回真实数据、无占位。
  - 覆盖需求：R14。

- [x] 24. 实现会话自动命名
  - 独立叙述者第一轮对话完成后，异步调用摘要模型生成会话名称（最多 20 字）。
  - 更新 session title 并通过 WebSocket 通知前端刷新 sidebar。
  - 摘要模型未配置时使用用户消息前 30 字符作为 fallback。
  - 验证：自动命名触发、sidebar 更新、fallback。
  - 覆盖需求：R15。

- [x] 25. 修复 AI 味检测前端
  - 检查 `DetectPanel` 调用的 `/api/books/:bookId/detect/stats` 和 `/api/books/:bookId/detect` 端点。
  - 如果端点不存在，新增路由或将 DetectPanel 改为调用已有的 `/api/filter/scan` 端点。
  - 验证：DetectPanel 不再 404、检测结果正常展示。
  - 覆盖需求：R16。

- [x] 26. 实现代理管理（网络代理）
  - 新增设置页 section：代理管理。
  - 为每个平台集成（Codex/Kiro）和 API Key 供应商显示独立的代理配置输入框。
  - 新增 WebFetch 代理配置。
  - 修改 provider adapter 在发起 API 请求时使用对应的代理设置。
  - 验证：代理配置保存、API 请求通过代理、未配置时直连。
  - 覆盖需求：R17。

- [x] 27. 实现终端管理
  - 新增设置页 section：终端管理。
  - 显示 agent Terminal 工具创建的所有终端列表（运行中/已退出），包含名称、状态、进程、工作目录、创建时间。
  - 运行中的终端支持查看输出和发送输入。
  - 已退出的终端支持清理。
  - 验证：终端列表显示、输出查看、清理操作。
  - 覆盖需求：R18。

- [x] 28. 实现模型聚合
  - 在设置 > 模型中新增"模型聚合"区域。
  - 支持添加聚合：选择多个供应商的同一模型，聚合为一个条目。
  - 聚合模型在模型选择器中显示为单一条目，选择时可切换供应商或自动路由。
  - 某个供应商不可用时自动切换到其他可用供应商。
  - 验证：聚合创建、选择器展示、自动切换。
  - 覆盖需求：R19。

- [x] 29. 实现章节与工作区管理
  - 新增设置页 section：章节与工作区。
  - 配置项：最大活跃工作区数、工作区大小警告、休眠自动保存、不活跃自动休眠时间。
  - 叙事线详情页显示章节列表，每个章节对应一个 git worktree。
  - 支持批量合并（merge worktree 回主分支）和清理（删除已合并 worktree）。
  - 不活跃工作区自动休眠。
  - 验证：配置保存、章节列表、合并、清理、自动休眠。
  - 覆盖需求：R20。

- [x] 30. 回归验证与收尾
  - 运行全量 typecheck 和测试。
  - 核对 NarraFork 设置/套路页的每个字段在 NovelFork 中都有对应。
  - 核对全部已完成 spec 的功能无回归。
  - 更新 CHANGELOG、能力矩阵、CLAUDE.md。
  - 覆盖需求：R1-R20。
