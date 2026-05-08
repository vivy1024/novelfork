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

- [ ] FEATURE 4. 推理内容折叠渲染
  - NarraFork：`🔮 推理—"摘要预览..."` 可折叠块，默认折叠
  - 在 MessageItem 中检测 AI 回复的 thinking/reasoning metadata
  - 渲染为 `<details>` 或自定义折叠组件：折叠时 `🔮 推理—"前30字..."`，展开显示完整内容
  - 读取设置 `expandReasoning` 控制默认状态
  - 验证：组件测试覆盖折叠/展开

### Phase 2：Composer 对标

- [ ] FEATURE 5. Composer 模型/权限改为真实控件
  - NarraFork Composer 底部：📎 + 输入框 + 模型选择 + 权限badge + 图标组 + 主按钮
  - 模型：改为 `<select>` 或 Combobox，从 props.modelOptions 渲染，onChange 调用 `onUpdateSessionConfig`
  - 权限：改为 `<select>`，options 来自 SESSION_PERMISSION_MODE_OPTIONS
  - 附件：Paperclip onClick → 隐藏 `<input type="file">` → 选择后回调 `onAttach`
  - ConversationRoute 传入 modelOptions（从 provider client 获取）
  - 验证：组件测试覆盖下拉渲染和 onChange

- [ ] FEATURE 6. 中断/继续按钮对标
  - NarraFork 按钮逻辑（从 API 和 i18n 确认）：
    - working/reasoning/planning 状态 → 红色"中断"按钮，onClick 调用 `POST /api/sessions/:id/abort`
    - interrupted 状态 → 蓝色"继续"按钮，onClick 调用 `POST /api/sessions/:id/continue`（NarraFork: `continueNarrator`）
    - idle + 输入框有内容 → "发送"按钮
    - idle + 输入框为空 → 蓝色"继续"按钮
  - 当前 Composer 已有 isRunning → Square(中断) / Send(发送) 逻辑
  - 新增：idle + 空输入 → Play 图标 + "继续"文案，onClick 调用 onContinue prop
  - ConversationRoute 传入 onContinue（调用 session continue API）
  - 验证：组件测试覆盖三种状态

### Phase 3：Streaming 与搜索

- [ ] FEATURE 7. Streaming 计时 + 状态文案
  - NarraFork 状态文案：`思考中 4:51`（working+reasoning）、`空闲 · 上轮耗时 1:05`（idle）
  - ConversationRoute 传入 `streamingStartedAt`（从 WebSocket `session:stream` 首个 chunk 记录）
  - 顶部 header 显示：working → "思考中 X:XX"（ThinkingTimer 已有）；idle → "空闲 · 上轮耗时 X:XX"
  - 底部状态栏显示 substatus 文案（推理中/压缩中/计划中/重试中/排队中/已中断）
  - 验证：组件测试覆盖各状态文案

- [ ] FEATURE 8. 消息搜索
  - NarraFork i18n: `messageSearchPlaceholder: "搜索已加载消息..."`、`messageSearchMoreHint: "当前只搜索已加载消息。加载更早消息后可搜索更多历史。"`
  - 搜索按钮 onClick → 展开搜索输入框
  - 纯前端过滤已加载消息（content.includes(query)）
  - 无匹配显示"无结果"
  - ESC 关闭搜索
  - 验证：组件测试

### Phase 4：状态栏与上下文

- [ ] FEATURE 9. 底部状态栏对标
  - NarraFork 底部：`项目名 · 分支 · ±变更数` + 图标组
  - 从 session binding 读取 projectName/branch/changes
  - 无 Git 时显示 binding label 或"无 Git"
  - 右侧显示 provider label
  - 验证：组件测试覆盖有/无 Git

### Phase 5：Dead code 激活

- [ ] FEATURE 10. workflow-executor 接入
  - `slash-command-registry.ts` 中 `/novel:write-next` 改为调用 `executeNovelCommand`
  - 删除 Composer 中 `unhandled_command && startsWith("/novel:")` 的 fallback 逻辑
  - 验证：slash-command-registry.test.ts 通过

- [ ] FEATURE 11. MCP client 接入
  - NarraFork API: `POST /mcp/servers/:id/connect`、`POST /mcp/servers/:id/disconnect`、`GET /mcp/tools`
  - NovelFork 已有 `mcp-client-runtime.ts`（createMcpClient）和 MCPServerPanel UI
  - 新增 route `POST /api/mcp/servers/:id/connect` → 调用 createMcpClient
  - MCPServerPanel "连接"按钮 onClick → 调用 connect API → 显示状态
  - 验证：API route 测试

### Phase 6：浏览器验证

- [ ] GUARD 12. 浏览器截图验证
  - 启动 localhost:4567 开发服务器
  - 截图 1：对话页空态（Composer 模型下拉 + 权限下拉 + 继续按钮）
  - 截图 2：发送消息后（Markdown 渲染 + 工具调用卡片 + 推理折叠）
  - 截图 3：设置页（模型/权限/推理强度控件）
  - 截图 4：对比 NarraFork 7778 同页面
  - 如果 AI provider 不可用，验证 UI 结构正确性
  - 验证：截图中可见预期 UI 元素
