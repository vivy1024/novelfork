# Agent 运行时健壮性 + NarraFork 能力对齐 — 需求文档

## 背景

NovelFork 底层是通用 coding agent 工作台，小说功能是可插拔插件。当前与 NarraFork（v0.4.13）的核心差距在运行时健壮性——重试/恢复/超时/队列/并行/子代理生命周期。

本 spec 从 NarraFork 更新日志（v0.1.0 → v0.4.13）中提取 NovelFork 缺失的关键能力，按优先级分 Phase 实施。

---

## Phase 1：运行时稳定性（P0）

### 1.1 并行工具执行

**来源**: NarraFork v0.1.10
**现状**: NovelFork 工具串行执行（一个接一个）
**目标**: Read/Glob/Grep/WebSearch/WebFetch 在相互独立时并行运行

**实现方案**:
- `agent-turn-runtime.ts` 中，当 LLM 返回多个 tool_use 时，检测是否可并行（read-only 工具之间无依赖）
- 可并行的工具用 `Promise.all` 同时执行
- 写入类工具（Write/Edit/Bash）仍串行

### 1.2 上下文溢出自动恢复

**来源**: NarraFork v0.3.6
**现状**: 上下文溢出时 LLM 返回错误，Agent 停止
**目标**: 溢出后自动触发压缩 → 重试 generate

**实现方案**:
- `llm-runtime-service.ts` 中检测 `context_length_exceeded` 错误
- 触发 `maybeAutoCompact` 压缩消息
- 压缩成功后自动重试 generate（最多 1 次）

### 1.3 缓冲消息队列

**来源**: NarraFork v0.1.17
**现状**: 用户发消息时如果 Agent 正在工作，消息被丢弃或报错
**目标**: 消息排队，Agent 完成当前 turn 后自动消费下一条

**实现方案**:
- `session-chat-service.ts` 中维护 per-session 消息队列
- Agent 正在 working 时，新消息入队而非立即执行
- turn 完成后检查队列，有消息则自动开始下一轮
- 队列持久化到 SQLite（服务重启后恢复）

### 1.4 智能中断 + 重试恢复

**来源**: NarraFork v0.1.11, v0.3.8
**现状**: 只有手动中断，无自动超时重试
**目标**: 
- 首 token 超时后自动重试（已有配置，需完善重试逻辑）
- 瞬态 API 错误（429/502/503）自动指数退避重试
- 重试时保留已完成的工具结果

**实现方案**:
- `llm-runtime-service.ts` 中的 `generate` 方法加重试循环
- 区分可重试错误（rate-limit/server-error）和不可重试错误（auth/invalid-request）
- 使用 `recovery.maxRetryAttempts` + `recovery.maxRetryDelayMs` 配置

---

## Phase 2：工具执行增强（P1）

### 2.1 工具流式输入预览

**来源**: NarraFork v0.1.22
**现状**: 工具执行中前端只看到"调用 Bash..."，看不到输入内容
**目标**: Write/Edit/Bash/Grep 执行过程中实时渲染输入参数

**实现方案**:
- `agent-turn-runtime.ts` 在 emit `tool_call` 事件时，前端立即渲染 input 预览
- 前端 `ToolCallCard` 在 status=pending/running 时显示 input 内容（已有 input 字段）
- 需要确认 WebSocket 消息中 tool_call 是否包含完整 input

### 2.2 沉默工具调用提示（已实现，需验证）

**来源**: NarraFork v0.2.6
**现状**: 已在 agent-turn-runtime 中实现 silentToolCallThreshold
**目标**: 验证实际效果

### 2.3 工具执行超时

**来源**: NarraFork v0.1.11
**现状**: Bash 工具无超时，可能永远卡住
**目标**: Bash 工具可配置超时（默认 120s），超时后自动 kill

**实现方案**:
- `real-tool-handlers.ts` 中 Bash spawn 加 timeout
- 超时后返回已有输出 + 超时提示

---

## Phase 3：子代理生命周期（P1）

### 3.1 子代理 Detach/Attach

**来源**: NarraFork v0.2.0
**现状**: 子代理是一次性执行，完成后消失
**目标**: 前台子代理可转入后台，之后可重新附加到前台

**实现方案**:
- 后台子代理已有（`backgroundAgents` Map）
- 需要加 `detach`（前台→后台）和 `attach`（后台→前台）操作
- 前端 SubagentCard 加"转入后台"按钮

### 3.2 后台任务持久化

**来源**: NarraFork v0.2.6
**现状**: 后台任务在内存 Map 中，重启丢失
**目标**: 后台任务状态持久化到 SQLite

**实现方案**:
- 创建 `background_tasks` 表（id/type/status/sessionId/result/createdAt）
- 任务完成/失败时写入
- 启动时恢复未完成任务的状态（标记为 interrupted）

### 3.3 子代理工具继承

**来源**: NarraFork v0.2.0
**现状**: 子代理有通用工具但不继承父 session 的 MCP 工具
**目标**: 子代理按权限级别继承 MCP 工具

---

## Phase 4：安全与权限（P1）

### 4.1 YOLO 安全反思完善

**来源**: NarraFork v0.3.1, v0.4.0
**现状**: dangerReflection 只是强制确认，没有 LLM 反思
**目标**: 高风险操作前让 LLM 自我反思"这个操作安全吗"

**实现方案**:
- 在 destructive 工具确认前，调用摘要模型做安全评估
- 评估结果附在确认卡片中供用户参考
- 用户可选择"信任反思结果自动批准"

### 4.2 命令白/黑名单实际执行

**来源**: NarraFork v0.1.18
**现状**: 配置能存但 Bash 工具执行时不检查
**目标**: Bash 执行前检查命令是否在白/黑名单中

**实现方案**:
- `real-tool-handlers.ts` 中 Bash handler 执行前解析命令
- 检查 `toolAccess.commandAllowlist/commandBlocklist`
- 黑名单命令直接拒绝，非白名单命令需确认

### 4.3 目录访问控制实际执行

**来源**: NarraFork v0.1.18
**现状**: 配置能存但 Read/Write 工具不检查路径
**目标**: 文件操作前检查路径是否在允许/禁止目录内

---

## Phase 5：性能与体验（P2）

### 5.1 消息多选批量操作

**来源**: NarraFork v0.1.3
**目标**: Ctrl+Click 多选消息 + 批量复制/删除/分叉

### 5.2 文件修改面板

**来源**: NarraFork v0.1.0
**目标**: 查看 Agent 修改了哪些文件 + diff 预览 + 单文件恢复

### 5.3 增量更新

**来源**: NarraFork v0.1.0
**目标**: zstd patch-from 增量更新，更新包缩小 99%

### 5.4 模型聚合

**来源**: NarraFork v0.1.22
**目标**: 多供应商同模型聚合为虚拟条目 + 自动路由/故障切换

### 5.5 IM 网关

**来源**: NarraFork v0.1.21
**目标**: Telegram/Discord/微信等 IM 平台接入叙述者

### 5.6 SWE-bench 评测

**来源**: NarraFork v0.2.1
**目标**: 支持 HumanEval/SWE-bench 评测，验证 Agent 代码能力

---

## Phase 6：前端渲染优化（P2）

### 6.1 流式输出块按时间顺序

**来源**: NarraFork v0.1.9
**目标**: 推理/搜索/文本块按实际到达顺序显示

### 6.2 消息渲染性能

**来源**: NarraFork v0.1.4, v0.1.16
**目标**: memo 化高频组件、懒加载重型面板、RAF 批量更新

### 6.3 WebSocket 重连与同步

**来源**: NarraFork v0.1.4, v0.1.17
**目标**: 标签页隐藏后自动重连、轻量同步检查、增量补拉

---

## 实施顺序

```
Phase 1 — 运行时稳定性（最高优先级，影响基本可用性）
  1.1 并行工具执行
  1.2 上下文溢出自动恢复
  1.3 缓冲消息队列
  1.4 智能重试恢复

Phase 2 — 工具执行增强
  2.1 工具流式输入预览
  2.3 Bash 工具超时

Phase 3 — 子代理生命周期
  3.1 Detach/Attach
  3.2 后台任务持久化
  3.3 MCP 工具继承

Phase 4 — 安全与权限
  4.1 YOLO 安全反思
  4.2 命令白/黑名单执行
  4.3 目录访问控制执行

Phase 5 — 性能与体验
  5.1 消息多选
  5.2 文件修改面板
  5.3 增量更新
  5.4 模型聚合
  5.5 IM 网关
  5.6 SWE-bench

Phase 6 — 前端渲染优化
  6.1 流式顺序
  6.2 渲染性能
  6.3 WebSocket 重连
```

---

## 约束

- Phase 1 是阻塞项，不做则 Agent 长时间工作不稳定
- Phase 2-4 可并行推进
- Phase 5-6 是锦上添花，按需做
- 每个功能独立可验证，不互相依赖
- 不引入新的外部依赖（除非必要如 zstd）
- 保持小说插件可插拔架构不变

---

## 验证标准

- Phase 1：Agent 能连续执行 20+ 工具调用不崩溃，溢出自动恢复，消息排队正常
- Phase 2：Bash 超时后正确返回，工具输入实时可见
- Phase 3：子代理可转后台再恢复，重启后状态不丢
- Phase 4：危险命令被拦截，黑名单目录不可访问
- Phase 5：文件修改可追踪，更新包 < 5MB
- Phase 6：100 条消息的对话页面不卡顿
