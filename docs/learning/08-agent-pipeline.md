---
title: Agent 写作管线
summary: 5 Agent 协作管线——规划、编排、写作、审计、修订，含并行执行与确认门机制
tags: [Agent, Pipeline, 管线, 编排, 工具链, 子代理]
routes:
  - /next/narrators/:id
---

# Agent 写作管线

> 5 Agent 协作管线——规划、编排、写作、审计、修订，含并行执行与确认门机制。

## 核心概念

NovelFork 的写作不是单次 API 调用，而是多 Agent 协作的管线：

```
用户请求 → PGI 追问 → 规划(Plan) → 编排(Compose) → 写作(Write) → 审计(Audit) → 修订(Revise) → 结算入库
```

**5 个 Agent 角色**：

| Agent | 职责 |
|-------|------|
| 写书 Agent | 生成章节正文，接收上下文包 + 规则栈 |
| 伏笔 Agent | 埋设/追踪/回收伏笔线索 |
| 章末钩子 Agent | 生成章末悬念方案 |
| 审校 Agent | 连续性审计，检测矛盾与设定冲突 |
| 大纲与经纬 Agent | 全书架构规划 + 经纬维护 |

**48 个工具**分为三大类：

**通用开发工具（26 个）**：Bash · Read · Write · Edit · Glob · Grep · EnterWorktree · ExitWorktree · AskUserQuestion · EnterPlanMode · ExitPlanMode · TaskCreate · WebSearch · WebFetch · Browser · Agent · Await · Send · ForkNarrator · Terminal · ShareFile · Recall · StartPipeline · EndPipeline · LearningGuide · Skill · GetGoals · AddGoal · UpdateGoal

**小说专属工具（17 个）**：cockpit.get_snapshot · cockpit.list_open_hooks · cockpit.list_recent_candidates · questionnaire.list_templates · questionnaire.start · questionnaire.suggest_answer · questionnaire.submit_response · pgi.generate_questions · pgi.record_answers · pgi.format_answers_for_prompt · guided.enter · guided.answer_question · guided.exit · candidate.create_chapter · narrative.read_line · narrative.propose_change

**核心管线工具（5 个）**：plan_chapter · compose_chapter · audit_chapter · revise_chapter · import_chapters

### 写下一章完整流程

```
用户: "写下一章"
    │
    ▼
1. cockpit.get_snapshot ← 读取进度/伏笔/设定
    │
    ▼
2. pgi.generate_questions ← 生成 2-5 个追问
    │
    ▼ 用户回答（或跳过）
3. guided.enter ← 进入引导式生成
    │
    ▼
4. guided.exit ← 提交写作计划
    ⚠️ 确认门：用户必须批准
    │
    ▼ 用户批准
5. candidate.create_chapter ← 生成候选稿
    ⚠️ 候选稿进入候选区，用户在画布中预览
```

**关键规则**：
- PGI 无问题时说明 `skippedReason=no-questions` 并继续
- `guided.exit` 必须等用户批准；拒绝后禁止执行 `candidate.create_chapter`
- 任一步失败时停止后续写入，保留已完成的只读结果

## 推荐使用流程

1. 在叙述者对话中发起写作请求
2. PGI（生成前追问）自动触发，回答追问明确写作意图
3. Guided Plan 生成章节计划，审阅后批准
4. 管线自动执行：编排上下文 → 生成正文 → 审校 → 修订
5. WorkflowProgressCard 实时展示执行链进度
6. 确认门在写入正式章节前暂停，审阅后批准入库

## 最佳实践

- 认真回答 PGI 追问，输入越精确输出质量越高
- 关注 WorkflowProgressCard 的审校步骤，审校发现的问题不要盲目跳过
- 不同 Agent 可配不同模型：Writer 用强模型保质量，Auditor 用快模型省成本
- 保持经纬完整——管线质量高度依赖经纬中的角色设定和世界观
- 执行异常时查看叙述者对话中的工具调用详情，定位失败环节

## 常见坑

- **管线中途失败** → API 超时或模型不可用，v0.4.0 智能重试会自动处理 429/502/503，持续失败检查供应商状态
- **审校误报过多** → 经纬设定不完整，审校 Agent 缺乏判断基准
- **工作流卡在 approval-pending** → 确认门等待用户操作，在对话中批准或拒绝即可继续
- **上下文溢出** → 章节过多导致上下文超限，v0.4.0 自动恢复机制会截断历史保留关键信息
- **子代理无响应** → 检查子代理模型池配置，Detach 后的子代理需要 Attach 才能交互

## Agent 查阅提示

- 管线入口：叙述者对话触发，PipelineRunner 调度
- 工具执行：v0.4.0 只读工具自动并行，写入工具串行 + 确认门
- 智能重试：429/502/503 指数退避，最多 3 次
- 上下文溢出恢复：自动截断早期消息，保留系统提示 + 最近 N 轮
- 子代理生命周期：Detach 分离到后台持久化，Attach 重新接入，MCP 工具自动继承父代理配置
- 确认门触发条件：写入正式章节、修改经纬、删除资源、执行修订
- 安全原则：最小权限（默认只读）、可回退（写入前自动 Checkpoint）、透明（工具调用对话可见）、用户主权（随时中断）
- WorkflowProgressCard 组件展示步骤状态：pending / running / success / failed / approval-pending

## 可跳转功能入口

| 功能 | 路径 |
|------|------|
| 叙述者对话（含工作流进度卡片） | `/next/narrators/:id` |
