# Requirements Document

## Introduction

旧前端残留代码仍被 `packages/studio` 的 TypeScript 编译纳入，当前已阻塞 `pnpm --dir packages/studio run typecheck`。本 spec 的目标是正式退役旧前端源码：删除不再由 `src/main.tsx` / `app-next` 使用的旧路由、旧 Shell、旧 hooks、旧页面容器和旧测试，保留新工作台仍真实复用的组件/API/类型，并在项目规则中明确禁止为了历史兼容而新增 shim、假 provider、假 routes 或 noop adapter。

代码备份以 Git 历史为准，不在仓库中移动到 archive 副本，避免死代码继续污染搜索、测试、mock scan 和 AI 判断。

## Requirements

### Requirement 1：退役旧前端阻塞源

**User Story:** 作为 NovelFork 维护者，我希望旧前端废弃入口从源码树中移除，这样新工作台不会被历史路由和 provider 依赖阻塞编译。

#### Acceptance Criteria

1. WHEN 旧前端模块不再被 `src/main.tsx` 或 `src/app-next/**` 使用 THEN 系统 SHALL 从源码树删除这些旧入口和测试，而不是补兼容 shim。
2. WHEN 删除旧前端代码 THEN 系统 SHALL 至少覆盖当前 typecheck 阻塞源：`src/routes.test.ts`、`src/route-utils.ts`、`src/hooks/use-tabs.ts`、`src/hooks/use-tabs.test.ts`、`src/hooks/use-backup.ts`、`src/hooks/use-crash-recovery.ts`、`src/hooks/use-llm-config.ts`、`src/components/Admin/Admin.tsx`、`src/components/Admin/Admin.test.tsx`、`src/components/CommandPalette.tsx`、`src/components/Routines/Routines.tsx`、`src/components/Routines/Routines.test.tsx`、`src/components/Sidebar.tsx`、`src/components/Sidebar.test.tsx`、`src/components/UpdateChecker.tsx`、`src/components/UpdateChecker.test.tsx`。
3. WHEN 某个旧组件仍被 `app-next` 真实引用 THEN 系统 SHALL 保留该组件或先迁移引用，不能误删新工作台仍依赖的真实资产。
4. WHEN 删除完成 THEN `pnpm --dir packages/studio run typecheck` SHALL 不再出现缺 `src/routes`、缺 `providers/novelfork-context` 或 `use-tabs.ts` `Route`/`never` 的旧前端错误。

### Requirement 2：禁止兼容性假修复

**User Story:** 作为项目负责人，我希望规则文档明确禁止为了通过编译而补旧兼容层，这样后续任务不会牺牲代码质量换取表面通过。

#### Acceptance Criteria

1. WHEN 更新项目规则 THEN `CLAUDE.md` SHALL 明确禁止为废弃前端、废弃路由或历史代码新增 shim、空实现、假 provider、假 routes、noop adapter。
2. WHEN 仓库没有 `AGENTS.md` THEN 系统 SHALL 新建 `AGENTS.md`，并写入同等约束，供其他 agent / 工具读取。
3. WHEN 规则描述旧代码备份方式 THEN 系统 SHALL 明确“备份以 Git 历史为准”，不得把旧前端源码搬到主源码树内继续维护。
4. IF 废弃代码仍有参考价值 THEN 系统 SHALL 通过提交历史追溯，而不是在当前编译路径中保留兼容代码。

### Requirement 3：保持新工作台真实复用资产可用

**User Story:** 作为开发者，我希望清理旧前端时不破坏新工作台已经复用的组件和测试，这样删除行为只移除死代码而不倒退功能。

#### Acceptance Criteria

1. WHEN 清理旧前端 THEN 系统 SHALL 保留 `src/app-next/**` 当前入口与页面。
2. WHEN 新工作台引用 `components/ui/*`、`components/runtime/*`、`components/writing-tools/*`、`components/writing-modes/*`、`components/Routines/*Tab.tsx`、`components/Routines/use-routines-editor.ts`、`components/Routines/routines-api.ts` 或 `components/InkEditor.tsx` THEN 系统 SHALL 保留这些文件，除非先把引用迁移到新位置。
3. WHEN 清理后运行相关测试 THEN 新工作台相关 vitest SHALL 继续通过。
4. WHEN 删除旧测试 THEN 系统 SHALL 只删除对应已退役旧入口的测试，不删除仍覆盖真实 API、共享组件或新工作台资产的测试。

### Requirement 4：验证与提交

**User Story:** 作为维护者，我希望删除后有明确验证证据并形成提交，这样可以确认旧前端不再阻塞主线。

#### Acceptance Criteria

1. WHEN 实现完成 THEN 系统 SHALL 运行 `git diff --check` 并通过。
2. WHEN 实现完成 THEN 系统 SHALL 运行 `pnpm --dir packages/studio run typecheck` 并通过，或只剩与本 spec 无关且已记录的新阻塞；当前旧前端缺模块错误不得残留。
3. WHEN 实现完成 THEN 系统 SHALL 运行与新工作台、Routines 复用组件、UI primitives 相关的 vitest 集合并通过。
4. WHEN 验证成功 THEN 系统 SHALL 创建 Git 提交，提交信息遵循 `type(scope): description`。
