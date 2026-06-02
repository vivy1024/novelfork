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
| max_tokens | 16384 | 单次回复的最大 token 数 |
| 工具执行超时 | 120 秒 | 所有工具调用的统一超时 |
| agent-turn-runtime | 120 秒 | 单轮 Agent 执行的总超时 |

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
- max_tokens 上限 16384，工具超时与 agent-turn-runtime 均为 120 秒

## 可跳转功能入口

- Agent 设置: 配置摘要模型和运行时参数。 (/next/settings)
