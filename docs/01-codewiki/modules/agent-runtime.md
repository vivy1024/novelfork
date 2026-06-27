**版本**: v3.0.0
**创建日期**: 2026-06-26
**更新日期**: 2026-06-26
**状态**: current
**文档类型**: current

# Agent Runtime

## 职责

通用 Agent 会话运行时，负责 WebSocket 对话、模型调用、工具执行、权限、状态广播和持久化。

## 真实代码路径

- `packages/studio/src/api/lib/session-chat-service.ts`
- `packages/studio/src/api/lib/agent-turn-runtime.ts`
- `packages/studio/src/api/lib/session-tool-executor.ts`
- `packages/studio/src/api/lib/session-tool-registry.ts`
- `packages/studio/src/api/lib/permission-pipeline.ts`
- `packages/studio/src/api/routes/session.ts`

## 主要入口

- `session-chat-service`：会话编排与 WebSocket envelope。
- `agent-turn-runtime`：模型回合、工具调用循环、上下文预算。
- `session-tool-executor`：工具分发和安全策略。
- `session-tool-registry`：工具定义注册。

## 当前候选/草稿清理事实

- `candidate.create_chapter` 不再由 executor 作为 Novel service handler 暴露。
- `style.import` 返回 preset suggestion，不自动写 style 文件。
- `lore.read/write` 与 `memory.read/graph/events` 分别进入静态/动态边界。

## 维护规则

1. 小说域工具只通过 novel-plugin 暴露领域语义。
2. executor 不应复活候选稿/草稿主入口。
3. 高风险工具按 permission pipeline 处理。
