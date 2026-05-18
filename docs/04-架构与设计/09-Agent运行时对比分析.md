# Agent 运行时对比分析

**版本**: v1.0.0
**状态**: ✅ 当前有效

本文对比四个 Agent 运行时系统的架构设计：NovelFork（本项目）、Claude Code（Anthropic CLI）、Codex CLI（OpenAI）、NarraFork（上游参考）。通过分析实际源码，提炼各系统在 Agent 循环、工具系统、上下文管理、流式输出、权限控制、子代理、错误恢复等维度的设计差异。

---

## 总览对比表

| 维度 | NovelFork | Claude Code | Codex CLI | NarraFork |
|------|-----------|-------------|-----------|-----------|
| **语言** | TypeScript (Bun) | TypeScript (Node) | Rust + TypeScript | TypeScript (Node) |
| **运行环境** | 本地 Web 服务器 | 终端 CLI | 终端 CLI | 云端 Web 服务 |
| **Agent 循环** | generate → tool_use → execute → loop | query → tool_use → execute → loop | sandbox exec → tool → loop | generate → tool → permission → loop |
| **最大步数** | 可配置（默认 30） | 无硬限制（靠 token 预算） | 沙箱超时限制 | 无硬限制 |
| **工具系统** | SessionToolDefinition + executor | Tool interface + hooks | 沙箱内 shell + file ops | tool_started/completed 状态机 |
| **上下文管理** | 紧急截断 + 自动压缩 | 自动压缩 + 文件状态缓存 | 固定窗口 | catch_up + full_reload |
| **流式输出** | SSE chunk → WebSocket 广播 | Ink 终端渲染 | 终端流式 | WebSocket text_delta/reasoning_delta |
| **权限模式** | permissionMode (auto/confirm/deny) | PermissionMode (auto/ask/deny) | 沙箱隔离（无需权限） | permission_request → decision |
| **子代理** | Subagent 系统（explore/plan/general/fork，支持后台执行） | AgentTool（嵌套 QueryEngine） | 无 | subagent_started/suspended/conclusion |
| **错误恢复** | 上下文溢出截断 + 连续失败检测 + 供应商 fallback | 可重试 API 错误 + 用户干预 | 沙箱重启 | danger_reflection + plan_reflection |

---

## 详细对比

### 1. Agent 循环

#### NovelFork — `agent-turn-runtime.ts`

```
┌─────────────────────────────────────────┐
│  runAgentTurn(input)                     │
│  ┌─────────────────────────────────────┐ │
│  │ for (;;) {                          │ │
│  │   reply = generate(messages, tools) │ │
│  │   if reply.type === "message"       │ │
│  │     → emit assistant_message        │ │
│  │     → return                        │ │
│  │   if reply.type === "tool_use"      │ │
│  │     → 并行/串行执行工具             │ │
│  │     → 追加 tool_result 到 messages  │ │
│  │     → continue loop                 │ │
│  │ }                                   │ │
│  └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

特点：
- 只读工具（Read/Glob/Grep/WebSearch）自动并行执行
- 重复工具调用拦截（signature 去重）
- 静默工具调用阈值（连续 N 次无文本输出时注入提示）
- 工具结果截断（30K 字符上限，保留头尾）

#### Claude Code — `QueryEngine.ts`

```
┌─────────────────────────────────────────┐
│  processQuery(messages)                  │
│  ┌─────────────────────────────────────┐ │
│  │ systemPrompt = fetchSystemPromptParts│ │
│  │ loop:                               │ │
│  │   response = api.createMessage()    │ │
│  │   for block in response.content:    │ │
│  │     if text → append to output      │ │
│  │     if tool_use → check permission  │ │
│  │       → execute tool                │ │
│  │       → append tool_result          │ │
│  │   if stop_reason === "end_turn"     │ │
│  │     → return                        │ │
│  │   → continue loop                  │ │
│  └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

特点：
- 直接调用 Anthropic SDK（Messages API）
- 工具权限检查在执行前（canUseTool hook）
- 文件状态缓存（FileStateCache）追踪已读文件
- 支持 thinking/extended thinking 模式
- 会话持久化到本地文件

#### Codex CLI — Rust 核心

```
┌─────────────────────────────────────────┐
│  codex-rs/core                           │
│  ┌─────────────────────────────────────┐ │
│  │ 1. 用户输入 → 构建 prompt           │ │
│  │ 2. 调用 OpenAI API                  │ │
│  │ 3. 解析 function_call               │ │
│  │ 4. 在沙箱中执行命令                  │ │
│  │    (landlock/seatbelt 隔离)          │ │
│  │ 5. 收集输出 → 追加到上下文           │ │
│  │ 6. 循环直到模型输出文本              │ │
│  └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

特点：
- Rust 实现核心循环（性能优先）
- 操作系统级沙箱隔离（Linux landlock / macOS seatbelt）
- 网络默认禁用（除非显式允许）
- 工具集极简：shell + file read/write

#### NarraFork — WebSocket 事件驱动

```
┌─────────────────────────────────────────┐
│  Server-side Agent Loop                  │
│  ┌─────────────────────────────────────┐ │
│  │ 1. 接收 user_message                │ │
│  │ 2. status_change → "working"        │ │
│  │ 3. stream_event (text_delta)        │ │
│  │ 4. tool_started → permission check  │ │
│  │    → tool_use_chunk (流式输入)      │ │
│  │    → tool_completed                 │ │
│  │ 5. 循环直到 message 事件            │ │
│  │ 6. status_change → "idle"           │ │
│  └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

特点：
- 完整的工具生命周期状态机（started → chunk → completed）
- 子代理嵌套渲染
- 危险反思 + 计划反思机制
- 上下文使用率实时推送

---

### 2. 工具系统

| 特性 | NovelFork | Claude Code | Codex CLI | NarraFork |
|------|-----------|-------------|-----------|-----------|
| 工具定义 | `SessionToolDefinition` (JSON Schema) | `Tool` interface (Zod schema) | 内置 shell + file | 服务端定义 |
| 工具数量 | ~20 (Read/Write/Edit/Glob/Grep/Bash/Browser/...) | ~15 (类似) | 2 (shell + file) | ~20 |
| 并行执行 | 只读工具自动并行 | 无（串行） | 无 | 无 |
| 工具策略 | toolPolicy.deny 黑名单 | permissionMode 分级 | 沙箱白名单 | permission_request |
| 工具流式 | tool-input-chunk + tool-stream | 无 | 无 | tool_use_chunk + tool_output |
| 确认机制 | confirmation_required 事件 | canUseTool hook | 沙箱隔离替代 | permission_request/resolved |

---

### 3. 上下文管理

| 特性 | NovelFork | Claude Code | Codex CLI | NarraFork |
|------|-----------|-------------|-----------|-----------|
| 压缩策略 | 自动压缩 (maybeAutoCompact) | 自动压缩 (context compaction) | 固定窗口截断 | 服务端管理 |
| 溢出恢复 | 紧急截断（保留 1/3）+ 重试 | 用户可见的压缩通知 | 无（窗口固定） | full_reload 事件 |
| 系统提示 | systemPrompt + context + canvasContext | systemPrompt + CLAUDE.md + memory | 简短系统提示 | 服务端注入 |
| 工具结果 | 截断 30K + 头尾保留 | 完整保留 | 截断 | 服务端截断 |
| 消息序列号 | seq + ackedSeq + 恢复元数据 | 无（文件持久化） | 无 | catch_up + resumeFromSeq |
| 书籍上下文 | 经纬注入 + 画布上下文 + 项目探索 | 文件状态缓存 + 项目 onboarding | 无 | 无 |

---

### 4. 流式输出

| 特性 | NovelFork | Claude Code | Codex CLI | NarraFork |
|------|-----------|-------------|-----------|-----------|
| 传输协议 | WebSocket (Bun native) | 终端直接输出 (Ink) | 终端直接输出 | WebSocket |
| 文本流 | onStreamChunk → broadcastStreamChunk | 逐 token 渲染 | 逐 token 渲染 | stream_event (text_delta) |
| 推理流 | reasoning_chunk 事件 | thinking block 渲染 | 无 | stream_event (reasoning_delta) |
| 工具输入流 | tool-input-chunk 事件 | 无 | 无 | tool_use_chunk |
| 工具输出流 | tool-stream 事件 | 无 | 无 | tool_output |
| 状态推送 | session:state (working/idle/retrying) | Spinner 组件 | 终端 spinner | status_change + substatus_change |

---

### 5. 权限控制

| 特性 | NovelFork | Claude Code | Codex CLI | NarraFork |
|------|-----------|-------------|-----------|-----------|
| 模式 | auto / confirm-destructive / confirm-all | auto-edit / plan / manual | 沙箱隔离 | 逐工具审批 |
| 粒度 | 工具级 (toolPolicy.deny) | 工具 + 路径级 | OS 级 (文件系统/网络) | 工具 + 参数级 |
| 决策流 | confirmation_required → 用户决策 → 继续 | canUseTool → ask → approve/deny | 无需（沙箱保证安全） | permission_request → decision |
| 危险检测 | 无（依赖工具策略） | 无（依赖权限模式） | 无（沙箱隔离） | danger_reflection 机制 |
| 持久化 | 无 | 会话级记忆 | 无 | 服务端记录 |

---

### 6. 子代理

| 特性 | NovelFork | Claude Code | Codex CLI | NarraFork |
|------|-----------|-------------|-----------|-----------|
| 支持 | Subagent 系统（explore/plan/general/fork） | AgentTool（完整嵌套） | 无 | 完整子代理系统 |
| 实现 | 独立 Agent 循环 + 后台执行 + 自动后台化 | 新 QueryEngine 实例 + 独立上下文 | — | subagent_started/suspended/conclusion |
| 通信 | 父子消息传递 + 结论回传 | 父子消息传递 | — | WebSocket 事件 |
| 渲染 | 嵌套 UI 面板 | 嵌套 Ink 组件 | — | 嵌套 UI 面板 |
| 上下文隔离 | 独立消息历史 + 共享文件系统 | 独立消息历史 + 共享文件系统 | — | 独立状态追踪 |

---

### 7. 错误恢复

| 特性 | NovelFork | Claude Code | Codex CLI | NarraFork |
|------|-----------|-------------|-----------|-----------|
| API 重试 | 指数退避 (429/502/503) + jitter | 分类重试 (categorizeRetryableAPIError) | 简单重试 | 服务端重试 |
| 供应商 fallback | 同模型多供应商自动切换 | 无（单供应商） | 无（单供应商） | 无 |
| 上下文溢出 | 紧急截断 + 重试（1 次） | 自动压缩 | 窗口截断 | full_reload |
| 连续失败 | 2 次警告 / 3 次停止 | 用户干预 | 沙箱重启 | danger_reflection |
| 工具异常 | try-catch → 错误摘要注入 | 错误消息返回模型 | 沙箱隔离 | tool_completed(error) |
| 超时 | firstTokenTimeout (可配置) | 无 | 沙箱超时 | 无 |
| 中断 | AbortSignal + session:abort | Ctrl+C | Ctrl+C | interruptNarrator API |

---

## 架构决策对比

### NovelFork 的独特设计

1. **并行工具执行**：识别只读工具批次，自动 Promise.all 并行执行，减少 Agent 循环延迟
2. **重复调用拦截**：基于 toolName + stableJson(input) 签名去重，避免模型重复读取同一文件
3. **画布上下文注入**：将用户当前编辑的资源信息注入 system prompt，实现 Agent-native 感知
4. **经纬上下文管线**：buildJingweiLegacyContext → 可见性过滤 → 别名匹配 → 嵌套解析 → token 预算裁剪
5. **消息队列**：WebSocket 消息缓冲，避免并发请求冲突
6. **Subagent 系统**：explore/plan/general/fork 四种子代理，支持后台执行和自动后台化
7. **Prompt Cache**：Anthropic API cache_control 启用，减少重复 token 费用
8. **ToolSearch**：动态发现非核心工具，减少全量注入
9. **CLAUDE.md 读取**：自动读取项目规则文件注入 agent 上下文
10. **LLM 压缩摘要**：调用摘要模型生成对话摘要（非文本拼接）

### Claude Code 的独特设计

1. **文件状态缓存**：追踪已读文件的 hash，避免重复读取未变更文件
2. **Memory 系统**：CLAUDE.md + 项目 onboarding + memdir 持久化
3. **AgentTool 嵌套**：完整的子代理系统，独立上下文 + 父子通信
4. **Skill 系统**：可扩展的技能插件（slash commands）

### Codex CLI 的独特设计

1. **OS 级沙箱**：用操作系统安全机制替代应用层权限检查
2. **Rust 核心**：性能关键路径用 Rust 实现
3. **极简工具集**：只有 shell 和 file 操作，依赖模型自主组合

### NarraFork 的独特设计

1. **完整工具状态机**：started → chunk → completed，前端可精确追踪每个工具的生命周期
2. **危险反思**：模型自我审查危险操作，独立于权限系统
3. **子代理 UI**：嵌套渲染子代理的输出和状态
4. **流式输入**：工具参数也流式传输（tool_use_chunk），用户可提前看到工具将要做什么
