# 04 - 架构与设计

NovelFork Studio 系统架构文档。

## 三层架构

```
┌─────────────────────────────────────────────┐
│            novel-plugin (小说领域)            │
│  engine/ routes/ handlers/ pages/            │
├─────────────────────────────────────────────┤
│            studio (通用工作台)                │
│  app-next/ api/ agent-runtime/               │
├─────────────────────────────────────────────┤
│            core (基础设施)                    │
│  storage/ llm/ state/ models/                │
└─────────────────────────────────────────────┘
```

| 包 | 职责 | 边界 |
|----|------|------|
| `packages/core` | 存储、LLM 客户端、状态机、数据模型 | 无领域代码 |
| `packages/studio` | Agent 运行时、HTTP/WS 服务、前端外壳 | 无小说代码 |
| `packages/novel-plugin` | 写作引擎、经纬、路由、工作台 UI | 小说专属 |

## Agent Runtime 模块树

```
agent-runtime/
├── session-chat-service.ts      (2846行) — WebSocket 传输 + 编排
├── agent-turn-runtime.ts        (1107行) — 回合循环引擎
├── session-tool-executor.ts     (4857行) — 90-case 工具分发
├── permission-pipeline.ts       — 工具权限校验
├── yolo-mode.ts                 — YOLO 决策 + 安全反思
├── session-tool-policy.ts       — 工具策略（denied/permission/dirty）
├── session-tool-registry.ts     — 工具注册表
├── tool-schemas.ts              — 工具 JSON Schema 定义
├── turn-profiler.ts             — 回合性能分析
├── context-manager.ts           — 上下文压缩管理
├── compact-service.ts           — 对话压缩服务
├── system-prompt-builder.ts     — 系统提示词组装
├── harness-loader.ts            — Harness 模块加载
├── provider-router.ts           — 模型路由
└── streaming-handler.ts         — SSE/WS 流式处理
```

## 运行时三角

每次 AI 对话的执行中枢：

```
session-chat-service.ts
│  WebSocket 传输 + 运行时状态 + 编排回合 + 持久化 + 广播
│
└─→ agent-turn-runtime.ts
    │  回合循环：generate → tool_use → tool_result → repeat
    │  附加：appendSystemPrompt / budget pressure / file dedup / 对抗审查
    │
    └─→ session-tool-executor.ts
        入口校验 → policy 解析 → YOLO 决策 → handler 执行
```

## Provider 适配器

| 适配器 | 协议 | 用途 |
|--------|------|------|
| AnthropicAdapter | Anthropic Messages API | Claude 系列模型原生 |
| CompletionsAdapter | OpenAI Chat Completions | DeepSeek / GPT / 兼容端点 |
| CodexAdapter | Codex CLI 协议 | 本地 Codex 实例 |
| ClaudeCodeAdapter | Claude Code 协议 | Claude Code 集成 |

适配器统一实现 `LLMClient` 接口（`core/src/llm/provider.ts`）：
- `chatCompletion()` — 非流式
- `chatWithTools()` — 带工具调用
- `streamChat()` — 流式输出

## 数据流

```
用户输入
  │
  ▼
浏览器 (React 19)
  │ WebSocket
  ▼
Hono Server (session-chat-service)
  │
  ▼
agent-turn-runtime
  │ chatWithTools()
  ▼
LLM Provider ←→ 外部 API
  │
  ▼
tool_use 响应
  │
  ▼
session-tool-executor (分发到具体 handler)
  │
  ▼
tool_result → 追加到消息 → 继续循环
  │
  ▼
assistant 最终响应 → WebSocket → 前端渲染
```

## 上下文管理（4 层渐进压缩）

| 层级 | 机制 | 触发条件 |
|------|------|----------|
| L1 Snip | 移除早期工具结果细节 | token > 60% budget |
| L2 Compact | AI 生成对话摘要替换原文 | token > 75% budget |
| L3 Summary | 深度压缩为结构化摘要 | token > 85% budget |
| L4 Archive | 归档到 SQLite，仅保留最近 N 轮 | token > 95% budget |

上下文管理器实时监控 token 用量，自动触发压缩。

## 安全层架构

5 层纵深防护：

```
Layer 1: 子命令拆分（Subcommand Splitting）
  → 将复合命令拆为原子命令逐一检查
  
Layer 2: 引号感知状态机（Quote-Aware Parser）
  → 正确处理引号内的特殊字符，防止注入

Layer 3: 路径沙箱（Path Sandbox）
  → 限制文件操作在项目目录内

Layer 4: 密钥检测（Secret Detector）
  → 阻止 .env / credentials / token 文件操作

Layer 5: YOLO 安全反思（Safety Reflection）
  → 高风险操作前 LLM 自我审查
```

## 存储层

基于 `bun:sqlite`，位于 `core/src/storage/`：

| 组件 | 职责 |
|------|------|
| `db.ts` | 连接管理 + WAL 模式 |
| `schema.ts` | 表定义 |
| `migrations-runner.ts` | 版本迁移执行 |
| `embedded-migrations/` | 内嵌迁移脚本（编译进 exe） |

关键数据表：sessions、messages、books、chapters、candidates、jingwei_entries、settings
