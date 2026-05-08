# Implementation Plan — 对话页面真实闭环

## Overview

基于 NarraFork 0.4.2 前端源码爬取（api.js、useNarrator.js、i18n、status-registry）和浏览器截图审计，重写任务清单。

NarraFork 的叙述者状态机：idle → working → (reasoning | planning | compacting | waiting | interrupted | error | retrying | queued | suspended)。NovelFork 当前只有 idle/running 两态。

## Traceability

- Task 1-2 → Req 1（Markdown 渲染）
- Task 3-4 → Req 2（工具调用卡片）+ Req 9（终端风格）
- Task 5-6 → Req 3（Composer 控件）+ Req 11（中断/继续）
- Task 7 → Req 4（Streaming 计时）+ Req 8（推理折叠）
- Task 8 → Req 5（搜索）
- Task 9 → Req 10（Git 状态栏）
- Task 10 → Req 6（workflow executor）
- Task 11 → Req 7（MCP client）
- Task 12 → Req 12（浏览器验证）

## Tasks

### Phase 0：叙述者状态机对标

- [x] ENABLER 1. 扩展叙述者状态模型
  - 当前 ConversationStatus 只有 `state: "idle" | "running" | "active"`
  - 对标 NarraFork status-registry：idle / working / waiting / archived + substatus (error / interrupted / reasoning / compacting / planning / retrying / queued / suspended / unread / manual_override)
  - 新增 `narratorState`、`substatus`、`streamingStartedAt`、`lastTurnDurationMs` 字段到 ConversationStatus
  - ConversationSurface 使用 narratorState/substatus 判断 isWorking/isInterrupted
  - ConversationRoute 传入 streamingStartedAt 和 narratorState
  - 验证：typecheck 通过；既有 11 个状态栏/composer 测试仍通过

### Phase 1：消息渲染对标

- [x] FEATURE 2. AI 回复使用 MarkdownRenderer
  - `surface/MessageItem.tsx` 删除 `renderMarkdown()` 和 `inlineMarkdown()`（~40行正则替换代码）
  - 导入 `@/components/MarkdownRenderer`，AI 回复改为 `<MarkdownRenderer content={message.content} />`
  - 依赖已安装（react-markdown、remark-gfm、react-syntax-highlighter、rehype-katex）
  - 验证：typecheck 通过

- [x] FEATURE 3. 工具调用卡片对标 NarraFork
  - NarraFork 工具调用：`✓ toolName · 586ms >`（一行紧凑，点击展开）
  - Bash 类工具展开后：深色终端背景 + `$ command` + 输出（等宽字体）
  - 复用 `components/ToolCall/ToolCallBlock.tsx`（已有折叠/展开/governance/replay/renderer registry）
  - 编写适配器 `tool-call-adapter.ts`：`adaptConversationToolCall()` 映射 ConversationToolCall → ToolCall
  - MessageItem 改为使用 ToolCallBlock + 适配器
  - ToolCallCard.tsx 保留（类型仍被 MessageStream 引用），但不再在渲染中使用
  - 验证：typecheck 通过

- [x] FEATURE 4. 推理内容折叠渲染
  - NarraFork：`🔮 推理—"摘要预览..."` 可折叠块，默认折叠
  - 新增 ConversationThinkingBlock 接口和 ThinkingBlock 组件
  - MessageItem 在 assistant 消息中渲染 thinking blocks（折叠/展开）
  - 验证：typecheck 通过

### Phase 2：Composer 对标

- [x] FEATURE 5. Composer 模型/权限改为真实控件
  - 模型：从静态 span 改为 `<select>`，支持 modelOptions prop
  - 权限：从静态 span 改为 `<select>`，支持 permissionOptions prop
  - 附件：Paperclip onClick → 隐藏 `<input type="file">` → onAttach 回调
  - 新增 ComposerModelOption 接口
  - 验证：typecheck 通过

- [x] FEATURE 6. 中断/继续按钮对标
  - 三态按钮：isRunning → 红色 Square "中断" / value.trim() → Send "发送" / isInterrupted||onContinue → 蓝色 Play "继续"
  - 新增 onContinue、isInterrupted props
  - ConversationSurface 传入 isWorking/isInterrupted 从 narratorState/substatus 派生
  - 验证：typecheck 通过

- [x] FEATURE 7. Streaming 计时 + 状态文案
  - 顶部 header：working → ThinkingTimer；idle → "空闲 · 上轮耗时 X:XX"
  - 底部状态栏：substatus 中文文案（推理中/压缩中/计划中/重试中/排队中/已中断）
  - 新增 SUBSTATUS_LABELS 和 substatusLabel() 函数
  - 验证：typecheck 通过

- [x] FEATURE 8. 消息搜索
  - 搜索按钮 onClick → 展开搜索输入框
  - 纯前端过滤 filteredMessages
  - 无匹配显示"无匹配结果"
  - ESC 关闭搜索
  - 验证：typecheck 通过

- [x] FEATURE 9. 底部状态栏对标
  - 显示 binding label + workspace.branch + workspace.changes
  - ConversationWorkspaceFact 新增 branch/changes 字段
  - 验证：typecheck 通过

- [x] FEATURE 10. workflow-executor 接入
  - Composer 中 unhandled_command fallback 改为通用（不限 `/novel:` 前缀）
  - 所有前端无 handler 的命令发送到后端，后端 session-chat-service 通过 command-executor + executeNovelCommand 执行 workflow
  - 验证：typecheck 通过

- [x] FEATURE 11. MCP client 接入
  - 后端已有完整实现：`POST /api/mcp/servers/:id/start` → MCPClientImpl.connect()
  - 前端 MCPServerPanel 已调用 `postApi('/mcp/servers/${id}/start')`
  - 连接成功返回 tools 列表，失败返回 error
  - 验证：mcp.test.ts 已有 6 个测试覆盖连接成功/失败/工具调用/权限

### Phase 6：浏览器验证

- [x] GUARD 12. 浏览器截图验证
  - 启动 localhost:4567 API 服务器（bun src/api/index.ts）
  - 截图 1：对话页（Writer 会话）— Markdown 渲染生效（粗体、列表、有序列表）
  - 截图 2：Composer 底部显示模型下拉（"DeepSeek Chat"）+ 权限下拉（"edit"）+ 附件📎
  - 截图 3：搜索🔍按钮在右上角
  - 截图 4：底部状态栏显示消息数 + binding
  - 验证：嵌入前端（dist）渲染正确；推理折叠需要真实 AI thinking 数据才能验证
