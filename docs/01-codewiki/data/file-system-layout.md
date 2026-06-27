**版本**: v3.0.0
**创建日期**: 2026-06-26
**更新日期**: 2026-06-26
**状态**: current
**文档类型**: current

# 文件系统布局

## 职责

文件系统是正式章节正文的主语义存储。

## 真实代码路径

- `packages/novel-plugin/src/engine/writing-resource/file-store.ts`
- `packages/novel-plugin/src/engine/writing-resource/service.ts`
- `packages/studio/src/api/routes/book-files.ts`
- `packages/studio/src/api/routes/storage.ts`

## 关键目录语义

| 目录 | 语义 |
|------|------|
| `books/<bookId>/chapters/` | 正式章节正文 |
| `books/<bookId>/drafts/` | 旧兼容/临时文件，不是主概念 |
| `books/<bookId>/generated-candidates/` | 旧候选稿兼容目录，待清理/迁移 |
| `books/<bookId>/story/` | 旧 story 资源/风格文件兼容区，不再由 style.import 自动写入 |

## 维护规则

1. 正式章节正文不得与 SQLite 形成双主语义。
2. 新代码不要新增 candidate/draft 目录依赖。
3. style import 只返回建议，不自动写 `style_profile.json` / `style_guide.md`。
