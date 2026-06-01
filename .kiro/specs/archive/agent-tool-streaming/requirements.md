# Agent 工具流式执行 + 能力补全 — 需求文档

## 背景

NovelFork 的 Agent Loop 核心循环已完整（`agent-turn-runtime.ts`），但工具执行层存在关键体验缺陷：

1. **Bash 命令一次性返回** — 用户看不到长命令的实时输出（npm install、编译、测试）
2. **无 description 参数** — 折叠态只能显示原始命令，不能显示人类可读意图
3. **工具结果无截断** — 大文件/大输出直接塞满 token 窗口
4. **无并行执行** — 多个 Read/Grep 串行等待
5. **无 Browser/WebSearch 后端** — 前端卡片渲染已有，后端工具未实现
6. **无权限决策 UI** — 危险操作无法让用户确认

本 spec 按优先级分 4 个 Phase 实施。

---

## Phase 1：Bash 实时 stdout 流（P0 — 用户体验最大痛点）

### 1.1 BashTool 改为 spawn + 逐行推送

**现状**: `BashTool.ts` 调用 `execCommand()` 一次性 await 返回 stdout/stderr
**目标**: 改为 `spawn` 子进程，逐行将 stdout/stderr 通过回调推送到前端

**实现方案**:
- `packages/core/src/runtime/process-adapter.ts` 新增 `execCommandStreaming(command, options)` 函数
  - 返回 `{ process, stdout$: AsyncIterable<string>, stderr$: AsyncIterable<string>, exitCode: Promise<number> }`
  - 内部用 `Bun.spawn` 或 `child_process.spawn`
- `BashTool.ts` 的 `execute` 方法接收 `context.onOutput?: (chunk: string) => void` 回调
- 每收到一行 stdout，调用 `context.onOutput(line)`
- `session-tool-executor.ts` 将 `onOutput` 桥接到 WebSocket `session:tool-stream` 事件

**验证**: 执行 `npm install` 时，前端实时看到包安装进度

### 1.2 BashTool 添加 description 参数

**现状**: BashTool 只有 `command` 和 `timeout` 两个参数
**目标**: 添加 `description` 参数，LLM 用它描述命令意图

**实现方案**:
- `BashTool.ts` parameters 数组添加 `{ name: "description", type: "string", required: false, description: "命令的人类可读描述（显示在折叠态）" }`
- `session-tool-registry.ts` 生成 JSON Schema 时包含此参数
- 前端 `ToolCallCard.tsx` 的 `extractBashCommand` 已支持（从 input.description 提取）

**验证**: LLM 调用 Bash 时传入 description，前端折叠态显示描述而非命令

### 1.3 Bash 后台任务支持

**现状**: 所有 Bash 命令阻塞 Agent Loop 直到完成
**目标**: 支持 `run_in_background: true` 参数，命令在后台运行不阻塞

**实现方案**:
- BashTool 添加 `run_in_background` 布尔参数
- 为 true 时，spawn 后立即返回 `{ success: true, data: { taskId, status: "running" } }`
- 后台进程完成后通过 WebSocket 推送 `session:background-task-completed` 事件
- 新增 `background-task-registry.ts` 管理后台任务生命周期

**验证**: `npm install` 在后台运行，Agent 继续对话，安装完成后收到通知

---

## Phase 2：工具结果截断 + 并行执行（P1 — 稳定性）

### 2.1 toolResultContent 智能截断

**现状**: `toolResultContent()` 无限追加 data 内容到 content 字符串
**目标**: 超过阈值时截断，保留头尾 + 统计信息

**实现方案**:
- 定义 `MAX_TOOL_RESULT_CHARS = 30000`（约 7500 tokens）
- 超过阈值时：保留前 20000 字符 + `\n\n... (已截断 N 字符) ...\n\n` + 后 5000 字符
- Read 工具特殊处理：超长文件返回 `"文件共 N 行，已返回第 X-Y 行。如需其他部分请指定 offset/limit。"`
- Grep 工具：超过 100 个匹配时只返回前 100 个 + `"共 N 个匹配，已显示前 100 个"`

**验证**: 读取 5000 行文件不会撑爆上下文，LLM 收到截断提示后知道用 offset/limit

### 2.2 并行工具执行

**现状**: `agent-turn-runtime.ts` 串行执行每个 tool_use
**目标**: 只读工具（Read/Glob/Grep/WebSearch/WebFetch）并行执行

**实现方案**:
- 定义 `PARALLEL_SAFE_TOOLS = new Set(["Read", "Glob", "Grep", "WebSearch", "WebFetch"])`
- 当 LLM 返回多个 tool_use 时：
  - 全部是 parallel-safe → `Promise.all` 并行
  - 混合 → 先并行执行 safe 的，再串行执行 unsafe 的
  - 全部 unsafe → 串行
- 并行结果按原始顺序排列后追加到 messages

**验证**: 同时 Read 3 个文件，总耗时接近单个文件耗时（而非 3 倍）

### 2.3 工具输入流式预览

**现状**: 前端等 LLM 输出完整 tool_use JSON 后才渲染工具卡片
**目标**: LLM 流式输出 input JSON 时，前端实时预览（如逐字显示命令）

**实现方案**:
- `llm-runtime-service.ts` 解析流式 SSE 中的 `content_block_start`（type=tool_use）事件
  - 立即通过 WebSocket 推送 `session:tool-started` 事件（含 toolName, id）
- 解析 `input_json_delta` 事件，累积 partial JSON
  - 每 200ms 或每 100 字符推送 `session:tool-input-chunk` 事件
- 前端 `ws-envelope-reducer.ts` 新增这两个事件的处理
  - `tool-started` → 创建 running 状态的 toolCall 占位
  - `tool-input-chunk` → 更新 toolCall 的 input 字段（partial）

**验证**: LLM 开始输出 Bash 命令时，前端立即显示 running 卡片 + 逐字显示命令

---

## Phase 3：Browser + WebSearch 后端实现（P2 — 能力扩展）

### 3.1 Browser 工具后端

**现状**: 前端有 BrowserExpanded 渲染，后端无 Browser 工具
**目标**: 实现 Puppeteer/Playwright 驱动的浏览器工具

**实现方案**:
- 新增 `packages/studio/src/api/lib/tools/BrowserTool.ts`
- 使用 `playwright` 包（Bun 兼容）
- 支持 actions: launch, click, fill, screenshot, get_text, evaluate, navigate, close
- 会话管理：`browser-session-registry.ts` 管理多个浏览器实例
- 截图返回 base64 PNG，前端 BrowserExpanded 已支持显示

**验证**: Agent 能打开网页、截图、填表单、提取文本

### 3.2 WebSearch 工具后端

**现状**: 前端有 WebSearchExpanded 渲染，后端无 WebSearch 工具
**目标**: 实现网页搜索能力

**实现方案**:
- 新增 `packages/studio/src/api/lib/tools/WebSearchTool.ts`
- 使用 SearXNG 本地实例或 Serper API
- 输入: `{ query: string, num_results?: number }`
- 输出: `{ results: Array<{ title, url, snippet }> }`

**验证**: Agent 搜索 "TypeScript 5.0 新特性" 返回真实搜索结果

### 3.3 WebFetch 工具后端

**现状**: 无
**目标**: 抓取网页内容（readability 模式提取正文）

**实现方案**:
- 新增 `packages/studio/src/api/lib/tools/WebFetchTool.ts`
- 使用 `@mozilla/readability` + `jsdom` 提取正文
- 支持 mode: readability（正文）/ dom（HTML）/ smart（AI 摘要）
- 输出截断到 MAX_TOOL_RESULT_CHARS

**验证**: 抓取一篇博客文章，返回干净的正文内容

---

## Phase 4：权限决策 UI + 计划模式（P2 — 安全性）

### 4.1 权限决策前端卡片

**现状**: `permission-pipeline.ts` 后端有权限检查，但前端无确认 UI
**目标**: 危险操作弹出确认卡片，用户 allow/deny

**实现方案**:
- 新增 WebSocket 事件 `session:permission-request`
  - 包含: `{ requestId, toolName, input, reason, riskLevel }`
- 前端新增 `PermissionRequestCard.tsx` 组件
  - 显示工具名 + 参数 + 风险说明
  - 两个按钮: "允许" / "拒绝"
- 用户点击后发送 `session:permission-decision` 事件
  - `{ requestId, decision: "allow" | "deny" }`
- 后端 `permission-pipeline.ts` 等待决策后继续/中止

**验证**: Agent 要执行 `rm -rf node_modules` 时，前端弹出确认卡片

### 4.2 计划模式（Plan Mode）

**现状**: 无
**目标**: Agent 进入只读探索模式，生成计划后等用户批准

**实现方案**:
- Session 新增 `mode: "normal" | "plan"` 状态
- Plan 模式下：
  - 只允许 Read/Glob/Grep/WebSearch（只读工具）
  - Write/Edit/Bash 被拦截，返回 "计划模式下不可执行写入操作"
- Agent 输出计划文本后，前端显示 "批准计划" / "修改" 按钮
- 用户批准后切换回 normal 模式，Agent 按计划执行

**验证**: 用户说 "帮我重构这个模块"，Agent 先输出计划，用户批准后才动代码

### 4.3 危险反思（Danger Reflection）

**现状**: BashTool 有简单的黑名单拦截
**目标**: 高风险操作前 AI 自我审查

**实现方案**:
- 定义高风险模式：`git push`、`rm -rf`、`DROP TABLE`、修改 .env 等
- 匹配到高风险时，不直接执行，而是：
  1. 用一个轻量 LLM 调用生成安全分析（"这个操作会做什么？有什么风险？"）
  2. 将分析结果展示给用户
  3. 用户确认后才执行
- 前端新增 `DangerReflectionCard.tsx`

**验证**: Agent 要 `git push --force` 时，先显示风险分析，用户确认后才推送

---

## 实施顺序

```
Phase 1 (1-2 天) → Phase 2 (1-2 天) → Phase 3 (2-3 天) → Phase 4 (2-3 天)
```

Phase 1 是最高优先级——Bash 实时流直接决定用户是否觉得"这个工具能用"。
