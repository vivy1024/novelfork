# Provider Runtime Control Plane v1 - Design

## 设计目标

将 NovelFork 的 AI 供应商设置从“API Key 接入页”升级为“写作任务模型运行控制平面”。设计吸收 NarraFork 的核心经验：

- Provider 是 Agent 的运行时资源池。
- 模型是任务能力，不是 endpoint。
- 设置是调度策略，不是字段表单。

同时，NovelFork 必须保持自身定位：中文网文创作工作台。模型控制的主语言应围绕大纲、正文、审稿、修订、连续性审计、风格仿写、去 AI 味、摘要入库等写作任务展开，而不是照搬编程 Agent 的 explore/plan/general 心智。

本设计还纳入当前 Studio 前端体验债治理：

1. 可见按钮必须真实可交互，或清楚说明为什么不可用。
2. 用户可见界面不得裸露 raw enum、内部字段名、组件名或配置路径。

## 调研依据

### NarraFork 7778 观察

在 NarraFork `0.2.9` 的本地实例中，`设置 > 模型` 和 `设置 > AI 代理` 共同构成 runtime control plane：

- 默认模型、摘要模型。
- Explore / Plan 子代理模型偏好和模型池限制。
- 全局推理强度、Codex 推理强度。
- provider 分组模型列表，例如 openai/anthropic/nkp grouped models。
- provider 高级字段，例如 prefix、baseUrl、apiMode、codexWebSocket、proxy、TLS、disabled。
- 错误重试、上下文阈值、智能输出中断、请求 dump、代理策略。
- 模型聚合入口。

这些设计不是“设置项多”，而是在解决 Agent 长任务中的主要矛盾：上层任务需要稳定抽象的模型能力，底层供应商却异构、不稳定、受账号/配额/协议影响。

### NovelFork 当前代码观察

- `ProviderSettingsPage.tsx`：已有平台集成和 API key 接入分区。
- `providers.ts`：已有 provider CRUD、模型刷新、模型测试、启停、删除接口。
- `platform-integrations.ts`：已有 Codex/Kiro/Cline catalog、JSON 账号导入、导入后激活平台模型。
- `RuntimeControlPanel.tsx`：已有运行控制初版，但仍偏通用/编程 Agent 语言。
- `SettingsSectionContent.tsx`：模型页目前是 read-only 摘要 + 跳转 provider。
- `PlatformIntegrationCard.tsx`、`PlatformIntegrationDetail.tsx`、`PlatformAccountTable.tsx`：存在平台启停、切换账号、刷新配额、删除账号、账号管理等 disabled/后续接入状态。
- `WorkspacePage.tsx`、`resource-view-registry.tsx`、`DashboardPage.tsx`、`RoutinesNextPage.tsx`：也存在 URL 导入、预设管理、空态 action、hooks 等非交互入口。
- `ApiProviderCard.tsx`：直接显示 `provider.apiMode` 和 `provider.compatibility.replace(...)`。
- `SettingsSectionContent.tsx`、`WorkflowPage.tsx`、`resource-view-registry.tsx`：可见 raw status、raw strategy、`BibleCategoryView`、`OutlineEditor`、`PublishReportViewer` 等内部名。

## 总体架构

```text
┌───────────────────────────────────────────────────────────┐
│ Studio UI                                                  │
│ 供应商接入 | 模型库存 | 虚拟模型 | 写作任务绑定 | 运行策略 │
└───────────────────────────────────────────────────────────┘
                            │
┌───────────────────────────────────────────────────────────┐
│ Runtime Control Service                                    │
│ label registry | validation | health summary | migrations  │
└───────────────────────────────────────────────────────────┘
                            │
┌───────────────────────────────────────────────────────────┐
│ Routing Layer                                              │
│ task profile -> virtual model -> provider model -> adapter │
└───────────────────────────────────────────────────────────┘
                            │
┌───────────────────────────────────────────────────────────┐
│ Provider Runtime Store                                     │
│ providers | provider models | virtual models | accounts    │
└───────────────────────────────────────────────────────────┘
                            │
┌───────────────────────────────────────────────────────────┐
│ Provider Adapters                                          │
│ openai-compatible | anthropic-compatible | platform accounts│
└───────────────────────────────────────────────────────────┘
```

## 分层数据模型

### 1. Physical Provider

表示真实供应来源。

```ts
interface RuntimeProviderRecord {
  id: string;
  name: string;
  type: ProviderType;
  enabled: boolean;
  priority: number;
  prefix?: string;
  baseUrl?: string;
  compatibility?: ProviderCompatibility;
  apiMode?: ProviderApiMode;
  transport?: "http" | "websocket";
  defaultModel?: string;
  thinkingStrength?: ProviderThinkingStrength;
  proxy?: string;
  tlsRejectUnauthorized?: boolean;
  disabledReason?: string;
  health?: RuntimeProviderHealth;
  config: ProviderConfig;
  models: RuntimeModelRecord[];
}
```

已有 `RuntimeProviderRecord` 可渐进扩展。敏感字段仍只保存在 runtime store，API view 必须脱敏。

### 2. Physical Model

表示 provider 实际提供的模型。

```ts
interface RuntimeModelRecord {
  id: string;
  name: string;
  source: "detected" | "builtin-platform" | "manual" | "seed";
  enabled: boolean;
  contextWindow: number;
  maxOutputTokens: number;
  capabilities?: RuntimeModelCapability[];
  recommendedUses?: WritingTaskKind[];
  lastRefreshedAt?: string;
  lastTestStatus: "untested" | "success" | "error" | "unsupported";
  lastTestLatency?: number;
  lastTestError?: string;
}
```

能力标签可以先由 provider adapter 或模型 ID 规则推断，再允许用户手动修正。

### 3. Virtual Model

用户视角的模型能力聚合。

```ts
interface VirtualModelRecord {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  routingMode: "manual" | "priority" | "fallback" | "quota-aware";
  members: Array<{
    providerId: string;
    modelId: string;
    priority: number;
    enabled: boolean;
    note?: string;
  }>;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}
```

本轮实现必须支持 `manual`、`priority`、`fallback`、`quota-aware`。`quota-aware` 依据已记录账号配额百分比和账号状态降权；缺少配额数据时按普通优先级处理，并在路由原因中说明“未记录配额”。

### 4. Writing Task Model Profile

NovelFork 专属任务绑定。

```ts
type WritingTaskKind =
  | "outline"
  | "draft"
  | "continue"
  | "revision"
  | "continuity-audit"
  | "character-audit"
  | "worldbuilding-analysis"
  | "style-imitation"
  | "de-ai"
  | "summary"
  | "title-blurb";

interface WritingModelProfile {
  defaultDraftModel: string;
  defaultAnalysisModel: string;
  taskModels: Partial<Record<WritingTaskKind, string>>;
  advancedAgentModels?: {
    explore?: string;
    plan?: string;
    generalPool?: string[];
  };
  validation: WritingModelProfileValidation;
}
```

现有 `modelDefaults.defaultSessionModel` 和 `summaryModel` 可迁移到 `defaultDraftModel` 和 `summary`。现有 `subagentModelPool` 保留为高级 Agent 区域。

### 5. Runtime Policy

运行策略控制长任务自愈。

```ts
interface RuntimePolicySettings {
  retry: {
    maxAttempts: number;
    backoffCeilMs: number;
    retryableRules: RetryableErrorRule[];
  };
  context: {
    pruneStartPercent: number;
    compactStartPercent: number;
    largeWindowThreshold: number;
  };
  fallback: {
    enabled: boolean;
    excludeProviderAfterFailures: number;
    excludeAccountOnQuotaError: boolean;
  };
  debug: {
    dumpRequests: boolean;
    showTokenUsage: boolean;
    showOutputRate: boolean;
  };
}
```

现有 `RuntimeControlSettings` 可作为第一版 runtime policy 的基础，但 UI 要改成中文解释，调用链是否生效必须清楚标注。

## UI 设计

### 页面 1：AI 供应商总览

目的：一眼看出 AI 资源池是否可用。

内容：

- 总览卡片：供应商数、启用供应商数、物理模型数、虚拟模型数、异常来源数。
- 默认任务模型健康：正文、审稿、摘要、连续性审计是否有可用模型。
- 异常列表：provider 异常、账号过期、模型测试失败、虚拟模型无候选。
- 快捷修复路径：添加 provider、刷新模型、创建虚拟模型、绑定任务模型。

交互规则：

- 所有主按钮必须可点击并有真实路径。
- 当前不可真实执行的能力不进入用户主界面；不得出现“后续接入/暂未接入/即将推出”的主功能入口。

### 页面 2：供应商接入

目的：管理物理 provider。

内容：

- API key provider 列表。
- 平台账号 provider 列表。
- provider 详情：连接信息、兼容协议、API 模式、transport、proxy、TLS、默认模型、推理强度、健康状态。
- 操作：保存、测试连接、刷新模型、启用/禁用、删除。

字段呈现：

- `apiMode` 展示为“Chat Completions / Responses / Codex 模式”，而不是 `completions`/`responses`/`codex`。
- `compatibility` 展示为“OpenAI 兼容 / Anthropic 兼容”，而不是 `openai-compatible`。
- `lastTestStatus` 展示为“未测试 / 成功 / 失败 / 不支持”。

### 页面 3：模型库存

目的：按 provider 管理真实模型。

内容：

- provider 分组模型表。
- 模型能力标签、上下文窗口、最大输出、刷新时间、测试结果、启用状态。
- 批量刷新、单模型测试、手动能力修正。

注意：

- 模型 ID 可以保留英文，但必须配中文用途/能力标签。
- 模型库存不是任务绑定入口，任务绑定使用虚拟模型。

### 页面 4：虚拟模型聚合

目的：建立用户心智中的“能力模型”。

示例：

- 强力正文模型。
- 低成本摘要模型。
- 连续性审计模型。
- 世界观分析模型。

内容：

- 虚拟模型列表。
- 候选 provider/model 成员。
- routingMode、优先级、fallback。
- 校验状态：是否存在可用候选。

### 页面 5：写作任务模型配置

目的：把 NovelFork 创作流程绑定到虚拟模型。

任务绑定：

- 大纲规划。
- 正文生成。
- 续写。
- 修订润色。
- 连续性审计。
- 人物一致性。
- 世界观分析。
- 风格仿写。
- 去 AI 味。
- 摘要入库。
- 标题/简介生成。

继承规则：

- 未配置的大纲/分析类任务继承默认分析模型。
- 未配置的正文/续写/修订类任务继承默认正文模型。
- 摘要入库默认继承摘要模型。

### 页面 6：运行策略

目的：让长篇任务不中途因为 provider 抖动失败。

内容：

- 重试策略。
- 可重试错误规则。
- fallback 策略。
- 上下文裁剪/压缩阈值。
- 输出中断检测。
- 请求 dump / token / 输出速率调试。

设计要求：

- 当前展示的每个策略必须有真实保存路径，并在路由解析或前端行为中生效。
- 已接入调用链的策略必须显示最近一次生效记录或测试路径。

## UI 体验债治理设计

### Interaction Audit

新增或整理一个轻量交互审计工具，用于扫描/测试以下情况：

- 可见主按钮 `disabled` 且没有说明原因。
- 文案为“后续接入/即将推出”但仍作为按钮放在主操作区。
- `UnsupportedCapability` 没有 `capability` 标识或没有具体 reason。
- button 有 `onClick={() => undefined}` 或类似 noop 逻辑。

处理规则：

1. 表单校验禁用：保留 disabled，但必须能通过输入解锁，并有测试。
2. 加载/保存中禁用：保留 disabled，但按钮文案显示状态。
3. 资源未选择禁用：保留 disabled，但 title/旁路文案说明“请先选择作品/模型/账号”。
4. 后端未接入：从当前用户主界面移除该操作，不显示 disabled 主按钮，也不显示“后续接入”说明卡。
5. 长期规划功能：只保留在 spec/tasks 文档中，不进入当前交付 UI。

### Localization Registry

新增统一 label registry，避免各页面散落硬编码。

建议模块：

```ts
packages/studio/src/app-next/lib/display-labels.ts
```

职责：

- provider apiMode label。
- provider compatibility label。
- model test status label。
- platform auth/status label。
- workflow run/agent status label。
- runtime policy source label。
- capability label。
- internal component/viewer/editor label。

示例：

```ts
const API_MODE_LABELS = {
  completions: "Chat Completions 模式",
  responses: "Responses 模式",
  codex: "Codex 模式",
};

const INTERNAL_VIEW_LABELS = {
  BibleCategoryView: "经纬分类视图",
  OutlineEditor: "大纲编辑器",
  PublishReportViewer: "发布报告",
};
```

调试信息规则：

- 主 UI 显示中文说明。
- 技术路径可放在 `<details>` 或小号 monospace 中。
- 不允许把 `runtimeControls.defaultPermissionMode` 作为唯一来源说明。

## 后端/API 设计

### Provider API 扩展

现有 `/providers` 保留，并扩展：

- `GET /providers/summary`：资源池总览。
- `GET /providers/models/grouped`：按 provider 分组模型库存。
- `POST /providers/:id/health-check`：provider 健康检查。
- `PATCH /providers/:id/advanced`：高级配置。

### Virtual Models API

新增：

- `GET /virtual-models`
- `POST /virtual-models`
- `GET /virtual-models/:id`
- `PUT /virtual-models/:id`
- `DELETE /virtual-models/:id`
- `POST /virtual-models/:id/test-route`

### Writing Model Profile API

新增或扩展 `/settings/user`：

- `GET /settings/writing-model-profile`
- `PUT /settings/writing-model-profile`
- `POST /settings/writing-model-profile/validate`

可以先复用 user config store，但应逐步把模型 profile 从通用 `modelDefaults` 中拆出。

### Runtime Routing API

内部服务，不一定直接暴露 UI：

```ts
resolveModelForWritingTask(task: WritingTaskKind): ResolvedRuntimeModel
```

解析顺序：

1. task profile 找到 virtual model。
2. virtual model 根据 routingMode 选择候选。
3. 排除 disabled provider/model/account。
4. 排除健康状态失败或配额不足来源。
5. 返回 provider ref + model id + transport settings。
6. 记录选择原因。

## 迁移设计

### Provider Runtime State

保留当前 runtime store 文件结构，新增字段时执行 normalize：

- 老 provider 无 `transport` 时按 `apiMode` 推断。
- 老 model 无 capabilities 时默认空数组并标记“能力待确认”。
- 老平台账号无 quota 时显示“未刷新”。

### Model Defaults 迁移

旧字段：

- `modelDefaults.defaultSessionModel`
- `modelDefaults.summaryModel`
- `modelDefaults.subagentModelPool`

迁移策略：

1. 如果旧模型 ID 能匹配物理模型，则创建或复用虚拟模型。
2. `defaultSessionModel` 映射为默认正文模型。
3. `summaryModel` 映射为摘要入库模型。
4. `subagentModelPool` 放入高级 Agent 模型区。
5. 无法匹配的 ID 保留为 invalid reference，并显示中文修复提示。

## 错误处理

- provider 测试失败：显示中文错误摘要、HTTP 状态、provider、model、是否可重试。
- 虚拟模型无候选：阻止保存为默认任务模型，提示添加候选。
- 任务绑定失效：允许保存草稿，但总览标红，不允许运行需要该模型的写作任务。
- 配额不足：标记账号/provider 临时不可用，并尝试 fallback。
- adapter 不支持：返回 structured unsupported，不在 UI 上显示可点击操作。

## 测试策略

### 单元测试

- provider 高级字段 normalize/sanitize。
- model capabilities 推断和手动覆盖。
- virtual model CRUD 与候选校验。
- writing task profile 继承规则。
- routing fallback 选择。
- label registry 覆盖常见 enum/status/source。

### 前端测试

- Provider 总览：空模型、异常 provider、默认任务模型缺失。
- 供应商接入：保存、测试、刷新、启停、删除确认。
- 模型库存：分组展示、能力标签、启用/禁用。
- 虚拟模型：添加候选、设置优先级、无候选校验。
- 写作任务绑定：继承规则、失效引用、保存失败。
- 运行策略：所有可见策略均可保存并在路由/前端行为中生效。
- 交互审计：无说明 disabled 主按钮、“后续接入/暂未接入/即将推出/UnsupportedCapability”可见入口应失败。
- 中文呈现：raw enum/字段名泄漏应失败。

### 回归测试

当前已通过的相关测试需要继续保持：

- `ProviderSettingsPage.test.tsx`
- `SettingsSectionContent.test.tsx`
- `RuntimeControlPanel.test.tsx`

新增实现后应扩展这些测试，而不是只新增平行页面测试。

## 本轮一次性交付范围

本轮不分阶段留尾巴，必须同时完成：

- display label registry 与中文呈现治理。
- provider summary 与 grouped model inventory。
- provider advanced fields UI 与健康状态诊断。
- virtual model store/API/UI，支持 manual、priority、fallback、quota-aware routing。
- WritingModelProfile 与旧 `modelDefaults` 迁移。
- 平台账号刷新配额、切换当前账号、停用/删除真实后端。
- provider/account failure 降权与 quota-aware routing。
- 交互审计，确保当前用户主界面无“后续接入/暂未接入/即将推出/UnsupportedCapability”可见入口。

## 风险与取舍

### 风险 1：范围过大

控制：收敛实现深度，但不保留可见未接入口；外部 OAuth/device-code 等无法真实执行的能力从 UI 能力列表中移除。

### 风险 2：过度照搬 NarraFork

控制：主模型配置使用 NovelFork 写作任务语言；explore/plan/general 放高级区。

### 风险 3：为了消除 disabled 按钮而做假实现

控制：严格遵守项目纪律。未接入真实后端的功能不得进入用户主界面；不得用 UnsupportedCapability、noop adapter 或假 routes 伪装完成。

### 风险 4：字段本地化影响调试

控制：主 UI 显示中文，技术路径折叠展示，不删除调试信息。

### 风险 5：迁移打断现有 provider

控制：保留现有 `/providers` 和 `ProviderRuntimeStore`，新增字段 normalize，先兼容读取旧 `modelDefaults`。

## 成功标准

- 用户能从“写作任务”角度配置模型，而不是直接面对 provider/model ID。
- Provider 总览能指出默认创作链路是否可用。
- 物理模型、虚拟模型、任务绑定之间关系清楚可查。
- 长任务失败时能说明是 provider、模型、账号、配额、上下文还是策略问题。
- 前端主操作区没有无说明的 disabled/假按钮。
- 用户主界面不再显示 raw enum、内部组件名、配置路径作为唯一说明。
- 现有 provider/settings 测试继续通过，并新增交互审计与中文呈现测试。