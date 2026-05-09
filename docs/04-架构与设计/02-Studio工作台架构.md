# Studio 工作台架构

**版本**: v1.0.0
**创建日期**: 2026-05-10
**状态**: ✅ 当前有效
**文档类型**: current

---

## 三栏布局

```
┌──────────────┬─────────────────────────────────┬──────────────────────┐
│              │                                 │                      │
│  ShellSidebar│     RouteMountPoint             │  叙述者会话（docked） │
│  （全局导航） │     （主内容区）                  │  ConversationSurface │
│              │                                 │                      │
│  - 作品列表  │  根据 ShellRoute 渲染：          │  - MessageStream     │
│  - 会话列表  │  - WritingWorkbenchRoute        │  - NarratorStatusBar │
│  - 搜索      │  - ConversationRoute            │  - Composer          │
│  - 套路      │  - SessionsRoute                │  - ConfirmationGate  │
│  - 设置      │  - SearchRoute                  │                      │
│              │  - RoutinesRoute                │                      │
│              │  - SettingsRoute                │                      │
│              │                                 │                      │
└──────────────┴─────────────────────────────────┴──────────────────────┘
```

叙述者会话面板固定在右侧（docked），用户在主内容区操作时可随时与 AI 叙述者对话。

## 路由系统

路由定义在 `src/app-next/shell/shell-route.ts`：

```typescript
export type ShellRoute =
  | { readonly kind: "home" }
  | { readonly kind: "narrator"; readonly sessionId: string }
  | { readonly kind: "book"; readonly bookId: string }
  | { readonly kind: "sessions" }
  | { readonly kind: "search" }
  | { readonly kind: "routines" }
  | { readonly kind: "settings" };
```

URL 映射规则：
- `/next` → home
- `/next/narrators/:sessionId` → narrator
- `/next/books/:bookId` → book（写作工作台）
- `/next/sessions` → 会话列表
- `/next/search` → 全局搜索
- `/next/routines` → 套路管理
- `/next/settings` → 设置

导航项通过 `getShellNavItems()` 从 books + sessions 数据生成，分为 `books`、`narrators`、`global` 三组。

## Shell 数据层

`src/app-next/shell/useShellData.ts` 提供全局数据存储：

```typescript
export interface UseShellDataResult {
  readonly books: readonly ShellBookItem[];
  readonly sessions: readonly ShellSessionItem[];
  readonly providerSummary: ShellDataProviderSummary | null;
  readonly providerStatus: ShellDataProviderStatus | null;
  readonly loading: boolean;
  readonly error: string | null;
}
```

实现机制：
- 使用 `useSyncExternalStore` 订阅模块级 snapshot
- 启动时并行加载 books、sessions、providerSummary、providerStatus
- 提供 `invalidate(scope)` 和 `upsertSession()` 用于局部刷新
- 请求序列号防止竞态

## backend-contract 层

位于 `src/app-next/backend-contract/`，是前端与后端通信的唯一通道。

### ContractClient

```typescript
export interface ContractClient {
  request<T>(method: string, path: string, body?: unknown, options?: ContractRequestOptions): Promise<ContractResult<T>>;
  get<T>(path: string, options?: ContractRequestOptions): Promise<ContractResult<T>>;
  post<T>(path: string, body?: unknown, options?: ContractRequestOptions): Promise<ContractResult<T>>;
  put<T>(path: string, body?: unknown, options?: ContractRequestOptions): Promise<ContractResult<T>>;
  patch<T>(path: string, body?: unknown, options?: ContractRequestOptions): Promise<ContractResult<T>>;
  delete<T>(path: string, options?: ContractRequestOptions): Promise<ContractResult<T>>;
}
```

每个请求返回 `ContractResult<T>`，统一处理成功/失败/网络错误/JSON 解析错误。每个请求携带 `capability` 元数据，前端据此决定 UI 行为。

### 领域客户端

| 客户端 | 文件 | 职责 |
|---|---|---|
| `createResourceClient` | `resource-client.ts` | 作品/章节/候选稿/草稿/真相文件/精卫条目 CRUD |
| `createSessionClient` | `session-client.ts` | 会话生命周期/对话/记忆/工具确认 |
| `createWritingActionClient` | `writing-action-client.ts` | 写作动作：write-next/draft/audit/detect/hooks |
| `createProviderClient` | `provider-client.ts` | 模型提供商状态/模型列表/测试 |

### api-paths.ts

集中管理所有 API 路径常量和构建函数：

```typescript
export const BOOKS_API_PATH = "/api/books";
export const SESSIONS_API_PATH = "/api/sessions";
export const PROVIDERS_API_PATH = "/api/providers";

export function buildBookApiPath(bookId: string, ...segments: readonly ApiPathSegment[]): string;
export function buildSessionApiPath(sessionId: string, ...segments: readonly ApiPathSegment[]): string;
```

设计目的：消除前端代码中的路由字面量散落，路径变更只需改一处。

### capability-status.ts

能力状态决策系统：

```typescript
export type CapabilityStatus =
  | "current"          // 完全可用
  | "process-memory"   // 可用但依赖进程内存
  | "prompt-preview"   // 只读预览
  | "chunked-buffer"   // 分块缓冲（非原生流式）
  | "unsupported"      // 不支持
  | "planned"          // 规划中
  | "deprecated";      // 已废弃
```

每个 capability status 映射到一组 UI 决策（enabled/disabled/readonly/previewOnly/allowsFetch/allowsFormalWrite/allowedActions），前端组件据此自动调整交互状态。

## 写作工作台组件树

当 `ShellRoute.kind === "book"` 时渲染写作工作台：

```
WritingWorkbenchRoute
├── WorkbenchResourceTree          # 左侧资源树（章节/真相文件/精卫条目）
└── WorkbenchCanvas                # 主画布区
    ├── CockpitOverview            # 默认视图（未选中资源时）
    ├── ResourceViewer             # 资源内容查看/编辑
    ├── CandidateActionsBar        # 候选稿操作栏
    ├── JingweiEntryEditor         # 精卫条目编辑器
    └── WorkbenchWritingActions    # 写作动作按钮
```

`WorkbenchWritingActions` 根据 `WritingActionDescriptor` 列表渲染按钮，每个按钮对应一个写作动作（写下一章、审计、检测等）。

## 对话组件树

叙述者会话的组件结构：

```
ConversationRoute
└── ConversationSurface
    ├── MessageStream              # 消息流（历史+流式）
    ├── NarratorStatusBar          # 状态栏
    │   ├── ContextRing            # 上下文用量环
    │   ├── ModelDropdown          # 模型选择
    │   ├── ReasoningDropdown      # 推理模式
    │   └── PermissionDropdown     # 权限控制
    ├── Composer                   # 输入框
    └── ConfirmationGate           # 工具确认门
```

`ConfirmationGate` 在 AI 需要执行写入操作（如创建候选稿）时弹出，用户确认后才执行。

## 实时通信

### WebSocket — 会话对话

```
浏览器                              服务器
  │                                   │
  │──── session:message ────────────▶│  用户发送消息
  │                                   │
  │◀──── session:snapshot ───────────│  初始快照
  │◀──── session:stream ─────────────│  流式 token
  │◀──── session:message ────────────│  完整消息
  │◀──── session:state ──────────────│  会话状态变更
  │◀──── session:error ──────────────│  错误
  │                                   │
  │──── session:ack ─────────────────▶│  确认收到
  │──── session:abort ───────────────▶│  中断生成
```

WebSocket URL 通过 `buildSessionWebSocketUrl()` 构建，支持 `resumeFromSeq` 断线续传。

客户端状态通过 `reduceSessionServerEnvelope()` 纯函数 reducer 管理：

```typescript
export interface SessionWebSocketRuntimeState {
  session: NarratorSessionRecord | null;
  messages: NarratorSessionChatMessage[];
  cursor: NarratorSessionChatSnapshot["cursor"] | null;
  lastSeq: number;
  streamingMessageId: string | null;
  error: { message: string; code?: string; runtime?: unknown } | null;
  recovery: NarratorSessionRecoveryEnvelope;
  resetRequired: boolean;
}
```

### SSE — 全局 AI 事件

用于广播写作管线事件（write:start/complete/error、audit:start/complete/error 等），不绑定特定会话。前端通过 `use-sse.ts` hook 订阅。

## 设计决策

1. **Shell + Route 分离**：Shell（侧边栏+数据层）是常驻的，Route 内容按需挂载。切换路由不会丢失 Shell 状态。

2. **ContractResult 统一错误模型**：所有后端调用返回相同的 Result 类型，前端不需要 try-catch，通过 `.ok` 判断即可。

3. **Capability 驱动 UI**：后端声明每个能力的状态，前端自动适配。新增能力时只需声明 status，UI 自动降级。

4. **WebSocket reducer 模式**：会话状态通过纯函数 reducer 管理，便于测试和调试。流式消息优化为末尾追加而非全量 map。
