# 插件架构真拆分 — 设计文档

## 目标架构

```
┌─────────────────────────────────────────────────────────────────┐
│ packages/studio (通用 Agent 工作台)                               │
│                                                                  │
│ ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐  │
│ │ Agent 对话    │  │ 设置/供应商   │  │ 插件加载器              │  │
│ │ 工具卡片渲染  │  │ 用户管理     │  │ ├── registerRoutes()   │  │
│ │ 状态栏       │  │ 通用工具     │  │ ├── registerTools()    │  │
│ └──────────────┘  └──────────────┘  │ ├── registerPages()    │  │
│                                      │ └── registerPresets()  │  │
│                                      └────────────┬───────────┘  │
└───────────────────────────────────────────────────┼──────────────┘
                                                    │ loads
                    ┌───────────────────────────────┼───────────────┐
                    │                               ▼               │
┌───────────────────┴───┐                ┌─────────────────────────┐
│ packages/core          │                │ packages/novel-plugin    │
│ (通用基础设施)          │◄──depends on──│ (小说领域插件)            │
│                        │                │                         │
│ ├── storage/           │                │ ├── engine/             │
│ ├── plugins/           │                │ │   ├── pipeline/       │
│ ├── runtime/           │                │ │   ├── agents/         │
│ ├── llm/               │                │ │   ├── jingwei/        │
│ ├── state/             │                │ │   ├── filter/         │
│ ├── hooks/             │                │ │   ├── presets/        │
│ ├── mcp/               │                │ │   └── compliance/     │
│ └── types/utils/       │                │ ├── routes/             │
└────────────────────────┘                │ ├── handlers/           │
                                          │ ├── pages/              │
                                          │ └── manifest.ts         │
                                          └─────────────────────────┘
```

## 插件加载器接口设计

```typescript
// packages/studio/src/api/lib/plugin-loader.ts

import type { Hono } from "hono";

export interface PluginRouteFactory {
  /** 路由前缀，如 "/api/books" */
  prefix: string;
  /** 创建 Hono 子应用 */
  createRouter: (ctx: PluginRouteContext) => Hono;
}

export interface PluginPageDefinition {
  id: string;
  label: string;
  icon: string;
  /** 动态 import 路径 */
  componentPath: string;
  /** 需要 bookId 才显示 */
  requiresBook?: boolean;
  order?: number;
}

export interface PluginToolHandler {
  toolName: string;
  execute: (input: Record<string, unknown>, context: ToolHandlerContext) => Promise<unknown>;
}

export interface LoadedPlugin {
  id: string;
  name: string;
  version: string;
  projectType: string;
  routes: PluginRouteFactory[];
  tools: PluginToolHandler[];
  pages: PluginPageDefinition[];
  agentPresets: Array<{ agentId: string; name: string; tools: string[] }>;
}

export interface PluginRouteContext {
  storage: StorageDatabase;
  root: string;
  getSessionLlm: () => Promise<SessionLlm>;
}

export interface PluginRegistry {
  register(plugin: LoadedPlugin): void;
  getRoutes(): PluginRouteFactory[];
  getTools(projectType?: string): PluginToolHandler[];
  getPages(projectType?: string): PluginPageDefinition[];
  getPresets(projectType?: string): Array<{ agentId: string; name: string; tools: string[] }>;
}
```

## 依赖关系

```
core ← novel-plugin ← studio
core ← studio

core 不依赖 novel-plugin（单向依赖）
studio 不直接 import novel-plugin 的内部模块（通过插件加载器）
novel-plugin 依赖 core 的 storage/types/llm/runtime
```

## 文件移动清单

### Batch 2: core → novel-plugin/engine/

| 源 | 目标 | 文件数 |
|---|---|---|
| `core/src/pipeline/` | `novel-plugin/src/engine/pipeline/` | ~15 |
| `core/src/agents/` | `novel-plugin/src/engine/agents/` | ~20 |
| `core/src/jingwei/` | `novel-plugin/src/engine/jingwei/` | ~25 |
| `core/src/filter/` | `novel-plugin/src/engine/filter/` | ~10 |
| `core/src/presets/` | `novel-plugin/src/engine/presets/` | ~30 |
| `core/src/compliance/` | `novel-plugin/src/engine/compliance/` | ~8 |
| `core/src/tools/` | `novel-plugin/src/engine/tools/` | ~15 |
| `core/src/bible/` | `novel-plugin/src/engine/bible/` | ~5 |
| **总计** | | **~128 文件** |

### Batch 3: studio routes → novel-plugin/routes/

| 源 | 目标 |
|---|---|
| `studio/src/api/routes/ai.ts` | `novel-plugin/src/routes/ai.ts` |
| `studio/src/api/routes/jingwei.ts` | `novel-plugin/src/routes/jingwei.ts` |
| `studio/src/api/routes/writing-modes.ts` | `novel-plugin/src/routes/writing-modes.ts` |
| `studio/src/api/routes/pipeline.ts` | `novel-plugin/src/routes/pipeline.ts` |
| `studio/src/api/routes/filter.ts` | `novel-plugin/src/routes/filter.ts` |
| `studio/src/api/routes/compliance.ts` | `novel-plugin/src/routes/compliance.ts` |
| `studio/src/api/routes/bible.ts` | `novel-plugin/src/routes/bible.ts` |
| `studio/src/api/routes/writing-tools.ts` | `novel-plugin/src/routes/writing-tools.ts` |
| `studio/src/api/routes/context-manager.ts` | `novel-plugin/src/routes/context-manager.ts` |

### Batch 4: studio services → novel-plugin/handlers/

| 源 | 目标 |
|---|---|
| `studio/src/api/lib/cockpit-service.ts` | `novel-plugin/src/handlers/cockpit-service.ts` |
| `studio/src/api/lib/candidate-tool-service.ts` | `novel-plugin/src/handlers/candidate-tool-service.ts` |
| `studio/src/api/lib/pgi-tool-service.ts` | `novel-plugin/src/handlers/pgi-tool-service.ts` |
| `studio/src/api/lib/guided-generation-tool-service.ts` | `novel-plugin/src/handlers/guided-generation-tool-service.ts` |
| `studio/src/api/lib/questionnaire-tool-service.ts` | `novel-plugin/src/handlers/questionnaire-tool-service.ts` |
| `studio/src/api/lib/narrative-line-service.ts` | `novel-plugin/src/handlers/narrative-line-service.ts` |
| `studio/src/api/lib/novel-init-handler.ts` | `novel-plugin/src/handlers/novel-init-handler.ts` |
| `studio/src/api/lib/novel-audit-handler.ts` | `novel-plugin/src/handlers/novel-audit-handler.ts` |
| `studio/src/api/lib/session-tool-registry-novel.ts` | `novel-plugin/src/handlers/tool-registry.ts` |
| `studio/src/api/lib/writing-mode-tool.ts` | `novel-plugin/src/handlers/writing-mode-tool.ts` |

### Batch 5: studio frontend → novel-plugin/pages/

| 源 | 目标 |
|---|---|
| `studio/src/app-next/writing-workbench/` (全部) | `novel-plugin/src/pages/writing-workbench/` |

## 留在 core 的（不动）

- `storage/` — 所有领域共享 SQLite
- `storage/migrations/` — 包括小说的 migration（由 core runner 统一执行）
- `plugins/` — 插件类型定义
- `runtime/` — 进程适配器
- `llm/` — LLM 客户端
- `state/` — StateManager
- `hooks/` — Hook 系统
- `mcp/` — MCP 协议
- `types/` `utils/` `models/` `registry/` — 通用工具

## 留在 studio 的（不动）

- `api/lib/agent-turn-runtime.ts` — 通用 Agent Loop
- `api/lib/llm-runtime-service.ts` — LLM 调用
- `api/lib/session-chat-service.ts` — 会话管理
- `api/lib/session-tool-executor.ts` — 工具执行（调用插件 handler）
- `api/lib/provider-adapters/` — 供应商适配
- `api/lib/tools/` (Bash/Read/Write/Edit/Glob/Grep/Browser/WebSearch/WebFetch) — 通用工具
- `api/lib/plugin-loader.ts` — 插件加载器（新增）
- `api/routes/session.ts` — 通用会话路由
- `api/routes/settings.ts` — 设置路由
- `api/routes/storage.ts` — 通用存储路由（导出等）
- `app-next/agent-conversation/` — 对话界面
- `app-next/StudioNextApp.tsx` — 主应用壳

## novel-plugin 的 package.json

```json
{
  "name": "@vivy1024/novelfork-novel-plugin",
  "version": "0.5.2",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "dependencies": {
    "@vivy1024/novelfork-core": "workspace:*"
  },
  "peerDependencies": {
    "hono": "^4.0.0"
  }
}
```

## 前端插件页面加载机制

```typescript
// studio 侧：动态加载插件页面
const pluginPages = pluginRegistry.getPages(currentProjectType);

// 渲染
{pluginPages.map(page => (
  <Suspense key={page.id} fallback={<Loader />}>
    <LazyPluginPage componentPath={page.componentPath} bookId={bookId} />
  </Suspense>
))}

// LazyPluginPage 内部用 dynamic import
const LazyPluginPage = ({ componentPath, bookId }) => {
  const Component = lazy(() => import(/* @vite-ignore */ componentPath));
  return <Component bookId={bookId} />;
};
```

实际上 Vite 不支持完全动态的 import 路径。解决方案：
- novel-plugin 编译后输出到 studio 的 `dist/plugins/novel/` 目录
- studio 用已知路径 `import("./plugins/novel/pages/index.js")` 加载
- 或者：novel-plugin 的前端代码直接编译进 studio 的 vite bundle（通过 workspace 引用）

**最简方案**：novel-plugin 的 pages/ 通过 workspace 引用被 studio 的 vite 直接打包。不需要运行时动态加载。

```typescript
// studio/src/app-next/plugin-pages.tsx
import { lazy } from "react";

const novelPages = {
  "writing-workbench": lazy(() => import("@vivy1024/novelfork-novel-plugin/pages/writing-workbench")),
};
```
