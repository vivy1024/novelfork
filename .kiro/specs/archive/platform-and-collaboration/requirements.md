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
**目标**: 对标 NarraFork + 学习 Sub2API 的成熟用户系统设计

**Sub2API 用户系统参考**:
- Email + 验证码注册
- 多种 OAuth（LinuxDo/微信/OIDC/GitHub/Google）
- Access Token + Refresh Token 双 token 模式
- role 分层（admin/user）
- balance 余额 + concurrency 并发限制
- Turnstile 人机验证
- TOTP 双因素认证
- 邀请码/推广码系统

**NovelFork 用户模型设计**:
```
users 表:
  id: UUID
  email: string (unique)
  username: string
  password_hash: string
  role: "admin" | "user"
  status: "active" | "banned" | "pending"
  signup_source: "email" | "oidc" | "external"
  avatar_url: string?
  balance: decimal (用量追踪，可选)
  concurrency: int (并发会话限制)
  totp_enabled: boolean
  totp_secret_encrypted: string?
  last_login_at: datetime?
  created_at: datetime
  updated_at: datetime
```

**认证模式（三种，通过配置切换）**:

| 模式 | 配置值 | 适用场景 |
|------|--------|---------|
| 无认证 | `auth.mode: "none"` | 单用户本地使用（当前默认） |
| 内置 | `auth.mode: "builtin"` | NovelFork 独立部署，自管用户 |
| 外部 | `auth.mode: "external"` | YuzhenFork 等 fork 项目，用户在外部系统 |

**内置模式功能**:
- Email + 密码注册/登录
- Access Token（短期，15min）+ Refresh Token（长期，7d）
- 管理员面板：用户列表、封禁、角色变更
- 可选：OIDC OAuth 接入（GitHub/Google 等）
- 可选：Turnstile 人机验证
- 首次启动创建默认管理员（从环境变量或交互式输入）

**外部模式功能**:
- 验证外部系统签发的 JWT（通过 `auth.external.jwtSecret` 或 JWKS URL）
- 从 JWT payload 提取 user_id、role、email
- 不管注册/登录流程（外部系统负责）
- 玉珍健身场景：PHP 后端签发 JWT → 前端带 JWT → YuzhenFork 验证

**管理员 vs 普通用户权限**:

| 能力 | 管理员 | 普通用户 |
|------|--------|---------|
| 配置 AI 供应商（API Key） | ✅ | ❌ 不可见 |
| 选择模型 | ✅ | ✅（从管理员配的列表中选） |
| 管理其他用户 | ✅ | ❌ |
| 查看所有会话 | ✅ | ❌ 只看自己的 |
| 修改全局设置 | ✅ | ❌ |
| 创建书籍/会话 | ✅ | ✅ |
| 修改自己的偏好 | ✅ | ✅ |

**实现方案**:
- `packages/studio/src/api/lib/user-auth.ts` — 认证核心
  - `hashPassword(plain)` / `verifyPassword(plain, hash)` — bcrypt
  - `generateTokenPair(userId)` → `{ accessToken, refreshToken, expiresIn }`
  - `verifyAccessToken(token)` → `{ userId, role, email }`
  - `refreshAccessToken(refreshToken)` → 新的 token pair
  - `verifyExternalJwt(token, config)` → `{ userId, role, email }`
- `packages/studio/src/api/routes/auth-users.ts` — API 路由
  - POST /auth/register（builtin 模式）
  - POST /auth/login（builtin 模式）
  - POST /auth/refresh（两种模式）
  - GET /auth/me（两种模式）
  - POST /auth/logout（撤销 refresh token）
- `packages/studio/src/api/middleware/auth-guard.ts` — 路由守卫
  - 从 cookie 或 Authorization header 读取 token
  - 验证后注入 `c.set("user", { id, role, email })`
  - `auth.mode: "none"` 时跳过
- 前端：
  - builtin 模式：登录/注册页面
  - external 模式：从 cookie/header 读 token（外部系统已登录）
  - none 模式：无登录页（当前行为）

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
