---
title: 学习中心
summary: NovelFork Studio 学习中心索引，快速找到你需要的文档
tags: [索引, 目录, 学习中心]
routes:
  - /next/learn
---

# NovelFork Studio 学习中心

> 从入门到精通，按需查阅。每篇文档独立成文，可按任意顺序阅读。

---

## 文档索引

| # | 文档 | 摘要 | 标签 |
|---|------|------|------|
| 00 | [一页理解 NovelFork](./00-overview.md) | 核心概念、三栏布局、5 分钟上手 | `入门` `概览` |
| 01 | [作品与章节管理](./01-book-management.md) | 创建作品、资源树、新书引导向导 | `作品` `章节` `资源树` |
| 02 | [AI 写作功能](./02-ai-writing.md) | 选段写作、变体、候选稿、预设、节拍 | `AI写作` `候选稿` `预设` |
| 03 | [引导式生成](./03-guided-generation.md) | PGI 追问、Guided Plan、计划批准 | `PGI` `引导式生成` |
| 04 | [叙述者对话](./04-narrator-conversation.md) | 会话界面、确认门、Slash 命令 | `叙述者` `对话` `确认门` |
| 05 | [故事经纬](./05-story-jingwei.md) | 经纬分区、可见性规则、AI 上下文参与 | `经纬` `世界观` `设定` |
| 06 | [设置与套路](./06-settings-and-routines.md) | 供应商、模型聚合、套路、MCP、Hooks | `设置` `供应商` `套路` |
| 07 | [写作分析工具](./07-writing-tools.md) | AI 味检测、健康度、文风、弧线、合规导出 | `写作工具` `分析` |
| 08 | [Agent 写作管线](./08-agent-pipeline.md) | 5 Agent 协作、管线流程、确认门 | `Agent` `Pipeline` |
| 09 | [Agent 设置](./09-agent-settings.md) | 模型、推理强度、运行时控制 | `Agent` `设置` `模型` |
| 10 | [代理设置](./10-proxy-settings.md) | 网络代理配置 | `代理` `网络` |
| 11 | [使用历史](./11-usage-history.md) | Token 用量、费用统计 | `用量` `费用` |
| 12 | [外观设置](./12-appearance.md) | 主题、字体、终端外观 | `主题` `外观` |
| 13 | [运行时能力](./13-runtime-capabilities.md) | CLAUDE.md、压缩摘要、Staleness、Dedup、Cache | `运行时` `安全` |
| 14 | [子代理系统](./14-subagent-system.md) | 四种类型、后台任务、Fork、Await | `子代理` `后台` |
| 15 | [工具搜索与技能](./15-tool-search-and-skills.md) | ToolSearch、Skill、MCP 扩展 | `工具` `技能` `MCP` |
| 16 | [安全与沙箱](./16-security-and-sandbox.md) | 三级沙箱、白名单、权限模式 | `安全` `沙箱` |
| 17 | [浏览器与终端](./17-browser-and-terminal.md) | Browser 截图、Terminal 持久化进程 | `浏览器` `终端` |
| 18 | [网络工具](./18-web-tools.md) | WebSearch、WebFetch 四种模式 | `网络` `搜索` |
| 19 | [预设规则与节拍模板](./19-presets-and-beats.md) | 53 条内置预设 + 自定义 + 节拍模板 + Agent 工具 | `预设` `节拍` `自定义` |
| 20 | [书籍叙述者分工](./20-book-narrators.md) | 五个专职叙述者的职责和快捷操作 | `叙述者` `角色` `分工` |

---

## 按场景查找

### 我是新用户

1. [00-overview](./00-overview.md) — 建立整体认知
2. [01-book-management](./01-book-management.md) — 创建第一个作品
3. [04-narrator-conversation](./04-narrator-conversation.md) — 学会与叙述者对话

### 我想了解 AI 写作

1. [02-ai-writing](./02-ai-writing.md) — 写作能力概览
2. [03-guided-generation](./03-guided-generation.md) — 引导式生成流程
3. [08-agent-pipeline](./08-agent-pipeline.md) — 底层管线原理

### 我想管理世界观

1. [05-story-jingwei](./05-story-jingwei.md) — 经纬系统完整指南

### 我想配置系统

1. [06-settings-and-routines](./06-settings-and-routines.md) — 供应商和套路
2. [09-agent-settings](./09-agent-settings.md) — Agent 运行时参数
3. [16-security-and-sandbox](./16-security-and-sandbox.md) — 安全与沙箱

### 我想了解 Agent 能力

1. [13-runtime-capabilities](./13-runtime-capabilities.md) — 运行时核心能力
2. [14-subagent-system](./14-subagent-system.md) — 子代理系统
3. [15-tool-search-and-skills](./15-tool-search-and-skills.md) — 工具与技能
4. [17-browser-and-terminal](./17-browser-and-terminal.md) — 浏览器与终端
5. [18-web-tools](./18-web-tools.md) — 网络工具

### 我想分析作品质量

1. [07-writing-tools](./07-writing-tools.md) — 所有分析工具

---

## 术语表

| 术语 | 英文 | 说明 |
|------|------|------|
| 经纬 | Jingwei | 世界观/设定的结构化存储系统（16 个分类） |
| 叙述者 | Narrator | AI 对话助手，每本书有多个专职叙述者 |
| 候选稿 | Candidate | AI 生成的待审阅草稿 |
| 确认门 | Confirmation Gate | 写入正式资源前的审批机制 |
| PGI | Pre-Generation Interview | 生成前追问 |
| 套路 | Routines | Agent 行为规则集（命令/工具/权限/提示词/MCP） |
| 管线 | Pipeline | 多 Agent 协作的执行流程 |
| 预设 | Presets | 写作规则（53 条内置，覆盖去AI味/文风/流派等） |
| 节拍 | Beats | 故事结构模板（5 个内置模板） |
| 子代理 | Subagent | 独立执行子任务的 Agent（explore/plan/general/fork） |

---

## 贡献

学习中心文档位于 `docs/learning/` 目录。如需补充或修正，请直接编辑对应文件。
