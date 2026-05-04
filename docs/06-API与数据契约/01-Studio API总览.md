# Studio API总览

**版本**: v1.0.2
**创建日期**: 2026-04-28
**更新日期**: 2026-05-04
**状态**: ✅ 当前有效
**文档类型**: current

---

## 本文定位

本文是 Studio API 的总览和维护入口。它不逐端点展开请求/响应 schema；逐端点契约后续应拆入专题文档，并且必须反查 `packages/studio/src/api/routes/` 中的真实代码。

## 主要入口文件

当前 Studio API 的核心入口位于：

| 文件 | 作用 |
|---|---|
| `packages/studio/src/api/server.ts` | 创建 Hono app，挂载路由，处理 startup、static provider、WebSocket |
| `packages/studio/src/api/routes/index.ts` | 路由导出聚合入口 |
| `packages/studio/src/api/routes/*.ts` | 各能力域的 Hono route 实现 |
| `packages/studio/src/api/lib/*` | runtime store、session chat、startup diagnostics 等服务 |

`createStudioServer(initialConfig, root)` 是主要 server factory。它会创建共享 `RouterContext`，再根据运行模式挂载不同路由。

## 运行模式

当前 API 支持两类模式：

| 模式 | 来源 | 路由特点 |
|---|---|---|
| `standalone` | 默认模式 | 挂载本地 Studio 所需的大部分 API，包括 books、providers、settings、writing tools、routines 等 |
| `relay` | `NOVELFORK_MODE=relay` | 只挂载 snapshot-based AI relay 相关端点 |

除非文档特别说明，当前 Studio 文档默认讨论 `standalone` 模式。

## 全局行为

### CORS

server 对 `/*` 启用 CORS。

### 结构化错误

`ApiError` 会返回结构化 JSON：

```json
{
  "error": {
    "code": "INVALID_BOOK_ID",
    "message": "Invalid book ID"
  }
}
```

未知错误返回 `INTERNAL_ERROR`。

### Book ID 安全校验

`/api/books/:id` 和 `/api/books/:id/*` 经过 `isSafeBookId` 校验，非法 book id 会返回 `INVALID_BOOK_ID`。

### 事件广播

core pipeline events 会桥接到 Studio SSE：

| core event | Studio event |
|---|---|
| `run:start` | `pipeline:start` |
| `stage:update` | `pipeline:stage` |
| `run:complete` | `pipeline:complete` |

## 路由分组

| 分组 | 挂载来源 | 说明 | 当前口径 |
|---|---|---|---|
| `/api/auth` | `createAuthRouter` | 登录、会话与认证 | current |
| `/api/runs` | `createRunsRouter` | 运行任务 SSE 与状态管理 | current |
| `/api/workbench` | `createWorkbenchRouter` | 工作区文件操作 | current |
| `/api/books/...` | `createStorageRouter` 等 | 书籍、章节、truth files、导出、日志、doctor 等 | current / 部分 planning |
| `/api/books/:id/candidates` | `createChapterCandidatesRouter` | 生成章节 / 草稿候选处理 | current |
| `/api/books/:bookId/jingwei/*` | `createJingweiRouter` | 故事经纬栏目、条目、模板应用、上下文预览 | current / 部分 UI 待接 |
| `/api/questionnaires` 与 `/api/books/:bookId/questionnaires/*` | `createBibleRouter` | 问卷模板、回答保存、AI 建议 | current |
| `/api/books/:bookId/chapters/:chapter/pre-generation-questions` | `createBibleRouter` | 生成前追问 | current |
| `/api/books/:bookId/core-shifts*` | `createBibleRouter` | 核心设定变更提出、接受、拒绝、查询 | current |
| `/api/ai` 相关 | `createAIRouter` | AI 操作和 legacy SSE | current / transparent |
| `/api/daemon` | `createDaemonRouter` | 守护进程与调度 | current / transparent |
| `/api/mcp` | `createMCPRouter` | MCP server 管理 | current |
| `/api/lorebook` | `createLorebookRouter` | Lorebook / 世界观接口 | current |
| `/api/pipeline` | `createPipelineRouter` | 管线可视化与运行态 | transparent：部分运行态仍是当前进程临时状态 |
| `/api/settings` | `createSettingsRouter` | 设置管理 | current |
| `/api/onboarding` | `createOnboardingRouter` | 首次启动和 getting-started 状态 | current |
| `/api/providers` | `createProvidersRouter` | AI 供应商管理 | current |
| `/api/runtime-capabilities` | `createRuntimeCapabilitiesRouter` | 运行时能力声明 | current |
| `/api/platform-integrations` | `createPlatformIntegrationsRouter` | 平台账号导入 | current / transparent |
| `/api/git` | `createGitRouter` | Git 信息 | current |
| `/api/agent/config` | `createAgentConfigRouter` | Agent 配置 | current |
| `/api/tools` | `createToolsRouter` | 工具调用 | current |
| `/api/worktree` | `createWorktreeRouter` | Git worktree 管理 | current / transparent |
| `/api/rhythm` | `createRhythmRouter` | 节奏分析 | current |
| `/api/golden-chapters` | `createGoldenChaptersRouter` | 黄金三章分析 | current |
| `/api/chat` | `createChatRouter` | 轻量 Book Chat | transparent：历史为当前进程临时状态 |
| `/api/context` | `createContextManagerRouter` | 上下文管理 | current |
| `/api/admin` | `createAdminRouter` | 管理面板和 startup recovery 动作 | current / transparent |
| `/api/routines` | `createRoutinesRouter` | 套路系统 | current |
| `/api/presets` 相关 | `createPresetsRouter` | 预设浏览与书籍预设 | current |
| `/api/filter` 与 `/api/books/:bookId/filter/*` | `createFilterRouter` | AI 味扫描、报告、批量重扫、改写建议、朱雀配置 | current |
| `/api/compliance` 与 `/api/books/:bookId/compliance/*` | `createComplianceRouter` | 合规 / 发布检查 | current / 待迁移 UI |
| `/api/writing-tools` | `createWritingToolsRouter` | hooks、节奏、对话、健康等写作工具 | current |
| `/api/writing-modes` | `createWritingModesRouter` | 写作模式和提示词预览 | transparent：应用写入仍需安全路径 |
| `/api/search` | `createSearchRouter` | 搜索系统 | current |
| `/api/sessions` | `sessionRouter` | 会话管理 | current |
| `/api/monitor` | `createMonitorRouter` | 监控可视化 | transparent：无事实源时 unsupported |

## WebSocket 路由

当前 server 启动后注册：

| 路由 | 说明 |
|---|---|
| `/api/admin/resources/ws` | 管理资源 WebSocket |
| `/api/sessions/:id/chat` | 会话聊天 WebSocket |

Monitor WebSocket 当前不是完整启用口径，不能写成已接真实监控终态。

## 引导式生成与故事经纬 API 边界

这些 route 是已实现 spec 容易在文档里漏写的重点。本文只列维护入口，不替代逐端点 schema。

### 故事经纬

| 路径 | 作用 | 当前边界 |
|---|---|---|
| `GET /api/books/:bookId/jingwei/sections` | 列出经纬栏目 | 真实 SQLite 读取 |
| `POST /api/books/:bookId/jingwei/sections` | 新建栏目 | 写入结构化经纬表 |
| `PUT /api/books/:bookId/jingwei/sections/:sectionId` | 更新栏目 | 不自动迁移正文 |
| `DELETE /api/books/:bookId/jingwei/sections/:sectionId` | 删除栏目 | 需要前端明确风险 |
| `GET /api/books/:bookId/jingwei/entries` | 查询条目 | 支持按章节范围和栏目过滤 |
| `POST /api/books/:bookId/jingwei/entries` | 新建条目 | 写入结构化经纬表 |
| `PUT /api/books/:bookId/jingwei/entries/:entryId` | 更新条目 | 不自动生成章节 |
| `DELETE /api/books/:bookId/jingwei/entries/:entryId` | 删除条目 | 不自动回滚正文 |
| `POST /api/books/:bookId/jingwei/templates/apply` | 应用经纬模板 | 可写入空白、基础、增强或题材推荐结构 |
| `POST /api/books/:bookId/jingwei/preview-context` | 预览 AI 上下文 | 按可见性和章节范围裁剪 |

### 引导式生成

| 路径 | 作用 | 当前边界 |
|---|---|---|
| `GET /api/questionnaires` | 查询问卷模板 | 会确保内置模板 seed |
| `POST /api/books/:bookId/questionnaires/:templateId/responses` | 创建问卷回答 | 回答可映射到目标经纬对象 |
| `PUT /api/books/:bookId/questionnaires/:templateId/responses/:id` | 更新问卷回答 | 用于草稿、提交、跳过等状态 |
| `POST /api/books/:bookId/questionnaires/:templateId/ai-suggest` | 生成单题 AI 建议 | 需要模型配置，不应替用户静默提交 |
| `POST /api/books/:bookId/chapters/:chapter/pre-generation-questions` | 生成本章追问 | 返回问题和触发启发式，不写正文 |
| `GET /api/books/:bookId/core-shifts` | 查询核心设定变更 | 可按状态过滤 |
| `POST /api/books/:bookId/core-shifts` | 提出核心设定变更 | 记录影响对象和章节 |
| `POST /api/books/:bookId/core-shifts/:id/accept` | 接受变更 | 应用变更并记录历史 |
| `POST /api/books/:bookId/core-shifts/:id/reject` | 拒绝变更 | 不改动核心设定 |

### AI 味、预设和合规

| 路径 | 作用 | 当前边界 |
|---|---|---|
| `POST /api/filter/scan` | 扫描文本 AI 味 | 可用本地规则，朱雀可选 |
| `GET /api/books/:bookId/filter/report` | 查询全书 AI 味报告 | 支持按 PGI 使用情况分组 |
| `GET /api/books/:bookId/filter/report/:chapter` | 查询单章 AI 味报告 | 读取已存报告 |
| `POST /api/filter/suggest-rewrite` | 请求改写建议 | 建议不自动覆盖正文 |
| `PUT /api/settings/zhuque` | 保存朱雀配置 | 属于设置持久化 |
| `POST /api/books/:bookId/filter/batch-rescan` | 批量重扫 | 可能耗时，应显示进度或状态 |
| `/api/presets` 相关 | 预设浏览、bundle、书籍预设绑定 | 当前是写作约束资产，不是模板市场 |
| `/api/books/:bookId/compliance/*` | 敏感词、AI 比例、格式、发布就绪、AI 声明 | 当前 route 可用，工作台入口仍需整合 |
| `/api/compliance/dictionaries*` | 平台词库查询和导入 | 导入词库后影响后续合规检查 |

## 数据来源与持久化边界

| 类型 | 例子 | 文档写法 |
|---|---|---|
| 真实持久化 | Provider runtime store、章节保存、平台账号 JSON、故事经纬栏目/条目、问卷回答、核心设定变更、AI 味报告 | 可以写 current |
| 当前进程临时状态 | 轻量 Chat 历史、Pipeline runs | 必须标注 `process-memory` 或透明过渡 |
| 提示词预览 | writing modes preview | 只能写 prompt preview，不代表写入正文 |
| 未接入能力 | Cline 导入、monitor 无事实源、部分 admin 动作 | 必须写 unsupported、disabled 或 transparent |

## API 文档维护规则

1. 新增 API 文档必须先定位 route 文件。
2. 文档里的路径必须与真实 route 挂载保持一致。
3. 对于 current API，必须写清数据来源和失败状态。
4. 对于 planning API，必须链接到对应 spec，不得伪造成已完成。
5. 对于 process-memory、prompt-preview、unsupported 等透明状态，必须在文档中保留原始术语。
6. `backend-contract-v1` 是前端重建阶段的能力合同入口；新前端不得绕过合同 client 调用未登记能力。
7. `frontend-refoundation-v1` 中的按钮、资源节点、工具结果卡和状态栏必须能追溯到本 API 文档、Backend Contract 矩阵或真实 session tool 定义。

## 后续拆分入口

- [创作工作台接口](./02-创作工作台接口.md)
- [数据表与迁移](./03-数据表与迁移.md)
- [SSE与运行事件](./04-SSE与运行事件.md)
