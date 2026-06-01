# Implementation Plan

## Overview

本任务清单执行 `old-frontend-decommission` spec：删除旧前端阻塞源，不新增兼容 shim；保留新工作台仍真实复用的共享组件；更新 CLAUDE/AGENTS 规则，明确禁止为废弃代码做假兼容；最后通过 typecheck、相关 vitest 与 diff 检查后提交。

## Traceability Map

- Requirement 1 → Tasks 1-4：识别并删除旧 routes/provider/tab shell/页面容器阻塞源。
- Requirement 2 → Tasks 5-6：更新 CLAUDE.md 与 AGENTS.md，禁止兼容性假修复。
- Requirement 3 → Tasks 2、4、7：保留 app-next 与真实复用资产，并用测试验证未破坏。
- Requirement 4 → Tasks 7-9：运行验证、修复真实问题、提交 Git。

## Tasks

- [ ] 1. 建立删除前基线与旧前端阻塞清单
  - 运行 `git status --short` 确认工作区状态。
  - 运行或复核 `pnpm --dir packages/studio run typecheck` 当前旧前端错误，确认阻塞仍来自 `src/routes`、`providers/novelfork-context`、`use-tabs.ts`。
  - 用内容搜索确认这些阻塞文件不被 `src/main.tsx` / `src/app-next/**` 的活跃入口直接依赖。
  - 验证：输出的旧前端阻塞清单与 requirements 中列出的文件一致，且不包含新工作台真实依赖文件。

- [ ] 2. 删除旧路由、旧 tab shell 与旧 provider hooks
  - 删除 `packages/studio/src/routes.test.ts`。
  - 删除 `packages/studio/src/route-utils.ts`。
  - 删除 `packages/studio/src/hooks/use-tabs.ts` 与 `packages/studio/src/hooks/use-tabs.test.ts`。
  - 删除 `packages/studio/src/hooks/use-backup.ts`、`packages/studio/src/hooks/use-crash-recovery.ts`、`packages/studio/src/hooks/use-llm-config.ts`。
  - 验证：源码中不再存在对 `../routes`、`./routes`、`providers/novelfork-context` 的旧前端引用，除非是测试 mock 中对已删除文件的历史引用并同步删除。

- [ ] 3. 删除旧前端页面容器及对应测试
  - 删除 `packages/studio/src/components/Admin/Admin.tsx` 与 `Admin.test.tsx`。
  - 删除 `packages/studio/src/components/CommandPalette.tsx`。
  - 删除 `packages/studio/src/components/Routines/Routines.tsx` 与 `Routines.test.tsx`。
  - 删除 `packages/studio/src/components/Sidebar.tsx` 与 `Sidebar.test.tsx`。
  - 删除 `packages/studio/src/components/UpdateChecker.tsx` 与 `UpdateChecker.test.tsx`。
  - 验证：保留 `components/Admin/*Tab.tsx`、`components/Routines/*Tab.tsx`、`components/Routines/use-routines-editor.ts`、`components/Routines/routines-api.ts` 等仍被新工作台或现有测试真实复用的资产。

- [ ] 4. 清理残余导出、测试发现和引用
  - 检查 `components/Routines/index.ts`、其他 barrel export 或测试引用是否指向已删除旧容器。
  - 若存在仅服务已删除旧入口的 export，删除该 export；若 export 指向新工作台真实复用资产，则保留。
  - 搜索 `src/routes`、`route-utils`、`use-tabs`、`novelfork-context`、`CommandPalette`、旧 `Sidebar`、旧 `UpdateChecker` 的残余引用。
  - 验证：无残余引用导致 TypeScript 解析已删除文件。

- [ ] 5. 更新 CLAUDE.md 的废弃代码处理纪律
  - 在 `CLAUDE.md` 增加明确规则：禁止为了废弃前端、废弃路由或历史代码新增 shim、空实现、假 provider、假 routes、noop adapter。
  - 明确废弃代码备份以 Git 历史为准，不在主源码树保留可被扫描/编译的旧副本。
  - 明确旧模块若有价值，必须迁移为新工作台真实复用资产，而不是兼容层续命。
  - 验证：规则文字不与现有“旧前端只修阻塞问题”口径冲突，而是将“阻塞问题”的处理方式收敛为删除/迁移真实资产。

- [x] 6. 新建或更新 AGENTS.md
  - 若根目录没有 `AGENTS.md`，新建该文件。
  - 写入与 `CLAUDE.md` 一致的废弃代码处理纪律和禁止兼容性假修复规则。
  - 保持内容简洁，指向 `CLAUDE.md` 与 `.kiro/steering/` 作为主规则源。
  - 验证：`AGENTS.md` 不引入与 CLAUDE.md 相反的指令。

- [ ] 7. 运行 typecheck 与相关测试并修复真实问题
  - 运行 `pnpm --dir packages/studio run typecheck`。
  - 若仍失败，先判断是否为真实活跃模块错误；修复真实依赖或迁移引用，不新增兼容 shim。
  - 运行相关 vitest 集合，至少覆盖 `app-next`、Routines tab 复用组件、UI primitives、workspace viewer/registry、server integration。
  - 验证：旧前端缺 `src/routes`、缺 `providers/novelfork-context`、`use-tabs.ts` 类型错误不得残留。

- [x] 8. 执行最终卫生检查
  - 运行 `git diff --check`。
  - 搜索确认没有新增 `providers/novelfork-context` 或 `src/routes` shim。
  - 运行 `git status --short` 与 `git diff --stat`，核对删除/修改范围。
  - 验证：删除范围与本 spec 一致，没有误删新工作台真实复用资产。

- [x] 9. 提交 Git
  - 暂存本 spec、删除旧前端文件、CLAUDE/AGENTS 规则更新及必要修复。
  - 提交信息使用 `type(scope): description`，建议：`refactor(studio): decommission legacy frontend blockers`。
  - 提交后运行 `git status --short` 确认工作区干净。
