# Backend Core Refactor v1 Contract Guard

**更新日期**: 2026-05-05
**状态**: current
**来源**: `backend-contract-v1` requirements/design、`packages/studio/src/api/backend-contract-matrix.ts`、`packages/studio/src/api/server.ts`、route/service/test 实际代码。

## 目的

本清单用于 backend-core-refactor-v1 task 1：在整理后端 route/service 前，冻结前端已依赖的合同边界。后续迁移 route、拆分 service 或退役 legacy 入口前，必须先核对本清单与 Backend Contract 矩阵；如真实行为变化，先更新共享类型、contract client 测试与 API 文档。

## 不可破坏合同分组

| 分组 | 合同入口 | 当前来源 | 必须保留的语义 |
|---|---|---|---|
| 启动/侧栏 | `GET /api/books`、`GET /api/sessions?sort=recent&status=active`、`GET /api/providers/status`、`GET /api/providers/models`、`GET /api/providers/summary` | `createStorageRouter`、`sessionRouter`、`createProvidersRouter` | 真实书籍、真实会话、真实 provider/model；失败可见，不填 mock/demo。 |
| 叙述者会话 | `GET /api/sessions/:id/chat/state`、`GET /api/sessions/:id/chat/history?sinceSeq=`、`WS /api/sessions/:id/chat`、`GET/POST /api/sessions/:id/tools*` | `sessionRouter`、`setupSessionWebSocket`、`session-chat-service`、`session-tool-executor` | snapshot/history/replay、ack/cursor/resumeFromSeq、abort、confirmation gate、tool_result 失败语义不变。 |
| 资源工作台 | `GET /api/books/:id`、`GET/PUT /api/books/:id/chapters/:num`、`/api/books/:id/candidates*`、`/api/books/:id/drafts*`、story/truth/jingwei/narrative-line | `createStorageRouter`、`createChapterCandidatesRouter`、`createJingweiRouter`、`createNarrativeLineRouter` | 章节、候选稿、草稿、story/truth、经纬与叙事线必须来自真实存储；只读/unsupported 不提供假保存。 |
| 写作动作 | session-native 工具链、`POST /api/books/:bookId/inline-write`、`POST /api/books/:bookId/writing-modes/apply`、`POST /api/ai/complete` | `SESSION_TOOL_DEFINITIONS`、`createWritingModesRouter`、`createAIRouter` | AI 输出默认进入 candidate/draft/preview；prompt-preview/chunked-buffer 边界不伪装成完整 current 写入。 |
| Provider/runtime store | `/api/providers*`、`/api/platform-integrations`、`/api/models/aggregations`、`/api/runtime-capabilities` | `createProvidersRouter`、`ProviderRuntimeStore`、`createPlatformIntegrationsRouter`、`createAggregationsRouter`、`createRuntimeCapabilitiesRouter` | 明文密钥不回传；unsupported/auth-missing/config-missing/upstream-error/network-error code 保留。 |

## Route / tool / shared type 映射

| ID | 入口 | 状态 | 真实来源 | 当前测试证据 | 后续补测要求 |
|---|---|---|---|---|---|
| `books.list` | `GET /api/books` | current | `routes/storage.ts#createStorageRouter` | `backend-contract-matrix.test.ts`、`resource-tree-adapter.test.ts`、`useShellData.test.ts` 间接覆盖 | task 2 补 route regression，覆盖成功与非法/缺失 book root。 |
| `books.detail` | `GET /api/books/:id` | current | `routes/storage.ts#createStorageRouter` | `backend-contract-matrix.test.ts`、`resource-tree-adapter.test.ts` 间接覆盖 | task 2 补 route regression，覆盖 404/400。 |
| `books.create-status` | `GET /api/books/:id/create-status` | process-memory | `routes/storage.ts#createStorageRouter` | `backend-contract-matrix.test.ts` | 保留 process-memory 文档语义；补重启/文件存在兜底测试。 |
| `sessions.active` | `GET /api/sessions?sort=recent&status=active` | current | `routes/session.ts#sessionRouter` | `routes/session.test.ts`、`domain-clients.test.ts`、`useShellData.test.ts` | 迁移时保留 status/sort 查询语义。 |
| `sessions.crud` | `POST/PUT/DELETE /api/sessions/:id?` | current | `routes/session.ts#sessionRouter`、`lib/session-service.ts` | `routes/session.test.ts`、`lib/session-service.test.ts` | 迁移前补绑定 bookId/sessionMode 复用测试。 |
| `sessions.chat.state` | `GET /api/sessions/:id/chat/state` | current | `routes/session.ts#sessionRouter`、`lib/session-chat-service.ts` | `routes/session.test.ts`、`lib/session-chat-service.test.ts`、`useAgentConversationRuntime.test.tsx` | snapshot schema 改动前先改 shared/session-types 与 runtime tests。 |
| `sessions.chat.history` | `GET /api/sessions/:id/chat/history?sinceSeq=` | current | `routes/session.ts#sessionRouter`、`lib/session-chat-service.ts` | `routes/session.test.ts`、`session-websocket.test.ts` | 保留 resetRequired 与 sinceSeq 语义。 |
| `sessions.chat.websocket` | `WS /api/sessions/:id/chat` | current | `server.ts#setupSessionWebSocket`、`lib/session-chat-service.ts` | `session-websocket.test.ts`、`ws-envelope-reducer.test.ts` | 拆 transport 前补 golden envelope/replay/abort 测试。 |
| `sessions.tools.confirm` | `GET /api/sessions/:id/tools` + `POST /api/sessions/:id/tools/:toolName/confirm` | current | `routes/session.ts#sessionRouter`、`lib/session-tool-executor.ts` | `routes/session.test.ts`、`lib/session-tool-executor.test.ts`、`ConversationSurface.test.tsx` | 确认门失败不能返回假成功。 |
| `chapters.detail` | `GET/PUT /api/books/:id/chapters/:num` | current | `routes/storage.ts#createStorageRouter` | `backend-contract-matrix.test.ts`、`resource-viewers.test.tsx` 间接覆盖 | task 2/4 补 storage route + service tests。 |
| `candidates.accept` | `POST /api/books/:id/candidates/:candidateId/accept` | current | `routes/chapter-candidates.ts#createChapterCandidatesRouter` | `routes/chapter-candidates.test.ts`、`candidate-tool-service.test.ts` | 保留 merge/replace/draft 三态和不存在 404。 |
| `drafts.crud` | `GET/POST/PUT/DELETE /api/books/:id/drafts*` | current | `routes/chapter-candidates.ts#createChapterCandidatesRouter` | `routes/chapter-candidates.test.ts`、`resource-tree-adapter.test.ts` | 保留 drafts CRUD 与 AI draft 异步动作边界。 |
| `narrative.line.snapshot` | `GET /api/books/:bookId/narrative-line` / `narrative.read_line` | current | `routes/narrative-line.ts#createNarrativeLineRouter`、`SESSION_TOOL_DEFINITIONS` | `routes/narrative-line.test.ts`、`narrative-line-service.test.ts`、`registry.test.tsx` | propose/apply 与 read snapshot 不混淆。 |
| `session-native.write-next` | `cockpit.get_snapshot → pgi.generate_questions → guided.enter/guided.exit → candidate.create_chapter` | current | `lib/session-tool-registry.ts#SESSION_TOOL_DEFINITIONS`、对应 tool services | `session-tool-registry.test.ts`、`candidate-tool-service.test.ts`、`pgi-tool-service.test.ts`、`guided-generation-tool-service.test.ts`、`questionnaire-tool-service.test.ts` | 保留候选区落盘，不覆盖正式章节。 |
| `writing-modes.preview` | `POST /api/books/:bookId/inline-write` | prompt-preview | `routes/writing-modes.ts#createWritingModesRouter` | `routes/writing-modes.test.ts`、`writing-action-adapter.test.ts` | 保留 prompt-preview 和模型缺失 gate。 |
| `writing-modes.apply` | `POST /api/books/:bookId/writing-modes/apply` | current | `routes/writing-modes.ts#createWritingModesRouter` | `routes/writing-modes.test.ts` | 正式写入仍需显式 apply/候选边界。 |
| `ai.complete.chunked-buffer` | `POST /api/ai/complete` | chunked-buffer | `routes/ai.ts#createAIRouter` | `routes/ai.test.ts`、`contract-client.test.ts` | 保留“完整结果后分块”的非原生流式说明。 |
| `providers.status` | `GET /api/providers/status` | current | `routes/providers.ts#createProvidersRouter`、`ProviderRuntimeStore` | `routes/providers.test.ts`、`provider-client.test/domain-clients.test.ts` | 失败必须保留真实 provider code。 |
| `providers.models` | `GET /api/providers/models` | current | `routes/providers.ts#createProvidersRouter`、`runtime-model-pool.ts` | `routes/providers.test.ts`、`runtime-model-pool.test.ts` | 不恢复虚拟模型 fallback。 |
| `providers.summary` | `GET /api/providers/summary` | current | `routes/providers.ts#createProvidersRouter`、`ProviderRuntimeStore` | `routes/providers.test.ts`、`provider-runtime-store.test.ts` | 继续脱敏输出。 |
| `providers.model.test` | `POST /api/providers/:id/models/:modelId/test` | current | `routes/providers.ts#createProvidersRouter`、provider adapters | `routes/providers.test.ts`、`provider-adapters.test.ts` | unsupported/auth/upstream/network code 原样展示。 |

## 当前 route mount 事实

`createStudioServer` 当前在 standalone 模式挂载的核心 route 包括：auth、runs、workbench、AI、storage、chapter-candidates、snapshots、daemon、MCP、lorebook、bible、jingwei、filter、pipeline、settings、onboarding、providers、aggregations、runtime-capabilities、platform-integrations、proxy、git、agent-config、tools、worktree、workspace、rhythm、golden-chapters、chat、context-manager、admin、routines、presets、compliance、writing-tools、writing-modes、narrative-line、search、sessions、exec、terminals、monitor。Relay 模式仅挂载 auth/runs 与 AI relay。

## Task 2 补测清单

- `routes/storage.ts` 中 books/detail/chapter create-save-read-delete/story/truth 的 route regression 需要补齐，避免 task 4-6 拆 storage 时只靠前端 adapter test。
- `books.create-status` 的 `process-memory` 与文件存在兜底语义需要明确测试。
- `sessions.crud` 的 bookId 绑定会话复用需要 route/service 侧补测，前端 task 9 已有 UI 侧覆盖但不能替代后端 regression。
- 拆 session runtime 前必须补 WebSocket snapshot/replay/ack/abort/confirmation golden tests。

## 决策纪律

1. 任何后端 route/service 迁移前，先确认本清单对应 ID、状态、真实来源与测试证据。
2. 若真实代码与清单不一致，以真实代码为准，先更新 Backend Contract 矩阵、共享类型、contract client 测试和 API 文档。
3. 删除 route 前必须全仓搜索 frontend client、docs、tests；没有 active 依赖后才允许退役。
4. `unsupported`、`process-memory`、`prompt-preview`、`chunked-buffer` 不得在重构中被描述为稳定成功能力。
