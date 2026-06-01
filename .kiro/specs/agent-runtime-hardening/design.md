# Agent 运行时加固 — 设计文档

## 架构概览

采用独立模块方案，四个子系统各自独立实现，通过事件松耦合。不改动 `agent-turn-runtime.ts` 的核心循环结构，而是在循环的关键节点插入钩子。

```
agent-turn-runtime.ts (核心循环)
  │
  ├── [钩子] onBeforeGenerate → context-compaction (级联压缩检查)
  ├── [钩子] onBeforeToolExecute → yolo-mode (权限判定 + 安全反思)
  ├── [钩子] onAfterToolExecute → turn-checkpoint (状态持久化)
  │                              → turn-health-monitor (健康检测)
  └── [钩子] onTurnComplete/onTurnFail → turn-checkpoint (清理)
```

## 模块设计

### 模块 1：上下文压缩增强

#### 文件结构

```
packages/studio/src/api/lib/compact/
  ├── full-compact.ts          (现有，结构化压缩)
  ├── cascade-compact.ts       (新增，级联压缩)
  ├── segment-compact.ts       (新增，分段压缩)
  └── compact-utils.ts         (新增，共享工具函数)
```

#### 级联压缩 (`cascade-compact.ts`)

**触发时机**：在 `full-compact` 发现历史消息总 token 超过摘要模型窗口的 80% 时自动切换。

**算法**：

```typescript
interface CascadeCompactOptions {
  messages: NarratorSessionChatMessage[];
  summaryModel: string;
  summaryModelContextWindow: number;
  signal?: AbortSignal;
}

async function cascadeCompact(options: CascadeCompactOptions): Promise<CompactResult> {
  const { messages, summaryModelContextWindow } = options;
  const chunkTokenLimit = Math.floor(summaryModelContextWindow * 0.6);
  
  // 1. 按 token 预算分块（从最旧开始）
  const chunks = splitMessagesByTokenBudget(messages, chunkTokenLimit);
  
  // 2. 保留最后一个块不压缩（最近消息）
  const chunksToCompress = chunks.slice(0, -1);
  const recentChunk = chunks.at(-1)!;
  
  // 3. 逐块压缩，前一块的摘要作为后一块的前置上下文
  let previousSummary = "";
  const summaries: string[] = [];
  
  for (const chunk of chunksToCompress) {
    const summary = await compressChunk(chunk, previousSummary, options);
    summaries.push(summary);
    previousSummary = summary;
  }
  
  // 4. 返回：合并摘要 + 未压缩的最近消息
  return {
    compressedMessages: buildCompressedHistory(summaries, recentChunk),
    originalMessageCount: messages.length,
    compressedTokenEstimate: estimateTokens(summaries.join("\n")),
  };
}
```

**与现有 full-compact 的关系**：
- `full-compact` 适用于历史能一次放入摘要模型窗口的场景
- `cascade-compact` 适用于历史超过摘要模型窗口的场景
- 在 `context-compaction.ts` 中根据历史长度自动选择

#### 分段压缩 (`segment-compact.ts`)

**API 端点**：`POST /api/sessions/:id/compact-segment`

```typescript
interface SegmentCompactRequest {
  beforeSeq: number;  // 压缩此 seq 之前的所有消息
}

interface SegmentCompactResult {
  summaryMessage: NarratorSessionChatMessage;  // 生成的摘要消息
  collapsedCount: number;                       // 被折叠的消息数
  undoToken: string;                            // 用于 undo 的 token
}
```

**流程**：
1. 前端右键消息 → "压缩到此消息前"
2. 后端取 seq < beforeSeq 的所有消息
3. 调用摘要模型压缩为一条摘要
4. 原始消息标记 `collapsed: true`（不删除，不发送给 LLM）
5. 插入摘要消息到原位
6. 返回 undoToken，前端可调用 `POST /api/sessions/:id/compact-segment/undo`

### 模块 2：YOLO 模式 + 安全反思

#### 文件结构

```
packages/studio/src/api/lib/
  ├── yolo-mode.ts             (新增，YOLO 判定 + 安全反思)
  └── permission-pipeline.ts   (修改，插入 YOLO 层)
```

#### 工具风险分级

```typescript
type ToolRiskLevel = "safe" | "write" | "dangerous";

const TOOL_RISK_MAP: Record<string, ToolRiskLevel> = {
  // safe — 只读操作
  Read: "safe",
  Glob: "safe",
  Grep: "safe",
  WebSearch: "safe",
  WebFetch: "safe",
  
  // write — 写入操作
  Write: "write",
  Edit: "write",
  Terminal: "write",
  
  // Bash 根据命令内容动态判定
  Bash: "dynamic",
};

// 危险命令模式（正则）
const DANGEROUS_PATTERNS: RegExp[] = [
  /\brm\s+(-[a-z]*f|-[a-z]*r|--force|--recursive)/i,
  /\bgit\s+(push\s+--force|reset\s+--hard|clean\s+-[a-z]*f|branch\s+-D)/i,
  /\b(DROP|TRUNCATE|DELETE\s+FROM)\b/i,
  /\bformat\b/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
];
```

#### 安全反思流程

```typescript
interface SafetyReflectionResult {
  decision: "approve" | "reject";
  reason: string;
}

async function performSafetyReflection(
  sessionId: string,
  toolName: string,
  toolInput: Record<string, unknown>,
  conversationHistory: NarratorSessionChatMessage[],
  model: string,
  signal?: AbortSignal,
): Promise<SafetyReflectionResult> {
  const reflectionPrompt = buildReflectionPrompt(toolName, toolInput);
  
  // 使用当前对话模型，带完整历史上下文（与 agent turn 共享同一消息历史）
  // 注意：反思调用的结果不会追加到对话历史中，仅用于判断
  const response = await generate({
    model,
    messages: [
      ...conversationHistory,  // 当前 turn 的完整消息历史
      { role: "user", content: reflectionPrompt },
    ],
    maxTokens: 200,
    signal: AbortSignal.timeout(15_000),
  });
  
  return parseReflectionResponse(response);
}

function buildReflectionPrompt(toolName: string, toolInput: Record<string, unknown>): string {
  return `[安全反思] 你即将执行以下操作：
工具：${toolName}
参数：${JSON.stringify(toolInput, null, 2)}

请判断这个操作在当前任务上下文中是否合理且安全。
- 如果合理，回答：APPROVE
- 如果不合理或有风险，回答：REJECT: <原因>

只回答 APPROVE 或 REJECT: <原因>，不要其他内容。`;
}
```

#### 与 permission-pipeline 的集成

在现有 `permission-pipeline.ts` 的决策链中，YOLO 层插入位置：

```
现有流程：tool request → policy check → risk classification → confirmation request
新增流程：tool request → policy check → risk classification → YOLO check → (安全反思 | confirmation request)
```

当 session 配置了 YOLO 模式时：
- safe/write → 跳过 confirmation，直接执行
- dangerous → 触发安全反思 → approve 则执行，reject 则走 confirmation request

### 模块 3：中断恢复

#### 文件结构

```
packages/studio/src/api/lib/
  ├── turn-checkpoint.ts       (新增，checkpoint 持久化)
  └── session-chat-service.ts  (修改，启动恢复 + continue 处理)
```

#### Checkpoint Schema

```sql
CREATE TABLE IF NOT EXISTS turn_checkpoints (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  step INTEGER NOT NULL,
  completed_tool_results TEXT NOT NULL,  -- JSON array
  last_assistant_content TEXT,           -- 最后一次 LLM 响应内容
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX idx_turn_checkpoints_session ON turn_checkpoints(session_id);
```

#### Checkpoint API

```typescript
interface TurnCheckpoint {
  id: string;
  sessionId: string;
  turnId: string;
  step: number;
  completedToolResults: ToolExecutionRecord[];
  lastAssistantContent?: string;
  createdAt: string;
}

// 在 agent-turn-runtime 的工具执行后调用
async function saveTurnCheckpoint(checkpoint: TurnCheckpoint): Promise<void>;

// 服务器启动时调用
async function getUnfinishedCheckpoints(): Promise<TurnCheckpoint[]>;

// Turn 完成后调用
async function clearTurnCheckpoint(sessionId: string, turnId: string): Promise<void>;
```

#### 恢复流程

```typescript
// 服务器启动时
async function recoverInterruptedTurns(): Promise<void> {
  const checkpoints = await getUnfinishedCheckpoints();
  
  for (const checkpoint of checkpoints) {
    try {
      // 将已完成的工具结果注入消息历史
      await injectToolResultsAsHistory(checkpoint);
      // 标记 session 为 interrupted，等待用户触发继续
      await markSessionInterrupted(checkpoint.sessionId);
    } catch (error) {
      logger.error("Failed to recover checkpoint", { checkpoint, error });
      await markSessionInterrupted(checkpoint.sessionId);
    }
  }
}
```

#### Continue 处理

```typescript
// 前端发送 session:continue
// 后端处理：
async function handleSessionContinue(sessionId: string): Promise<void> {
  const state = getSessionState(sessionId);
  
  // 构造继续消息
  const continueMessage: NarratorSessionChatMessage = {
    role: "user",
    content: "请继续执行之前被中断的任务。",
    seq: getNextSeq(state),
    timestamp: Date.now(),
  };
  
  // 追加到历史并启动新 turn
  state.messages.push(continueMessage);
  await executeRuntimeTurn(sessionId, state);
}
```

### 模块 4：流式中断检查加强

#### 文件结构

```
packages/studio/src/api/lib/
  └── turn-health-monitor.ts   (新增，健康监控)
```

#### 核心接口

```typescript
interface TurnHealthCheckResult {
  action: "continue" | "warn" | "stop";
  message?: string;
  reason?: string;
}

interface TurnHealthMonitorState {
  recentToolCalls: Array<{ name: string; input: Record<string, unknown>; result: string; timestamp: number }>;
  cumulativeTokens: number;
  consecutiveFailures: Map<string, number>;
  consecutiveEmptyResults: number;
}

class TurnHealthMonitor {
  private state: TurnHealthMonitorState;
  private config: TurnHealthConfig;
  
  constructor(config: TurnHealthConfig) { ... }
  
  // 每次工具执行后调用
  checkHealth(toolCall: ToolCallRecord): TurnHealthCheckResult { ... }
  
  // 重置状态（新 turn 开始时）
  reset(): void { ... }
}
```

#### 循环模式检测算法

```typescript
function detectLoopPattern(recentCalls: ToolCallRecord[], threshold: number): boolean {
  if (recentCalls.length < 4) return false;
  
  const last = recentCalls.at(-1)!;
  let similarCount = 0;
  
  // 检查最近 10 次调用中与当前调用的相似度
  const window = recentCalls.slice(-10);
  for (const call of window) {
    if (call === last) continue;
    if (computeSimilarity(call, last) > threshold) {
      similarCount++;
    }
  }
  
  return similarCount >= 3;
}

function computeSimilarity(a: ToolCallRecord, b: ToolCallRecord): number {
  if (a.name !== b.name) return 0;
  
  // 比较输入参数的结构相似性
  const aKeys = Object.keys(a.input).sort();
  const bKeys = Object.keys(b.input).sort();
  
  if (aKeys.join(",") !== bKeys.join(",")) return 0.3;
  
  // 比较值的相似度（Jaccard 或编辑距离）
  let matchingValues = 0;
  for (const key of aKeys) {
    if (JSON.stringify(a.input[key]) === JSON.stringify(b.input[key])) {
      matchingValues++;
    }
  }
  
  return 0.5 + 0.5 * (matchingValues / aKeys.length);
}
```

#### 与 agent-turn-runtime 的集成

在现有循环中插入健康检查：

```typescript
// agent-turn-runtime.ts 中，工具执行完成后
const healthResult = turnHealthMonitor.checkHealth({
  name: toolUse.name,
  input: toolUse.input,
  result: toolResult,
  timestamp: Date.now(),
});

switch (healthResult.action) {
  case "warn":
    // 注入系统提示到下一次 generate 的消息中
    injectSystemHint(healthResult.message!);
    break;
  case "stop":
    emit({ type: "turn_failed", reason: "health-check", message: healthResult.message });
    return;
}
```

## 配置模型

所有新增配置项统一放在 session 配置中：

```typescript
interface AgentRuntimeConfig {
  // 现有配置...
  
  // YOLO 模式
  yoloMode: boolean;                    // 默认 false
  safetyReflection: boolean;            // 默认 true（YOLO 开启时生效）
  safetyReflectionTimeoutMs: number;    // 默认 15000
  
  // 压缩
  cascadeCompactEnabled: boolean;       // 默认 true
  
  // 中断恢复
  turnCheckpointEnabled: boolean;       // 默认 true
  autoRecoverOnStartup: boolean;        // 默认 true
  
  // 健康监控
  loopDetectionThreshold: number;       // 默认 0.8
  tokenConsumptionWarnRatio: number;    // 默认 0.5
  maxConsecutiveFailures: number;       // 默认 5
}
```

## 前端变更

### 新增 UI 元素

1. **设置页**：
   - YOLO 模式开关 + 安全反思开关
   - 健康监控参数调节（循环检测灵敏度、token 警告阈值、最大失败次数）

2. **对话框**：
   - 消息右键菜单新增"压缩到此消息前"
   - 中断后显示"继续"按钮
   - 安全反思暂停时显示黄色警告卡片（操作详情 + 确认/拒绝按钮）

3. **状态指示**：
   - 级联压缩进行中显示进度
   - 安全反思进行中显示"正在评估安全性..."

### WebSocket 事件

新增事件类型：

```typescript
// 安全反思暂停
interface SafetyPauseEnvelope {
  type: "session:safety-pause";
  toolName: string;
  toolInput: Record<string, unknown>;
  reason: string;  // 模型给出的拒绝原因
}

// 安全反思决策（用户响应）
interface SafetyDecisionMessage {
  type: "session:safety-decision";
  decision: "approve" | "reject";
}

// 压缩进度
interface CompactProgressEnvelope {
  type: "session:compact-progress";
  stage: "cascade" | "segment";
  progress: number;  // 0-100
  message?: string;
}
```

## 数据库变更

新增 1 张表：

```sql
-- Turn checkpoint（中断恢复用）
CREATE TABLE IF NOT EXISTS turn_checkpoints (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  step INTEGER NOT NULL,
  completed_tool_results TEXT NOT NULL,
  last_assistant_content TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
```

现有表变更：

```sql
-- session_messages 新增 collapsed 字段
ALTER TABLE session_messages ADD COLUMN collapsed INTEGER NOT NULL DEFAULT 0;
```

## 测试策略

| 模块 | 测试类型 | 覆盖重点 |
|------|----------|----------|
| cascade-compact | 单元测试 | 分块算法、逐块压缩、失败回退 |
| segment-compact | 单元测试 + API 测试 | 压缩/undo 流程、collapsed 标记 |
| yolo-mode | 单元测试 | 风险分级、反思 prompt 构建、超时处理 |
| turn-checkpoint | 单元测试 + 集成测试 | 写入/读取/清理、恢复流程 |
| turn-health-monitor | 单元测试 | 循环检测、token 追踪、空转检测 |

## 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| 安全反思调用增加延迟 | YOLO 模式下危险操作多等 2-5s | 15s 超时 + 仅 dangerous 级别触发 |
| 级联压缩丢失关键信息 | 后续对话缺少上下文 | 保留最近消息不压缩 + 复用已验证的 prompt |
| Checkpoint 写入影响性能 | 每次工具执行多一次 DB 写入 | 异步写入 + 批量合并 |
| 循环检测误报 | 正常的重复操作被打断 | 可调阈值 + 仅注入提示不强制停止 |
