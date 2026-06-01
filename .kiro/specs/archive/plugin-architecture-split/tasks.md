# 插件架构真拆分 — 任务清单

## Batch 1：插件加载器（studio 侧机制）

- [x] 1.1 创建 `studio/src/api/lib/plugin-loader.ts`（PluginRegistry 类）
- [x] 1.2 定义 `LoadedPlugin` / `PluginRouteFactory` / `PluginToolHandler` / `PluginPageDefinition` 接口
- [x] 1.3 实现 `register()` / `getRoutes()` / `getTools()` / `getPages()` / `getPresets()`
- [x] 1.4 `studio/src/api/server.ts` 中实例化 PluginRegistry，加载 novel-plugin manifest
- [x] 1.5 插件路由挂载到主 Hono app（`app.route(prefix, pluginRouter)`）
- [x] 1.6 `session-tool-executor.ts` 通过 PluginRegistry 查找 handler（fallback 到现有逻辑）
- [x] 1.7 验证：现有功能不受影响，typecheck 通过

## Batch 2：迁移 core 小说引擎 → novel-plugin/engine/

- [x] 2.1 创建 `novel-plugin/src/engine/` 目录结构
- [x] 2.2 `git mv core/src/pipeline/ novel-plugin/src/engine/pipeline/`
- [x] 2.3 `git mv core/src/agents/ novel-plugin/src/engine/agents/`
- [x] 2.4 `git mv core/src/jingwei/ novel-plugin/src/engine/jingwei/`
- [x] 2.5 `git mv core/src/filter/ novel-plugin/src/engine/filter/`
- [x] 2.6 `git mv core/src/presets/ novel-plugin/src/engine/presets/`
- [x] 2.7 `git mv core/src/compliance/ novel-plugin/src/engine/compliance/`
- [x] 2.8 `git mv core/src/tools/ novel-plugin/src/engine/tools/`
- [x] 2.9 `git mv core/src/bible/ novel-plugin/src/engine/bible/`
- [x] 2.10 更新 novel-plugin/package.json 依赖（添加 core 需要的 deps）
- [x] 2.11 更新所有 import 路径（engine 内部互相引用 + 引用 core 的路径）
- [x] 2.12 创建 `novel-plugin/src/engine/index.ts` barrel export
- [x] 2.13 `core/src/index.ts` 移除小说相关 export
- [x] 2.14 验证：`pnpm --dir packages/core build` 通过（core 不再有小说代码）
- [x] 2.15 验证：`pnpm --dir packages/novel-plugin exec tsc --noEmit` 通过

## Batch 3：迁移 studio 小说路由 → novel-plugin/routes/

- [x] 3.1 创建 `novel-plugin/src/routes/` 目录
- [x] 3.2 `git mv studio/src/api/routes/ai.ts novel-plugin/src/routes/`
- [x] 3.3 `git mv studio/src/api/routes/jingwei.ts novel-plugin/src/routes/`
- [x] 3.4 `git mv studio/src/api/routes/writing-modes.ts novel-plugin/src/routes/`
- [x] 3.5 `git mv studio/src/api/routes/pipeline.ts novel-plugin/src/routes/`
- [x] 3.6 `git mv studio/src/api/routes/filter.ts novel-plugin/src/routes/`
- [x] 3.7 `git mv studio/src/api/routes/compliance.ts novel-plugin/src/routes/`
- [x] 3.8 `git mv studio/src/api/routes/bible.ts novel-plugin/src/routes/`
- [x] 3.9 `git mv studio/src/api/routes/writing-tools.ts novel-plugin/src/routes/`
- [x] 3.10 创建 `novel-plugin/src/routes/index.ts`（导出路由工厂）
- [x] 3.11 更新 import 路径（路由内部引用 engine 模块）
- [x] 3.12 `studio/src/api/routes/index.ts` 移除小说路由，改为通过 novel-plugin 加载
- [x] 3.13 验证：API 端点仍然可访问

## Batch 4：迁移 studio 小说服务 → novel-plugin/handlers/

- [x] 4.1 `git mv studio/src/api/lib/cockpit-service.ts novel-plugin/src/handlers/`
- [x] 4.2 `git mv studio/src/api/lib/candidate-tool-service.ts novel-plugin/src/handlers/`
- [x] 4.3 `git mv studio/src/api/lib/pgi-tool-service.ts novel-plugin/src/handlers/`
- [x] 4.4 `git mv studio/src/api/lib/guided-generation-tool-service.ts novel-plugin/src/handlers/`
- [x] 4.5 `git mv studio/src/api/lib/questionnaire-tool-service.ts novel-plugin/src/handlers/`
- [x] 4.6 `git mv studio/src/api/lib/narrative-line-service.ts novel-plugin/src/handlers/`
- [x] 4.7 `git mv studio/src/api/lib/novel-init-handler.ts novel-plugin/src/handlers/`
- [x] 4.8 `git mv studio/src/api/lib/novel-audit-handler.ts novel-plugin/src/handlers/`
- [x] 4.9 `git mv studio/src/api/lib/session-tool-registry-novel.ts novel-plugin/src/handlers/`
- [x] 4.10 `git mv studio/src/api/lib/writing-mode-tool.ts novel-plugin/src/handlers/`
- [x] 4.11 更新 import 路径
- [x] 4.12 `session-tool-executor.ts` 通过 PluginRegistry 调用 handler
- [x] 4.13 验证：工具调用仍然正常

## Batch 5：迁移前端面板 → novel-plugin/pages/

- [x] 5.1 创建 `novel-plugin/src/pages/` 目录
- [x] 5.2 `git mv studio/src/app-next/writing-workbench/ novel-plugin/src/pages/writing-workbench/`
- [x] 5.3 更新 novel-plugin/package.json（添加 React/UI 依赖）
- [x] 5.4 创建 `novel-plugin/src/pages/index.ts`（导出页面定义）
- [x] 5.5 `studio/src/app-next/StudioNextApp.tsx` 通过 novel-plugin 加载页面
- [x] 5.6 更新 vite.config.ts（添加 novel-plugin/src/pages 到 resolve）
- [x] 5.7 验证：写作工作台仍然可用（vite build 通过）

## Batch 6：验证 + 第二领域骨架

- [x] 6.1 `packages/core/src/` 不再有 pipeline/agents/jingwei/filter/presets/compliance/tools/bible
- [x] 6.2 `packages/studio/src/api/routes/` 不再有小说路由
- [x] 6.3 `packages/studio/src/api/lib/` 不再有小说服务
- [x] 6.4 `packages/studio/src/app-next/` 不再有 writing-workbench
- [x] 6.5 拔掉 novel-plugin 后 studio typecheck 通过（注释掉 plugin 加载行）
- [x] 6.6 创建 `packages/fitness-plugin/` 骨架（manifest + 空 handler + 空 page）
- [x] 6.7 fitness-plugin 能被 PluginRegistry 加载
- [x] 6.8 更新 `docs/04-架构与设计/` 架构文档
- [x] 6.9 更新 CLAUDE.md 仓库结构表
