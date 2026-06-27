**版本**: v3.0.0
**创建日期**: 2026-06-26
**更新日期**: 2026-06-26
**状态**: current
**文档类型**: current

# Writing Workbench

## 真实代码路径

- `packages/novel-plugin/src/pages/writing-workbench/WorkbenchCanvas.tsx`
- `packages/novel-plugin/src/pages/writing-workbench/WorkbenchResourceTree.tsx`
- `packages/novel-plugin/src/pages/writing-workbench/ChapterActionsBar.tsx`
- `packages/novel-plugin/src/pages/writing-workbench/useWorkbenchResources.ts`
- `packages/studio/src/app-next/StudioNextApp.tsx`

## 当前语义

- 工作台围绕正式章节、经纬、叙事记忆、预设和多版本展开。
- `ChapterActionsBar` 不再提供创建草稿/候选变体按钮。
- `StudioNextApp` 不再传递 candidate/draft action 作为主流程。

## 维护规则

1. 写作主流程 UI 不出现候选稿/草稿推荐入口。
2. 章节编辑、版本选择、记忆回写分别归位。
3. 新面板必须明确数据归属层。
