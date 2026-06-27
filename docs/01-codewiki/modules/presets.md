**版本**: v3.0.0
**创建日期**: 2026-06-26
**更新日期**: 2026-06-26
**状态**: current
**文档类型**: current

# Presets / Templates / Beats

## 职责

保存用户可编辑的写作配置：风格预设、模板、节拍、合规偏好和流程参数。

## 真实代码路径

- `packages/studio/src/api/routes/presets.ts`
- `packages/novel-plugin/src/pages/writing-config/WritingConfigSection.tsx`
- `packages/novel-plugin/src/handlers/tool-registry.ts`
- `packages/studio/src/api/lib/session-tool-executor.ts`

## 主要入口

- `presets.read` / `presets.write` / `presets.check_compliance` 工具。
- `style.import` 工具：生成待确认的预设建议，不自动写入 `style_profile.json` 或 `style_guide.md`。
- `POST /api/books/:id/style/import`：返回 `preset-suggestion`。

## 输入 / 输出

- 输入：参考文本、配置名称、预设内容、合规要求。
- 输出：写作预设、风格建议、检查结果。

## 当前问题

- 风格提取结果不是事实，也不是叙事记忆；必须经用户确认后保存为预设。

## 维护规则

1. 配置层内容必须用户可编辑。
2. 自动分析结果只能作为建议。
3. 不把 style 结果写入 Narrative Memory。
4. 不把 style 结果自动写入静态 Lore。
