# UI Live Parity Hardening v1 Design

## Approach Decision

本 spec 比较过三种路径：

1. **单点 bugfix**：只修章节 textarea 为空。优点是快；缺点是设置页硬编码、会话状态不同步和 parity 口径仍会继续误导验收。
2. **单独 CLI parity spec**：只补 Claude/Codex 对标矩阵。优点是文档边界清楚；缺点是当前最伤用户的 P0 UI 编辑风险不会被解决。
3. **推荐方案：UI live hardening + parity guard 合并**。先修作者实际路径：资源打开/保存、Shell 会话同步、设置页事实口径；再用 Claude/Codex parity 矩阵守住“不把未实现能力写成已接入”。这能直接解决用户反馈的三类问题：UI 组件没工作、没有真实对标 CLI、设置界面硬编码。

本设计采用第三种路径。它不是新产品大改版，而是对已完成 app-next 主线的可用性硬化。

## Investigation Baseline

本设计依据以下事实源修订，避免凭空想象 NarraFork 或 Claude Code：

- 2026-05-06 真实浏览器打开 `http://localhost:7778`，使用用户提供账号登录 NarraFork 0.4.1（顶栏显示更新提示 0.4.1 → 0.4.2）。
- NarraFork `/settings/models` 实测包含默认模型、摘要模型、Explore/Plan 子代理模型、子代理模型池、全局默认推理强度、Codex 默认推理强度、模型列表入口、模型聚合。
- NarraFork `/settings/agent` 实测包含默认权限模式、每条消息最大轮次、旧编码支持、Shell 环境刷新、思考翻译、API request dump、推理默认展开、默认计划模式、宽松规划、只读危险反思确认、可恢复错误重试、沉默工具调用阈值、退避上限、首 token 超时、自定义可重试错误、WebFetch 代理、上下文裁剪/压缩阈值、会话行为、调试可见性、全局目录/命令白名单黑名单。
- NarraFork `/settings/providers` 实测区分平台集成与 API key 接入，并展示供应商总数、已启用数、可用模型数、平台未验证、模型数、API key provider 模型示例。
- NarraFork `/narrators` 与 `/narrators/:id` 实测显示会话列表筛选、排序、归档、模型、消息数、项目/目录、状态；对话页显示工作区/Git 状态、模型选择、推理强度、权限模式、工具调用卡、运行中断与输入区。
- 已有参考文档：`docs/90-参考资料/NarraFork参考/03-NarraFork-UIUX与交互功能调研.md`、`docs/90-参考资料/NarraFork参考/01-NarraFork依赖参考.md`。
- 本地 Claude 源码参考：`claude/restored-cli-src/src/main.tsx` 记录 `--print`、`--output-format stream-json`、`--input-format stream-json`、`--allowedTools`、`--disallowedTools`、`--mcp-config`、`--permission-mode`、`--continue`、`--resume`、`--fork-session`、`--settings`、`--agents`、`--add-dir` 等 CLI surface；`claude/restored-cli-src/src/types/permissions.ts` 记录 permission modes、rule sources、allow/deny/ask；`components/agents/.../ToolsStep.tsx` 与 `components/mcp/MCPSettings.tsx` 记录 agents tool selection 与 MCP server 管理 UI 模式。

结论：NovelFork 借鉴 NarraFork 的信息架构与透明化原则，但不把 NarraFork 字段或 Claude Code CLI 能力自动算作 NovelFork current。每个设置项、会话控件和 parity 项都必须绑定 NovelFork 的真实来源。

## Architecture Overview

```text
Agent Shell /next
  ├─ ShellDataProvider
  │   ├─ books
  │   ├─ active sessions
  │   └─ provider runtime summary
  ├─ WritingWorkbench
  │   ├─ ResourceTree from backend-contract/resource-tree-adapter
  │   ├─ ResourceDetailLoader  ← new hardening boundary
  │   ├─ ResourceViewer
  │   └─ ResourceSaveController
  ├─ ConversationSurface
  │   ├─ recovery presentation
  │   ├─ session config controls
  │   └─ WebSocket/REST snapshot sync
  └─ SettingsLayout
      ├─ SettingsNavigation      ← NarraFork-inspired grouping, NovelFork-owned schema
      ├─ RuntimeControlPanel
      ├─ ProviderSettingsPage
      ├─ AgentRuntimeSettings
      ├─ ConversationTransparencyControls
      ├─ SettingsTruthModel      ← new derived state model
      └─ ParityStatusPanel       ← optional display / matrix source

Studio API / shared contracts
  ├─ resource-client
  ├─ settings/user
  ├─ providers/models/status/summary
  ├─ sessions lifecycle/chat state/tools
  └─ parity baseline docs + verification tests
```

所有 UI 仍通过 `packages/studio/src/app-next/backend-contract/` 的集中 client/adapter 访问后端。组件不得散写未登记 API 字符串；新增详情读取或保存能力时，先补 contract client 方法和 capability matrix，再接组件。

## Resource Detail Hydration

当前资源树 adapter 为章节节点只提供 metadata，没有正文 content。新设计增加 `ResourceDetailLoader`，按 `WorkbenchResourceNode.kind` 决定详情来源：

| Kind | 详情来源 | 编辑来源 | 备注 |
|---|---|---|---|
| `chapter` | `GET /api/books/:bookId/chapters/:chapterNumber` | chapter save API | 必须显示完整正文，禁止空内容保存 |
| `draft` | draft detail/list 中的 content | draft save API | 若 list 已含完整 content 可直接用，否则二次 fetch |
| `candidate` | candidate list/detail content | accept/delete only | 默认不可直接编辑正式正文 |
| `story` | story file detail | readonly unless contract current | 预览必须标明不是完整内容 |
| `truth` | truth file detail | truth save API | 白名单文件，非法文件名显示合同错误 |
| `jingwei-entry` | entry contentMd | jingwei entry update API | section 节点只管理结构，不冒充正文 |
| `narrative-line` | narrative snapshot | readonly | apply 仍走 propose/apply + confirmation |

`ResourceDetailLoader` 输出统一状态：

```ts
type ResourceDetailState =
  | { status: "idle" }
  | { status: "loading"; resourceId: string }
  | { status: "ready"; resourceId: string; content: string; source: "detail" | "preview"; revision?: string; loadedAt: string }
  | { status: "error"; resourceId: string; error: ContractError; retry: () => void };
```

`ResourceViewer` 只在 `status: "ready"` 且资源允许编辑时启用 textarea 与保存按钮。若 source 为 `preview`，保存按钮禁用，并显示“当前仅为列表预览，请打开完整详情或能力未接入”。

## Save Controller and Dirty Guard

保存逻辑从 viewer 事件中抽出为 `ResourceSaveController`：

1. 校验 detail 已 hydrate，拒绝从空编辑器保存。
2. 校验 capability：`edit.current` 才能保存。
3. 根据 kind 调用真实保存 API。
4. 成功后重新读取详情，更新 resource map 中的 content/revision。
5. 失败时保留本地草稿和 dirty 标记。

如果后端已有 hash/revision/updatedAt，应带入 expected revision；若没有，设计允许先以 loadedAt/lastKnownContentHash 在前端拦截明显空覆盖，后续任务再补后端 expected hash。

切换资源、启动写作动作、离开页面时共用 dirty guard。dirty resource 进入 session runtime 的 canvasContext 时，写入类工具继续被拦截，避免 AI 覆盖用户未保存内容。

## Shell Session Synchronization

当前从工作台创建 session 后，右侧 narrator route 能打开，但左侧 Shell 仍显示“暂无活跃会话”。设计增加两层同步：

- `ShellDataProvider.invalidate("sessions")`：session create/fork/resume/restore 成功后刷新 active session list。
- `ShellDataProvider.upsertSession(session)`：创建成功时先乐观插入，避免用户看到空态。

Conversation recovery UI 统一消费 session recovery presentation 的派生结果：REST chat state、WebSocket replay/ack、resetRequired 和 error 只能产生一个可显示状态。服务端返回 idle 或 WebSocket open + ack 完成后，UI 必须从 recovering/reconnect 转为 ready/idle。

## Settings Truth Model

设置页新增 `SettingsTruthModel`，把每个展示字段都绑定到真实来源：

```ts
type SettingsFact<T> = {
  id: string;
  label: string;
  value?: T;
  group:
    | "profile"
    | "models"
    | "agent-runtime"
    | "appearance"
    | "gateway"
    | "providers"
    | "proxy"
    | "chapters"
    | "server"
    | "users"
    | "terminals"
    | "storage"
    | "runtime-resources"
    | "usage"
    | "about"
    | "parity";
  source:
    | "user-settings"
    | "provider-summary"
    | "model-inventory"
    | "platform-accounts"
    | "session-config"
    | "runtime-state"
    | "capability-matrix"
    | "narrafork-reference"
    | "claude-source-reference"
    | "default";
  status: "current" | "partial" | "unconfigured" | "unsupported" | "planned" | "unknown";
  writable: boolean;
  readApi?: string;
  writeApi?: string;
  reason?: string;
  verifiedBy?: "browser" | "unit" | "integration" | "manual-source";
};
```

设置组件只展示 `SettingsFact`，不直接写死“已接入”“可用”“—”。示例规则：

- `Codex 推理强度`：除非 settings schema 有真实字段，否则不显示在普通模型页；若作为 parity 项，显示为 planned/unsupported。
- 默认模型：来自 `settings.user.modelDefaults.defaultSessionModel`，没有则显示 unconfigured；不得使用 `modelOptions[0]`。
- 摘要模型、Explore/Plan 子代理模型、子代理模型池：来自 user settings；模型列表只提供选项，不代表当前值。
- 全局默认推理强度与平台专项推理强度：必须有 settings 字段；若仅在 NarraFork 存在，NovelFork 只能登记 planned/unsupported。
- Agent runtime 设置：default permission mode、max turns、retry/backoff、first token timeout、WebFetch proxy、context trim/compact thresholds、session behavior、debug visibility、global directory allow/deny、global command allow/deny 逐项登记来源；未接 API 前不渲染可编辑控件。
- 运行策略卡片：来自 capability matrix/provider runtime；没有验证的显示 partial/unknown。

保存设置后必须重新读取 `/api/settings/user`，以服务器回读结果更新 UI。若某些设置分布在 session config、provider config 或 runtime resource API，`SettingsTruthModel` 应把读取/写入拆到对应 client，而不是把所有字段塞进一个匿名 settings blob。

## NarraFork-Inspired Settings IA

NovelFork 设置页采用 NarraFork 的信息架构作为参考，但以 NovelFork 已有能力为边界：

| 分组 | 借鉴点 | NovelFork 处理 |
|---|---|---|
| 个人设置 | 个人资料、模型、AI 代理、通知、外观、IM 网关 | 已有字段 current；未实现字段 planned/hidden |
| 实例管理 | 提供商、代理、章节与容器、服务器与系统、用户、终端、储存空间、运行资源、使用历史、关于 | 只显示真实 route 可读/可写项；扫描类页面必须按需触发真实扫描 |
| 模型 | 默认/摘要/子代理模型、模型池、推理强度、模型聚合 | 模型清单只作 options，current 值来自 settings；模型聚合未实现则不显示可配置状态 |
| AI 代理 | 权限模式、轮次、重试、WebFetch、上下文阈值、会话行为、调试、目录/命令规则 | 与 session runtime/tool policy 合同绑定；不能硬编码 NarraFork 文案 |
| 提供商 | 平台集成 vs API key 接入、启用、未验证、模型数量 | 区分 catalog/configured/callable；模型数标清 available/total |

这个 IA 的验收不是“菜单长得像 NarraFork”，而是“每个 visible setting 都能解释真实来源、可写性和不可用原因”。

## Provider and Platform Account Status

Provider 页面区分四种状态：

| 状态 | 含义 | UI 文案 |
|---|---|---|
| Catalog enabled | 平台功能在产品中开放 | “可配置” |
| Configured | 有账号或 API key/provider config | “已配置” |
| Verified | 最近一次测试或平台账号验证通过 | “已验证” |
| Callable | 至少一个 enabled provider/model/account 通过可调用条件 | “可调用” |

Codex/Kiro 平台账号为 0 时只能显示“可导入 / 未配置账号 / 不可调用”。平台卡片若有 provider catalog 但未验证或模型数为 0，应显示“未验证 / 0 个模型 / 不可调用”，不得因为平台存在就显示“已接入”。API key provider 若缺少模型、baseUrl、apiKey 或最近测试失败，卡片显示 degraded/error，并暴露真实恢复动作：添加密钥、刷新模型、测试模型、启用 provider。

统计卡必须拆清楚：provider total、enabled provider、available models、total catalog models、callable models。NarraFork 实测的“67 / 273”这类口径可作为参考，但 NovelFork 必须用自己的 runtime summary 返回字段表达，不能在 UI 端拼字符串。

所有 secret 显示只允许脱敏摘要。账号 JSON 不写入 DOM 快照、日志或测试 fixture。

## Conversation Runtime Transparency

NarraFork 对话页给出的关键借鉴不是视觉样式，而是会话运行态透明化。NovelFork 对话窗口硬化分三层：

1. **Session header facts**：title、binding（book/chapter/workdir）、model、reasoning effort、permission mode、message count、runtime status、context usage。所有字段来自 session config/chat state/provider model inventory。
2. **Tool execution visibility**：tool card 显示 tool name、input summary、duration、status、error、collapsed output、copy/fullscreen action；pending approval 显示 permission source、risk、allow/deny；write tool 显示 target resource、checkpoint/dirty guard。
3. **Runtime side panels**：Git status、container/runtime、snapshots/checkpoints、diff/stage/commit 等只在已有真实 API 时显示；否则不渲染或显示 planned，不允许做静态“Git 面板”。

会话控件更新路径：

```text
UI select/change
  → session config client PATCH
  → server validates provider/model/permission/reasoning
  → refetch chat state/session summary
  → ShellDataProvider upsertSession
  → Conversation header/control reflects persisted value
```

如果 provider 不支持 reasoning，或 session type 不允许某 permission mode，控件禁用并显示 `SettingsFact.status = unsupported` 或 session config validation error。

## Claude Code Parity Guard

新增或更新 `claude-code-parity-baseline.md`，从三类来源记录：

- 本机调查：`claude --version`、`claude --help` 等输出，带日期。
- 官方文档：Claude Code CLI reference，带访问日期。
- 本地源码：`claude/restored-cli-src/src/main.tsx`、`src/types/permissions.ts`、`components/agents/*`、`components/mcp/*` 等文件路径，带读取日期。

矩阵列：

```text
Capability | Upstream evidence | NovelFork status | UI/API/CLI surface | Verification | Notes
```

状态只允许：

- `current`：真实 UI/API/CLI 可用且有测试或浏览器/CLI 验证。
- `partial`：部分可用，差异明确。
- `planned`：计划做但当前不可调用。
- `non-goal`：明确不做。
- `unknown`：信息不足，不能展示为已接入。

Claude 维度覆盖 continue/resume/fork、print/headless、stream-json、permission-mode、allowed/disallowed tools、tool set filtering、MCP config、permission prompt tool、settings file/json、agents json、add-dir、plugins、worktree、Chrome/IDE/server、usage/result。已有 `conversation-parity-v1` 的成果可以复用，但必须重新校验 UI 是否真实可用。

本地源码确认的 permission modes 包括 `acceptEdits`、`bypassPermissions`、`default`、`dontAsk`、`plan` 以及内部 `auto`/`bubble`。NovelFork UI 允许使用产品化中文名称（如逐项询问、允许编辑、全部允许、只读、规划模式、全部拒绝），但 parity matrix 必须把这些名称映射回真实 internal value 和差异；不能把 NarraFork 的权限下拉文案直接当成 Claude Code 原生枚举。

## Codex CLI Parity Guard

新增 `codex-cli-parity-baseline.md`。OpenAI Codex CLI 当前官方文档强调本地 CLI、Rust 实现、TUI、命令行选项、MCP、subagents、non-interactive exec、配置文件、approval modes 与 sandboxing。NovelFork 不直接复制 Codex，但必须避免把 permissionMode 冒充完整 sandbox/approval 模型。

Codex 矩阵至少覆盖：

- TUI / non-interactive exec；
- config file；
- sandbox：read-only、workspace-write、danger-full-access 或官方当前等价项；
- approval：suggest/auto-edit/full-auto 或官方当前 approval policy；
- MCP；
- subagents；
- web search；
- image input；
- code review；
- Windows 原生支持边界。

NovelFork 当前没有真实 OS sandbox 时，状态必须是 `planned`、`partial` 或 `non-goal`，设置页不得显示“Codex sandbox 已接入”。本项目仍坚持 Windows 原生运行，不要求用户切换 WSL。

## Browser E2E Gate

新增浏览器验收场景，优先覆盖真实用户路径而非内部函数：

1. **Workbench chapter edit**：启动 Studio → 打开书籍 → 点击章节 → 断言正文出现 → 修改 → 保存 → 刷新 → 读回。
2. **Settings truthfulness**：打开设置 → AI 供应商 → 断言 0 账号平台显示“不可调用/未配置” → 运行策略卡片不含固定“已接入”。
3. **Session sync**：从工作台点击“生成下一章” → 创建 session → Shell 侧栏出现 session → recovery 状态进入 ready/idle。
4. **Conversation transparency**：打开 narrator route → 断言 header 显示真实 session binding/model/reasoning/permission → 切换配置并回读 → 展开真实 tool card → running 时中断按钮可用，idle 时不可显示假运行。
5. **Search sanity**：搜索章节/Truth 内容 → 结果可点击并打开对应资源。

测试可以使用真实 compiled server 或 app-next dev server；如果不调用模型，应使用 max-turns、prompt-preview 或 provider-unavailable 路径验证 UI 行为，不能伪造生成成功。允许以 NarraFork 7778 作为人工参考验证，但 NovelFork 验收必须跑 NovelFork 自己的 `/next` 页面。

## Error Handling

- 详情加载失败：资源画布显示错误和 retry，不清空已有内容。
- 保存失败：保留草稿和 dirty 标记，显示 contract error code。
- 设置保存失败：保留本地草稿，允许恢复服务器值。
- provider 测试失败：写回真实 lastTestStatus/lastTestError，脱敏展示。
- session recovery 失败：显示 failed/retry/resetRequired，不继续显示 ready。
- parity 来源缺失：标 unknown，不进入 current 能力矩阵。

## Documentation Strategy

本 spec 创建时更新 `.kiro/specs/README.md` 和 `CHANGELOG.md`。实现阶段每完成一个任务，应同步：

- `docs/01-当前状态/02-Studio能力矩阵.md`：把 UI 能力标为 current/partial/needs-browser-verification。
- `docs/01-当前状态/03-当前执行主线.md`：记录 active hardening 进度。
- `docs/08-测试与质量/01-当前测试状态.md`：记录新增浏览器 E2E/集成测试。
- `packages/studio/README.md`：记录设置项来源和 UI 验收命令。

不得把未跑过浏览器路径的能力写为“真实可用”。

## Test Strategy

- Unit：`ResourceDetailLoader` kind routing、`SettingsTruthModel` fact derivation、provider callable state、parity matrix status validator、session transparency state derivation。
- Component：ResourceViewer loading/error/ready/dirty/save；RuntimeControlPanel 不使用 first model fallback；ProviderSettingsPage 0 账号状态；ConversationSurface header/control/tool-card truthfulness。
- API/contract：resource detail/save routes、settings read/write、provider summary/model status、session lifecycle refresh、session config update/refetch。
- Browser E2E：章节打开保存读回、设置页真状态、session 创建后 Shell 同步、对话窗口配置/工具/中断状态透明化。
- Regression guard：禁止 `SettingsSectionContent` 中出现无来源 Codex 空字段；禁止 ProviderSettingsPage 固定“已接入”卡片；禁止章节 ready 状态下 textarea 为空但 API content 非空；禁止对话窗口静态显示模型/权限/推理强度而不绑定 session config。

## Validation Commands

实现阶段至少运行：

```bash
pnpm --dir packages/studio test -- app-next
pnpm --dir packages/studio test -- backend-contract
pnpm --dir packages/studio typecheck
pnpm docs:verify
```

涉及 CLI parity 或 headless 行为时追加：

```bash
pnpm --dir packages/cli test
```

涉及 compiled Studio 冒烟时追加：

```bash
pnpm --dir packages/studio compile
```

并使用真实浏览器或 Playwright 对本 spec 的 E2E 场景执行验收。
