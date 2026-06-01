# 统一写作管线 - 需求文档

**版本**: v1.0.0
**创建日期**: 2026-05-20
**状态**: draft

---

## 问题陈述

NovelFork 有两套写作体系：

- **Pipeline**（17 个 Agent class）：完整的规划→生成→审计→修订→经纬同步流程，但不跟用户交互，几乎没人用
- **对话模式**（8 个 prompt 角色 + 28 个 session 工具）：用户日常主路径，但 LLM 裸写正文，无审计、无自动经纬同步、上下文注入残缺

两套体系代码上零交集。Pipeline 的质量保障能力（Auditor 37 维度审计、Writer 双阶段生成、Reviser 5 模式修订、StateValidator 经纬校验）在对话模式中完全缺失。

---

## 目标

将 Pipeline 的核心能力封装为对话模式可调用的工具，使用户在对话中写章时自动获得：
- 完整经纬上下文组装（Composer）
- 结构化章节规划（Planner）
- 质量审计（Auditor）
- 自动修订（Reviser）
- 经纬自动同步（Writer settle + StateValidator）

同时保留对话模式的交互优势：用户可在规划阶段确认方向、在交付阶段审阅修改。

---

## 需求

### R1: 新增 session 工具 `pipeline.generate_chapter`

**R1.1** 注册一个新的 session tool `pipeline.generate_chapter`，risk 为 `draft-write`，scope 为 `novel`。

**R1.2** 输入 schema：
```
{
  bookId: string (required)
  chapterIntent: string (required) — 章节写作意图/方向描述
  userDirectives: string (optional) — 用户对 PGI 问题的回答，格式化后的指示
  wordCount: number (optional) — 目标字数，默认从 book config 读取
  autoRevise: boolean (optional) — 是否自动修订审计不过的问题，默认 true
}
```

**R1.3** 该工具内部按顺序执行：
1. 调用 Composer 组装上下文包（lorebook RAG + 规则栈 + 预设注入）
2. 调用 Writer 生成正文（creative 阶段）
3. 调用 Writer settle 阶段提取经纬变更
4. 调用 Auditor 审计（37 维度）
5. 如果审计有 critical 且 autoRevise=true，调用 Reviser 修订（最多 2 轮）
6. 调用 StateValidator 验证经纬一致性

**R1.4** 输出：
```
{
  ok: true
  content: string — 最终正文
  title: string — 章节标题
  wordCount: number
  auditResult: { passed, issues[], summary }
  revised: boolean
  jingweiDelta: { updated[], created[], warnings[] }
  artifact: CanvasArtifact — 候选稿 artifact，前端可直接在画布打开
}
```

**R1.5** 生成过程支持流式输出——正文生成时通过 `session:stream` 实时推送到前端。

**R1.6** 执行失败时返回结构化错误（LLM 配置缺失 / 书籍不存在 / 超时），不抛异常。

---

### R2: 改造 writer agent prompt

**R2.1** writer agent 的 system prompt 中，"生成章节"流程改为：
1. cockpit.get_snapshot
2. jingwei.read_context
3. pgi.generate_questions → AskUserQuestion
4. 收到用户回答后，调用 `pipeline.generate_chapter`（而非自己裸写）
5. 将结果（审计报告 + 经纬变更）呈现给用户

**R2.2** 保留 LLM 直接写短文本的能力——当用户要求"写一段描述"、"帮我改这句话"等非整章任务时，不走 pipeline，LLM 直接输出。

**R2.3** `pipeline.generate_chapter` 的 `chapterIntent` 参数由 LLM 根据 cockpit 快照 + 用户回答自行组装。

---

### R3: candidate.accept 后自动经纬同步

**R3.1** 当用户通过 CandidateActionsBar 接受候选稿时，如果该候选稿是由 `pipeline.generate_chapter` 生成的，自动执行 `jingweiDelta` 中的经纬更新。

**R3.2** 经纬更新通过 `jingwei.upsert_entry` 批量执行，不依赖 LLM 记得调用。

**R3.3** 如果用户在画布中编辑了候选稿正文后再接受，标记 `jingweiDelta` 为"可能过期"，提示用户是否仍要应用。

---

### R4: 审计报告前端呈现

**R4.1** `pipeline.generate_chapter` 返回的 `auditResult` 在对话面板中以结构化卡片展示：
- 通过/不通过状态
- issues 按 severity 分组（critical / warning / info）
- 每个 issue 显示 category + description + suggestion

**R4.2** 如果审计不通过且未自动修订（autoRevise=false 或修订后仍不通过），在对话中提示用户可选操作：
- "一键修订"（调用 Reviser）
- "忽略并接受"
- "重新生成"

---

### R5: 经纬上下文注入（前置依赖）

依赖 `context-and-presets-overhaul` spec 的 P0-P2 完成：
- 对话模式使用 `buildJingweiContext()` 替代粗暴 SQL
- 预设 prompt 注入到 context
- Chapter Briefing + 递归摘要注入

---

### R6: 不改变的部分

- 8 个对话 Agent 角色分工不变
- 候选稿机制不变（AI 结果先进候选区）
- 异步 Pipeline API（`POST /api/books/:id/write-next`）保留，作为 CLI / 批量入口
- 选区写作（续写/扩写/桥接）、对话生成、变体生成等轻量操作保持现状
- CandidateActionsBar 的 UI 交互不变

---

## 验收标准

1. 用户在 writer agent 对话中说"写下一章"→ 经过 PGI 确认 → 调用 `pipeline.generate_chapter` → 候选稿 + 审计报告呈现
2. 审计报告在对话中可见，包含 passed/issues/summary
3. 候选稿接受后，经纬自动更新（不依赖 LLM 手动调 jingwei.upsert_entry）
4. 生成过程有流式输出，用户能看到进度
5. 审计不通过时用户有明确的操作选项
6. 非整章写作任务（写一段、改一句）不受影响，LLM 仍可直接输出
