---
title: 引导式生成
summary: AI 先追问再规划再写，确保输出符合你的意图
tags: [PGI, Guided Plan, 追问, 生成]
routes:
  - /next/workbench/:bookId
---

# 引导式生成

> AI 先追问再规划再写，确保输出符合你的意图。

## 核心概念

**PGI（Pre-Generation Interview）** — 写新章前 AI 自动生成 2-5 个追问，覆盖冲突升级、伏笔回收、情绪基调、节奏控制四个维度。用户可逐题回答、跳过、或自定义补充。

**Guided Plan** — AI 基于你的回答生成结构化写作计划。用户必须批准计划后才会生成候选稿；拒绝计划后 AI 不得执行任何写入。

**UserQuestionGate** — PGI 的前端渲染组件，嵌入叙述者对话流中。支持 text / single / multi / ranged-number / ai-suggest 五种问题类型。

## 推荐使用流程

1. 在驾驶舱点击"生成下一章"
2. 叙述者发起 PGI 追问 → UserQuestionGate 渲染问题卡片
3. 回答问题（或跳过）→ 提交
4. AI 生成 Guided Plan → GuidedPlanCard 展示
5. 批准计划 → AI 生成候选稿 → 出现在画布中
6. 审阅候选稿 → 接受或拒绝

Agent 工具链：`cockpit.get_snapshot` → `pgi.generate_questions` → `guided.enter` → `guided.exit` → `candidate.create_chapter`

## 最佳实践

- 回答越详细，生成质量越高。至少回答核心冲突和情绪基调两题。
- 善用 ai-suggest 类型：AI 建议是合理起点，在此基础上修改更高效。
- Guided Plan 是最后把关机会，发现步骤不对立即拒绝重来。

## 常见坑

- **PGI 问题太多** — 经纬设定不足导致 AI 不确定性高。补充经纬条目可减少追问数量。
- **Guided Plan 太笼统** — PGI 回答太简短。多给细节，尤其是冲突走向和角色动机。
- **跳过后生成质量差** — 跳过等于让 AI 自行决定所有参数。至少回答必答题。
- **拒绝计划后死循环** — AI 无法理解你的意图。用自然语言在对话中直接补充说明。

## Agent 查阅提示

- PGI 问题由 `pgi.generate_questions` 工具生成，入参需要当前驾驶舱快照
- Guided Plan 审批状态通过 `guided.enter` / `guided.exit` 管理
- 用户拒绝计划后，必须重新走 PGI 或由用户手动补充指令，不得绕过审批直接写入
- 候选稿通过 `candidate.create_chapter` 创建，不是直接写入正式章节

## 可跳转功能入口

| 功能 | 路径 |
|------|------|
| 写作工作台 | `/next/workbench/:bookId` |
