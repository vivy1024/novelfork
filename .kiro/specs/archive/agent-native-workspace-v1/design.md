# Agent-native Workspace v1 Design

## Overview

Agent-native Workspace v1 将 NovelFork 的工作台从 page-first 改回 session-first：右侧固定叙述者会话是主操作系统；中间画布展示被打开的资源和 Agent 产物；左侧整合全局导航与当前书籍资源管理器。驾驶舱、问卷、PGI、写作、候选稿、经纬和叙事线都作为 Agent tools 进入会话工具循环，再由 UI 渲染为卡片、画布资源或确认弹层。

本设计直接参考项目内 Claude Code CLI 源码的交互范式：

- `claude/restored-cli-src/src/tools/EnterPlanModeTool/EnterPlanModeTool.ts`
- `claude/restored-cli-src/src/tools/ExitPlanModeTool/ExitPlanModeV2Tool.ts`
- `claude/restored-cli-src/src/tools/TodoWriteTool/TodoWriteTool.ts`
- `claude/restored-cli-src/src/components/Messages.tsx`
- `claude/restored-cli-src/src/components/messages/AssistantToolUseMessage.tsx`
- `claude/restored-cli-src/src/components/PromptInput/PromptInput.tsx`

对应到 NovelFork：

- Plan Mode → Guided Generation Mode
- Tool renderer → NovelFork tool result renderer
- Permission request → 创作确认门
- Prompt input footer → 模型 / 权限 / 书籍 / Agent / 上下文状态栏
- Transcript/tool loop → NarratorSession 工具循环

## Current State

### 已有资产

- 布局：`packages/studio/src/app-next/components/layouts.tsx` 已有 `ResourceWorkspaceLayout` 三栏布局。
- 工作台：`packages/studio/src/app-next/workspace/WorkspacePage.tsx` 已有资源树、中间编辑区、右侧驾驶舱/经纬/写作能力。
- 资源模型：`resource-adapter.ts` 与 `resource-view-registry.tsx` 已能将章节、候选稿、草稿、经纬、素材、发布报告映射到 viewer/editor。
- 会话：`ChatWindow.tsx`、`ChatWindowManager.tsx`、`windowStore.ts`、`windowRuntimeStore.ts` 已有窗口状态、WebSocket、recovery 与工具块展示。
- 会话后端：`session-chat-service.ts` 已有 session history、ack、recent messages、recovery JSON、WebSocket 传输。
- 模型运行时：`llm-runtime-service.ts` 已能按 provider/model 生成回复。
- 工具底座：core `ToolRegistry` 与 `builtin-tools.ts` 已有 18 个写作工具；studio `tool-executor.ts` 有轻量工具执行器。
- 经纬与问卷：Bible/Jingwei、Questionnaire、PGI 引擎已有 schema、API 与部分 UI。

### 主要缺口

- `llm-runtime-service.ts` 目前只处理 role/content，不支持 provider tool calling。
- `session-chat-service.ts` 尚未执行模型返回的 tool_use，也没有 tool_result 回灌循环。
- `tool-executor.ts` 与 core `ToolRegistry` 没有统一接入 NarratorSession。
- 驾驶舱是右侧静态功能面板，不是会话工具结果。
- Questionnaire/PGI 是页面/API 能力，不是一等 Agent tools。
- ChatWindow 是浮动窗口/会话视图，没有成为工作台右侧固定主入口。
- 中间编辑区是单资源视图，不是可打开多个资源和 Agent 产物的画布。

## Architecture

```text
┌──────────────────────────────────────────────────────────────┐
│ Studio Next Shell                                             │
├─────────────────┬─────────────────────────────┬──────────────┤
│ Left Rail       │ Canvas Workspace             │ Narrator Chat│
│                 │                             │              │
│ Global Nav      │ OpenResource tabs            │ ChatWindow   │
│ Book Switcher   │ Chapter editor               │ Tool cards   │
│ Resource Tree   │ Candidate preview            │ Confirm gates│
│ Session List    │ Jingwei cards                │ Input footer │
└─────────────────┴─────────────────────────────┴──────────────┘
```

```text
User message
  ↓
NarratorSession runtime
  ↓
LLM generate with tools
  ↓
assistant tool_use
  ↓
SessionToolLoop executes tool
  ↓
tool_result persisted + rendered
  ↓
LLM continues until final assistant text or confirmation gate
```

## Frontend Design

### 1. Layout primitives

Extend `ResourceWorkspaceLayout` instead of replacing it wholesale.

Current:

```tsx
<ResourceWorkspaceLayout explorer={...} editor={...} assistant={...} />
```

Target naming:

```tsx
<AgentWorkspaceLayout
  leftRail={<WorkspaceLeftRail />}
  canvas={<WorkspaceCanvas />}
  narrator={<NarratorPanel />}
/>
```

Implementation can keep the same file initially and add compatibility props if needed. The important change is semantic:

- `explorer` → `leftRail`
- `editor` → `canvas`
- `assistant` → `narrator`

### 2. Left rail

`WorkspaceLeftRail` contains:

1. Compact global navigation.
2. Current book switcher.
3. Resource tree from existing `buildStudioResourceTree`.
4. Optional session list / recent narrators.

The left rail must not own the current conversation. It only selects resources or switches book/session.

### 3. Canvas workspace

Introduce an open-resource state model:

```ts
interface OpenResourceTab {
  id: string;
  nodeId: string;
  kind: WorkspaceNodeViewKind | "guided-plan" | "tool-result" | "narrative-line";
  title: string;
  dirty: boolean;
  source: "user" | "agent";
  payloadRef?: string;
}
```

`WorkspaceCanvas` responsibilities:

- Render current tab using existing `resource-view-registry.tsx` where possible.
- Open resources when left tree node is clicked.
- Open Agent artifacts when tool results include `openInCanvas` metadata.
- Track dirty state and block destructive overwrite.
- Provide current canvas context to the narrator session.

Initial v1 only needs tabbed resources, not infinite whiteboard panning. The word “画布” means central working surface; graph/whiteboard can arrive later.

### 4. Narrator panel

`NarratorPanel` wraps a right-side fixed `ChatWindow` variant.

Current `ChatWindow` is coupled to `windowId` and floating window state. v1 should extract reusable internals:

```text
ChatWindowShell
ChatMessageList
ChatInputBar
ChatSessionHeader
ChatToolCallList
```

Then provide two host modes:

- `floating` for legacy `ChatWindowManager`
- `docked` for right-side narrator panel

Docked mode must preserve:

- model selector
- permission mode selector
- reasoning effort
- connection status
- recovery banner
- recent execution chain
- tool call blocks

### 5. Tool result renderers

Current `ToolCallBlock` is generic. Add renderer registry:

```ts
interface ToolResultRendererProps {
  toolCall: ToolCall;
  onOpenCanvas?: (artifact: CanvasArtifact) => void;
  onConfirm?: (decision: ToolDecision) => void;
}

type ToolResultRenderer = (props: ToolResultRendererProps) => ReactNode;
```

Initial renderers:

- `cockpit.snapshot` → `CockpitSnapshotCard`
- `cockpit.openHooks` → `OpenHooksCard`
- `guided.questions` → `GuidedQuestionsCard`
- `guided.plan` → `GuidedGenerationPlanCard`
- `pgi.questions` → `PgiQuestionsCard`
- `candidate.created` → `CandidateCreatedCard`
- `jingwei.mutationPreview` → `JingweiMutationPreviewCard`
- fallback → existing generic `ToolCallBlock`

Renderer data must come from tool result JSON, not from duplicate frontend fetches unless user explicitly expands stale data.

## Backend Design

### 1. Unified session tool definition

Create a studio-facing tool definition format compatible with provider function calling and UI rendering:

```ts
interface SessionToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  risk: "read" | "draft-write" | "confirmed-write" | "destructive";
  renderer?: string;
  enabledForModes: SessionPermissionMode[];
}
```

Tool names should be namespace-like for clarity:

```text
cockpit.get_snapshot
cockpit.list_open_hooks
jingwei.read_context
jingwei.propose_mutation
questionnaire.list_templates
questionnaire.suggest_answer
questionnaire.submit_response
pgi.generate_questions
pgi.format_answers
candidate.create_chapter
chapter.read
chapter.propose_patch
guided.enter
guided.exit
narrative.read_line
narrative.propose_change
```

### 2. Session tool executor

Create `session-tool-executor.ts` in studio API layer. It adapts existing services:

- core `ToolRegistry` for pipeline tools
- Bible/Jingwei services for structured data
- existing route/service logic for candidates, chapters, cockpit data
- PGI and Questionnaire modules from core

Execution contract:

```ts
interface SessionToolExecutionInput {
  session: NarratorSessionRecord;
  toolName: string;
  input: Record<string, unknown>;
  permissionMode: SessionPermissionMode;
  canvasContext?: CanvasContext;
}

interface SessionToolExecutionResult {
  ok: boolean;
  renderer?: string;
  summary: string;
  data?: unknown;
  artifact?: CanvasArtifact;
  confirmation?: ToolConfirmationRequest;
  error?: string;
}
```

### 3. Tool loop

Extend `llm-runtime-service.ts` and provider adapters to support tools. Do not fake tool support.

New runtime result shape:

```ts
export type LlmRuntimeGenerateResult =
  | { success: true; type: "message"; content: string; metadata: LlmRuntimeMetadata }
  | { success: true; type: "tool_use"; toolUses: RuntimeToolUse[]; metadata: LlmRuntimeMetadata }
  | { success: false; code: LlmRuntimeFailureCode; error: string; metadata?: Partial<LlmRuntimeMetadata> };
```

Provider capability check:

```ts
if (!model.capabilities.includes("tools")) {
  return unsupported-tools failure when tool loop is required;
}
```

Session loop pseudocode:

```ts
async function runSessionTurn(session, messages) {
  let loopMessages = injectSystemPrompt(messages);
  for (let step = 0; step < MAX_TOOL_STEPS; step++) {
    const response = await generateSessionReply({
      sessionConfig: session.sessionConfig,
      messages: loopMessages,
      tools: getEnabledSessionTools(session),
    });

    if (response.type === "message") {
      appendAssistantMessage(response.content);
      return;
    }

    for (const toolUse of response.toolUses) {
      appendAssistantToolUseMessage(toolUse);
      const result = await executeOrRequestConfirmation(toolUse, session);
      appendToolResultMessage(result);
      loopMessages = appendToolResultForModel(loopMessages, toolUse, result);
    }
  }

  appendError("工具循环超过最大步数");
}
```

`MAX_TOOL_STEPS` should be small in v1, for example 6, to prevent runaway loops.

### 4. Confirmation gate

A tool can return `confirmation`. The session service must persist a pending confirmation and stop model continuation until user responds.

```ts
interface ToolConfirmationRequest {
  id: string;
  toolName: string;
  target: string;
  risk: "confirmed-write" | "destructive";
  summary: string;
  diff?: unknown;
  options: Array<"approve" | "reject" | "open-in-canvas">;
}
```

User response becomes a tool_result:

```text
approved → execute tool or continue with approved result
rejected → return rejection result to model
```

This mirrors Claude Code ExitPlanMode approval behavior.

## Guided Generation Mode

### 1. State model

```ts
interface GuidedGenerationState {
  id: string;
  sessionId: string;
  bookId: string;
  status: "planning" | "awaiting-user" | "approved" | "rejected" | "executing" | "completed";
  goal: string;
  contextSources: GuidedContextSource[];
  questions: GuidedQuestion[];
  answers: Record<string, unknown>;
  plan?: GuidedGenerationPlan;
  artifacts: CanvasArtifact[];
  createdAt: string;
  updatedAt: string;
}
```

Store it either in session message metadata for v1 or a dedicated table if implementation requires querying across sessions. For v1, session metadata is acceptable if it survives reload and recovery.

### 2. Enter guided generation

`guided.enter` does not write resources. It creates state and instructs the model:

```text
你现在处于引导式生成模式：
1. 先读取上下文。
2. 必要时调用 cockpit/questionnaire/PGI 工具。
3. 输出 GuidedGenerationPlan。
4. 等待用户确认。
5. 确认前不得写入正式正文或经纬。
```

### 3. Guided questions

Questions can originate from:

- Questionnaire templates
- PGI rules
- model-generated clarification, but only if represented as structured `GuidedQuestion`

```ts
interface GuidedQuestion {
  id: string;
  prompt: string;
  type: "single" | "multi" | "text" | "ranged-number" | "ai-suggest";
  options?: string[];
  reason: string;
  required: boolean;
  source: "questionnaire" | "pgi" | "agent";
  mapping?: {
    target: "jingwei" | "writer-context" | "candidate-metadata";
    fieldPath?: string;
  };
}
```

### 4. Guided plan

```ts
interface GuidedGenerationPlan {
  title: string;
  goal: string;
  target: "book-foundation" | "chapter-candidate" | "jingwei-update" | "rewrite" | "audit";
  contextSummary: string;
  contextSources: GuidedContextSource[];
  authorDecisions: string[];
  proposedJingweiMutations: JingweiMutationPreview[];
  proposedCandidate?: {
    chapterNumber?: number;
    title?: string;
    intent: string;
    expectedLength?: number;
  };
  risks: string[];
  confirmationItems: string[];
}
```

### 5. Exit guided generation

`guided.exit` asks for user approval. After approval:

- write intended Jingwei draft or accepted mutation
- create candidate instead of overwriting chapter
- update current focus if requested
- open candidate/plan in canvas

If rejected, no write tools execute.

## Cockpit Tools

Initial tools should reuse existing cockpit data sources and avoid duplicate business logic.

### cockpit.get_snapshot

Returns:

```ts
interface CockpitSnapshot {
  bookId: string;
  progress: {
    todayWords: number | null;
    targetWords: number | null;
    chapterCount: number;
    totalWords: number;
  };
  currentFocus: {
    content: string | null;
    source: "story/current_focus.md" | "missing";
  };
  recentSummaries: Array<{ chapter: number; summary: string }>;
  riskChapters: Array<{ chapter: number; reason: string }>;
  openHooks: Array<{ id: string; title: string; dueChapter?: number }>;
  recentCandidates: Array<{ id: string; title: string; chapterNumber?: number; status: string }>;
  modelStatus: {
    providerId?: string;
    modelId?: string;
    configured: boolean;
    toolsSupported?: boolean;
  };
}
```

### cockpit.list_open_hooks

Returns open foreshadowing from:

- Bible/Jingwei event records
- `story/pending_hooks.md` when present

### cockpit.list_recent_candidates

Returns candidate metadata and canvas artifact refs.

## Questionnaire and PGI Tools

### Questionnaire

Tools:

```text
questionnaire.list_templates
questionnaire.start
questionnaire.suggest_answer
questionnaire.submit_response
```

Implementation should call existing core modules:

- `seed/builtin.ts`
- `submit-response.ts`
- `apply-mapping.ts`
- `ai-suggest.ts`

Important correction: `suggest_answer` must receive a real provider/model context. If no usable model exists, return unsupported instead of the current generic disabled text.

### PGI

Tools:

```text
pgi.generate_questions
pgi.record_answers
pgi.format_answers_for_prompt
```

Implementation uses:

- `packages/core/src/bible/pgi/pgi-engine.ts`

PGI answers should be stored in message metadata and candidate metadata:

```ts
metadata: {
  pgi: {
    used: true,
    questions,
    answers,
    heuristicsTriggered,
  }
}
```

Skipped PGI:

```ts
metadata: {
  pgi: {
    used: false,
    skippedReason: "user-skipped" | "no-questions" | "unsupported",
  }
}
```

## Narrative Line v1

Narrative Line v1 is a structured story graph and visual canvas source, not a full graph editor yet.

### Data model

```ts
type NarrativeNodeType = "chapter" | "event" | "conflict" | "foreshadow" | "payoff" | "character-arc" | "setting";

type NarrativeEdgeType = "causes" | "reveals" | "escalates" | "resolves" | "foreshadows" | "pays-off" | "contradicts" | "supports";

interface NarrativeNode {
  id: string;
  bookId: string;
  type: NarrativeNodeType;
  title: string;
  summary?: string;
  sourceRef?: ResourceRef;
  chapterNumber?: number;
  status?: string;
}

interface NarrativeEdge {
  id: string;
  bookId: string;
  fromNodeId: string;
  toNodeId: string;
  type: NarrativeEdgeType;
  label?: string;
  confidence: "explicit" | "inferred" | "agent-proposed";
}

interface NarrativeLineSnapshot {
  bookId: string;
  nodes: NarrativeNode[];
  edges: NarrativeEdge[];
  warnings: NarrativeWarning[];
}
```

### Initial behavior

- Build read-only snapshot from existing chapters, summaries, conflicts, foreshadowing events and character arcs.
- Agent changes are proposed as `NarrativeLineMutationPreview`.
- User approval is required before persisting graph changes.
- Canvas renderer can initially show a list/grouped graph; advanced auto-layout is non-goal.

## API and Routes

New/extended routes:

```text
GET  /api/sessions/:id/tools
POST /api/sessions/:id/tools/:toolName/confirm
GET  /api/sessions/:id/guided/state
POST /api/sessions/:id/guided/answer
POST /api/sessions/:id/guided/approve
POST /api/sessions/:id/guided/reject
GET  /api/books/:bookId/cockpit/snapshot
GET  /api/books/:bookId/narrative-line
POST /api/books/:bookId/narrative-line/propose
POST /api/books/:bookId/narrative-line/apply
```

Where possible, routes should call shared services also used by session tools. UI routes are not the source of truth; services are.

## Permission Model

Map current session permission modes:

| Mode | Tool behavior |
|---|---|
| `read` | only read tools, no writes |
| `plan` | read + guided plan generation, no writes |
| `ask` | ask before writes and before risky reads if configured |
| `edit` | allow draft/candidate writes; confirm formal overwrites |
| `allow` | allow enabled tools except project-level hard blocks |

Hard blocks always apply:

- no secrets write
- no fake success
- no direct formal chapter overwrite without confirmation
- no destructive delete in this spec
- no old frontend shim/noop adapter

## Error Handling

- Unsupported provider tool calling → explicit unsupported state.
- Tool schema parse failure → show invalid tool input and let model repair.
- Tool execution failure → persist failed tool call and stop dependent writes.
- Confirmation timeout/refresh → recover from pending confirmation metadata.
- Dirty canvas resource → block destructive write and ask user.
- Missing book/context → ask user to select or create a book.
- PGI no questions → explicit successful empty result with reason.

## Testing Strategy

### Unit tests

- Session tool registry exposes expected tools by permission mode.
- Session tool executor blocks write tools in read/plan mode.
- GuidedGenerationState transitions are valid.
- Cockpit snapshot service returns real empty/unsupported states, not mock data.
- PGI tool records used/skipped metadata correctly.
- Renderer registry selects specialized renderer and falls back to generic block.

### Integration tests

- Session turn with one tool_use executes tool, appends tool_result, and continues to final assistant message.
- Tool requiring confirmation pauses loop until approval.
- Rejected confirmation returns rejection result and does not write.
- “写下一章” minimal chain: cockpit snapshot → PGI → guided plan → approval → candidate created.
- Refresh during pending confirmation recovers state.
- Canvas opens candidate artifact produced by tool result.

### UI tests

- Workspace renders left rail / canvas / right narrator.
- Resource click opens in canvas without resetting narrator input.
- Cockpit snapshot tool result renders CockpitSnapshotCard.
- Guided questions card supports answer/skip/edit.
- Guided plan card supports approve/reject/open-in-canvas.
- Dirty canvas resource blocks overwrite confirmation.

### Non-regression tests

- Existing resource tree mappings still work.
- Existing ChatWindow floating mode still renders if retained.
- Existing questionnaire submit mapping remains transactional.
- Existing PGI engine rules still return expected questions.

## Migration Plan

### Phase 0：spec and terminology alignment

- Add this spec.
- Update docs language from page-first to session-first where active docs describe current product direction.
- Keep archived specs unchanged except when explicitly referenced as history.

### Phase 1：layout shell

- Introduce `AgentWorkspaceLayout` or evolve `ResourceWorkspaceLayout`.
- Add `WorkspaceLeftRail`, `WorkspaceCanvas`, `NarratorPanel`.
- Dock existing ChatWindow on the right.
- Keep old cockpit panels reachable only as fallback/temporary canvas components.

### Phase 2：tool result renderer registry

- Add renderer registry to ToolCall UI.
- Implement lightweight cockpit and guided renderers using real result data.
- Preserve generic fallback.

### Phase 3：session tool loop

- Extend runtime adapters with tool support capability.
- Add `SessionToolExecutor`.
- Update session chat service to run bounded tool loop.
- Add confirmation gate.

### Phase 4：guided generation v1

- Implement `guided.enter` / `guided.exit` semantics.
- Add GuidedGenerationState.
- Connect Questionnaire and PGI tools.
- Minimal “写下一章” flow creates candidate and opens canvas.

### Phase 5：narrative line read-only v1

- Build narrative line snapshot from existing data.
- Add canvas renderer and read tool.
- Add propose/apply mutation hooks only after confirmation gate is stable.

## Rollout and Compatibility

- Keep existing routes and components until equivalent session-first path is verified.
- Do not delete cockpit components until their data/rendering is reused by tool cards or canvas.
- Keep `ChatWindowManager` only if it does not confuse the primary right-side narrator path; otherwise hide it behind advanced/session center.
- Document unsupported tool calling for models without tool capability.
- No release claim until typecheck, tests and at least the minimal writing chain pass.

## Success Metrics

- User can open workspace and identify the right-side narrator as the main entry without instruction.
- “写下一章” produces a visible execution chain and a candidate opened in canvas.
- Cockpit state is reachable by conversation and rendered as a tool result card.
- Guided generation requires user approval before writes.
- No mocked success appears in tool results.
- Existing chapter/resource editing remains functional.