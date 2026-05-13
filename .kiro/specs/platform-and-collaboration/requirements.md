# NovelFork 通用平台能力 + 多用户协作 — 需求文档

## 背景

NovelFork 的定位是**通用 Coding Agent 平台**，小说写作是可插拔插件。当前核心 agent loop、工具系统、权限系统、记忆层级、多代理已完整。但对比 Claude Code/Codex CLI，仍缺少：Hooks 自动化系统、MCP 工具扩展协议、非交互 CLI 模式。

此外，NovelFork 是 Web 项目，天然支持多用户——暴露端口到公网即可协作开发。但当前缺少用户系统（认证/授权/会话隔离）。

---

## Phase 1：Hooks 系统（P1）

### 1.1 PreToolUse / PostToolUse 钩子

**现状**: 无通用钩子机制，只有 file-changes-tracker 作为特例
**目标**: 用户可配置 shell 命令在工具执行前/后自动运行

**设计**:
```typescript
interface Hook {
  event: "PreToolUse" | "PostToolUse" | "SessionStart" | "SessionEnd" | "TurnComplete";
  toolName?: string;  // 可选：只对特定工具触发
  command: string;    // shell 命令
  timeout?: number;   // 超时（默认 10s）
  blocking?: boolean; // 是否阻塞（PreToolUse 可阻塞执行）
}
```

**实现方案**:
- 用户配置存储在 `userConfig.hooks: Hook[]`
- `session-tool-executor.ts` 执行工具前/后检查匹配的 hooks
- PreToolUse hook 返回 exit code 2 → 阻止工具执行
- PostToolUse hook 的 stdout 作为附加信息注入 tool_result

**典型用例**:
- PostToolUse(Edit/Write): `prettier --write {file}` 自动格式化
- PostToolUse(Edit/Write): `eslint --fix {file}` 自动修复
- PreToolUse(Bash): 检查命令是否在允许列表中

### 1.2 TurnComplete 钩子

**现状**: turn 完成后无自动化
**目标**: 每轮对话结束后可触发自定义命令

**用例**:
- 自动运行 `tsc --noEmit` 检查类型
- 自动运行 `npm test` 验证
- 发送通知到外部系统

---

## Phase 2：MCP 工具扩展（P1）

### 2.1 MCP Server 连接

**现状**: 无 MCP 支持，工具集固定
**目标**: 支持连接外部 MCP Server，动态加载工具

**设计**:
- 用户配置 `mcp_servers` 列表（类似 Claude Code 的 `mcp_server.json`）
- 每个 MCP server 通过 stdio 或 WebSocket 连接
- 连接后获取工具列表，注入到 session 的可用工具中
- Agent 可以调用 MCP 工具，结果通过 MCP 协议返回

**实现方案**:
- 创建 `packages/studio/src/api/lib/mcp-client.ts`
- 实现 MCP JSON-RPC 协议（initialize → tools/list → tools/call）
- 在 `session-tool-registry.ts` 中动态注册 MCP 工具
- 在 `session-tool-executor.ts` 中路由 MCP 工具调用到对应 server

### 2.2 MCP 工具权限

**现状**: N/A
**目标**: MCP 工具遵循现有权限系统

**设计**:
- MCP 工具默认 risk="write"（需要确认）
- 可通过 `toolAccess.mcpStrategy` 配置：inherit/allow/ask/deny
- MCP 工具的 description 来自 server 返回的 schema

---

## Phase 3：多用户协作（P1）

### 3.1 用户认证系统

**现状**: 只有 API Token（单用户），无用户注册/登录
**目标**: 对标 NarraFork——支持多用户注册、登录、会话隔离

**NarraFork 的做法**:
- Web 登录页面（用户名 + 密码）
- 登录后看到自己的叙述者和叙事线
- 管理员可管理用户

**设计**:
- 用户数据存储在 SQLite（users 表：id/username/password_hash/role/created_at）
- 登录返回 JWT token（httpOnly cookie 或 Authorization header）
- 会话（session）绑定 user_id，用户只能看到自己的会话
- 管理员角色可查看所有用户和会话
- 首次启动时创建默认管理员账户

**实现方案**:
- 创建 `packages/studio/src/api/lib/user-auth.ts`（注册/登录/JWT 验证）
- 创建 `packages/studio/src/api/routes/auth-users.ts`（POST /register, POST /login, GET /me）
- 前端添加登录页面（对标 NarraFork 的登录页）
- 修改现有 API 中间件：未登录 → 重定向到登录页

### 3.2 资源隔离

**现状**: 所有数据全局共享
**目标**: 每个用户只能访问自己的书籍、会话、经纬

**设计**:
- book 表添加 `owner_id` 字段
- session 表添加 `owner_id` 字段
- API 路由添加 user 过滤中间件
- 管理员角色可跨用户访问
- 单用户模式（不配置用户系统时）保持当前行为

---

## 实施顺序

```
Phase 1 — Hooks 系统（P1，自动化能力）
  1.1 PreToolUse / PostToolUse
  1.2 TurnComplete

Phase 2 — MCP 工具扩展（P1，可扩展性）
  2.1 MCP Server 连接
  2.2 MCP 工具权限

Phase 3 — 多用户协作（P1，团队使用）
  3.1 用户认证系统
  3.2 资源隔离
```

---

## 验证标准

- Phase 1：配置 PostToolUse hook 后，Edit 文件自动触发 prettier
- Phase 2：连接 MCP server 后，Agent 能调用外部工具
- Phase 3：两个用户登录后只能看到各自的书籍和会话
