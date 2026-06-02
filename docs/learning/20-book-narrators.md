---
title: 书籍叙述者分工
summary: 每本书有多个专职叙述者角色（writer/auditor/hooks/chapter-hooks/outline/planner/architect/explorer），各司其职
tags: [叙述者, 角色, 写书, 审校, 伏笔, 钩子, 大纲, 架构]
routes:
  - /next/books/:bookId
---

# 书籍叙述者分工

> 多个叙述者角色各司其职，你不需要记住所有命令——切换到对应叙述者，用快捷按钮即可。

## 叙述者角色

| 叙述者 | agentId | 职责 | 典型操作 |
|--------|---------|------|---------|
| 📝 写书 | writer | 生成章节内容 | 生成下一章、续写、选段写作、多版本变体 |
| 🔍 审校 | auditor | 质量检查 | 连续性审校、AI 味检测、37维度审计 |
| 🎣 伏笔 | hooks | 伏笔管理 | 伏笔建议、埋设/回收/强化 |
| 🪝 章末钩子 | chapter-hooks | 章末悬念 | 生成 3-5 个钩子方案 |
| 📋 大纲与经纬 | outline | 结构规划 | 生成大纲、维护经纬、规划卷结构 |
| 🏗️ 架构 | architect | 世界观构建 | 力量体系、地理、势力、设定维护 |
| 📐 规划 | planner | 章节规划 | 情节点设计、伏笔部署方案 |
| 🔭 探索 | explorer | 信息汇总 | 只读探索、进度汇报、方向建议 |

## 什么时候用哪个

| 你想做的事 | 用哪个叙述者 |
|-----------|-------------|
| 写新章节 | 📝 写书 |
| 续写/扩写某段 | 📝 写书 |
| 检查剧情矛盾 | 🔍 审校 |
| 检测 AI 味 | 🔍 审校 |
| 分析可以埋的伏笔 | 🎣 伏笔 |
| 给章末加悬念 | 🪝 章末钩子 |
| 规划下一卷大纲 | 📋 大纲与经纬 |
| 整理世界观设定 | 🏗️ 架构 |
| 了解当前进度和待处理项 | 🔭 探索 |
| 讨论想法/闲聊 | 任意一个都行 |

## 角色工具权限

每个角色有不同的默认工具启用集：

| 角色 | 启用工具 | 禁用工具 |
|------|---------|---------|
| writer | Bash, Read, Write, Edit, Grep, Glob, EnterWorktree, ExitWorktree, TaskCreate | Terminal, Browser, ForkNarrator, Recall, ShareFile |
| auditor | Read, Grep, Glob | Write, Edit, Bash, Terminal, Browser, ForkNarrator |
| hooks | Read, Write, Grep, Glob | Bash, Terminal, Browser, ForkNarrator |
| chapter-hooks | Read, Grep, Glob | Write, Edit, Bash, Terminal, Browser |
| outline | Read, Write, Edit, Grep, Glob | Bash, Terminal, Browser, ForkNarrator |
| architect | Read, Write, Edit, Grep, Glob | Bash, Terminal, Browser, ForkNarrator |
| planner | Read, Write, Edit, Grep, Glob | Bash, Terminal, Browser, ForkNarrator |
| explorer | Read, Grep, Glob, Recall | Write, Edit, Bash, Terminal, Browser, ForkNarrator, ShareFile |

## 推荐使用流程

1. 写作阶段用「📝 写书」生成内容
2. 写完一章切到「🔍 审校」检查质量
3. 每隔几章用「🎣 伏笔」分析伏笔布局
4. 每章结尾用「🪝 章末钩子」加悬念
5. 开新卷前用「📋 大纲与经纬」规划结构
6. 需要丰富世界观时用「🏗️ 架构」维护设定

## 最佳实践

- 每个叙述者有独立上下文，不会互相干扰
- 快捷按钮本质是预设消息，你也可以直接打字说需求
- 不确定用哪个时，用「📝 写书」——它是最通用的
- 审校叙述者是只读的，不会修改你的正文
- 探索叙述者 100% 只读，适合了解现状不动手

## 常见坑

- 在审校叙述者里写章节——它的工具配置偏向检查而非生成
- 叙述者之间不共享对话历史，切换后需要重新说明上下文
- 快捷按钮只是发消息的快捷方式，不是独立功能

## Agent 查阅提示

- 角色通过 session 的 `agentId` 字段区分：writer / auditor / hooks / chapter-hooks / outline / architect / planner / explorer
- 每个角色有不同的默认工具启用集（NOVEL_AGENT_PRESETS）
- 快捷按钮定义在 AgentQuickActions 的 ROLE_ACTIONS 中
- 所有角色共享相同的底层小说工具集（NOVEL_SESSION_TOOL_DEFINITIONS），区别在于默认启用哪些通用工具
- session 创建时通过 `agentId` 决定角色，不可中途切换
- 角色的 system prompt 在 AGENT_SYSTEM_PROMPTS 中定义

## 可跳转功能入口

- 书籍工作台: 左侧资源树下方显示所有叙述者。 (/next/books/:bookId)
