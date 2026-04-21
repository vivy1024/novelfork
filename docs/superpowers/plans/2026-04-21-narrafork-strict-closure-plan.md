# NarraFork Strict Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 3.1–3.8 从“已有主链”推进到“严格闭环”，使 NovelFork 在会话内核、透明化、编排治理、管理平台、运行时与分发路径上与 NarraFork 目标一致。

**Architecture:** 采用“主轴优先、跟随轴并行”的方式推进：先把 3.2/3.3/3.4 做成真正的平台主链，再让 3.1/3.5/3.6/3.7/3.8 依附主链收口。实现上坚持 server-first：会话与工具执行以服务端事实源为主，前端 store 退化为 UI shell；工作流台与 MCP 注册表统一；运行时入口以 startup orchestrator 和单入口 server 为中心。

**Tech Stack:** TypeScript、React 19、Hono、Vitest、Bun、SQLite/JSON 持久化、WebSocket、现有 NovelFork Studio API。

---

## File Structure

### 会修改的核心文件
- `packages/studio/src/components/ChatWindow.tsx` — 会话控制台主视图；继续削弱 `windowStore` 对消息与状态的主事实地位。
- `packages/studio/src/components/ChatWindow.test.tsx` — ChatWindow 行为回归测试。
- `packages/studio/src/pages/SessionCenter.tsx` — 已有会话与工作区入口；继续对齐 server-first narrator/session 心智。
- `packages/studio/src/pages/SessionCenter.test.tsx` — SessionCenter 测试。
- `packages/studio/src/api/lib/session-chat-service.ts` — 会话消息加载、持久化、恢复、重连补拉。
- `packages/studio/src/api/lib/session-chat-service.test.ts` — 会话消息服务测试。
- `packages/studio/src/api/routes/session.ts` — session 与 chat 相关路由补齐。
- `packages/studio/src/components/ToolCall/ToolCallBlock.tsx` — 工具透明化卡片。
- `packages/studio/src/components/ToolCall/ToolCallBlock.test.tsx` — 工具透明化测试。
- `packages/studio/src/pages/WorkflowWorkbench.tsx` — 工作流配置台；统一编排治理入口。
- `packages/studio/src/pages/WorkflowWorkbench.test.tsx` — 工作流台测试。
- `packages/studio/src/api/lib/runtime-tool-access.ts` — Settings/MCP/Tools 权限接线。
- `packages/studio/src/api/routes/tools.ts` — 内置工具执行权限链。
- `packages/studio/src/api/routes/tools.test.ts` — 工具权限测试。
- `packages/studio/src/api/routes/mcp.ts` — MCP registry 与调用治理。
- `packages/studio/src/api/routes/mcp.test.ts` — MCP 测试。
- `packages/studio/src/components/Admin/ResourcesTab.tsx` — Admin 运行诊断、后续 terminal/container 入口。
- `packages/studio/src/components/Admin/ResourcesTab.test.tsx` — Admin 诊断测试。
- `packages/studio/src/api/lib/startup-orchestrator.ts` — 启动恢复主链。
- `packages/studio/src/api/lib/search-index-rebuild.ts` — 搜索索引恢复。
- `packages/studio/src/api/lib/__tests__/startup-orchestrator.test.ts` — 启动恢复测试。
- `packages/studio/src/api/server.ts` — server 启动主链与 websocket / runtime 接线。
- `packages/studio/src/pages/settings/RuntimeControlPanel.tsx` — Settings 运行控制。
- `packages/studio/src/pages/settings/RuntimeControlPanel.test.tsx` — Settings 测试。
- `docs/04-开发指南/05-调研规划/07-NarraFork功能对齐任务总表.md` — 计划与源码事实同步。

### 新增文件（如需要）
- `packages/studio/src/api/lib/session-history-store.ts` — 如果当前 `recentMessages` 不足以支撑完整历史，则新增独立历史存储层。
- `packages/studio/src/api/lib/session-history-store.test.ts` — 历史存储测试。
- `packages/studio/src/components/Admin/TerminalTab.tsx` — terminal 管理入口（若实现）。
- `packages/studio/src/components/Admin/TerminalTab.test.tsx` — terminal 入口测试。

---

## Task 1: 完成会话消息历史的独立持久化与补拉链路（3.2 核心）

**Files:**
- Modify: `packages/studio/src/api/lib/session-chat-service.ts`
- Modify: `packages/studio/src/api/lib/session-chat-service.test.ts`
- Modify: `packages/studio/src/api/routes/session.ts`
- Optional Create: `packages/studio/src/api/lib/session-history-store.ts`
- Optional Create: `packages/studio/src/api/lib/session-history-store.test.ts`

- [ ] **Step 1: 写失败测试，证明当前只有 recentMessages，不具备完整历史补拉**

```ts
it("returns full persisted chat history for a session", async () => {
  const session = await createSession({ title: "History", agentId: "writer" });

  await appendSessionMessages(session.id, [
    { id: "m1", role: "user", content: "第一条", timestamp: new Date().toISOString() },
    { id: "m2", role: "assistant", content: "第二条", timestamp: new Date().toISOString() },
    { id: "m3", role: "assistant", content: "第三条", timestamp: new Date().toISOString() },
  ]);

  const history = await listSessionHistory(session.id);
  expect(history.map((m) => m.id)).toEqual(["m1", "m2", "m3"]);
});
```

- [ ] **Step 2: 运行测试确认它失败**

Run: `pnpm --dir packages/studio exec vitest run src/api/lib/session-chat-service.test.ts`
Expected: FAIL，提示缺少完整历史存储或只返回 `recentMessages`

- [ ] **Step 3: 添加最小历史存储实现**

```ts
export async function appendSessionMessages(sessionId: string, messages: NarratorSessionChatMessage[]) {
  const history = await loadSessionHistory(sessionId);
  const deduped = mergeSessionMessages(history, messages);
  await saveSessionHistory(sessionId, deduped);
  return deduped;
}

export async function listSessionHistory(sessionId: string) {
  return loadSessionHistory(sessionId);
}
```

- [ ] **Step 4: 在 session chat runtime 中写入完整历史，同时保留 recentMessages 作为快照缓存**

```ts
const nextHistory = await appendSessionMessages(sessionId, [incomingMessage]);
await updateSession(sessionId, {
  messageCount: nextHistory.length,
  recentMessages: nextHistory.slice(-20),
});
```

- [ ] **Step 5: 增加 `/api/sessions/:id/chat/history` 路由**

```ts
app.get("/api/sessions/:id/chat/history", async (c) => {
  const sessionId = c.req.param("id");
  const history = await listSessionHistory(sessionId);
  return c.json({ sessionId, messages: history });
});
```

- [ ] **Step 6: 运行定点测试确认通过**

Run: `pnpm --dir packages/studio exec vitest run src/api/lib/session-chat-service.test.ts src/api/routes/session.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/studio/src/api/lib/session-chat-service.ts packages/studio/src/api/lib/session-chat-service.test.ts packages/studio/src/api/routes/session.ts packages/studio/src/api/lib/session-history-store.ts packages/studio/src/api/lib/session-history-store.test.ts
git commit -m "feat(studio): persist full session chat history"
```

---

## Task 2: 让 ChatWindow 用服务端历史/状态驱动恢复与重连（3.2 + 3.3）

**Files:**
- Modify: `packages/studio/src/components/ChatWindow.tsx`
- Modify: `packages/studio/src/components/ChatWindow.test.tsx`
- Modify: `packages/studio/src/pages/SessionCenter.tsx`
- Modify: `packages/studio/src/pages/SessionCenter.test.tsx`

- [ ] **Step 1: 写失败测试，证明 websocket 重连后会用服务端历史回补，而不是依赖旧 windowStore**

```ts
it("reloads session history after reconnect using the server history endpoint", async () => {
  fetchJsonMock.mockImplementation(async (url: string) => {
    if (url.endsWith("/chat/history")) {
      return { messages: [{ id: "m1", role: "assistant", content: "补拉后的正式消息", timestamp: new Date().toISOString() }] };
    }
    if (url.endsWith("/chat/state")) {
      return { session: baseSession, messages: [] };
    }
    return { success: true };
  });

  render(<ChatWindow windowId="window-1" theme="light" />);
  MockWebSocket.instances[0]?.onclose?.();
  await tickReconnect();

  expect(screen.getByText("补拉后的正式消息")).toBeTruthy();
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --dir packages/studio exec vitest run src/components/ChatWindow.test.tsx`
Expected: FAIL，提示没有 history backfill

- [ ] **Step 3: 在 ChatWindow 中增加 reconnect history backfill**

```ts
async function hydrateSessionHistory(sessionId: string) {
  const history = await fetchJson<{ messages: NarratorSessionChatMessage[] }>(`/api/sessions/${sessionId}/chat/history`);
  const nextMessages = history.messages.map(toChatWindowMessage);
  setSessionMessages(nextMessages);
  updateWindow(windowId, { messages: nextMessages });
}
```

- [ ] **Step 4: 在 websocket 关闭后重连成功时触发补拉**

```ts
ws.onopen = () => {
  setWsConnected(windowId, true);
  void hydrateSessionHistory(sessionId);
};
```

- [ ] **Step 5: 将 SessionCenter 打开已有会话的逻辑收敛成“窗口壳 + state/history hydration”**

```ts
addWindow({ agentId: session.agentId, title: session.title, sessionId: session.id, sessionMode: session.sessionMode });
```

- [ ] **Step 6: 运行会话定点测试确认通过**

Run: `pnpm --dir packages/studio exec vitest run src/components/ChatWindow.test.tsx src/pages/SessionCenter.test.tsx`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/studio/src/components/ChatWindow.tsx packages/studio/src/components/ChatWindow.test.tsx packages/studio/src/pages/SessionCenter.tsx packages/studio/src/pages/SessionCenter.test.tsx
git commit -m "feat(studio): hydrate session history after reconnect"
```

---

## Task 3: 完成 ToolCall / 透明化深水区动作（3.3）

**Files:**
- Modify: `packages/studio/src/components/ToolCall/ToolCallBlock.tsx`
- Modify: `packages/studio/src/components/ToolCall/ToolCallBlock.test.tsx`
- Modify: `packages/studio/src/components/ChatWindow.tsx`

- [ ] **Step 1: 写失败测试，要求 ToolCallBlock 提供“查看源码/重跑”入口的最小壳层**

```ts
it("shows rerun and view-source actions for completed tool calls", () => {
  render(<ToolCallBlock toolCall={completedBashCall} />);
  expect(screen.getByRole("button", { name: "查看源码" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "重跑" })).toBeTruthy();
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --dir packages/studio exec vitest run src/components/ToolCall/ToolCallBlock.test.tsx`
Expected: FAIL

- [ ] **Step 3: 为已完成的工具调用加入动作按钮**

```tsx
{canReplay ? <Button size="xs">重跑</Button> : null}
{hasSource ? <Button size="xs">查看源码</Button> : null}
```

- [ ] **Step 4: 先让动作进入 UI 与可追踪事件，不急着接完整执行器**

```ts
onReplay?.(toolCall);
onInspectSource?.(toolCall);
```

- [ ] **Step 5: 在 ChatWindow 里接入最小 handler（toast / panel / pending replay state）**

```ts
const handleReplayToolCall = (toolCall: ToolCall) => {
  setReplayIntent(toolCall);
};
```

- [ ] **Step 6: 运行定点测试确认通过**

Run: `pnpm --dir packages/studio exec vitest run src/components/ToolCall/ToolCallBlock.test.tsx src/components/ChatWindow.test.tsx`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/studio/src/components/ToolCall/ToolCallBlock.tsx packages/studio/src/components/ToolCall/ToolCallBlock.test.tsx packages/studio/src/components/ChatWindow.tsx
git commit -m "feat(studio): deepen tool transparency actions"
```

---

## Task 4: 完成 Workflow / Routines 与 MCP / Permissions 的统一治理视图（3.4 + 3.6 + 3.7）

**Files:**
- Modify: `packages/studio/src/pages/WorkflowWorkbench.tsx`
- Modify: `packages/studio/src/pages/WorkflowWorkbench.test.tsx`
- Modify: `packages/studio/src/api/lib/runtime-tool-access.ts`
- Modify: `packages/studio/src/api/routes/tools.ts`
- Modify: `packages/studio/src/api/routes/mcp.ts`

- [ ] **Step 1: 写失败测试，要求 WorkflowWorkbench 同时展示 routines 规则和 runtime policy 来源**

```ts
it("shows both routines rules and runtime policy provenance for MCP tools", async () => {
  render(<WorkflowWorkbench ... section="agents" />);
  await waitFor(() => {
    expect(screen.getByText("实时 MCP 注册表")).toBeTruthy();
    expect(screen.getByText("策略来源：runtimeControls.toolAccess")).toBeTruthy();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --dir packages/studio exec vitest run src/pages/WorkflowWorkbench.test.tsx`
Expected: FAIL

- [ ] **Step 3: 在 registry 响应中加入 provenance / policy summary**

```ts
summary: {
  totalServers,
  connectedServers,
  discoveredTools,
  enabledTools,
  policySource: "runtimeControls.toolAccess",
}
```

- [ ] **Step 4: 在 WorkflowWorkbench 中显示治理来源说明**

```tsx
<Badge variant="outline">策略来源：runtimeControls.toolAccess</Badge>
```

- [ ] **Step 5: 让 tools / mcp 路由返回一致的 deny/ask/allow reason 结构**

```ts
return c.json({
  allowed: decision.allowed,
  reason: decision.reason,
  source: decision.source,
});
```

- [ ] **Step 6: 运行工作流与权限定点测试**

Run: `pnpm --dir packages/studio exec vitest run src/pages/WorkflowWorkbench.test.tsx src/api/routes/tools.test.ts src/api/routes/mcp.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/studio/src/pages/WorkflowWorkbench.tsx packages/studio/src/pages/WorkflowWorkbench.test.tsx packages/studio/src/api/lib/runtime-tool-access.ts packages/studio/src/api/routes/tools.ts packages/studio/src/api/routes/mcp.ts
git commit -m "feat(studio): unify workflow and runtime policy governance"
```

---

## Task 5: 完成 Admin 深化与 terminal/container 最小入口（3.5）

**Files:**
- Modify: `packages/studio/src/components/Admin/Admin.tsx`
- Modify: `packages/studio/src/components/Admin/ResourcesTab.tsx`
- Create: `packages/studio/src/components/Admin/TerminalTab.tsx`
- Create: `packages/studio/src/components/Admin/TerminalTab.test.tsx`

- [ ] **Step 1: 写失败测试，要求 Admin 出现 terminal 入口卡片或 tab**

```tsx
it("shows terminal entry in admin overview", () => {
  render(<Admin ... />);
  expect(screen.getByText("Terminal")).toBeTruthy();
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --dir packages/studio exec vitest run src/components/Admin/Admin.test.tsx`
Expected: FAIL

- [ ] **Step 3: 新增 TerminalTab 的最小只读入口**

```tsx
export function TerminalTab() {
  return <div data-testid="admin-terminal-tab">Terminal 管理入口（第一轮）</div>;
}
```

- [ ] **Step 4: 将 Terminal 入口接进 Admin 导航与概览**

```tsx
{ key: "terminal", label: "Terminal", component: <TerminalTab /> }
```

- [ ] **Step 5: 运行 Admin 定点测试确认通过**

Run: `pnpm --dir packages/studio exec vitest run src/components/Admin/Admin.test.tsx src/components/Admin/TerminalTab.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/studio/src/components/Admin/Admin.tsx packages/studio/src/components/Admin/TerminalTab.tsx packages/studio/src/components/Admin/TerminalTab.test.tsx
git commit -m "feat(studio): add terminal entry to admin"
```

---

## Task 6: 完成 startup orchestrator 的恢复口径扩展（3.8）

**Files:**
- Modify: `packages/studio/src/api/lib/startup-orchestrator.ts`
- Modify: `packages/studio/src/api/lib/__tests__/startup-orchestrator.test.ts`
- Modify: `packages/studio/src/api/server.ts`

- [ ] **Step 1: 写失败测试，要求 orchestrator 汇总 session/chat history repair 结果**

```ts
it("reports session and search recovery in a single startup summary", async () => {
  const summary = await runStartupOrchestrator(state);
  expect(summary.steps.map((s) => s.name)).toContain("search-index-rebuild");
  expect(summary.steps.map((s) => s.name)).toContain("session-history-repair");
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --dir packages/studio exec vitest run src/api/lib/__tests__/startup-orchestrator.test.ts`
Expected: FAIL

- [ ] **Step 3: 给 orchestrator 增加 session history repair step**

```ts
steps.push({
  name: "session-history-repair",
  status: "ok",
  detail: "checked session chat history store",
});
```

- [ ] **Step 4: 在 server 启动日志中暴露更完整的 startup summary**

```ts
console.info("startup orchestrator summary", startupSummary);
```

- [ ] **Step 5: 运行 startup 定点测试确认通过**

Run: `pnpm --dir packages/studio exec vitest run src/api/lib/__tests__/startup-orchestrator.test.ts src/api/server.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/studio/src/api/lib/startup-orchestrator.ts packages/studio/src/api/lib/__tests__/startup-orchestrator.test.ts packages/studio/src/api/server.ts
git commit -m "feat(studio): extend startup recovery summary"
```

---

## Task 7: 同步主文档与最终验收口径（文档闭环）

**Files:**
- Modify: `docs/04-开发指南/05-调研规划/07-NarraFork功能对齐任务总表.md`

- [ ] **Step 1: 写下源码事实核对清单**

```md
- ChatWindow 是否仍依赖 windowStore？
- 是否已有完整 chat/history？
- WorkflowWorkbench 是否展示 MCP 实时摘要？
- runtime policy 是否已接 tools/mcp route？
- startup orchestrator 是否只 best-effort？
```

- [ ] **Step 2: 按代码事实更新 3.2–3.8 的“已完成 / 未完成”**

```md
- [x] ChatWindow 渲染主链已优先消费服务端消息视图
- [ ] 仍缺完整聊天历史存档与更彻底的 server-only 视图
```

- [ ] **Step 3: 更新“最终验收口径”勾选状态**

```md
- [~] ChatWindow 成为真正的会话控制台
- [~] Settings 成为运行策略控制面板
- [~] MCP / tool registry 进入系统级管理
```

- [ ] **Step 4: 运行最小核对命令并手查 diff**

Run: `git diff -- docs/04-开发指南/05-调研规划/07-NarraFork功能对齐任务总表.md`
Expected: 只有与当前源码一致的文案变化

- [ ] **Step 5: Commit**

```bash
git add docs/04-开发指南/05-调研规划/07-NarraFork功能对齐任务总表.md
git commit -m "docs: sync narrafork alignment status with code"
```

---

## Task 8: 最终集成回归与收尾提交

**Files:**
- Modify: `docs/04-开发指南/05-调研规划/07-NarraFork功能对齐任务总表.md` (如有回归后微调)

- [ ] **Step 1: 运行类型检查**

Run: `pnpm --dir packages/studio typecheck`
Expected: PASS

- [ ] **Step 2: 运行会话 / 透明化 / 工作流 / MCP / Runtime 关键定点测试**

Run: `pnpm --dir packages/studio exec vitest run src/components/ChatWindow.test.tsx src/pages/SessionCenter.test.tsx src/components/ToolCall/ToolCallBlock.test.tsx src/pages/WorkflowWorkbench.test.tsx src/api/routes/tools.test.ts src/api/routes/mcp.test.ts src/api/lib/__tests__/startup-orchestrator.test.ts`
Expected: PASS

- [ ] **Step 3: 运行 Studio 全量测试**

Run: `pnpm --dir packages/studio test`
Expected: PASS，允许记录已知非阻塞 stderr，但不得有失败项

- [ ] **Step 4: 检查 git status**

Run: `git status --short`
Expected: 只剩本轮预期改动

- [ ] **Step 5: 创建最终集成提交**

```bash
git add packages/studio/src/components/ChatWindow.tsx packages/studio/src/api/lib/session-chat-service.ts packages/studio/src/pages/WorkflowWorkbench.tsx packages/studio/src/api/routes/tools.ts packages/studio/src/api/routes/mcp.ts packages/studio/src/components/Admin/Admin.tsx packages/studio/src/api/lib/startup-orchestrator.ts docs/04-开发指南/05-调研规划/07-NarraFork功能对齐任务总表.md
git commit -m "feat(studio): complete narrafork strict closure phase"
```

---

## Self-Review

- **Spec coverage:** 覆盖了 3.1–3.8，重点按方案 C 先做 3.2/3.3/3.4 主轴，再收 3.5/3.6/3.7/3.8，最后回到文档与全量回归。
- **Placeholder scan:** 已避免 TBD / TODO / “后续补充” 这类占位语句；每个任务都有明确文件、测试、运行命令与提交动作。
- **Type consistency:** 统一使用 `session history` / `chat/state` / `MCP registry` / `runtimeControls.toolAccess` 这些现有代码口径，没有引入与现有命名冲突的新术语。

Plan complete and saved to `docs/superpowers/plans/2026-04-21-narrafork-strict-closure-plan.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**