---
title: 引导式生成
summary: PGI 追问机制、Guided Plan 计划批准、AskUserQuestion 交互
tags: [PGI, 引导式生成, 问卷, 计划批准, AskUserQuestion]
routes:
  - /next/narrators/:id
---

# 引导式生成

> AI 先追问意图，再生成计划让你批准，最后动笔。

## 核心概念

**PGI（Pre-Generation Interview）**：生成前追问。AI 在动笔前先问 2-5 个问题，明确你对这章/段的期望——情绪基调、关键事件、字数要求等。

**pgi.ask**：三合一工具，替代旧的 `pgi.generate_questions` / `pgi.record_answers` / `pgi.format_answers_for_prompt` 三步调用。生成追问 + 格式化为 AskUserQuestion 输入 + 记录回答。

**AskUserQuestion**：AI 向用户展示问题卡片的工具。PGI 生成的追问通过此工具呈现为选择题/文本输入，用户回答后 Agent 继续执行。

**Guided Plan**：AI 根据 PGI 回答生成章节计划（场景列表、节奏安排、伏笔处理），你审阅后批准才开始写作。

**scene.spec**：结构化写作蓝图生成工具。包含角色、地点、冲突、情绪、结果等约束，是 `pipeline.write` 的硬前置条件。

## 完整流程

```
用户请求
  → cockpit.snapshot（了解进度）
  → pgi.ask（生成追问）
  → AskUserQuestion（展示给用户）
  → 用户回答
  → scene.spec（生成蓝图）
  → pipeline.generate_chapter（执行写作）
  → 候选稿（等待确认）
```

## PGI 工具链

| 工具 | 功能 | 说明 |
|------|------|------|
| `pgi.ask` | 三合一追问工具 | 推荐。生成问题 + AskUserQuestion 格式 + 格式化回答 |
| `pgi.generate_questions` | 生成追问问题 | 返回问题卡片列表 |
| `pgi.record_answers` | 记录回答 | 支持 skippedReason: user-skipped / no-questions / unsupported |
| `pgi.format_answers_for_prompt` | 格式化为写作指示 | 将问答整理为 writer 可用的本章作者指示 |

## Guided Generation 工具链

| 工具 | 功能 | 风险等级 |
|------|------|---------|
| `guided.enter` | 进入引导模式，展示问题卡 | read |
| `guided.answer_question` | 记录用户回答 | draft-write |
| `guided.exit` | 提交计划，需确认 | confirmed-write |

`guided.exit` 被用户批准后状态变为 `executing`，允许执行 `candidate.create_chapter`。被拒绝后状态变为 `rejected`，禁止继续生成。

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
4. AI 生成 Scene Spec / Guided Plan，审阅结构安排
5. 批准 → AI 执行 pipeline.generate_chapter 生成候选稿
6. 不满意 → 拒绝并说明修改方向，AI 重新规划

## 最佳实践

- PGI 回答越具体，生成质量越高。"这章要写主角被背叛后的愤怒，3000字，以独白结尾"比"写下一章"好得多
- 不确定时可以跳过 PGI（AI 会用 `skippedReason` 继续），但质量会下降
- Scene Spec 是你最后的方向把关机会，认真审阅

## 常见坑

- **PGI 问题太多** → AI 判断信息不足时会多问，在经纬中补充设定可减少追问
- **Plan 被拒绝后 AI 仍然写了** → 不应发生。`guided.exit` 被拒绝后禁止执行 `candidate.create_chapter`
- **跳过 PGI 后质量差** → 正常现象，PGI 是质量保障的关键环节

## Agent 查阅提示

- PGI 推荐用 `pgi.ask`（三合一），兼容旧的 `pgi.generate_questions` → `pgi.record_answers` → `pgi.format_answers_for_prompt`
- Guided Plan 工具链：`guided.enter` → `guided.answer_question` → `guided.exit`
- `guided.exit` 必须等用户批准；拒绝后禁止执行 `candidate.create_chapter`
- PGI 无问题时设置 `skippedReason=no-questions` 并继续后续流程
- AskUserQuestion 通过工具触发，前端渲染为选择卡片

## 可跳转功能入口

- 叙述者对话: PGI 追问和 Guided Plan 审批在对话中完成。 (/next/narrators/:id)
