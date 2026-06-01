# 会话详情面板修复 — Requirements

## 问题

SessionDetailPanel 大量硬编码假数据，可编辑字段未接通后端。底部状态栏的路径规则按钮也未接通。

## 需要修复的硬编码

| 字段 | 当前状态 | 应该 |
|------|---------|------|
| 快速模式 | 硬编码"关闭" | 从 session.sessionConfig 读取 |
| 宽松规划 | 硬编码"开启" | 从 session.sessionConfig 读取 |
| 自动批准计划 | TriStateControl 无 onChange | 接通 PUT /api/sessions/:id |
| 危险反思 | TriStateControl 无 onChange | 接通 PUT /api/sessions/:id |
| 自动裁剪 | 硬编码"开启" | 从 session.sessionConfig 读取 |
| 计划模式 | 硬编码"关闭" | 从 session.sessionConfig.mode 读取 |
| 启用工具 | 硬编码"无" | 从 session.sessionConfig.toolPolicy 读取 |
| Subagent 模型限制 | Input disabled | 接通模型选择 |
| 工具限制 | Input disabled | 接通 toolPolicy.deny（复用 ToolConfigBar 机制） |
| 访问规则 | 展示空数据 | 从 /api/settings 的 directoryAllowlist/denylist 读取 |

## 底部状态栏路径规则

NarratorStatusBar 右下角的 FolderPlus 按钮（目录白名单）需要：
- 显示当前已添加的白名单目录
- 支持添加/删除目录
- 与 SessionDetailPanel 的访问规则联动

## 文件

- `packages/studio/src/app-next/agent-conversation/surface/SessionDetailPanel.tsx`
- `packages/studio/src/app-next/agent-conversation/surface/NarratorStatusBar.tsx`
- `packages/studio/src/app-next/StudioNextApp.tsx`（buildSessionDetail 函数）
