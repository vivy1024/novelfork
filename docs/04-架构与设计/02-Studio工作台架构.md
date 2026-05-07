# Studio工作台架构

**版本**: v2.0.0
**创建日期**: 2026-04-28
**更新日期**: 2026-05-06
**状态**: ✅ 当前有效
**文档类型**: current

---

## 当前架构定位

Studio 是 NovelFork 的本地 Web 工作台，当前 `/next` 采用 Agent Shell + live route 架构：左侧 Shell 负责叙事线、叙述者与全局入口导航；`/next/narrators/:sessionId` 承载 live Conversation runtime；`/next/books/:bookId` 承载独立 Writing Workbench；Search、Routines、Settings 已挂载真实页面或真实错误/unsupported 状态。后端 Hono API 负责书籍、章节、候选稿、session tools、供应商和运行态数据。

---

## 主要分层

```text
React 19 UI (app-next/)
  ↕ REST + WebSocket
Hono API (src/api/)
  ↕ import + API calls
Core 写作引擎 (packages/core)
  ↕
SQLite (bun:sqlite) + 本地文件系统
```

---

## 前端架构

### 页面路由

| 路由 | 组件 | 说明 |
|------|------|------|
| `/next` | `StudioNextApp` + `AgentShell` + `HomeRouteLive` | 当前入口；Shell 侧栏加载真实 books/sessions/provider 状态，主区域默认显示作者首页，最近作品/会话/模型健康/主要动作来自 `useShellData`，其他 route 挂载 live 页面 |
| `/next/narrators/:sessionId` | `ConversationRouteLive` → `ConversationRoute` | 叙述者会话；接入 `useAgentConversationRuntime`、WebSocket `resumeFromSeq`、ack/message/abort、模型/权限/推理配置、工具结果 renderer 与确认门刷新 |
| `/next/books/:bookId` | `WritingWorkbenchRouteLive` → `WritingWorkbenchRoute` | 写作工作台；通过 resource contract 加载资源树，支持打开/保存/只读/unsupported、dirty canvasContext 与写作动作会话跳转 |
| `/next/settings` | `SettingsLayout` + `SettingsSectionContent` / `ProviderSettingsPage` | 设置页；模型、provider、runtime 配置入口可达 |
| `/next/routines` | `RoutinesNextPage` | 套路页；工具、命令、权限、技能、子代理与 MCP 管理 |
| `/next/search` | `SearchPage` | 全局搜索；使用搜索 API 或展示真实错误/空状态 |

### Agent Shell 与 Workbench 布局

```text
┌──────────────┬──────────────────────────────────────────────┐
│ Agent Shell  │ RouteMountPoint                              │
│ ├首页         │ /next              → HomeRouteLive            │
│ ├叙事线       │ /next/narrators/:id → ConversationRouteLive   │
│ ├叙述者       │ /next/books/:id     → WritingWorkbenchRoute   │
│ ├搜索         │ /next/search        → SearchPage              │
│ ├套路         │ /next/routines      → RoutinesNextPage        │
│ └设置         │ /next/settings      → Settings/Provider pages │
└──────────────┴──────────────────────────────────────────────┘
```

Writing Workbench 内部仍是“资源树 + 画布 + 写作动作”的工作区：资源节点来自 Backend Contract adapter，canvas 负责章节/候选稿/草稿/经纬/Story/Truth/Narrative Line 打开与保存状态，写作动作负责创建或复用绑定书籍的 writer session 并跳转到 Conversation route。

### 状态管理

- 全局状态：`appStore`（pub/sub，activeBookId + activeChapterNumber）
- 组件状态：React `useState` + `useApi` hook
- 会话状态：`/api/sessions` + `/api/sessions/:id/chat`（右侧叙述者消息、工具调用、确认门、恢复游标）
- legacy 窗口状态：`windowStore`（Task 8 删除前仅作为历史持久化层保留；当前 `/next/narrators/:sessionId` 不再依赖旧多窗口视觉层）
- 运行时状态：`windowRuntimeStore`（Task 8 删除前仅保留旧恢复状态兼容；当前会话恢复来自 session runtime）

---

## 后端架构

### API 路由分组

| 路由组 | 路径前缀 | 职责 |
|--------|---------|------|
| 书籍 | `/api/books` | 书籍 CRUD + 章节管理 + 导入导出 |
| 候选稿 | `/api/books/:id/candidates` | 候选稿查看/接受/拒绝/删除 |
| 草稿 | `/api/books/:id/drafts` | 草稿 CRUD |
| 写作模式 | `/api/books/:id/inline-write` 等 | 续写/扩写/对话/变体/分支 |
| 写作工具 | `/api/books/:id/hooks` 等 | 钩子/节奏/对话/POV/进度 |
| 经纬 | `/api/books/:id/bible/*` `/api/books/:id/jingwei/*` | 结构化资料库 |
| 供应商 | `/api/providers` | AI 供应商管理 |
| 会话 | `/api/sessions` | Agent 会话 CRUD、lifecycle continue/fork/restore、WebSocket 消息、session tools、确认门、unsupported-tools 降级 |
| 套路 | `/api/routines` | 工具/命令/技能/子代理配置 |
| 合规 | `/api/books/:id/compliance/*` | 敏感词/发布检查 |
| Truth/Story | `/api/books/:id/truth-files` `/story-files` | 真相文件读写 + 删除 |

### WebSocket

| 路径 | 用途 |
|------|------|
| `/api/sessions/:id/chat` | Agent 会话实时通信（seq 驱动 + 恢复） |
| `/api/admin/resources/ws` | 管理面板资源监控 |

---

## 数据流

```
用户操作 → 左资源栏 / 中间画布 / 右侧叙述者会话
  → REST / WebSocket → Hono API
  → session tools / Core Pipeline / LLM runtime
  → 工具结果卡片 / 画布 artifact / SQLite / 文件系统
  → WebSocket 广播 → `/next/narrators/:sessionId` ConversationSurface 实时更新
```

### AI 输出流转

```
右侧叙述者请求 → cockpit / PGI / guided / candidate 工具链
  → 工具结果卡片和 artifact 打开到中间画布
  → AI 生成进入候选区 (generated-candidates/)
  → 用户确认 → 合并/替换/另存草稿
  → 绝不直接覆盖正式章节
```
