**版本**: v3.0.0
**创建日期**: 2026-06-26
**更新日期**: 2026-06-26
**状态**: partial
**文档类型**: current

# Multi-version UI

## 真实代码路径

- `packages/novel-plugin/src/pages/writing-workbench/VariantsPanel.tsx`
- `packages/novel-plugin/src/engine/agents/variant-generator.ts`
- `packages/novel-plugin/src/routes/writing-modes.ts`

## 当前语义

- `VariantsPanel` 调用 `variants/generate` 生成多个版本。
- “选中并复制”不再调用已返回 410 的 `writing-modes/apply`。
- 多版本结果是编辑/选择素材，不是候选稿列表。

## 待补能力

- 并排比较。
- 差异高亮。
- 局部合并。
- 回退与结算。
- 正式章节结算后触发 NarrativeEvent 回写。

## 维护规则

1. 多版本是独立 UX 域。
2. 不把每个版本自动写入 Narrative Memory。
3. 不以 candidate/draft 命名存储版本。
