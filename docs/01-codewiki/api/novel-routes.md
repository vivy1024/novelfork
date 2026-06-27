**版本**: v3.0.0
**创建日期**: 2026-06-26
**更新日期**: 2026-06-26
**状态**: current
**文档类型**: current

# Novel Plugin Routes

## 路由目录

- `packages/novel-plugin/src/routes/ai.ts`
- `packages/novel-plugin/src/routes/writing-modes.ts`
- `packages/novel-plugin/src/routes/writing-resource.ts`
- `packages/novel-plugin/src/routes/writing-tools.ts`
- `packages/novel-plugin/src/routes/jingwei.ts`
- `packages/novel-plugin/src/routes/narrative-memory.ts`
- `packages/novel-plugin/src/routes/pipeline.ts`
- `packages/novel-plugin/src/routes/compliance.ts`
- `packages/novel-plugin/src/routes/context-manager.ts`

## 当前关键契约

| 路由 | 当前语义 |
|------|----------|
| `POST /api/books/:id/style/import` | 返回 `preset-suggestion`，不自动写 style 文件 |
| `POST /api/books/:bookId/writing-modes/apply` | 返回 410，提示使用正式章节/多版本流程 |
| `POST /api/books/:bookId/candidates/create` | 返回 410 |
| `POST /api/books/:bookId/resources` | 只接受正式章节 `type=chapter,status=accepted` |
| `POST /api/books/:bookId/resources/:resourceId/transition` | 返回 410，旧中间态 transition 移除 |
| `narrative-memory` routes | 动态事实、图谱和 pending events |
| `jingwei` routes | 静态 Lore 读写 |

## 维护规则

1. 新写作结果路由不得创建 candidate/draft 主对象。
2. 风格提取只输出配置建议。
3. 动态事实写入 Narrative Memory，不写经纬。
