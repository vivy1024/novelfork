# @vivy1024/novelfork-studio

Web 工作台 — React 19 + Hono + Vite + SQLite。NovelFork 的主用户界面。

---

## 目录结构

```
src/
├── api/                # Hono 后端
│   ├── routes/         # REST API 路由
│   │   ├── storage.ts       # 书籍/章节资源 HTTP adapter（复杂业务已迁入领域 service）
│   │   ├── writing-modes.ts # 写作模式
│   │   ├── writing-tools.ts # 写作工具
│   │   ├── bible.ts         # 故事经纬
│   │   ├── jingwei.ts       # 经纬结构化
│   │   ├── chapter-candidates.ts # 候选稿
│   │   ├── providers.ts     # AI 供应商
│   │   ├── compliance.ts    # 合规/发布检查
│   │   └── ...
│   ├── errors.ts       # 统一 API 错误与状态 helper
│   ├── lib/            # 业务逻辑
│   │   ├── books-service.ts        # 书籍只读 service
│   │   ├── story-file-service.ts   # story/truth 只读 service
│   │   ├── storage-write-service.ts # storage 非破坏写入 service
│   │   ├── storage-destructive-service.ts # storage 硬删除 service
│   │   ├── candidate-destructive-service.ts # 候选/草稿硬删除 service
│   │   ├── resource-checkpoint-service.ts # 正式资源写入前 checkpoint
│   │   ├── resource-rewind-service.ts # checkpoint rewind preview/apply
│   │   ├── provider-runtime-store.ts # Provider/runtime store 与脱敏视图
│   │   ├── runtime-model-pool.ts # 真实运行时模型池与 provider 状态
│   │   ├── session-chat-service.ts # Agent 会话 orchestrator
│   │   ├── session-compact-service.ts # 会话上下文压缩与 budget
│   │   ├── session-memory-boundary-service.ts # 会话 memory 分类、审计与只读 fallback
│   │   ├── session-runtime/       # session WebSocket envelope、payload parse、cursor/recovery helper
│   │   ├── agent-context.ts       # 上下文注入
│   │   ├── tool-catalog.ts        # 统一工具目录
│   │   └── ...
│   ├── index.ts        # 服务入口
│   └── server.ts       # 服务启动
│
├── app-next/           # 新前端 (React 19 + Tailwind + shadcn/ui)
│   ├── backend-contract/ # 当前合同适配层：能力状态、typed client、session/resource/provider/writing action client、资源树/写作动作 adapter、session WS helper
│   ├── shell/            # 目标 Agent Shell：一级导航、路由壳、全局状态
│   ├── agent-conversation/ # 目标单栏叙述者对话：runtime + surface + composer/status/tool cards
│   ├── writing-workbench/  # 目标独立写作工作区：资源树、canvas、resource viewers、写作动作
│   ├── tool-results/       # 目标工具结果 renderer registry
│   ├── search/         # 全局搜索页
│   ├── settings/       # 设置页（SettingsTruthModel + provider/runtime panels）
│   ├── routines/       # 套路页 (工具/命令/技能/子代理)
│   ├── sessions/       # 叙述者会话 UI 与工具链展示
│   ├── components/     # app-next 组件
│   ├── lib/            # 前端工具
│   │   └── display-labels.ts  # 中文标签
│   └── entry.ts        # 路由入口
│
├── components/         # 共享组件
│   ├── writing-modes/  # 写作模式 UI
│   ├── writing-tools/  # 写作工具 UI
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
pnpm --dir packages/studio exec vitest run  # 最新回归约 210 files / 1276 tests

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

## app-next 合同访问规则

- 新前端访问后端必须优先使用 `src/app-next/backend-contract/`：`createContractClient`、domain clients、`resource-tree-adapter`、`writing-action-adapter` 与 session WebSocket helper。
- 组件内不得散写未登记 API 字符串；新增能力必须先补 Backend Contract 矩阵、共享类型和 contract 测试，再接 UI。
- contract 返回 `prompt-preview`、`process-memory`、`chunked-buffer`、`unsupported`、gate 或 `unknown/null` 指标时，UI 必须透明展示原始语义，不得 mock/fake/noop 假成功。
- 设置页必须经 `src/app-next/settings/SettingsTruthModel.ts` 派生可见字段的来源、状态、读写 API、可写性与未配置原因；普通模型页不得展示无 schema 来源的 `Codex 推理强度` 或用模型池第一项冒充当前默认模型；Agent runtime 设置必须登记权限、max turns、retry/backoff、WebFetch proxy、上下文阈值、调试、allow/deny 与 planned 缺口；运行控制保存后必须重新读取 `/api/settings/user` 作为最终事实。
- UI 可用性不得只凭单元测试宣称：`pnpm exec -- playwright test e2e/workbench-resource-edit.spec.ts` 覆盖章节打开→修改→保存→刷新读回；`pnpm exec -- playwright test e2e/settings-session-conversation.spec.ts` 覆盖设置页 truthfulness、工作台动作创建 session、Shell 同步、narrator route header/config 回读、空会话五区布局、model-unavailable 设置入口、工具卡 raw 脱敏/全屏、pending confirmation 拒绝回读和 idle/running 中断控制；`SessionCenter`/`AgentShell` 聚焦回归覆盖 `/next/sessions` 会话中心、Shell 左栏精选与新建叙述者表单；`routing`/`StudioNextApp`/`useShellData` 回归覆盖 `/next` 作者首页、最近作品/会话、模型健康和空态；v0.1.0 Release Readiness Task 9 已用 RED 锁定作品工作台发布级解释层缺口，待 Task 10 转 GREEN。浏览器 E2E 通过真实 Bun API + Vite 前端，不调用真实模型，使用 provider/settings/session API 准备可重复夹具。

---

## 页面

| 路由 | 说明 |
|------|------|
| `/next` | 当前入口；Agent Shell 路由壳，主入口已切断旧三栏 WorkspacePage 默认依赖，失败三栏实验与旧 ChatWindow/轻量 `/api/chat` 源码已从 Studio typecheck 构建路径正式退役；v0.1.0 Release Readiness Task 7-8 已把主区从 `Agent Shell` 开发占位页升级为作者首页，复用 `useShellData` 展示最近作品、最近会话、模型健康、快速动作和空态 |
| `/next/narrators/:sessionId` | 已挂载单栏 Conversation 壳，接入合同快照、WebSocket `resumeFromSeq`、ack/message/abort runtime，并具备消息流/工具卡/确认门/状态栏/Composer、recovery notice、模型/权限/推理状态栏动作、session config 更新后回读 chat state、ShellDataProvider 同步、真实 binding/消息数/工作区/Git unavailable facts、工具卡复制/全屏/raw 脱敏、审批目标/风险/来源/操作和运行控制 disabled reason，与 Tool Result Renderer Registry；Task 13 Playwright 已验活 header/config 回读、工具卡 raw 脱敏和 idle/running 中断控制；v0.1.0 Release Readiness Task 2-4 已将 ConversationSurface 重排为 Session Header、Runtime Summary Cards、Recovery/Confirmation Lane、Message Stream、Composer Dock 五区布局并补作者向空态、model-unavailable 恢复说明和浏览器 E2E 检查点 |
| `/next/sessions` | 已接入发布级叙述者中心：复用 session domain client 展示搜索、类型/状态筛选、排序、归档/恢复、Fork、继续最近、工作目录、创建/最后消息时间、Memory 边界和新建叙述者表单；Agent Shell 左栏只展示前 5 条活跃叙述者、显示剩余数量并提供“查看全部叙述者”入口 |
| `/next/books/:bookId` | 已挂载独立 Writing Workbench 壳，Workbench 资源树已接入 resource contract adapter 映射，并支持 canvas/viewer、保存、只读禁用、tool-result viewer、dirty canvasContext 与写作动作入口 |
| `/next/settings` | 已挂载 SettingsLayout、SettingsSectionContent 与 ProviderSettingsPage；设置分组为个人设置、实例管理、运行资源与审计、关于与项目，模型页和 Agent runtime 面板通过 SettingsTruthModel 展示来源/状态/API，Claude/Codex parity facts 将 TUI/Chrome bridge/sandbox 等 non-goal/planned 显示为 unsupported/planned 而非已接入，provider 页区分平台账号可导入/未配置/不可调用和 API provider 可配置/已配置/已验证/可调用状态，provider/model/runtime 配置入口可达；Task 13 Playwright 已验活默认模型未配置不 fallback、Codex 无账号不可调用、first-token timeout planned 且无“Codex sandbox 已接入”假 current |
| `/next/routines` | 已挂载 RoutinesNextPage，复用 routines/MCP/tools/skills/subagents 管理能力 |
| `/next/search` | 已挂载 SearchPage，使用真实搜索 API 或展示真实错误/空状态 |

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
| 会话 / session tools | `/api/sessions`, `/api/sessions/:id/chat`, `/api/sessions/:id/tools`, `/api/sessions/headless-chat`, `/api/sessions/:id/memory/status`, `/api/sessions/:id/memory` |
| 导出 | `/api/books/:id/export`（legacy/deprecated，统一导出合同未收敛） |
| Truth/Story | `/api/books/:id/truth-files`, `/api/books/:id/story-files` |
| Narrative Line | `/api/books/:id/narrative-line`, `/api/books/:id/narrative-line/propose`, `/api/books/:id/narrative-line/apply` |
