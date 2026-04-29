# UI Quality Cleanup Design

## 设计原则

不加新功能，只修已有问题。每个改动必须有审计报告中的具体问题编号对应。

## 改动范围

15 个文件，3 类问题，按文件逐个修复。

## 视觉规范（全局统一）

```
圆角：卡片/面板 rounded-lg，按钮/input rounded-md，小标签 rounded
颜色：错误 text-destructive，成功 text-emerald-600，警告 text-amber-600
标题：页面 text-lg font-semibold，分区 text-base font-semibold，字段 text-sm font-medium
间距：默认 space-y-3，grid gap-2
内容区：max-w-7xl mx-auto
```

## 空壳处理策略

| 空壳 | 处理 |
|------|------|
| 功能未实现但有入口 | 隐藏入口，不显示"未接入" |
| 功能未实现但有按钮 | 按钮 disabled + tooltip "即将推出" |
| 回调是 noop | 按钮 disabled |
| 输入框无功能 | 移除 |
| 硬编码文案 | 替换为真实数据或移除 |

## 供应商架构修正

NarraFork 的“提供商”不是单一实体，而是两类对象：

### 平台集成（Platform Integration）

面向 Codex/Kiro/Cline 等平台账号。参考 NarraFork 与 cockpit-tools：
- 不填写 API Key/Base URL。
- 核心是账号/凭据管理：OAuth、设备码、JSON 导入、本机导入。
- 需要显示账号状态、优先级、成功/失败次数、配额、用量窗口、最后使用时间。
- 本阶段先做正确 UI 和类型边界，账号导入/配额刷新可 disabled。

### API key 接入（API Provider）

面向 OpenAI-compatible / Anthropic-compatible 等 API 服务：
- 填写 Base URL、API Key。
- 配置兼容格式、API 模式、上下文长度、模型刷新/测试。
- 这是现有 provider-manager 能力的主要保留对象。

### 数据模型拆分

新增/调整前端类型：

```ts
interface PlatformIntegration {
  id: string;
  name: string;
  platform: "codex" | "kiro" | "cline" | "antigravity" | "cursor" | "custom";
  enabled: boolean;
  credentials: PlatformCredential[];
  modelCount?: number;
}

interface PlatformCredential {
  id: string;
  name: string;
  accountId?: string;
  status: "active" | "disabled" | "expired" | "error";
  priority: number;
  successCount: number;
  failureCount: number;
  quota?: {
    hourlyPercentage?: number;
    weeklyPercentage?: number;
  };
  lastUsedAt?: string;
}

interface ApiProvider {
  id: string;
  name: string;
  compatibility: "openai-compatible" | "anthropic-compatible";
  apiMode: "completions" | "responses" | "codex";
  baseUrl: string;
  apiKeyRequired: boolean;
  enabled: boolean;
  models: ApiModel[];
}
```

## 不做的事

- 不做真正的 OAuth/设备码登录流程。
- 不实现完整 cockpit-tools 的本机账号注入、多实例管理、配额刷新。
- 本阶段只修正 NovelFork 的供应商概念、UI 分区、类型边界和 API Key 接入体验。
