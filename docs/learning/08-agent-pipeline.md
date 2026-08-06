---
title: Agent 写作管线
summary: write.preflight 硬门、scene.spec 蓝图、pipeline.write 正文与章后结算的完整工具链
tags: [Agent, Pipeline, 工具层, 写作, 正式章节, 叙事记忆, 写前预检]
routes:
  - /next/narrators/:id
---

# Agent 写作管线

> NovelFork 的写作不是一个隐藏黑盒，而是 Agent 按固定工具链逐步完成：先过写前硬门，再生成蓝图，最后写正式章节结果。

## 权威链路

```
用户请求写下一章
  → write.preflight            ← 硬门：不通过就停下，不许先写
  →（缺上下文时）memory.settle_range / outline.volume
  → pgi.ask（意图仍模糊时）
  → scene.spec(userDirectives = resolvedDirective)
  → pipeline.write
  → 正式章节结果 + 章后自动结算
  →（发布前）publish.check
```

**核心原则**：

- **写前硬门不可跳过**。`write.preflight` 组装最小上下文包并做机器校验；`ok=false` 时必须停下报告缺什么，不能凭想象补前情。
- Agent 本身就是调度器；工具链顺序由系统提示词约束。
- 写作结果进入正式章节结果，不创建 candidate/draft 主对象。
- 静态设定从 `lore.*` 读取；动态事实从 `memory.*` 读取。
- 写后变化先进入 pending 队列，由用户确认，避免 AI 自动污染 canon。

## `write.preflight` 拦什么

| 阻断项 | 含义 | 解法 |
|--------|------|------|
| `missing-directive` | 没有本章目标，且焦点也推不出默认句 | 补一句本章要发生什么 |
| `empty-recent-progress` | 已有章节进度，但近章摘要/记忆为空 | `memory.settle_range` 回填；废稿先 `chapter.discard_range` |
| `high-risk-pending` | 存在高风险待确认事件 | 先在经纬工作区「进度」分区确认或驳回 |
| `skills-not-acknowledged` | 本书已启用 Writing Skills，但没提交原文引用 | 逐个读 `.novelfork/skills/<slug>/SKILL.md`，把一段 ≥30 字原文放进 `acknowledgedSkills` |
| `book-not-found` | 书籍绑定无效 | 检查 bookId |

告警（不阻断，但要看）：`short-directive`、`focus-default-only`、`empty-chapter-summary`、`hooks-overdue`、`style-disabled`、`volume-focus-missing`、`platform-target-mismatch`。

每条拦截和告警都带 `explanation` 三段式（发生了什么 / 为什么要看 / 建议怎么做）。**前端与叙述者不得按 code 自造文案**，直接转述 explanation。

`needsUserConfirm=true` 表示只有焦点默认目标、没有用户明确指示：需要用户确认，或显式传 `acceptFocusDefault=true`。

## 可用写作工具

| 工具 | 用途 | 风险等级 |
|------|------|---------|
| `write.preflight` | 写前硬门：组装最小上下文包并拦截缺失输入 | read |
| `cockpit.snapshot` | 获取当前书籍、章节和资源状态快照 | read |
| `lore.read` | 读取作者确认的静态 Lore（brief/category/search） | read |
| `memory.read` | 读取动态叙事记忆 ContextCard | read |
| `pgi.ask` | 生成写前追问，补齐本章意图 | read |
| `scene.spec` | 生成结构化写作蓝图 | read |
| `pipeline.write` | 按 sceneSpec 生成正式章节结果并进行质量机制处理 | draft-write |
| `memory.events` | 写后整理章节摘要、关系变化、伏笔推进为 pending 事件 | draft-write |
| `memory.settle_range` | 批量补结算历史章节的叙事记忆（填数据空洞） | confirmed-write |
| `chapter.discard_range` | 试写整段作废：从正史抹去章节结果与章域记忆 | destructive |
| `outline.volume` | 维护卷纲（get/suggest/set）；当前卷目标进入 preflight | read/write |
| `arc.character` | 查角色弧停滞或回退 | read |
| `book.dissect` | 拆已有旧书为续写知识包（产物为待确认档） | read/write |
| `publish.check` | 发布前平台自检（敏感词/AI 率/格式/连续性） | read |
| `chapter.audit` | 整章规则审计（不调模型） | read |
| `rewrite.segment` | 对选中段落执行续写/扩写/风格改写（`continue`、`expand`、`restyle`） | read/write |
| `rewrite.apply` | 按行范围把改写结果写回正文 | confirmed-write |
| `writing-skills.check_compliance` | 按启用技能校验正文，硬性违规阻断保存 | read |

去 AI 味没有独立工具：Writer 写作纪律已内置铁律，作者侧叠加 story-deslop Writing Skill。原修订管线工具与选段的去 AI 味模式与之重复，已下线。

## `pipeline.write` 内部做什么？

对外看是一次工具调用，内部会执行：

1. 写前硬门：`write.preflight` 上下文门、Writing Skills 原文引用确认门（`skills-not-acknowledged`）、高风险 pending 事件策略、情节点预算复核（预算判 block 时直接返回 `beat-budget-invalid`，不浪费一次生成）。
2. 组装 ContextCard：整合 sceneSpec、Lore、动态记忆、前文。Writing Skills 不走这条通道，由叙述者自己读 `.novelfork/skills/`。
3. WriterAgent 三段式生成：creative → observer → settler。
4. 质量检查：长度治理、动态词频提示、AI 痕迹规则维度。
5. ContinuityAuditor / adversarial audit：连续性、叙事、文本多视角审查。
6. Severity Gate：S1 阻断、S2 修订、S3/S4 警告。
7. 保存前按启用技能做合规校验：硬性违规 `writing-skill-compliance-failed` 不保存，warning 级逐条进 `publishHint.warnings`。
8. 生成正式章节 artifact，供前端画布审阅。

单章内部会发起多次模型调用（创作、状态结算、审计、必要时修订与长度归一化），对调用方是一次请求一次返回，无法中途介入。

Writing Skills 的生效不靠提示词自觉：写前要交原文引用（≥30 字、必须是 SKILL.md 里的连续片段），写后按技能规则硬校验。两头都是机制，中间不猜。

返回值里的可观测字段：

- `publishHint.warnings`：逐条列出违反了哪个技能的哪条要求。
- `settlementError`：正文已保存但章后结算失败，需对该章 `memory.settle_range` 补结算。正文不会因结算失败被丢弃。

## 正式章节结果机制

```
pipeline.write → chapterId → 画布展示 → 正式章节继续编辑
```

- 正式章节结果附带 artifact，可在写作画布直接打开审阅。
- 正式章节写入由用户裁决，不由 AI 自动覆盖。

## 上下文组装优先级

1. Scene Spec 蓝图（本章目标与硬约束）
2. Lore / 经纬静态设定（canon/rules/reference）
3. Narrative Memory 动态 ContextCard（facts/timeline/hooks/state/style/semantic）
4. 前文摘要与驾驶舱快照
5. PGI 用户回答与作者指示
6. 低优先级风格/预设/节拍提示

## 错误处理

| 错误码 | 含义 | 处理 |
|--------|------|------|
| `book-not-found` | 书籍 ID 无效 | 检查 bookId |
| `llm-config-missing` | API Key 未配置 | 前往设置配置供应商 |
| `generation-failed` | LLM 调用失败 | 检查模型、fallback 与重试规则 |
| `timeout` | 生成超时 | 降低字数要求或换模型 |
| `spec-invalid` | Scene Spec 格式错误 | 补齐角色、地点、冲突、结果等字段 |

## 常见坑

- **跳过 `write.preflight` 直接写** → 错误。上下文没就绪时写出来的是编造的前情，返工成本比停一下高得多。
- **preflight 报 `empty-recent-progress` 却继续写** → 错误。先回填记忆，或确认那些章其实是废稿。
- **给废稿养正史** → 错误。整段作废用 `chapter.discard_range`，不要用 `memory.settle_range` 把废稿结算进正史。
- **跳过 `lore.read` / `memory.read`** → 容易丢静态设定或动态事实。
- **把写后事实写进 Lore** → 错误。章节摘要、关系变化、伏笔推进默认走 `memory.events`。
- **把机器抽取结果直接当 canon** → 错误。`book.dissect` 产物写 `needs-review`，作者确认后才升 canon。
- **PGI 无问题就停住** → 错误。应记录 `skippedReason=no-questions` 并继续 scene.spec。
- **按 code 自造拦截文案** → 错误。转述 `explanation` 三段式。

## Agent 查阅提示

- 写前入口：`write.preflight`（硬门，先于一切生成）。
- 管线入口：`pipeline.write(sceneSpec)`。
- 上下文入口：`lore.read + memory.read`。
- 写后入口：`memory.events`；补历史用 `memory.settle_range`。
- 发布入口：`publish.check`。
- 安全原则：正式章节结果边界、用户确认、canon evidence 门禁。

## 可跳转功能入口

- 写作视图：写前就绪度、检查项与「生成蓝图 / 直接写章」在工作台侧栏「写作」中完成。 (/next/books/:bookId)
- 叙述者对话：工具调用、PGI 追问、scene.spec 审阅和章节结果查看都在对话/工作台中完成。 (/next/narrators/:id)
