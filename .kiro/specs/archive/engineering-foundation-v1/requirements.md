# 工程底座加固 v1 — Requirements

**版本**: v1.0.0
**创建日期**: 2026-05-01
**状态**: 待审批

---

## 背景

经过 18 个 spec、~295 个任务的密集功能交付，NovelFork 的功能深度已经远超同类开源工具。但工程底座（架构抽象、状态管理、通信层、构建分发）没有同步升级——这是任何软件从「能跑」到「能交付」的必经之路。

本 spec 参考 Claude Code 的架构模式，针对 NovelFork 的 5 个工程短板做最低成本加固。不改功能、不增新能力、不动 UI。

---

## Requirement 1：必须有最小全局状态层

**当前事实**: 状态散落在 20+ 个 `useState` 里。ChatWindow 不知道工作台打开了哪本书。Agent 不知道当前章节号。

**参照 Claude Code**: `createStore()` 35 行实现，所有工具通过 `context.getAppState()` 读写。

### Acceptance Criteria

1. 新建 `packages/studio/src/stores/app-store.ts`，实现最小 `createStore`：
   - `getState()` / `setState(updater)` / `subscribe(listener)`
   - 引用相等跳过渲染
   - 不超过 50 行代码
2. `AppState` 类型至少包含：
   - `activeBookId: string | null`
   - `activeChapterNumber: number | null`
3. WorkspacePage 在切换书籍/章节时写入 store。
4. ChatWindow / AgentWritingEntry 在发送消息前从 store 读取 bookId。
5. 不引入新依赖（不装 Redux/Zustand）。
6. 验证：store 单元测试覆盖 get/set/subscribe。

---

## Requirement 2：前端 API 调用必须有统一 Client 层

**当前事实**: 30+ 处 `useApi("/books/...")` 和 `fetchJson("/api/books/...")` 散落组件中。

**参照 Claude Code**: `src/bridge/bridgeApi.ts` 封装所有 API 调用。

### Acceptance Criteria

1. 新建 `packages/studio/src/api/client.ts`，提供统一的 API Client：
   - `api.books.list()` / `api.books.get(id)` / `api.books.create(...)` 等
   - `api.chapters.get(bookId, num)` / `api.chapters.save(bookId, num, content)` 等
   - `api.candidates.list(bookId)` / `api.candidates.accept(...)` 等
   - `api.progress.get()` 等
2. 所有方法返回 typed Promise（从 `shared/contracts.ts` 引用类型）。
3. 第一步先封装「创作主流程」的 10 个高频 API，不要求全覆盖。
4. 内部复用现有 `fetchJson` / `postApi`，不引入 axios。
5. 验证：API Client 测试覆盖 books.list/chapters.get 两个方法。

---

## Requirement 3：工具注册必须统一入口

**当前事实**: Core `builtin-tools.ts`（18 个）和 Studio `ToolsTab.tsx`（22 个）各自管理。

### Acceptance Criteria

1. 新增 `packages/studio/src/api/lib/tool-catalog.ts`，定义统一的工具目录：
   - 每个工具条目包含：`name`, `description`, `loadCommand`, `enabled`, `category`（"core-writing" | "narrafork-general" | "narrafork-ops"）
   - 数据源合并 Core `BUILTIN_TOOLS` 和 Studio `AVAILABLE_TOOLS`
2. ToolsTab 从 `tool-catalog.ts` 读取工具列表，不再维护自己的 `AVAILABLE_TOOLS` 数组。
3. 验证：工具目录测试覆盖总数（40 个）、分类过滤。

---

## Requirement 4：必须有 bun compile 构建目标

**当前事实**: 用户必须 `git clone` + `bun install` + `bun run dev`。

### Acceptance Criteria

1. 新增 `scripts/compile.ts`：调用 `bun build --compile` 生成单文件。
2. 编译产物：`dist/novelfork`（Linux）、`dist/novelfork.exe`（Windows）。
3. 编译后 PWA 静态资源嵌入 server（复用现有 `static-provider` 的 embedded 模式）。
4. 编译成功后 `./novelfork` 直接启动完整工作台（API + 前端）。
5. 验证：编译产物能启动，`curl http://localhost:4567/` 返回 HTML。

---

## Requirement 5：旧前端残留必须清理

**当前事实**: `old-frontend-decommission` spec 5/9 完成。旧 `components/` 仍有 30+ 个文件在构建路径中。

### Acceptance Criteria

1. 完成 `old-frontend-decommission` 的剩余 4 个 task。
2. 删除旧路由、旧 tab shell、旧 provider hooks 中已确认可删除的文件。
3. 删除后 typecheck + test 全量通过。
4. 验证：`grep -r "旧前端\|legacy\|deprecated" src/` 仅剩注释引用。

---

## Requirement 6：测试与回归

1. `createStore` 单元测试通过。
2. API Client 测试覆盖 2+ 方法。
3. 工具目录测试通过。
4. `bun run typecheck` 通过。
5. `bun run test` 全量通过。
6. 旧代码删除后无新引入的构建错误。

---

## Non-goals

- 不做 API 版本化（v1/v2 前缀）
- 不做 React Router 迁移
- 不做端到端类型生成（Zod → TypeScript）
- 不做 Bridge 层（前后端通信抽象）
- 不做生命周期 Hook 管道
- 不做 bun compile 之外的分发（npm publish、Docker）
