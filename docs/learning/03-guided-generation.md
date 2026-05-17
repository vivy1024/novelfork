---
title: 引导式生成
summary: PGI 追问机制、Guided Plan 计划批准、完整生成流程
tags: [PGI, 引导式生成, 问卷, 计划批准]
routes:
  - /next/narrators/:id
---

# 引导式生成

> AI 先追问意图，再生成计划让你批准，最后动笔。

## 核心概念

**PGI（Pre-Generation Interview）**：生成前追问。AI 在动笔前先问 2-5 个问题，明确你对这章/段的期望——情绪基调、关键事件、字数要求等。

**Guided Plan**：AI 根据 PGI 回答生成章节计划（场景列表、节奏安排、伏笔处理），你审阅后批准才开始写作。

**UserQuestionGate**：AI 在执行过程中遇到不确定的决策时，弹出选择题让你决定方向。

完整流程：

```
用户请求 → PGI 追问 → 用户回答 → Guided Plan → 用户批准 → 生成候选稿
```

## 推荐使用流程

1. 在叙述者对话中发起写作请求（如"写下一章"）
2. AI 自动触发 PGI，回答追问（越具体越好）
3. AI 生成 Guided Plan，审阅场景安排和节奏
4. 批准计划 → AI 开始生成候选稿
5. 不满意计划 → 拒绝并说明修改方向，AI 重新规划

## 最佳实践

- PGI 回答越具体，生成质量越高。"这章要写主角被背叛后的愤怒，3000字，以独白结尾"比"写下一章"好得多
- 不确定时可以跳过 PGI（AI 会用 `skippedReason=no-questions` 继续），但质量会下降
- Guided Plan 是你最后的方向把关机会，认真审阅

## 常见坑

- **PGI 问题太多** → AI 判断信息不足时会多问，在经纬中补充设定可减少追问
- **Plan 被拒绝后 AI 仍然写了** → 不应发生，`guided.exit` 被拒绝后禁止执行 `candidate.create_chapter`
- **跳过 PGI 后质量差** → 正常现象，PGI 是质量保障的关键环节

## Agent 查阅提示

- PGI 工具链：`pgi.generate_questions` → `pgi.record_answers` → `pgi.format_answers_for_prompt`
- Guided Plan 工具链：`guided.enter` → `guided.answer_question` → `guided.exit`
- `guided.exit` 必须等用户批准；拒绝后禁止执行 `candidate.create_chapter`
- PGI 无问题时设置 `skippedReason=no-questions` 并继续后续流程
- UserQuestionGate 通过 `AskUserQuestion` 工具触发，前端渲染为选择卡片

## 可跳转功能入口

- 叙述者对话: PGI 追问和 Guided Plan 审批在对话中完成。 (/next/narrators/:id)
