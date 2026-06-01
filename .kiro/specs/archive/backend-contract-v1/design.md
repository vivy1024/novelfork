# Backend Contract v1 Design

## 总体设计

Backend Contract v1 是新前端的“唯一事实源”约束层。它把真实后端能力整理为矩阵，并要求前端通过集中 contract client 访问这些能力。

```
真实 route / WebSocket / session tools
            ↓
shared contracts + backend capability matrix
            ↓
contract client / hooks
            ↓
Agent Shell / Storyline Workbench / Settings / Routines
```

合同不替代代码实现；合同每一行都必须能反查到 route、共享类型或 session tool registry。

## 状态枚举

| 状态 | 含义 | 前端规则 |
|---|---|---|
| `current` | route/tool 已存在，返回真实数据、真实写入或真实失败 | 可启用，展示真实 loading/error |
| `process-memory` | 当前进程内存状态，重启不保证保留 | 可启用但显示临时/可恢复边界 |
| `prompt-preview` | 只返回 prompt/promptPreview 或预览结果 | 仅预览/复制/显式 apply，不写正式正文 |
| `chunked-buffer` | 拿到完整结果后再分块发送 | 可作为流式 UI，但必须标注非上游原生流式 |
| `unsupported` | 当前未接入或 adapter 不支持 | 禁用或展示失败说明，不伪造成功 |
| `planned` | spec 目标，当前不能调用 | 不渲染为可点击能力 |

## MVP 合同矩阵

### 1. 启动、侧栏与运行状态

| 用户能力 | 入口 | 状态 | 数据来源 | 前端规则 |
|---|---|---|---|---|
| 书籍列表 | `GET /api/books` | `current` | `book.json` + 章节索引 | Sidebar 叙事线唯一来源 |
| 书籍详情 | `GET /api/books/:id` | `current` | 书籍配置 + 章节索引 | 叙事线详情页主数据 |
| 会话列表 | `GET /api/sessions?sort=recent&status=active` | `current` | session store | Sidebar 叙述者唯一来源 |
| 会话 CRUD | `POST/PUT/DELETE /api/sessions/:id?` | `current` | session service | 创建、归档、恢复、新建绑定会话 |
| 项目配置 | `GET/PUT /api/project` | `current` | `novelfork.json` | 设置页/项目状态 |
| 写作进度 | `GET /api/progress`、`PUT /api/progress/config` | `current` | SQLite KV + writing log | 进度卡片；失败显示空/错误 |
| Provider 状态 | `GET /api/providers/status` | `current` | runtime provider store | 模型状态栏 |
| 模型池 | `GET /api/providers/models` | `current` | enabled provider/model/account | 模型选择器唯一来源 |
| Provider 概览 | `GET /api/providers/summary` | `current` | provider runtime store | 设置页统计 |

### 2. 叙述者会话与实时 Agent Shell

| 用户能力 | 入口 | 状态 | 数据来源 | 前端规则 |
|---|---|---|---|---|
| 初始快照 | `GET /api/sessions/:id/chat/state` | `current` | session history + runtime state | 打开会话先 hydrate |
| 增量历史 | `GET /api/sessions/:id/chat/history?sinceSeq=` | `current` | 持久化 chat history | WebSocket 断线 replay |
| 替换 chat state | `PUT /api/sessions/:id/chat/state` | `current` | session-chat-service | 压缩/恢复专用，不做普通编辑器 |
| 实时对话 | `WS /api/sessions/:id/chat` | `current` | session chat runtime | 处理 snapshot/state/message/stream/error |
| 发送消息 | client envelope `session:message` | `current` | WebSocket | 可附 canvasContext 与 ack |
| 中断 | client envelope `session:abort` | `current` | abort controller | 显示真实中断状态 |
| Ack | client envelope `session:ack` | `current` | cursor/recovery | 恢复状态栏使用 |
| Pending tools | `GET /api/sessions/:id/tools` | `current` | session tool state | 确认门列表 |
| 确认工具 | `POST /api/sessions/:id/tools/:toolName/confirm` | `current` | session tool executor | approve/reject 后刷新 snapshot |

### 3. 资源树与写作工作台

| 用户能力 | 入口 | 状态 | 数据来源 | 前端规则 |
|---|---|---|---|---|
| 新建书籍 | `POST /api/books/create` | `current` | 本地 scaffold + 默认 session | 显示 creating/ready，不假正文 |
| 建书状态 | `GET /api/books/:id/create-status` | `process-memory` + files | 当前进程状态 + 文件产物 | 重启后以书籍存在为准 |
| 更新/删除书籍 | `PUT/DELETE /api/books/:id` | `current` | 文件系统 + SQLite | 删除前需要明确确认 |
| 章节 CRUD | `GET/POST/PUT/DELETE /api/books/:id/chapters*` | `current` | `chapters/*.md` + index | 编辑器核心入口 |
| 章节通过/拒绝 | `POST /api/books/:id/chapters/:num/approve|reject` | `current` | 章节索引 | 状态按钮入口 |
| 导入章节文本 | `POST /api/books/:id/import/chapters` | `current` | 文件系统 | URL 导入仍不能冒充此能力 |
| 候选稿 CRUD | `/api/books/:id/candidates*` | `current` | `generated-candidates/` | AI 输出默认区 |
| 接受候选稿 | `POST /api/books/:id/candidates/:candidateId/accept` | `current` | 候选 + 章节/草稿 | `merge/replace/draft` 三种显式动作 |
| 草稿 CRUD | `GET/POST/PUT/DELETE /api/books/:id/drafts*` | `current` | `drafts/` | 不等同 AI draft 异步动作 |
| Story 文件 | `/api/books/:id/story-files*` | `current` | `story/` | 文件名校验失败显示 400 |
| Truth 文件 | `/api/books/:id/truth*`、`truth-files*` | `current` | `story/`/truth 映射 | 可读写/删除真实文件 |
| 经纬 sections/entries | `/api/books/:bookId/jingwei/*` | `current` | SQLite | 结构化资料库入口 |
| 问卷/core-shifts | `/api/questionnaires*`、`/api/books/:bookId/core-shifts*` | `current` | SQLite | 引导式生成与设定变更 |
| 叙事线快照 | `GET /api/books/:bookId/narrative-line`、`narrative.read_line` | `current` | 章节/经纬/冲突/伏笔聚合 | 只读图谱/画布 artifact |
| 叙事线变更草案 | `narrative.propose_change`、REST propose/apply | `current` / preview + explicit apply | mutation preview + decision apply | `propose` 只预览；`apply` 需显式 `decision`；session tool 为 `draft-write`，是否进确认门由 permission mode 决定 |

### 4. AI 写作与工具链

| 用户能力 | 入口 | 状态 | 数据来源 | 前端规则 |
|---|---|---|---|---|
| Session-native 写下一章 | `cockpit.get_snapshot → pgi.generate_questions → guided.enter/guided.exit → candidate.create_chapter` | `current` | session tools + candidate service | 首选链路；候选区落盘 |
| 驾驶舱快照 | `GET /api/books/:id/cockpit/snapshot`、`cockpit.get_snapshot` | `current` | cockpit service | 工具卡片/画布组件 |
| 开放伏笔 | `GET /api/books/:id/cockpit/open-hooks`、`cockpit.list_open_hooks` | `current` | story file + service | 空状态可显示 empty |
| 最近候选 | `GET /api/books/:id/cockpit/recent-candidates`、`cockpit.list_recent_candidates` | `current` | generated-candidates | 候选 artifact 列表 |
| 异步写下一章 | `POST /api/books/:id/write-next` | `current` / async | pipeline/events | 显示 started，不期待同步正文 |
| AI draft 动作 | `POST /api/books/:id/draft` | `current` / async | pipeline/events | 不作为草稿 CRUD |
| 审校/修订/重写/检测 | `/api/books/:id/audit|revise|rewrite|detect*` | `current` / mixed | AI pipeline + files | 成功/失败真实呈现 |
| 行内补全 SSE | `POST /api/ai/complete` | `chunked-buffer` | 完整 AI 结果再分块 | 可流式显示但标注边界 |
| Writing modes 生成 | `/api/books/:bookId/inline-write` 等 | `current` / `prompt-preview` fallback | LLM 或 prompt preview | 通过 apply 安全写入 |
| Writing modes apply | `POST /api/books/:bookId/writing-modes/apply` | `current` | candidate/draft 写入 | 正式章节写入首版转候选 |
| Hooks | `POST /api/books/:bookId/hooks/generate|apply` | `current` | LLM + `pending_hooks.md` | 模型缺失返回 gate 409 |
| 节奏/对话/语气/健康 | writing tools routes | `current` | 本地分析 + SQLite | `null` 指标或 unknown metric 如实显示为未知 |

### 5. Provider、模型与运行能力

| 用户能力 | 入口 | 状态 | 数据来源 | 前端规则 |
|---|---|---|---|---|
| Provider 列表 | `GET /api/providers` | `current` | runtime provider store | 脱敏显示 |
| 新增/更新/删除 | `POST/PUT/PATCH/DELETE /api/providers*` | `current` | runtime provider store | API Key 不回显 |
| 启停/排序 | `POST /api/providers/:id/toggle`、`/reorder` | `current` | runtime provider store | 影响模型池刷新 |
| 刷新模型 | `POST /api/providers/:id/models/refresh` | `current` | adapter | unsupported/auth/upstream 真实 envelope |
| 单模型 patch/test | `PATCH/POST /api/providers/:id/models/:modelId*` | `current` | adapter + store | 成功写测试状态，失败显示 code |
| Provider test | `POST /api/providers/:id/test` | `current` | first enabled model | 无模型返回 400 |
| 平台集成 | `/api/platform-integrations` | `current` / transparent | platform account store | Cline 等未接能力不得假可用 |

## Contract client 边界

建议新增或重构前端合同层：

```
packages/studio/src/app-next/backend-contract/
├── capability-status.ts       # 状态枚举与 UI 决策
├── contract-client.ts         # typed fetch facade
├── session-client.ts          # REST + WS envelope helpers
├── resource-client.ts         # books/chapters/candidates/drafts/files
├── provider-client.ts         # provider/model/status
├── writing-action-client.ts   # writing modes/session tools/AI action wrappers
├── fetch-json-contract-client.ts       # 前端 fetchJson 到 ContractClient 的桥接
└── backend-contract-verification.ts    # task 9 验证命令清单与 app-next API guard
```

规则：

- 组件不直接散写 `/api/...` 字符串。
- contract client 返回 `{ status, data, error, capability }` 风格的规范化结果，但不能吞掉原始错误。
- 对 `prompt-preview`、`unsupported`、`null` 指标、`unknown` metric、`process-memory` 保留原语义字段。
- 共享类型优先来自 `shared/contracts.ts`、`shared/session-types.ts`、`shared/agent-native-workspace.ts`。

## 验证策略

1. 合同矩阵自查：每行能力都能反查 route/tool/shared 类型。
2. Route 契约测试：覆盖核心成功和失败 envelope。
3. Contract client 测试：验证 unsupported/prompt-preview/process-memory 映射不丢失。
4. 前端替换测试：新 UI 只通过 contract client 获取数据。
5. 验证收口：`backend-contract-verification.ts` 记录 Backend Contract 聚焦测试、Studio typecheck、docs verify、`git diff --check` 与 app-next API guard；未运行项必须保持 `unverified`。
6. 文档核对：`docs/06-API与数据契约/02-创作工作台接口.md` 与本矩阵一致。

## 不做的事

- 不新增 fake provider、fake route 或 dummy 数据。
- 不把 legacy route 从代码中删除；删除属于后续 backend-core-refactor 阶段。
- 不强制所有 API 立即改成统一 envelope；首版先做前端适配层和合同测试。
