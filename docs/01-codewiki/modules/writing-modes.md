**版本**: v3.0.0
**创建日期**: 2026-06-26
**更新日期**: 2026-06-26
**状态**: current
**文档类型**: current

# Writing Modes

## 职责

提供选段续写、扩写、桥接、润色、改写、对话生成、分支和多版本生成等写作体验入口。

## 真实代码路径

- `packages/novel-plugin/src/routes/writing-modes.ts`
- `packages/novel-plugin/src/engine/agents/inline-writer.ts`
- `packages/novel-plugin/src/engine/agents/variant-generator.ts`
- `packages/novel-plugin/src/pages/writing-workbench/VariantsPanel.tsx`
- `packages/studio/src/api/routes/writing-modes.test.ts`

## 主要入口

- `POST /api/books/:bookId/inline-write`：生成可复制/合并/明确应用到正式章节或多版本流程的正文。
- `POST /api/books/:bookId/writing-modes/execute`：对话/分支等模式。
- `POST /api/books/:bookId/variants/generate`：生成多版本结果。
- `POST /api/books/:bookId/writing-modes/apply`：已返回 410，不再写 candidate/draft。
- `POST /api/books/:bookId/candidates/create`：已返回 410。

## 输入 / 输出

- 输入：selectedText、contextBefore、contextAfter、instruction、mode、variant count。
- 输出：编辑结果正文或多版本数组；不自动创建候选稿/草稿。

## 当前问题

- 多版本比较、合并、回退仍是后续 UX 域，不在本清理任务中做完整重设计。

## 维护规则

1. 写作工具是 UX 入口，不是中间对象工厂。
2. apply 不得复活 candidate/draft 写入。
3. 多版本独立处理，不用候选稿列表替代。
4. 事实变化必须等正式章节结算后进入 Narrative Memory。
