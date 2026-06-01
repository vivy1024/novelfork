# 错误透传与上下文可视化 — Tasks

## FR-1: 全局错误透传

### Phase A: 后端错误结构化

- [x] 1.1 定义 `RuntimeError` 类型（code/message/retryable/timestamp），在 `shared/` 中导出
- [x] 1.2 `agent-turn-runtime.ts` 的 LLM 调用失败时，通过 WebSocket 广播 `session:error` 事件
- [x] 1.3 工具调用超时/失败时，同样广播 `session:error` 事件
- [x] 1.4 `session-compact-service.ts` 压缩失败时广播错误（替代前端 alert）

### Phase B: 前端错误展示

- [x] 1.5 `ConversationSurface` 新增错误消息气泡组件（ErrorMessageBubble）
- [x] 1.6 错误气泡包含：错误内容 + "自动重试此类错误"按钮 + "忽略"按钮
- [x] 1.7 状态栏（NarratorStatusBar）错误时变红色 / 重试时变黄色 + 显示"错误/重试中"
- [x] 1.8 右上角 toast 通知（使用现有 notify 系统）
- [x] 1.9 "自动重试此类错误"点击后，将错误模式加入 `retryRules`，后续自动重试

### Phase C: 重试机制完善

- [x] 1.10 对齐 NarraFork 设置：可恢复错误最大重试次数（默认 10，-1=无限）
- [x] 1.11 重试退避时间上限（默认 20s）
- [x] 1.12 首 token 超时（默认 60s，当前已有但默认值是 0=禁用）

## FR-2: 上下文注入可视化

- [x] 2.1 新增 `GET /api/sessions/:id/context-breakdown` 端点
- [x] 2.2 端点返回各部分 token 占用（system prompt / tools / messages / jingwei / presets）
- [x] 2.3 Context Ring 菜单新增"查看上下文详情"选项
- [x] 2.4 上下文详情弹窗/面板：显示各部分占比和具体内容摘要
- [x] 2.5 经纬注入详情：显示哪些条目被注入、各条目 token 占用
- [x] 2.6 预设注入详情：显示哪些 promptInjection 生效

## 执行顺序

Phase A（后端）: 1.1 → 1.2 → 1.3 → 1.4 ✅
Phase B（前端）: 1.5 → 1.6 → 1.7 → 1.8 → 1.9 ✅
Phase C（重试）: 1.10 → 1.11 → 1.12 ✅
Phase D（可视化）: 2.1 → 2.2 → 2.3 → 2.4 → 2.5 → 2.6 ✅

## 对齐 NarraFork AI 代理设置

以下设置项需确认 NovelFork 已实现且默认值对齐：

| NarraFork 设置 | NovelFork 字段 | 默认值 | 状态 |
|---|---|---|---|
| 默认权限模式 | defaultPermissionMode | allow | ✅ |
| 每条消息最大轮次 | maxTurnSteps | 200 | ✅ |
| 旧编码支持 | legacyEncoding | false | ✅ |
| 刷新 Shell 环境 | refreshShellEnv | false | ✅ |
| 翻译思考内容 | translateThinking | true | ✅ |
| Dump 每条 API 请求 | dumpApiRequests | false | ✅ |
| 仅保留报错请求 dump | dumpOnlyErrors | false | ✅ |
| 默认展开推理内容 | expandReasoning | false | ✅ |
| 新叙述者默认计划模式 | defaultPlanMode | false | ✅ |
| 默认宽松规划 | relaxedPlanning | false | ✅ |
| 全局默认自动批准计划 | autoApprovePlan | true | ✅ |
| 全局默认启用危险反思 | dangerReflection | true | ✅ |
| 跳过只读危险反思确认 | yoloSkipReadonlyConfirmation | false | ✅ |
| 可恢复错误最大重试次数 | recovery.maxRetryAttempts | 10 | ✅ |
| 沉默工具调用阈值 | silentToolCallThreshold | 20 | ✅ |
| 重试退避时间上限 | recovery.maxRetryDelayMs | 20000 | ✅ |
| 首 token 超时 | firstTokenTimeout | 60 | ✅ |
| 自动压缩保留轮数 | compressionKeepTurns | 2 | ✅ |
| 最大裁剪 | maxTruncateRatio | 80% | ✅ |
| 标准开始裁剪 | contextTruncateTargetPercent | 95% | ✅ |
| 标准开始压缩 | contextCompressionThresholdPercent | 99% | ✅ |
| 大窗口开始裁剪 | largeWindowTruncateTargetPercent | 95% | ✅ |
| 大窗口开始压缩 | largeWindowCompressionThresholdPercent | 99% | ✅ |
| 滚动自动加载历史 | scrollAutoLoadHistory | true | ✅ |
| 要求使用用户语言 | forceUserLanguage | true | ✅ |
| 显示 Token 用量 | showTokenUsage | false | ✅ |
| 显示实时输出速率 | showOutputRate | false | ✅ |
