# @vivy1024/novelfork-studio

Web 工作台 — React 19 + Hono + Vite + SQLite。NovelFork 的主用户界面。

---

## 目录结构

```
src/
├── api/                # Hono 后端
│   ├── routes/         # REST API 路由
│   │   ├── storage.ts       # 书籍/章节 CRUD
│   │   ├── writing-modes.ts # 写作模式
│   │   ├── writing-tools.ts # 写作工具
│   │   ├── bible.ts         # 故事经纬
│   │   ├── jingwei.ts       # 经纬结构化
│   │   ├── chapter-candidates.ts # 候选稿
│   │   ├── providers.ts     # AI 供应商
│   │   ├── compliance.ts    # 合规/发布检查
│   │   └── ...
│   ├── lib/            # 业务逻辑
│   │   ├── session-chat-service.ts # Agent 会话
│   │   ├── agent-context.ts       # 上下文注入
│   │   ├── tool-catalog.ts        # 统一工具目录
│   │   └── ...
│   ├── index.ts        # 服务入口
│   └── server.ts       # 服务启动
│
├── app-next/           # 新前端 (React 19 + Tailwind + shadcn/ui)
│   ├── workspace/      # 创作工作台
│   │   ├── WorkspacePage.tsx   # 主页面
│   │   ├── resource-adapter.ts # 资源树
│   │   ├── WorkspaceCanvas.tsx # 中间多资源画布
│   │   ├── NarratorPanel.tsx   # 右侧固定叙述者会话
│   │   ├── BiblePanel.tsx      # 经纬画布/工具复用面板
│   │   ├── PublishPanel.tsx    # 发布画布面板
│   │   ├── cockpit/            # cockpit 工具结果与画布组件
│   │   │   ├── cockpit-types.ts
│   │   │   └── cockpit-risk.ts
│   │   └── ...
│   ├── settings/       # 设置页
│   ├── routines/       # 套路页 (工具/命令/技能/子代理)
│   ├── dashboard/      # 仪表盘
│   ├── workflow/       # 工作流
│   ├── sessions/           # 叙述者会话 UI 与工具链展示
│   ├── components/         # app-next 组件
│   ├── lib/            # 前端工具
│   │   └── display-labels.ts  # 中文标签
│   └── entry.ts        # 路由入口
│
├── components/         # 共享组件
│   ├── writing-modes/  # 写作模式 UI
│   ├── writing-tools/  # 写作工具 UI
│   ├── ChatWindow.tsx  # Agent 聊天窗口
│   ├── ChatPanel.tsx   # 轻量聊天面板
│   ├── Routines/       # 套路管理组件
│   ├── Model/          # 模型选择
│   ├── compliance/     # 合规组件
│   └── onboarding/     # 新手引导
│
├── hooks/              # React hooks
│   └── use-api.ts      # API 调用 hook
├── stores/             # 全局状态
│   └── app-store.ts    # 应用状态 store
├── shared/             # 共享类型
│   ├── contracts.ts    # API 契约
│   └── session-types.ts # 会话类型
├── types/              # 类型定义
│   └── routines.ts     # 套路类型
├── main.tsx            # React 入口
└── index.ts            # 前端入口
```

---

## 启动

```bash
# 开发 (Vite + Hono)
bun run dev            # http://localhost:4567

# 生产构建
bun run build

# 编译单文件
pnpm --dir packages/studio compile  # → dist/novelfork.exe + dist/novelfork-vX.Y.Z-windows-x64.exe (~117MB)

# 测试
pnpm --dir packages/studio exec vitest run  # 156 files / 898 tests

# 类型检查
bun run typecheck
```

---

## 关键技术

| 层 | 技术 |
|----|------|
| 运行时 | Bun |
| 前端 | React 19 + Vite + TailwindCSS + shadcn/ui |
| 编辑器 | TipTap (富文本 Markdown) |
| 后端 | Hono (REST + WebSocket) |
| 存储 | SQLite (bun:sqlite) + 文件系统 |
| PWA | vite-plugin-pwa (autoUpdate, standalone) |

---

## 页面

| 路由 | 说明 |
|------|------|
| `/next/workspace` | 创作工作台（默认） |
| `/next/dashboard` | 仪表盘 |
| `/next/settings` | 设置 |
| `/next/routines` | 套路 |

---

## API 端点概览

| 分组 | 路径 |
|------|------|
| 书籍 | `/api/books`, `/api/books/:id` |
| 章节 | `/api/books/:id/chapters`, `/api/books/:id/chapters/:num` |
| 候选稿 | `/api/books/:id/candidates` |
| 草稿 | `/api/books/:id/drafts` |
| 写作模式 | `/api/books/:id/inline-write` 等 |
| 写作工具 | `/api/books/:id/hooks`, `/api/progress` 等 |
| 经纬 | `/api/books/:id/bible/*`, `/api/books/:id/jingwei/*` |
| 供应商 | `/api/providers` |
| 会话 / session tools | `/api/sessions`, `/api/sessions/:id/chat` |
| 导出 | `/api/books/:id/export` |
| Truth/Story | `/api/books/:id/truth-files`, `/api/books/:id/story-files` |
| Narrative Line | `/api/books/:id/narrative-line`, `/api/books/:id/narrative-line/propose`, `/api/books/:id/narrative-line/apply` |
