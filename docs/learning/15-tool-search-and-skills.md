---
title: 工具、搜索与技能
summary: Agent 工具执行机制、搜索能力与技能系统全景
tags: [工具, 搜索, 技能, Skills, MCP, 权限]
routes:
  - /next/routines
  - /next/narrators/:id
---

# 工具、搜索与技能

> Agent 通过注册的工具与技能执行具体操作，搜索能力扩展信息来源。

## 工具系统

Agent 可调用的工具分三类：

| 类型 | 说明 | 示例 |
|------|------|------|
| **内置工具** | Runtime 核心能力 | Read、Write、Bash、Browser、Terminal |
| **领域工具** | novel-plugin 注册的写作工具 | write.preflight、scene.spec、pipeline.write、lore.read、memory.read |
| **MCP 工具** | 外部 MCP Server 暴露的能力 | 数据库查询、API 调用、自定义脚本 |

## 搜索能力

| 搜索类型 | 后端 | 用途 |
|----------|------|------|
| 文件搜索 | ripgrep (rg) | 代码与文本文件内容搜索 |
| Web 搜索 | Tavily / Bocha / 智谱 / 自定义 HTTP | 联网获取最新信息 |
| 叙事记忆搜索 | SQLite LIKE 匹配 | 搜索动态事实与事件 |
| 经纬搜索 | 全文 + 分类过滤 | 搜索静态设定条目 |

## 技能系统 (Skills)

### 全局技能 vs 作品技能
- **全局技能**：扫描 `~/.novelfork/skills/` 以及 Runtime 兼容的 `~/.narrafork/skills/`、`~/.claude/skills/`、`~/.agents/skills/`。对所有叙述者生效。
- **作品技能**：自动扫描作品目录 `.novelfork/skills/`。通过书籍可信绑定访问，仅对该作品生效；文件存在即参与解析。

### 技能文件结构

每个技能是一个目录，包含 `SKILL.md`：

```
~/.novelfork/skills/my-skill/
├── SKILL.md          ← 主文件（Frontmatter + Prompt）
└── templates/        ← 可选辅助模板
    └── example.md
```

### 在线浏览与预览

在"套路 → 技能"页面：
- 每个 Skill 卡片可展开文件树，列出包含的所有文件。
- 点击文件名弹窗在线查看源码与 Markdown 格式化内容。
- 支持创建、编辑、删除全局或作品级技能。

### 写作技能 (Writing Skills)

属于独立子系统（见 `19-presets-and-beats.md`），专注于写作规则与合规检查。
作品目录中的 `.novelfork/skills/` 文件会被自动发现并解释；面板的添加/删除操作只是对这些文件执行增量同步。

## 工具权限

每个工具的执行受权限模式控制：

| 模式 | 行为 |
|------|------|
| `allow` | 自动执行，不询问 |
| `ask` | 每次执行前弹出确认 |
| `deny` | 禁止执行 |

可在"套路 → 工具权限"中按 pattern 配置规则。
