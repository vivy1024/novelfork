# InkOS 功能缺口审计清单

> 生成时间: 2026-04-12 | 基于 core/studio 代码审计 + ccSwitch 功能对标

---

## 一、ccSwitch 对标功能（InkOS 应具备的管理能力）

| # | 功能 | ccSwitch 实现 | InkOS 现状 | 优先级 |
|---|------|-------------|-----------|--------|
| 1 | 多 LLM Provider 配置管理 | 多配置 CRUD + 一键切换 | ✅ 已实现（多配置 + 5 协议） | — |
| 2 | MCP Server 管理 | 集中管理各工具的 MCP server | ❌ 完全未实现 | P1 |
| 3 | Skills 管理 | 管理自定义命令/技能 | ❌ 完全未实现（tool 硬编码） | P1 |
| 4 | Agent 管理面板 | — | ❌ 16 个 agent 无管理 UI | P1 |
| 5 | System Prompt 管理 | 管理 CLAUDE.md 等 | ❌ 无 prompt 模板管理 | P2 |
| 6 | 上游模型列表 | 显示可用模型 | ✅ 已实现（测试连接返回） | — |

## 二、核心层已实现但无 UI 的功能

### A. Agent 系统（16 个 agent，仅 6 个有直接 UI 入口）

| # | Agent | 核心层 | UI 状态 | 缺失说明 |
|---|-------|--------|---------|---------|
| 1 | PlannerAgent | ✅ | ❌ | 无"规划下一章"独立按钮 |
| 2 | ComposerAgent | ✅ | ❌ | 无"预览上下文包"入口 |
| 3 | LengthNormalizer | ✅ | ❌ | 无字数归一化配置/可视化 |
| 4 | ChapterAnalyzer | ✅ | ❌ | 无独立章节分析入口 |
| 5 | StateValidator | ✅ | ❌ | 无状态校验可视化 |
| 6 | Consolidator | ✅ | ❌ | 无状态整合可视化 |
| 7 | FoundationReviewer | ✅ | ❌ | 无基础设定审查入口 |
| 8 | AI Tells 检测 | ✅ | ❌ | API 存在但无 UI 页面 |
| 9 | 敏感词检测 | ✅ | ❌ | 完全不可见 |
| 10 | 外部 AIGC 检测 | ✅ | ❌ | GPTZero/Originality 无配置入口 |

### B. 通知系统（4 种渠道，全部无 UI）

| # | 功能 | API 端点 | UI 状态 |
|---|------|---------|---------|
| 1 | Telegram 通知 | GET/PUT /api/project/notify | ❌ |
| 2 | 飞书通知 | GET/PUT /api/project/notify | ❌ |
| 3 | 企业微信通知 | GET/PUT /api/project/notify | ❌ |
| 4 | Webhook 通知 (HMAC签名) | GET/PUT /api/project/notify | ❌ |
| 5 | 通知历史/测试 | 无 | ❌ |

### C. 章节元数据（已持久化但 UI 不显示）

| # | 字段 | 说明 |
|---|------|------|
| 1 | auditIssues | 审计问题详情 |
| 2 | reviewNote | 审阅备注 |
| 3 | detectionScore | AI 检测分数 |
| 4 | detectionProvider | 检测提供商 |
| 5 | tokenUsage | Token 消耗 (prompt/completion/total) |
| 6 | lengthTelemetry | 字数遥测 (target/actual/delta) |
| 7 | lengthWarnings | 字数警告 |

### D. LLM 高级参数（核心层支持但 UI 未暴露）

| # | 参数 | 说明 |
|---|------|------|
| 1 | thinkingBudget | Claude thinking 预算 |
| 2 | apiFormat (chat/responses) | API 格式选择 |
| 3 | extra | 额外请求参数 |
| 4 | headers | 自定义请求头 |
| 5 | ModelOverride.apiKeyEnv | 按 agent 独立 API Key |
| 6 | ModelOverride.stream | 按 agent 独立流式开关 |

### E. Pipeline 高级配置（无 UI）

| # | 功能 | 说明 |
|---|------|------|
| 1 | QualityGates | maxAuditRetries / pauseAfterConsecutiveFailures / retryTemperatureStep |
| 2 | Scheduler 参数 | maxChaptersPerDay / cooldownAfterChapterMs / retryDelayMs |
| 3 | DetectionConfig | provider / apiUrl / threshold / autoRewrite / maxRetries |
| 4 | InputGovernanceMode | legacy / v2 模式切换 |

### F. 状态与记忆系统（无 UI）

| # | 功能 | 说明 |
|---|------|------|
| 1 | RuntimeStateStore | 运行时状态快照浏览/回滚 |
| 2 | State Projections | 结构化状态视图（current_state/hooks/summaries） |
| 3 | MemoryDB | 事实/摘要内存数据库浏览/搜索 |
| 4 | Author Intent 编辑器 | 写作意图控制面文档 |
| 5 | Current Focus 编辑器 | 当前焦点控制面文档 |

### G. 伏笔系统（完整实现但完全不可见）

| # | 功能 | 说明 |
|---|------|------|
| 1 | Hook Governance | 伏笔生命周期管理 |
| 2 | Hook Health | 伏笔健康度分析 |
| 3 | Hook Arbiter | 伏笔冲突仲裁 |
| 4 | 伏笔仪表盘 | 哪些过期、哪些需推进、回收率 |

---

## 三、开源参考项目

| 项目 | 技术栈 | 借鉴重点 | GitHub |
|------|--------|---------|--------|
| Rivet | Tauri + React + TS | 同技术栈，可视化 agent 流程编辑器 | [Ironclad/rivet](https://github.com/Ironclad/rivet) |
| Mission Control | Next.js + TS | Agent 管理 UI 完整参考（状态/日志/启停） | [builderz-labs/mission-control](https://github.com/builderz-labs/mission-control) |
| Mastra | TypeScript | 多 agent 编排 + Workflow DAG + MCP 原生 | [mastra-ai/mastra](https://github.com/mastra-ai/mastra) |
| VoltAgent | TypeScript + React | Agent observability 控制台 + MCP | [VoltAgent/voltagent](https://github.com/VoltAgent/voltagent) |
| CopilotKit | React + TS | AI 交互组件 + Human-in-the-loop | [CopilotKit/CopilotKit](https://github.com/CopilotKit/CopilotKit) |
| tauri-plugin-mcp-client | Rust + TS | Tauri v2 MCP 客户端插件，可直接集成 | [sublayerapp/tauri-plugin-mcp-client](https://github.com/sublayerapp/tauri-plugin-mcp-client) |
| CC Switch | Tauri 2 | 多 CLI 配置/MCP/Skills 统一管理 | [farion1231/cc-switch](https://github.com/farion1231/cc-switch) |

---

## 四、建议实施优先级

### P0 — 立即可做（已有 API，只缺 UI）
1. AI 检测仪表盘（detect + detect-all + stats API 已就绪）
2. 通知渠道配置页（notify API 已就绪）
3. 章节元数据展示（数据已持久化）
4. Author Intent / Current Focus 编辑器

### P1 — 短期（需要少量后端 + UI）
5. Agent 管理面板（状态、日志、配置查看）
6. Scheduler 高级配置 UI
7. AIGC 检测配置（DetectionConfig）
8. 伏笔健康仪表盘
9. LLM 高级参数暴露

### P2 — 中期（需要架构设计）
10. MCP Server 管理（参考 tauri-plugin-mcp-client）
11. Skills / Plugin 系统（参考 Mastra tool 注册机制）
12. 可视化 Agent 流程编辑器（参考 Rivet）
13. State Projections 可视化

---

## 五、P2 实施计划（2026-04-12 制定）

> 基于 InkOS 现有架构 + AstrBot/Mastra/VoltAgent/CopilotKit/CC Switch/Rivet 六个开源项目调研。
> 前提：P0/P1 功能测试通过后启动。

### 现状评估

InkOS 当前 agent 系统完全硬编码：
- 18 个 tool 在 `agent.ts` 模块顶层静态定义
- `executeAgentTool` 是 switch-case 分发（348-601 行）
- `PipelineRunner` 直接 `new XxxAgent()`，import 写死
- 唯一的"动态"是 `modelOverrides` 可以让同一 agent 用不同 LLM

记忆系统是成熟资产（三层存储 + 时序事实 + 伏笔治理 + 快照回滚），可作为 MCP Server 暴露。

### 六步实施路线

#### Step 1: ToolRegistry 基础设施（2-3 天）

> 解锁后续所有扩展的前提。只重组代码，不改行为。

- 新建 `packages/core/src/registry/tool-registry.ts`
- 参考 Mastra `createTool()` + Zod schema 范式定义 `RegisteredTool` 接口
- 迁移 `agent.ts` 的 18 个 tool 为 `registry.register()` 调用
- `executeAgentTool` 的 switch-case 改为 `registry.execute(name, args, ctx)`
- 支持 `source: "builtin" | "mcp" | "plugin"` 标记来源

```typescript
interface RegisteredTool {
  readonly definition: ToolDefinition;
  readonly handler: (args: Record<string, unknown>, ctx: ToolContext) => Promise<string>;
  readonly source: "builtin" | "mcp" | "plugin";
}
```

验收标准：现有 agent loop 和 pipeline 行为完全不变，所有测试通过。

#### Step 2: Pipeline Hooks（2 天）

> 参考 VoltAgent 的 Hooks 生命周期拦截器。

- 在 `PipelineRunner` 关键节点加拦截器接口
- 将现有通知系统（`dispatchNotification`）从硬编码改为 hook 注册
- 用户可注册自定义 hook（如自动发布、自动备份）

```typescript
interface PipelineHooks {
  onBeforePlan?: (ctx: HookContext) => Promise<void>;
  onAfterWrite?: (ctx: HookContext) => Promise<void>;
  onAfterAudit?: (ctx: HookContext) => Promise<void>;
  onChapterComplete?: (ctx: HookContext) => Promise<void>;
}
```

验收标准：通知系统通过 hook 机制运行，用户可在 `inkos.json` 中配置自定义 hook。

#### Step 3: MCP Client 集成（3-5 天）

> 参考 AstrBot MCPClient（三种传输 + 自动重连）+ CC Switch 管理 UI。

核心层：
- `packages/core/src/mcp/client.ts` — 支持 stdio 和 SSE 传输
- MCP tool 发现后自动注册到 ToolRegistry，source 标记 `"mcp"`
- Tauri 桌面端可用 `tauri-plugin-mcp-client` 做 stdio 传输

配置：
- `inkos.json` 新增 `mcpServers` 字段（与 Claude Code / CC Switch 格式一致）

UI（参考 CC Switch）：
- MCP Server 管理页面：server 列表 + 连接状态 + tool 列表 + 启停 + 日志

注意事项（AstrBot 踩坑经验）：
- 启动超时设 180s
- 自动重连（session terminated 检测）
- MCP JSON Schema 兼容（`type` 可以是数组）

#### Step 4: MCP Server 暴露（2-3 天）

> InkOS 独有差异化。把记忆系统暴露为 MCP server。

暴露的 tool：
- `inkos.query_facts(subject, chapter?)` — 时序事实查询
- `inkos.query_hooks(status?)` — 伏笔池查询
- `inkos.query_summaries(chapter_range?)` — 章节摘要查询
- `inkos.get_world_state(bookId)` — 当前世界状态快照
- `inkos.search_memory(query, bookId)` — 语义记忆检索（复用 `retrieveMemorySelection`）

应用场景：
- Claude Code 写代码时查 InkOS 世界观
- 羽书（AstrBot）查角色关系回答读者问题
- 其他 agent 框架通过 MCP 接入 InkOS 的叙事知识库

#### Step 5: Plugin 系统（3-5 天）

> 参考 AstrBot Star 系统（manifest + 生命周期），但更轻量。

```
plugins/
  auto-publish/
    manifest.json    # { name, version, tools: [...], hooks: [...] }
    index.ts         # export default class AutoPublish extends InkOSPlugin
```

生命周期：discover → load → initialize → active → terminate
- `PluginManager` 扫描 `plugins/` 目录
- 读 manifest → 动态 import → 注册 tool 和 hook
- 支持热重载（文件变化检测）

UI：Plugin 管理页面（列表 + 启停 + 配置 + 日志）

#### Step 6: Pipeline 可视化（5+ 天，可放 v11）

> 不做 Rivet 通用 DAG 编辑器。做 VoltOps 风格的运行态流程图。

- 左侧：pipeline 阶段列表（plan → compose → write → normalize → settle → audit → revise）
- 每个阶段显示状态（等待/运行中/完成/失败）+ agent 配置 + model
- 右侧：选中阶段的详情（tool 调用日志、token 消耗、耗时）
- 实时更新，复用现有 SSE 基础设施
- 参考 CopilotKit AG-UI 事件流协议做 agent-UI 通信

### P2-13: State Projections 可视化（1-2 天，独立于上述路线）

- 新增 API 端点返回 `current_state.json` / `hooks.json` / `chapter_summaries.json` 结构化数据
- UI 页面：树形/表格展示，支持时间旅行（选择章节查看历史状态）
- 可随时插入，不依赖 ToolRegistry 等基础设施

### 各开源项目借鉴映射

| 项目 | 借鉴内容 | 对应步骤 |
|------|---------|---------|
| AstrBot | MCPClient 三种传输 + 自动重连；Star 插件 manifest + 生命周期 | Step 3, 5 |
| Mastra | `createTool()` + Zod schema 工具注册；MCP 双向集成 | Step 1, 3, 4 |
| VoltAgent | Hooks 生命周期拦截器；VoltOps 运行态流程图 | Step 2, 6 |
| CopilotKit | AG-UI 事件流协议；Shared State；HITL 暂停/恢复 | Step 6 |
| CC Switch | MCP server 管理 UI 交互设计 | Step 3 |
| Rivet | Plugin 注册自定义节点的扩展机制 | Step 5 |

### 总工期估算

| 步骤 | 工期 | 累计 |
|------|------|------|
| Step 1 ToolRegistry | 2-3 天 | 2-3 天 |
| Step 2 Pipeline Hooks | 2 天 | 4-5 天 |
| Step 3 MCP Client | 3-5 天 | 7-10 天 |
| Step 4 MCP Server | 2-3 天 | 9-13 天 |
| Step 5 Plugin 系统 | 3-5 天 | 12-18 天 |
| Step 6 Pipeline 可视化 | 5+ 天 | 17-23 天 |
| P2-13 State 可视化 | 1-2 天 | 随时插入 |

---

## 六、P0/P1 代码验证与修复结果（2026-04-12）

> 逐项对照代码库实际状态，标注 Core / API / UI / 集成 四层完成度。已修复项标注 ✅ 已修复。

### P0 验证

| # | 功能 | Core | API | UI | 集成 | 结论 |
|---|------|------|-----|-----|------|------|
| 1 | AI 检测仪表盘 | ✅ | ✅ | ✅ DetectView.tsx | ✅ 已修复 | **完整闭环** — BookDetail 工具栏已添加 AI 检测导航按钮 |
| 2 | 通知渠道配置页 | ✅ | ✅ | ✅ NotifyConfig.tsx | ✅ | **完整闭环** |
| 3 | 章节元数据展示 | ✅ 已修复 | ✅ | ✅ ChapterMeta.tsx | ✅ 已修复 | **完整闭环** — 前端类型已扩展 7 字段；ChapterMetaPanel 已集成到 BookDetail 章节表；pipeline 已补写 detectionScore/detectionProvider 赋值 |
| 4 | Author Intent / Current Focus 编辑器 | ✅ | ✅ | ✅ IntentEditor.tsx | ✅ | **完整闭环** |

### P1 验证

| # | 功能 | Core | API | UI | 集成 | 结论 |
|---|------|------|-----|-----|------|------|
| 5 | Agent 管理面板 | ✅ | ✅ | ✅ AgentPanel.tsx | ⚠️ | 基本完成 — 仅展示静态元数据和配置，无运行时状态/执行日志查询 API |
| 6 | Scheduler 高级配置 | ✅ | ✅ | ✅ SchedulerConfig.tsx | ✅ | **完整闭环** |
| 7 | AIGC 检测配置 | ✅ | ✅ | ✅ DetectionConfigView.tsx | ✅ | **完整闭环** |
| 8 | 伏笔健康仪表盘 | ✅ | ✅ | ✅ HookDashboard.tsx | ✅ | **完整闭环** |
| 9 | LLM 高级参数暴露 | ✅ | ✅ | ✅ LLMAdvancedConfig.tsx | ✅ 已修复 | **完整闭环** — relay 模式已透传 thinkingBudget/apiFormat/extra/headers |

### 汇总

| 状态 | 数量 | 项目 |
|------|------|------|
| ✅ 完整闭环 | 8 | P0-1/2/3/4、P1-6/7/8/9 |
| ⚠️ 基本完成 | 1 | P1-5 Agent 面板（缺运行时状态，待 P2 ToolRegistry 解决） |

### 修复变更清单

| 修复项 | 改动文件 |
|--------|---------|
| P0-3 前端类型扩展 | `studio/src/storage/adapter.ts`、`studio/src/shared/contracts.ts`、`studio/src/pages/BookDetail.tsx` |
| P0-3 组件集成 | `studio/src/pages/BookDetail.tsx`（import ChapterMetaPanel + 章节行渲染） |
| P0-3 pipeline 赋值 | `core/src/pipeline/chapter-persistence.ts`（新增 detectionScore/detectionProvider 参数和写入） |
| P0-1 导航入口 | `studio/src/pages/BookDetail.tsx`（工具栏 ScanEye AI 检测按钮） |
| P1-9 relay 透传 | `core/src/relay/types.ts`、`core/src/relay/local-relay.ts`、`studio/src/api/routes/ai-relay.ts`、`studio/src/ai/relay-client.ts` |
