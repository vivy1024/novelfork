# 工程底座加固 v1 — Design

**版本**: v1.0.0
**创建日期**: 2026-05-01
**状态**: 待审批

---

## 设计原则

1. **最小实现**：每个模块不超过 100 行，能跑就行，不求完美
2. **零新依赖**：纯 TypeScript + 现有 API
3. **只加固不重构**：不改现有组件行为，只在边缘加抽象层

---

## 1. createStore — 全局状态（R1）

### 设计

```typescript
// packages/studio/src/stores/app-store.ts

export interface AppState {
  activeBookId: string | null;
  activeChapterNumber: number | null;
}

type Listener = () => void;

export type AppStore = {
  getState: () => AppState;
  setState: (updater: (prev: AppState) => AppState) => void;
  subscribe: (listener: Listener) => () => void;
};

export function createAppStore(initial: AppState): AppStore {
  let state = initial;
  const listeners = new Set<Listener>();

  return {
    getState: () => state,
    setState(updater) {
      const next = updater(state);
      if (Object.is(next, state)) return;
      state = next;
      for (const fn of listeners) fn();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const appStore = createAppStore({ activeBookId: null, activeChapterNumber: null });
```

### 接入点

- `WorkspacePage`: 选中书籍/章节时 `appStore.setState(prev => ({ ...prev, activeBookId }))`
- `AgentWritingEntry`: 读取 `appStore.getState().activeBookId` 作为默认 bookId
- `ChatWindow`: 创建 writer session 时自动设置 `projectId = appStore.getState().activeBookId`

---

## 2. API Client（R2）

### 设计

```typescript
// packages/studio/src/api/client.ts

import { fetchJson, postApi, putApi } from "../../hooks/use-api";
import type { BookDetail, ChapterSummary } from "../../shared/contracts";

export const api = {
  books: {
    list: () => fetchJson<{ books: Array<{ id: string; title: string; ... }> }>("/books"),
    get: (id: string) => fetchJson<{ book: BookDetail; chapters: ChapterSummary[]; nextChapter: number }>(`/books/${id}`),
    create: (data: { title: string; genre?: string; ... }) => postApi<{ bookId: string }>("/books/create", data),
    delete: (id: string) => fetchJson<{ ok: boolean }>(`/books/${id}`, { method: "DELETE" }),
  },
  chapters: {
    get: (bookId: string, num: number) => fetchJson<{ content: string }>(`/books/${bookId}/chapters/${num}`),
    save: (bookId: string, num: number, content: string) => putApi<{ ok: boolean }>(`/books/${bookId}/chapters/${num}`, { content }),
    create: (bookId: string, title?: string) => postApi<{ chapter: ChapterSummary }>(`/books/${bookId}/chapters`, { title }),
    delete: (bookId: string, num: number) => fetchJson<{ ok: boolean }>(`/books/${bookId}/chapters/${num}`, { method: "DELETE" }),
  },
  candidates: {
    list: (bookId: string) => fetchJson<{ candidates: ... }>(`/books/${bookId}/candidates`),
    accept: (bookId: string, id: string, action: "merge" | "replace" | "draft") => postApi(`/books/${bookId}/candidates/${id}/accept`, { action }),
    reject: (bookId: string, id: string) => postApi(`/books/${bookId}/candidates/${id}/reject`),
    delete: (bookId: string, id: string) => fetchJson(`/books/${bookId}/candidates/${id}`, { method: "DELETE" }),
  },
  progress: {
    get: () => fetchJson<{ progress: ... }>("/progress"),
  },
};
```

### 迁移策略

- 第一步只定义不替换：`api.ts` 写好，测试通过
- 第二步 WorkspacePage 逐步切换：`useApi` → `api.books.get()`
- 旧代码不强制迁移，新代码优先用 `api.*`

---

## 3. 统一工具目录（R3）

### 设计

```typescript
// packages/studio/src/api/lib/tool-catalog.ts

import { BUILTIN_TOOLS } from "@vivy1024/novelfork-core";

export type ToolCategory = "core-writing" | "narrafork-general" | "narrafork-ops";

export interface ToolCatalogEntry {
  name: string;
  description: string;
  loadCommand: string;
  enabled: boolean;
  category: ToolCategory;
}

export const TOOL_CATALOG: ToolCatalogEntry[] = [
  // Core 写作工具
  ...BUILTIN_TOOLS.map(t => ({
    name: t.name,
    description: t.description ?? "",
    loadCommand: `/load ${t.name}`,
    enabled: true,
    category: "core-writing" as const,
  })),
  // NarraFork 通用工具（从 ToolsTab 的 AVAILABLE_TOOLS 提取）
  ...NARRAFORK_TOOLS,
];

export function getToolsByCategory(category: ToolCategory): ToolCatalogEntry[] {
  return TOOL_CATALOG.filter(t => t.category === category);
}
```

### ToolsTab 迁移

```typescript
// ToolsTab.tsx 改动：
// 旧: const tools = AVAILABLE_TOOLS
// 新: const tools = TOOL_CATALOG.filter(t => t.category !== "core-writing")
```

---

## 4. bun compile（R4）

### 构建步骤

```bash
# 1. 构建前端
bun run build:client  # vite build → dist/client/

# 2. 构建 server
bun run build:server  # tsc → dist/api/

# 3. 单文件编译
bun build --compile --target=bun \
  ./packages/studio/src/api/index.ts \
  --outfile=dist/novelfork
```

### 静态资源嵌入

复用现有 `static-provider.ts` 的 `embedded` 模式。编译前将 `dist/client/` 的内容序列化嵌入 server bundle。

```typescript
// compile.ts
await Bun.build({
  entrypoints: ["./packages/studio/src/api/index.ts"],
  outdir: "./dist",
  target: "bun",
  // 嵌入静态资源
  define: {
    STATIC_ASSETS: JSON.stringify(await readRecursive("./dist/client")),
  },
});
```

---

## 5. 旧前端清理（R5）

### 清理范围

基于 `old-frontend-decommission` 已确认的安全删除列表：

```
packages/studio/src/
├── pages/          # 旧页面容器（已被 app-next 替代）
├── routes/         # 旧路由（Hono 路由已迁移）
├── components/
│   ├── old-dashboard/  # 旧 Dashboard
│   └── old-settings/   # 旧 Settings
└── hooks/
    └── use-tabs.ts     # 已废弃的 tab hooks
```

### 安全检查

删除后运行：
1. `grep -r "from.*pages/" src/app-next/` — 确认新前端不依赖旧页面
2. `bun run typecheck` — 无新增错误
3. `bun run test` — 全量通过

---

## 6. 文件清单

```
packages/studio/src/
├── stores/
│   └── app-store.ts          # [新] createAppStore + 全局 AppState
├── api/
│   └── client.ts             # [新] API Client
│   └── lib/
│       └── tool-catalog.ts   # [新] 统一工具目录
├── app-next/workspace/
│   └── WorkspacePage.tsx     # [改] 接入 appStore
└── components/
    └── Routines/ToolsTab.tsx # [改] 从 tool-catalog 读取

packages/studio/
├── scripts/
│   └── compile.ts            # [新] bun compile 脚本
└── package.json              # [改] 新增 compile script

packages/studio/src/ (删除)
├── pages/                    # [删] 旧页面
└── hooks/use-tabs.ts         # [删] 废弃 hooks
```
