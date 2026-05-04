# Backend Core Refactor v1 Design

## 总体策略

Backend Core Refactor v1 采用保守分阶段：先保护合同，再逐步拆分巨型 route/service。它不是 frontend-refoundation 的前置阻塞项；只有 Backend Contract 中发现的后端缺口、或前端合同层无法稳定表达的混乱边界，才进入本 spec。

```
Backend Contract v1
      ↓ protects
Route adapters ── Domain services ── Repositories / IO adapters
      ↓                ↓                     ↓
HTTP envelope       Business tests        SQLite / FS / runtime store
```

## 分层边界

| 层 | 职责 | 不做的事 |
|---|---|---|
| Route adapter | Hono params/body/query、状态码、JSON envelope | 不直接写复杂业务和文件扫描 |
| Domain service | 书籍、章节、候选稿、session、provider 等业务动作 | 不依赖 Hono request |
| Repository/IO | SQLite、文件系统、runtime store、provider adapter | 不处理 UI 语义 |
| Shared contract | TS 类型、状态枚举、错误 envelope | 不实现业务 |
| Contract tests | 验证 route/service 行为与文档一致 | 不替代单元测试 |

## 迁移阶段

### Phase 0：合同守护

- 读取 backend-contract-v1 矩阵。
- 建立 route → contract → frontend client 映射表。
- 任何迁移先检查合同条目状态。
- 输出“不可破坏合同”清单：sessions、providers、books/chapters、candidates/drafts、session tools。

### Phase 1：错误与状态规范化

- 在不破坏现有响应的前提下补齐规范化 helper。
- Provider adapter 保留现有 failure envelope。
- unsupported/process-memory/prompt-preview/chunked-buffer 继续透明显示。
- 新 route 必须使用结构化错误。

### Phase 2：拆分 storage.ts 领域能力

候选拆分：

```
api/routes/storage.ts
  ↓
api/routes/books.ts
api/routes/chapters.ts
api/routes/story-files.ts
api/routes/export.ts
api/routes/cockpit-drilldown.ts

api/lib/books-service.ts
api/lib/chapter-service.ts
api/lib/story-file-service.ts
api/lib/export-service.ts
```

拆分顺序：只读 → 非破坏写入 → 删除/导出。每步保留 route 测试。

### Phase 3：Session runtime 内聚

当前 `session-chat-service.ts` 体量大，但能力关键。迁移只在前端合同稳定后进行。

建议边界：

```
api/lib/session-runtime/
├── transport.ts          # WebSocket attach/detach/envelopes
├── recovery.ts           # cursor/ack/history gap
├── message-store.ts      # load/save/trim/chat history
├── turn-runner.ts        # runAgentTurn bridge
├── confirmation.ts       # pending confirmations/decision
└── title-and-thinking.ts # auto title / thinking translation side effects
```

约束：WebSocket envelope、REST snapshot/history、confirmation API 必须保持兼容。

### Phase 4：Provider/runtime store 收敛

- Provider routes 继续保持脱敏输出。
- Adapter failure code 不变化。
- 平台账号、模型池、测试状态统一由 runtime store 返回。
- 不恢复虚拟模型 fallback。

### Phase 5：文档与退役

- 标记 legacy route 的替代路径。
- 对未使用且阻塞维护的旧 route，先改文档为 deprecated/unsupported，再删除。
- 删除前全仓搜索前端 client、测试和 docs。

## 错误 envelope 原则

首版不要求所有 route 立即统一格式，但新增/迁移 route 必须至少满足：

```ts
type ApiFailure = {
  error: string | { code: string; message: string };
  code?: string;
  capability?: string;
  gate?: unknown;
};
```

Provider/model failure 继续使用现有：

```ts
{ success: false, code, error, capability? }
```

Session chat 继续使用：

```ts
{ type: "session:error", sessionId?, error, code?, runtime? }
```

## 测试策略

- 每个迁移 route 保留原 route 测试。
- 每个新 service 补 service 单测。
- 对合同核心能力增加 contract regression：books、sessions、providers、resources、writing actions。
- 对 destructive 行为保留确认/失败测试。
- 文档任务运行 `pnpm docs:verify`。

## 风险控制

| 风险 | 控制 |
|---|---|
| 前端合同被破坏 | 先跑 contract/client 测试，再迁移 route |
| storage.ts 拆分丢行为 | 每次只迁移一个领域，保留旧测试 |
| session runtime 恢复语义损坏 | WebSocket envelope golden tests |
| Provider 密钥泄露 | sanitize tests 保留 |
| legacy 删除过早 | 全仓搜索 + docs 状态改为 deprecated 后再删 |

## 不做的事

- 不一次性重写 server.ts 或所有 routes。
- 不在没有合同测试时拆 session runtime。
- 不用兼容 shim 让旧假行为继续看似可用。
- 不改变正式发布、构建或存储口径而不更新文档。
