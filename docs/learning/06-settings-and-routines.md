---
title: 设置与套路
summary: 配置 AI 供应商、模型路由，用套路系统定义 Agent 行为边界
tags: [设置, 供应商, 套路, MCP, 模型]
routes:
  - /next/settings
  - /next/routines
---

# 设置与套路

> 配置 AI 供应商连接和模型路由，用套路系统定义 Agent 行为边界。

## 核心概念

**供应商**：AI 模型的 API 连接配置（Key + Endpoint + 可用模型列表）。支持 OpenAI / Anthropic / 自定义端点。

**模型聚合**：多供应商的同名模型合并为一个逻辑模型，按策略路由（priority / round-robin / random）。

**套路（Routines）**：Agent 行为规则集——命令、工具、权限、技能、子代理、提示词、MCP 七大维度。全局套路对所有作品生效，项目套路覆盖全局。

**MCP 扩展**：连接外部 MCP Server 为 Agent 注入额外工具能力。

**Hooks**：三种 shell 钩子——PreToolUse（执行前）/ PostToolUse（执行后）/ TurnComplete（对话结束后）。

## 推荐使用流程

1. 设置 → 供应商 → 添加至少一个 API 供应商（填 Key + Base URL + 拉取模型列表）
2. 设置默认会话模型、摘要模型、子代理模型池
3. 进入套路页面，配置全局套路的命令、工具、权限基线
4. 在具体作品中按需覆盖项目套路（题材规则、专用技能）
5. 如需外部工具，在套路 MCP tab 中添加 MCP Server

## 最佳实践

- 先配好供应商再做其他事，没有可用模型一切功能不可用
- 全局套路放通用规则，项目套路放题材定制
- 模型聚合用 priority 策略时把最稳定的供应商排第一
- 权限建议从 ask-always 开始，熟悉后再切 auto-approve

## 常见坑

- **模型列表为空** → API Key 过期或 Base URL 错误，用"测试连接"验证
- **命令不生效** → 检查套路命令 Tab 是否被禁用，项目套路会覆盖全局
- **MCP 工具超时** → MCP 服务器未启动或网络不通
- **聚合路由不切换** → 只有请求失败才触发 fallback

## Agent 查阅提示

- 供应商配置存储在 settings store，通过 `useSettingsStore` 读取
- 套路合并逻辑：全局 + 项目，同名项目优先；提示词拼接（全局在前）
- 会话创建时套路注入 sessionConfig：commands / tools / permissionMode / skills / subAgents / systemPrompt
- 自定义斜杠命令：定义 `/命令名` → prompt 模板，Composer 中 `/` 触发补全
- 全局提示词注入到所有叙述者的 system prompt 中

## 可跳转功能入口

- 设置主页: 供应商、代理、外观等全部配置。 (/next/settings)
- 套路管理: Agent 行为规则、MCP、Hooks 配置。 (/next/routines)
