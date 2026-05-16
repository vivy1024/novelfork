---
title: 学习中心
summary: NovelFork Studio 学习中心索引，快速找到你需要的文档
tags: [索引, 目录, 学习中心]
routes:
  - /docs/learning
---

# NovelFork Studio 学习中心

> 从入门到精通，按需查阅。每篇文档独立成文，可按任意顺序阅读。

---

## 文档索引

| # | 文档 | 摘要 | 标签 |
|---|------|------|------|
| 00 | [一页理解 NovelFork](./00-overview.md) | NovelFork 是什么、核心心智模型、三栏布局、推荐使用流程 | `入门` `概览` `心智模型` |
| 01 | [作品与章节管理](./01-book-management.md) | 创建作品、管理章节、资源树结构、驾驶舱总览、导入导出 | `作品` `章节` `资源树` `驾驶舱` |
| 02 | [AI 写作功能](./02-ai-writing.md) | 写作模式、AI 动作、选区变换、行内续写、候选稿流程、上下文组装 | `AI写作` `候选稿` `续写` `审校` |
| 03 | [引导式生成](./03-guided-generation.md) | PGI 追问机制、问题类型、Guided Plan、完整生成流程 | `PGI` `引导式生成` `问卷` |
| 04 | [叙述者对话](./04-narrator-conversation.md) | 会话界面、状态栏、Slash 命令、确认门、消息操作、会话恢复 | `叙述者` `对话` `Slash命令` `确认门` |
| 05 | [故事经纬](./05-story-jingwei.md) | 经纬分区与条目、可见性规则、模板、AI 上下文参与 | `经纬` `世界观` `设定` `可见性` |
| 06 | [设置与套路](./06-settings-and-routines.md) | 供应商配置、设置面板、套路系统、套路 Tab、继承机制 | `设置` `供应商` `套路` `MCP` |
| 07 | [写作工具](./07-writing-tools.md) | 章末钩子、段落节奏、对话比例、全书健康、矛盾地图、角色弧线、文风检测 | `写作工具` `分析` `健康度` |
| 08 | [Agent 写作管线](./08-agent-pipeline.md) | PipelineRunner 核心引擎、Agent 角色、工具链、多 Agent 编排、确认门与安全 | `Agent` `Pipeline` `管线` `编排` |
| 09 | [Agent 设置](./09-agent-settings.md) | 模型默认值、子代理模型池、推理强度、运行时控制 | `Agent` `设置` `模型` `推理` |
| 10 | [代理设置](./10-proxy-settings.md) | 供应商代理、WebFetch 代理、平台代理配置 | `代理` `网络` `代理服务器` |
| 11 | [使用历史](./11-usage-history.md) | Token 用量追踪、费用统计、按供应商/模型分组 | `用量` `费用` `历史` |
| 12 | [外观设置](./12-appearance.md) | 主题切换、OLED 模式、字体、终端外观 | `主题` `外观` `字体` |
| 13 | [运行时能力](./13-runtime-capabilities.md) | CLAUDE.md 读取、LLM 压缩摘要、Staleness check、文件 Dedup | `运行时` `压缩` `规则` `安全` |
| 14 | [子代理系统](./14-subagent-system.md) | 四种子代理类型、自定义代理、后台任务、Fork 模式 | `子代理` `后台` `Fork` `Await` |
| 15 | [工具搜索与技能](./15-tool-search-and-skills.md) | ToolSearch、Skill 加载、工具过滤、权限控制、MCP | `工具` `技能` `MCP` `权限` |
| 16 | [安全与沙箱](./16-security-and-sandbox.md) | 沙箱模式、目录白名单、命令白名单、权限模式 | `安全` `沙箱` `白名单` `权限` |
| 17 | [浏览器与终端](./17-browser-and-terminal.md) | Browser 截图交互、Terminal 持久化进程 | `浏览器` `终端` `截图` `QA` |
| 18 | [网络工具](./18-web-tools.md) | WebSearch、WebFetch 四种模式、代理配置 | `网络` `搜索` `抓取` `代理` |

---

## 按场景查找

### 我是新用户

1. 先读 [00-overview](./00-overview.md) 建立整体认知
2. 再读 [01-book-management](./01-book-management.md) 创建第一个作品
3. 然后读 [04-narrator-conversation](./04-narrator-conversation.md) 学会与叙述者对话

### 我想了解 AI 写作

1. [02-ai-writing](./02-ai-writing.md) — 所有 AI 写作能力概览
2. [03-guided-generation](./03-guided-generation.md) — 引导式生成的完整流程
3. [08-agent-pipeline](./08-agent-pipeline.md) — 底层 Agent 管线原理

### 我想管理世界观

1. [05-story-jingwei](./05-story-jingwei.md) — 经纬系统完整指南

### 我想配置系统

1. [06-settings-and-routines](./06-settings-and-routines.md) — 供应商和套路配置
2. [16-security-and-sandbox](./16-security-and-sandbox.md) — 安全与沙箱设置

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
| 经纬 | Jingwei | 世界观/设定的结构化存储系统 |
| 叙述者 | Narrator | AI 对话助手 |
| 候选稿 | Candidate | AI 生成的待审阅草稿 |
| 确认门 | Confirmation Gate | 写入正式资源前的审批机制 |
| PGI | Pre-Generation Interview | 生成前追问 |
| 套路 | Routines | Agent 行为规则集 |
| 管线 | Pipeline | 多 Agent 协作的执行流程 |
| 驾驶舱 | Cockpit | 作品状态总览面板 |
| 真相文件 | Truth Files | 经纬条目的只读快照 |

---

## 贡献

学习中心文档位于 `docs/learning/` 目录。如需补充或修正，请直接编辑对应文件。
