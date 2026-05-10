# Implementation Plan

## Overview

实现 session fork 追溯字段（parentSessionId + forkMode）和 Context Ring 点击菜单（压缩/清空上下文），确保会话级 memory 管理功能完整可用。

## Tasks

- [x] 1. **session-types 新增字段** — 在 `packages/studio/src/shared/session-types.ts` 的 `NarratorSessionRecord` 接口中添加 `parentSessionId?: string` 和 `forkMode?: "full" | "compressed"` 字段
- [x] 2. **SQLite migration** — 在 `packages/core/src/storage/schema.ts` 的 sessions 表定义中添加 `parent_session_id` 和 `fork_mode` 列；在 migration runner 中添加 ALTER TABLE 语句（向后兼容，列可为 null）
- [x] 3. **session-service fork 写入** — 修改 `packages/studio/src/api/lib/session-service.ts` 中的 fork 逻辑，创建新会话时写入 `parentSessionId`（源会话 ID）和 `forkMode`（从 fork 请求参数获取）
- [x] 4. **session 路由 fork 端点** — 修改 `packages/studio/src/api/routes/session.ts` 中的 fork 路由，将 `parentSessionId` 和 `forkMode` 传递给 session-service
- [x] 5. **Context Ring 点击菜单** — 修改 `packages/studio/src/app-next/agent-conversation/surface/NarratorStatusBar.tsx`，将 Context Ring 从纯展示改为可点击的 DropdownMenu，菜单项包含：当前使用量信息、"压缩到 N%"按钮、"清空上下文"按钮（带确认）、只读展示自动压缩阈值
- [x] 6. **压缩/清空 API 调用** — Context Ring 菜单的"压缩"调用 `compactSession` slash command 或直接 POST `/api/sessions/:id/compact`；"清空"调用同一 API 但 strategy 为 "reset"。操作期间显示 loading 状态，完成后刷新 contextUsage 数据
- [x] 7. **Info Sheet 展示 fork 来源** — 修改 `packages/studio/src/app-next/agent-conversation/surface/ConversationSurface.tsx` 中的 Info Sheet，当 session 有 `parentSessionId` 时显示"分叉自：{源会话标题}"
- [x] 8. **typecheck + 验证** — 运行 `bun run typecheck`，确认无错误；启动服务器验证 Context Ring 菜单可见、fork 后 parentSessionId 正确写入
