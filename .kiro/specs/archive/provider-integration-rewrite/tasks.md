# Implementation Plan — Provider Integration Rewrite

> Superseded: 此任务清单只代表 UI 骨架/内存 prototype 完成，不代表真实功能完成。不要再执行或引用它作为 Done；真实任务以 `.kiro/specs/real-provider-model-runtime/` 为准。

## Phase 0：纠正错误方向

- [x] 1. 移除平台集成中的本地反代/LocalAccess 概念
  - 移除 `LocalAccessPanel`、`local-access` API、`PlatformLocalAccessState`。
  - 平台集成改为 JSON 账号导入与账号管理。
  - 验收：平台详情不显示“本地 API 服务”。

## Phase 1：类型与 API 边界

- [x] 2. 新增平台集成类型
  - `packages/studio/src/app-next/settings/provider-types.ts`。
  - 定义 `PlatformId`、`PlatformImportMethod`、`PlatformIntegrationCatalogItem`、`PlatformAccount`、`PlatformJsonImportPayload`、`ApiProvider`。
  - 类型字段覆盖：`authMode`、`planType`、`quota.hourlyPercentage`、`quota.weeklyPercentage`、`current`、`lastUsedAt`。

- [x] 3. 新增平台集成 catalog API
  - `GET /api/platform-integrations`。
  - 返回 catalog：Codex / Kiro / Cline。
  - catalog 是能力目录，不是用户账号数据。
  - 验收：前端不再硬编码平台 catalog。

- [x] 4. 新增平台账号列表 API
  - `GET /api/platform-integrations/:platformId/accounts`。
  - 当前返回真实导入账号；未导入时返回空数组。
  - 验收：平台详情账号表格从 API 加载，空态真实。

- [x] 5. 新增平台 JSON 账号导入 API
  - `POST /api/platform-integrations/:platformId/accounts/import-json`。
  - Codex / Kiro 支持 JSON 账号导入。
  - Cline 当前返回不支持。
  - 验收：导入后账号出现在平台账号列表。

## Phase 2：ProviderSettingsPage 拆分

- [x] 6. ProviderSettingsPage 拆成容器 + 子组件
  - 新目录：`packages/studio/src/app-next/settings/providers/`。
  - 拆出：
    - `PlatformIntegrationsSection.tsx`
    - `PlatformIntegrationCard.tsx`
    - `PlatformIntegrationDetail.tsx`
    - `PlatformAccountTable.tsx`
    - `ApiProvidersSection.tsx`
    - `ApiProviderCard.tsx`
    - `ApiProviderDetail.tsx`
  - ProviderSettingsPage 只负责数据加载和视图切换。

- [x] 7. 实现平台集成列表
  - 从 `/api/platform-integrations` 加载 catalog。
  - 每张卡片展示：平台名、平台 badge、启用状态、账号数、模型数、导入能力状态、支持导入方式。
  - 点击进入平台详情。
  - 验收：平台集成列表不显示 API Key/Base URL。

- [x] 8. 实现平台详情页
  - 从 `/api/platform-integrations/:platformId/accounts` 加载账号列表。
  - Codex / Kiro 展示 JSON 账号导入表单。
  - 展示：平台概览、JSON 导入、账号表格。
  - 验收：无账号时显示真实空态，导入后显示真实账号。

- [x] 9. 实现 PlatformAccountTable
  - 列：当前、名称/email、账号 ID、认证方式、套餐、状态、优先级、成功/失败、配额、最后使用、操作。
  - 空态：暂无平台账号。
  - 验收：表格字段覆盖 cockpit-tools CodexAccount 核心信息。

## Phase 3：API key 接入重写

- [x] 10. API Provider 列表只展示 API key 接入
  - 继续使用 `/api/providers`。
  - 不展示 Codex/Kiro/Cline 平台 catalog。
  - 卡片展示 provider 名、apiMode、compatibility、模型标签、启用 switch。

- [x] 11. API Provider 详情补齐编辑区
  - Base URL input。
  - API Key password input。
  - compatibility select。
  - apiMode select。
  - 保存按钮。
  - 模型区保留刷新、测试、上下文长度、启用/禁用。
  - 验收：API 详情页不展示平台账号导入/配额/切号。

- [x] 12. AddProviderForm 只保留在 API key 接入
  - 表单字段：名称、前缀、Base URL、API Key、API 模式、兼容格式。
  - 加基础验证：名称、Base URL、API Key 必填。
  - 验收：平台集成 section 没有添加 API provider 表单。

## Phase 4：测试与对比验收

- [x] 13. 更新 ProviderSettingsPage 测试
  - 平台列表加载 catalog。
  - Codex 详情无 API Key/Base URL 表单，也无本地 API 服务。
  - Codex 详情有 JSON 账号导入与账号表格空态。
  - JSON 导入后账号出现在账号表格。
  - API provider 详情有 Base URL/API Key/模型刷新。
  - AddProviderForm 只在 API key 接入。

- [x] 14. 浏览器对比 NarraFork
  - 打开 NarraFork `/settings/providers`。
  - 打开 NovelFork `/next/settings` → AI 供应商。
  - 单模块截图对比：平台集成列表、平台详情、API key 接入列表、API key 详情。
  - 验收：信息架构一致，不再混淆平台账号和 API key provider。

## Done Definition

- 平台集成不出现 API Key/Base URL 接入表单。
- API key 接入不出现平台账号/配额/切号字段。
- Codex / Kiro 平台集成是 JSON 账号导入，不是本地反代。
- 平台账号数据不伪造，未导入时显示真实空态。
- UI 分区与 NarraFork 一致。
- cockpit-tools 学到的账号/配额/JSON 导入概念已体现在类型和 UI 中。
- app-next 相关测试通过。
