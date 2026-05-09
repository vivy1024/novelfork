# NarraFork 前端源码逻辑提取（从压缩 bundle 格式化后分析）

> 提取日期：2026-05-09
> 来源：http://localhost:7778/assets/*.js（NarraFork v0.4.5 编译产物）
> 文件：chunks/api-client.js, chunks/useNarrator.js, chunks/useNarratorWS.js, chunks/NarratorPanel.js

---

## 一、叙述者配置 API（api-client.js L750-850）

NarraFork 用**细粒度 PATCH 端点**修改叙述者配置，每个配置项独立：

```js
// 模型切换
updateNarratorModel: (narratorId, model) =>
  fetch(`/narrators/${narratorId}/model`, {
    method: 'PATCH',
    body: JSON.stringify({ model })  // model = "provider:modelId"
  })

// 权限模式
updateNarratorPermissionMode: (narratorId, permissionMode) =>
  fetch(`/narrators/${narratorId}/permission-mode`, {
    method: 'PATCH',
    body: JSON.stringify({ permissionMode })  // "ask"|"edit"|"allow"|"read"|"deny"
  })

// 推理强度（Codex 专属）
updateNarratorReasoningEffort: (narratorId, reasoningEffort) =>
  fetch(`/narrators/${narratorId}/reasoning-effort`, {
    method: 'PATCH',
    body: JSON.stringify({ reasoningEffort })  // "none"|"low"|"medium"|"high"|"xhigh"|"auto"
  })

// Fast Mode（Codex 专属）
updateNarratorFastMode: (narratorId, fastMode) =>
  fetch(`/narrators/${narratorId}/fast-mode`, {
    method: 'PATCH',
    body: JSON.stringify({ fastMode })  // boolean
  })

// 宽松规划
updateNarratorRelaxedPlan: (narratorId, relaxedPlan) =>
  fetch(`/narrators/${narratorId}/relaxed-plan`, {
    method: 'PATCH',
    body: JSON.stringify({ relaxedPlan })  // boolean
  })

// 计划模式
enterPlanMode: (narratorId) =>
  fetch(`/narrators/${narratorId}/plan-mode/enter`, { method: 'POST' })
exitPlanMode: (narratorId) =>
  fetch(`/narrators/${narratorId}/plan-mode/exit`, { method: 'POST' })

// 标题
updateNarratorTitle: (narratorId, title) =>
  fetch(`/narrators/${narratorId}/title`, {
    method: 'PATCH',
    body: JSON.stringify({ title })
  })

// AI 生成标题
generateNarratorTitle: (narratorId) =>
  fetch(`/narrators/${narratorId}/generate-title`, { method: 'POST' })

// 白名单/黑名单目录
getWhitelistDirs: (narratorId) => fetch(`/narrators/${narratorId}/whitelist-dirs`)
createWhitelistDir: (narratorId, dir) => fetch(`/narrators/${narratorId}/whitelist-dirs`, { method: 'POST', body: JSON.stringify(dir) })
getBlacklistDirs: (narratorId) => fetch(`/narrators/${narratorId}/blacklist-dirs`)
createBlacklistDir: (narratorId, dir) => fetch(`/narrators/${narratorId}/blacklist-dirs`, { method: 'POST', body: JSON.stringify(dir) })

// 命令白名单/黑名单
getCmdWhitelist: (narratorId) => fetch(`/narrators/${narratorId}/cmd-whitelist`)
getCmdBlacklist: (narratorId) => fetch(`/narrators/${narratorId}/cmd-blacklist`)

// 子代理模型限制
updateSubagentModelRestriction: (narratorId, pools) =>
  fetch(`/narrators/${narratorId}/custom-traits/subagent-model-restriction`, {
    method: 'PUT',
    body: JSON.stringify({ pools })
  })

// 禁用工具
updateDisabledTools: (narratorId, tools) =>
  fetch(`/narrators/${narratorId}/custom-traits/disabled-tools`, {
    method: 'PUT',
    body: JSON.stringify({ tools })
  })
```

---

## 二、React Query Mutation Hooks（useNarrator.js L332-537）

每个配置修改有独立的 mutation hook，成功后 invalidate cache：

```js
// 权限模式 mutation
function useUpdatePermissionMode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, permissionMode }) => api.updateNarratorPermissionMode(id, permissionMode),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['narrators'] }); }
  });
}

// 推理强度 mutation
function useUpdateReasoningEffort() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reasoningEffort }) => api.updateNarratorReasoningEffort(id, reasoningEffort),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['narrators'] }); }
  });
}

// Fast Mode mutation
function useUpdateFastMode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, fastMode }) => api.updateNarratorFastMode(id, fastMode),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['narrators'] }); }
  });
}

// 模型切换 mutation
function useUpdateModel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, model }) => api.updateNarratorModel(id, model),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['narrators'] }); }
  });
}

// 宽松规划 mutation
function useUpdateRelaxedPlan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, relaxedPlan }) => api.updateNarratorRelaxedPlan(id, relaxedPlan),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['narrators'] }); }
  });
}
```

---

## 三、WebSocket 事件处理（useNarratorWS.js L190-310）

NarraFork 通过 WebSocket 推送配置变更事件，前端实时同步：

```js
// WebSocket 消息 switch-case
case 'permission_mode_changed':
  callbacks.onPermissionModeChanged?.(event.permissionMode);
  break;

case 'plan_mode_changed':
  callbacks.onPlanModeChanged?.(event.planMode, event.traits);
  break;

case 'relaxed_plan_changed':
  callbacks.onRelaxedPlanChanged?.(event.relaxedPlan);
  break;

case 'model_changed':
  event.model && callbacks.onModelChanged?.(event.model);
  break;

case 'model_switched':
case 'model_settings_changed':
case 'model_settings_applied':
  break; // 静默处理

case 'context_usage':
  if (!event.isSubagent) {
    callbacks.onContextUsage?.(event.percentage, event.promptTokens, event.maxTokens);
  }
  break;

case 'compacting':
  callbacks.onCompacting?.();
  break;

case 'compact_done':
case 'compact_failed':
  callbacks.onCompactDone?.(event.contextPercentAfter, event.isSegment);
  break;

case 'goals_set':
  callbacks.onGoalsSet?.(event.goals);
  break;

case 'narrator_warning':
  callbacks.onNarratorWarning?.({ message, retryCount, maxRetries, delayMs });
  break;

case 'full_reload':
  callbacks.onFullReload?.();
  break;
```

---

## 四、NovelFork 等价实现映射

| NarraFork | NovelFork 等价 |
|-----------|---------------|
| `PATCH /narrators/:id/model` | `PUT /api/sessions/:id` + `{ sessionConfig: { providerId, modelId } }` |
| `PATCH /narrators/:id/permission-mode` | `PUT /api/sessions/:id` + `{ sessionConfig: { permissionMode } }` |
| `PATCH /narrators/:id/reasoning-effort` | `PUT /api/sessions/:id` + `{ sessionConfig: { reasoningEffort } }` |
| `PATCH /narrators/:id/fast-mode` | `PUT /api/sessions/:id` + `{ sessionConfig: { fastMode } }` |
| `POST /narrators/:id/generate-title` | 调用 `session-auto-title.ts` 的 `generateSessionTitle()` |
| WebSocket `permission_mode_changed` | WebSocket `session:state` envelope（含更新后的 session record） |
| WebSocket `model_changed` | 同上 |
| `invalidateQueries(['narrators'])` | runtime state 通过 WebSocket snapshot 自动同步 |

**关键差异**：
- NarraFork 用细粒度 PATCH（每个字段独立端点）+ WebSocket 事件推送
- NovelFork 用通用 PUT（一个端点改所有字段）+ WebSocket snapshot 同步
- 功能等价，NovelFork 的问题不是 API 设计，而是**前端回调没有接通**

---

## 五、提供商体系（providers.js + 截图分析）

### API 协议分类

NarraFork 的每个供应商有一个 `apiProtocol` 字段，决定请求格式：

| 协议 | Badge 显示 | 请求格式 | 特有参数 |
|------|-----------|---------|---------|
| `anthropic-official` | Anthropic 官方 | `/v1/messages` + 官方扩展 | thinking |
| `anthropic-compatible` | Anthropic 兼容 | `/v1/messages` 标准格式 | thinking |
| `codex-native` | Codex 原生 | Codex 格式 | reasoning_effort, service_tier, WebSocket |
| `responses-compatible` | Responses 兼容 | OpenAI Responses API | — |
| `completions-compatible` | Completions 兼容 | OpenAI Chat Completions | — |

### 供应商卡片结构

```
Card
├── Header: 供应商名称 + Badge(协议) + Switch(启用/禁用)
├── Body: 模型列表预览（最多显示 3 个 + "+N 更多模型"）
└── Footer: Badge("N 个模型") + Badge("+M" 隐藏模型数)
```

### 供应商详情页结构

```
├── 协议选择 Tab（5 个按钮，可切换，切换时自动迁移）
├── 供应商名称 Input
├── 供应商前缀 Input（用于模型 ID，如 deepseek:model-name）
├── API Key Input（密码框 + 显示按钮）
├── Base URL Input
├── HTTPS 代理 Input（可选）
├── 默认思考强度 Select（Anthropic/Codex 模式时显示）
├── Codex 专属配置（Codex 模式时显示）：
│   ├── ChatGPT Account ID
│   ├── Responses WebSocket 开关
│   └── 推理强度覆盖
└── 模型列表（刷新/测试/启用/禁用/上下文窗口编辑）
```

### 关键设计：协议切换自动迁移

当用户从"Completions 兼容"切换到"Anthropic 兼容"时：
- 保留：名称、前缀、API Key、Base URL
- 自动调整：请求格式、可用参数（显示/隐藏思考强度等）
- 说明文字："切换到 Anthropic 或 OpenAI 系协议时会自动迁移供应商类型并保留名称、前缀、Key 和 Base URL。"

---

## 六、模型设置页（models.js）

### 结构

```
├── 默认模型 Select（格式：provider:modelId）
├── 摘要模型 Select
├── 子代理模型偏好：
│   ├── Explore 子代理模型 Select（可选"继承父级"）
│   └── Plan 子代理模型 Select（可选"继承父级"）
├── 子代理可用模型池：
│   ├── Explore MultiSelect（可选"不限制"）
│   ├── Plan MultiSelect
│   └── General MultiSelect
├── 全局默认推理强度 Select
└── Codex 默认推理强度 Select（覆盖全局）
```

### 优先级链

```
叙述者设置（对话界面控件修改）
  > 供应商设置（Codex 推理强度覆盖）
    > 全局默认（模型设置页）
```

---

## 七、对话界面状态栏控件（NarratorPanel.js 分析）

### 控件→API 调用链

```
模型按钮 "D" 点击
  → 弹出 Menu（搜索 + 按供应商分组的模型列表）
  → 用户选择模型
  → useUpdateModel.mutate({ id: narratorId, model: "provider:modelId" })
  → PATCH /narrators/:id/model
  → 成功 → invalidateQueries(['narrators'])
  → WebSocket 推送 model_changed → 其他客户端同步

权限按钮 🛡️ 点击
  → 弹出 Menu（7 种模式）
  → 用户选择
  → useUpdatePermissionMode.mutate({ id: narratorId, permissionMode: "allow" })
  → PATCH /narrators/:id/permission-mode
  → 成功 → invalidateQueries
  → WebSocket 推送 permission_mode_changed

推理强度按钮 "X" 点击（Codex 专属）
  → 弹出 Menu（none/low/medium/high/xhigh/auto）
  → useUpdateReasoningEffort.mutate({ id: narratorId, reasoningEffort: "high" })
  → PATCH /narrators/:id/reasoning-effort

Fast Mode ⚡ 点击（Codex 专属）
  → toggle
  → useUpdateFastMode.mutate({ id: narratorId, fastMode: !current })
  → PATCH /narrators/:id/fast-mode
```

### NovelFork 需要做的

1. `ConversationSurface` 传递回调给 `NarratorStatusBar`
2. 回调实现：`sessionClient.updateSession(sessionId, { sessionConfig: { ... } })`
3. 推理强度/FastMode 根据当前提供商的 apiMode 决定是否显示
4. 模型切换后 WebSocket `session:state` 自动同步（已有）
