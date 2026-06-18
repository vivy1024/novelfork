# Agent Turn Runtime 详解

NovelFork v1.11.2 的 Agent Runtime 核心位于 `packages/studio/src/api/lib/agent-turn-runtime.ts`，实现了完整的 Agent 回合循环（Turn Loop），包含错误恢复、上下文压力管理、循环检测等机制。

## Turn Loop 生命周期

每次用户消息触发一个 Turn，流程如下：

```
1. buildInitialMessages — 组装 system prompt + context + appendSystemPrompt
2. filterSessionToolsForProvider — 按 policy 过滤可用工具
3. 主循环（无限循环直到终止条件）:
   a. In-flight microcompact（60%+ 折叠旧 tool_result）
   b. Aggressive fold（85%+ 激进折叠）
   c. Blocking limit（97%+ 注入停止指令）
   d. generate() — 调用 LLM
   e. 处理结果:
      - 失败 → 恢复策略（fallback/overflow recovery）
      - message → 输出并结束
      - tool_use → 执行工具 → 追加结果 → 继续循环
```

## 四层渐进压缩

上下文管理采用基于真实 input_tokens 的四层压缩策略：

| 层级 | 阈值 | 动作 |
|------|------|------|
| 轻度折叠 | 60% | 保留最近 6 条，旧 tool_result >500 字符折叠为 stub |
| 激进折叠 | 85% | 保留最近 4 条，旧 tool_result >100 字符全部折叠 |
| 阻断警告 | 97% | 注入系统消息要求立即停止工具调用 |
| 反应式恢复 | 413 错误 | 全量折叠 + emergency truncate + 重试 |

阈值基于 `lastInputTokens / (contextWindowTokens - 32768)`，其中 32768 是 output 预留。

## Budget Pressure（三级提醒）

在每个 tool_result 末尾追加上下文使用率提醒（不破坏输出）：

| 级别 | 阈值 | 提示内容 |
|------|------|----------|
| 信息 | 70% | 建议适时向用户汇报阶段性结果 |
| 软提示 | 80% | 请尽快收尾，避免长输出导致截断 |
| 紧急 | 92% | 请立即完成当前输出并停止扩展 |

## max_output_tokens Recovery

当模型输出因 `max_tokens` / `length` 停止时的恢复策略：

1. **第一次截断** — 将 `maxOutputTokensOverride` 提升到 64000
2. **后续截断** — 注入 user 消息要求模型继续（"Resume directly — no recap"）
3. **最多重试 3 次**，超过则正常结束

截断的 assistant 内容会被 push 到 messages 中保持上下文连续。
## Model Fallback

当主模型出现特定错误（rate_limit、overloaded、503、529、service_unavailable、capacity 等）时：

1. 检查是否配置了 `fallbackModel`
2. 仅尝试一次切换（`hasAttemptedFallback` 防重复）
3. 注入系统消息告知模型已切换
4. 用新 sessionConfig 继续循环

## Loop Detection（循环检测）

两种检测机制：

### 模式重复检测
取最近 6 个工具调用名序列，检查 `last3` 是否与 `prev3` 完全相同。匹配则注入警告："请改变策略或停止当前操作。如果需要批量操作，请写一个脚本一次执行。"

### 签名重复检测
对每个 `toolName + stableJson(input)` 计数。同一签名调用 ≥3 次时注入警告："请停止重复操作，改变策略。"

### Health Monitor 补充
`TurnHealthMonitor` 提供更全面的健康检查：
- 连续失败 ≥5 次 → 强制停止
- 连续失败 ≥3 次 → 警告
- token 消耗超过上下文窗口 50% → 警告

## Error File Auto-Hint

当 Bash 工具执行失败时，从错误信息中提取文件路径：

```
正则: /(?:^|\s)([\w./\\-]+\.[a-z]{1,4}):(\d+)/m
```

匹配到文件:行号后注入提示："建议读取该文件相关行以理解错误上下文。"
帮助模型自主定位问题而非盲目重试。

## 子命令拆分安全

`permission-pipeline.ts` 中的 `splitCommandSegments()` 实现了引号感知的命令拆分：

- 在 `&&`、`||`、`;`、`|` 处拆分
- 尊重单引号和双引号内的内容
- 处理反斜杠转义
- 对所有子段取**最严格**分类（dangerous > untrusted > trusted）

分类优先级：dangerous（13+ 种危险模式）→ network → write → read

## User-Aborted Handling

当 `signal.aborted` 时，或 generate 返回 `code: "user-aborted"` 时：
- 不触发错误事件
- 直接 emit `turn_completed` 并正常返回
- 日志记录 "Generate aborted by user"

## Confirmation Flow

工具返回 `confirmation` 或 `status: "pending-confirmation"` 时：
- emit `confirmation_required` 事件
- 立即返回暂停 turn（等待用户确认后恢复）
- Idle broadcast 通过 session-chat-service 通知前端显示权限对话框

## In-flight Microcompact

在每次 generate() 调用前、循环内执行：
- 60% 阈值：折叠距离最近 6 条之前的 tool_result（>500 字符）
- 85% 阈值：更激进折叠（>100 字符，仅保留最近 4 条）
- 不需要调用外部摘要模型，纯规则替换

## CtxInspect 工具

模型可主动调用 `CtxInspect` 查看当前上下文使用情况：
- 已用 token 数
- 上下文窗口大小
- 使用百分比
- 各部分占比

帮助模型自主决定是否需要 compact 或 snip。

## Mid-turn Assistant Message Persistence

在 tool_use 阶段，如果模型输出包含 reasoning_content，会被推入 messages 数组作为 assistant 消息保留。这确保：
- 上下文压缩时不丢失推理过程
- Snapshot 恢复后上下文完整
- DeepSeek 等需要 reasoning 与 tool_calls 在同一 assistant 消息中的模型正常工作

## 并行工具执行

当一个 batch 中所有工具都属于 `PARALLEL_SAFE_TOOLS`（18 个只读工具）时，使用 `Promise.all` 并行执行：

```
Read, Glob, Grep, WebSearch, WebFetch, GetGoals, LearningGuide, Recall,
jingwei.read, chapter.read, cockpit.snapshot, chapter.list, chapter.audit,
presets.read, beat.read, outline.suggest_next, character.check_consistency,
hooks.manage, presets.check_compliance
```

结果按原始顺序 emit 事件以保持一致性。

## 文件去重（File Read Dedup）

每个 turn 创建独立的 `FileReadDeduplicator` 实例：
- 对 Read、jingwei.read、chapter.read 工具追踪内容 hash（djb2 + 长度）
- 同一文件内容未变时返回 stub（节省 context）
- 独立实例避免并发 turn 间污染

## 工具输出截断

通过 `compact/tool-output-pruner.ts` 对极端长输出兜底：
- 超过 8K 字符的输出进行截断
- Content Replacement 机制将大结果存为引用
