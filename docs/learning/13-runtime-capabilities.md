---
title: 运行时能力
summary: CLAUDE.md 规则读取、LLM 压缩摘要、容错解析、上下文防御、Prompt Cache
tags: [运行时, CLAUDE.md, 压缩, 安全, token, cache, 容错]
routes: []
---

# 运行时能力

> 系统自动执行的智能机制，无需手动干预。

## CLAUDE.md 规则读取

系统启动时自动加载三层规则文件，按优先级合并：

1. **全局规则** `~/.novelfork/CLAUDE.md` — 适用于所有项目的通用偏好
2. **项目规则** 项目根目录 `CLAUDE.md` — 当前书籍的专属设定
3. **目录规则** `.claude/rules/*.md` — 细粒度规则，按目录生效

规则注入到 Agent 上下文中，编辑对应文件后下次对话自动生效。

## XML tool_use 容错解析

部分模型在版本回退时可能输出非标准的 XML 格式工具调用（而非 JSON）。系统自动检测并解析 XML 格式的 tool_use 块，无需用户干预即可正常执行工具调用。这是对模型 regression 的自动防御。

## 上下文中毒防御

当对话上下文中混入恶意指令（如通过工具输出注入的 prompt injection），系统会自动检测异常模式并过滤。确保 Agent 行为始终受系统提示约束，不被外部内容劫持。

## Token 与超时配置

| 参数 | 值 | 说明 |
|------|----|------|
| max_tokens | 32768 | 单次回复的默认最大 token 数 |
| max_tokens (escalation) | 65536 | 截断时自动升级到 64K |
| 工具执行超时 | 120 秒 | 所有工具调用的统一超时 |
| agent-turn-runtime | 120 秒 | 单轮 Agent 执行的总超时 |

## max_output_tokens 恢复机制

当模型回复因 token 不足被截断时，系统自动执行恢复：

1. **检测截断** — `stop_reason === "max_tokens"` 时触发
2. **重试 3 次** — 使用相同上下文重新请求，每次检查是否完整
3. **Escalation** — 3 次仍截断，自动将 max_tokens 从 32768 提升到 65536 再试
4. **最终失败** — 提升后仍截断则标记为部分结果，通知用户

用户无需干预，日志中可见 `[max-tokens-recovery]` 条目。

## Model Fallback（自动切备用模型）

当主模型不可用时，系统自动尝试备用供应商：

| 触发条件 | 行为 |
|----------|------|
| HTTP 503 / 529 (过载) | 等待 5s → 重试 → 失败则切备用 |
| HTTP 429 (限流) | 读取 retry-after → 重试 → 超时切备用 |
| 连接超时 (30s) | 直接切备用 |
| 模型不存在 (404) | 报错，不切备用 |

切换逻辑：按用户在设置中配置的供应商优先级顺序尝试，第一个可用的即采用。切换时 UI 状态栏短暂显示"已切换到备用模型"。

## Budget Pressure（四级上下文压力）

当对话上下文占比达到阈值时，系统分级响应：

| 阈值 | 级别 | 行为 |
|------|------|------|
| 70% | info | 状态栏圆环变黄，提示"上下文较满" |
| 80% | warning | 建议用户压缩或开新 session |
| 92% | urgent | 自动注入系统指令要求 Agent 精简回复 |
| 97% | blocked | 阻断新消息发送，强制用户压缩或清空 |

Agent 在 92% 以上会收到 budget_pressure 系统提示，自动缩短回复、减少工具调用。

## In-flight Microcompact（执行中自动折叠）

长工具链执行过程中（如 pipeline.write 连续调用多个工具），当上下文达到 60% 时自动触发：

- **折叠对象**：本轮早期的工具结果（保留最近 3 个）
- **折叠方式**：替换为摘要行 `[工具结果已折叠: read 3 files, wrote 1 file]`
- **不折叠**：用户消息、系统提示、经纬数据、当前工具的输入输出
- **效果**：在不中断 Agent 执行的情况下释放 15-25% 上下文空间

## LLM 智能压缩摘要

对话历史接近上下文窗口上限时，系统自动调用摘要模型将早期对话压缩为精炼摘要。保留关键决策和上下文，确保长对话不丢失重要信息。

## Staleness Check（防覆盖）

文件写入前检查该文件自上次读取后是否被外部修改。检测到外部变更时提示确认，避免丢失手动编辑。

## 文件 Dedup（省 token）

同一文件在对话中多次引用时，只在首次发送完整内容，后续复用已有内容。减少 token 消耗，降低费用。

## Prompt Cache

启用 Anthropic API 的 cache_control，对系统提示和经纬等稳定内容启用缓存。重复对话中显著减少输入 token 费用。

## 二进制检测

自动识别二进制文件，避免将非文本内容发送给模型浪费 token。

## Agent 查阅提示

- CLAUDE.md 加载顺序：全局 → 项目 → 目录规则，后者覆盖前者
- 压缩摘要使用独立的摘要模型（在 Agent 设置中配置）
- Staleness check 基于文件 mtime 比较
- Dedup 基于文件路径 + 内容 hash
- Prompt Cache 对 Anthropic 模型自动启用，其他供应商不支持
- 二进制检测基于文件头 magic bytes
- XML tool_use 容错：自动检测 `<tool_use>` XML 块并解析为标准工具调用
- 上下文中毒防御：过滤工具输出中的 prompt injection 模式
- max_tokens 默认 32768，截断时 escalation 到 65536（3 次重试 + 升级）
- Model Fallback：503/429/超时自动切备用供应商
- Budget Pressure：70%/80%/92%/97% 四级，92% 以上注入精简指令
- In-flight Microcompact：60% 时折叠本轮早期工具结果
- 工具超时与 agent-turn-runtime 均为 120 秒

## 可跳转功能入口

- Agent 设置: 配置摘要模型和运行时参数。 (/next/settings)
