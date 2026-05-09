---
title: 引导式生成（PGI + Guided Plan）
summary: 写新章前的追问机制、问题类型、引导式计划、完整生成流程
tags: [PGI, 引导式生成, 问卷, Guided Plan, 追问]
routes:
  - /workbench/:bookId/conversation/:sessionId
---

# 引导式生成（PGI + Guided Plan）

> 引导式生成是 NovelFork 的核心交互模式：AI 先追问、再规划、再生成，确保输出符合你的意图。

---

## 核心概念

### PGI（Pre-Generation Interview）

PGI 是"生成前追问"机制。当你请求写新章时，AI 不会直接开始写，而是先提出一系列问题：

- 本章的核心冲突是什么？
- 哪些角色出场？
- 情绪基调如何？
- 有没有必须包含的伏笔？

你的回答会成为 AI 生成的精确指导。

### Guided Plan

Guided Plan 是 AI 基于你的回答生成的"写作计划"。它是一个结构化的步骤列表，描述 AI 打算如何组织这一章的内容。你可以：

- **批准**：同意计划，开始生成
- **拒绝**：不满意，要求重新规划
- **修改**：调整部分步骤后批准

---

## 问题类型

PGI 支持以下问题类型：

| 类型 | 组件 | 说明 |
|------|------|------|
| text | 文本输入框 | 自由文本回答 |
| single | 单选列表 | 从选项中选一个 |
| multi | 多选列表 | 从选项中选多个 |
| ranged-number | 数字滑块 | 在范围内选择数值 |
| ai-suggest | AI 建议 + 文本 | AI 给出建议，你可以采纳或修改 |

### 问题结构

每个问题包含：

```typescript
{
  id: string;          // 唯一标识
  prompt: string;      // 问题文本
  type: "text" | "single" | "multi" | "ranged-number" | "ai-suggest";
  options?: string[];  // 选项列表（single/multi 类型）
  reason?: string;     // 为什么问这个问题
  required?: boolean;  // 是否必答
  aiSuggestion?: string; // AI 的建议答案
}
```

---

## UserQuestionGate 组件

UserQuestionGate 是 PGI 的前端渲染组件，出现在叙述者对话中：

### 交互方式

1. AI 发送一组问题 → UserQuestionGate 渲染
2. 你逐个回答问题
3. 点击"提交回答" → 答案发送给 AI
4. 或点击"跳过" → 使用默认值/AI 自行决定

### 视觉表现

- 问题卡片带有图标标识类型
- 单选/多选有高亮选中状态
- 文本输入支持多行
- 提交按钮在所有必答题完成后激活

---

## Guided Plan 流程

### GuidedPlanCard

AI 生成计划后，以 GuidedPlanCard 形式展示：

```
┌─────────────────────────────────┐
│ 引导式计划                       │
│                                 │
│ 1. 以主角晨练开场，引入新角色     │
│ 2. 通过对话揭示门派内部矛盾      │
│ 3. 突发事件打断日常，制造悬念     │
│ 4. 以主角做出关键决定收尾        │
│                                 │
│ [批准]  [修改]  [拒绝]           │
└─────────────────────────────────┘
```

### 操作

| 操作 | 效果 |
|------|------|
| 批准 | AI 按计划开始生成正文 |
| 修改 | 编辑步骤后重新提交 |
| 拒绝 | AI 重新规划（可能再次追问） |

---

## 完整流程

### 标准写作流程

```
驾驶舱 "生成下一章"
        ↓
叙述者发起 PGI 追问
        ↓
用户回答问题（UserQuestionGate）
        ↓
AI 生成 Guided Plan
        ↓
用户批准/修改/拒绝（GuidedPlanCard）
        ↓ 批准
AI 生成候选稿
        ↓
候选稿出现在画布中
        ↓
用户审阅 → 接受/拒绝
```

### 简化流程（续写草稿）

```
"续写草稿" → AI 直接生成（跳过 PGI + Guided Plan）→ 草稿
```

---

## Tier 1 问卷

Tier 1 问卷是建书时的引导式设定，通过 QuestionnaireWizard 组件实现：

### 触发时机

创建新作品后自动弹出。

### 问卷内容

- 作品核心卖点是什么？
- 主角的核心驱动力？
- 世界观的独特之处？
- 目标读者群体？
- 参考作品有哪些？

### 作用

Tier 1 问卷的回答会：
1. 写入经纬系统作为基础设定
2. 影响后续 PGI 的问题方向
3. 作为 AI 写作的全局上下文

---

## 确认门机制

PGI 和 Guided Plan 都通过确认门（ConfirmationGate）实现：

```typescript
interface ConversationConfirmation {
  id: string;
  title: string;
  summary?: string;
  questions?: ConversationConfirmationQuestion[];  // PGI 问题
  operations?: ConversationConfirmationOperation[]; // 可执行操作
  risk?: string;  // 风险等级
}
```

确认门确保 AI 不会在未经你同意的情况下写入正式资源。

---

## 最佳实践

- **认真回答 PGI**：回答越详细，生成质量越高
- **不要总是跳过**：跳过 PGI 等于让 AI 自行决定，结果可能偏离预期
- **善用 ai-suggest**：AI 的建议通常是合理的起点，在此基础上修改更高效
- **审阅 Guided Plan**：计划是你最后的把关机会，发现问题及时修改
- **Tier 1 问卷要认真填**：它影响整本书的 AI 理解基础

---

## 常见坑

| 问题 | 原因 | 解决 |
|------|------|------|
| PGI 问题太多 | AI 对当前状态不确定 | 补充经纬设定，减少 AI 的不确定性 |
| Guided Plan 太笼统 | PGI 回答太简短 | 回答时多给细节 |
| 跳过后生成质量差 | 缺少指导信息 | 不要跳过，至少回答核心问题 |
| 计划被拒绝后循环 | AI 无法理解你的意图 | 用自然语言在对话中补充说明 |

---

## 可跳转入口

| 功能 | 路径 |
|------|------|
| 叙述者对话 | `/workbench/:bookId/conversation/:sessionId` |
