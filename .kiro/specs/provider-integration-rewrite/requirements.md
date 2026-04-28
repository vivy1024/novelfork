# Provider Integration Rewrite Requirements

> Superseded: 此 spec 只完成了 UI 骨架与内存 prototype，不能作为真实 Provider/平台集成功能的验收依据。真实修复以 `.kiro/specs/real-provider-model-runtime/` 为准。

## 背景

当前 NovelFork Studio 的“AI 供应商”页面仍然把两类完全不同的对象混成一个 Provider：

1. **平台集成**：Codex / Kiro 等平台账号导入与账号管理。
2. **API key 接入**：OpenAI-compatible / Anthropic-compatible 等 Base URL + API Key 接入。

NarraFork 的设计明确区分这两类能力。平台集成的核心是导入平台账号 JSON 数据，并在账号表中管理账号、凭据状态、配额、切号与后续调用链路；API key 接入才是 Base URL、API Key、兼容格式、模型刷新与测试。

## 已学习来源

### NarraFork `/settings/providers`

- “平台集成”卡片：Codex / Kiro / Cline 等平台能力入口，卡片展示平台名、平台 badge、启用 switch、模型/账号摘要。
- Codex / Kiro 平台集成通过导入 JSON 账号数据建立平台账号，而不是填写 Base URL / API Key provider 表单。
- “API key 接入”卡片：展示具体 provider、API 模式、兼容格式、模型摘要、启用 switch。

### cockpit-tools 本地源码

路径：`D:\DESKTOP\novelfork\cockpit-tools\cockpit-tools-main\src`

重点文件：

- `types/codex.ts`
  - `CodexAccount` 包含：`auth_mode`、`account_id`、`account_name`、`quota`、`quota_error`、`tags`、`created_at`、`last_used`。
  - `CodexQuota` 包含 5 小时与每周窗口：`hourly_percentage`、`weekly_percentage`、reset time。
- `stores/useCodexAccountStore.ts`
  - 账号操作：`fetchAccounts`、`switchAccount`、`deleteAccount`、`refreshQuota`、`importFromLocal`、`importFromJson`。
- `services/codexService.ts`
  - Codex 账号导入方式包含本机 auth.json、JSON 文件、OAuth、Token。
  - 支持切号、删除、刷新配额、刷新账号资料。
- `components/codex/CodexModelProviderManager.tsx`
  - 这是 API key/model provider 管理，不是平台账号管理。
  - 数据结构：`CodexModelProvider { id, name, baseUrl, website, apiKeyUrl, apiKeys[] }`。

## Requirement 1：平台集成必须是 JSON 账号导入与账号管理，不是 API Key Provider

**User Story:** 作为用户，我在平台集成中导入 Codex/Kiro 平台账号 JSON，并管理这些平台账号，而不是填写 Base URL 和 API Key。

### Acceptance Criteria

1. 平台集成详情页不得出现 API Key / Base URL 输入表单。
2. Codex / Kiro 平台详情页必须提供 JSON 账号导入入口。
3. 平台集成详情页必须包含账号列表区域。
4. 未实现的切号、刷新配额、删除账号等操作必须 disabled，并明确标注“后续接入”，不能伪装可用。
5. 平台集成账号模型必须能表达：账号名/email、账号 ID、认证方式、套餐、状态、当前账号、配额、最后使用时间。

## Requirement 2：平台账号数据必须来自真实导入或真实 API

**User Story:** 作为用户，我导入 JSON 账号数据后，应能在平台账号表中看到该账号；未导入时不应出现伪造账号。

### Acceptance Criteria

1. `GET /api/platform-integrations/:platformId/accounts` 在未导入时返回空数组。
2. `POST /api/platform-integrations/:platformId/accounts/import-json` 支持 Codex / Kiro JSON 账号导入。
3. JSON 导入返回的账号状态必须来自解析结果和导入状态，不得伪造配额成功。
4. 不支持 JSON 导入的平台必须返回明确错误或显示“后续接入”。
5. 账号表空态必须提示“导入 JSON 账号数据后显示真实账号”。

## Requirement 3：API key 接入只处理 Base URL/API Key/模型

**User Story:** 作为用户，我在 API key 接入里添加 OpenAI-compatible 或 Anthropic-compatible 服务，并管理模型。

### Acceptance Criteria

1. API key 接入详情页必须显示 Base URL、API Key（password 或脱敏）、兼容格式、API 模式。
2. API key 接入详情页必须包含模型刷新、模型测试、上下文长度编辑、启用/禁用。
3. API key 接入不得展示平台账号、配额窗口、切号、JSON 账号导入等平台字段。
4. 添加供应商表单只出现在 API key 接入区域。
5. API key 接入可以参考 cockpit-tools `CodexModelProviderManager` 的 provider preset 设计，但不得混入平台账号管理。

## Requirement 4：页面信息架构对齐 NarraFork

**User Story:** 作为用户，我可以一眼区分平台集成和 API key 接入，不会被混合表单误导。

### Acceptance Criteria

1. 列表页分为两个明确 section：平台集成、API key 接入。
2. 平台集成卡片显示：平台名、平台 badge、启用 switch、账号数、模型数、导入能力状态。
3. API key 接入卡片显示：provider 名、apiMode badge、compatibility badge、模型标签、启用 switch。
4. 点击平台卡片进入平台详情；点击 API provider 卡片进入 API provider 详情。
5. 两个详情页 UI 不复用同一个详情组件。

## Requirement 5：不引入假成功与假数据

**User Story:** 作为用户，我宁愿看到“尚未接入后端”，也不要看到伪造的账号、配额或成功状态。

### Acceptance Criteria

1. 平台集成平台 catalog 可以是静态能力目录（Codex/Kiro/Cline），但账号列表不能伪造。
2. 没有真实导入或真实后端数据时，账号列表显示空态。
3. 所有未来功能按钮必须 disabled。
4. UI 文案必须明确区分“JSON 账号导入已接入”和“切号/配额刷新等后续接入”。
