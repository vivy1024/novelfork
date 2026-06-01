# 功能缺口清单 — 归档 Spec 需求 vs 当前实现

> 生成日期：2026-05-10
> 来源：所有归档 spec 的 requirements.md 交叉比对当前代码

---

## 一、引导式 AI 生成（最高优先级）

### 1.1 PGI 用户回答交互组件 ⭐ 核心缺失

**来源**: claude-codex-novel-agent-v1 R8, onboarding-and-story-jingwei R11

**后端状态**: ✅ 已实现
- `pgi-tool-service.ts` — generateQuestions / recordAnswers / formatAnswersForPrompt
- `pgi-engine.ts`（core）— 基于经纬/伏笔/章节上下文生成 2-5 个追问
- 工具已注册到 session-tool-registry

**前端状态**: ❌ 缺失
- `PgiCard.tsx` 只展示问题列表，没有输入框/选项让用户回答
- 需要：问题卡片 + 文本输入/单选/多选 → 提交答案 → 调用 `pgi.record_answers`

**需要实现**:
- `PgiQuestionForm` 组件：根据问题类型（open/choice/multi-choice）渲染对应输入控件
- 集成到 ConversationSurface 或作为独立的 inline 交互块
- 用户回答后自动调用 `pgi.record_answers` 工具

### 1.2 Guided Plan 批准/拒绝/修改交互

**来源**: claude-codex-novel-agent-v1 R9, R11

**后端状态**: ✅ 已实现
- `guided-generation-tool-service.ts` — enter / answerQuestion / exit（含 decision）
- GuidedGenerationPlan 类型定义完整

**前端状态**: ⚠️ 部分
- `GuidedPlanCard.tsx` 只展示标题和步骤列表
- 缺少：批准/拒绝按钮、修改计划的编辑入口
- 需要与 ConfirmationGate 联动或独立实现

**需要实现**:
- `GuidedPlanReview` 组件：展示计划详情 + 批准/拒绝/修改按钮
- 批准后触发 `guided.exit` → 继续生成
- 拒绝后允许用户修改指示重新生成

### 1.3 Tier 1 问卷（建书引导）

**来源**: claude-codex-novel-agent-v1 R8, onboarding-and-story-jingwei R6

**后端状态**: ✅ 已实现
- `questionnaire-template-repo.ts` / `questionnaire-response-repo.ts`
- `submit-response.ts` / `ratify-questionnaire.ts` / `ai-suggest.ts`
- 内置模板（builtin.ts）

**前端状态**: ❌ 缺失
- 没有问卷 UI 组件
- 需要在创建书籍流程中嵌入可跳过的问卷

---

## 二、写作工具面板（中优先级）

### 2.1 章节钩子生成器

**来源**: writing-tools-v1 R1

**后端状态**: ✅ 有 hooks route（`/api/books/:bookId/hooks/generate`）
**前端状态**: ❌ 无独立 UI，只能通过对话触发

### 2.2 日更进度追踪

**来源**: writing-tools-v1 R3

**后端状态**: ⚠️ 有 analytics route 但无日更维度
**前端状态**: ❌ 无

### 2.3 段落节奏可视化

**来源**: writing-tools-v1 R4

**后端状态**: ❌ 无
**前端状态**: ❌ 无

### 2.4 对话比例分析

**来源**: writing-tools-v1 R5

**后端状态**: ❌ 无
**前端状态**: ❌ 无

### 2.5 全书健康仪表盘

**来源**: writing-tools-v1 R6

**后端状态**: ⚠️ 有 writing-tools route 但指标不完整
**前端状态**: ❌ 无独立面板

### 2.6 矛盾生命周期追踪

**来源**: writing-tools-v1 R7

**后端状态**: ❌ 无
**前端状态**: ❌ 无

### 2.7 角色弧线长程追踪

**来源**: writing-tools-v1 R8

**后端状态**: ❌ 无
**前端状态**: ❌ 无

### 2.8 题材文风一致性守护

**来源**: writing-tools-v1 R9

**后端状态**: ⚠️ 有 style/drift-check route
**前端状态**: ❌ 无独立 UI

---

## 三、Agent 管线增强（中优先级）

### 3.1 多 Agent 编排管线

**来源**: agent-writing-pipeline-v1 R5

**后端状态**: ⚠️ 有 workflow-executor 但未完整串联 Explorer→Planner→Writer→Auditor
**前端状态**: ❌ 无可见执行链 UI

### 3.2 Agent 上下文自动注入

**来源**: agent-writing-pipeline-v1 R3

**后端状态**: ⚠️ 有 context-assembly route，但不是自动注入到 Agent turn
**前端状态**: ❌ 无

### 3.3 CoreShift 提案机制

**来源**: claude-codex-novel-agent-v1 R8

**后端状态**: ❌ 无
**前端状态**: ❌ 无

---

## 四、驾驶舱增强（低优先级）

### 4.1 伏笔聚合 Tab

**来源**: longform-cockpit-v1 R3

**后端状态**: ✅ 有 cockpit/open-hooks route
**前端状态**: ❌ 无独立 Tab

### 4.2 设定 Tab

**来源**: longform-cockpit-v1 R4

**后端状态**: ⚠️ 经纬数据可用
**前端状态**: ❌ 无

### 4.3 AI 运行 Tab

**来源**: longform-cockpit-v1 R5

**后端状态**: ⚠️ 有 provider status route
**前端状态**: ❌ 无

---

## 五、Onboarding 与教学（低优先级）

### 5.1 首次欢迎弹窗

**来源**: onboarding-and-story-jingwei R1

**后端状态**: N/A
**前端状态**: ⚠️ 有 FirstRunDialog 但未验证完整性

### 5.2 开始使用任务清单

**来源**: onboarding-and-story-jingwei R2

**后端状态**: N/A
**前端状态**: ⚠️ 有 GettingStartedChecklist 但未验证

### 5.3 功能页空态教学

**来源**: onboarding-and-story-jingwei R9

**后端状态**: N/A
**前端状态**: ❌ 大部分空态只显示"暂无数据"

### 5.4 作者模式 vs 工作台模式

**来源**: onboarding-and-story-jingwei R10

**后端状态**: ❌ 无
**前端状态**: ❌ 无

---

## 六、对话增强（低优先级）

### 6.1 会话执行结果与用量统计

**来源**: conversation-parity-v1 R7

**后端状态**: ⚠️ 有 usage 字段但不完整
**前端状态**: ❌ 无独立展示

### 6.2 写作资源 checkpoint/rewind

**来源**: conversation-parity-v1 R6

**后端状态**: ✅ 有 checkpoint/rewind route
**前端状态**: ❌ 无 UI 触发入口

---

## 优先级排序建议

| 优先级 | 功能 | 理由 |
|--------|------|------|
| P0 | PGI 用户回答交互 | 引导式生成的核心缺失环节，后端已就绪 |
| P0 | Guided Plan 批准/拒绝 | 写下一章流程的关键交互，后端已就绪 |
| P1 | Tier 1 问卷 UI | 建书引导，后端已就绪 |
| P1 | 多 Agent 编排可见执行链 | 核心产品差异化 |
| P2 | 写作工具面板（钩子/节奏/对话比例） | 辅助工具 |
| P2 | 驾驶舱增强 Tab | 信息展示 |
| P3 | Onboarding 教学 | 用户体验 |
| P3 | CoreShift / checkpoint UI | 高级功能 |
