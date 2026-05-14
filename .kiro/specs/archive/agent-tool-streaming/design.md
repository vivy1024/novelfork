# Agent 工具流式执行 + 能力补全 — 设计文档

## 架构总览

```
┌─────────────────────────────────────────────────────────────────┐
│ 前端 (React)                                                     │
│ ┌───────────────┐  ┌──────────────────┐  ┌───────────────────┐  │
│ │ ToolCallCard  │  │ PermissionCard   │  │ DangerReflection  │  │
│ │ (状态动画+流式)│  │ (allow/deny)     │  │ (风险分析展示)     │  │
│ └───────┬───────┘  └────────┬─────────┘  └─────────┬─────────┘  │
│         │                   │                       │            │
│ ┌───────▼───────────────────▼───────────────────────▼──────────┐ │
│ │ ws-envelope-reducer.ts                                        │ │
│ │ 新增事件: tool-started / tool-input-chunk / permission-req    │ │
│ └───────────────────────────┬──────────────────────────────────┘ │
└─────────────────────────────┼──────────────────────────────────┘
                              │ WebSocket
┌─────────────────────────────▼──────────────────────────────────┐
│ 后端 (Hono + Bun)                                               │
│                                                                  │
│ ┌──────────────────────────────────────────────────────────────┐│
│ │ agent-turn-runtime.ts (Agent Loop)                            ││
│ │ ┌─────────────┐  ┌──────────────┐  ┌─────────────────────┐  ││
│ │ │ generate()  │→ │ tool_use[]   │→ │ executeTool()        │  ││
│ │ │ (LLM 调用)  │  │ (可能多个)   │  │ (串行/并行)          │  ││
│ │ └─────────────┘  └──────────────┘  └──────────┬──────────┘  ││
│ │                                                │              ││
│ │ 新增: 并行检测 + 流式 SSE 解析 + 静默阈值      │              ││
│ └────────────────────────────────────────────────┼──────────────┘│
│                                                  │               │
│ ┌────────────────────────────────────────────────▼──────────────┐│
│ │ session-tool-executor.ts                                       ││
│ │ ┌─────────────────┐  ┌──────────────────┐  ┌──────────────┐  ││
│ │ │ permission check│→ │ tool.execute()   │→ │ result format │  ││
│ │ │ (pipeline)      │  │ (with streaming) │  │ (truncation)  │  ││
│ │ └─────────────────┘  └────────┬─────────┘  └──────────────┘  ││
│ │                               │                                ││
│ │ 新增: onOutput 回调 + 权限等待 + 结果截断                      ││
│ └───────────────────────────────┼────────────────────────────────┘│
│                                 │                                 │
│ ┌───────────────────────────────▼────────────────────────────────┐│
│ │ tools/ (工具实现层)                                             ││
│ │ ┌────────┐ ┌────────┐ ┌─────────┐ ┌───────────┐ ┌──────────┐ ││
│ │ │BashTool│ │ReadTool│ │BrowserT.│ │WebSearchT.│ │WebFetchT.│ ││
│ │ │+stream │ │        │ │(新增)   │ │(新增)     │ │(新增)    │ ││
│ │ │+bg task│ │        │ │         │ │           │ │          │ ││
│ │ └────────┘ └────────┘ └─────────┘ └───────────┘ └──────────┘ ││
│ └────────────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────┘
```

---

## Phase 1 详细设计

### 1.1 execCommandStreaming 接口

```typescript
// packages/core/src/runtime/process-adapter.ts

export interface StreamingExecOptions {
  cwd?: string;
  timeout?: number;
  env?: Record<string, string>;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
}

export interface StreamingExecResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
}

export async function execCommandStreaming(
  command: string,
  options: StreamingExecOptions,
): Promise<StreamingExecResult> {
  // Bun.spawn 或 child_process.spawn
  // 逐行读取 stdout/stderr，调用 onStdout/onStderr
  // 超时后 SIGTERM → SIGKILL
  // 返回完整结果
}
```

### 1.2 BashTool 改造

```typescript
// packages/studio/src/api/lib/tools/BashTool.ts

export const BashTool: ToolDefinition = {
  name: "Bash",
  description: "执行 shell 命令",
  parameters: [
    { name: "command", type: "string", required: true, description: "要执行的 shell 命令" },
    { name: "description", type: "string", required: false, description: "命令的人类可读描述" },
    { name: "timeout", type: "number", required: false, default: 120000 },
    { name: "run_in_background", type: "boolean", required: false, default: false },
  ],
  execute: async (params, context) => {
    // ...权限检查...
    
    const result = await execCommandStreaming(command, {
      cwd: context.workspaceRoot,
      timeout,
      onStdout: (chunk) => context.onOutput?.(chunk),
      onStderr: (chunk) => context.onOutput?.(`[stderr] ${chunk}`),
    });
    
    return { success: result.exitCode === 0, data: { stdout, stderr, exitCode } };
  },
};
```

### 1.3 ToolContext 扩展

```typescript
// packages/studio/src/api/lib/tool-executor.ts

export interface ToolContext {
  workspaceRoot: string;
  permissions: Set<string>;
  sessionId: string;
  /** 实时输出回调 — 桥接到 WebSocket session:tool-stream */
  onOutput?: (chunk: string) => void;
}
```

### 1.4 WebSocket 事件桥接

```typescript
// session-tool-executor.ts 中执行工具时

const toolContext: ToolContext = {
  ...baseContext,
  onOutput: (chunk) => {
    wsEmit(sessionId, {
      type: "session:tool-stream",
      toolCallId: currentToolCallId,
      content: chunk,
    });
  },
};
```

---

## Phase 2 详细设计

### 2.1 截断策略

```typescript
// agent-turn-runtime.ts

const MAX_TOOL_RESULT_CHARS = 30000;
const HEAD_CHARS = 20000;
const TAIL_CHARS = 5000;

function truncateToolResult(content: string): string {
  if (content.length <= MAX_TOOL_RESULT_CHARS) return content;
  
  const omitted = content.length - HEAD_CHARS - TAIL_CHARS;
  return [
    content.slice(0, HEAD_CHARS),
    `\n\n[... 已省略 ${omitted} 字符 (${Math.round(omitted / 4)} tokens) ...]\n\n`,
    content.slice(-TAIL_CHARS),
  ].join("");
}
```

### 2.2 并行执行逻辑

```typescript
// agent-turn-runtime.ts 中 tool_use 处理部分

const PARALLEL_SAFE = new Set(["Read", "Glob", "Grep", "WebSearch", "WebFetch"]);

if (reply.type === "tool_use") {
  const toolUses = reply.toolUses;
  const safe = toolUses.filter(t => PARALLEL_SAFE.has(t.name));
  const unsafe = toolUses.filter(t => !PARALLEL_SAFE.has(t.name));
  
  // 并行执行 safe 工具
  const safeResults = await Promise.all(
    safe.map(t => executeTool(t.name, t.input))
  );
  
  // 串行执行 unsafe 工具
  for (const t of unsafe) {
    const result = await executeTool(t.name, t.input);
    // ...
  }
}
```

### 2.3 流式 SSE 解析（工具输入预览）

```typescript
// llm-runtime-service.ts 中处理 SSE 流

for await (const event of sseStream) {
  if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
    // 立即通知前端：工具开始
    onEvent?.({
      type: "tool_started",
      id: event.content_block.id,
      toolName: event.content_block.name,
    });
  }
  
  if (event.type === "content_block_delta" && event.delta.type === "input_json_delta") {
    // 累积 partial JSON，定期推送
    partialInput += event.delta.partial_json;
    if (shouldFlush(partialInput)) {
      onEvent?.({
        type: "tool_input_chunk",
        id: currentToolId,
        partialInput,
      });
    }
  }
}
```

---

## Phase 3 详细设计

### 3.1 BrowserTool 架构

```typescript
// packages/studio/src/api/lib/tools/BrowserTool.ts

import { chromium, type Browser, type Page } from "playwright";

// 全局浏览器会话注册表
const sessions = new Map<string, { browser: Browser; page: Page; lastAccess: number }>();

export const BrowserTool: ToolDefinition = {
  name: "Browser",
  parameters: [
    { name: "action", type: "string", required: true },  // launch/click/fill/screenshot/...
    { name: "url", type: "string", required: false },
    { name: "session_id", type: "string", required: false },
    { name: "selector", type: "string", required: false },
    { name: "value", type: "string", required: false },
  ],
  execute: async (params, context) => {
    switch (params.action) {
      case "launch": return await launchBrowser(params.url);
      case "screenshot": return await takeScreenshot(params.session_id);
      case "click": return await clickElement(params.session_id, params.selector);
      // ...
    }
  },
};
```

### 3.2 WebSearchTool

```typescript
// 使用 Serper API 或 SearXNG

export const WebSearchTool: ToolDefinition = {
  name: "WebSearch",
  parameters: [
    { name: "query", type: "string", required: true },
    { name: "num_results", type: "number", required: false, default: 5 },
  ],
  execute: async (params) => {
    const response = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "X-API-KEY": process.env.SERPER_API_KEY!, "Content-Type": "application/json" },
      body: JSON.stringify({ q: params.query, num: params.num_results }),
    });
    const data = await response.json();
    return { success: true, data: { results: data.organic } };
  },
};
```

---

## Phase 4 详细设计

### 4.1 权限决策流程

```
Agent Loop                    WebSocket                    前端
    │                            │                          │
    │ executeTool("Bash", {cmd}) │                          │
    │──► permission check ──────►│ session:permission-req   │
    │    (需要确认)              │─────────────────────────►│
    │                            │                          │ 显示确认卡片
    │    await decision          │                          │
    │◄───────────────────────────│ session:permission-dec   │
    │                            │◄─────────────────────────│ 用户点击 allow
    │    继续执行                 │                          │
    │──► tool.execute()          │                          │
```

### 4.2 计划模式状态机

```
normal ──用户输入"/plan"──► plan
  │                          │
  │                          │ 只允许只读工具
  │                          │ Agent 输出计划文本
  │                          │
  │◄──用户点击"批准"──────────┘
  │
  │ 按计划执行（normal 模式）
```

---

## 文件变更清单

### Phase 1
- `packages/core/src/runtime/process-adapter.ts` — 新增 `execCommandStreaming`
- `packages/studio/src/api/lib/tools/BashTool.ts` — 改造为流式 + description + background
- `packages/studio/src/api/lib/tool-executor.ts` — ToolContext 添加 onOutput
- `packages/studio/src/api/lib/session-tool-executor.ts` — 桥接 onOutput → WebSocket

### Phase 2
- `packages/studio/src/api/lib/agent-turn-runtime.ts` — 并行执行 + 截断
- `packages/studio/src/api/lib/llm-runtime-service.ts` — SSE 流解析 tool_started/input_chunk
- `packages/studio/src/app-next/agent-conversation/runtime/ws-envelope-reducer.ts` — 新事件处理

### Phase 3
- `packages/studio/src/api/lib/tools/BrowserTool.ts` — 新增
- `packages/studio/src/api/lib/tools/WebSearchTool.ts` — 新增
- `packages/studio/src/api/lib/tools/WebFetchTool.ts` — 新增
- `packages/studio/src/api/lib/tools/index.ts` — 注册新工具

### Phase 4
- `packages/studio/src/api/lib/permission-pipeline.ts` — 等待前端决策
- `packages/studio/src/app-next/agent-conversation/surface/PermissionRequestCard.tsx` — 新增
- `packages/studio/src/app-next/agent-conversation/surface/DangerReflectionCard.tsx` — 新增
- `packages/studio/src/shared/session-types.ts` — 新增 permission 相关类型
