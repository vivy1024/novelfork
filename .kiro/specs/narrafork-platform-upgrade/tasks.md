# Implementation Plan

## Overview

本计划从 `narrafork-platform-upgrade` spec 生成，按 P0 / P1 梳理 NovelFork 继续学习 NarraFork 平台栈所需升级项。执行原则：先保证 Bun-only 运行时、SQLite 一致性、启动验证和作者基础路径稳定，再推进 NarraFork parity 的恢复链、请求历史、更新机制和高级工作台模式。

## P0：必须优先完成

- [ ] 1. 固化 Bun-only 运行时契约
  - 检查所有 Studio 运行时入口，确认源码启动以 `bun run main.ts` 为准。
  - 检查 `packages/core`、`packages/studio` 的 package metadata，运行时引擎口径统一为 Bun。
  - 搜索运行时代码中的 `node:sqlite`、`better-sqlite3`、Node-only SQLite 驱动引用，确认不存在。
  - 明确允许保留的历史开发工具链范围：类型检查、package 脚本、发布辅助脚本；它们不得进入 Studio 启动链。
  - 验收：`bun run main.ts --port=<port>` 启动日志显示 `runtime: "bun"`。
  - 覆盖 Requirements 1、8。

- [ ] 2. 完成 SQLite/drizzle Bun 化收口
  - 确认 `packages/core/src/storage/db.ts` 使用 `bun:sqlite` 与 `drizzle-orm/bun-sqlite`。
  - 保持 `StorageSqliteDatabase` facade 清晰，业务层只依赖 `.prepare/.transaction/.exec/.pragma/.open/.close`。
  - 清理 workspace importer 里的 `better-sqlite3` / `@types/better-sqlite3` 依赖。
  - 对 lockfile 中可能存在的 drizzle optional peer 残留做说明：不得成为运行时 import 路径。
  - 验收：`packages` 运行时代码搜索不到 `better-sqlite3`。
  - 覆盖 Requirements 2、8。

- [ ] 3. 建立 Bun 存储回归验证
  - 保留或完善 `scripts/verify-bun-storage.ts`。
  - 验证内容至少包含：创建数据库、运行 migration、查询 `drizzle_migrations`、执行 transaction、执行 checkpoint。
  - 将该脚本纳入 P0 验证清单。
  - 验收：`bun "scripts/verify-bun-storage.ts"` 输出 `{ "ok": true, "runtime": "bun" }`。
  - 覆盖 Requirements 2、4。

- [ ] 4. 修复文件书籍与 SQLite book 表一致性
  - 检查 `packages/studio/src/api/routes/storage.ts` 的建书流程。
  - 在本地书籍创建成功时，同步 upsert SQLite `book` 记录。
  - 确认书名、slug、bookId、display title 的规则，特别是中文书名。
  - 创建本地书后立即调用 `/api/books/:bookId/jingwei/sections`，不得出现 `BOOK_NOT_FOUND`。
  - 对已存在于 `books/` 但 SQLite 缺失的书籍提供非破坏性补录策略。
  - 验收：新建书籍后，书籍总览、故事经纬 API、会话中心都识别同一 bookId。
  - 覆盖 Requirements 3。

- [ ] 5. 整理启动与发布 smoke 验证脚本
  - 新增或整理一个 Bun-first 验证入口，例如 `scripts/verify-bun-runtime.ts`。
  - 聚合执行：core typecheck、studio client typecheck、studio server typecheck、Bun storage verification、Studio 启动 smoke。
  - 启动 smoke 校验：HTTP 首页可访问、provider missing 不阻断、WebSocket route 注册日志存在。
  - 记录失败分类：runtime / storage / frontend / websocket / provider / environment pollution。
  - 验收：一条 Bun 命令能完成 P0 smoke，并输出清晰摘要。
  - 覆盖 Requirements 4、5。

- [x] 6. 保证 provider 后置不阻断基础路径
  - 复查 onboarding、BookCreate、BookDetail、AI actions 的 provider gate。
  - 未配置模型时，启动、首页、建书、经纬维护、章节编辑都必须可用。
  - 需要模型的动作统一进入 gate，保留当前输入和上下文。
  - 验收：清空 provider 环境后，仍可启动 Studio、创建本地书、进入书籍总览。
  - 覆盖 Requirements 5。

- [x] 7. 清理技术栈文档口径
  - README 技术栈写为 Bun / Hono / React 19 / SQLite（bun:sqlite）+ drizzle。
  - 存储层开发指引说明 `bun:sqlite` 和 `StorageSqliteDatabase` facade。
  - 技术栈选型文档删除“中期评估 better-sqlite3”作为当前方向的表述，改成历史口径说明。
  - NarraFork 依赖参考补充：参考快照记录的是 NarraFork 的依赖组合；NovelFork 当前实际落地为 Bun-only `bun:sqlite + drizzle`。
  - 验收：用户可见主文档不再把 `better-sqlite3` 当当前 NovelFork 运行时驱动。
  - 覆盖 Requirements 8。
  - 2026-04-25 补充验证：已同步 README、存储层开发指引、技术栈选型、NarraFork 依赖参考、平台迁移/回正规划/待办清单、持久化 spike 文档。grep 结果确认主文档显式写出 `bun:sqlite`，并把 `better-sqlite3`、Mantine、TanStack Router 标成历史口径或“不照抄 UI 依赖”。

- [x] 8. 完成 P0 真机烟测记录
  - 按 P0 验证脚本执行一轮。
  - 用浏览器访问 Studio 首页，确认标题、首页文本、provider status。
  - 创建一本临时书，确认文件层与 SQLite 层一致，然后清理临时产物。
  - 记录未处理环境污染项，例如孤儿 session、unclean shutdown、外部 worktree 污染；不得把它们伪装为已修复。
  - 验收：P0 smoke 结果写入当前 spec 或任务备注。
  - 覆盖 Requirements 4。
  - 2026-04-25 烟测记录：
    - 验证通过：`bun "packages/core/node_modules/typescript/bin/tsc" -p "packages/core/tsconfig.json" --noEmit`、`bun "packages/studio/node_modules/typescript/bin/tsc" -p "packages/studio/tsconfig.json" --noEmit`、`bun "packages/studio/node_modules/typescript/bin/tsc" -p "packages/studio/tsconfig.server.json" --noEmit`、`bun "scripts/verify-bun-storage.ts"`。
    - Storage 输出：`{"ok":true,"runtime":"bun","appliedMigrations":6,"recordedMigrations":6}`。
    - Targeted regression：`pnpm --dir packages/studio exec vitest run src/api/server.test.ts -t "creates a local book scaffold"` 通过；该命令仍会打印忽略构建产物 `packages/core/dist` 中旧 `better-sqlite3` 的 Vite pre-transform warning，后续发布前需要刷新/清理 ignored dist 产物。
    - Studio source smoke：`bun run main.ts --port=4571` 可启动，日志包含 `runtime:"bun"`、`storage.sqlite ok=true`、`static.provider source:"embedded"`、`websocket.register ok=true`（`/api/admin/resources/ws`、`/api/sessions/:id/chat`）。
    - Browser/API smoke：访问首页标题为 `NovelFork Studio`，provider status 为 `hasUsableModel:false` 且不阻断；临时书 `烟测书20260425并行final` 创建后文件 `books/<bookId>/book.json` 存在、SQLite `book` 行存在、`/api/books/:bookId/jingwei/sections` 返回 4 个基础经纬栏目、`/api/sessions` 包含同一 `projectId`；删除后文件不存在、SQLite `book` 行为空、经纬 API 返回 404。
    - 烟测期间发现并修复：本地 scaffold 原先只写文件不写 SQLite book / jingwei sections，导致经纬 API `BOOK_NOT_FOUND`；同时补上删除时清理 SQLite `book` 行，避免新增结构化索引后产生孤儿数据。
    - 未处理环境污染项：startup recovery 仍报告 `unclean-shutdown`（来自本轮反复 kill/restart 的运行标记）与外部项目 worktree 污染 `D:/DESKTOP/sub2api/inkos-master/packages/studio/.test-workspace/.inkos-worktrees/feature-test`；provider 缺失按预期为 skipped（`configured=none;missing=openai`）。
    - 2026-04-25 再次复核：`bun "scripts/verify-bun-runtime.ts"` 输出 `{"ok":true,"runtime":"bun","counts":{"total":12,"passed":12,"failed":0}}`，其中 `provider status smoke` 为 `hasUsableModel=false`，`startup environment diagnostics` 为 `unclean-shutdown:success, session-store:success, git-worktree-pollution:skipped`；补充说明当前验证脚本已使用独立 `NOVELFORK_SESSION_STORE_DIR` 临时目录，避免全局 `~/.novelfork` 污染 smoke 结果。

## P1：P0 稳定后推进

- [ ] 9. 升级 WebSocket 与会话恢复链
  - 梳理当前 `/api/sessions/:id/chat` 与 `/api/admin/resources/ws` 的持久化边界。
  - 将消息确认边界、未完成输出、工具调用状态写入 SQLite。
  - 刷新页面后恢复到最后确认消息，而不是只依赖内存窗口状态。
  - 会话恢复失败时提供重试、归档、新开会话三种路径。
  - 学习 NarraFork 的 buffered queue 持久化，但映射为写作会话心智。
  - 覆盖 Requirements 7。

- [x] 10. 建立 AI 请求历史与成本观测
  - 记录每次 AI 请求的 provider、model、耗时、TTFT、token 估算、状态、错误摘要。
  - 管理中心提供请求历史筛选。
  - 作者默认 UI 只显示必要失败提示，不暴露复杂调试指标。
  - 支持按书籍 / 会话关联请求历史。
  - 覆盖 Requirements 6、7。
  - 2026-04-25 补充验证：已在 core agent / pipeline 与 studio 路由层补齐 `ai.request` 观测，记录 provider、model、duration、TTFT、token usage、status、errorSummary、bookId/sessionId/runId，并由 `runtime-log-sink` 持久化到 `novelfork.log`，Admin Requests/Logs 支持按 provider/status/bookId/sessionId/runId 筛选。验证通过：`pnpm --dir packages/studio exec -- vitest run src/api/lib/runtime-log-sink.test.ts src/api/routes/admin.test.ts src/components/Admin/RequestsTab.test.tsx src/components/Admin/LogsTab.test.tsx`（25 tests passed）、`pnpm --dir packages/core typecheck` 通过；`packages/studio` server typecheck 仍被无关的 `src/api/routes/presets.ts` 现存错误阻塞。

- [x] 11. 完善高级工作台模式
  - 注意：`WorkbenchModeGate` 骨架已在 `onboarding-and-story-jingwei` spec 中实现（含持久化、确认弹窗、默认隐藏）。本任务聚焦增强：工具权限、Terminal/Browser/MCP 集成、诊断面板。
  - 定义作者模式与工作台模式的切换入口。
  - 将 Terminal、Browser、MCP、权限审批、工具调用详情放入高级工作台模式。
  - 默认作者模式隐藏这些 coder 向入口。
  - 每个高级工具入口展示权限和风险说明。
  - 覆盖 Requirements 6。
  - 2026-04-25 补充验证：WorkflowWorkbench 新增工具链入口与诊断面板，复用 Resources/Requests/Logs，WorkbenchModeGate 与 MCP 管理页补充 Terminal / Shell、Browser、MCP、Admin、Pipeline 权限/风险说明和返回作者模式路径；默认作者模式隐藏 Pipeline、守护进程、日志、Worktree 等 coder 向入口。验证通过：`pnpm --dir packages/studio exec vitest run src/components/workbench/WorkbenchModeGate.test.tsx src/pages/WorkflowWorkbench.test.tsx src/pages/MCPServerManager.test.tsx src/components/Sidebar.test.tsx`（10 tests passed）、`pnpm --dir packages/studio exec tsc --noEmit` 通过、`pnpm --dir packages/studio exec vitest run src/routes.test.ts src/hooks/use-tabs.test.ts`（37 tests passed）。

- [ ] 12. 增强启动诊断与自愈链
  - 将 unclean shutdown、孤儿 session、外部 worktree 污染、静态资源模式、compile smoke 统一归类。
  - 提供可执行修复动作：清理孤儿 session、忽略外部 worktree、重新构建静态资源等。
  - 参考 NarraFork 的结构化启动日志，但文案面向 NovelFork 作者和维护者。
  - 覆盖 Requirements 4、8。

- [x] 13. 设计更新机制与 changelog 入口
  - 显示当前版本、commit、运行时、构建来源。
  - 提供 stable / beta 通道预留。
  - changelog 文案面向作者，解释新增写作能力，不只列技术改动。
  - 覆盖 Requirements 6、8。
  - 2026-04-25 补充验证：已新增 `settings/release` 路由、统一 `release-manifest` / `release-metadata`、About/Status 的 `ReleaseOverview` 与 UpdateChecker changelog 入口，展示当前版本、运行时、构建来源、commit 摘要及 stable/beta 通道占位。验证通过：`pnpm --dir packages/studio exec -- vitest run src/api/routes/settings.test.ts src/components/Settings/SettingsView.test.tsx src/components/UpdateChecker.test.tsx`（5 tests passed）。

- [ ] 14. 作者化 Browser / 抓取能力
  - 评估 NarraFork Browser/readability 能力在 NovelFork 的映射：市场雷达、题材分析、素材导入。
  - 不把 Browser 作为默认一等入口。
  - 所有抓取结果进入可审阅素材区，不直接污染故事经纬。
  - 覆盖 Requirements 6。

- [x] 15. 权限系统产品化
  - 学习 NarraFork 的逐项询问、允许编辑、全部允许、只读、规划模式。
  - 将权限映射到 NovelFork 的写作会话、审稿会话、设定会话。
  - 创建会话时提供权限选择，不只藏在会话详情页。
  - 覆盖 Requirements 6、7。
  - 2026-04-25 补充验证：会话创建入口、会话中心、ChatWindow、运行时控制面板与高级工作台均展示作者化权限模式（ask/edit/allow/read/plan），并映射到写作、审稿、设定、规划会话。验证通过：`pnpm --dir packages/studio exec vitest run src/components/sessions/NewSessionDialog.test.tsx src/pages/SessionCenter.test.tsx src/components/ChatWindow.test.tsx src/components/workbench/WorkbenchModeGate.test.tsx src/pages/settings/RuntimeControlPanel.test.tsx src/pages/WorkflowWorkbench.test.tsx src/api/lib/runtime-tool-access.test.ts src/api/routes/tools.test.ts`，合并复核为 10 files / 63 tests；`pnpm --dir packages/studio typecheck` 通过。

## 暂不执行项

- [ ] Mantine UI 栈迁移：不做，保持 shadcn/Base UI。
- [ ] TanStack Router 全量迁移：不做，除非当前 Tab 路由复杂度失控。
- [ ] NarraFork 节点图作为默认作者工作流：不做，改用书籍 / 章节 / 经纬 / 会话心智。
- [ ] Terminal / Browser / NarraForkAdmin 作者默认入口：不做，只考虑高级工作台模式。
- [ ] 完整 MCP 工具市场：不做，先保证写作闭环。
级工作台模式。
- [ ] 完整 MCP 工具市场：不做，先保证写作闭环。
盖 Requirements 6、7。

## 暂不执行项

- [ ] Mantine UI 栈迁移：不做，保持 shadcn/Base UI。
- [ ] TanStack Router 全量迁移：不做，除非当前 Tab 路由复杂度失控。
- [ ] NarraFork 节点图作为默认作者工作流：不做，改用书籍 / 章节 / 经纬 / 会话心智。
- [ ] Terminal / Browser / NarraForkAdmin 作者默认入口：不做，只考虑高级工作台模式。
- [ ] 完整 MCP 工具市场：不做，先保证写作闭环。
级工作台模式。
- [ ] 完整 MCP 工具市场：不做，先保证写作闭环。
��流：不做，改用书籍 / 章节 / 经纬 / 会话心智。
- [ ] Terminal / Browser / NarraForkAdmin 作者默认入口：不做，只考虑高级工作台模式。
- [ ] 完整 MCP 工具市场：不做，先保证写作闭环。
级工作台模式。
- [ ] 完整 MCP 工具市场：不做，先保证写作闭环。
