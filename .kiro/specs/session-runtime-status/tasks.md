# 会话运行时状态 — 任务清单

## 步骤 1：排查中断/继续功能

- [ ] 1.1 确认中断按钮的前端 → 后端调用链是否正常
- [ ] 1.2 确认后端收到中断后是否正确 abort 当前 generate 请求
- [ ] 1.3 确认中断后会话状态是否正确恢复为 idle
- [ ] 1.4 确认"继续"按钮的调用链和后端处理逻辑
- [ ] 1.5 修复中断/继续功能

## 步骤 2：状态栏实时状态

- [ ] 2.1 后端 agent-turn-runtime 在状态变化时广播 WebSocket 事件
  - generate 开始 → `narrator:thinking`
  - tool_call 开始 → `narrator:tool_calling` + toolName
  - tool_result 返回 → `narrator:thinking`（继续思考）
  - 完成 → `narrator:idle` + duration
- [ ] 2.2 前端 ws-envelope-reducer 处理状态事件，更新 ConversationStatus
- [ ] 2.3 NarratorStatusBar 根据状态显示对应文本和动画
  - thinking → "思考中..." + 脉冲动画
  - tool_calling → "调用 {toolName}..." + 旋转图标
  - idle → "空闲 · 上轮耗时 Xs"

## 步骤 3：上轮耗时精确计算

- [ ] 3.1 后端记录每轮对话的开始时间和结束时间
- [ ] 3.2 通过 WebSocket 事件发送精确耗时
- [ ] 3.3 前端状态栏显示"上轮耗时 X.Xs"

## 步骤 4：后台日志增强

- [ ] 4.1 agent-turn-runtime 在关键节点输出结构化日志
  - 工具调用开始/结束 + 耗时
  - generate 请求开始/结束 + token 用量
  - 错误和重试
- [ ] 4.2 中断/继续操作记录日志
