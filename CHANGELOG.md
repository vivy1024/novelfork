# Changelog

本文件记录 **NovelFork** 的版本变更。

---

## Unreleased

### 新功能
- Agent 运行时健壮性 Phase 1 完成：
  - 并行工具执行：Read/Glob/Grep/WebSearch/WebFetch 等只读工具 Promise.all 并行
  - 上下文溢出自动恢复：检测 context_length_exceeded → 紧急截断 → 重试
  - 缓冲消息队列：Agent 工作中新消息入队，turn 完成后自动消费
  - 智能重试恢复：429/502/503 瞬态错误指数退避重试（可配置）
- Agent 运行时健壮性 Phase 3.2 + Phase 4.2/4.3 完成：
  - 后台任务持久化：background_tasks SQLite 表 + 启动时恢复遗留任务
  - 命令白/黑名单实际执行：Bash 工具执行前检查用户配置的命令名单
  - 目录访问控制实际执行：Read/Write/Edit 执行前检查目录名单
- Agent 运行时健壮性 Phase 3.1/3.3/4.1 完成：
  - 子代理 Detach/Attach：SubagentRegistry 状态追踪 + detach/attach 操作
  - MCP 工具继承：resolveSubagentTools() 按 none/read-only/full 三级解析
  - YOLO 安全反思增强：LLM 安全评估（做什么/风险/是否可逆）
- Agent 运行时健壮性 Phase 5 + 6 完成：
  - 消息多选批量操作：Ctrl/Cmd+Click 切换 + Shift 范围选 + 浮动操作栏
  - 文件修改面板：追踪 Write/Edit 操作 + diff 预览 + 单文件恢复
  - 增量更新：zstd patch-from 二进制补丁生成/应用
  - 模型聚合：已有完整实现（priority/round-robin/random 路由）
  - SWE-bench 评测框架：runEvalTask/runEvalSuite + 并发 + 超时
  - 流式输出按时间顺序：WebSocket 有序保证 + 注释确认
  - 消息渲染性能：useMemo/useCallback 优化
  - WebSocket 重连：指数退避 + visibilitychange + 断点续传

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
- Fork 自 InkOS，专注中文网文创作
- monorepo 结构：core / studio / cli
