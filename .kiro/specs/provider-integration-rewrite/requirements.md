# Provider Integration Rewrite Requirements

## 背景

当前 NovelFork Studio 的“AI 供应商”页面仍然把两类完全不同的对象混成一个 Provider：

1. **平台集成**：Codex / Kiro / Cline / Antigravity 等平台账号反代与账号管理。
2. **API key 接入**：OpenAI-compatible / Anthropic-compatible 等 Base URL + API Key 接入。

NarraFork 与 cockpit-tools 的设计都明确区分这两类能力。平台集成是账号/凭据/配额/切号/本地反代服务管理；API key 接入才是 Base URL、API Key、兼容格式、模型刷新与测试。

## 已学习来源

### NarraFork `/settings/providers`

- “平台集成”卡片：Codex / Kiro / Cline 等平台能力入口，卡片展示平台名、平台 badge、启用 switch、模型/账号摘要。
- 点击平台集成后，详情以账号/凭据管理为核心，而不是 API Key 表单。
- “API key 接入”卡片：展示具体 provider、API 模式、兼容格式、模型摘要、启用 switch。

### cockpit-tools 本地源码

路径：`D:\DESKTOP\novelfork\cockpit-tools\cockpit-tools-main\src`

重点文件：

- `types/codex.ts`
  - `CodexAccount` 包含：`auth_mode`、`openai_api_key`、`api_base_url`、`api_provider_mode`、`account_id`、`account_name`、`quota`、`quota_error`、`tags`、`created_at`、`last_used`。
  - `CodexQuota` 包含 5 小时与每周窗口：`hourly_percentage`、`weekly_percentage`、reset time。
- `stores/useCodexAccountStore.ts`
  - 账号操作：`fetchAccounts`、`switchAccount`、`deleteAccount`、`refreshQuota`、`importFromLocal`、`importFromJson`、`updateApiKeyCredentials`。
- `services/codexService.ts`
  - Codex 账号导入方式：本机 auth.json、JSON 文件、OAuth、Token、API Key。
  - 支持切号、删除、刷新配额、刷新账号资料。
- `components/CodexLocalAccessModal.tsx`
  - 本地 API 服务（反代）管理：Base URL、API Key、端口、启停、轮询策略、账号集合、统计窗口、复制字段、测试延迟。
- `components/codex/CodexModelProviderManager.tsx`
  - 这是 API key/model provider 管理，不是平台账号管理。
  - 数据结构：`CodexModelProvider { id, name, baseUrl, website, apiKeyUrl, apiKeys[] }`。
- `utils/codexProviderPresets.ts`
  - API provider 预设：OpenAI Official、Azure OpenAI、PackyCode、OpenRouter、DeepSeek、Moonshot 等。

## Requirement 1：平台集成必须是账号/凭据管理，不是 API Key Provider

**User Story:** 作为用户，我在平台集成中管理 Codex/Kiro/Cline 等平台账号，而不是填写 Base URL 和 API Key。

### Acceptance Criteria

1. 平台集成详情页不得出现 API Key / Base URL 输入表单。
2. 平台集成详情页必须包含账号/凭据列表区域。
3. 平台集成详情页必须展示导入入口：本机导入、OAuth/浏览器添加、Token/JSON 导入、API Key 账号（仅 Codex 可选）。
4. 未实现的导入方式必须 disabled，并明确标注“后续接入”，不能伪装可用。
5. 平台集成账号模型必须能表达：账号名/email、账号 ID、认证方式、套餐、状态、当前账号、配额、最后使用时间。

## Requirement 2：平台反代/API 服务是平台集成的一部分

**User Story:** 作为用户，我需要看到平台账号集合是否已启用本地反代服务，以及服务地址、API Key、运行状态和统计。

### Acceptance Criteria

1. Codex 平台详情页必须有“本地 API 服务”分区。
2. 该分区展示服务状态：已停用/未运行/运行中。
3. 该分区展示 Base URL、API Key（脱敏）、模型数量、成员账号数量。
4. 未实现启停/端口/API Key 轮换时，按钮 disabled。
5. 该分区不得与 API key 接入 provider 混为一体。

## Requirement 3：API key 接入只处理 Base URL/API Key/模型

**User Story:** 作为用户，我在 API key 接入里添加 OpenAI-compatible 或 Anthropic-compatible 服务，并管理模型。

### Acceptance Criteria

1. API key 接入详情页必须显示 Base URL、API Key（password 或脱敏）、兼容格式、API 模式。
2. API key 接入详情页必须包含模型刷新、模型测试、上下文长度编辑、启用/禁用。
3. API key 接入不得展示平台账号、配额窗口、切号、本机导入、OAuth 导入等平台字段。
4. 添加供应商表单只出现在 API key 接入区域。
5. API key 接入可以参考 cockpit-tools `CodexModelProviderManager` 的 provider preset 设计，但不得混入平台账号管理。

## Requirement 4：页面信息架构对齐 NarraFork

**User Story:** 作为用户，我可以一眼区分平台集成和 API key 接入，不会被混合表单误导。

### Acceptance Criteria

1. 列表页分为两个明确 section：平台集成、API key 接入。
2. 平台集成卡片显示：平台名、平台 badge、启用 switch、账号数、模型数、本地服务状态。
3. API key 接入卡片显示：provider 名、apiMode badge、compatibility badge、模型标签、启用 switch。
4. 点击平台卡片进入平台详情；点击 API provider 卡片进入 API provider 详情。
5. 两个详情页 UI 不复用同一个详情组件。

## Requirement 5：不引入假成功与假数据

**User Story:** 作为用户，我宁愿看到“尚未接入后端”，也不要看到伪造的账号、配额或成功状态。

### Acceptance Criteria

1. 平台集成平台 catalog 可以是静态能力目录（Codex/Kiro/Cline），但账号列表不能伪造。
2. 没有真实后端数据时，账号列表显示空态。
3. 所有未来功能按钮必须 disabled。
4. UI 文案必须明确区分“已支持 UI 架构”和“后端尚未接入”。
