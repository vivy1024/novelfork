# 06 - API 与数据契约

NovelFork HTTP/WebSocket API 及数据结构参考。

## HTTP 路由总览

### 通用路由（studio）

| 路径前缀 | 功能 |
|----------|------|
| `/api/session` | 对话管理（CRUD/fork/compact/rollback） |
| `/api/storage` | 书籍/章节/驾驶舱存储 |
| `/api/chapter-candidates` | 候选稿管理 |
| `/api/providers` | 模型供应商配置 |
| `/api/aggregations` | 模型聚合查询 |
| `/api/proxy` | LLM 代理转发 |
| `/api/mcp` | MCP 服务器管理 |
| `/api/git` | Git 操作 |
| `/api/worktree` | 文件树浏览 |
| `/api/terminals` | 终端管理 |
| `/api/exec` | 命令执行 |
| `/api/routines` | Hooks/Skills/Commands |
| `/api/presets` | 预设模板 |
| `/api/lorebook` | 知识库 |
| `/api/snapshots` | 快照管理 |
| `/api/search` | 全文搜索 |
| `/api/settings` | 系统设置 |
| `/api/admin` | 管理接口 |

### 小说域路由（novel-plugin）

| 路径前缀 | 功能 |
|----------|------|
| `/api/novel/ai` | 审计/修订/检测/大纲 |
| `/api/novel/bible` | 角色/事件/设定/弧/核心转折 |
| `/api/novel/jingwei` | 分区/条目/关系图/上下文预览 |
| `/api/novel/writing-modes` | 行内/对话/变体/分支/导入 |
| `/api/novel/writing-tools` | 伏笔/POV/节奏/健康/冲突图 |
| `/api/novel/writing-resource` | 资源账本 |
| `/api/novel/pipeline` | 管线状态 |
| `/api/novel/compliance` | 合规检查 |
| `/api/novel/filter` | 朱雀过滤 |
| `/api/novel/context-manager` | 上下文用量 |

## WebSocket 协议

连接端点：`ws://localhost:1422/ws/session/:id`

### Envelope 类型

| type | 方向 | 说明 |
|------|------|------|
| `user_message` | C→S | 用户发送消息 |
| `assistant_chunk` | S→C | 流式文本片段 |
| `assistant_message` | S→C | 完整助手消息 |
| `tool_use` | S→C | 工具调用请求 |
| `tool_result` | S→C | 工具执行结果 |
| `permission_request` | S→C | 请求用户授权 |
| `permission_response` | C→S | 用户授权响应 |
| `error` | S→C | 错误消息 |
| `compact_notice` | S→C | 上下文压缩通知 |
| `status` | S→C | 状态更新（thinking/generating/idle） |
| `cancel` | C→S | 取消当前生成 |
| `plan_update` | S→C | 计划模式更新 |

## 关键数据结构

### NarratorSessionRecord

```typescript
interface NarratorSessionRecord {
  id: string;
  title: string;
  bookId?: string;
  model: string;
  provider: string;
  systemPrompt?: string;
  createdAt: string;
  updatedAt: string;
  parentSessionId?: string;     // fork 来源
  forkPointMessageId?: string;  // fork 切入点
  metadata: SessionMetadata;
}
```

### SessionConfig

```typescript
interface SessionConfig {
  model: string;
  provider: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  tools: string[];              // 启用的工具列表
  yoloMode: boolean;            // 自动审批模式
  harnessModules: string[];     // 启用的 harness 模块
}
```

### AgentTurnItem

```typescript
interface AgentTurnItem {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'tool_result';
  content: ContentBlock[];
  model?: string;
  tokenUsage?: { input: number; output: number };
  createdAt: string;
}
```

## MCP 集成 API

### 服务器管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/mcp/servers` | 列出所有 MCP 服务器 |
| POST | `/api/mcp/servers` | 添加服务器 |
| PUT | `/api/mcp/servers/:id` | 更新配置 |
| DELETE | `/api/mcp/servers/:id` | 删除服务器 |
| POST | `/api/mcp/servers/:id/connect` | 手动连接 |
| GET | `/api/mcp/servers/:id/tools` | 获取服务器工具列表 |

### MCP 工具注入

连接成功后，MCP 服务器的工具自动注入到 Agent 可用工具列表中，前缀为 `mcp__{serverName}__{toolName}`。

## 工具执行契约

### 输入

```typescript
interface SessionToolExecutionInput {
  toolName: string;
  toolInput: Record<string, unknown>;
  sessionId: string;
  messageId: string;
  abortSignal?: AbortSignal;
}
```

### 输出

```typescript
interface SessionToolExecutionResult {
  success: boolean;
  data?: unknown;
  error?: string;
  metadata?: {
    duration_ms: number;
    cached: boolean;
  };
}
```
