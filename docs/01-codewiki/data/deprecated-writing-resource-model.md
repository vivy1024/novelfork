**版本**: v3.0.0
**创建日期**: 2026-06-26
**更新日期**: 2026-06-26
**状态**: deprecated
**文档类型**: current

# Deprecated Writing Resource Model

## 旧模型

```text
draft / candidate / accepted
  → transition accept/reject/archive/restore
  → SQLite writing_resource + 文件目录兼容
```

## 真实代码路径

- `packages/novel-plugin/src/engine/writing-resource/types.ts`
- 已删除的 writing-resource repository 旧实现
- `packages/novel-plugin/src/engine/writing-resource/migrate-to-files.ts`
- 已删除的 migrate-from-files 旧迁移入口
- `packages/core/src/storage/migrations/0016_writing_resource.sql`

## 当前状态

- 类型层仍保留 `candidate | draft` 以读取旧数据。
- HTTP transition 返回 410。
- candidate create / writing-mode apply 返回 410。
- service fallback 仍支持无文件路径时的 legacy repository。

## 清理方向

1. 保留迁移工具直到旧数据可安全迁移。
2. 不再新增以 candidate/draft 为主的测试和 UI。
3. 删除前持续记录在 cleanup inventory。
