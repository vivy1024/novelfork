---
title: 工具搜索与技能
summary: ToolSearch 动态发现工具、Skill 加载、MCP 扩展
tags: [工具, 技能, MCP, ToolSearch, Skill]
routes:
  - /next/routines
---

# 工具搜索与技能

> ToolSearch 动态发现工具、Skill 加载、MCP 扩展。

## 核心概念

**ToolSearch**：Agent 不需要一次性加载所有工具。当需要非核心工具时，通过 ToolSearch 动态发现并加载，减少全量注入的 token 消耗。

**Skill**：可复用的能力模块。Agent 通过 Skill 工具加载特定技能（如写作模板应用、合规检查流程），技能包含预定义的工具链和提示词。

**MCP（Model Context Protocol）**：连接外部 MCP Server 为 Agent 注入额外工具。支持 stdio 本地进程和 HTTP 远程服务两种模式。

## 推荐使用流程

1. 核心工具（Read/Write/Edit/Bash 等）始终可用，无需配置
2. 小说专属工具通过 novel-plugin 自动注册
3. 需要外部能力时，在套路 MCP tab 中添加 MCP Server
4. Agent 在执行中自动通过 ToolSearch 发现需要的工具

## 最佳实践

- 不需要手动管理工具列表，系统自动按需加载
- MCP 工具按需启用，不用的关掉减少噪音
- 自定义 Skill 适合封装重复性工作流

## 常见坑

- **Agent 说找不到某工具** → 工具可能未在当前套路中启用，检查套路工具 Tab
- **MCP 工具调用失败** → MCP Server 未启动或连接断开
- **ToolSearch 返回空** → 搜索关键词不匹配，尝试不同描述

## Agent 查阅提示

- ToolSearch 基于工具描述的语义匹配，返回最相关的工具列表
- Skill 加载后注入当前会话的工具集和系统提示
- MCP 工具与内置工具共享权限模式和确认门机制
- 工具权限在套路中配置：allowlist / blocklist 模式
- MCP Server 配置在套路的 MCP tab 中，支持环境变量注入

## 可跳转功能入口

- 套路管理: MCP Server 和工具权限配置。 (/next/routines)
