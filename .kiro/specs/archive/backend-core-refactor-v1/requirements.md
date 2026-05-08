# Backend Core Refactor v1 Requirements

## Introduction

本 spec 是 frontend-refoundation-v1 之后的后端分阶段整理计划。目标不是为了前端重写先大拆后端，而是在 Backend Contract v1 稳定后，把当前散落在大 route、大 service 和 legacy 透明路径中的能力逐步收敛为合同优先、领域服务清晰、测试可覆盖的后端核心。

本 spec 必须遵守“先合同、再重构”的顺序：前端依赖的合同行为不得被无计划破坏；旧接口如果仍在合同中标为 current/transparent，必须保留真实失败或真实兼容语义，不能用 shim/noop 假成功续命。

---

## Requirement 1：合同优先的后端重构边界

**User Story：** 作为维护者，我需要后端重构不破坏新前端已依赖的能力合同。

### Acceptance Criteria

1. WHEN 重构 route 或 service THEN THE SYSTEM SHALL 先更新或确认 Backend Contract 对应条目。
2. WHEN 某个 API 行为改变 THEN THE SYSTEM SHALL 同步更新共享类型、contract client 测试和 API 文档。
3. WHEN 迁移 legacy route THEN THE SYSTEM SHALL 保留真实错误/transparent 状态，不用 fake shim 冒充成功。
4. WHEN 删除 route THEN THE SYSTEM SHALL 先确认没有 active spec、frontend client 或文档仍声明其为 current。
5. WHEN 重构完成 THEN THE SYSTEM SHALL 通过相关 route 测试、typecheck 和文档验证。

---

## Requirement 2：领域服务与 route adapter 分离

**User Story：** 作为开发者，我希望 route 只负责 HTTP 适配，业务逻辑进入可测试服务，避免 storage.ts 等巨型文件继续膨胀。

### Acceptance Criteria

1. WHEN 新增或迁移能力 THEN THE SYSTEM SHALL 拆分为 domain service、repository/IO adapter、route adapter 和 shared contract。
2. WHEN route 处理请求 THEN THE SYSTEM SHALL 只做参数解析、鉴权/校验、调用 service、返回 envelope。
3. WHEN service 被测试 THEN THE SYSTEM SHALL 可绕过 Hono request 直接验证业务行为。
4. WHEN 文件超过 400 行并继续增长 THEN THE SYSTEM SHALL 优先按领域拆分，而不是继续塞工具函数。
5. WHEN 迁移 `storage.ts` 能力 THEN THE SYSTEM SHALL 按 books、chapters、files、export、cockpit drilldown 等领域分步迁移。

---

## Requirement 3：统一错误、状态与透明降级

**User Story：** 作为前端开发者，我需要后端错误和降级语义稳定，不能同一类失败在不同 route 中格式完全不同。

### Acceptance Criteria

1. WHEN route 返回失败 THEN THE SYSTEM SHALL 尽量使用结构化 error/envelope，保留 `code`、`message`、`capability` 或 `gate`。
2. WHEN provider adapter 失败 THEN THE SYSTEM SHALL 保留 `unsupported`、`auth-missing`、`config-missing`、`upstream-error`、`network-error` 等 code。
3. WHEN 能力未接入 THEN THE SYSTEM SHALL 返回 unsupported/501 或透明 disabled 信息，不返回成功空对象。
4. WHEN 状态是 process-memory THEN THE SYSTEM SHALL 在响应中保留临时语义或文档说明。
5. WHEN route 仍是 legacy THEN THE SYSTEM SHALL 明确 legacy/current/planned 边界。

---

## Requirement 4：Session Runtime 与工具链稳定化

**User Story：** 作为用户，我希望 session chat、工具循环、确认门、恢复和 artifact 在后端重构后保持一致。

### Acceptance Criteria

1. WHEN session runtime 重构 THEN THE SYSTEM SHALL 保持 WebSocket envelope 和 REST snapshot/history 合同不破坏。
2. WHEN agent turn runtime 执行工具 THEN THE SYSTEM SHALL 保持 tool_call/tool_result/confirmation_required/turn_failed 事件语义。
3. WHEN 工具需要确认 THEN THE SYSTEM SHALL 保持 pending confirmation 查询和 confirm API 行为。
4. WHEN 工具执行失败 THEN THE SYSTEM SHALL 继续把失败 tool_result 回灌给模型或返回明确失败，不伪造 assistant 成功回复。
5. WHEN 连接恢复 THEN THE SYSTEM SHALL 保持 ack、cursor、resumeFromSeq 和 resetRequired 语义。

---

## Requirement 5：存储层与 migration 纪律

**User Story：** 作为维护者，我需要文件系统、SQLite、runtime store 和 migrations 的职责明确，避免数据写入路径分裂。

### Acceptance Criteria

1. WHEN 新增 SQLite 表或字段 THEN THE SYSTEM SHALL 遵守存储层开发指引并补充 migration/test。
2. WHEN 文件系统资源写入 THEN THE SYSTEM SHALL 通过领域 service 保持 index 与文件一致。
3. WHEN 删除资源 THEN THE SYSTEM SHALL 明确软删除/硬删除策略和前端确认要求。
4. WHEN 迁移旧文件数据到 SQLite THEN THE SYSTEM SHALL 保留回滚或兼容读取策略，不能静默丢数据。
5. WHEN runtime store 涉及密钥 THEN THE SYSTEM SHALL 继续脱敏返回，不把明文密钥进入 API 响应或仓库。

---

## Requirement 6：观测、测试与文档同步

**User Story：** 作为维护者，我需要每次后端重构都有可验证的行为证据，而不是只看 typecheck。

### Acceptance Criteria

1. WHEN 迁移 route THEN THE SYSTEM SHALL 保留或新增 route 测试覆盖成功、失败和 unsupported。
2. WHEN 迁移 service THEN THE SYSTEM SHALL 新增 service 单测覆盖核心业务逻辑。
3. WHEN 变更用户可见 API THEN THE SYSTEM SHALL 更新 `docs/06-API与数据契约/` 和 CHANGELOG。
4. WHEN 变更存储或构建流程 THEN THE SYSTEM SHALL 更新 README、开发指南和相关 steering。
5. WHEN 声称完成 THEN THE SYSTEM SHALL 运行相关测试、typecheck 和必要 docs verify。

---

## Non-goals

1. 不在 frontend-refoundation-v1 之前大规模破坏后端 route。
2. 不为了统一 envelope 一次性重写所有 API。
3. 不新增 mock route、fake provider、noop adapter 或空实现。
4. 不把 process-memory/transparent legacy 描述成长期稳定能力。
5. 不迁移或删除数据前跳过读取、备份、验证和文档更新。
