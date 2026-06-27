**版本**: v3.0.0
**创建日期**: 2026-06-26
**更新日期**: 2026-06-26
**状态**: current
**文档类型**: current

# Resource Viewers

## 真实代码路径

- `packages/novel-plugin/src/pages/writing-workbench/resource-viewers/index.tsx`
- `packages/novel-plugin/src/pages/writing-workbench/resource-viewers/ChapterEditor.tsx`
- `packages/novel-plugin/src/pages/writing-workbench/ResourceDetailLoader.ts`
- `packages/novel-plugin/src/pages/writing-workbench/ResourceSaveController.ts`

## 当前语义

- `ChapterEditor` 负责正式章节正文编辑。
- resource viewer 只负责展示/编辑资源，不决定 candidate/draft 生命周期。
- `ResourceSaveController` 负责保存动作协调。

## 维护规则

1. resource viewer 不创建新的候选稿/草稿对象。
2. 正式章节保存后，如事实变化，应通过 NarrativeEvent 流程处理。
3. UI 展示与存储语义分开。
