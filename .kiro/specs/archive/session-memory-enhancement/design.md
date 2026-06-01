# Session Memory 增强 — 设计

## 架构

```
Context Ring (前端)
    │ 点击
    ▼
ContextMenu (压缩/清空/信息)
    │
    ├─► "压缩" → POST /api/sessions/:id/compact
    │              body: { strategy: "auto", targetPercent }
    │
    ├─► "清空" → POST /api/sessions/:id/compact
    │              body: { strategy: "reset" }
    │
    └─► "信息" → 显示 token 详情
```

## 数据模型变更

### session record 新增字段

```typescript
interface NarratorSessionRecord {
  // ... 现有字段
  parentSessionId?: string;           // fork 来源
  forkMode?: "full" | "compressed";   // fork 时的继承模式
}
```

### SQLite migration

```sql
ALTER TABLE sessions ADD COLUMN parent_session_id TEXT;
ALTER TABLE sessions ADD COLUMN fork_mode TEXT;
```

## Context Ring 菜单设计

```
┌─────────────────────────┐
│ 上下文使用：45% (90k/200k) │
├─────────────────────────┤
│ ◉ 压缩到 70%            │  ← contextTruncateTargetPercent
│ ◉ 清空上下文            │  ← 只保留 system prompt
├─────────────────────────┤
│ 自动压缩阈值：80%       │  ← 只读展示
│ 大窗口阈值：60%         │  ← 只读展示
└─────────────────────────┘
```

## 修改文件清单

| 文件 | 改动 |
|------|------|
| `packages/studio/src/shared/session-types.ts` | 新增 parentSessionId, forkMode 字段 |
| `packages/studio/src/api/lib/session-service.ts` | fork 时写入 parentSessionId |
| `packages/studio/src/api/routes/session.ts` | fork 路由写入新字段 |
| `packages/core/src/storage/schema.ts` | migration 添加列 |
| `packages/studio/src/app-next/agent-conversation/surface/NarratorStatusBar.tsx` | Context Ring 点击菜单 |
| `packages/studio/src/app-next/agent-conversation/surface/ConversationSurface.tsx` | Info Sheet 展示 fork 来源 |

## 风险

| 风险 | 缓解 |
|------|------|
| 压缩 API 耗时长 | 前端显示 loading 状态，禁用重复点击 |
| 清空后用户后悔 | 清空前确认弹窗 |
| 旧会话无 parentSessionId | 字段可选，null 表示非 fork |
