# Agent Runtime 详解

Agent Runtime 是 NovelFork 的 AI 对话执行引擎。核心入口 `runAgentTurn()`，位于 `packages/studio/src/api/lib/agent-turn-runtime.ts`。

## Turn Loop 生命周期

```
runAgentTurn(input)
  ├── buildInitialMessages()   // 组装 system prompt + context + messages
  ├── appendSystemPrompt       // 高优先级动态指令（recency bias）
  ├── filterSessionToolsForProvider()  // 按 policy 过滤工具
  │
  └── for (;;) {               // 主循环
        ├── signal.aborted?  → turn_completed（静默结束）
        ├── in-flight microcompact（折叠旧 tool_result）
        ├── blocking limit pre-check（97% 注入停止指令）
        │
        ├── generate()  →  LLM 调用
        │     ├── 成功 + type:"message"  → emit assistant_message → TurnComplete hook → 结束
        │     ├── 成功 + type:"tool_use" → 执行工具 → 追加 tool_result → continue
        │     ├── 失败 + user-aborted   → 静默 turn_completed
        │     ├── 失败 + rate_limit     → model fallback（切备用模型）→ continue
        │     ├── 失败 + context_overflow → emergencyTruncateMessages → retry
        │     └── 失败 + max_tokens     → escalation 64K → retry（最多 3 次）
        │
        ├── Budget Pressure（追加上下文使用率提醒）
        ├── 重复工具调用检测（signature dedup）
        ├── File Read 去重（hash 比较，返回 stub）
        └── maxSteps 达到 → 强制结束
      }
```

## max_output_tokens 恢复

当 LLM 返回 `stop_reason: "max_tokens"` 或 `"length"` 时：

1. 递增 `maxOutputTokensRecoveryCount`（上限 3 次）
2. 设置 `maxOutputTokensOverride = 64000`（ESCALATED_MAX_TOKENS）
3. 将截断的 assistant 内容追加到 messages 中
4. 注入系统提示："输出被截断，请继续"
5. 重新 generate

3 次仍被截断则放弃，emit `turn_failed`。

## 模型 Fallback

当主模型返回可 fallback 的错误（rate_limit / overloaded / 503 / 529 / service_unavailable）时：

1. 检查 `input.fallbackModel` 是否配置
2. 一次机会（`hasAttemptedFallback` 标记）
3. 切换 `currentSessionConfig.modelId` 为备用模型
4. 注入系统消息通知模型已切换
5. continue 进入下一轮 generate

## Budget Pressure

基于 provider 报告的 `input_tokens` 与上下文窗口（减去 32K 输出预留）的比值：

| 阈值 | 级别 | 行为 |
|------|------|------|
| 70% | 信息 | "上下文已用 N%，建议适时汇报阶段性结果" |
| 80% | 软提示 | "请尽快收尾，避免长输出导致截断" |
| 92% | 紧急 | "即将溢出，请立即完成并停止扩展" |
| 97% | 阻断 | 直接注入 system message 要求停止工具调用 |

提示以 `\n\n[...]` 形式追加到最后一条 `tool_result` 末尾（无损）。

## In-flight Microcompact

在 for(;;) 每次迭代开始时检查：

- 条件：`usageRatio >= 0.60` 且 `messages.length > 20`
- 行为：将 **最后 6 条以外** 的 `tool_result` 中内容超过 500 字符的折叠为 `[已折叠: {name} 输出 N 字符]`
- 目的：防止长工具循环中触发 413 错误

## 上下文窗口计算

```
usableWindow = contextWindowTokens - 32768（output reserve）
usageRatio = lastInputTokens / usableWindow
```

`lastInputTokens` 来自 provider 返回的 `usage.input_tokens`。

## 安全层

### Secret Detector（`security/secret-detector.ts`）

扫描工具输出中的密钥模式（API key、token、password 等），检测到时替换为 `[REDACTED]`。

### Path Sandbox（`security/path-sandbox.ts`）

文件操作工具（Read / Write / Edit）执行前校验路径：
- 不允许访问工作目录外的文件
- 拦截 `..` 逃逸
- 白名单机制

### DANGEROUS_PATTERNS

Bash 工具执行前匹配危险命令模式（`rm -rf /`、`git push --force`、`DROP TABLE` 等），匹配到则触发确认流程。

## Blocking TurnComplete Hooks

当 Agent 准备结束回合（输出 message 而非 tool_use）时：

1. 调用 `onTurnComplete(context)` 回调
2. 回调可返回注入消息（用于自我修正）
3. 注入后重新 generate
4. 最多重试 2 次（`turnCompleteHookRetries` 上限）

## User-aborted 处理

当 `signal.aborted` 或 generate 返回 `code: "user-aborted"` 时：
- 不 emit `turn_failed`
- 直接 emit `turn_completed`（静默结束）
- 日志记录但不对用户报错

## Confirmation 流程

工具执行返回 `result.confirmation` 时：

1. emit `confirmation_required` 事件
2. Turn Loop 暂停（return events）
3. 前端展示确认 UI → 用户决定
4. 用户确认后重新发起消息继续 turn
5. session-chat-service 广播 idle 状态
