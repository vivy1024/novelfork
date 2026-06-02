---
title: Agent 写作管线
summary: 统一工具层架构——PGI 追问、SceneSpec 蓝图、pipeline.generate_chapter 全流程生成
tags: [Agent, Pipeline, 工具层, 写作, 候选稿]
routes:
  - /next/narrators/:id
---

# Agent 写作管线

> 所有写作通过统一的 Agent 工具层完成——没有 PipelineRunner，没有独立的管线调度器。Agent 直接调用工具链完成从追问到生成的全流程。

## 架构概述

NovelFork 的写作采用「工具层」模式：每个写作操作都是一个可被 Agent 调用的工具，Agent 按行为规范（system prompt）中定义的顺序串联它们。

```
用户请求 → cockpit.snapshot → pgi.ask → AskUserQuestion → scene.spec → pipeline.generate_chapter → 候选稿
```

**核心原则**：

- 没有独立的管线调度器。Agent 本身就是调度器。
- 所有生成结果先进入候选区，用户确认后才写入正式章节。
- 写作工具内部执行 Planner → Composer → Writer → Auditor → Reviser 五步，对外暴露为单一工具调用。

## 可用写作工具

| 工具 | 用途 | 风险等级 |
|------|------|---------|
| `pipeline.generate_chapter` | 完整写作管线：规划→上下文组装→生成→审计→修订→经纬同步→保存候选稿 | draft-write |
| `pipeline.write` | 精简管线（v2）：接受 scene.spec 蓝图，执行 Writer→AuditRevise 两步 | draft-write |
| `pipeline.revise` | 修订已有章节（polish/rewrite/rework/spot-fix/anti-detect） | draft-write |
| `pipeline.import_chapters` | 从 .txt/.md 文件按标题分割并导入章节 | draft-write |
| `rewrite.segment` | 对选定段落执行改写（续写/扩写/去AI味/风格改写） | read |
| `candidate.create_chapter` | 仅保存已有正文为候选稿（不生成、不审计、不修订） | draft-write |

## 完整写作流程

### 标准链路：pipeline.generate_chapter

```
1. cockpit.snapshot        → 了解书籍进度、伏笔、候选稿状态
2. jingwei.read            → 读取经纬核心包和分类目录
3. pgi.ask                 → 生成 2-5 个追问问题
4. AskUserQuestion         → 向用户展示追问（整个流程只调用一次）
5. scene.spec              → 根据用户回答生成结构化写作蓝图
6. jingwei.read(category)  → 按蓝图中的角色/地点补读经纬细节
7. pipeline.generate_chapter → 执行完整管线
```

### 精简链路：scene.spec → pipeline.write

适用于 Agent 已有结构化蓝图的场景，跳过内部 Planner/Composer，只执行 Writer + AuditRevise 两步。LLM 调用从 5 次降到 2 次。

```
scene.spec → pipeline.write(sceneSpec) → 候选稿
```

### pipeline.generate_chapter 内部流程

工具内部自动执行五步，对外表现为一次工具调用：

| 步骤 | Agent | 功能 |
|------|-------|------|
| 1 | PlannerAgent | 根据意图生成章节规划 |
| 2 | ComposerAgent | 组装上下文包（经纬+前文+预设+PGI） |
| 3 | WriterAgent | 生成正文（creative + settle） |
| 4 | ContinuityAuditor | 37 维度审计 |
| 5 | ReviserAgent | 自动修订严重问题（条件触发） |

额外步骤：StateValidator 校验经纬一致性 → 构建 jingweiDelta → 保存为候选稿资源。

## 候选稿机制

所有 AI 生成内容先进入候选区（writing-resource 存储），不直接覆盖正式章节：

```
pipeline.generate_chapter → candidateId → 画布展示 → 用户确认 → 正式入库
```

- `candidate.create_chapter` 只是底层保存工具——不生成正文、不审计、不修订
- `pipeline.generate_chapter` 是「写下一章」的正确入口
- 候选稿附带 artifact 引用，可在画布中直接打开审阅

## 上下文组装优先级

系统按固定顺序注入写作上下文：

1. 经纬条目（jingwei context）
2. 前文摘要（recursive summaries）
3. 驾驶舱快照（cockpit snapshot）
4. PGI 用户回答（author directives）
5. Scene Spec 蓝图（结构化约束）
6. 预设规则注入（preset promptInjection）

## 错误处理

| 错误码 | 含义 | 处理 |
|--------|------|------|
| `book-not-found` | 书籍 ID 无效 | 检查 bookId |
| `llm-config-missing` | API Key 未配置 | 前往设置配置供应商 |
| `generation-failed` | LLM 调用失败 | 检查模型可用性 |
| `timeout` | 生成超时 | 降低字数要求或换模型 |
| `spec-invalid` | Scene Spec 格式错误 | 确保包含 characters/location/conflict/outcome |

## 常见坑

- **用 candidate.create_chapter 写章节** → 错误用法。它只保存已有正文，不会生成内容。写下一章用 `pipeline.generate_chapter`
- **跳过 PGI 直接生成** → 质量下降。Agent 行为规范禁止跳过追问步骤
- **审计后未自动修订** → autoRevise 默认开启，但只修复 critical 级别问题
- **上下文溢出** → 经纬过大时自动截断，保留关键信息

## Agent 查阅提示

- 管线入口：Agent 在对话中按 system prompt 规定的顺序调用工具
- 核心工具：`pipeline.generate_chapter` / `pipeline.write` / `pipeline.revise` / `rewrite.segment`
- 候选稿保存后返回 `artifact` 对象，前端自动在画布中渲染
- 智能重试：429/502/503 指数退避，最多 3 次
- 安全原则：最小权限（默认只读）、可回退（候选区隔离）、透明（工具调用可见）、用户主权（随时中断）

## 可跳转功能入口

- 叙述者对话: 工具调用和候选稿审阅在对话中完成。 (/next/narrators/:id)
