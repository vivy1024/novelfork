# Provider 协议适配器 v2 — 任务清单

## 步骤 1：类型 + 迁移

- [ ] 1.1 `shared/provider-catalog.ts` 新增 `ProviderProtocol` 类型
- [ ] 1.2 `Provider` 接口加 `protocol` 字段（可选，兼容旧数据）
- [ ] 1.3 `provider-runtime-store.ts` 读取时自动推断 protocol（inferProtocol）
- [ ] 1.4 保存时写入 protocol 字段

## 步骤 2：URL 拼接工具

- [ ] 2.1 新建 `api/lib/provider-adapters/url-resolver.ts`
- [ ] 2.2 `resolveEndpoint(baseUrl, path, options)` — 智能拼接
- [ ] 2.3 `resolveModelsEndpoint(baseUrl)` — 模型列表 URL
- [ ] 2.4 单元测试

## 步骤 3：拆分 CompletionsAdapter

- [ ] 3.1 新建 `api/lib/provider-adapters/completions.ts`
- [ ] 3.2 从 OpenAiCompatibleAdapter 提取 listModels / testModel / generate
- [ ] 3.3 保留 reasoning_content 保存/回传逻辑
- [ ] 3.4 使用 url-resolver

## 步骤 4：拆分 AnthropicAdapter

- [ ] 4.1 新建 `api/lib/provider-adapters/anthropic.ts`
- [ ] 4.2 从 AnthropicCompatibleAdapter 提取
- [ ] 4.3 保留 thinking block 保存/回传
- [ ] 4.4 智能 URL 拼接（/v1/messages 或 /messages）
- [ ] 4.5 模型列表：尝试 /v1/models 和 /models，失败返回空（不报错）

## 步骤 5：新建 ResponsesAdapter

- [ ] 5.1 新建 `api/lib/provider-adapters/responses.ts`
- [ ] 5.2 从 sendResponsesRequest / consumeResponsesStream 提取
- [ ] 5.3 完整 streaming 支持
- [ ] 5.4 reasoning item 解析

## 步骤 6：新建 CodexAdapter

- [ ] 6.1 新建 `api/lib/provider-adapters/codex.ts`
- [ ] 6.2 继承 CompletionsAdapter，加 reasoning_effort + service_tier
- [ ] 6.3 请求 body 加 reasoning_effort 参数
- [ ] 6.4 Fast Mode: service_tier: "priority"

## 步骤 7：新建 ClaudeCodeAdapter

- [ ] 7.1 新建 `api/lib/provider-adapters/claude-code.ts`
- [ ] 7.2 继承 AnthropicAdapter，加 beta headers
- [ ] 7.3 anthropic-beta: prompt-caching-2024-07-31
- [ ] 7.4 extended thinking 完整支持

## 步骤 8：Adapter 注册表

- [ ] 8.1 新建 `api/lib/provider-adapters/registry.ts`
- [ ] 8.2 `getAdapterForProtocol(protocol: ProviderProtocol): RuntimeAdapter`
- [ ] 8.3 替换现有 `ProviderAdapterRegistry`
- [ ] 8.4 `adapterIdForProvider` 改为读 protocol 字段

## 步骤 9：前端 — 协议选择 Modal

- [ ] 9.1 新建 `ProtocolSelectModal` 组件
- [ ] 9.2 5 种协议卡片（名称 + badge + 说明）
- [ ] 9.3 选择后创建 provider 并进入详情页
- [ ] 9.4 替换现有"+ 添加供应商"按钮行为

## 步骤 10：前端 — 详情页协议切换

- [ ] 10.1 供应商详情页加协议分段选择器（5 选 1）
- [ ] 10.2 切换时保留 name/prefix/key/url，更新 protocol
- [ ] 10.3 切换后自动重新获取模型列表
- [ ] 10.4 每种协议下方显示对应说明文字
