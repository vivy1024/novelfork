# InkOS 功能实现进度

> 更新时间: 2026-04-13

---

## 完成清单

### P0 — 立即可做（已有 API，只缺 UI）✅ 全部完成

| # | 功能 | 文件 | 状态 |
|---|------|------|------|
| 1 | AI 检测仪表盘 | `packages/studio/src/pages/DetectView.tsx` | ✅ 完整闭环 |
| 2 | 通知渠道配置页 | `packages/studio/src/pages/NotifyConfig.tsx` | ✅ 完整闭环 |
| 3 | 章节元数据展示 | `packages/studio/src/components/ChapterMeta.tsx` | ✅ 完整闭环 |
| 4 | Author Intent / Current Focus 编辑器 | `packages/studio/src/pages/IntentEditor.tsx` | ✅ 完整闭环 |

### P1 — 短期（需要少量后端 + UI）✅ 全部完成

| # | 功能 | 文件 | 状态 |
|---|------|------|------|
| 5 | Agent 管理面板 | `packages/studio/src/pages/AgentPanel.tsx` | ⚠️ 基本完成（缺运行时状态） |
| 6 | Scheduler 高级配置 UI | `packages/studio/src/pages/SchedulerConfig.tsx` | ✅ 完整闭环 |
| 7 | AIGC 检测配置 | `packages/studio/src/pages/DetectionConfigView.tsx` | ✅ 完整闭环 |
| 8 | 伏笔健康仪表盘 | `packages/studio/src/pages/HookDashboard.tsx` | ✅ 完整闭环 |
| 9 | LLM 高级参数暴露 | `packages/studio/src/pages/LLMAdvancedConfig.tsx` | ✅ 完整闭环 |

### P2 — 中期（需要架构设计）🚧 进行中

| # | 功能 | 文件 | 状态 | 提交 |
|---|------|------|------|------|
| 0 | ToolRegistry 基础设施 | `packages/core/src/registry/` | ✅ 已完成 | `a4e8f9d` |
| 13 | State Projections 可视化 | `packages/studio/src/pages/StateProjectionsView.tsx` | ✅ 已完成 | `e17a5d3` |
| 10 | MCP Server 管理 | `packages/studio/src/pages/MCPServerManager.tsx` | ✅ 已完成 | `2276e0c` |
| 2 | Pipeline Hooks | `packages/core/src/hooks/` | ✅ 已完成 | 待提交 |
| 3 | MCP Client 集成 | — | ⏳ 待实施 | — |
| 4 | MCP Server 暴露 | — | ⏳ 待实施 | — |
| 11 | Skills / Plugin 系统 | — | ⏳ 待实施 | — |
| 6 | Pipeline 可视化 | — | ⏳ 待实施 | — |

---

## P2 实施详情

### ✅ P2-0: ToolRegistry 基础设施（已完成）

**目标**: 解锁后续所有扩展的前提，只重组代码不改行为。

**实现**:
- 新建 `packages/core/src/registry/tool-registry.ts` — 核心 ToolRegistry 类
- 新建 `packages/core/src/registry/builtin-tools.ts` — 提取 18 个 tool handler
- 迁移 `agent.ts` 的 switch-case 为 `globalToolRegistry.execute()`
- 支持 `source: "builtin" | "mcp" | "plugin"` 标记来源

**验收**: 现有 agent loop 和 pipeline 行为完全不变，所有测试通过。

**提交**: `a4e8f9d` feat(core): add ToolRegistry infrastructure

---

### ✅ P2-13: State Projections 可视化（已完成）

**目标**: 结构化展示运行时状态快照（current_state/hooks/summaries）。

**实现**:
- 新建 `packages/studio/src/pages/StateProjectionsView.tsx`
- 显示章节进度、活跃伏笔、未解决冲突
- 资源平衡账本、情感弧线
- 集成到 App.tsx 路由和 Sidebar.tsx 导航

**API**: 复用现有 truth files API（`/api/books/:id/truth`）读取 JSON 文件

**提交**: `e17a5d3` feat(studio): add State Projections visualization

---

### ✅ P2-10: MCP Server 管理（已完成）

**目标**: 集中管理 MCP Server 的启动、停止、删除和工具列表查询。

**实现**:
- 新建 `packages/studio/src/pages/MCPServerManager.tsx` — 管理 UI
- 新建 `packages/studio/src/api/routes/mcp.ts` — CRUD API
- 进程管理（spawn/kill）+ inkos.json 配置持久化
- 支持配置 command、args、env
- 显示服务器状态（running/stopped/starting/error）和工具列表

**集成**: 仅 standalone 模式启用（relay 模式不需要）

**提交**: `2276e0c` feat(studio): add MCP Server management UI and API

---

### ✅ P2-2: Pipeline Hooks（已完成）

**目标**: 参考 VoltAgent 的 Hooks 生命周期拦截器。

**实现**:
- 新建 `packages/core/src/hooks/types.ts` — 定义 HookContext、PipelineHooks、PipelineStage 类型
- 新建 `packages/core/src/hooks/hook-manager.ts` — HookManager 核心类，支持注册和执行 hooks
- 新建 `packages/core/src/hooks/builtin-hooks.ts` — 内置 hooks（通知、日志、自动备份）
- 新建 `packages/core/src/hooks/index.ts` — 统一导出
- 迁移 `dispatchNotification` 为 hook 实现（createNotificationHook）
- 在 `PipelineRunner` 关键节点集成 hook 调用：
  - before-plan, before-write, after-write
  - before-audit, after-audit
  - chapter-complete, chapter-failed
- 更新 `PipelineConfig` 支持 `hooks` 配置字段
- 更新 `ProjectConfigSchema` 新增 `HookConfigSchema` 和 `hooks` 字段
- 编写单元测试 `packages/core/src/__tests__/hooks.test.ts`（7 个测试全部通过）

**验收**: 
- ✅ 通知系统通过 hook 机制运行
- ✅ 用户可在 `inkos.json` 中配置自定义 hook
- ✅ Hook 失败不阻塞 pipeline
- ✅ 支持 16 个生命周期阶段
- ✅ 测试覆盖核心功能

**提交**: 待提交

---

### ⏳ P2-3: MCP Client 集成（待实施，3-5 天）

**目标**: 参考 AstrBot MCPClient（三种传输 + 自动重连）+ CC Switch 管理 UI。

**计划**:

核心层:
- `packages/core/src/mcp/client.ts` — 支持 stdio 和 SSE 传输
- MCP tool 发现后自动注册到 ToolRegistry，source 标记 `"mcp"`
- Tauri 桌面端可用 `tauri-plugin-mcp-client` 做 stdio 传输

配置:
- `inkos.json` 新增 `mcpServers` 字段（与 Claude Code / CC Switch 格式一致）

UI（参考 CC Switch）:
- MCP Server 管理页面：server 列表 + 连接状态 + tool 列表 + 启停 + 日志

注意事项（AstrBot 踩坑经验）:
- 启动超时设 180s
- 自动重连（session terminated 检测）
- MCP JSON Schema 兼容（`type` 可以是数组）

---

### ⏳ P2-4: MCP Server 暴露（待实施，2-3 天）

**目标**: InkOS 独有差异化。把记忆系统暴露为 MCP server。

**计划**:

暴露的 tool:
- `inkos.query_facts(subject, chapter?)` — 时序事实查询
- `inkos.query_hooks(status?)` — 伏笔池查询
- `inkos.query_summaries(chapter_range?)` — 章节摘要查询
- `inkos.get_world_state(bookId)` — 当前世界状态快照
- `inkos.search_memory(query, bookId)` — 语义记忆检索（复用 `retrieveMemorySelection`）

应用场景:
- Claude Code 写代码时查 InkOS 世界观
- 羽书（AstrBot）查角色关系回答读者问题
- 其他 agent 框架通过 MCP 接入 InkOS 的叙事知识库

---

### ⏳ P2-11: Skills / Plugin 系统（待实施，3-5 天）

**目标**: 参考 AstrBot Star 系统（manifest + 生命周期），但更轻量。

**计划**:

```
plugins/
  auto-publish/
    manifest.json    # { name, version, tools: [...], hooks: [...] }
    index.ts         # export default class AutoPublish extends InkOSPlugin
```

生命周期: discover → load → initialize → active → terminate
- `PluginManager` 扫描 `plugins/` 目录
- 读 manifest → 动态 import → 注册 tool 和 hook
- 支持热重载（文件变化检测）

UI: Plugin 管理页面（列表 + 启停 + 配置 + 日志）

---

### ⏳ P2-6: Pipeline 可视化（待实施，5+ 天，可放 v11）

**目标**: 不做 Rivet 通用 DAG 编辑器。做 VoltOps 风格的运行态流程图。

**计划**:
- 左侧：pipeline 阶段列表（plan → compose → write → normalize → settle → audit → revise）
- 每个阶段显示状态（等待/运行中/完成/失败）+ agent 配置 + model
- 右侧：选中阶段的详情（tool 调用日志、token 消耗、耗时）
- 实时更新，复用现有 SSE 基础设施
- 参考 CopilotKit AG-UI 事件流协议做 agent-UI 通信

---

## 集成改动汇总

| 文件 | 改动 |
|------|------|
| `packages/studio/src/App.tsx` | +11 路由、+11 导航方法、+11 TabContent case |
| `packages/studio/src/components/Sidebar.tsx` | +9 侧边栏导航项（Agent/通知/调度/LLM/伏笔/AIGC/状态投影/MCP） |
| `packages/studio/src/api/routes/storage.ts` | truth 白名单 +author_intent.md/current_focus.md；GET/PUT /project 支持 daemon/detection/llm 高级参数 |
| `packages/studio/src/pages/BookDetail.tsx` | 集成 ChapterMeta 组件 + AI 检测入口按钮 |
| `packages/studio/src/shared/contracts.ts` | ChapterDetail 类型补全元数据字段 |
| `packages/studio/src/storage/adapter.ts` | ChapterMeta 类型补全元数据字段 |
| `packages/studio/src/api/server.ts` | 集成 MCP router（standalone 模式） |
| `packages/core/src/pipeline/agent.ts` | 迁移到 ToolRegistry，移除 250+ 行 switch-case |

---

## 构建验证

- `vite build` 通过，无编译错误
- 产物: `dist/index.html` + `dist/assets/`
- 仅存在预存在的 `use-tabs.ts` TypeScript 错误（不影响功能）

---

## 本地测试口径

当前实现需要区分两条本地路径：

### 1. Web 本地调试

直接启动 `packages/studio` 并在浏览器访问 `http://localhost:4567` 时，仍走 Web auth gate。
只有这条路径才需要：
- `SESSION_SECRET`
- `SUBAPI_SHARED_SECRET`
- 合法的 `/?token=xxx`

### 2. Tauri 桌面本地开发

通过 `pnpm --filter @actalk/inkos-desktop dev` 启动时，Tauri 会注入 `__TAURI_INTERNALS__`，Studio 跳过 Web auth gate，改走本地 Tauri bridge。
这条路径下可以直接进入工作区/离线界面，本地看页面不需要先拿 Sub2API launch token。

如只是验证这 9 个新页面的渲染、导航和基础交互，优先走 Tauri 桌面本地开发。
如要验证 relay / Sub2API 登录链路，再单独走 Web 路径。

仅在 Web 路径需要 token 时，Windows 建议直接在 PowerShell 中设置环境变量后启动：

```powershell
$env:SESSION_SECRET="dev-test-secret-123"
$env:SUBAPI_SHARED_SECRET="dev-launch-secret-456"
cd packages/studio
npx tsx src/api/index.ts
```

然后用生成的 token 访问 `http://localhost:4567/?token=xxx`

Token 生成脚本（仅 Web 路径需要）：
```js
const crypto = require('crypto');
const secret = 'dev-launch-secret-456';
const now = Math.floor(Date.now() / 1000);
const header = Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
const payload = Buffer.from(JSON.stringify({
  user_id: 1, email: 'dev@test.com', role: 'admin',
  iss: 'sub2api', iat: now, exp: now + 3600,
  jti: crypto.randomUUID()
})).toString('base64url');
const sig = crypto.createHmac('sha256', secret).update(header+'.'+payload).digest('base64url');
console.log(header+'.'+payload+'.'+sig);
```

---

## 开源参考项目

| 项目 | 技术栈 | 借鉴重点 | GitHub |
|------|--------|---------|--------|
| Rivet | Tauri + React + TS | 同技术栈，可视化 agent 流程编辑器 | [Ironclad/rivet](https://github.com/Ironclad/rivet) |
| Mission Control | Next.js + TS | Agent 管理 UI 完整参考（状态/日志/启停） | [builderz-labs/mission-control](https://github.com/builderz-labs/mission-control) |
| Mastra | TypeScript | 多 agent 编排 + Workflow DAG + MCP 原生 | [mastra-ai/mastra](https://github.com/mastra-ai/mastra) |
| VoltAgent | TypeScript + React | Agent observability 控制台 + MCP | [VoltAgent/voltagent](https://github.com/VoltAgent/voltagent) |
| CopilotKit | React + TS | AI 交互组件 + Human-in-the-loop | [CopilotKit/CopilotKit](https://github.com/CopilotKit/CopilotKit) |
| tauri-plugin-mcp-client | Rust + TS | Tauri v2 MCP 客户端插件，可直接集成 | [sublayerapp/tauri-plugin-mcp-client](https://github.com/sublayerapp/tauri-plugin-mcp-client) |
| CC Switch | Tauri 2 | 多 CLI 配置/MCP/Skills 统一管理 | [farion1231/cc-switch](https://github.com/farion1231/cc-switch) |
| AstrBot | Python + Vue | MCPClient 三种传输 + 自动重连；Star 插件系统 | [Soulter/AstrBot](https://github.com/Soulter/AstrBot) |

---

## 各开源项目借鉴映射

| 项目 | 借鉴内容 | 对应步骤 |
|------|---------|---------|
| AstrBot | MCPClient 三种传输 + 自动重连；Star 插件 manifest + 生命周期 | P2-3, P2-11 |
| Mastra | `createTool()` + Zod schema 工具注册；MCP 双向集成 | P2-0, P2-3, P2-4 |
| VoltAgent | Hooks 生命周期拦截器；VoltOps 运行态流程图 | P2-2, P2-6 |
| CopilotKit | AG-UI 事件流协议；Shared State；HITL 暂停/恢复 | P2-6 |
| CC Switch | MCP server 管理 UI 交互设计 | P2-10 |
| Rivet | Plugin 注册自定义节点的扩展机制 | P2-11 |

---

## 总工期估算

| 步骤 | 工期 | 状态 | 累计 |
|------|------|------|------|
| P2-0 ToolRegistry | 2-3 天 | ✅ 已完成 | 2-3 天 |
| P2-13 State 可视化 | 1-2 天 | ✅ 已完成 | 3-5 天 |
| P2-10 MCP Server 管理 | 1-2 天 | ✅ 已完成 | 4-7 天 |
| P2-2 Pipeline Hooks | 2 天 | ✅ 已完成 | 6-9 天 |
| P2-3 MCP Client | 3-5 天 | ⏳ 待实施 | 9-14 天 |
| P2-4 MCP Server 暴露 | 2-3 天 | ⏳ 待实施 | 11-17 天 |
| P2-11 Plugin 系统 | 3-5 天 | ⏳ 待实施 | 14-22 天 |
| P2-6 Pipeline 可视化 | 5+ 天 | ⏳ 待实施 | 19-27 天 |

**当前进度**: 6-9 天 / 19-27 天（约 30-40% 完成）

---

## Git 提交历史

| 提交 | 日期 | 说明 |
|------|------|------|
| 待提交 | 2026-04-13 | feat(core): add Pipeline Hooks infrastructure |
| `2276e0c` | 2026-04-13 | feat(studio): add MCP Server management UI and API |
| `e17a5d3` | 2026-04-13 | feat(studio): add State Projections visualization |
| `a4e8f9d` | 2026-04-13 | feat(core): add ToolRegistry infrastructure |
| — | 2026-04-12 | P0/P1 功能全部完成并验证 |

---

## 下一步

- [x] 本地验证 P2-0/P2-10/P2-13 的渲染和交互
- [x] 实施 P2-2 Pipeline Hooks
- [ ] 实施 P2-3 MCP Client 集成
- [ ] 实施 P2-4 MCP Server 暴露
- [ ] 实施 P2-11 Skills / Plugin 系统
- [ ] 实施 P2-6 Pipeline 可视化（可放 v11）
