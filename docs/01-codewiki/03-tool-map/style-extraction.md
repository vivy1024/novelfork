**版本**: v3.0.0
**创建日期**: 2026-06-25
**更新日期**: 2026-06-25
**状态**: current
**文档类型**: current

# 文风提取

## 定位

文风提取是分析工具，不是业务对象。

## 输入

- 用户选定文本
- 章节文本
- 外部参考文本

## 输出

- 文风摘要
- 语言特征
- 节奏特征
- 可转为预设的建议

## 用户流程

```text
提取文风
  → 返回 preset-suggestion
  → Agent 询问是否加入预设
  → 用户选择新增 / 覆盖 / 手动编辑
```

## 当前代码事实

- `packages/novel-plugin/src/routes/ai.ts` 的 `POST /api/books/:id/style/import` 返回 `suggestion.kind = "preset-suggestion"`，不再自动写入 `style_profile.json` 或 `style_guide.md`。
- `packages/studio/src/api/lib/session-tool-executor.ts` 的 `style.import` 工具返回 `kind: "preset-suggestion"`、`profile`、`styleGuide` 和 `nextActions`。
- `packages/novel-plugin/src/handlers/tool-registry.ts` 的工具描述明确：生成待确认的写作预设建议，不自动写 style 文件。

## 禁止事项

- 禁止自动把文风提取结果写成真理
- 禁止绕过用户确认修改预设
- 禁止把文风结果写入叙事记忆

## 归属

- 工具层：文风提取
- 配置层：写作预设 / 风格配置
