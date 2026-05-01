# 工程底座加固 v1 — Tasks

**版本**: v1.0.0
**创建日期**: 2026-05-01
**状态**: 待审批

---

## Phase 0：全局状态 + API Client（3 tasks）

- [ ] 1. 实现 createAppStore
  - 新建 `stores/app-store.ts`，≤50行
  - 定义 `AppState`（activeBookId + activeChapterNumber）
  - `createAppStore()`, `appStore` 单例导出
  - 验证：store 单元测试通过

- [ ] 2. 实现 API Client
  - 新建 `api/client.ts`
  - 封装 books/chapters/candidates/progress 四组，10+ 方法
  - 所有方法 typed Promise
  - 验证：API Client 测试覆盖 2 方法

- [ ] 3. WorkspacePage 接入 appStore
  - 选中书籍/章节时写入 store
  - AgentWritingEntry 读取 bookId
  - 验证：WorkspacePage 测试通过

---

## Phase 2：工具目录 + 旧代码清理（3 tasks）

- [ ] 4. 实现统一工具目录
  - 新建 `api/lib/tool-catalog.ts`
  - 合并 Core BUILTIN_TOOLS + NarraFork 工具
  - 每个条目带 category 标签
  - ToolsTab 从 tool-catalog 读取
  - 验证：工具目录测试通过

- [ ] 5. 清理旧前端残留
  - 删除 `src/pages/` 旧页面容器
  - 删除 `src/hooks/use-tabs.ts`
  - 删除其他已确认无依赖的旧文件
  - 验证：typecheck + test 全量通过

- [ ] 6. 验证旧代码删除完全性
  - `grep` 检查新前端不引用旧页面
  - `docs:verify` 通过
  - 验证：无 missed imports

---

## Phase 3：bun compile（2 tasks）

- [ ] 7. 实现 compile 脚本
  - 新建 `scripts/compile.ts`
  - `bun build --compile` 生成单文件
  - 静态资源嵌入
  - `package.json` 新增 `"compile": "bun scripts/compile.ts"` script

- [ ] 8. 编译验证
  - `bun run compile` 成功
  - 编译产物能启动
  - `curl http://localhost:4567/` 返回 HTML
  - 验证：编译态 E2E 烟雾测试

---

## Phase 4：集成验证（2 tasks）

- [ ] 9. 全量 typecheck + test
  - `bun run typecheck` 通过
  - `bun run test` 全量通过
  - 无新增 mock/fake/noop

- [ ] 10. 更新文档
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
