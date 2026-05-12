# Provider 协议适配器 v2 — 需求文档

## 背景

NovelFork 当前只有 2 个 adapter（openai-compatible / anthropic-compatible），靠 `apiMode` 字段做有限分流。NarraFork 有 5 种明确的协议类型，每种协议知道怎么拼 URL、怎么认证、怎么获取模型列表、怎么发请求。

当前问题：
- 小米等第三方 Anthropic 兼容 provider 无法刷新模型（URL 拼接错误）
- Responses 模式没有 streaming 支持（刚加了基础版但未实测）
- Codex adapter 没有传 reasoning_effort 参数
- 没有协议类型选择 UI（用户不知道该选什么）
- 兼容格式和 API 模式混为一谈（compatibility vs apiMode 语义不清）

## 目标

1. 拆分为 5 个独立 adapter，每个 adapter 完整负责一种协议的全部行为
2. 创建供应商时先选协议类型（对标 NarraFork 的 Modal）
3. 每种协议有明确的 URL 拼接规则、认证方式、模型列表获取方式
4. 消除 compatibility + apiMode 的混乱，统一为 `protocol` 字段

## 5 种协议

| 协议 | 端点 | 认证 | 模型列表 | 请求格式 | 适用场景 |
|------|------|------|----------|----------|----------|
| **completions** | /v1/chat/completions | Bearer token | GET /v1/models | OpenAI Chat Completions | DeepSeek、国产模型、老 GPT、Ollama |
| **responses** | /v1/responses | Bearer token | GET /v1/models | OpenAI Responses API | GPT-4o+、GPT-5 系列 |
| **anthropic** | /v1/messages | x-api-key + anthropic-version | GET /v1/models (可选) | Anthropic Messages | Claude 官方/兼容网关 |
| **codex** | /v1/chat/completions | Bearer token + Codex headers | GET /v1/models | Chat Completions + reasoning_effort + service_tier | Codex 反代、GPT-5.x |
| **claude-code** | /v1/messages | x-api-key + beta headers | GET /v1/models | Anthropic Messages + prompt caching + server continuations | Claude 官方 API（完整特性） |

## 用户故事

- 作为用户，我添加供应商时能从 5 种协议中选择，每种有清晰的说明
- 作为用户，选择"Anthropic 兼容"后，系统自动用 x-api-key 认证，自动尝试 /v1/models 和 /models
- 作为用户，选择"Responses 兼容"后，对话走 /v1/responses，支持 streaming
- 作为用户，选择"Codex 中转"后，请求自动带 reasoning_effort 参数
- 作为用户，我不需要理解 compatibility 和 apiMode 的区别

## 非目标

- 不实现 Kiro 平台集成（保持 UnsupportedAdapter）
- 不实现 NKP/NUG 协议
- 不实现 Codex 多账号/额度管理
- 不实现 WebSocket 模式

## 约束

- 向后兼容：现有 provider 配置（compatibility + apiMode）自动映射到新 protocol 字段
- 不破坏现有对话流程
- 现有测试不回归
