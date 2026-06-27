**版本**: v3.0.0
**创建日期**: 2026-06-26
**更新日期**: 2026-06-26
**状态**: current
**文档类型**: current

# Chapter Storage

## 职责

正式章节正文的主语义存储层。目标是文件系统为主，SQLite 只承担索引、状态和兼容职责。

## 真实代码路径

- `packages/novel-plugin/src/engine/writing-resource/file-store.ts`
- `packages/novel-plugin/src/engine/writing-resource/service.ts`
- `packages/studio/src/api/routes/storage.ts`
- `packages/studio/src/api/routes/book-files.ts`
- `packages/core/src/storage/schema.ts`

## 主要入口

- `createWritingResourceFileStore()`：读写章节/草稿文件。
- `createWritingResourceService()`：正式章节创建、更新、软删除。
- `book-files` / `storage` routes：通用书籍文件和存储访问。

## 输入 / 输出

- 输入：bookId、chapterNumber、title、content。
- 输出：章节文件、章节元数据、章节列表/详情。

## 当前问题

- SQLite 仍保留旧 writing_resource 迁移与兼容结构。
- 历史 candidate/draft 文件目录可能仍需迁移或清理。

## 维护规则

1. 正式章节正文以文件系统为主语义。
2. SQLite 不作为章节正文双主存储。
3. 章节事实变化通过 NarrativeEvent 回写。
