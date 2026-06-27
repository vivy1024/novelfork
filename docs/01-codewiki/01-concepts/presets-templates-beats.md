**版本**: v3.0.0
**创建日期**: 2026-06-25
**更新日期**: 2026-06-25
**状态**: current
**文档类型**: current

# 预设 / 模板 / 节拍

## 定义

预设、模板、节拍属于创作配置层。

它们不是叙事事实，也不是正文结果，而是用户可编辑的创作参数。

## 包含内容

- 写作预设
- 风格配置
- 模板
- 节拍模板
- 类型规则
- 平台合规规则

## 与文风提取的关系

文风提取是工具，提取结果是建议。

建议流程：

1. 工具分析文本风格
2. 输出风格摘要和可配置建议
3. Agent 询问用户是否加入预设
4. 用户决定新增、覆盖或手动编辑预设

## 设计原则

1. 用户必须能手动编辑
2. LLM 不能自动把风格提取结果当作真理写入配置
3. 配置服务于写作工具，但不是叙事事实
4. 配置变化需要可回溯

## 相关代码

- `packages/novel-plugin/src/engine/presets/`
- `packages/novel-plugin/src/pages/writing-config/`
- `packages/novel-plugin/src/routes/writing-modes.ts`
- `packages/novel-plugin/src/pages/writing-workbench/PresetsPanel.tsx`

## 当前清理目标

- 明确配置层与叙事记忆分离
- 文风提取结果通过确认后进入预设
- 预设 / 模板 / 节拍保持用户可编辑
