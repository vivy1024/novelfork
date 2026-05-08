# Implementation Plan

## Overview

从 `requirements.md` + `design.md` 生成的任务清单。目标：把对话页面从"底层就绪但前端断裂"状态推进到"浏览器可验活"状态。核心策略是复用现有成熟组件、修复接线断裂、激活 dead code。

## Traceability

- Task 1 → Requirement 1；Design 1（MarkdownRenderer 替换）
- Task 2-3 → Requirement 2；Design 1、7（ToolCallBlock 替换 + 适配器）
- Task 4-5 → Requirement 3；Design 2（Composer 控件改造）
- Task 6 → Requirement 4；Design 3（streamingStartedAt 接线）
- Task 7 → Requirement 5；Design 4（搜索功能）
- Task 8 → Requirement 6；Design 5（workflow executor 激活）
- Task 9 → Requirement 7；Design 6（MCP client 激活）
- Task 10 → Requirement 8；Design 8（浏览器验证）

## Tasks

- [ ] FEATURE 1. MessageItem 替换为 MarkdownRenderer
  - 删除 `surface/MessageItem.tsx` 中的 `renderMarkdown()` 和 `inlineMarkdown()` 函数
  - 导入 `@/components/MarkdownRenderer`
  - AI 回复内容改为 `<MarkdownRenderer content={message.content} />`
  - 确认 react-markdown、remark-gfm、react-syntax-highlighter 依赖已安装
  - 验证：typecheck 通过；ConversationSurface.test.tsx 通过

- [ ] ENABLER 2. 编写 ConversationToolCall → ToolCall 适配器
  - 在 `surface/` 或 `agent-conversation/` 中新增 `tool-call-adapter.ts`
  - 实现 `adaptConversationToolCall(ctc: ConversationToolCall): ToolCall`
  - 映射 id、toolName→name、status、input、output、error、durationMs→duration
  - 验证：适配器单测覆盖 success/error/pending/running 四种状态

- [ ] FEATURE 3. MessageItem 工具调用替换为 ToolCallBlock
  - 删除 `surface/ToolCallCard.tsx` 文件
  - MessageItem 中导入 `ToolCallBlock` from `@/components/ToolCall/ToolCallBlock`
  - 使用 Task 2 适配器转换后传入
  - 如果 ToolCallBlock 的 `useRunDetails` 依赖不可满足，传入 `onInspectRun={undefined}` 禁用 inspect
  - 验证：typecheck 通过；ConversationSurface.test.tsx 通过；删除 ToolCallCard 后无 import 报错

- [ ] FEATURE 4. Composer 附件按钮接线
  - 新增隐藏 `<input type="file" ref={fileInputRef} onChange={handleFileSelect} />`
  - Paperclip 按钮 onClick → `fileInputRef.current?.click()`
  - 选择文件后调用新增 prop `onAttach?: (files: FileList) => void`
  - ConversationSurface 接收 onAttach 并将文件路径附加到下一条消息的 context metadata
  - 验证：点击附件按钮弹出文件选择器（组件测试）

- [ ] FEATURE 5. Composer 模型/权限改为下拉选择器
  - 新增 props：`modelOptions?: RuntimeModelOption[]`、`onModelChange?: (modelId: string) => void`、`onPermissionChange?: (mode: string) => void`
  - 模型 `<span>` 替换为 `<select>` 下拉，value 为当前 modelLabel 对应的 modelId
  - 权限 `<span>` 替换为 `<select>` 下拉，options 来自 `SESSION_PERMISSION_MODE_OPTIONS`
  - 选择后调用对应 onChange handler
  - ConversationRoute 传入 modelOptions（从 provider client 获取）和 onChange handlers（调用 onUpdateSessionConfig）
  - 验证：组件测试覆盖下拉渲染、选择触发 onChange

- [ ] FEATURE 6. streamingStartedAt 接线
  - ConversationRouteStatus 类型新增 `streamingStartedAt?: number`
  - ConversationRoute 传入 `streamingStartedAt={initialStatus.state === "running" ? (initialStatus.streamingStartedAt ?? Date.now()) : null}`
  - WebSocket envelope reducer 在收到 `session:stream` 首个 chunk 时记录 `streamingStartedAt = Date.now()`
  - `session:state` 变为非 running 时清除 streamingStartedAt
  - 验证：组件测试覆盖 running 时显示计时器、idle 时不显示

- [ ] FEATURE 7. 搜索功能实现
  - ConversationSurface 新增 `searchOpen` 和 `searchQuery` state
  - 搜索按钮 onClick → `setSearchOpen(true)`
  - 展开搜索输入框（header 区域内）
  - `filteredMessages = searchQuery ? messages.filter(...) : messages`
  - MessageStream 接收 filteredMessages
  - 无匹配时显示"无结果"
  - ESC 或清空关闭搜索
  - 验证：组件测试覆盖搜索过滤、无结果、关闭

- [ ] FEATURE 8. workflow-executor 接入生产路径
  - `slash-command-registry.ts` 中 `/novel:write-next` 不再返回 `unhandled_command`
  - 改为调用 `executeNovelCommand("write-next", context)` 或直接调用 workflow executor
  - Composer 中删除 `if (!result.ok && result.code === "unhandled_command" && content.startsWith("/novel:"))` fallback 逻辑
  - 验证：slash-command-registry.test.ts 覆盖 `/novel:write-next` 返回 workflow 结果而非 unhandled

- [ ] FEATURE 9. MCP client 接入套路页
  - 新增 API route `POST /api/mcp/servers/:id/connect` → 调用 `createMcpClient(config)`
  - 新增 API route `GET /api/mcp/servers/:id/status` → 返回连接状态和工具列表
  - MCPServerPanel 添加"连接"按钮，onClick 调用 connect API
  - 连接成功：绿色 badge + 工具数量 + 可展开工具列表
  - 连接失败：红色 badge + 错误信息
  - 验证：API route 测试覆盖连接成功/失败；组件测试覆盖状态展示

- [ ] GUARD 10. 浏览器截图验证
  - 使用 Browser 工具启动 localhost:4567
  - 场景 1：新建会话 → 发送"你好" → 等待 AI 回复 → 截图验证 Markdown 渲染
  - 场景 2：设置页修改模型 → 保存 → 刷新 → 截图验证保持
  - 场景 3：对话页 Composer 截图验证模型下拉 + 权限下拉
  - 如果 AI provider 不可用，至少验证 UI 结构（空消息、Composer 控件、搜索展开）
  - 验证：截图中可见预期 UI 元素
