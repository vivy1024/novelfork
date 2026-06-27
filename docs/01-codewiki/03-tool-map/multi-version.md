**版本**: v3.0.0
**创建日期**: 2026-06-25
**更新日期**: 2026-06-25
**状态**: current
**文档类型**: current

# 多版本

## 定位

多版本是用户感知强的大功能域。

它不是候选稿的替代命名，而是版本生成、比较、选择、合并和结算流程。

## 输入

- 章节或片段
- 版本生成目标
- 风格或节拍参数
- 经纬参考
- 叙事记忆上下文

## 输出

- 多个版本
- 版本说明
- 差异信息
- 用户选择结果

## 必备能力

- 并排查看
- 差异高亮
- 局部合并
- 继续派生
- 选择一个版本
- 结算到正式章节

## 当前代码事实

- `packages/novel-plugin/src/routes/writing-modes.ts` 的 `variants/generate` 保留为多版本生成入口。
- `packages/novel-plugin/src/pages/writing-workbench/VariantsPanel.tsx` 已从调用 `writing-modes/apply` 改为“选中并复制”，避免把版本写入候选稿。
- `packages/novel-plugin/src/engine/agents/variant-generator.ts` 负责版本生成提示词和结果结构。

## 与叙事记忆关系

版本本身不是叙事事实。

只有当用户选择某个版本并让它成为正式章节变化时，才可能产生叙事记忆事件。

## 禁止事项

- 禁止把多版本实现成候选稿列表
- 禁止每个版本都自动进入叙事记忆
- 禁止多版本复活草稿中心
