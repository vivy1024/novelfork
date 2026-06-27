**版本**: v3.0.0
**创建日期**: 2026-06-26
**更新日期**: 2026-06-26
**状态**: current
**文档类型**: current

# Writing Workbench UI

## 职责

小说写作工作台 UI，承载章节编辑、经纬、叙事记忆、多版本、预设和资源树。

## 真实代码路径

- `packages/novel-plugin/src/pages/writing-workbench/WorkbenchCanvas.tsx`
- `packages/novel-plugin/src/pages/writing-workbench/ChapterActionsBar.tsx`
- `packages/novel-plugin/src/pages/writing-workbench/VariantsPanel.tsx`
- `packages/novel-plugin/src/pages/writing-workbench/NarrativeMemoryPanel.tsx`
- `packages/novel-plugin/src/pages/writing-workbench/JingweiGraphWorkspace.tsx`
- `packages/novel-plugin/src/pages/writing-workbench/resource-viewers/ChapterEditor.tsx`
- `packages/studio/src/app-next/StudioNextApp.tsx`

## 主要入口

- `WorkbenchCanvas`：工作台容器。
- `ChapterEditor`：正式章节编辑。
- `VariantsPanel`：多版本生成与选择复制，不再调用 candidate apply。
- `NarrativeMemoryPanel`：动态记忆展示和操作。

## 当前问题

- UI 残留文案需持续搜索清理。
- 多版本比较/合并尚未完整产品化。

## 维护规则

1. 不展示候选稿/草稿作为推荐主流程。
2. 多版本 UI 与候选稿列表分离。
3. 章节编辑以正式章节为中心。
