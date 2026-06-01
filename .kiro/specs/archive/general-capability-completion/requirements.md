# 通用能力补全 — Requirements

## 目标

补全 NovelFork Studio 与 NarraFork 在通用领域的剩余差距，完成后通用 Agent 工作台能力全面对齐。

---

## FR-1: 自定义斜杠命令

用户可定义 `/命令名` → 展开为 prompt 模板，支持参数占位符。

### 需求

- 用户在套路页创建/编辑/删除斜杠命令
- 命令包含：名称、提示词模板、描述、参数定义
- 支持 `{{input}}` 和命名参数 `{{参数名}}` 占位符
- 支持"先 Bash 再发 prompt"模式（执行 shell 命令后将结果注入上下文）
- 支持模型切换（使用此命令时临时/永久切换模型）
- 命令持久化到 user-config.json
- 在 Composer 输入框中输入 `/` 时显示命令补全列表
- 叙事线级命令优先于用户级命令（同名覆盖）

### 存储

```typescript
interface SlashCommand {
  name: string;
  prompt: string;
  description?: string;
  params?: Array<{ name: string; description?: string; default?: string }>;
  runBashFirst?: boolean;
  bashCommand?: string;
  modelOverride?: { modelId: string; permanent: boolean };
}
```

存储位置：`UserConfig.commands: SlashCommand[]`

### 文件

- `packages/studio/src/types/settings.ts` — 类型定义
- `packages/studio/src/api/lib/user-config-service.ts` — 持久化
- `packages/studio/src/app-next/routines/` — 套路页 UI
- `packages/studio/src/app-next/agent-conversation/surface/Composer.tsx` — 命令补全
- `packages/studio/src/api/lib/session-chat-service.ts` — 命令展开执行

---

## FR-2: 全局/默认系统提示词可编辑

用户可在设置中编辑所有叙述者的基础系统提示词，不需要改代码。

### 需求

- 设置页"AI 代理"面板中添加"默认系统提示词"编辑区
- 全局提示词文件：`~/.novelfork/AGENT.md` 或 `~/.novelfork/CLAUDE.md`（已有读取）
- 设置页可直接编辑此文件内容
- 修改后下次 turn 生效（不需要重启）
- 如果文件不存在，保存时自动创建

### 文件

- `packages/studio/src/app-next/settings/panels/AgentSettingsPanel.tsx` — 编辑 UI
- `packages/studio/src/api/routes/settings.ts` — 读写全局提示词 API
- `packages/studio/src/api/lib/session-chat-service.ts` — 注入逻辑（已有 loadProjectRules）

---

## FR-3: 首 Token 超时 + 自动重试

API 请求发出后，如果 N 秒内没有收到任何响应（首 token），自动中断并重试。

### 需求

- 配置项：`runtimeControls.firstTokenTimeoutSeconds`（默认 60，0=禁用）
- 配置项：`runtimeControls.maxTransientRetries`（默认 3，-1=无限）
- 配置项：`runtimeControls.retryBackoffCeilSeconds`（默认 30）
- 在 provider adapter 的 generate 调用中实现：
  - 启动计时器，如果 N 秒内没有收到 stream event → 中断
  - 指数退避重试（1s → 2s → 4s → ... 最大 30s）
  - 重试次数超限后返回错误
- 临时性错误（429/500/502/503）自动重试
- 支持自定义可重试错误规则（按域名/状态码/关键词）

### 文件

- `packages/studio/src/types/settings.ts` — 配置类型
- `packages/studio/src/api/lib/provider-adapters/index.ts` — 重试逻辑
- `packages/studio/src/api/lib/provider-adapters/anthropic.ts` — 首 token 超时
- `packages/studio/src/app-next/settings/panels/RuntimeControlPanel.tsx` — 配置 UI

---

## FR-4: 更新系统

检查 GitHub Release 是否有新版本，提示用户下载。

### 需求

- 启动时和手动触发时检查 `https://api.github.com/repos/vivy1024/novelfork/releases/latest`
- 对比当前版本号与最新 release tag
- 如果有新版本：在设置页"服务器与系统"显示更新提示 + 下载链接
- 支持自动下载到 dist/ 目录（可选）
- 更新通道：stable（正式 release）/ beta（pre-release）
- 配置项：`server.updateChannel`、`server.autoCheckUpdate`

### 文件

- `packages/studio/src/types/settings.ts` — 配置
- `packages/studio/src/api/routes/settings.ts` — 检查更新 API
- `packages/studio/src/app-next/settings/SettingsSectionContent.tsx` — 更新 UI

---

## FR-5: 自定义子代理类型

用户可定义新的 subagent 类型，指定专用 prompt、工具权限和默认模型。

### 需求

- 套路页"自定义子代理"面板
- 每个自定义类型包含：
  - 类型名称（如 `security-reviewer`）
  - 描述
  - 系统提示词
  - 允许的工具列表（白名单）
  - 默认模型（留空继承父级）
- Agent 工具的 `subagent_type` 参数支持自定义类型名
- 持久化到 user-config.json
- 自定义类型与内置类型（explore/plan/general/fork）共存

### 存储

```typescript
interface CustomSubagentType {
  name: string;
  description?: string;
  systemPrompt: string;
  allowedTools?: string[];
  defaultModel?: string;
}
```

存储位置：`UserConfig.customSubagents: CustomSubagentType[]`

### 文件

- `packages/studio/src/types/settings.ts` — 类型
- `packages/studio/src/api/lib/session-tool-executor.ts` — Agent handler 支持自定义类型
- `packages/studio/src/app-next/routines/` — 管理 UI

---

## 验收标准

1. 斜杠命令：Composer 输入 `/` 显示补全，选择后展开模板
2. 系统提示词：设置页编辑后，下次对话 agent 行为变化
3. 首 token 超时：网络慢时自动重试，不卡死
4. 更新系统：有新版本时设置页显示提示
5. 自定义子代理：Agent 工具可以使用自定义类型
