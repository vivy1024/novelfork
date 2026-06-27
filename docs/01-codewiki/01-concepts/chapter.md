**版本**: v3.0.0
**创建日期**: 2026-06-25
**更新日期**: 2026-06-25
**状态**: current
**文档类型**: current

# 正式章节

## 定义

正式章节是 NovelFork 的结果层对象。

它是写作动作最终形成的稳定正文，不是候选稿 / 草稿状态机中的一个状态。

## 归属

- 层级：结果层
- 主存储：文件系统
- 使用方式：展示、编辑、发布、导出、回溯

## 正式章节是什么

- 可发布的正文结果
- 可被用户直接编辑的文本
- 可参与导出和展示的成品
- 写作动作结算后的稳定落点

## 正式章节不是什么

- 不是候选稿
- 不是草稿
- 不是多版本中的每一个临时版本
- 不是动态事实本身

动态事实应回写叙事记忆。

## 设计原则

1. 正式章节保留为独立业务对象
2. 正式章节只承接稳定结果
3. 正式章节的变化应触发必要的叙事记忆回写或校验
4. 正式章节不再依赖候选稿/草稿三态流转

## 相关代码

- `packages/studio/src/api/routes/storage.ts`
- `packages/studio/src/api/lib/story-file-service.ts`
- `packages/novel-plugin/src/pages/writing-workbench/resource-viewers/ChapterEditor.tsx`
- `books/<bookId>/chapters/`

## 当前清理目标

- 保留章节文件作为正文主存储
- 移除 SQLite 作为章节资源主存储的语义
- 移除候选稿 / 草稿对正式章节的状态机绑定
