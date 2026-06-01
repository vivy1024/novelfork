# Conversation Parity v1 Design

## 总体设计

本 spec 在 live Conversation 可用后，把 Claude Code CLI 中对 NovelFork 有价值的会话能力产品化。实现采用分层设计：UI 命令和会话 UX 走 app-next；会话生命周期、compact、permission policy、checkpoint 走 Studio API service；headless stream-json 通过 API 与 CLI 双入口复用同一运行时。

```
Conversation UI
  ├─ SlashCommandRegistry
  ├─ SessionLifecyclePanel / ResumePicker / ForkDialog
  ├─ CompactStatus / ContextBudget
  ├─ ToolPolicyPanel
  └─ CheckpointRewindDialog

Studio API
  ├─ session lifecycle service
  ├─ compact service
  ├─ tool policy service
  ├─ checkpoint service
  └─ headless chat stream-json service

CLI
  └─ novelfork chat / novelfork session
      → same headless API
```

## 会话生命周期

新增 session lifecycle service，封装：

- continue latest：按 book/project scope 和 lastModified 取最新 active session。
- resume session：打开指定 session 并返回 chat state/cursor。
- fork session：创建新 session，继承原 session 的标题、agentId、sessionMode、sessionConfig、绑定信息、compact summary 和必要上下文摘要。
- archived handling：归档会话默认只读；用户可恢复后继续。

fork 不复制完整无限历史到新 session；它应生成一条 system/summary 消息，说明 fork 来源、时间和摘要，避免上下文爆炸。

## Slash Command Registry

前端新增命令 registry：

```ts
type SlashCommand = {
  name: string;
  description: string;
  parse(input: string): CommandInvocation;
  execute(context: ConversationCommandContext): Promise<CommandResult>;
};
```

首批命令：

- `/compact [instructions]`
- `/model [provider:model]`
- `/permission [ask|edit|allow|read|plan]`
- `/fork [title]`
- `/resume [sessionId]`
- `/status`
- `/help`

命令由 Composer 拦截，不作为普通用户消息发送给模型。命令结果以 system message 或 lightweight status item 展示。

## Compact 与 Memory

后端已有 `microCompact` 资产，本阶段将其产品化为 compact service：

1. 输入 sessionId、可选 instructions、消息范围和预算信息。
2. 生成 summary，包含剧情状态、人物状态、未完成任务、工具确认状态、当前书籍/章节上下文。
3. 写入 session compact record。
4. 后续 turn 构造上下文时使用 compact summary + 最近消息。

Memory 写入必须区分：

- 用户偏好：跨项目，需显式确认或满足稳定偏好规则。
- 项目事实：项目级，需可追踪来源。
- 临时剧情草稿：不自动写长期 memory。

## 工具权限策略

在 session config 上扩展 tool policy：

```ts
type SessionToolPolicy = {
  allow?: string[];
  deny?: string[];
  ask?: string[];
};
```

执行工具时合并四层规则：

1. 模型是否支持工具；
2. permissionMode；
3. tool policy allow/deny/ask；
4. resource risk 与 dirty canvasContext。

输出错误区分：`unsupported-tools`、`policy-denied`、`permission-required`、`dirty-resource-blocked`。

## Headless stream-json

新增 API 与 CLI 共用事件协议。建议事件类型：

- `user_message`
- `assistant_delta`
- `assistant_message`
- `tool_use`
- `tool_result`
- `permission_request`
- `error`
- `result`

API 可以是新增 `/api/sessions/headless-chat` 或扩展现有 `/api/exec`，最终选择以不破坏 `novelfork exec` 为准。CLI 建议新增：

```bash
novelfork chat --session <id> --input-format stream-json --output-format stream-json
novelfork chat -p "审校第 12 章" --book <bookId> --json
```

headless 模式必须复用 AgentTurnRuntime 和 session tools，不能另起一套假 agent loop。

## Checkpoint 与 Rewind

Checkpoint service 记录正式资源写入前状态：

```ts
type ResourceCheckpoint = {
  id: string;
  sessionId: string;
  messageId?: string;
  toolUseId?: string;
  createdAt: string;
  resources: Array<{ kind: string; id: string; path?: string; beforeHash: string; snapshotRef: string }>;
};
```

触发点：

- Workbench 对正式章节/story/truth/jingwei 的保存。
- session tool 对正式资源的 confirmed write。
- narrative apply 等需要确认的正式写入。

候选稿创建、草稿创建和 prompt-preview 不强制 checkpoint，因为它们本身是非破坏性边界。

Rewind 流程：

1. 用户选择消息或 checkpoint。
2. UI 请求 rewind preview。
3. 后端返回资源列表、diff/hash、风险。
4. 用户确认。
5. 后端恢复快照并写审计事件。

## 用量与结果统计

每个 turn/run 记录：

- duration_ms / duration_api_ms；
- num_turns；
- stop_reason；
- usage / modelUsage；
- permission_denials；
- errors；
- session_id；
- cost：provider 不提供时为 unknown，不虚构 USD。

UI 展示三种层级：当前 turn、当前 session 累计、headless run result。

## 错误处理

- slash command parse 失败：显示命令错误，不调用模型。
- compact 失败：保留原消息，不写 compact record。
- fork 失败：不创建新 session 或删除半成品。
- tool policy deny：返回 tool_result 错误，并记录 permission_denials。
- headless 中断：输出 error/result envelope，exit code 由 CLI 映射。
- rewind 冲突：返回 conflict，不覆盖用户新改动。

## 测试策略

- Unit：slash parser、tool policy matcher、context budget、checkpoint hash。
- API：continue/latest、fork、compact、headless stream-json、rewind preview/apply。
- UI：resume picker、slash suggestions、compact status、tool policy panel、rewind dialog。
- CLI：`novelfork chat --json`、stream-json input/output、sessionId 复用、权限 pending。
- Regression：确认候选稿/草稿非破坏性边界不被 checkpoint/rewind 误判。

## 验收命令

至少运行：

```bash
pnpm --dir packages/studio test -- session
pnpm --dir packages/studio test -- app-next
pnpm --dir packages/cli test
pnpm --dir packages/studio typecheck
pnpm docs:verify
```

涉及 core runtime 时同步运行 core typecheck/test。