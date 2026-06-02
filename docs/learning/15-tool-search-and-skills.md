---
title: 工具搜索与技能
summary: 工具列表直注 system prompt、Skill 加载、MCP 扩展
tags: [工具, 技能, MCP, ToolSearch, Skill]
routes:
  - /next/routines
---

# 工具搜索与技能

> 工具列表直注 system prompt、Skill 加载、MCP 扩展。

## 核心概念

**工具注入**：v1.3.0 起，所有可用工具列表直接注入到 system prompt 中，Agent 启动时即可看到完整工具集。不再依赖 ToolSearch 动态发现。

**ToolSearch（已弱化）**：保留作为备用机制。当工具列表过长或需要搜索非核心工具时仍可使用。结果现在正确显示为结构化数据（已修复此前的 `[object Object]` 显示问题）。

**Skill**：可复用的能力模块。Agent 通过 Skill 工具加载特定技能（如写作模板应用、合规检查流程），技能包含预定义的工具链和提示词。

**MCP（Model Context Protocol）**：连接外部 MCP Server 为 Agent 注入额外工具。支持 stdio 本地进程和 HTTP 远程服务两种模式。

## 推荐使用流程

1. 核心工具（Read/Write/Edit/Bash 等）始终可用，直接注入 system prompt
2. 小说专属工具通过 novel-plugin 自动注册并注入
3. 需要外部能力时，在套路 MCP tab 中添加 MCP Server
4. Skill 用于加载复杂工作流模板

## 最佳实践

- 工具列表自动注入，无需手动管理
- MCP 工具按需启用，不用的关掉减少噪音
- 自定义 Skill 适合封装重复性工作流
- ToolSearch 已不是主要发现机制，但仍可用于搜索

## 常见坑

- **Agent 说找不到某工具** → 工具可能未在当前套路中启用，检查套路工具 Tab
- **MCP 工具调用失败** → MCP Server 未启动或连接断开
- **ToolSearch 显示异常** → 已修复。如仍有问题请检查版本是否为 v1.3.0+

## Agent 查阅提示

- v1.3.0 起工具列表直接注入 system prompt，Agent 启动时即可见所有工具
- ToolSearch 保留但已弱化，主要用于搜索非核心/外部工具
- ToolSearch 结果已修复 [object Object] 问题，返回正确的结构化数据
- Skill 加载后注入当前会话的工具集和系统提示
- MCP 工具与内置工具共享权限模式和确认门机制
- 工具权限在套路中配置：allowlist / blocklist 模式
- MCP Server 配置在套路的 MCP tab 中，支持环境变量注入

## 可跳转功能入口

- 套路管理: MCP Server 和工具权限配置。 (/next/routines)
