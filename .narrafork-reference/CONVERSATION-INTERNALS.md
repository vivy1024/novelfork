# NarraFork 对话实时交互机制学习笔记

> 来源：`.narrafork-reference/chunks/useNarratorWS.js`、`useNarrator.js`、`NarratorPanel.js` 深度分析
> 日期：2026-05-10

---

## 核心架构差异

| 维度 | NarraFork | NovelFork 当前 |
|------|-----------|---------------|
| 流式渲染 | useRef + requestAnimationFrame 批量 | 一次性渲染完整消息 |
| 工具状态 | tool_started → chunk → completed 完整状态机 | 从历史消息一次性加载 |
| 中断 | HTTP POST `api.interruptNarrator(id)` | onAbort prop 未暴露 |
| Composer | 5 种按钮（发送/中断/队列/继续/重试） | 只有"发送" |
| 权限决策 | WebSocket `permission_decision` 消息 | HTTP POST confirmTool |
| 子代理 | 嵌套渲染 + 独立状态追踪 | 无 |

---

## WebSocket 事件类型（完整）

### 消息事件
- `message` — 助手消息到达
- `user_message` — 用户消息确认
- `stream_event` — 流式 delta（text_delta / reasoning_delta）
- `catch_up` — 重连补发
- `full_reload` — 完全重新加载

### 工具调用生命周期
- `tool_started` — 工具开始（toolUseId, toolName, input, parentToolUseId）
- `tool_use_chunk` — 工具输入流式到达（inputCharsTotal, extractedFilePath）
- `tool_completed` — 工具完成（status, output, durationMs）
- `tool_long_running` — 长时间运行通知
- `tool_output` — 实时输出流

### 权限系统
- `permission_request` — 请求授权
- `permission_resolved` — 权限决策已解决
- `danger_reflection_started/resolved/stopped` — 危险反思
- `plan_reflection_started/resolved/stopped` — 计划反思

### 状态
- `status_change` — 状态变更（idle/working/waiting）
- `substatus_change` — 子状态（reasoning/suspended/compacting）
- `context_usage` — 上下文使用率

### 子代理
- `subagent_started` — 子代理启动
- `subagent_suspended` — 子代理挂起
- `subagent_conclusion_updated` — 子代理结论

---

## 流式 Delta 处理

```
关键设计：
1. 流式块存储在 useRef 中（不触发 React 重渲染）
2. 使用 requestAnimationFrame 批量合并渲染
3. 支持多 outputIndex（并行输出块）
4. 助手消息最终到达时清空流式块

伪代码：
onStreamEvent(event):
  if event.type != "content_block_delta": return
  if event.subagentToolUseId: return  // 子代理不在主面板处理
  
  switch event.delta.type:
    "text_delta":
      追加到对应 outputIndex 的文本块
      scheduleRender()  // requestAnimationFrame
    "reasoning_delta":
      追加到对应 id 的推理块
      scheduleRender()
```

---

## 工具调用状态机

```
(新建) ──tool_started──► running ──tool_completed(ok)──► success
                            │
                            ├──tool_completed(err)──► fail
                            │
                            ├──permission_request──► pending
                            │                          │
                            │                    allow ──► running
                            │                    deny  ──► fail
                            │
                            └──danger_reflection──► pending(reflection)
                                                      │
                                                allow ──► running
                                                deny  ──► fail
```

---

## Composer 按钮状态

```
优先级从高到低：
1. 编辑模式 → EditSubmitButton
2. 正在工作 + 无输入 → InterruptButton（长按确认，红色）
3. 空闲 + 无输入 + 上次可重试 → RetryButton
4. 空闲 + 无输入 + 可继续 → ContinueButton
5. 正在工作 + 有输入 → QueueButton（排队发送）
6. 默认 → SendButton
```

中断按钮使用**长按确认**模式（hold-to-confirm），有进度条动画，防止误触。

---

## 中断实现

```
// HTTP POST，不是 WebSocket
interruptMutation = useMutation({
  mutationFn: (narratorId) => api.interruptNarrator(narratorId)
})

// 服务端处理后通过 WebSocket 推送 status_change
```

---

## 权限决策

```
// 通过 WebSocket 发送
ws.send({
  type: "permission_decision",
  requestId,
  decision: "allow" | "deny",
  message,      // 用户附加消息
  answers,      // AskUserQuestion 的回答
  feedbackText, // 反馈
})
```

---

## NovelFork 改造计划

### 第一步：流式渲染
1. `ws-envelope-reducer.ts` 添加 `assistant_delta` / `tool_started` / `tool_completed` 事件处理
2. `useAgentConversationRuntime` 用 useRef 存储流式块
3. `MessageItem` 检测 `isStreaming` 时使用 AnimatedMarkdown

### 第二步：Composer 改造
1. 添加 isRunning 时的"中断"按钮
2. 中断通过 HTTP POST `/api/sessions/:id/interrupt`
3. 空闲时根据上下文显示"继续"或"发送"

### 第三步：工具调用动态渲染
1. 工具调用从 `tool_started` 事件开始渲染（running 状态）
2. `tool_completed` 时更新为 success/fail
3. 新工具出现时自动滚动

### 第四步：NarratorStatusBar 条件渲染
1. 根据当前 provider 的 apiMode 决定显示哪些控件
2. Codex → 推理强度 + Fast Mode
3. Anthropic → 思考强度
4. 其他 → 只有模型 + 权限

### 第五步：权限模式生效
1. 切换权限后 PUT session 更新 sessionConfig
2. 下次 Agent turn 读取最新 toolPolicy
