# Studio API总览

**版本**: v1.0.0  
**创建日期**: 2026-04-20  
**更新日期**: 2026-04-20  
**状态**: 🔄 持续更新

---

## 说明

当前 API 入口位于：
- `packages/studio/src/api/server.ts`
- `packages/studio/src/api/routes/`

server 通过 `createStudioServer()` 挂载多个 Hono 路由组。

## 路由分组

| 分组 | 说明 |
|------|------|
| `/api/auth` | 登录、会话与认证 |
| `/api/runs` | 按运行任务的 SSE / 状态管理 |
| `/api/workbench` | 工作区文件操作 |
| `/api/books/...` | 书籍、章节、truth files 等存储接口 |
| `/api/daemon` | 守护进程与调度 |
| `/api/mcp` | MCP server 管理 |
| `/api/lorebook` | Lorebook / 世界观接口 |
| `/api/pipeline` | 管线可视化与运行态 |
| `/api/settings` | 设置管理 |
| `/api/providers` | AI 提供商管理 |
| `/api/agent/config` | Agent 配置 |
| `/api/tools` | 工具调用 |
| `/api/worktree` | Git worktree 管理 |
| `/api/rhythm` | 节奏分析 |
| `/api/golden-chapters` | 黄金三章分析 |
| `/api/chat` | 对话界面 |
| `/api/context` | 上下文管理 |
| `/api/admin` | 管理面板 |
| `/api/routines` | 套路系统 |
| `/api/sessions` | 会话管理 |
| `/api/search` | 搜索系统 |
| `/api/monitor` | 监控可视化 |

## 当前状态

- API 结构已成型
- 但完整逐端点请求/响应文档尚未整理
- 后续若平台从 monorepo 收敛为单入口 Bun 应用，本目录需要同步更新
