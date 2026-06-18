# 系统架构

NovelFork v1.11.0 采用三层架构，以插件化方式将小说领域逻辑与通用 Agent 工作台解耦。

## 三层设计

```
┌─────────────────────────────────────────────────┐
│  novel-plugin（小说领域逻辑）                      │
│  engine / routes / handlers / pages              │
├─────────────────────────────────────────────────┤
│  studio（Agent Runtime + Web UI + HTTP API）      │
│  agent-turn-runtime / session-chat-service /     │
│  provider-adapters / api routes / React 19 UI    │
├─────────────────────────────────────────────────┤
│  core（通用基础设施）                              │
│  storage / llm / state / hooks / mcp / plugins   │
└─────────────────────────────────────────────────┘
```

### core（`packages/core/`）

通用基础设施层，不含任何领域逻辑：

- **storage** — SQLite 存储引擎（`db.ts`、`schema.ts`、`migrations-runner.ts`、`embedded-migrations.ts`）
- **llm** — LLM 客户端抽象（`provider.ts`：`chatCompletion` / `chatWithTools`）
- **state** — 运行时状态管理（`manager.ts`、`state-reducer.ts`、`runtime-state-store.ts`、`memory-db.ts`、`lorebook-retriever.ts`、`bloat-guardian.ts`）
- **hooks** — 生命周期钩子系统（`hook-manager.ts`、`builtin-hooks.ts`）
- **mcp** — Model Context Protocol 客户端（SSE / stdio 两种传输）
- **plugins** — 插件注册与生命周期（`plugin-manager.ts`）
- **relay** — 本地中继通信
- **registry** — 命令/工具注册表
- **notify** — 通知分发（飞书/Telegram/企业微信/Webhook）

### studio（`packages/studio/`）

Agent Runtime 与 Web UI 层：

- **api/lib/** — Agent Runtime 核心模块（详见 [agent-runtime.md](./agent-runtime.md)）
- **api/routes/** — HTTP/WebSocket 路由（session、storage、providers、mcp、git 等）
- **app-next/** — React 19 前端（AgentShell、对话界面、设置、仪表盘）
- **shared/** — 前后端共享类型

### novel-plugin（`packages/novel-plugin/`）

小说领域插件，所有小说相关逻辑仅在此包中：

- **engine/agents/** — 写作 Agent（Writer、Continuity、Reviser、Architect 等）
- **engine/jingwei/** — 经纬设定管理系统（16 分类、分层注入、PGI 追问）
- **engine/pipeline/** — 写作管线编排
- **engine/tools/** — 写作工具集（分析/弧线/伏笔/POV/节奏/健康等）
- **routes/** — 小说 API 路由
- **handlers/** — 管线执行服务
- **pages/** — 写作工作台 UI 组件

## Agent Runtime 模块全景

`packages/studio/src/api/lib/` 下的 Agent Runtime 是系统的执行中枢：

| 模块 | 文件 | 职责 |
|------|------|------|
| **Turn Loop** | `agent-turn-runtime.ts` | for(;;) 循环：generate → tool_use → execute → loop；max_output 恢复；模型 fallback；budget pressure；blocking limit |
| **Security** | `security/secret-detector.ts`、`security/path-sandbox.ts` | 工具输出密钥检测、文件操作路径沙箱、DANGEROUS_PATTERNS bash 拦截 |
| **Memory** | `turn-memory-extractor.ts` | 规则式抽取决策/踩坑/发现，零 LLM 成本写入 context.md |
| **Performance** | `content-replacement.ts`、`streaming-tool-executor.ts`、`compact/tool-output-pruner.ts` | 大结果引用化、流式工具执行、工具输出裁剪 |
| **Context** | `compact/micro-compact.ts`、`compact/full-compact.ts`、`context-compaction.ts` | 微压缩（折叠旧 tool_result）、全量压缩、上下文溢出紧急截断 |
| **Multi-Agent** | `coordinator-prompt.ts`、`peer-messaging.ts`、`subagent-runtime.ts` | 协调者提示词构建、子代理间消息传递 |
| **DX** | `prompt-dump.ts`、`turn-profiler.ts`、`skill-activation.ts` | 提示词导出调试、回合性能分析、技能激活识别 |
| **LLM Service** | `llm-runtime-service.ts` | Provider 路由 + 重试 + 聚合模型解析 |
| **Tool Execution** | `session-tool-executor.ts` | 90-case 工具分发中枢 |
| **Permission** | `permission-pipeline.ts`、`yolo-mode.ts`、`session-tool-policy.ts` | 权限校验、自动批准/安全反思/询问用户 |

## Provider 适配器

`packages/studio/src/api/lib/provider-adapters/`：

| 适配器 | 文件 | 协议 |
|--------|------|------|
| Anthropic | `anthropic.ts` | Anthropic Messages API（原生） |
| Completions | `completions.ts` | OpenAI-compatible Chat Completions（DeepSeek / GPT / 任意兼容端点） |
| Responses | `responses.ts` | OpenAI Responses API |
| Codex | `codex.ts` | Codex CLI 协议 |
| Claude Code | `claude-code.ts` | Claude Code 协议 |

适配器注册在 `registry.ts`，通过 `inferProtocol()` 根据 provider 配置自动路由。

## 数据流

```
用户消息
  → WebSocket (ws://localhost:PORT/ws/session/:id)
  → session-chat-service.ts（状态管理 + 持久化 + 广播）
    → agent-turn-runtime.ts（Turn Loop 编排）
      → llm-runtime-service.ts（provider 路由 + 重试 + fallback）
        → provider-adapters/（协议转换）
          → 外部 API（Anthropic / DeepSeek / OpenAI / ...）
```

返回路径通过 WebSocket 流式推送 `streaming_chunk`、`tool_call`、`tool_result`、`turn_completed` 事件。
