# Provider Integration Rewrite Design

## 总体设计

供应商页拆成两条完全独立的数据路径和 UI 路径：

```text
ProviderSettingsPage
├── PlatformIntegrationsSection
│   ├── PlatformIntegrationCard[]
│   └── PlatformIntegrationDetail
│       ├── PlatformOverview
│       ├── LocalAccessPanel（Codex only）
│       ├── CredentialImportActions
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
  supportsLocalAccess: boolean;
  supportedImportMethods: PlatformImportMethod[];
  modelCount?: number;
}

type PlatformId = "codex" | "kiro" | "cline";

type PlatformImportMethod =
  | "local"
  | "oauth"
  | "device-code"
  | "token-json"
  | "api-key";
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
  authMode: "oauth" | "local" | "token-json" | "api-key";
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
  createdAt?: string;
  lastUsedAt?: string;
}
```

### PlatformLocalAccessState

借鉴 cockpit-tools `CodexLocalAccessState`。

```ts
interface PlatformLocalAccessState {
  platformId: PlatformId;
  enabled: boolean;
  running: boolean;
  baseUrl: string;
  apiKeyMask: string;
  modelIds: string[];
  memberAccountIds: string[];
  stats?: {
    requestCount: number;
    successCount: number;
    failureCount: number;
    totalTokens?: number;
    avgLatencyMs?: number;
  };
}
```

### ApiProvider

继续使用现有 `ManagedProvider`，但 UI 中称为 API Provider。

```ts
type ApiProvider = ManagedProvider;
type ApiModel = Model;
```

## API 设计

当前阶段为了避免伪造成功，平台集成后端先只做只读 catalog + 空账号状态。

```http
GET /api/platform-integrations
→ { integrations: PlatformIntegrationCatalogItem[] }

GET /api/platform-integrations/:platformId/accounts
→ { accounts: PlatformAccount[] }

GET /api/platform-integrations/:platformId/local-access
→ { state: PlatformLocalAccessState | null }
```

导入/切号/刷新配额/启停本地服务暂不实现，前端按钮 disabled：

```http
POST /api/platform-integrations/:platformId/import/local       # future
POST /api/platform-integrations/:platformId/import/oauth       # future
POST /api/platform-integrations/:platformId/import/token-json  # future
POST /api/platform-integrations/:platformId/accounts/:id/switch # future
POST /api/platform-integrations/:platformId/accounts/:id/refresh-quota # future
POST /api/platform-integrations/:platformId/local-access/toggle # future
```

API key 接入继续使用现有：

```http
GET /api/providers
POST /api/providers
POST /api/providers/:id/models/refresh
POST /api/providers/:id/models/:modelId/test
PATCH /api/providers/:id/models/:modelId
```

## UI 设计

### 列表页

#### 平台集成卡片

- 左上：平台名 + `平台` badge。
- 右上：启用 switch。
- 中部：账号数、本地服务状态、模型数。
- 底部：支持的导入方式标签（本机 / OAuth / JSON / API Key）。
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

#### LocalAccessPanel（Codex only）

展示：

- 状态：已停用/未运行/运行中。
- Base URL：如 `http://127.0.0.1:54140/v1`。
- API Key：脱敏。
- 模型数、成员账号数。
- 统计：请求数、成功/失败、Token、平均延迟（没有后端时显示 `--`）。
- 操作按钮：启停、测试、轮换 API Key、成员账号（全部 disabled，标注后续接入）。

#### CredentialImportActions

按钮：

- 本机导入
- OAuth / 浏览器添加
- 设备码添加
- Token / JSON 导入
- API Key 账号（Codex only）

当前全部 disabled，但 tooltip/说明明确“后续接入平台账号后端”。

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

空态：暂无平台账号。

### API Provider 详情页

保留当前 API key provider 逻辑，但补齐编辑区：

- Base URL input
- API Key password input
- compatibility select
- apiMode select
- 保存按钮（若后端没有 provider 更新接口，先 disabled 并说明）
- 模型列表继续保留刷新/测试/上下文长度/启用禁用。

## 与 cockpit-tools 的边界

本 spec 不完整复刻 cockpit-tools。只吸收它的平台账号模型和 UI 信息架构：

- 账号管理：借鉴 `CodexAccount`、store actions、quota fields。
- 本地反代：借鉴 `CodexLocalAccessModal` 的 Base URL/API Key/端口/统计/成员账号结构。
- API model provider：借鉴 `CodexModelProviderManager` 的 provider preset + apiKeys[] 概念，但 NovelFork 仍沿用现有 provider-manager。

不做：

- Tauri 本机文件读取。
- OAuth / 设备码真实流程。
- 多实例启动、注入和切号。
- 配额真实刷新。
