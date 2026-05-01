# Studio工作台架构

**版本**: v2.0.0
**创建日期**: 2026-04-28
**更新日期**: 2026-05-01
**状态**: ✅ 当前有效
**文档类型**: current

---

## 当前架构定位

Studio 是 NovelFork 的本地 Web 工作台，前端负责小说创作交互，后端 Hono API 负责书籍、章节、候选稿、写作工具、Agent、供应商和运行态数据。

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
┌──────────┬──────────────────┬─────────────┐
│ 资源树    │    编辑器         │ 右侧面板     │
│          │                  │ [驾驶舱]默认 │
│ 书籍      │  TipTap 富文本   │  总览/伏笔   │
│ ├章节     │  章节正文        │  设定/AI    │
│ ├候选稿   │                  │ [经纬]      │
│ ├草稿     │                  │  人物/事件   │
│ ├大纲     │                  │  设定/摘要   │
│ ├经纬     │                  │ [写作]      │
│ ├故事文件 │                  │  AI 动作    │
│ ├真相文件 │                  │  写作模式    │
│ └素材     │                  │  写作工具    │
└──────────┴──────────────────┴─────────────┘
```

### 状态管理

- 全局状态：`appStore`（pub/sub，activeBookId + activeChapterNumber）
- 组件状态：React `useState` + `useApi` hook
- 窗口状态：`windowStore`（ChatWindow 多窗口管理）
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
| 会话 | `/api/sessions` | Agent 会话 CRUD |
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
用户操作 → React UI → fetchJson/postApi → Hono API
  → Core Pipeline/Agent → LLM → 返回结果
  → 写入 SQLite / 文件系统
  → WebSocket 广播 → ChatWindow 实时更新
```

### AI 输出流转

```
AI 生成 → 候选区 (generated-candidates/)
  → 用户确认 → 合并/替换/另存草稿
  → 绝不直接覆盖正式章节
```
