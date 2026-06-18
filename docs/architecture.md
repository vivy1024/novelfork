# 系统架构

NovelFork v1.11.2 采用三层架构，以插件化方式将小说领域逻辑与通用 Agent 工作台解耦。

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
- **handlers/** — HTTP handler + 工具执行逻辑
- **routes/** — 小说域 HTTP 路由（ai/bible/jingwei/writing-modes/writing-tools 等）
- **pages/** — 写作工作台 React 页面（38 组件）

## Agent Runtime 模块清单

Runtime 是 studio 的核心——每次 AI 对话的执行中枢。所有模块位于 `packages/studio/src/api/lib/`。

```
Agent Runtime 模块清单：
├── 核心循环
│   └── agent-turn-runtime.ts — Turn Loop + max_output recovery + model fallback
│       + budget pressure + loop detection + error file hint
├── 安全层
│   ├── security/secret-detector.ts — 20+ 模式 API key 脱敏
│   ├── security/path-sandbox.ts — 路径越界防护（sep-aware）
│   ├── permission-pipeline.ts — 子命令拆分 + 引号感知分类 + 危险模式
│   │   + 用户 allow/block list（deny > ask > allow 优先级）
│   ├── yolo-mode.ts — YOLO 自动批准 + safety reflection
│   └── destructive-command-warning.ts — 14 条人类可读风险说明
├── 上下文管理
│   ├── context-compaction.ts — 阈值检测 + auto compact 触发（双档：标准/大窗口）
│   ├── session-compact-service.ts — 结构化 9 段摘要 + cascade compact
│   ├── compact/micro-compact.ts — 工具结果折叠
│   ├── compact/tool-output-pruner.ts — >8K 截断
│   ├── compact/cascade-compact.ts — 超长上下文分段摘要
│   ├── content-replacement.ts — 大文本引用替代
│   └── agent-turn-runtime 内置:
│       60% 轻度折叠 / 85% 激进折叠 / 97% 阻断 / 413 reactive
├── 记忆
│   ├── turn-memory-extractor.ts — 规则式决策/教训/发现提取
│   └── session-chat-service.ts 内置: context.md 自动更新
├── 性能
│   ├── streaming-tool-executor.ts — 并发安全执行器（CONCURRENT_SAFE_TOOLS 13 工具）
│   ├── command-semantics.ts — 退出码正确解释（grep/diff/test/git）
│   └── PARALLEL_SAFE_TOOLS (18 工具并行集，内联于 turn loop)
├── 多 Agent
│   ├── subagent-runtime.ts — 子代理生命周期管理
│   ├── coordinator-prompt.ts — 协调指令注入
│   └── peer-messaging.ts — subagent 间消息总线
├── DX / 调试
│   ├── prompt-dump.ts — 完整 LLM 请求体转储（环境变量 or 设置页开关）
│   ├── turn-profiler.ts — 每轮计时打点
│   ├── skill-activation.ts — 按项目类型条件激活工具
│   ├── logger.ts — 结构化日志
│   └── runtime-log-sink.ts — 日志持久化
├── 健康监控
│   └── turn-health-monitor.ts — 循环检测 + token 消耗警告 + 连续失败检测
└── 工具智能
    ├── Loop detection — 模式重复(last6序列匹配) + 签名重复(3次同参调用)
    ├── Error file auto-injection — Bash 失败时自动提取文件路径提示
    └── Budget pressure 三级 — 70% 信息 / 80% 软提示 / 92% 紧急 + 97% blocking
```

## 运行时三角

每次 AI 对话的三个核心服务协作：

```
session-chat-service.ts — WebSocket 传输 + 运行时状态 + 编排回合 + 持久化
  └→ agent-turn-runtime.ts — 回合循环：generate → tool_use → tool_result → 重复
      └→ session-tool-executor.ts — 工具分发中枢
           入口校验 → policy 解析 → YOLO 决策 → handler 执行
```

## 工具注册

工具定义在两处注册：

1. **通用工具** — `studio/src/api/lib/session-tool-registry.ts`（Bash、Read、Write、Edit、Glob、Grep、Browser、Agent、CtxInspect、Sleep、TaskGet、TaskStop 等）
2. **小说工具** — `novel-plugin/src/handlers/tool-registry.ts`（cockpit.snapshot、jingwei.read/write、pipeline.write、scene.spec、pgi.ask 等）

插件工具通过 `registerPluginTools()` 动态注入，与内置工具合并后统一提供给模型。

## 前端架构

- **通用框架** — `studio/src/app-next/`：AgentShell 外壳、agent-conversation 对话区、settings 设置面板、routines 页（Rules File 编辑器 + MCP 管理）
- **小说工作台** — `novel-plugin/src/pages/writing-workbench/`（38 组件）

## HTTP 路由

- **小说域** — `novel-plugin/src/routes/`：ai、bible、jingwei、writing-modes、writing-tools、writing-resource、pipeline、compliance、filter、context-manager
- **通用域** — `studio/src/api/routes/`：session、storage、chapter-candidates、providers、mcp、git、worktree、terminals、routines、presets、settings、admin
