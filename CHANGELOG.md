# Changelog

本文件记录 **NovelFork** 的版本变更。

## Unreleased

## v1.2.1 (2026-06-02)

### 🐛 Bug 修复

- **ToolSearch 结果 [object Object]** — narrator 无法识别自己的工具列表，修复 toolResultContent 类型守卫
- **右键"回退到此处"不工作** — truncate API 改为真正删除消息（之前只标记 contextCutoffSeq）
- **"编辑重新生成"变二次发送** — 与上一条同源，修复后正常截断+重发
- **"清空上下文"与"回退"混淆** — 区分 delete 模式（真删）和 cutoff 模式（保留消息但模型忽略）
- **新书默认 targetChapters 硬编码** — 去掉后端 200 和前端 100 的默认值，创建时不设默认
- **目录白名单全局共享** — 加入会话级 workDir 和 books/{projectId}/ 到允许列表
- **import_chapters 路径防护过严** — allowedRoots 加入 options.workDir
- **Agent 把角色写入 canon 层** — prompt 中加入 layer 选择规则

### 🛡️ Agent 稳定性

- **XML tool_use 容错解析** — 模型 regression 输出原始 XML 工具调用时，自动解析为结构化 tool_use
- **stop_reason 感知** — 检测 max_tokens 截断并警告
- **上下文中毒防御** — 漏网的 XML tool_use 不存入历史，防止级联故障
- **max_tokens 提升到 16384** — 减少截断导致的格式泄漏

### ✨ 新功能

- **引导式创建书籍** — 新书首次打开时显示 NewBookGuide 引导配置流程

## v1.2.0 (2026-05-31)

### 🏗️ 架构统一：删除 PipelineRunner

- **删除 CLI 包**（packages/cli）— InkOS 遗产，无人使用
- **删除 PipelineRunner**（3187 行）— 所有写作能力统一到 Agent 工具层
- **删除 pipeline 基础设施**（scheduler、agent loop、builtin-tools）— 共删除 ~21000 行
- Agent 工具层为唯一执行路径，不再有两套并存系统

### 📖 书籍设置页面

- 驾驶舱底部"设置"入口，打开全屏书籍设置页面
- 整合：基本信息、写作参数（目标章数/每章字数/弧线追踪/敏感词）、预设配置、节拍模板
- 删除全局写作设置页面（配置移到书籍级别）
- 角色弧线追踪从全局设置移到书籍级别

### 🛠️ 新增 Agent 工具

- `pipeline.revise` — 修订章节（审计+修订，5 种模式）
- `pipeline.import_chapters` — 整书导入（分章+基础设定+文风提取）
- `style.import` — 从参考文本提取文风
- `style.get_profile` — 获取书籍文风档案
- `rewrite.apply` — 将改写结果写回章节文件
- `presets.list_available` — 列出所有可用预设
- `chapter.list` — 列出章节目录
- `jingwei.write` 新增 `mode=append` 追加模式
- `presets.set_rules` 新增 `mode=add/remove` 防止预设丢失
- `presets.create_custom` 创建后自动启用
- `hooks.manage(action=delete)` 实现

### 🗺️ 经纬系统改进

- 表单改为 Markdown 优先（结构化字段降级为元数据标签）
- 图谱视图按分类显示（仅有 relation 字段的分类）
- Agent prompt 包含 16 分类内容模板指引
- `jingwei.write` 工具支持 `fields` 参数

### 🔧 工具系统

- 恢复 4 个被错误废弃的工具（cockpit.list_open_hooks、presets.check_compliance、character.check_consistency、narrative.read_line）
- ToolConfigBar 全部可选，按角色默认配置
- StatusBar 精简为监控类（质量/AI味/警告）+ 设置入口

### 🛡️ 安全与稳定性

- Book lock 防止并发写入
- Path traversal 防护（import_chapters）
- routines 加载 2 秒缓存（避免重复文件读取）
- solidified 消息 ID 防碰撞

## v1.1.1 (2026-05-31)

### 🔧 修复与改进

- **Thinking 展示**：修复 AI 推理/思考内容不显示的问题（reasoning_content → thinking 映射）
- **Streaming 保留**：修复工具调用时模型文本被丢弃的问题（solidify streaming message）
- **编译 EPERM**：Windows 上编译时自动重命名运行中的 exe，无需手动关闭
- **套路系统生效**：systemPrompts、globalSkills、projectSkills、hooks、disabledCommands 全部接入运行时
- **预设注入**：写作管线现在正确注入 book.enabledPresetIds 中的预设到 system prompt
- **Agent 预设指引**：Agent prompt 中明确区分预设（写作规则）和经纬（世界观数据）

### 📖 书籍设置页面（新）

- 驾驶舱底部新增"设置"入口，打开全屏书籍设置页面
- 整合基本信息（书名/流派/平台/语言）、写作参数（目标章数/每章字数/弧线追踪/敏感词）、预设配置、节拍模板
- 删除全局写作设置页面（14 项配置不应该是全局的）
- 角色弧线追踪模式从全局设置移到书籍级别

### 🛠️ 工具系统

- 恢复 4 个被错误废弃的工具：cockpit.list_open_hooks、presets.check_compliance、character.check_consistency、narrative.read_line
- ToolConfigBar 所有工具改为可选（移除锁定概念），按角色提供合理默认配置
- 底部 StatusBar 精简为监控类（质量/AI味/警告）+ 设置入口

### 🗺️ 经纬面板

- 移除全局图谱 tab，改为按分类显示（仅有 relation 字段的分类显示"关系图谱"按钮）
- 外观设置：OLED 黑色模式生效，启动时加载外观偏好

## v1.1.0 (2026-05-29)

### 🏗️ 约束驱动写作系统 v2

- **工具精简**：从 37 个小说工具精简到 10 个核心工具（cockpit.snapshot, jingwei.read, jingwei.write, pgi.ask, scene.spec, pipeline.write, chapter.read, chapter.audit, rewrite.segment, hooks.manage）。旧工具保留但默认隐藏。
- **管线精简**：写作管线从 5 次 LLM 调用降到 2 次（Writer + AuditRevise）。新增 `pipeline.write` 接受结构化 Scene Spec。
- **Scene Spec**：新增 `scene.spec` 工具，生成结构化写作蓝图（角色/地点/冲突/情绪/结果），是写章节的硬前置条件（H4）。支持 LLM 智能规划 + fallback。
- **硬约束体系**：H1 Token 天花板、H2 Canon 不可变、H3 候选区边界、H4 Scene Spec 完整性、H5 用户确认门、H6 经纬工具写入、H7 POV 检测。
- **Agent prompts PEV 流程**：所有 Agent 角色切换到 7 步约束流程。

### 📚 经纬系统大修

- **核心包 + 目录化读取**：默认 4000 tokens 核心包 + 14 个标准分类目录，模型按需分页读取，不再全量注入。
- **Canon/Dynamic/Reference 三层分离**：Canon 条目不可变（只能追加），Dynamic 每章更新，Reference 按需查阅。
- **统一读取入口**：`jingwei.read(scope=brief/category/search)` 替代 4 个旧工具。
- **删除能力**：`jingwei.write(action=delete)` 支持删除条目（Canon 不可删）。
- **分类导入**：自动分类 + 摘要生成 + 导入报告。
- **summary_md 字段**：摘要/详情分离，模型默认读摘要。

### ⚡ Runtime 稳定性

- **ContextBudgetManager**：session 级 token 预算管理，工具输出按类型动态截断（经纬 6000 tokens，其余 2000）。
- **ProviderHealthManager**：per-provider 健康追踪、连续失败熔断、9 种错误分类、用户可读错误提示。
- **buildAgentContext 瘦身**：从最高 80k tokens 降到 8-12k（核心包 + briefing + 摘要）。移除前一章全文自动注入。
- **错误分类集成**：generate 失败时返回具体错误类型和用户可读描述。

### 🔧 工具增强

- **presets.check_compliance**：扩展到 4 个维度（AI 味、文学质量、逻辑连续性、风格禁忌）。
- **health.read_summary**：综合健康评分（进度/伏笔/经纬覆盖度），不再只返回原始 snapshot。
- **工具可见性分层**：写作 session 默认只暴露 ~18 个工具（10 核心 + 8 通用），schema token 消耗从 ~20k 降到 ~6k。

### 🔒 安全修复

- Canon layer 降级攻击防护（禁止修改 canon 条目的 layer）。
- Canon 检查 normalize 一致性修复（之前形同虚设）。
- 移除 fuzzy bookId 匹配（防止写入错误书籍）。
- 无效 action 值显式报错（不再静默 upsert）。

## v1.0.6 (2026-05-19)

### ✨ 多模型适配器 + Codex Fast Mode

- **DeepSeek 工具名编码**：`cockpit.get_snapshot` 等带 `.` 的工具名自动编码为 `cockpit__2e__get_snapshot`，响应中解码回来，修复 DeepSeek API 400 错误。
- **DeepSeek thinking signature 传回**：Anthropic 兼容端点的 thinking block signature 正确保存并传回，修复工具循环中断。
- **DeepSeek 模型别名**：`deepseek-chat`/`deepseek-reasoner` 等废弃名称自动映射到 `deepseek-v4-flash`。
- **Codex Fast Mode**：底部状态栏 Fast Mode 按钮正确接线，切换 `service_tier: "priority"` 发送到 API。
- **Codex 推理强度**：L/M/H 选择正确传递到 `reasoning_effort` 参数（之前硬编码 "medium"）。
- **Per-provider 参数转换**：GLM（strip cache_control）、MiMo/MiniMax（strip reasoning_effort/stream_options）、Qwen（enable_thinking for Qwen3）自动应用。
- **Provider 自动检测**：从 model/providerId/baseUrl 识别 deepseek/glm/kimi/minimax/qwen/mimo，按需应用转换。
- **AskUserQuestion 重复调用修复**：Agent prompt 明确禁止收到回答后再次调用。

## v1.0.5 (2026-05-19)

### ✨ UI 改进

- **UserQuestionGate 工具卡片化**：引导式生成问答表单改为可折叠工具卡片样式，header 显示问题数和进度，body 带 `max-h-[60vh]` 滚动和 sticky 操作栏，不再撑破屏幕。

### 🐛 修复

- **编辑重发消息容错**：右键消息"编辑并重新生成"时，如果 truncate API 失败，fallback 为直接发送新消息，不再静默吞掉。
- **统一资源节点 detailSource 标记**：从统一资源 API 加载的章节/候选稿/草稿标记为 `detailSource: "detail"`，避免走旧 chapters API 导致 "Chapter not found" 错误。

## v1.0.4 (2026-05-19)

### ✨ 统一资源版本系统

- **writing_resource 统一表**：章节/候选稿/草稿统一为 SQLite 单表，支持完整状态机（draft→candidate→accepted/rejected/archived）和版本链（parent_id）。
- **统一资源 REST API**：`/api/books/:bookId/resources` 7 端点（list/get/create/update/transition/delete/history），替代分散的文件操作。
- **候选稿操作栏**：接受（替换/合并/另存草稿）、拒绝、归档、删除，操作后资源树自动刷新。
- **草稿操作栏**：提交候选稿、直接采纳（指定目标章节号）、删除。
- **章节操作栏**：编辑为草稿（复制完整内容）、生成变体（创建候选稿副本）、查看版本历史。
- **版本历史面板**：显示 parent 链，每个版本显示标题/版本号/状态/时间。
- **资源树分组**：章节/候选稿/草稿/已归档/大纲与设定/经纬资料/伏笔/叙事线，优先从统一资源 API 加载。

### ✨ 经纬上下文分层

- **JingweiContextPolicy**：core/relevant/reference 三层策略，按 priority_tier 字段 + 自动规则分层。
- **buildJingweiContext mode 参数**：auto（core+relevant ~12000 tokens）/ core / relevant / full 四种模式。
- **jingwei.read_context 工具**：schema 增加 mode 字段，默认 auto 模式控制 token 消耗。
- **经纬条目优先级 UI**：编辑表单增加"上下文优先级"下拉（自动/核心/相关/参考）。

### 🐛 修复

- **TipTap 初始化 dirty 误报**：章节/草稿打开后不再错误显示"未保存"，修复 TipTap markdown normalize 触发的假 dirty 状态。
- **编辑为草稿/生成变体内容丢失**：改为先从 API 获取完整资源内容再创建，不依赖可能未 hydrate 的 resourceMap 闭包。
- **后端允许空 content 创建草稿**：`parseCreateInput` 不再对空字符串 content 抛异常。
- **旧路由兼容层**：`chapter-candidates.ts` 内部转发到统一资源 API，标记 deprecated。

## v1.0.3 (2026-05-18)

### 🐛 写章流程修复

- **AskUserQuestion 回答传递**：修复写章流程中 PGI/用户回答无法继续传递到候选生成的问题。
- **候选生成断点修复**：写章流程在问答后可以继续进入候选稿生成，不再卡在等待状态。
- **工具超时提升**：`candidate.create_chapter` 工具超时提升到 180s，降低长章节生成中断概率。

## v1.0.2 (2026-05-18)

### 🐛 模型兼容修复

- **小米模型工具调用兼容**：修复小米兼容接口对 `tool_call_id` 格式的要求，避免工具续跑时返回 `Param Incorrect`。

## v1.0.1 (2026-05-18)

### 🐛 首次启动修复

- **内嵌 migration SQL**：编译产物内置数据库迁移，修复新用户首次启动时 `no such table` 崩溃。

## v1.0.0 (2026-05-18)

### 🚀 首个正式独立版本

- **仓库独立化**：GitHub 仓库脱离 InkOS fork，NovelFork 以独立项目继续演进。
- **发布资料对齐**：根/包级 package、README、docs 与 release 资料同步到 v1.0.0。
- **Runtime 能力收口**：Claude Code 对标能力完成并发布，包含项目规则读取、LLM 压缩摘要、Subagent、后台任务、Prompt cache、ToolSearch、Skills、MCP、沙箱、Browser、Terminal、Headless CLI 与 stream-json。
- **小说工作台可用性收口**：多 Agent 写作管线、故事经纬、PGI/UserQuestionGate、候选稿、工具面板与编译产物进入正式分发口径。

## v0.9.3 (2026-05-18)

### ✨ 经纬系统与写作体验

- **jingwei.upsert_entry SQL 修复**：列名对齐实际表结构（tags_json/aliases_json/related_entry_ids_json/visibility_rule_json），时间戳改为 Unix ms
- **Agent 强制使用 jingwei 工具**：system prompt 明确禁止用 Write 写经纬内容，确保数据进入 SQLite 供后续章节上下文注入
- **UserQuestionGate UI 重写**：对标 NarraFork 样式（radio/checkbox + label/description + 自定义输入 + 帮我回答/跳过按钮）
- **对话自动滚动**：流式输出和工具调用时自动滚动到底部
- **ArtifactPanel 扩展**：支持 jingwei.upsert_entry 工具的实时内容展示（文件名 + 流式 Markdown）
- **驾驶舱 StatusBar 恢复**：资源树默认视图底部重新显示预设/节拍/质量/警告操作条
- **清空上下文改为 compact**：不再删除聊天记录，改为压缩上下文（保留最后 1 条消息），用户仍可查看历史
- **fetch error catch**：Bun HTTP server 加 try-catch 防止吞掉未捕获异常
- **onError 日志**：Hono 全局错误处理加 console.error 打印实际错误

### 🐛 修复（v0.9.2 后累计 54 commits）

- 压缩系统重写对标 Claude Code 结构化摘要 + NarraFork 双档阈值
- 经纬系统统一为 SQLite 单一数据源 + jingwei.upsert_entry 工具
- JingweiPanel 全屏作为画布默认视图 + contentMd 编辑器
- PGI + AskUserQuestion 配合（删除 guided 三工具）
- 生成式浮现面板（ArtifactPanel）
- Context Ring 显示当前窗口占用而非累计
- 清空上下文 404 修复
- PGI chapterNumber 可选 + FileChangesPanel 路径修复
- 全面代码清理（674 行删除）
- 驾驶舱预设/模板面板修复
- ToolSearch 分词搜索 + 工具名下划线格式 fallback
- Skills 编译自动复制 + 套路页磁盘技能展示

### ✨ 错误透传与上下文可视化

- **全局错误透传**：session:error 事件完整透传到前端，显示红色错误气泡（含重试/忽略/自动重试按钮）
- **Toast 通知**：错误发生时右上角弹窗显示具体错误信息
- **状态栏变色**：error 时红色背景，retrying/waiting 时黄色背景
- **压缩失败广播**：compact 失败时通过 WebSocket 广播错误（替代前端 alert）
- **上下文注入可视化**：Context Ring 菜单新增"查看上下文详情"，展示各部分 token 占用分解
- **RuntimeError 共享类型**：前后端统一的结构化错误类型

## v0.9.2 (2026-05-18)

### ✨ 通用能力补全

- **自定义重试规则**：用户在设置中定义的 retryRules 现在被 LLM runtime 真实消费（按 HTTP 状态码 + 内容关键词匹配）
- **全局提示词注入**：套路系统中已启用的 globalPrompts 自动注入所有叙述者的 system prompt
- **自定义子代理类型**：套路页定义的 SubAgent（systemPrompt + toolPermissions）在 Agent handler 中被查找和执行
- **用户自定义斜杠命令**：套路 commands 注入 Composer 补全列表，`/命令名 参数` 展开 prompt 模板后发送
- **更新检查**：`GET /api/settings/check-update` + 启动时非阻塞自动检查 + AboutPanel 手动检查 UI
- **ServerSettings.autoCheckUpdate**：正式字段，默认 true

### 📚 学习文档

- 新增 6 篇学习文档（13-18）：运行时能力、子代理系统、工具搜索与技能、安全与沙箱、浏览器与终端、网络工具
- 更新 04-narrator-conversation.md：新增 v0.9.x 工具表格
- 更新 06-settings-and-routines.md：服务器配置、运行时控制、套路新功能
- 更新 README.md 索引：扩展到 18 篇 + 新增"Agent 能力"场景导航

## v0.9.0 (2026-05-18)

### 🚀 Runtime 能力对标 Claude Code

**Phase 1 — 基础 Runtime**
- **CLAUDE.md 读取**：Agent 自动读取项目规则（全局 + 项目 + .claude/rules/）
- **LLM 压缩摘要**：调用摘要模型生成智能摘要（不再是文本拼接）
- **Staleness check**：Write/Edit 前检查文件 mtime，防止覆盖外部修改
- **文件 dedup**：重复读同一文件返回 stub，节省 token

**Phase 2 — 多 Agent 与后台任务**
- **Subagent 系统**：Agent 工具支持 explore/plan/general 三种子代理，使用对应模型配置
- **后台 Bash**：`run_in_background` 参数 + Await 工具等待完成
- **模型聚合路由**：priority/round-robin/random 三种策略

**Phase 3 — 成本优化**
- **Prompt cache**：Anthropic API system message 启用 cache_control
- **ToolSearch**：动态工具发现，减少全量注入的 token 消耗
- **行号格式**：Read 返回 cat -n 格式，方便 Edit 引用行号

**Phase 4 — Skills 与 MCP**
- **Skills**：从磁盘加载 .md skill 文件（.claude/skills/ → .novelfork/skills/ → .kiro/skills/）
- **MCP**：确认已完整实现（stdio/SSE client + managed server + tool routing）

**Phase 5 — 安全与隔离**
- **沙箱模式**：none/basic/strict 三级（basic = 环境变量隔离）
- **进程管理**：SIGTERM → 5s → SIGKILL 优雅超时 + Windows taskkill 进程树杀
- **大输出截断**：>30K chars 保留头尾各 5K

**Phase 6 — Browser 与终端**
- **Browser 截图**：系统 Chrome/Edge headless 模式，无需 Puppeteer
- **Terminal**：create/list/write/read 完整实现

## v0.8.7 (2026-05-18)

### 🔧 工具实现对齐 Claude Code

- **Edit**: 支持 `replace_all` 参数 + 多匹配检测报错 + 弯引号自动标准化匹配
- **Grep**: 排除 `.git` 目录 + head_limit 50→250 + 20s 超时 + 20MB buffer
- **Read**: 二进制文件扩展名检测，拒绝读取 exe/dll/zip/png 等
- **中断立即生效**: abort signal 传入工具超时，长按中断不再等工具执行完
- **切换会话状态重置**: 不再显示旧会话的"思考中"和计时
- **使用历史**: provider 显示名称而非内部 ID + 8 统计卡片 + Select 筛选
- **供应商 ID**: 新建时用 prefix/name 生成，不再 Date.now()

## v0.8.6 (2026-05-18)

### 🐛 修复

- **工具执行超时**：每个工具调用 60s 超时，超时后返回错误并继续下一步，不再卡死
- **切换页面不中断 agent**：WebSocket 断开时保留 runtime state，agent turn 继续执行
- **使用历史真实数据**：每次 LLM 调用记录到内存，/api/usage 返回真实请求日志

### ✨ 新功能

- **服务器配置可编辑**：端口、监听地址、默认项目目录、浏览器打开方式
- **TLS/HTTPS 配置**：启用开关 + 证书/密钥路径（生成证书待后续）
- 设置页"服务器与系统"改为可编辑表单，修改后重启生效

## v0.8.5 (2026-05-18)

### 🔧 改进

- **去掉章节叙述者**：UI 只保留独立叙述者和书籍叙述者两种类型
- **新建会话对话框**：去水平滚动 + 移除假"绑定对象"字段
- **会话中心**：防止水平溢出 + 工作目录路径截断

## v0.8.4 (2026-05-18)

### 🐛 修复

- **目录白名单生效**：路径比较加尾部斜杠精确匹配 + Glob/Grep 工具补充白名单检查（之前只有 Read/Write/Edit 检查）
- **新建会话对话框**：加 `max-h-[85vh]` 滚动 + 权限模式改单列布局，修复文字重叠
- **书籍叙述者禁止归档**：会话中心列表页 + 对话面板内均隐藏归档按钮
- **模型显示**：会话中心隐藏 `provider-时间戳` 格式 ID，只显示模型名
- **去掉固定按钮**：NarraFork 无此功能，移除

## v0.8.3 (2026-05-18)

### 🐛 修复

- **编辑并重新生成**：从错误的 compact（压缩上下文）改为 truncate（截断到该消息），修复后正确截断并重新发送
- **测试模型对话框**：模型标识从 `provider-1778451379718:model` 改为显示供应商名称 `vivy:model`

## v0.8.2 (2026-05-18)

### 🐛 对话面板交互修复

- **Subagent 模型限制**：从文本 Input 改为 Select 下拉选择框，从可用模型池中选取
- **工具限制**：从 Textarea 手动输入改为 Checkbox 列表，勾选即禁用
- **命令白名单/黑名单**：从只读改为支持增删（与目录白名单一致）
- **终端按钮**：从跳转新页面改为右侧 Sheet 面板，显示终端列表（运行中/已退出）
- **去重终端按钮**：移除头部工具栏中重复的终端图标，只保留底部状态栏的
- **折叠代码块 bug 修复**：折叠只作用于 markdown 正文代码，不再误隐藏工具卡片展开后的输出内容

### 🔧 数据打通

- `modelOptions` / `availableTools` 从 StudioNextApp 传递到 SessionDetailPanel
- `onUpdateAccessRules` 扩展支持 `commandAllowlist` / `commandBlocklist`
- 新增 `GET /api/tools/list` 数据拉取，供工具限制 Checkbox 使用

## v0.8.1 (2026-05-18)

### 🐛 会话详情面板修复

- **SessionDetailPanel 去硬编码**：快速模式/宽松规划/自动裁剪/计划模式/启用工具/后台状态 全部从真实 sessionConfig + runtimeSettings 读取
- **TriStateControl 接通后端**：自动批准计划/危险反思 onChange → PUT /api/sessions/:id
- **工具限制可编辑**：从 toolPolicy.deny 读取，支持 Textarea 编辑保存
- **Subagent 模型限制**：从 /api/settings modelDefaults 读取 explore/plan/general 模型，支持编辑回写
- **访问规则增删**：从 /api/settings toolAccess 读取 directoryAllowlist/directoryBlocklist，支持添加/删除目录
- **NarratorStatusBar 路径规则 Popover**：FolderPlus 按钮改为弹出面板，显示白名单列表 + 添加当前目录 + 自定义添加 + 删除
- **MessageStream fork 接通**：选中消息 fork 从 console.log TODO 改为调用 onContextAction("fork")

### 🔧 后端修复

- **Settings 路由根路径别名**：添加 GET/PUT `/api/settings` 根路由，解决前端调用 404 问题

## v0.8.0 (2026-05-16)

### 🧠 上下文可见性系统（context-visibility-system）

- **三种可见性模型**：global（始终注入）/ tracked（场景文本匹配时注入）/ nested（被关联条目引用时级联注入）
- **时间线纪律**：visibleAfterChapter / visibleUntilChapter 控制章节窗口
- **自动链接引擎**：章节保存时扫描文本中的条目标题/别名，自动关联
- **上下文组装服务**：buildJingweiContext 按 visibility + chapter + sceneText + tokenBudget 过滤
- **jingwei.read_context 接入新系统**：替换旧文件系统全量读取
- **candidate.create_chapter 注入经纬**：生成章节时自动组装世界观上下文
- **条目编辑表单增强**：新增别名、可见起始/截止章节、关联条目字段
- **ToolConfigBar 接通后端**：toggle 同步到 session toolPolicy.deny
- **图谱可见性标识**：节点显示 🌐/👁/🔗 图标 + 筛选下拉
- **批量设置可见性**：多选条目统一设置 visibility

### ✨ Artifact Surfacing（产物实时浮现）

- **candidate.create_chapter 流式输出**：LLM 生成通过 session:tool-stream 实时推送，ToolCallCard 逐行渲染
- **Write/Edit 工具流式输入**：Agent 生成文件内容时通过 session:tool-input-chunk 实时显示
- **AI味检测标红高亮**：NovelAuditExpanded 组件，marker 用 `<mark>` 标红 + severity badge
- **审计工具专用渲染器**：novel-audit 分类（玫红色主题）+ 结构化展示

### 🔧 驾驶舱差距修复

- **StatusBar**：面板映射修复 + alertCount 真实计算 + 节拍实时更新
- **PresetPanel**：去 mock 数据 + toggle 保存后端
- **BeatPanel**：接通节拍模板选择/保存 + 选同一模板不重置进度
- **QualityPanel**：shadcn chart + recharts 趋势图（AI味/文风漂移/质量评分）+ 节奏多样性/人设一致性/伏笔回收率
- **3 个工具 handler**：presets.get_rules / presets.check_compliance / beat.get_current
- **对话面板集成**：ToolConfigBar + AgentQuickActions（从 session projectId 获取 bookId）

### 🆕 写作能力增强

- **去 AI 味闭环**：rewrite.segment mode=reduce_ai 改写后自动重新检测 + 前后对比
- **文风仿写**：POST /api/books/:id/style-profile 上传范文→提取风格→candidate 生成时自动注入
- **编辑器功能清理**：删除 BubbleMenu 内嵌选段写作，统一走 Agent 对话

### 📦 清理

- 删除 WritingToolsPanel.tsx 及所有引用
- 修复 PR#1 引入的类型错误（process-adapter Bun FileSink + mcp registerPluginTools）

---

## v0.7.1 (2026-05-15)

### 对话体验修复

- 图片粘贴/选择后显示缩略图预览
- 用户/AI 消息视觉隔离
- 分页加载性能优化
- 工具卡片从 result 字段读取内容
- 打开对话时自动滚动到底部

---

### 🏗️ 驾驶舱重构 — AI 写作质量控制台

**核心变更**：驾驶舱从"信息堆砌长列表"重构为"经纬图谱为主 + 底部可展开面板"的 AI 写作质量控制台。

- **经纬图谱工作区**：画布默认显示 react-flow 关系图谱，支持 5 种视图模式（关系图谱/角色弧线/矛盾地图/列表/时间线）
- **节点 lifecycle 状态色**：active=绿、dormant=灰、retired=红，点击节点就地编辑
- **底部状态条**：一行显示章数/节拍/质量/AI味/警告数，点击展开对应面板
- **可展开面板系统**：预设配置/节拍进度/质量监控/警告，支持关闭/最大化/拖拽调整高度
- **预设配置面板**：按分类分组展示启用预设，支持 toggle 启用/禁用 + promptInjection 预览
- **节拍进度面板**：可视化进度条 + 当前节拍详情（情绪基调/字数分配/网文建议）
- **质量监控面板**：AI味均值 + 审校通过率 + 章节质量表格
- **警告面板**：审校未通过/逾期伏笔/文风漂移超阈值汇总

### ✨ 新功能

- **3 个新 Agent 工具**：`presets.get_rules`（获取预设规则）、`presets.check_compliance`（合规自检）、`beat.get_current`（获取当前节拍）
- **对话工具配置栏**（ToolConfigBar）：对话顶部一行显示工具启用状态，锁定工具+可选工具 toggle
- **Agent 快捷按钮组**（AgentQuickActions）：按角色显示对应操作按钮（写书/审校/伏笔/大纲/章末钩子）
- **对话资源管理器**（ConversationResourcePanel）：右侧文件树 + 内容预览，Agent 操作文件时自动跟随显示
- **质量趋势 API**：`GET /api/books/:bookId/quality-trend`，返回最近 N 章质量/AI味/漂移数据
- **预设命中 API**：`GET /api/books/:bookId/chapters/:ch/preset-hits`（占位，待写作日志接入）

### 🔧 改进

- **顶部工具栏精简**：移除写作动作按钮和写作工具面板入口，仅保留新建章节/快照
- **经纬节点行为更新**：点击经纬节点回到图谱工作区，不再打开 Dialog
- **StatusBar 接通真实数据**：从 health API + localStorage 读取章数/AI味/节拍
- **ExpandablePanel 拖拽安全**：useEffect cleanup 防止事件监听器泄漏
- **JingweiGraphWorkspace 错误处理**：fetch 失败显示"加载失败，点击重试"

### 🐛 修复（cockpit-redesign 差距修复）

- **StatusBar 面板映射**：节拍按钮正确指向 beat 面板（之前错误指向 quality）；alertCount 从真实 health API 数据计算
- **PresetPanel 去 mock 数据**：删除硬编码假数据，从 `/api/books/:id/presets` + `/api/presets` 加载真实数据；toggle 通过 PUT 保存到后端
- **BeatPanel 接通节拍模板**：从 `/api/presets/beats` 加载可用模板列表；选择后写入 localStorage + 同步到后端 bookConfig
- **3 个工具 handler 实现**：`presets.get_rules` / `presets.check_compliance` / `beat.get_current` 从 schema-only 变为可执行
- **对话面板集成**：ConversationSurface 新增 headerSlot，ToolConfigBar + AgentQuickActions 在有 bookId 时自动渲染
- **QualityPanel 趋势图**：用 shadcn chart + recharts 实现 AI味趋势折线图 + 文风漂移曲线 + 质量评分趋势
- **新增 beat-template API**：`PUT /api/books/:id/beat-template` 持久化用户选择的节拍模板
- **loadBookConfig 注入**：工具 handler 通过 `options.loadBookConfig` 直接读取 book config，不再依赖 cockpitService 强转
- **StatusBar 高亮修复**：章数改为纯展示不可点击；节拍实时更新（CustomEvent 通知）
- **BeatPanel 切换修复**：选同一模板不重置进度；从 session projectId 获取 bookId

### 🧠 上下文可见性系统（context-visibility-system spec Phase 1-5）

- **jingwei.read_context 接入新系统**：替换旧文件系统全量读取，改为调用 `buildJingweiContext`（按 visibility + chapter + sceneText + tokenBudget 过滤）
- **candidate.create_chapter 注入经纬**：生成章节时自动组装世界观上下文（global + tracked + nested，6000 token 预算）
- **条目编辑表单增强**：新增别名（TagInput）、可见起始/截止章节、关联条目字段
- **自动链接引擎**：`linkChapterToEntries` 扫描章节文本匹配条目标题/别名 + `POST/GET /api/books/:id/chapters/:ch/link(s)` API
- **ToolConfigBar 接通后端**：toggle 变化同步到 session toolPolicy.deny，Agent 执行前检查
- **图谱可见性标识**：节点显示 🌐global/👁tracked/🔗nested 图标，participatesInAi=false 半透明

### 📦 废弃

- `CockpitOverview.tsx` — 标记 @deprecated，被 CockpitWorkspace 替代
- `WritingToolsPanel` Dialog — 功能拆散到驾驶舱面板和 Agent 对话按钮
- 顶部写作动作按钮 — 移至 Agent 对话面板

### 🧹 仓库清理

- Git 历史大文件清理：284MB → 53MB（删除 dist-sea/ + packages/desktop/ + embedded-assets.bak）
- 移除 InkOS upstream remote，去除 fork 定位改为"早期参考"
- 清理 InkOS v1.x tag，v0.6.0 GitHub Release 已发布

---

## v0.6.0 (2026-05-15)

### 🏗️ 插件架构真拆分（Breaking Change — 内部重构，用户无感）

**核心变更**：小说写作功能从通用 Agent 工作台中彻底拆出，studio 成为纯通用平台。

- **PluginRegistry 机制**：`plugin-loader.ts` 实现插件注册/查询/按 projectType 过滤
- **novel-plugin/engine/**：迁移 241 文件（pipeline/agents/jingwei/filter/presets/compliance/tools/bible）
- **novel-plugin/routes/**：迁移 9 个小说路由（ai/jingwei/writing-modes/pipeline/filter/compliance/bible/writing-tools/context-manager）
- **novel-plugin/handlers/**：迁移 10 个服务（cockpit/candidate/pgi/guided-generation/questionnaire/narrative-line/novel-init/novel-audit/tool-registry/writing-mode）
- **novel-plugin/pages/**：迁移 53 个前端组件（writing-workbench 全部）
- **fitness-plugin 骨架**：证明架构可扩展到第二领域
- **core 瘦身**：不再包含任何小说领域代码，仅保留 storage/llm/state/hooks/mcp/runtime

### 🧠 经纬系统重做（jingwei-ui-overhaul 5 Phase）

- **Phase 1**：结构化世界观 CRUD UI（16 分类面板 + 条目列表 + 编辑表单）
- **Phase 2**：层级树 + react-flow 关系图谱 + Progressions 时间演进
- **Phase 3**：长篇连贯性机制（递归摘要/写后自动更新/写前 Briefing/因果链/生命周期降级）
- **Phase 4**：智能预设反思（反思模型分析当前状态建议本章额外预设）
- **Phase 5**：联想层（共现图谱/脉冲传播/做梦系统）
- **经纬 UI 统一**：资源树"经纬资料"直接打开 JingweiPanel，移除重复的工具栏按钮

### ✨ 新功能

- **Post-Edit 自动验证**：Write/Edit 后自动执行 verificationCommand（tsconfig→`bunx tsc --noEmit`，Cargo→`cargo check`），失败时错误注入上下文供 Agent 自动修复
- **验证命令自动检测**：根据项目文件（tsconfig.json/Cargo.toml/pyproject.toml/go.mod）推断验证命令
- **智能预设完整闭环**：建书时流派→套装自动映射（22 种）+ 章节预设反思 + 驾驶舱"下一章建议"卡 + 写后合规检查
- **危险反思可见反馈**：后端广播 `reflecting` substatus，前端显示"安全评估中..."
- **重试状态显示**：429/502/503 重试时状态栏显示"重试中 (N/M)"
- **自动批准计划通知**：autoApprovePlan 触发时对话中显示"✅ 计划已自动批准"
- **弧线追踪切换 toast**：arcTrackingMode 变更后即时反馈
- **写作预设快捷切换**：状态栏 PenLine 按钮，下拉切换当前书籍启用的预设
- **终端面板入口**：状态栏 Terminal 按钮
- **节拍表持久化**：completedBeats 存储到 localStorage（按 bookId 隔离）
- **叙事线交互**：添加/删除节点按钮 + 内联表单
- **Slash 命令实现**：`/tools` 列出工具、`/mcp` 列出 MCP 服务器、`/agents` 列出子代理类型
- **设置 auto-save**：RuntimeControlPanel 改为 800ms debounce 自动保存 + toast
- **旧消息自动升级**：加载旧 session 时自动补全缺失字段（toolCalls/metadata/role/timestamp/id）
- **Bash 实时流式输出**：命令执行时 stdout/stderr 逐 chunk 推送
- **工具输入流式预览**：LLM 开始输出 tool_use 时前端立即显示 running 卡片
- **工具结果智能截断**：超过 30000 字符自动截断（头 20000 + 尾 5000）
- **子代理嵌套渲染**：Agent 工具展开时递归渲染子调用链
- **BrowserTool/WebSearchTool/WebFetchTool**：完整后端实现
- **权限决策卡片 + 计划模式条 + 危险反思卡片**：新 UI 组件
- **项目感知**：首次对话自动读取 package.json/tsconfig.json/.gitignore 建立上下文
- **Headless CLI 模式**：非交互式 Agent 执行

### 🔧 改进

- **工具结果截断**：Grep 50 条 / Glob 200 条 / Read 500 行 / Bash 200 行上限
- **错误恢复指引**：Agent system prompt 注入 `<error_recovery>` 规则（同一方法失败 2 次换方案）
- **失败计数器**：连续失败 2 次警告、3 次要求停止
- **累积信任**：session 级命令模式自动放行 + 目录信任传播
- **并发写入保护**：同一书籍写作中返回 409
- **内存泄漏修复**：pipelineRuns/writeStatusMap 1h TTL + 100 条上限
- **Windows shell 兼容**：post-edit-verifier 使用 `{ shell: true }` 跨平台
- **旧前端退役**：删除 142 个孤立旧前端文件
- **Bible v1 数据迁移**：统一到 jingwei_entries 表
- **架构文档**：小说前端/后端架构 + Agent 运行时对比分析 + 经纬系统架构

### 🐛 修复

- **运行时 import 断裂**：修复 PipelineRunner/pipelineEvents 等从 core 迁移后的 21 处断裂 import
- **工具状态回写**：tool_result 时正确更新 tool_call 状态（不再卡在 running）
- **工具结果对模型可见**：之前只发 summary，现在发完整 toolResultContent
- **状态管理重设计**：前端信任后端状态，不再本地猜测
- **migration 0014 guard**：全新安装时跳过不存在的表
- **pipeline hooks 接通**：安全 + schema 验证
- **经纬 UI 去重**：统一为 JingweiPanel 单入口

### 📦 仓库结构变更

```
packages/core/         → 通用基础设施（不再有小说代码）
packages/studio/       → 通用 Agent 工作台（不再有小说路由/服务/UI）
packages/novel-plugin/ → 小说领域插件（engine/routes/handlers/pages，323 文件）
packages/fitness-plugin/ → 健身领域插件骨架（证明可扩展性）
```

### 📋 Spec 完成情况

| Spec | 状态 |
|------|------|
| plugin-architecture-split | ✅ 6 Batch / 60 任务全部完成 |
| jingwei-ui-overhaul | ✅ 5 Phase 全部完成 |
| coding-agent-quality | ✅ 全部完成 |
| ui-visibility-gaps | ✅ 5 Phase 全部完成 |
| ui-gap-fixes | ✅ 4 Phase 全部完成 |
| smart-preset-system | ✅ 3 Phase 全部完成 |
| remaining-closure | ✅ 可执行部分全部完成 |
| novel-plugin-and-tool-parity | ✅ 全部完成 |
| conversation-parity | ✅ 全部完成 |
| agent-runtime-robustness | ✅ 6 Phase 全部完成 |
| platform-and-collaboration | ✅ 全部完成 |
| agent-tool-streaming | ✅ 全部完成 |

---

## v0.5.1 (2026-05-14)

### 新功能
- **智能预设系统**：建书时自动启用题材对应套装（25 种映射）；candidate.create_chapter 注入已启用预设的 promptInjection
- **写作设置生效**：文风/句长/对话比例/去AI味/视角设置注入到章节生成 prompt
- **Hooks 系统**：PreToolUse/PostToolUse/TurnComplete shell 钩子，支持阻塞和超时
- **MCP 工具扩展**：连接外部 MCP Server，动态注册工具，路由调用
- **多用户认证**：三种模式（none/builtin/external），JWT 双 token，角色分层，资源隔离
- **章节图**：从资源树提取章节数据，react-flow 可视化
- **预设启用/禁用**：Switch 开关 + 预览对话框
- **节拍表交互**：从假进度条改为可勾选 checklist
- **叙事线结构化视图**：从 JSON 原文改为节点/冲突/伏笔卡片
- **Slash 命令补全**：/tools /mcp /agents 可用
- **终端设置接通后端**：字体/主题持久化
- **通知 Webhook**：钉钉/飞书 turn 完成后自动发送
- **服务器面板动态数据**：Bun/Node 版本、端口、运行时间
- **字体设置生效**：fontSize/fontFamily 应用到 DOM
- **保存 toast 反馈**：外观/通知面板保存后显示"已保存"

### 修复
- 删书时级联删除关联 Agent session
- 重建书时文件残留不再 409（检查 DB 记录而非仅文件）
- 预设执行不再 400（改为预览对话框）
- 状态栏工具调用时不再显示"空闲"（tool_call 带 status:"running"）
- sessionId 作用域错误（tool-stream confirmation path）
- ownerId 过滤实际执行
- Hook 命令注入防护（环境变量传递）
- JWT secret 持久化（~/.novelfork/.auth-secret）
- Rate limiting（login 5次/15min，register 3次/hour）
- Refresh token 可撤销（token_version）
- MCP 自动重连（3 次重试）
- SSE stub 不再假装 connected

---

## v0.5.0 (2026-05-14)

### 新功能

**对话体验对齐 Claude Code：**
- 重试按钮：失败后一键重发上一条消息
- 中断长按确认：按住 1 秒才触发，防止误触
- Bash 实时输出流：stdout 通过 WebSocket 实时推送到前端
- 工具长时间运行通知：10s 后显示"仍在执行中..."
- "始终允许此类操作"：确认门一键加入白名单
- 计划反思可见反馈：状态栏显示"计划审核中..."
- 语法高亮：Read 工具展开后代码块有颜色（react-syntax-highlighter）
- Git 分支 + 变更数：状态栏显示当前分支和未提交变更
- 工具卡片耗时/超时显示：`7ms / 2m` 格式
- 每条消息 Token 用量：`↑9.6k ↓0.1k` 显示

**Agent 质量提升：**
- 工具结果截断：Grep 50 条 / Glob 200 个 / Read 500 行 / Bash 200 行
- 错误恢复提示词：失败 2 次换方案，3 次停下说明
- 失败计数器：连续失败时自动注入警告
- 项目启动探索：自动加载 package.json + AGENTS.md/CLAUDE.md 到上下文
- Agent 工具使用规范：TOOL_USE_GUIDELINES 注入所有 Agent prompt

**小说创作流程闭环：**
- 建书后 AI 自动生成经纬：向导完成 → LLM 丰富 story_bible 内容
- 经纬条目可编辑：资源树 + 按钮新建 / 右键删除重命名
- 经纬空态教学：空分区显示功能说明 + 操作入口
- 经纬卡片化渲染：## 段落渲染为独立卡片，未填写显示"让 AI 生成"
- "让 AI 生成"按钮：点击调用 LLM 填充对应段落
- 文件路径隐藏：画布不再暴露 story/story_bible.md
- Word (.docx) 导出：零依赖实现，宋体 + 1.5 倍行距
- 写作工具 404 修复：GET/POST 方法匹配修正

**UI 可见性增强：**
- 工具调用实时渲染：不再等 turn 结束，每个 tool_call 立即推送
- 工具卡片展开内容：Bash 终端风格 / Read 代码块 / Edit diff / Grep 列表
- 危险反思可见性：状态栏显示"安全评估中..."
- 重试可见性：状态栏显示"重试中"
- 输出速率显示：streaming 时显示"42字/秒"
- 桌面通知：任务完成时浏览器通知
- 首页无供应商引导横幅
- exe 启动失败错误提示（不再黑屏闪退）
- 目录白名单快捷按钮
- 文件修改面板自动弹出

**其他：**
- API Token 认证：外部调用方 Bearer Token
- Toast 通知系统
- 学习中心全部重写（13 篇对齐 NarraFork 风格）

### 修复
- 并行工具 tool_call/tool_result 消息格式修复（Claude API 兼容）
- drainSessionQueue 竞态条件
- emergencyTruncateMessages orphaned tool_result
- captureOriginalContent 路径解析
- LLM 安全反思超时保护
- 工具执行异常静默 hang → catch + 日志 + 透传
- exe 从 Downloads 启动时 novelfork.json not found
- 首 token 超时错误信息明确化
- 工具循环超限引导文案
- API 网络错误代理检查引导
- 中断按钮无反馈 → spinner + "中断中..."
- sessionId 作用域错误（tool-stream confirmation path）

---

## v0.4.0 (2026-05-14)

### 新功能
- **并行工具执行**：Read/Glob/Grep/WebSearch/WebFetch 等只读工具 Promise.all 并行，多工具调用速度提升 2-5x
- **上下文溢出自动恢复**：检测 context_length_exceeded → 紧急截断 → 自动重试
- **缓冲消息队列**：Agent 工作中新消息入队（最大 10 条），turn 完成后自动消费
- **智能重试恢复**：429/502/503 瞬态错误指数退避重试（可配置退避参数）
- **命令白/黑名单**：Bash 工具执行前检查用户配置的命令名单，黑名单命令直接拒绝
- **目录访问控制**：Read/Write/Edit 执行前检查目录名单，黑名单目录禁止访问
- **YOLO 安全反思**：高风险操作前 LLM 自动评估安全性（做什么/风险/是否可逆）
- **子代理生命周期**：SubagentRegistry 状态追踪 + detach/attach 操作
- **后台任务持久化**：background_tasks SQLite 表，服务重启后恢复遗留任务状态
- **MCP 工具继承**：子代理按 none/read-only/full 三级继承父会话工具
- **消息多选批量操作**：Ctrl/Cmd+Click 切换 + Shift 范围选 + 浮动操作栏（复制/删除/分叉）
- **文件修改面板**：追踪 Write/Edit 操作 + diff 预览 + 单文件恢复
- **增量更新**：zstd patch-from 二进制补丁生成/应用（异步非阻塞）
- **SWE-bench 评测框架**：runEvalTask/runEvalSuite + 并发控制 + 超时处理
- **WebSocket 自动重连**：指数退避 + visibilitychange 监听 + 断点续传
- **消息渲染性能**：useMemo/useCallback 优化高频组件
- **工具调用实时渲染**：不再等 turn 结束，每个 tool_call/tool_result 立即推送到前端
- **工具卡片展开内容增强**：Bash 终端风格 / Read 代码块 / Edit diff 视图 / Grep 匹配列表
- **Agent 工具使用规范**：TOOL_USE_GUIDELINES 注入所有 Agent system prompt
- **危险反思可见性**：状态栏显示"安全评估中..."
- **重试可见性**：状态栏显示"重试中"+ onRetry 回调
- **输出速率显示**：streaming 时状态栏显示"42字/秒"
- **桌面通知**：任务完成时浏览器通知（标签页不可见时）
- **API Token 认证**：外部调用方（如 QQ bot）Bearer Token 认证
- **Toast 通知系统**：全局轻量 toast 组件

### 修复
- 并行工具执行后 tool_call/tool_result 消息格式不符合 Claude API 要求（连续 user 消息被拒绝）
- drainSessionQueue 竞态条件导致并发 turn
- emergencyTruncateMessages 可能产生 orphaned tool_result
- captureOriginalContent 相对路径无法解析（文件恢复失效）
- LLM 安全反思无超时（可能无限阻塞）
- void drainSessionQueue 未捕获异常（session 永久锁死风险）
- 工具执行异常静默 hang（现在 catch + 日志 + 透传错误给模型）
- exe 从 Downloads 文件夹启动时 novelfork.json not found
- 首 token 超时后错误信息不明确（现在区分 timeout vs abort）
- 工具循环超限时不告诉用户怎么调（现在附带设置路径）
- API 网络错误时不提示检查代理（现在附带代理检查引导）
- 中断按钮无反馈（现在有 spinner + "中断中..."）
- 新用户无供应商时无明确引导（现在有醒目黄色横幅）

---

## v0.3.0 (2026-05-13)

### 新功能
- 实时状态栏：思考中/调用工具中/已中断 + 工具名显示 + 上轮耗时
- 48 个 Agent 工具全部实现（含子代理递归、Browser Playwright、Terminal spawn）
- 5 个新小说工具：chapter.audit / rewrite.segment / outline.suggest_next / character.check_consistency / hooks.manage
- 小说功能可插拔：动态注册 + scope 过滤 + novel-plugin 包
- 代理接通：proxyFetch 注入用户配置的 proxy 到 AI 请求
- ConversationBlock 类型系统 + reasoningPolicy 控制
- EndPipeline rule 解析器（grep/head/tail/sort/uniq/cut）
- Provider protocol 传递到前端（按协议显示推理强度/Fast Mode）
- Goals 持久化 + 注入 system prompt
- 结构化日志增强（generate/tool/abort/continue）
- 会话详情面板数据接通
- 固定会话功能（onPin/isPinned）

### 重构
- 小说工具定义拆分到 session-tool-registry-novel.ts
- Agent 预设拆分到 novel-plugin
- 小说 handler 提取到 getNovelServiceHandler 独立函数
- 设置页模型面板精简（删除 18 个重复控件）
- InkOS 残留清理：Sub2API OAuth 删除 + truth→jingwei 统一

### 修复
- 中断/继续功能修复（空消息→"继续"）
- ExitPlanMode 时序修复（批准后才切换 sessionMode）
- Agent 子代理工具链路修复（generateSessionReply 传 tools schema）
- 工具卡片渲染修复（去重、隐藏模板文本、填充 output）
- 设置页 6 个 UI 问题修复（Select value=""崩溃、dirty 检测、保存反馈）
- Terminal 隔离（按 sessionId）
- Browser 类型安全（BrowserPageLike interface）
- EndPipeline grep regex try-catch
- 重复注册去重

---

## v0.2.0 — 2026-05-12

### 新功能

- **设置页面全面对齐 NarraFork**：AI 代理（18 项设置）、外观（OLED 纯黑/终端）、通知（音效/钉钉/飞书）、使用历史（趋势图/筛选/明细）、代理管理（HTTP proxy）、学习中心（双栏+检索 API）
- **Provider Block History**：块级对话历史模型，支持 DeepSeek reasoning_content / Claude thinking / OpenAI Responses
- **Git 面板**：变更/提交/暂存三标签页，Git 分支菜单（分叉/合并）
- **学习中心**：13 篇文档，4 分类，后端检索 API + Agent 可调用
- **Responses adapter**：apiMode=responses 走 /responses 端点（含 streaming）
- **模型批量禁用/启用**：供应商详情页一键操作
- **头像上传**：压缩为 128x128 JPEG
- **子代理池 UI**：shadcn badge + SimpleSelect 替代原生 select

### 修复

- **DeepSeek thinking + tools**：reasoning_content 保存/合并/回传完整管线
- **Claude thinking blocks**：保存并回传 thinking/redacted_thinking
- **Provider 名称显示**：首页不再显示 ID（provider-xxx）
- **Worktree 路径**：注入正确 workDir 到 AI 上下文 + 会话详情可编辑保存
- **学习中心加载**：即时渲染 fallback + API 增强
- **代码块样式**：对齐 NarraFork（11px/10px padding/pre-wrap）
- **Context Ring**：移到右侧 + 增强 popover
- **工具暴露**：隐藏未接线的 cockpit/narrative/health 工具
- **Anthropic 模型列表**：智能 URL 拼接（/v1/models 或 /models）
- **旧配置兼容**：AgentSettingsPanel 不再因缺失字段崩溃

### 架构

- `shared/conversation-blocks.ts`：ConversationBlock / ConversationItem 类型
- `RuntimeChatMessage` 加 `reasoning_content` 字段
- `GenerateResult` 加 `reasoningContent` 字段
- `AgentTurnEvent` 加 `reasoning_chunk` 事件
- `ProviderReasoningPolicy` 类型（strip/passback-on-tool-loop/always-passback）
- `NarratorSessionChatMessage` 加 `reasoning_content` 持久化

---

## v0.1.3 (2026-05-12)

### 新功能

- feat: 对话 UI 全面对齐 NarraFork 参考实现（ToolCallCard 颜色编码、用户消息头像+时间、AI 消息全宽、底部分层堆叠、中断/继续按钮样式、NarratorStatusBar 旋转加载+进度条+上轮耗时）
- feat: 会话详情面板完整实现（统计卡片网格、工作目录编辑、会话配置编辑含三段选择器、自定义 Traits、Subagent 模型限制、工具限制、关联关系、运行状态、访问规则）
- feat: 设置持久化 — AgentSettingsPanel 接入 API 保存 + dirty 状态追踪 + sticky 底栏；新增 WritingSettingsPanel（14 字段写作配置）

### 修复

- fix: 工具权限管线 — isPathWithinWorkDir 允许绝对路径、getEnabledSessionTools 过滤 disabledTools、创建会话时合并 routines.tools deny
- fix: 会话工作目录使用仓库根目录（不再被困在 worktree 子目录）
- fix: 首页排除书籍绑定会话、批量删除仅在归档页可用
- fix: 去重 Agent、隐藏废弃 sections、"总览"返回按钮
- fix: 移除 ensure-agents 自动创建、新增批量删除、修复引导向导返回

### 重构

- refactor: 套路页命令/子代理/MCP/钩子改为占位卡片"暂未开放"；全局/项目技能改为写作预设说明

### 修复

- fix: `chapter.read` 工具真正读取章节正文内容（之前只返回书籍状态）
- fix: `jingwei.read_context` 工具真正读取经纬目录文件（之前返回空数据）
- fix: Planner/Architect/Explorer Agent 提示词对齐实际工具名（消除 unknown-tool 错误）
- fix: Read/Write/Edit 工具添加路径边界验证（防止 Agent 读写工作目录外的文件）
- fix: SearchPage 搜索结果可点击导航到对应书籍
- fix: "继续"按钮接入 onContinue 回调（之前点击无效果）
- fix: FirstRunDialog "创建第一本书"正确导航到首页
- fix: Stub 工具返回 `ok:false` + "未实现"错误（之前返回假成功误导 Agent）
- fix: 新建 Git 仓库必须选择目录路径（之前会在 studioRoot 下 git init）
- fix: "新建 Git 仓库"和"已有仓库"都显示路径输入框 + 文件夹选择器
- fix: 新增 PowerShell 系统文件夹选择器（桌面模式原生目录选择对话框）
- fix: 工作台顶部栏显示绑定的仓库路径
- fix: 创建书籍后清除引导向导 localStorage 标记（确保新书显示 11 步引导）
- fix: ensure-agents 防止重复创建（已有 5+ session 时跳过）
- fix: 经纬资源树分组节点显示文件夹图标（FolderOpen）

---

## v0.1.1 (2026-05-11)

### 修复
- fix: 已有仓库绑定路径解析错误 — 绝对路径不再被拼接到 studioRoot 下
- feat: 新增系统文件夹选择器（PowerShell FolderBrowserDialog），桌面模式下可原生选择目录
- fix: 前端文件夹选择器优先调用后端 API，浏览器 showDirectoryPicker 作为降级

---

## v0.1.0 (2026-05-11)

首个正式发布版本。网文小说 AI 辅助创作工作台。

### 核心功能

- **多 Agent 写作管线**：5 个固定 Agent（写书/伏笔/章末钩子/审校/大纲与经纬），侧边栏点击书籍即可展开
- **引导式生成**：PGI 生成前追问 → Guided Plan 计划确认 → 候选稿生成，AI 输出不覆盖正文
- **48 个 Agent 工具**：对齐 NarraFork 全量工具（文件操作、Glob/Grep、浏览器、子代理、终端、WebSearch 等）
- **经纬资料管理**：按类别分组（角色/势力/设定/伏笔/大纲/状态/规则），支持子目录结构
- **新书引导向导**：11 题三模式（预设选择/自定义/跳过随机），自动生成初始经纬文件
- **写作预设面板**：6 流派 / 5 文风 / 6 基底 / 8 逻辑规则预设管理
- **AI 味检测**：12 规则本地检测 + 消味建议
- **章节健康度**：节奏/对话比例/句长直方图
- **选段写作**：续写/扩写/补写 + 多版本变体
- **日更进度追踪** + 节拍表
- **平台合规检查** + 导出 TXT/Word/ePub
- **角色弧线** + 文风漂移检测 + 模板市场
- **连续性审计**：自动检测剧情矛盾、人设冲突
- **Checkpoint/Rewind**：资源快照与回滚

### 工作台体验

- **Agent Shell 架构**：左侧边栏（书籍+叙述者）/ 中间画布 / 右侧对话
- **Context Ring**：始终可见的上下文使用率环形图，点击弹出压缩/清空菜单
- **主题切换**：亮色/暗色/跟随系统，Tailwind dark mode class 策略
- **使用历史**：按提供商和模型分组的 Token 统计
- **驾驶舱总览**：进度条/字数/审校/风险/建议
- **候选稿管理**：接受/拒绝/归档/删除操作栏
- **学习中心**：9 篇内置文档 + `/next/learn` 页面
- **Onboarding**：首次运行欢迎弹窗 + 空态教学
- **桌面窗口**：单 exe 启动，Edge/Chrome app mode

### Agent 与对话

- 5 种 Agent 角色专属 system prompt（领域知识 + 工具使用指南）
- Agent 自动加载书籍上下文（进度/经纬/伏笔/章节摘要）
- 工具权限管线：permission mode + tool policy allow/deny/ask
- 确认门机制：高风险操作需用户批准
- 会话 lifecycle：fork/compact/resume/continue + 累计 usage
- 流式 tool_use 解析（Anthropic + OpenAI adapter）
- 对话状态栏：模型/权限/推理强度/实时计时器
- Slash 命令：/help /model /permission /compact /fork /resume

### 供应商与模型

- 多供应商支持：OpenAI / Anthropic / DeepSeek / 自定义兼容
- 模型池动态加载 + contextWindow/maxOutputTokens
- 推理强度/Fast Mode 按 API 模式条件显示

### CLI

- `novelfork -p` / `novelfork exec` headless 模式
- stream-json NDJSON 输出
- `--book` / `--session` / `--model` / `--permission-mode` 参数

### 工程

- TypeScript monorepo：core / studio / cli
- Bun + React 19 + Hono + SQLite + Vite
- 单文件 exe 编译（bun compile + 嵌入前端资源）
- 213 测试文件 / 1274+ 测试 / typecheck 通过

### 自 v0.0.5 以来的详细变更

#### 新增系统

- Agent-native 工作台架构（从旧三栏重构为 AgentShell）
- 每本书自动创建 5 个固定 Agent session（ensure-agents API 支持旧书补创建）
- Backend Contract 类型安全契约层（领域 client + capability status + 回归测试）
- 统一 Runtime Turn 执行引擎（工具循环 + 权限门 + 流式输出 + 多步 continue）
- Session Lifecycle Service（fork/compact/resume/continue + 累计 usage 追踪）
- Headless Chat API（`POST /api/sessions/headless-chat` + stream-json NDJSON）
- Canonical Runtime Events（message/tool/permission/checkpoint/usage/error 统一类型）
- Runtime Settings 统一配置合并模型（session > project > user > default）
- Session Tool Policy（allow/deny/ask + 套路继承 + dirty canvas guard）
- Tool Confirmation Envelope（targetResources/source/checkpoint/operations）

#### 新增用户功能

- 新书引导向导（NewBookGuide 11 题三模式）
- 经纬按类别分组（角色/势力/设定/伏笔/大纲/状态/规则子目录）
- Context Ring 始终可见 + 点击菜单（压缩/清空/阈值显示）
- 主题切换实际生效（dark mode class + localStorage 持久化）
- 使用历史面板（按 provider/model 分组 Token 统计）
- 压缩 UX 升级（摘要可见/可展开/可撤回 + 压缩卡片）
- 确认门 UI（ConfirmationGate 组件 + approve/reject）
- UserQuestionGate（text/single/multi/ranged-number/ai-suggest 五种输入）
- 工具权限策略 UI（状态栏展示 + 套路页配置）
- 叙事线快照（节点/边/warnings + 变更草案预览）
- 候选稿操作栏（接受/拒绝/归档/删除）
- 驾驶舱总览（CockpitOverview：进度/字数/审校/风险/建议）
- 学习中心（9 篇文档 + /next/learn 页面）
- Checkpoint/Rewind UI（列表/diff 预览/回滚）
- 写作工具面板（7 种即时工具弹窗）
- 选段浮动工具条（选中文本后出现续写/扩写/改写）
- 文件修改追踪（从 toolCalls 提取 Write/Edit 文件路径）
- 经纬资料编辑器（JingweiEntryEditor：标题+Markdown 编辑/保存/删除）
- 系统文件夹选择器（PowerShell FolderBrowserDialog）

#### 重构与清理

- 旧三栏源码完全退役（StudioApp/workspace/editor/ChatWindow/split-view 删除）
- Bible → Jingwei 全局类型/函数重命名（22 文件）
- story/ → jingwei/ 新书目录结构迁移
- 废弃路径清理（pending-action-store、/novel:* 命令、novel-write-next-handler 删除）
- Tauri 完全退役（改用 Bun compile + Edge app mode）
- Legacy route 退役（/api/chat、旧 ChatPanel、createChatRouter 删除）
- 旧 ChatWindow 视觉层退役（迁移到 ConversationSurface）
- tsconfig exclude 收紧（guard 检查旧路径不存在）
- 平台集成移除（Codex/Kiro account import 删除）

#### 修复

- 流式 tool_use 解析：Anthropic/OpenAI adapter 正确解析 tool_use delta
- 消息排序：回复不再出现在用户消息上面
- fork 跳转：创建 fork 后正确导航到新会话
- WebSocket 绑定：切换会话时正确重连
- 供应商 ID 显示：显示名称而非内部 ID
- 文风漂移数据：使用真实计算值而非硬编码
- Agent prompt 工具名：对齐实际注册的工具名
- 仓库路径解析：绝对路径不再被错误拼接到 studioRoot
- Anthropic URL 去重 + 空会话隐藏恢复提示
- streaming 空 tool name 覆盖修复
- 新会话"正在恢复"提示消除
- 状态栏乐观更新（发送消息后立即显示"工作中"）

---

## v0.0.5 (2026-05-03)

### 改进
- 功能审计全量完成（P0-P3 共 42 个 spec）
- 文档体系重写（用户指南/产品流程/架构设计）
- 前端 live wiring 接入真实 runtime

## v0.0.4 (2026-05-02)

### 改进
- Studio 共享 UI 文案统一中文化
- 强化 release 版本管理规则

## v0.0.3 (2026-05-02)

### 修复
- 编译链路不一致、搜索/项目模型/工作流契约断链
- Tauri 退役残留清理

## v0.0.2 (2026-05-01)

### 桌面应用
- Edge/Chrome app mode 渲染，无浏览器外壳
- 单文件产物内置 Studio 静态资源

## v0.0.1 (2026-05-01)

### 创作工作台
- 三栏布局 + 资源管理器 + TipTap 编辑器
- 6 种写作模式 + AI 动作 + Agent 系统
- 驾驶舱 + 故事经纬 + 合规预设
- 137 测试文件 / 801 测试

---

## v0.0.0 (2026-04-19)

### 项目基础
- 项目启动，早期参考 InkOS 架构，专注中文网文创作
- monorepo 结构：core / studio / cli
