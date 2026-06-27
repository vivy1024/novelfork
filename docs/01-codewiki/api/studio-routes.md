**版本**: v3.0.0
**创建日期**: 2026-06-26
**更新日期**: 2026-06-26
**状态**: current
**文档类型**: current

# Studio Routes

## 路由目录

- `packages/studio/src/api/routes/session.ts`
- `packages/studio/src/api/routes/storage.ts`
- `packages/studio/src/api/routes/book-files.ts`
- `packages/studio/src/api/routes/writing-modes.test.ts`
- `packages/studio/src/api/routes/contract-regression.test.ts`

## 当前关键契约

| 路由/模块 | 当前语义 |
|-----------|----------|
| `session.ts` | Agent 会话、fork、compact、工具循环入口 |
| `storage.ts` / `book-files.ts` | 通用书籍和文件访问 |
| `writing-modes.test.ts` | 覆盖旧 writing-modes apply 已移除的 404 回归 |
| `contract-regression.test.ts` | 覆盖路由契约和 schema 字段回归 |

## 维护规则

1. Studio 层保持通用工作台，不引入小说业务新概念。
2. 小说域语义放在 novel-plugin。
3. 已删除的旧写作对象路由只保留在删除记录和回归测试中，不重新注册兼容层。
