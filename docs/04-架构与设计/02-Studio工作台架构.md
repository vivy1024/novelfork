# Studio工作台架构

**版本**: v2.0.0
**创建日期**: 2026-04-28
**更新日期**: 2026-05-03
**状态**: ✅ 当前有效
**文档类型**: current

---

## 当前架构定位

Studio 是 NovelFork 的本地 Web 工作台，前端采用 session-first 的 Agent-native 工作区：右侧固定叙述者会话是主操作入口，中间画布承载章节 / 候选稿 / 经纬 / 工具产物，左侧资源栏负责导航；后端 Hono API 负责书籍、章节、候选稿、session tools、供应商和运行态数据。

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
| `/next/workspace` | `WorkspacePage` | 创作工作台（默认页面） |
| `/next/dashboard` | `DashboardPage` | 书籍列表 + 创建入口 |
| `/next/settings` | `SettingsSectionContent` | 设置页（左侧导航 + 右侧详情） |
| `/next/routines` | `RoutinesNextPage` | 套路页（工具/命令/技能/子代理） |
| `/next/workflow` | `WorkflowPage` | Agent 状态 + 管线运行 |
| `/next/search` | `SearchPage` | 全局搜索 |

### 创作工作台布局

```text
┌──────────────┬────────────────────────────┬──────────────────┐
│ 左侧资源栏     │ 中间 WorkspaceCanvas        │ 右侧 NarratorPanel │
│ 全局导航       │ 多资源 Tab                  │ 固定叙述者会话       │
│ ├仪表盘       │ 章节编辑器 / 候选稿 / 草稿      │ 模型 / 权限 / 推理    │
│ ├工作台       │ 经纬详情 / Story / Truth      │ 工具调用流           │
│ ├工作流       │ cockpit / PGI / guided 产物   │ 确认门 / 恢复状态     │
│ └设置/套路     │ Narrative Line / 发布报告      │ 输入框               │
└──────────────┴────────────────────────────┴──────────────────┘
```

### 状态管理

- 全局状态：`appStore`（pub/sub，activeBookId + activeChapterNumber）
- 组件状态：React `useState` + `useApi` hook
- 会话状态：`/api/sessions` + `/api/sessions/:id/chat`（右侧叙述者消息、工具调用、确认门、恢复游标）
- 窗口状态：`windowStore`（独立 ChatWindow 多窗口管理；右侧 docked 会话不依赖旧右侧 Tab）
- 运行时状态：`windowRuntimeStore`（WebSocket 连接状态）

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
| 会话 | `/api/sessions` | Agent 会话 CRUD、WebSocket 消息、session tools、确认门、unsupported-tools 降级 |
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
  → WebSocket 广播 → NarratorPanel / ChatWindow 实时更新
```

### AI 输出流转

```
右侧叙述者请求 → cockpit / PGI / guided / candidate 工具链
  → 工具结果卡片和 artifact 打开到中间画布
  → AI 生成进入候选区 (generated-candidates/)
  → 用户确认 → 合并/替换/另存草稿
  → 绝不直接覆盖正式章节
```
