# Implementation Plan

## Overview

把当前真实后端能力整理为新前端唯一可依赖的合同层，并建立 contract client、状态映射与验证，阻止新前端继续接入 mock/fake/noop 能力。

## Tasks

- [x] 1. 固化 MVP 能力矩阵
  - 逐项核对 `packages/studio/src/api/routes/`、`packages/studio/src/api/lib/session-tool-registry.ts`、`packages/studio/src/shared/*` 与 `docs/06-API与数据契约/02-创作工作台接口.md`。
  - 输出能力、入口、状态、数据来源、失败边界和前端规则表。
  - 验证：矩阵中每个 `current` 能力都能反查真实 route/tool。

- [x] 2. 建立 capability status 类型与 UI 决策表
  - 新增或整理 `app-next/backend-contract/capability-status.ts`。
  - 定义 `current`、`process-memory`、`prompt-preview`、`chunked-buffer`、`unsupported`、`planned` 的前端行为。
  - 验证：单测覆盖 disabled、readonly、preview-only、error-visible 等决策。

- [x] 3. 建立 typed contract client 基础层
  - 新增 `app-next/backend-contract/contract-client.ts`，统一 fetch、错误 envelope、JSON 解析和 capability metadata。
  - 不吞掉后端原始 `error`、`code`、`gate`、`streamSource`、`null` 指标、`unknown` metric 等字段。
  - 验证：mock fetch 单测覆盖 2xx、4xx、5xx、非法 JSON、network error。

- [x] 4. 拆分核心领域 client
  - 新增 `session-client.ts`、`resource-client.ts`、`provider-client.ts`、`writing-action-client.ts`。
  - 复用 `shared/contracts.ts`、`shared/session-types.ts`、`shared/agent-native-workspace.ts`。
  - 验证：类型检查确保组件不需要重新声明核心响应类型。

- [x] 5. 建立 session WebSocket envelope helper
  - 封装 `/api/sessions/:id/chat` URL、`resumeFromSeq`、`session:message`、`session:ack`、`session:abort` 和 server envelope 解析。
  - 保留 `session:error`、`session:stream`、`session:snapshot`、`session:state` 的原始语义。
  - 验证：单测覆盖 snapshot hydration、stream chunk、abort、replay resetRequired。

- [x] 6. 建立资源树 contract adapter
  - 用 contract client 组装 books、chapters、candidates、drafts、story/truth files、jingwei 和 narrative line 的资源节点。
  - 每个资源节点带 capability：read/edit/delete/apply/unsupported。
  - 验证：单测覆盖章节、候选稿、草稿、只读文件、unsupported 资源。

- [x] 7. 建立写作动作 contract adapter
  - 明确 session-native 工具链、异步 `write-next`、AI draft、writing modes、hooks、审校/检测的差异。
  - 所有 AI 输出默认 candidate/draft/preview，正式正文写入必须显式确认。
  - 验证：单测覆盖 prompt-preview 不写正文、candidate artifact、unsupported-tools、gate 409。

- [x] 8. 更新前端使用约束与文档索引
  - 更新 `.kiro/specs/README.md`、相关 API 文档入口和 CHANGELOG。
  - 明确新前端不得在组件内散写未登记 API。
  - 验证：全仓搜索旧 active spec 和 mock/fake 口径，必要处同步。

- [x] 9. 验证合同层
  - 运行相关 Vitest、`pnpm --dir packages/studio typecheck`。
  - 文档改动运行 `pnpm docs:verify`。
  - 输出未验证项清单，不把未运行命令写成已通过。
