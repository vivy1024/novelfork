# Provider Integration Rewrite Design

> Superseded: 此设计保留作历史记录；它没有覆盖 Provider 持久化、真实模型检测、真实模型测试、统一模型池和会话真实调用。真实修复以 `.kiro/specs/real-provider-model-runtime/` 为准。

## 总体设计

供应商页拆成两条完全独立的数据路径和 UI 路径：

```text
ProviderSettingsPage
├── PlatformIntegrationsSection
│   ├── PlatformIntegrationCard[]
│   └── PlatformIntegrationDetail
│       ├── PlatformOverview
│       ├── JsonAccountImportForm
│       └── PlatformAccountTable
└── ApiProvidersSection
    ├── ApiProviderCard[]
    └── ApiProviderDetail
        ├── ApiConnectionInfo
        ├── ApiProviderEditForm
        └── ApiModelList
```

不再用一个 ProviderDetail 同时承载平台集成和 API key 接入。

## 数据模型

### PlatformIntegrationCatalog

平台 catalog 是静态能力目录，不代表用户已经配置账号。

```ts
interface PlatformIntegrationCatalogItem {
  id: PlatformId;
  name: string;
  description: string;
  enabled: boolean;
  supportedImportMethods: PlatformImportMethod[];
  modelCount?: number;
}

type PlatformId = "codex" | "kiro" | "cline";

type PlatformImportMethod =
  | "json-account"
  | "local-auth-json"
  | "oauth"
  | "device-code";
```

### PlatformAccount

借鉴 cockpit-tools `CodexAccount`，但先做跨平台通用子集。

```ts
interface PlatformAccount {
  id: string;
  platformId: PlatformId;
  displayName: string;
  email?: string;
  accountId?: string;
  authMode: "json-account" | "local-auth-json" | "oauth" | "device-code";
  planType?: string;
  status: "active" | "disabled" | "expired" | "error";
  current: boolean;
  priority: number;
  successCount: number;
  failureCount: number;
  quota?: {
    hourlyPercentage?: number;
    hourlyResetAt?: string;
    weeklyPercentage?: number;
    weeklyResetAt?: string;
  };
  tags?: string[];
  credentialSource?: "json" | "local" | "oauth";
  createdAt?: string;
  lastUsedAt?: string;
}
```

### PlatformJsonImportPayload

```ts
interface PlatformJsonImportPayload {
  accountJson: unknown;
  displayName?: string;
}
```

### ApiProvider

继续使用现有 `ManagedProvider`，但 UI 中称为 API Provider。

```ts
type ApiProvider = ManagedProvider;
type ApiModel = Model;
```

## API 设计

当前阶段为了避免伪造成功，平台集成后端提供 catalog、账号列表，以及 Codex/Kiro JSON 账号导入。账号导入先进入平台账号列表；切号、配额刷新、真实调用链路作为后续任务接入。

```http
GET /api/platform-integrations
→ { integrations: PlatformIntegrationCatalogItem[] }

GET /api/platform-integrations/:platformId/accounts
→ { accounts: PlatformAccount[] }

POST /api/platform-integrations/:platformId/accounts/import-json
Body: { accountJson: object|string, displayName?: string }
→ { account: PlatformAccount }
```

切号/刷新配额/删除账号暂不实现，前端按钮 disabled：

```http
POST /api/platform-integrations/:platformId/accounts/:id/switch # future
POST /api/platform-integrations/:platformId/accounts/:id/refresh-quota # future
DELETE /api/platform-integrations/:platformId/accounts/:id # future
```

API key 接入继续使用现有：

```http
GET /api/providers
POST /api/providers
PUT /api/providers/:id
POST /api/providers/:id/models/refresh
POST /api/providers/:id/models/:modelId/test
PATCH /api/providers/:id/models/:modelId
```

## UI 设计

### 列表页

#### 平台集成卡片

- 左上：平台名 + `平台` badge。
- 右上：启用 switch。
- 中部：账号数、模型数、导入能力状态（JSON 可导入 / 待接入）。
- 底部：支持的导入方式标签（JSON 账号 / 本机 auth.json / OAuth / 设备码）。
- 点击进入平台详情。

#### API key 接入卡片

- 左上：provider 名。
- badge：apiMode、compatibility。
- 中部：模型名标签，最多 3 个，后面 `+N 更多模型`。
- 底部：`N 个模型`。
- 点击进入 API 详情。

### 平台详情页

#### PlatformOverview

展示平台说明、启用状态、支持导入方式。

#### JsonAccountImportForm

Codex / Kiro 可用：

- 账号显示名（可选）。
- JSON 账号数据 textarea。
- 导入按钮：JSON 为空时 disabled。
- 导入后把账号加入 PlatformAccountTable，并显示成功反馈。

Cline 等未接入平台显示“该平台当前尚未开放 JSON 账号导入”。

#### PlatformAccountTable

列：

- 当前
- 名称/email
- 账号 ID
- 认证方式
- 套餐
- 状态
- 优先级
- 成功/失败
- 配额（5 小时 / 每周）
- 最后使用
- 操作

空态：暂无平台账号，导入 JSON 账号数据后会显示真实账号。

### API Provider 详情页

保留当前 API key provider 逻辑，但补齐编辑区：

- Base URL input
- API Key password input
- compatibility select
- apiMode select
- 保存按钮
- 模型列表继续保留刷新/测试/上下文长度/启用禁用。

## 与 cockpit-tools 的边界

本 spec 不完整复刻 cockpit-tools。只吸收它的平台账号模型和 UI 信息架构：

- 账号管理：借鉴 `CodexAccount`、store actions、quota fields、JSON import。
- API model provider：借鉴 `CodexModelProviderManager` 的 provider preset + apiKeys[] 概念，但 NovelFork 仍沿用现有 provider-manager。

不做：

- Tauri 本机文件读取。
- OAuth / 设备码真实流程。
- 多实例启动、注入和切号。
- 配额真实刷新。
