# UI 可见性缺口修复 — 需求文档

## 背景

内测前审计发现：设置页面有多项功能在对话界面缺少对应的可见性反馈、快捷入口或实际实现。用户在使用过程中会遇到"卡住不知道发生了什么"、"功能开关有但没效果"、"出错不知道怎么修"等问题。

---

## Phase 1：可见性反馈（用户不知道发生了什么）

### 1.1 危险反思执行中反馈

**现状**: dangerReflection 调用 LLM 评估时，对话界面卡住 3-8 秒无任何提示
**目标**: 显示"⚠️ 安全评估中..."状态，完成后显示评估结果

**实现方案**:
- `session-chat-service.ts` 的 `onEvent` 中，当 tool_result 包含 `reason: "danger-reflection"` 时，先广播一个 `session:state` 更新（substatus: "reflecting"）
- 前端 `NarratorStatusBar` 添加 `reflecting` 子状态显示"安全评估中..."
- 评估完成后正常显示确认门卡片（已有）

### 1.2 重试时前端提示

**现状**: 429/502/503 重试时对话界面无任何提示，用户以为卡死了
**目标**: 状态栏显示"重试中 (2/5)..."

**实现方案**:
- `llm-runtime-service.ts` 的重试循环中，通过回调通知上层当前重试状态
- `AgentGenerateInput` 添加可选 `onRetry?: (attempt: number, maxAttempts: number, delayMs: number) => void`
- `session-chat-service.ts` 收到 onRetry 时广播 `session:state`（substatus: "retrying", retryAttempt, retryMax）
- 前端 `NarratorStatusBar` 添加 `retrying` 子状态显示"重试中 (2/5)..."

### 1.3 首 token 超时错误明确化

**现状**: 超时后报 "Request aborted" 通用错误，用户不知道是超时
**目标**: 明确显示"首 token 超时（已等待 60s），正在重试..."

**实现方案**:
- `session-chat-service.ts` 中 `combinedSignal` 触发时，检测是 timeout 还是手动 abort
- timeout 时在错误消息中明确说明："API 响应超时（已等待 {N}s）。可在设置 → AI 代理 → 首 token 超时中调整。"

### 1.4 自动批准计划时通知

**现状**: autoApprovePlan 开启后，计划自动批准，用户完全无感知
**目标**: 自动批准时在对话中显示一条轻量提示"✅ 计划已自动批准"

**实现方案**:
- `session-chat-service.ts` 中确认门自动批准逻辑处，插入一条 system 类型消息
- 前端渲染为淡色提示条（类似压缩摘要卡片的样式）

### 1.5 角色弧线追踪模式反馈

**现状**: 设置中切换 arcTrackingMode 后无任何反馈
**目标**: 切换后 toast 提示"角色弧线追踪已切换为 {mode}"

**实现方案**:
- `AgentSettingsPanel` 中 arcTrackingMode 变更保存成功后显示 toast

---

## Phase 2：缺失实现（设置有但功能没做）

### 2.1 实时输出速率显示

**现状**: 设置中有"显示实时 AI 输出速率"开关，但对话界面未实现
**目标**: 状态栏显示实时 chars/s 指示器

**实现方案**:
- `NarratorStatusBar` 中，当 streaming 时计算 chars/s（每秒更新一次）
- 显示格式："42 字/秒" 或 "1.2k tok/s"
- 仅在设置开启 + 正在 streaming 时显示

### 2.2 更新频率提醒/桌面通知

**现状**: 写作设置中有"更新频率提醒"开关和时间设置，但通知系统未实现
**目标**: 到达设定时间时发送桌面通知提醒写作

**实现方案**:
- 创建 `packages/studio/src/app-next/notifications/notification-scheduler.ts`
- 使用 `Notification API`（浏览器原生）
- 每分钟检查一次是否到达提醒时间
- 长任务完成时也发送通知（"叙述者已完成任务"）

---

## Phase 3：缺失入口（功能有但对话中无快捷访问）

### 3.1 写作预设快捷切换

**现状**: 切换文风/句长/对话比例需要去设置页
**目标**: 对话输入框上方或状态栏提供快捷切换入口

**实现方案**:
- 状态栏右侧添加"✍️"按钮，点击弹出写作预设快捷面板
- 面板包含：文风（4选1）、句长（3选1）、对话比例（滑块）
- 修改后立即保存到 userConfig，下次生成时生效

### 3.2 终端面板入口

**现状**: 终端功能存在但对话中无入口
**目标**: 工具栏或状态栏提供终端面板入口

**实现方案**:
- 对话页面顶部工具栏添加终端图标按钮
- 点击打开底部终端面板（类似 VS Code 的集成终端）
- 复用已有的 Terminal 工具实现

---

## Phase 4：缺失引导（出错时不告诉用户怎么修）

### 4.1 工具循环超限引导

**现状**: 超过 maxTurnSteps 时显示"工具循环超过 N 步"但不告诉用户怎么办
**目标**: 错误消息中附带"可在设置 → AI 代理 → 每条消息最大轮次中调高"

**实现方案**:
- `agent-turn-runtime.ts` 中 `tool-loop-limit` 错误消息追加设置引导文本

### 4.2 API 失败时代理引导

**现状**: API 网络错误时只显示 "network-error"，不提示检查代理
**目标**: 网络错误时附带"如果使用了代理，请检查设置 → 代理管理中的配置"

**实现方案**:
- `llm-runtime-service.ts` 中 network-error 返回时，在 error 消息中追加代理检查提示

---

## 实施顺序

```
Phase 1 — 可见性反馈（最高优先级，直接影响内测体验）
  1.1 危险反思反馈
  1.2 重试提示
  1.3 超时错误明确化
  1.4 自动批准通知
  1.5 弧线追踪反馈

Phase 2 — 缺失实现
  2.1 输出速率显示
  2.2 桌面通知

Phase 3 — 缺失入口
  3.1 写作预设快捷切换
  3.2 终端面板入口

Phase 4 — 缺失引导
  4.1 工具循环超限引导
  4.2 API 失败代理引导
```

---

## 验证标准

- Phase 1：每个可见性反馈都有对应的浏览器截图证明
- Phase 2：输出速率在 streaming 时可见；通知在设定时间触发
- Phase 3：快捷入口可点击且功能正常
- Phase 4：错误消息中包含设置页路径引导
