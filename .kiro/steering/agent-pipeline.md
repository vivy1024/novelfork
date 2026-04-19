# Agent 管线设计

## 完整管线流程

```
首章：Architect → FoundationReviewer → Planner → Composer → Writer → PostWriteValidator → ContinuityAuditor → [Reviser] → StateValidator
续章：Planner → Composer → Writer → PostWriteValidator → ContinuityAuditor → [Reviser] → StateValidator
```

Reviser 仅在 ContinuityAuditor 发现 blocking issue 时触发。

---

## Agent 职责

| Agent | 类 | 输入 | 输出 |
|-------|-----|------|------|
| Architect | `ArchitectAgent` | BookConfig + externalContext | story_bible、volume_outline、book_rules、current_state、pending_hooks |
| FoundationReviewer | `FoundationReviewerAgent` | Architect 输出 | 审核意见（不通过则 Architect 重跑） |
| Planner | `PlannerAgent` | truth files + chapter_summaries + cadence 分析 | `runtime/intent_ch{N}.md`（ChapterIntent） |
| Composer | `ComposerAgent` | plan + lorebook + memory | `runtime/context_ch{N}.yaml` + `runtime/rule_stack_ch{N}.yaml` + `runtime/trace_ch{N}.yaml` |
| Writer | `WriterAgent` | context_package + rule_stack + lengthSpec | 章节正文 + RuntimeStateDelta（settler 输出） |
| PostWriteValidator | 内联函数 | 章节正文 | 跨章重复检测、段落长度漂移、AI tells 分析 |
| ContinuityAuditor | `ContinuityAuditor` | 章节正文 + truth files + genre profile | AuditResult（passed/issues） |
| Reviser | `ReviserAgent` | 章节正文 + audit issues | 修订后正文（5 种模式：polish/rewrite/rework/anti-detect/spot-fix） |
| StateValidator | `StateValidatorAgent` | RuntimeStateDelta | 验证状态一致性 |
| LengthNormalizer | `LengthNormalizerAgent` | 超长/过短章节 | 裁剪/扩写后正文 |
| ChapterAnalyzer | `ChapterAnalyzerAgent` | 完成章节 | 更新 chapter_summaries |

---

## Truth Files（真相文件）

位于 `books/<id>/story/`：

| 文件 | 用途 | 更新时机 |
|------|------|---------|
| `story_bible.md` | 世界观、角色、势力 | Architect 生成，手动可编辑 |
| `volume_outline.md` | 卷/章大纲 | Architect 生成，手动可编辑 |
| `book_rules.md` | 写作规则约束 | Architect 生成，手动可编辑 |
| `current_state.md` | 当前世界状态快照 | 每章 Writer settler 自动更新 |
| `particle_ledger.md` | 数值/资源账本 | 每章 Writer settler 自动更新 |
| `pending_hooks.md` | 伏笔追踪 | 每章 Writer settler 自动更新 |
| `chapter_summaries.md` | 已写章节摘要 | ChapterAnalyzer 自动追加 |
| `author_intent.md` | 作者创作意图 | 用户手写 |
| `current_focus.md` | 当前创作焦点 | 用户手写 |

`story/runtime/` 目录存放每章的中间产物（intent、context、rule_stack、trace），可重跑覆盖。

---

## 状态流转

章节完成后的 status：

- `ready-for-review` — 审计通过或修订后通过，正常状态
- `audit-failed` — 审计未通过且修订也未解决，需人工介入
- `state-degraded` — StateValidator 发现状态不一致，truth files 可能损坏

遇到 `state-degraded`：
1. 检查 `runtime/` 下的 delta 输出
2. 可用 `chapter-state-recovery.ts` 的恢复逻辑
3. 严重时需手动修正 truth files

---

## 模型覆盖

`novelfork.json` 或 `PipelineConfig.modelOverrides` 支持按 Agent 指定模型：

```json
{
  "modelOverrides": {
    "writer": "claude-sonnet-4-20250514",
    "planner": { "model": "gpt-4o", "temperature": 0.7 }
  }
}
```

Agent name 对应类的 `get name()` 返回值。

---

## 修改 Agent 的注意事项

1. 每个 Agent 继承 `BaseAgent`，通过 `this.chat()` 调用 LLM
2. Writer 的输出由 `writer-parser.ts` 解析，Settler 的输出由 `settler-delta-parser.ts` 解析 — 改 prompt 必须同步改 parser
3. ContinuityAuditor 的审计维度由 genre profile 的 flags 控制（如 `numericalSystem`、`powerScaling`）
4. 不要在 Agent 内部直接读写 truth files — 通过 PipelineRunner 协调
5. 新增 Agent 需在 `pipeline/runner.ts` 中注册调用点

---

## 审计维度（ContinuityAuditor）

17 个检查维度，按 genre profile 启用：

1. OOC检查 2. 时间线 3. 设定冲突 4. 战力崩坏 5. 数值检查
6. 伏笔检查 7. 节奏检查 8. 文风检查 9. 信息越界 10. 词汇疲劳
11. 利益链断裂 12. 年代考据 13. 配角降智 14. 配角工具人化
15. 爽点虚化 16. 台词失真 17. 流水账
