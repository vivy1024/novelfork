# Changelog

本文件记录 **NovelFork** 的版本变更。

---

## Unreleased

（无）

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
