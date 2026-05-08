# NarraFork API 参考（从 api.js bundle 提取）

## 叙述者 (Narrator) API

### 核心操作
- `POST /narrators` - 创建叙述者
- `POST /narrators/:id/messages` - 发送消息（支持 images + textFiles 附件，priority 参数）
- `POST /narrators/:id/interrupt` - 中断
- `POST /narrators/:id/continue` - 继续
- `POST /narrators/:id/retry` - 重试最后消息
- `POST /narrators/:id/compact` - 触发压缩（可选 beforeMessageId）
- `POST /narrators/:id/clear-context` - 清除上下文

### 消息管理
- `GET /narrators/:id/messages` - 获取消息（支持 cursor/limit/direction/around 分页）
- `GET /narrators/:id/tool-calls/:toolCallId` - 工具调用详情
- `DELETE /narrators/:id/messages/:messageId` - 删除消息
- `DELETE /narrators/:id/messages/:messageId/blocks/:blockIndex` - 删除消息块
- `POST /narrators/:id/rollback/:messageId` - 回滚到指定消息
- `POST /narrators/:id/edit-and-regenerate/:messageId` - 编辑并重新生成

### 配置
- `PATCH /narrators/:id/model` - 更新模型
- `PATCH /narrators/:id/permission-mode` - 更新权限模式
- `PATCH /narrators/:id/reasoning-effort` - 更新推理强度
- `PATCH /narrators/:id/fast-mode` - 快速模式
- `PATCH /narrators/:id/relaxed-plan` - 宽松规划
- `PATCH /narrators/:id/prune-enabled` - 修剪启用
- `PATCH /narrators/:id/title` - 更新标题
- `PATCH /narrators/:id/cwd` - 更新工作目录
- `POST /narrators/:id/generate-title` - AI 生成标题

### 计划模式
- `POST /narrators/:id/plan-mode/enter` - 进入计划模式
- `POST /narrators/:id/plan-mode/exit` - 退出计划模式
- `POST /narrators/:id/plan` - 创建计划

### 权限
- `GET /narrators/:id/permissions` - 获取待处理权限
- `POST /narrators/permissions/:id/approve` - 批准
- `POST /narrators/permissions/:id/deny` - 拒绝
- `POST /narrators/permissions/:id/stop-reflection` - 停止危险反思
- `POST /narrators/permissions/:id/stop-plan-reflection` - 停止计划反思

### 目录/命令白名单黑名单
- `GET/POST /narrators/:id/whitelist-dirs`
- `GET/POST /narrators/:id/blacklist-dirs`
- `GET/POST /narrators/:id/cmd-whitelist`
- `GET/POST /narrators/:id/cmd-blacklist`

### Fork
- `POST /narrators/:id/fork` - Fork 叙述者（forkMessageUuid, title, inheritMode）
- `POST /narrators/:id/fork-messages` - 从消息 Fork

### 浏览器会话
- `GET /narrators/:id/browser-sessions` - 列出浏览器会话
- `DELETE /narrators/:id/browser-sessions/:sessionId` - 关闭
- `POST /narrators/:id/browser-sessions/:sessionId/stop-tracing` - 停止追踪

### 文件修改
- `GET /narrators/:id/file-modifications` - 文件修改列表
- `GET /narrators/:id/patches/:filePath/diff` - 文件 diff
- `POST /narrators/:id/revert-file` - 回退文件
- `POST /narrators/:id/revert` - 回退所有
- `POST /narrators/:id/unrevert` - 取消回退

### 其他
- `GET /narrators/:id/goals` - 目标管理
- `GET /narrators/:id/buffer` - 缓冲消息
- `GET /narrators/:id/usage-stats` - 用量统计
- `GET /narrators/:id/commands` - 可用命令
- `POST /narrators/:id/suggest-answers` - AI 建议回答
- `POST /narrators/:id/ask-in-passing/start` - 顺便问
- `PATCH /narrators/:id/archive` / `unarchive` - 归档/取消归档
- `POST /narrators/:id/detach` - 分离子代理
- `POST /narrators/:id/promote` - 提升叙述者
- `POST /narrators/:id/leave` - 离开

## MCP API
- `GET /mcp/servers` - 列出服务器
- `POST /mcp/servers` - 创建
- `PATCH /mcp/servers/:id` - 更新
- `DELETE /mcp/servers/:id` - 删除
- `POST /mcp/servers/:id/connect` - 连接
- `POST /mcp/servers/:id/disconnect` - 断开
- `POST /mcp/servers/test` - 测试连接
- `GET /mcp/tools` - 列出所有工具
- `POST /mcp/servers/import` - 导入

## 设置 API
- `GET /settings` - 获取设置
- `PATCH /settings` - 更新设置
- `POST /settings/test-model` - 测试模型
- `GET /settings/context-thresholds` - 上下文阈值

## 项目 API
- `GET/POST /projects` - 列表/创建
- `GET /projects/:id/graph` - 项目图
- `GET /projects/:id/ruler` - 标尺数据

## 章节 API
- 完整 CRUD + fork/merge/split/cherry-pick/sync-upstream
- Git 操作：status/stage/unstage/commit/discard/diff/stash/log/reset
- 容器管理：start/stop/pause/unpause/logs/remove
- 探索组：创建/决定/放弃

## Provider API
- Kiro: status/credentials/models/mcp-search/global-proxy
- Codex: quota/auth/credentials/models/reasoning-effort/websocket
- Cline: auth/models/balance/recommended-models/pool
- OpenAI: models/refresh
- Anthropic: refresh
- NKP: refresh/quota
- NUG: login/quota/channels/usage/oauth
