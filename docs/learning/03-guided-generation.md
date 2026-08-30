---
title: 引导式生成
summary: AskUserQuestion 交互、scene.spec 蓝图批准
tags: [引导式生成, 追问, AskUserQuestion, scene.spec]
routes:
  - /next/narrators/:id
---

# 引导式生成

> 方向不明时用 AskUserQuestion 追问，再生成结构化蓝图让你确认，最后动笔。

## 核心概念

**AskUserQuestion**：AI 向用户展示问题卡片的工具。方向、视角、冲突或取舍不明确时弹出选择题/文本输入，用户回答后 Agent 继续执行。指令已经清楚时不要为了走流程而追问。

**scene.spec**：结构化写作蓝图生成工具。包含角色、地点、冲突、情绪、结果等约束，是 `pipeline.write` 的硬前置条件——也是你动笔前最后的方向把关点。

## 完整流程

```
用户请求（写下一章）
  → cockpit.snapshot（了解进度/伏笔/章节结果状态）
  → lore.read(scope=brief)（读静态设定核心包）
  → memory.read(purpose=write)（读动态叙事记忆）
  → 方向不明时 AskUserQuestion（整个流程只一次）；指令已清楚则跳过
  → 用户回答（如有）
  → scene.spec（生成结构化蓝图）
  → lore.read(scope=category) + memory.read（按蓝图补读静态设定与动态上下文）
  → pipeline.write（执行写作，传入 sceneSpec）
  → 正式章节结果（以 artifact 打开审阅）
```

## 推荐使用流程

1. 在叙述者对话中发起写作请求（如"写下一章"）
2. 方向不明时 AI 通过 AskUserQuestion 展示追问
3. 回答追问（越具体越好）
4. AI 生成 scene.spec 蓝图，审阅结构安排
5. 蓝图符合预期 → AI 执行 `pipeline.write` 生成正式章节结果
6. 不满意 → 说明修改方向，AI 重新规划

## 最佳实践

- 写作请求越具体，生成质量越高。"这章要写主角被背叛后的愤怒，3000字，以独白结尾"比"写下一章"好得多
- scene.spec 是你最后的方向把关机会，认真审阅

## Agent 查阅提示

- 不存在独立的 PGI / guided 工具层；计划确认 = AskUserQuestion + scene.spec
- 整章生成走 `pipeline.write`（传入 sceneSpec），产出正式章节结果
- AskUserQuestion 通过工具触发，前端渲染为选择卡片

## 可跳转功能入口

- 叙述者对话: AskUserQuestion 和 scene.spec 审阅在对话中完成。 (/next/narrators/:id)
