# Design — 对话页面真实闭环

## 架构决策

### 1. 组件复用策略

不新建组件，只替换引用：

```
surface/MessageItem.tsx
  - 删除 renderMarkdown() / inlineMarkdown()
  - import { MarkdownRenderer } from "@/components/MarkdownRenderer"
  - AI 回复内容传入 <MarkdownRenderer content={message.content} />

surface/MessageItem.tsx
  - 删除 import { ToolCallCard } from "./ToolCallCard"
  - import { ToolCallBlock } from "@/components/ToolCall/ToolCallBlock"
  - 工具调用传入 <ToolCallBlock toolCall={adaptedToolCall} />
  - 需要适配器：ConversationToolCall → ToolCall（shared/session-types）

surface/ToolCallCard.tsx
  - 删除整个文件
```

### 2. Composer 控件改造

```
Composer.tsx 当前结构：
  <Paperclip /> ← 无 onClick
  <textarea />
  <span>{modelLabel}</span> ← 静态文本
  <span>{permissionMode}</span> ← 静态文本
  <Send /> 或 <Square />

改造后：
  <Paperclip onClick={handleAttach} /> ← 打开 <input type="file" />
  <textarea />
  <select value={modelId} onChange={handleModelChange}> ← 从 props.modelOptions 渲染
  <select value={permissionMode} onChange={handlePermissionChange}> ← SESSION_PERMISSION_MODE_OPTIONS
  <Send /> 或 <Square />
```

新增 props：
- `modelOptions: RuntimeModelOption[]`
- `onModelChange: (modelId: string) => void`
- `onPermissionChange: (mode: string) => void`
- `onAttach: (files: FileList) => void`

### 3. streamingStartedAt 接线

```
ConversationRoute.tsx:
  当前：不传 streamingStartedAt
  改造：streamingStartedAt={initialStatus.state === "running" ? (initialStatus.streamingStartedAt ?? Date.now()) : null}

ConversationRouteStatus 类型扩展：
  streamingStartedAt?: number
```

数据来源：WebSocket `session:state` envelope 中的 `startedAt` 字段，或 `session:stream` 首个 chunk 的时间戳。

### 4. 搜索功能

最小实现：纯前端过滤，不调用后端 API。

```
ConversationSurface.tsx:
  const [searchQuery, setSearchQuery] = useState("")
  const [searchOpen, setSearchOpen] = useState(false)
  
  const filteredMessages = searchQuery
    ? messages.filter(m => m.content.toLowerCase().includes(searchQuery.toLowerCase()))
    : messages
```

搜索按钮 onClick → `setSearchOpen(true)`，展开输入框。

### 5. workflow-executor 接入

当前路径：
```
Composer → slash command → parseSlashCommandInput("/novel:write-next")
  → executeSlashCommandInput → registry handler
  → 如果 unhandled_command → onSend(content) → 作为普通消息发给 AI
```

改造后路径：
```
slash-command-registry.ts:
  "/novel:write-next" handler 不再返回 unhandled_command
  而是调用 executeNovelCommand("write-next", context)
  → workflow-executor.ts executeWorkflow(recipe, context)
  → 步骤结果通过 WebSocket 广播
```

关键：`session-chat-service.ts` 中已有 `executeNovelCommand` handler 的接线代码（Task 11 of real-functionality-closure），只需确认 slash-command-registry 不再 fallback 到 onSend。

### 6. MCP client 接入

当前路径：
```
MCPServerPanel → 添加 server → 保存到 routines config → 无连接动作
```

改造后路径：
```
MCPServerPanel → 添加 server → 保存到 routines config
  → 调用 POST /api/mcp/servers/:id/connect
  → 后端调用 createMcpClient(config)
  → 返回 { status, tools: [...] }
  → 前端显示连接状态和工具列表
```

需要新增 API route：`POST /api/mcp/servers/:id/connect`、`GET /api/mcp/servers/:id/status`。

### 7. ToolCall 类型适配

```typescript
// surface/ToolCallCard.tsx 的 ConversationToolCall
interface ConversationToolCall {
  id: string;
  toolName: string;
  status?: "pending" | "running" | "success" | "error";
  summary?: string;
  input?: unknown;
  result?: unknown;
  output?: string;
  error?: string;
  exitCode?: number;
  durationMs?: number;
}

// shared/session-types.ts 的 ToolCall（ToolCallBlock 需要的）
// 需要写适配函数 conversationToolCallToSessionToolCall()
```

### 8. 验证策略

使用 Browser 工具截图验证，不依赖 Playwright E2E：
1. 启动开发服务器
2. Browser launch → navigate to localhost:4567/next
3. 创建会话 → 发送消息 → 等待回复 → screenshot
4. 验证 Markdown 渲染、工具卡片、Composer 控件

## 风险

- MarkdownRenderer 依赖 react-markdown/remark-gfm/rehype-katex/react-syntax-highlighter，需确认这些依赖已安装
- ToolCallBlock 依赖 useRunDetails hook 和 StudioRun 类型，可能需要 mock 或简化
- MCP server 连接需要外部进程可用，验证可能受限
