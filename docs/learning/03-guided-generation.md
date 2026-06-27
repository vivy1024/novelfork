---
title: 引导式生成
summary: PGI 追问机制、AskUserQuestion 交互、scene.spec 蓝图批准
tags: [PGI, 引导式生成, 追问, AskUserQuestion, scene.spec]
routes:
  - /next/narrators/:id
---

# 引导式生成

> AI 先追问意图，再生成结构化蓝图让你确认，最后动笔。

## 核心概念

**PGI（Pre-Generation Interview）**：生成前追问。AI 在动笔前先问 1-3 个精准问题，明确你对这章的期望——情绪基调、关键事件、字数要求等。

**pgi.ask**：PGI 单一工具。一次调用完成：基于驾驶舱、静态 Lore 与动态叙事记忆判断是否需要追问 → 返回可供 AskUserQuestion 展示的问题卡。

**AskUserQuestion**：AI 向用户展示问题卡片的工具。PGI 生成的追问通过此工具呈现为选择题/文本输入，用户回答后 Agent 继续执行。整个写作流程只调用一次。

**scene.spec**：结构化写作蓝图生成工具。包含角色、地点、冲突、情绪、结果等约束，是 `pipeline.write` 的硬前置条件——也是你动笔前最后的方向把关点。

## 完整流程（v3.0.0）

```
用户请求（写下一章）
  → cockpit.snapshot（了解进度/伏笔/章节结果状态）
  → lore.read(scope=brief)（读静态设定核心包）
  → memory.read(purpose=write)（读动态叙事记忆）
  → pgi.ask（生成追问）
  → AskUserQuestion（展示给用户，整个流程只一次）
  → 用户回答
  → scene.spec（生成结构化蓝图）
  → lore.read(scope=category) + memory.read（按蓝图补读静态设定与动态上下文）
  → pipeline.write（执行写作，传入 sceneSpec）
  → 正式章节结果（以 artifact 打开审阅）
```

> 注：v1.7.0 之前存在独立的 `guided.enter / answer_question / exit` 与 `questionnaire.*` 工具层做"计划批准"，现已折叠——计划确认由 AskUserQuestion + scene.spec 承担，不再有单独的 guided 工具。

## 追问触发条件

PGI 基于启发式规则自动生成追问：

| 启发式 | 触发条件 | 追问内容 |
|--------|---------|---------|
| `conflict-escalating` | 检测到升级中的矛盾 | 本章是否继续升级或推向高潮 |
| `foreshadow-due` | 检测到临近回收的伏笔 | 本章是否兑现或延后 |
| 通用 | 信息不足时 | 确认写作方向、POV、情绪落点 |

无问题时设置 `skippedReason=no-questions` 并继续后续流程。

## 推荐使用流程

1. 在叙述者对话中发起写作请求（如"写下一章"）
2. AI 自动触发 PGI，通过 AskUserQuestion 展示追问
3. 回答追问（越具体越好）
4. AI 生成 scene.spec 蓝图，审阅结构安排
5. 蓝图符合预期 → AI 执行 `pipeline.write` 生成正式章节结果
6. 不满意 → 说明修改方向，AI 重新规划

## 最佳实践

- PGI 回答越具体，生成质量越高。"这章要写主角被背叛后的愤怒，3000字，以独白结尾"比"写下一章"好得多
- 不确定时可以跳过 PGI（AI 会用 `skippedReason` 继续），但质量会下降
- scene.spec 是你最后的方向把关机会，认真审阅

## 常见坑

- **PGI 问题太多** → AI 判断信息不足时会多问，在经纬中补充设定可减少追问
- **跳过 PGI 后质量差** → 正常现象，PGI 是质量保障的关键环节

## Agent 查阅提示

- PGI 用单一工具 `pgi.ask`（已合并旧三步）
- 不存在独立的 guided 工具层；计划确认 = AskUserQuestion + scene.spec
- 整章生成走 `pipeline.write`（传入 sceneSpec），产出正式章节结果
- PGI 无问题时设置 `skippedReason=no-questions` 并继续
- AskUserQuestion 通过工具触发，前端渲染为选择卡片

## 可跳转功能入口

- 叙述者对话: PGI 追问和 scene.spec 审阅在对话中完成。 (/next/narrators/:id)
