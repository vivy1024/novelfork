---
title: 设置与套路
summary: 配置 AI 供应商、模型路由，用套路系统定义 Agent 行为边界
tags: [设置, 供应商, 套路, MCP, 模型, Hooks]
routes:
  - /next/settings
  - /next/routines
---

# 设置与套路

> 配置 AI 供应商连接和模型路由，用套路系统定义 Agent 行为边界。

## 核心概念

**供应商**：AI 模型的 API 连接配置（Key + Endpoint + 可用模型列表）。支持 OpenAI / Anthropic / 自定义端点。

**模型聚合**：多供应商的同名模型合并为一个逻辑模型，按策略路由（priority / round-robin / random）。

**套路（Routines）**：Agent 行为规则集。全局套路对所有作品生效，项目套路覆盖全局。

**MCP 扩展**：连接外部 MCP Server 为 Agent 注入额外工具能力。

## 套路系统 10 大维度

套路页面包含 10 个配置维度：

| 标签 | 功能 | 说明 |
|------|------|------|
| **Commands** | 自定义斜杠命令 | 定义 `/命令名` → prompt 模板，Composer 中 `/` 触发补全 |
| **Tools** | 可选工具开关 | 控制哪些工具对 Agent 可见，支持 `/load` 等价入口 |
| **Permissions** | 工具权限规则 | 每个工具的权限行为：allow / deny / ask，支持 pattern 匹配 |
| **Global Skills** | 全局技能 | 全局生效的技能指令，注入所有 Agent 的 system prompt |
| **Project Skills** | 项目技能 | 项目级技能，覆盖全局同名技能 |
| **SubAgents** | 子代理定义 | 自定义子代理类型：名称、systemPrompt、工具权限 |
| **Global Prompts** | 全局提示词 | 注入所有叙述者的 system prompt 中 |
| **System Prompts** | 系统提示词 | 更底层的系统提示注入 |
| **MCP Tools** | MCP 工具 | 外部 MCP Server 暴露的工具，支持审批 |
| **Hooks** | 钩子 | shell/webhook/llm 三种类型，在工具调用前后触发 |

## Hooks 钩子系统

三种触发时机：

| 钩子类型 | 触发时机 | 典型用途 |
|---------|---------|---------|
| PreToolUse | 工具执行前 | 参数校验、审计日志 |
| PostToolUse | 工具执行后 | 结果后处理、通知 |
| TurnComplete | 对话轮次结束后 | 自动备份、统计 |

三种执行方式：

| 类型 | 说明 |
|------|------|
| `shell` | 执行 shell 命令 |
| `webhook` | 发送 HTTP 请求 |
| `llm` | 调用 LLM 进行判断 |

## Workflow Recipes

可配置的工作流程配方，定义命令的执行链：

```json
{
  "commandId": "/novel:write-next",
  "steps": ["cockpit.snapshot", "pgi.ask", "AskUserQuestion", "scene.spec", "pipeline.generate_chapter"]
}
```

## 推荐使用流程

1. 设置 → 供应商 → 添加至少一个 API 供应商（填 Key + Base URL + 拉取模型列表）
2. 设置默认会话模型、摘要模型、子代理模型池
3. 进入套路页面，配置全局套路的命令、工具、权限基线
4. 在具体作品中按需覆盖项目套路（题材规则、专用技能）
5. 如需外部工具，在套路 MCP tab 中添加 MCP Server
6. 配置 Hooks 实现自动化（如每次生成后自动备份）

## 最佳实践

- 先配好供应商再做其他事，没有可用模型一切功能不可用
- 全局套路放通用规则，项目套路放题材定制
- 模型聚合用 priority 策略时把最稳定的供应商排第一
- 权限建议从 ask 开始，熟悉后再切 allow
- 自定义子代理的 systemPrompt 要明确限定它的职责边界

## 常见坑

- **模型列表为空** → API Key 过期或 Base URL 错误，用"测试连接"验证
- **命令不生效** → 检查套路命令 Tab 是否被禁用；项目套路会覆盖全局
- **MCP 工具超时** → MCP 服务器未启动或网络不通
- **聚合路由不切换** → 只有请求失败才触发 fallback
- **Hooks 不执行** → 检查 enabled 状态和触发事件匹配

## Agent 查阅提示

- 供应商配置存储在 settings store，通过 `useSettingsStore` 读取
- 套路合并逻辑：全局 + 项目，同名项目优先；提示词拼接（全局在前）
- 会话创建时套路注入 sessionConfig：commands / tools / permissionMode / skills / subAgents / systemPrompt
- 自定义斜杠命令：定义 `/命令名` → prompt 模板，Composer 中 `/` 触发补全
- 全局提示词注入到所有叙述者的 system prompt 中
- 被禁用的 runtime command IDs 存储在 `disabledCommands` 字段
- Workflow Recipes 定义命令的工具调用执行链

## 可跳转功能入口

- 设置主页: 供应商、代理、外观等全部配置。 (/next/settings)
- 套路管理: Agent 行为规则、MCP、Hooks 配置。 (/next/routines)
