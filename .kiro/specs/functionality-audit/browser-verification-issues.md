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

## 待修复 — 对话界面系统性改造

### P0 — 对话核心交互（与 NarraFork 差距最大）

| # | 问题 | NarraFork 做法 | 当前状态 |
|---|------|---------------|---------|
| 11 | 无流式显示 | AI 回复逐字/逐块流入，有打字机效果 | 一次性渲染完整回复 |
| 12 | 工具调用无动态展示 | 工具一个一个滑入，running 状态实时更新 | 全部一次性渲染 |
| 13 | 无中断按钮 | Composer 按钮在 idle 时显示"继续"，working 时显示"中断" | 只有"发送" |
| 14 | 旧 ToolCallBlock 仍被渲染 | — | 某些路径仍引用旧组件 |
| 15 | 工具卡片重复功能 | 只有展开/折叠 | "查看源码/原始载荷/展开结果细节"三个重复按钮 |

### P1 — 状态栏条件渲染

| # | 问题 | 正确做法 |
|---|------|---------|
| 16 | 推理强度对所有供应商显示 | 只有 Codex apiMode 才显示 |
| 17 | Fast Mode 对所有供应商显示 | 只有 Codex apiMode 才显示 |
| 18 | 缺少思考强度 | Anthropic/Anthropic 兼容才显示 thinking budget |
| 19 | 权限切换无效 | 切换后需 PUT session → 下次 turn 使用新 policy |

### P2 — 叙述者管理

| # | 问题 | NarraFork 做法 |
|---|------|---------------|
| 20 | 无叙述者类型选择 | 创建时选择：独立 / 绑定项目 / 绑定章节 |
| 21 | 无工作目录绑定 | 叙述者可绑定 worktree 路径 |
| 22 | 无叙事线绑定 | 叙述者可关联叙事线/项目 |

---

## 系统性改造方案

### 对话流式处理（P0 #11-12）

```
当前数据流：
WebSocket → ws-envelope-reducer → messages state → MessageStream → MessageItem

需要改造：
1. ws-envelope-reducer 正确处理 assistant_delta 事件 → 逐块追加到当前消息
2. MessageItem 检测 isStreaming=true 时使用 AnimatedMarkdown（已有 flowtoken 依赖）
3. 工具调用在 running 状态时显示 Loader 动画
4. 新工具调用出现时自动滚动到底部
```

### 中断按钮（P0 #13）

```
当前 Composer：
- 只有"发送"按钮
- onAbort prop 已存在但未在 UI 中暴露

需要改造：
1. Composer 在 isRunning=true 时显示"中断"按钮（红色）
2. 点击调用 onAbort → 发送 abort envelope → WebSocket
3. isRunning=false 时显示"发送"按钮
```

### 旧组件清理（P0 #14-15）

```
需要：
1. 全局搜索 ToolCallBlock 引用，全部替换为 ToolCallCard
2. 删除 components/ToolCall/ToolCallBlock.tsx（或标记 deprecated）
3. 确认没有其他路径渲染旧组件
```

### NarratorStatusBar 条件渲染（P1 #16-18）

```
当前：所有控件无条件显示
需要：根据 status.apiMode 或 status.providerType 决定显示哪些控件

- apiMode === "codex" → 显示推理强度 + Fast Mode
- providerType === "anthropic" → 显示思考强度
- 其他 → 只显示模型切换 + 权限模式
```

---

## NarraFork 对话交互参考

### 流式渲染
- AI 回复逐 token 流入，使用 CSS transition 平滑显示
- 工具调用在 pending → running → success 状态间切换，每次状态变化有动画
- 新消息/工具调用出现时自动滚动到底部

### Composer 状态
```
idle: [📎] [textarea: "发送消息..."] [继续]
working: [📎] [textarea: disabled] [中断(红色)]
interrupted: [📎] [textarea: "发送消息..."] [继续]
```

### 工具调用渲染
```
running 状态:
├── Loader 动画 + 工具名 + "运行中..."
└── 无展开内容

success 状态:
├── ✓ 绿色 + 工具名 + 摘要 + 耗时
└── 可展开查看输入/输出

error 状态:
├── ✗ 红色 + 工具名 + 错误摘要
└── 可展开查看错误详情
```
