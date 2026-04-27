# Implementation Plan — Provider Integration Rewrite

## Phase 0：清理错误方向

- [ ] 1. 回滚/替换当前 ProviderSettingsPage 中不完整的平台集成实现
  - 移除 `PLATFORM_INTEGRATIONS` mock 账号字段，不在生产代码中伪造账号数据。
  - 保留 API key provider 现有 client 能力。
  - 验收：平台账号数来自 API 或空态，不是硬编码假账号。

## Phase 1：类型与 API 边界

- [ ] 2. 新增平台集成类型
  - 新建 `packages/studio/src/app-next/settings/provider-types.ts`。
  - 定义 `PlatformId`、`PlatformImportMethod`、`PlatformIntegrationCatalogItem`、`PlatformAccount`、`PlatformLocalAccessState`、`ApiProvider`。
  - 类型字段参考 cockpit-tools：`authMode`、`planType`、`quota.hourlyPercentage`、`quota.weeklyPercentage`、`current`、`lastUsedAt`。

- [ ] 3. 新增平台集成只读 API
  - 新增后端路由：`GET /api/platform-integrations`。
  - 返回 catalog：Codex / Kiro / Cline。
  - catalog 是能力目录，不是用户账号数据。
  - 验收：前端不再硬编码平台 catalog。

- [ ] 4. 新增平台账号空数据 API
  - 新增后端路由：`GET /api/platform-integrations/:platformId/accounts`。
  - 当前返回空数组。
  - 后续 OAuth/本机导入实现后再接真实数据。
  - 验收：平台详情账号表格从 API 加载，空态真实。

- [ ] 5. 新增平台本地反代状态 API
  - 新增后端路由：`GET /api/platform-integrations/:platformId/local-access`。
  - Codex 返回默认状态：disabled / not running / baseUrl 预设 / apiKeyMask 预设 / modelIds 空。
  - Kiro/Cline 返回 null。
  - 验收：Codex 详情页显示本地 API 服务区，状态来自 API。

## Phase 2：ProviderSettingsPage 拆分

- [ ] 6. ProviderSettingsPage 拆成容器 + 子组件
  - 新目录：`packages/studio/src/app-next/settings/providers/`。
  - 拆出：
    - `PlatformIntegrationsSection.tsx`
    - `PlatformIntegrationCard.tsx`
    - `PlatformIntegrationDetail.tsx`
    - `PlatformAccountTable.tsx`
    - `LocalAccessPanel.tsx`
    - `ApiProvidersSection.tsx`
    - `ApiProviderCard.tsx`
    - `ApiProviderDetail.tsx`
  - ProviderSettingsPage 只负责数据加载和视图切换。

- [ ] 7. 实现平台集成列表
  - 从 `/api/platform-integrations` 加载 catalog。
  - 每张卡片展示：平台名、平台 badge、启用状态、账号数、本地服务状态、模型数、支持导入方式。
  - 点击进入平台详情。
  - 验收：平台集成列表不显示 API Key/Base URL。

- [ ] 8. 实现平台详情页
  - 从 `/api/platform-integrations/:platformId/accounts` 加载账号列表。
  - 从 `/api/platform-integrations/:platformId/local-access` 加载本地服务状态。
  - 展示：平台概览、导入操作、账号表格。
  - 验收：无账号时显示真实空态。

- [ ] 9. 实现 LocalAccessPanel
  - Codex only。
  - 展示：运行状态、Base URL、API Key 脱敏、模型数、成员账号数、请求统计。
  - 操作按钮：启停、测试、轮换 API Key、成员账号。当前 disabled。
  - 验收：UI 对齐 cockpit-tools 的本地 API 服务概念。

- [ ] 10. 实现 PlatformAccountTable
  - 列：当前、名称/email、账号 ID、认证方式、套餐、状态、优先级、成功/失败、配额、最后使用、操作。
  - 空态：暂无平台账号。
  - 验收：表格字段覆盖 cockpit-tools CodexAccount 核心信息。

## Phase 3：API key 接入重写

- [ ] 11. API Provider 列表只展示 API key 接入
  - 继续使用 `/api/providers`。
  - 不展示 Codex/Kiro/Cline 平台 catalog。
  - 卡片展示 provider 名、apiMode、compatibility、模型标签、启用 switch。

- [ ] 12. API Provider 详情补齐编辑区
  - Base URL input。
  - API Key password input。
  - compatibility select。
  - apiMode select。
  - 保存按钮：若后端没有 provider update route，disabled 并说明。
  - 模型区保留刷新、测试、上下文长度、启用/禁用。
  - 验收：API 详情页不展示平台账号导入/配额/切号。

- [ ] 13. AddProviderForm 只保留在 API key 接入
  - 表单字段：名称、前缀、Base URL、API Key、API 模式、兼容格式。
  - 加基础验证：名称、Base URL、API Key 必填。
  - 验收：平台集成 section 没有添加 API provider 表单。

## Phase 4：测试与对比验收

- [ ] 14. 更新 ProviderSettingsPage 测试
  - 平台列表加载 catalog。
  - Codex 详情无 API Key/Base URL 表单。
  - Codex 详情有本地 API 服务与凭据表格空态。
  - API provider 详情有 Base URL/API Key/模型刷新。
  - AddProviderForm 只在 API key 接入。

- [ ] 15. 浏览器对比 NarraFork
  - 打开 NarraFork `/settings/providers`。
  - 打开 NovelFork `/next/settings` → AI 供应商。
  - 单模块截图对比：平台集成列表、平台详情、API key 接入列表、API key 详情。
  - 验收：信息架构一致，不再混淆平台账号和 API key provider。

## Done Definition

- 平台集成不出现 API Key/Base URL 接入表单。
- API key 接入不出现平台账号/配额/切号字段。
- 平台账号数据不伪造，后端未接入时显示真实空态。
- UI 分区与 NarraFork 一致。
- cockpit-tools 学到的账号/配额/本地反代概念已体现在类型和 UI 中。
- app-next 测试通过。
