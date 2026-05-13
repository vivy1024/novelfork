# 对话体验对齐 Claude Code — 需求文档

## 背景

对比本地 Claude Code（NarraFork）的对话交互，NovelFork 在核心对话体验上仍有 5 个高优先级差距和 5 个中优先级差距。本 spec 聚焦"让对话体验达到 Claude Code 水平"。

---

## Phase 1：Composer 交互完善（P0）

### 1.1 重试按钮

**现状**: Agent 失败后用户只能手动重新输入或发"继续"
**目标**: 失败后 Composer 显示"重试"按钮，点击重发上一条用户消息

**实现方案**:
- `Composer.tsx` 中添加第 5 种按钮状态：idle + 无输入 + 上次失败 → 重试按钮
- 需要从 ConversationSurface 传入 `lastTurnFailed: boolean` prop
- 点击重试时调用 `onSend(lastUserMessage)` 重发上一条用户消息
- 按钮样式：橙色，带 ↻ 图标，文字"重试"

### 1.2 中断长按确认

**现状**: 中断按钮单击即触发，容易误触
**目标**: 对标 NarraFork 的 hold-to-confirm 模式——按住 1 秒才触发中断，有进度条动画

**实现方案**:
- 创建 `HoldToConfirmButton` 组件
- `onMouseDown` 开始计时 + 进度条动画（CSS transition width 0→100% over 1s）
- `onMouseUp` 在 1s 内释放则取消
- 超过 1s 自动触发 `onAbort()`
- 进度条颜色：红色渐变
- 替换 Composer 中现有的中断按钮

---

## Phase 2：工具执行可见性（P0）

### 2.1 tool_long_running 通知

**现状**: 工具执行超过 10s 时前端无任何提示
**目标**: 超过 10s 的工具调用在卡片上显示"仍在执行中..."旋转动画

**实现方案**:
- 后端：`agent-turn-runtime.ts` 中工具执行开始时记录时间，超过 10s 时通过 `onEvent` 广播一个特殊事件
- 前端：ToolCallCard 在 status="running" 时启动本地计时器，超过 10s 显示 spinner + "执行中..."
- 更简单的方案：纯前端实现——ToolCallCard 收到 tool_call 事件后开始计时，未收到 tool_result 前超过 10s 显示提示

### 2.2 Bash 实时输出流

**现状**: Bash 命令执行完成后才返回全部输出
**目标**: 长命令（如 npm install、编译）执行中实时流式显示 stdout

**实现方案**:
- `real-tool-handlers.ts` 中 `executeBashTool` 改为流式模式：
  - spawn 后立即返回一个"running"状态的 tool_result
  - stdout/stderr 通过 WebSocket 实时推送到前端
  - 完成后更新 tool_result 为最终状态
- 这需要修改工具执行的异步模型——当前是 await 完成后才返回
- **简化方案**：不改架构，只在前端 ToolCallCard 中对 Bash 工具显示"执行中..."动画，完成后显示输出

---

## Phase 3：权限体验优化（P1）

### 3.1 "始终允许此类操作"选项

**现状**: 每次相同类型的操作都弹确认门
**目标**: 确认门卡片添加"始终允许"选项，批准后同类操作本次会话内自动放行

**实现方案**:
- 确认门卡片 UI 添加第三个按钮："始终允许此类"
- 点击后：
  1. 批准当前操作
  2. 提取命令模式（如 `git *`、`npm *`、`Read src/*`）
  3. 将模式加入 session 级 `toolPolicy.allow` 列表
  4. 后续匹配的操作自动放行
- 模式提取规则：
  - Bash：取命令第一个 token + `*`（如 `git status` → `git *`）
  - Read/Write/Edit：取目录 + `*`（如 `src/api/foo.ts` → `src/api/*`）

### 3.2 计划反思可见反馈

**现状**: ExitPlanMode 的计划反思在后台执行，用户不知道
**目标**: 计划反思执行时状态栏显示"计划审核中..."

**实现方案**:
- 添加 `substatus: "plan_reflecting"` 到 NarratorSubstatus
- ExitPlanMode 工具执行时广播此状态
- 状态栏显示"计划审核中..."（绿色圆点）

---

## Phase 4：工具卡片增强（P1）

### 4.1 上下文占用显示

**现状**: 工具卡片只显示耗时，不显示该工具结果占用了多少上下文
**目标**: 显示 "881ms / 2k tok"（耗时 / token 占用估算）

**实现方案**:
- tool_result 消息中已有 `summary` 字段，可以估算 token 数（chars / 4）
- ToolCallCard 在耗时旁边显示估算的 token 占用
- 格式：`7ms / 0.5k` 或 `2.3s / 4.2k`

### 4.2 语法高亮

**现状**: Read 工具展开后有 `language-typescript` class 但无实际高亮
**目标**: 代码块有基础语法高亮

**实现方案**:
- 安装 `highlight.js`（轻量，支持按需加载语言）
- 在 ToolCallCard 展开的代码块中应用高亮
- 只高亮常见语言：TypeScript/JavaScript/Python/JSON/YAML/Markdown
- 懒加载：只在展开时加载高亮库

---

## Phase 5：子代理可见性（P2）

### 5.1 子代理嵌套渲染

**现状**: 子代理结果只在最终消息中显示
**目标**: 子代理执行时在对话中显示独立的嵌套面板

**实现方案**:
- 当 Agent 工具被调用时，在对话流中插入一个可折叠的"子代理面板"
- 面板内显示子代理的工具调用链（简化版，只显示工具名+状态）
- 子代理完成后显示结论摘要
- 使用已有的 SubagentRegistry 数据

### 5.2 Git 分支 + 变更数显示

**现状**: 对话界面无 Git 信息
**目标**: 状态栏或底部显示当前 Git 分支名 + 未提交变更数

**实现方案**:
- 后端：session 关联 worktree 时，定期（每 30s）执行 `git branch --show-current` + `git status --short | wc -l`
- 前端：状态栏底部显示 `main · 3 changes`（monospace 字体 + Badge）
- 点击可展开 Git 面板（已有 GitPanel 组件）

---

## 实施顺序

```
Phase 1 — Composer 交互（P0，直接影响每次对话）
  1.1 重试按钮
  1.2 中断长按确认

Phase 2 — 工具执行可见性（P0）
  2.1 tool_long_running 通知（纯前端计时器）
  2.2 Bash 实时输出流（简化版：执行中动画）

Phase 3 — 权限体验（P1）
  3.1 "始终允许此类操作"
  3.2 计划反思可见反馈

Phase 4 — 工具卡片增强（P1）
  4.1 上下文占用显示
  4.2 语法高亮

Phase 5 — 子代理可见性（P2）
  5.1 子代理嵌套渲染
  5.2 Git 分支 + 变更数
```

---

## 验证标准

- Phase 1：重试按钮在失败后出现且能重发；中断需长按 1s 才触发
- Phase 2：Bash 执行 `sleep 15` 时 10s 后卡片显示"仍在执行中..."
- Phase 3：批准 `git status` 后 `git log` 不再弹确认
- Phase 4：工具卡片显示 token 估算；代码块有颜色
- Phase 5：子代理执行时有独立面板；状态栏显示 Git 分支
