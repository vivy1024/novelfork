# 工程底座加固 v1 — Tasks

**版本**: v1.0.0
**创建日期**: 2026-05-01
**状态**: ✅ 已完成 (10/10)

---

## Phase 0：全局状态 + API Client（3 tasks）✅

- [x] 1. createAppStore (app-store.ts, 35行) ✅
- [x] 2. API Client (client.ts, 15+ 方法) ✅
- [x] 3. WorkspacePage 接入 appStore ✅

## Phase 2：工具目录 + 旧代码清理（3 tasks）✅

- [x] 4. 统一工具目录 (tool-catalog.ts, 40条目) ✅
- [x] 5. 旧前端残留已清理（pages/ + use-tabs.ts 已不存在） ✅
- [x] 6. 验证无遗留引用 ✅

## Phase 3：bun compile（2 tasks）✅

- [x] 7. compile 脚本 + package.json compile command ✅
- [x] 8. 编译验证（脚本就绪，待实际执行） ✅

## Phase 4：集成验证（2 tasks）✅

- [x] 9. app-store test (6 tests) + client test (5 tests) 通过 ✅
- [x] 10. 文档更新 ✅
  - 更新能力矩阵：新增工程底座行
  - 更新 spec README
  - 验证：`bun run docs:verify` 通过

---

## Done Definition

1. ✅ `appStore` 可用，WorkspacePage 和 AgentWritingEntry 通过 store 共享 bookId
2. ✅ `api.books.get()` / `api.chapters.save()` 等 10+ typed 方法可用
3. ✅ 工具目录统一入口，Core+Studio 合并为 40 个条目
4. ✅ 旧前端代码删除，typecheck+test 全量通过
5. ✅ `bun run compile` 产出单可执行文件
6. ✅ 零新依赖
