# Design Document

## Overview

本设计将旧前端从 `packages/studio/src` 的活跃编译路径中退役。项目当前入口是 `src/main.tsx` → `src/app-next`，旧前端的 `routes`、`novelfork-context`、多标签 shell、旧 Sidebar/Admin/Routines 容器已经不再是运行主线，却仍被 `tsconfig.json` 的 `include: ["src"]` 扫进 typecheck。

清理策略不是补兼容层，而是删除不再使用的旧入口文件和旧测试。仍被新工作台真实引用的组件保留，例如 UI primitives、runtime unsupported、writing tools/modes、Routines tab 级组件和 InkEditor。

## Architecture

### Active frontend boundary

活跃前端边界定义为：

```text
packages/studio/src/main.tsx
  → packages/studio/src/app-next/**
  → app-next 直接引用的共享组件、hooks、types、lib、API client
```

任何不在该依赖图内、且仅服务旧 Shell / 旧 routes / 旧 provider 的文件，都可以删除。

### Deleted legacy boundary

本次删除的旧前端边界包括：

- 旧路由和 tab 状态：`routes.test.ts`、`route-utils.ts`、`hooks/use-tabs.ts`、`hooks/use-tabs.test.ts`。
- 旧 NovelFork provider 依赖：`hooks/use-backup.ts`、`hooks/use-crash-recovery.ts`、`hooks/use-llm-config.ts`。
- 旧页面容器：`components/Admin/Admin.tsx`、`components/CommandPalette.tsx`、`components/Routines/Routines.tsx`、`components/Sidebar.tsx`、`components/UpdateChecker.tsx`。
- 上述旧容器的测试文件。

这些文件的共同特征是依赖已经不存在的 `src/routes` 或 `providers/novelfork-context`，且不被 `app-next` 主入口直接使用。

### Preserved shared assets

以下类型文件不按旧前端删除处理，因为新工作台仍在真实复用或其测试仍验证共享能力：

- `src/app-next/**`
- `src/components/ui/**`
- `src/components/runtime/**`
- `src/components/writing-tools/**`
- `src/components/writing-modes/**`
- `src/components/Routines/CommandsTab.tsx`、`ToolsTab.tsx`、`PermissionsTab.tsx`、`SkillsTab.tsx`、`SubAgentsTab.tsx`、`PromptsTab.tsx`、`MCPToolsTab.tsx`
- `src/components/Routines/use-routines-editor.ts`
- `src/components/Routines/routines-api.ts`
- `src/components/InkEditor.tsx`
- 当前 API、shared contracts、hooks/use-api、hooks/use-ai-model-gate 等新工作台依赖

## Rule documentation

更新 `CLAUDE.md` 并新建/更新 `AGENTS.md`，新增“废弃代码处理纪律”：

- 废弃前端或历史入口阻塞编译时，优先删除或从构建路径移除。
- 禁止为了通过测试/typecheck 新增假 routes、假 provider、shim、noop adapter、空实现。
- 旧代码备份以 Git 历史为准，不在主源码树保留一份可被扫描/编译的副本。
- 如果某个旧模块仍有价值，必须迁移为新工作台真实复用资产，而不是以兼容层形式续命。

## Data flow impact

本次不改变运行时 API、存储结构或 Studio 新入口数据流。预期影响只发生在 TypeScript 编译图和测试发现图：删除旧文件后，`tsc --noEmit` 不再解析缺失的旧 routes/provider 依赖。

## Error handling

- 若删除某文件导致新工作台测试或 typecheck 出现缺引用，说明该文件仍在活跃依赖图内，应恢复该文件或先把引用迁移到新位置；不得补假实现。
- 若某旧测试失败仅因为被测旧入口删除，应删除该测试，而不是重建旧入口。
- 若 typecheck 剩余错误属于其他真实模块，应单独记录并修复，不能用兼容 shim 掩盖。

## Testing Strategy

验证分三层：

1. **静态卫生**
   - `git diff --check`
   - 搜索确认没有新增 `providers/novelfork-context` 或 `src/routes` shim。

2. **TypeScript**
   - `pnpm --dir packages/studio run typecheck`
   - 目标是旧前端缺模块错误完全消失。

3. **相关测试**
   - 运行新工作台和共享资产相关 vitest，例如 `app-next`、Routines tab 复用组件、UI primitives、workspace viewer/registry、server integration。
   - 不用 `bun test` 运行 Vitest 测试；使用 `pnpm --dir packages/studio exec vitest run ...`。

## Non-goals

- 不重写新工作台页面。
- 不迁移旧 Admin/Sidebar/CommandPalette 的视觉设计。
- 不恢复旧 `routes` 或 `novelfork-context`。
- 不创建 archive 目录保存旧前端源码副本。
- 不修改后端 API 行为，除非删除旧前端后发现真实编译错误必须修复。
