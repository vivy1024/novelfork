# Frontend Live Wiring v1 Design

## 总体设计

本阶段把 `frontend-refoundation-v1` 产出的组件资产接成真实可用的 `/next` 产品路径。核心原则是：`StudioNextApp` 只负责 route orchestration，数据获取和状态机分别下沉到已存在的 domain client、runtime hook 和 Workbench hook，UI 组件只消费 props。

```
StudioNextApp
  ├─ AgentShell / ShellSidebar / shell-route
  ├─ ConversationRouteLive
  │   ├─ useAgentConversationRuntime(sessionId)
  │   ├─ provider/session domain clients
  │   └─ ConversationSurface
  └─ WritingWorkbenchRouteLive
      ├─ loadWorkbenchResourcesFromContract(resourceClient, bookId)
      ├─ selected resource + dirty state
      ├─ WorkbenchCanvas / ResourceViewers
      └─ WorkbenchWritingActions
```

`ConversationRouteLive` 和 `WritingWorkbenchRouteLive` 可以直接演进现有 route 文件，也可以作为薄 wrapper 引入；命名不强制，但职责必须清晰：route 负责接线，不在一个文件里堆大量 UI 分支。

## Conversation 接线

1. route 从 URL 获取 `sessionId`。
2. 调用 `useAgentConversationRuntime({ sessionId })`。
3. 将 runtime state 映射到 `ConversationSurface`：
   - `messages` → `MessageStream`
   - `streamingContent/isRunning` → Composer 状态
   - `recovery` → recovery notice
   - `pendingConfirmations` → ConfirmationGate
   - `session.sessionConfig/cumulativeUsage` → ConversationStatusBar
4. 发送消息使用 runtime action，附带当前可用 canvasContext。
5. 中断使用 runtime abort action。
6. ack 由 runtime/reducer 根据最新 cursor 维护，不在 UI 组件内手写序号逻辑。

## 状态栏与模型池

状态栏新增一个轻量数据加载层：通过 `createProviderClient(createFetchJsonContractClient())` 拉取模型池，通过 session client 更新 `sessionConfig`。模型池为空或当前模型不可用时，Composer 禁用并给出设置页链接。

权限模式沿用当前 NovelFork 语义：`ask/edit/allow/read/plan`。本阶段不把它强行映射到 Claude Code 的 `acceptEdits/default/dontAsk`，只保证 UI、session config 和后端工具过滤一致。

## Tool Result Renderer 接线

`MessageItem` 不再只渲染简化 `ToolCallCard`。它应把每个 tool call/result 规范化为 renderer registry 输入：

- 优先读 `toolCall.renderer`。
- 其次读 `message.metadata.renderer`。
- 再按 toolName 前缀匹配。
- 找不到则走 generic renderer。

renderer 的 artifact open 动作通过 route 层传入，最终打开到当前 Workbench canvas 或导航到对应 book workbench。没有可用 book/workbench 上下文时，动作显示 disabled reason。

## Writing Workbench 接线

`/next/books/:bookId` 当前不能再传 `nodes=[]` 和 noop。route 需要维护：

- `nodes`：来自 `loadWorkbenchResourcesFromContract()`。
- `selectedNode`：用户点击资源树后设置。
- `content/draft/dirty`：由 `WorkbenchCanvas` 管理并通过 callback 抛出。
- `save`：根据 node capability 调用对应 resource client 保存入口。
- `canvasContext`：包含 active resource、dirty、selection、open tabs 的摘要。

资源保存必须尊重 capability：可编辑才调用保存；readonly/unsupported 禁用按钮。

## Writing Actions 接线

`WorkbenchWritingActions` 读取 action descriptors 和 session client：

1. 计算当前 action 能力状态。
2. 查询/复用 book 绑定 active writer session。
3. 无 session 时创建 `kind: standalone` 或符合当前 session service 支持的绑定结构，并写入 `projectId: bookId`。
4. 导航到 `/next/narrators/:sessionId`。
5. 下一条消息或 action prompt 带上 canvasContext，避免 Agent 不知道用户当前编辑对象。

如果 action 是 prompt-preview 或 unsupported，按钮使用合同状态展示，不执行写入。

## Shell 次级页面

Search、Routines、Settings 必须从“稍后接线”转为真实挂载：

- Search：优先挂现有 `app-next/search` 页面；如果后端能力缺失，显示 contract unsupported。
- Routines：挂现有 routines/MCP/skills 管理页面。
- Settings：挂现有 settings panel，至少保证 provider/model 配置入口可达。

## 错误处理

- REST 失败：展示 contract error code/message/capability。
- WebSocket 失败：保留 `session:error` 和 recovery envelope。
- history gap：使用 resetRequired 路径重新 hydrate，不能拼接错乱消息。
- 保存失败：保持 dirty，不显示已保存。
- action unsupported：按钮禁用，不发送消息。

## 测试策略

- Route integration tests：验证 `StudioNextApp` 不再给 Workbench 传空 nodes/noop，不再用静态 Conversation props。
- Runtime tests：复用/扩展现有 `useAgentConversationRuntime` 测试。
- Surface tests：覆盖 renderer registry、确认门、模型池为空、config update 失败。
- Workbench tests：覆盖真实 resource client mock、资源打开/保存/只读/unsupported、dirty canvasContext。
- Smoke：浏览器访问 `/next`、`/next/narrators/:id`、`/next/books/:id`、settings/routines/search。

## 验收命令

至少运行：

```bash
pnpm --dir packages/studio test -- app-next
pnpm --dir packages/studio typecheck
pnpm docs:verify
```

若本阶段修改后端合同测试，也需运行对应 API Vitest。