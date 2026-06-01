# 浏览器验证问题清单与修复计划

> 日期：2026-05-10
> 来源：v0.1.0 编译产物实际打开后的用户反馈（两轮）

---

## 已修复

| # | 问题 | 修复 |
|---|------|------|
| 1 | Anthropic 硬编码 3 个模型 | 改为调用 `/v1/models` API |
| 2 | 虚拟滚动不工作 | 加 `flex flex-col` |
| 3 | 欢迎弹窗不显示 | CSS 优先级 + 条件判断 |
| 4 | 供应商无法删除 | 卡片+详情页都加删除按钮 |
| 5 | 模型库存无意义 | 移除 |
| 6 | 添加供应商流程 | 简化为名称+格式即可创建 |
| 7 | 归档无确认 | 加 confirm() |
| 8 | Dialog 编译失败 | @base-ui → @radix-ui |
| 9 | MessageItem 用旧组件 | 改用 ToolCallCard |
| 10 | 欢迎弹窗重复弹出 | 有数据时不弹 |

---

## 待修复 — 用户初始试验发现的问题

### 供应商系统

| # | 问题 | 详细描述 |
|---|------|---------|
| 11 | Anthropic 刷新不出模型 | 选择 anthropic 兼容后刷新模型列表为空或仍是硬编码的 3 个 |
| 12 | Sub2API Anthropic 格式不兼容 | Sub2API 的 Anthropic 端点需要 Anthropic 原生 response 格式，选择 openai 兼容能刷新但无法调用 |
| 13 | 供应商详情才有删除 | 不方便，应在卡片上直接删除（已修复加了卡片删除按钮） |
| 14 | 添加供应商先填完才跳详情 | 应该点击添加直接进详情编辑（已简化为只需名称+格式） |

### 对话界面核心问题（与 NarraFork 差距甚远）

| # | 问题 | NarraFork 做法 | 当前状态 |
|---|------|---------------|---------|
| 15 | 仍是旧有渲染 | 工具调用一个一个滑入，running 状态实时更新 | 某些路径仍渲染旧 ToolCallBlock |
| 16 | 无流式显示 | AI 回复逐字/逐块流入，有打字机效果 | 一次性渲染完整回复 |
| 17 | 工具无动态展示 | 工具一个一个出现，pending→running→success 动画 | 全部一次性渲染 |
| 18 | 工具卡片堆叠无用功能 | 只有展开/折叠 | "查看源码/原始载荷/展开结果细节"三个重复按钮（旧 ToolCallBlock） |
| 19 | 无暂停/中断按钮 | Composer 在 working 时显示"中断"（长按确认） | 只有"发送" |
| 20 | 推理强度不应对所有供应商显示 | 只有 Codex apiMode 才有推理强度 | 所有供应商都显示 |
| 21 | Fast Mode 不应对所有供应商显示 | 只有 Codex apiMode 才有 Fast Mode | 所有供应商都显示 |
| 22 | 缺少思考强度 | Anthropic/Anthropic 兼容才有 thinking budget | 无 |
| 23 | 权限管理无效 | 切换后 PUT session → 下次 turn 使用新 policy | 点了全部允许也无法工作 |
| 24 | 无叙述者类型选择 | 创建时选择：独立 / 绑定项目 / 绑定章节 | 无 |
| 25 | 无工作目录绑定 | 叙述者可绑定 worktree 路径 | 无 |
| 26 | 无叙事线绑定 | 叙述者可关联叙事线/项目 | 无 |

---

## 系统性改造方案（基于 NarraFork 源码学习）

### 第一步：流式渲染（P0）

```
当前数据流：
WebSocket → ws-envelope-reducer → messages state → MessageStream → MessageItem

NarraFork 做法：
1. 流式块存储在 useRef 中（不触发 React 重渲染）
2. 使用 requestAnimationFrame 批量合并渲染
3. 支持多 outputIndex（并行输出块）
4. 助手消息最终到达时清空流式块

改造：
1. ws-envelope-reducer 添加 stream_event / tool_started / tool_completed 处理
2. useAgentConversationRuntime 用 useRef 存储流式块
3. MessageItem 检测 isStreaming 时使用 AnimatedMarkdown（已有 flowtoken）
4. 新工具/消息出现时自动滚动到底部
```

### 第二步：Composer 改造（P0）

```
NarraFork Composer 5 种按钮状态：
1. 发送（默认）
2. 中断（working + 无输入，长按确认，红色）
3. 队列（working + 有输入）
4. 继续（idle + 上次被中断）
5. 重试（idle + 上次有错误）

改造：
1. isRunning 时显示"中断"按钮
2. 中断通过 HTTP POST /api/sessions/:id/interrupt
3. 空闲时根据上下文显示"继续"或"发送"
```

### 第三步：工具调用动态渲染（P0）

```
NarraFork 工具调用状态机：
tool_started → running（显示 Loader）
tool_use_chunk → 流式输入更新
tool_completed(ok) → success（显示 ✓ + 耗时）
tool_completed(err) → fail（显示 ✗ + 错误）
permission_request → pending（显示权限面板）

改造：
1. 工具调用从 tool_started 事件开始渲染（running 状态 + Loader）
2. tool_completed 时更新为 success/fail
3. 彻底删除旧 ToolCallBlock 组件
```

### 第四步：NarratorStatusBar 条件渲染（P1）

```
根据当前 provider 的 apiMode/compatibility 决定显示哪些控件：
- apiMode === "codex" → 推理强度 + Fast Mode
- compatibility === "anthropic-compatible" → 思考强度
- 其他 → 只有模型切换 + 权限模式
```

### 第五步：权限模式生效（P1）

```
当前问题：切换权限后没有真正影响 Agent turn
修复：
1. 切换权限 → PUT /api/sessions/:id → 更新 sessionConfig.permissionMode
2. 下次 Agent turn 读取最新 sessionConfig → resolveSessionToolPolicy 使用新 mode
3. 确认 resolveSessionToolPolicy 正确处理 "allow-all" 模式
```

### 第六步：叙述者管理（P2）

```
创建叙述者时选择：
- 独立叙述者（无绑定）
- 绑定项目/书籍
- 绑定工作目录

后端已有 session 的 projectId / worktree 字段，前端需要创建 UI。
```

---

## NarraFork 关键实现参考

详见 `.narrafork-reference/CONVERSATION-INTERNALS.md`：
- 完整 WebSocket 事件类型列表（50+ 种）
- 流式 delta 处理伪代码
- 工具调用状态机
- Composer 按钮状态逻辑
- 中断/权限决策发送方式
