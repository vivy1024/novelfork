# Claude/Codex Novel Agent v1 Design

**版本**: v1.0.0  
**创建日期**: 2026-05-07  
**状态**: approved  
**文档类型**: Kiro design

---

## 1. 设计目标

本设计把 NovelFork 从“页面工作台 + 分散 API 能力”纠偏为统一 Agent 产品：

```text
NovelFork = ClaudeCodeCLI / CodexCLI 级 Agent Runtime + 小说创作领域能力
```

当前前端中的叙事线、创作画布、叙述者、设置页和套路页都保留为产品结构，不推倒重排。本设计只改变它们的职责和接线深度：

- **叙述者**：主操作面，承载 Claude/Codex-class agent session、commands、tools、permissions 和 execution trace。
- **叙事线 / 资源面**：剧情上下文面，提供 Agent 理解长篇结构、伏笔、矛盾、角色弧线和当前状态的事实源。
- **创作画布**：产物与决策面，承载章节、候选稿、Guided Plan、diff、checkpoint、工具结果和经纬编辑。
- **设置页**：Agent Runtime Control Center，真实控制模型、权限、工具策略、MCP、sandbox、subagents、上下文和运行策略。
- **套路页**：Agent Capability Workbench，真实管理 commands、tools、skills、hooks、subagents、MCP、prompt fragments、workflow recipes 和小说工作流。
- **CLI/headless**：自动化面，与 Studio 复用同一 runtime、settings、tools、permissions 和 transcript。

---

## 2. 非目标

- 不推翻当前前端叙事线 / 叙述者思路。
- 不恢复旧三栏、旧 ChatWindow、旧 WorkspacePage 体系。
- 不照抄 NarraFork、LegnaCode、Claude Code CLI 或 Codex CLI 的视觉实现。
- 不把 Claude/Codex 能力拆成“参考层”或“可选层”。它们是 NovelFork 的基础能力基线。
- 不把 API/组件/unit test 存在当成功能完成。
- 不允许 AI 直接覆盖正式正文。

---

## 3. 总体架构

```text
┌────────────────────────────────────────────────────────────┐
│ NovelFork Studio                                            │
│ ┌──────────────┐ ┌──────────────────┐ ┌─────────────────┐ │
│ │叙事线/资源面 │ │ 创作画布          │ │ 叙述者 Agent    │ │
│ │Storyline     │ │ Canvas           │ │ Narrator        │ │
│ └──────────────┘ └──────────────────┘ └─────────────────┘ │
│ ┌──────────────────────────┐ ┌───────────────────────────┐ │
│ │ 设置 Runtime Control     │ │ 套路 Capability Workbench │ │
│ └──────────────────────────┘ └───────────────────────────┘ │
└────────────────────────────────────────────────────────────┘
                 │ same runtime contract
                 ▼
┌────────────────────────────────────────────────────────────┐
│ NovelFork Agent Runtime                                     │
│ Session / Transcript / Command / Tool / Permission / MCP     │
│ Headless / Exec / Stream JSON / Checkpoint / Usage / Recovery│
└────────────────────────────────────────────────────────────┘
                 │ domain pack
                 ▼
┌────────────────────────────────────────────────────────────┐
│ Novel Agent Pack                                            │
│ /novel:* commands, story tools, jingwei, PGI, Guided Plan,   │
│ candidate flow, audit, revise, de-AI, style, publish checks  │
└────────────────────────────────────────────────────────────┘
```

关键约束：Studio、CLI、headless 不各自实现业务逻辑。它们都调用同一个 Agent Runtime 和 Novel Agent Pack。

---

## 4. Runtime 分层

### 4.1 Agent Runtime Core

职责：

- 管理 session lifecycle：create、continue、resume、fork、archive、restore、compact。
- 管理 transcript：message、tool_call、tool_result、permission_request、checkpoint、usage、error、result。
- 执行 agent turn：message → model → tool use → tool result → continuation → final result。
- 处理权限：permission mode、tool allow/deny/ask、risk level、dirty canvas guard、destructive confirmation。
- 输出事件：Studio WebSocket、headless NDJSON、CLI text/json/stream-json 均从同一事件源派生。

边界：

- 不包含小说业务规则。
- 不直接读写正式小说资源。
- 所有资源操作通过 tool executor 和 confirmation/checkpoint 服务。

### 4.2 ClaudeCodeCLI Capability Adapter

职责：将 Claude Code CLI 的产品能力映射为 NovelFork 内建能力。

包括：

- slash command registry。
- session resume/continue/fork/compact。
- permission mode 与 allowed/disallowed tools。
- headless prompt / print-like path。
- transcript/result/usage envelope。
- skills、hooks、subagents 的统一 registry。

设计原则：

- 不是文档 parity matrix，而是可执行 runtime 能力。
- 当前不能实现的 Claude 能力必须是 explicit backlog，例如 terminal TUI、tmux、Chrome bridge、remote-control、plugin marketplace。

### 4.3 CodexCLI Capability Adapter

职责：将 Codex CLI 的自动化与执行模型映射为 NovelFork 能力。

包括：

- `novelfork exec`。
- JSONL / NDJSON event taxonomy。
- approval policy。
- sandbox mode 语义。
- profile/config。
- MCP tools。
- review/image input 能力边界。

设计原则：

- Codex sandbox/review/image/MCP 若未真实实现，不进入 current claim。
- headless execution 必须与 Studio 同源，不能另建简化执行器。

### 4.4 Novel Agent Pack

职责：提供小说领域命令、工具、工作流和 agents。

命令：

```text
/novel:init
/novel:outline
/novel:write-next
/novel:audit
/novel:revise
/novel:de-ai
/novel:style-transfer
/novel:publish-check
/novel:health
/novel:storyline
```

工具：

```text
storyline.read
storyline.propose_change
jingwei.read_context
jingwei.update_entry
pgi.generate_questions
pgi.record_answers
guided.create_plan
guided.approve_plan
candidate.create_chapter
candidate.apply_to_chapter
chapter.read
chapter.save_checkpointed
audit.continuity
audit.ai_taste
style.extract_profile
publish.check_readiness
```

Agents：

```text
Explorer
Planner
Writer
Auditor
Reviser
Worldbuilder
Stylekeeper
```

---

## 5. Studio 产品面设计

### 5.1 叙述者 Agent 面

保留当前叙述者会话结构，但职责升级为 Agent 控制台。

必须展示：

- session title、binding、model、permission、context、usage、recovery。
- command suggestions。
- tool call stream。
- permission request。
- plan cards。
- candidate result。
- checkpoint / rewind。
- errors and recovery actions。

交互要求：

- 用户可以直接输入自然语言任务。
- 用户可以输入 `/novel:*` 命令。
- 运行中显示当前工具和目标。
- pending confirmation 不丢失，刷新后可恢复。

### 5.2 叙事线 / 资源面

保留当前叙事线/资源组织方式。

职责：

- 展示当前书的章节、候选稿、草稿、经纬、叙事线、伏笔、矛盾、角色弧线、报告。
- 提供 Agent 当前上下文状态：焦点章节、主线节点、未回收伏笔、升级矛盾、停滞弧线。
- 点击资源打开到画布，不重置叙述者会话。

Agent 读取：

- `storyline.read`、`jingwei.read_context`、`chapter.read`、`health.read_summary` 等工具从这里对应的数据源读取事实。

### 5.3 创作画布

画布不只是 viewer/editor，而是 Agent 产物面。

承载：

- 章节正文编辑器。
- 候选稿查看、对比、合并、替换、另存。
- Guided Plan 卡片。
- PGI 问答。
- 工具结果卡片。
- diff/checkpoint/rewind。
- 经纬条目编辑。
- 健康、审计、发布报告。

写入边界：

- 正式章节写入必须经 candidate/draft/confirmation/checkpoint。
- dirty 画布阻止可能覆盖当前资源的写入工具。

### 5.4 设置 Runtime Control Center

设置页必须接真实 runtime store。

模块：

- Providers / Models。
- Default model / summary model / subagent models。
- Permission defaults。
- Tool policy。
- Context budget / compact thresholds。
- MCP servers。
- Sandbox / approval policy。
- Headless / exec defaults。
- Proxy / network。
- Storage / transcript / checkpoint paths。
- Debug / logs。

每个设置项必须提供：

- 当前值。
- 来源：user/project/session/default/imported。
- 作用范围：global/project/session/headless。
- 读写 API。
- 保存后回读。
- 未实现状态：planned/unsupported/reference-only。

### 5.5 套路 Capability Workbench

套路页必须接真实 capability registry。

模块：

- Slash commands。
- Novel commands。
- Tools。
- Skills。
- Hooks。
- Subagents。
- MCP servers/tools。
- Prompt fragments。
- Workflow recipes。
- Genre presets。
- Writing modes。

每个能力项必须支持至少一种：

- 查看真实来源。
- 启用/禁用。
- 配置参数。
- 配置权限。
- 绑定模型或 agent。
- 测试调用。
- 查看最近执行。

不可用能力必须显示 why，不允许假启用。

---

## 6. CLI 与 Headless 设计

### 6.1 CLI 入口

目标入口：

```bash
novelfork
novelfork -p "帮我审校当前章"
novelfork chat --book <bookId>
novelfork exec "写下一章候选稿" --book <bookId> --output-format stream-json
novelfork studio --root <path>
```

CLI 必须复用：

- settings runtime store。
- provider/model selection。
- session lifecycle。
- tool registry。
- permission policy。
- MCP registry。
- transcript/checkpoint。

### 6.2 Headless Event Taxonomy

统一事件：

```text
session_started
user_message
assistant_delta
assistant_message
command_started
command_completed
tool_use
tool_result
permission_request
permission_decision
checkpoint_created
candidate_created
resource_updated
usage_delta
error
result
```

Studio WebSocket 与 CLI stream-json 使用同一 canonical event，再适配展示格式。

### 6.3 Permission in Headless

非交互执行遇到确认门：

- 输出 `permission_request`。
- 停止执行。
- 返回 exit code 2。
- 给出 resume/approve 指令。
- 不自动批准。

---

## 7. 小说端到端流程设计

### 7.1 `/novel:write-next` 主流程

```text
User asks /novel:write-next
  → load session config and runtime policy
  → read storyline/resource context
  → read jingwei/bible context
  → read current chapter state and summaries
  → cockpit/context snapshot
  → PGI questions if needed
  → collect/skip answers
  → create GuidedGenerationPlan
  → permission/approval gate
  → Writer generates candidate chapter
  → Candidate saved to generated-candidates
  → Canvas opens candidate
  → Resource tree refreshes
  → transcript records chain
```

失败处理：

- context missing：显示缺失资源和可恢复动作。
- model unavailable：保留任务和输入，跳转设置。
- unsupported tools：显示模型不支持工具循环。
- plan rejected：不写候选稿。
- candidate failure：保留已完成调查和计划。

### 7.2 Candidate Apply Flow

```text
Candidate opened in canvas
  → user chooses merge / replace / save draft / discard
  → preview diff
  → checkpoint formal resource
  → confirmation gate
  → write formal chapter or draft
  → update summaries/current state/storyline draft
  → transcript + audit
```

### 7.3 Story Jingwei Flow

```text
Create book
  → optional questionnaire
  → write premise/conflict/world/characters/arcs
  → user edits custom columns/entries
  → Agent reads context
  → CoreShift on major changes
  → PGI before generation
```

### 7.4 Writing Modes Flow

```text
Open chapter
  → select text or cursor position
  → choose continue/expand/bridge/dialogue/variants
  → run model with current context
  → preview result
  → accept/edit/discard
  → write to candidate/draft or confirmed insertion
```

---

## 8. Data and Contracts

### 8.1 Canonical Runtime Objects

- `RuntimeSession`
- `RuntimeMessage`
- `RuntimeEvent`
- `RuntimeCommand`
- `RuntimeToolDefinition`
- `RuntimeToolCall`
- `RuntimeToolResult`
- `PermissionRequest`
- `PermissionDecision`
- `CheckpointRef`
- `CandidateArtifact`
- `UsageEnvelope`

Existing session/storage types should be adapted to this canonical layer instead of adding parallel structures.

### 8.2 Novel Domain Objects

- `Book`
- `Chapter`
- `Candidate`
- `Draft`
- `StorylineSnapshot`
- `StoryJingweiSection`
- `StoryJingweiEntry`
- `PGIQuestionSet`
- `GuidedGenerationPlan`
- `AuditReport`
- `StyleProfile`
- `PublishReadinessReport`

### 8.3 Configuration Objects

- `RuntimeSettings`
- `ProviderSettings`
- `ToolPolicy`
- `McpServerConfig`
- `SubagentConfig`
- `WorkflowRecipe`
- `CommandDefinition`
- `SkillDefinition`
- `HookDefinition`

设置页和套路页必须读写这些真实对象，而不是维护 UI-only state。

---

## 9. Migration Strategy

本 spec 不要求推翻现有代码，而是将现有资产归并到统一主线。

### 9.1 复用资产

- `agent-turn-runtime.ts`：作为 runtime core 起点。
- `session-chat-service.ts`：作为 WebSocket/session persistence 起点。
- `llm-runtime-service.ts`：作为 provider selection 起点。
- `session-tool-registry.ts` / `session-tool-executor.ts`：作为 tool system 起点。
- `ProviderRuntimeStore`：作为 model/provider store 起点。
- `WorkbenchCanvas` / `WritingWorkbenchRoute` / `ConversationSurface`：作为 Studio 面起点。
- `RoutinesNextPage` / `ProviderSettingsPage`：作为控制台起点。
- core agents、bible、writing tools、writing modes、compliance、presets：作为 Novel Agent Pack 起点。

### 9.2 重新验收 archive specs

Archive checkbox 不再代表当前产品完成。需要建立 `product-capability-revalidation` 表：

```text
original spec capability
current asset exists?
current Studio path?
current CLI/headless path?
end-to-end evidence?
status: current / partial / not-wired / planned / unsupported / non-goal
```

### 9.3 Release Readiness 暂停

`v0-1-0-release-readiness` 保留历史记录，但 Task21-23 不继续执行，直到本 spec 明确新的 v0.1.0 或 v0.2.0 完成标准。

---

## 10. Testing Strategy

### 10.1 Unit Tests

- Runtime event reducer。
- Command parsing/execution。
- Tool policy resolution。
- Permission request/decision。
- Novel command workflow planning。
- Candidate apply and checkpoint。
- Settings/routines registry mutations。

### 10.2 Integration Tests

- Studio session message → runtime → tool loop → transcript。
- CLI exec → same runtime → stream-json events。
- Settings change → new session inherits。
- Routines workflow change → `/novel:write-next` behavior changes。
- MCP server registered → tool list updates → tool execution obeys permission。

### 10.3 Browser E2E

Required E2E paths:

1. Clean root → create book → questionnaire → open workbench。
2. `/novel:write-next` → PGI → Guided Plan → approve → candidate opens。
3. Candidate apply → checkpoint → formal chapter updated → summary/storyline update visible。
4. Settings provider/model/permission/tool policy change → narrator behavior changes。
5. Routines `/novel:write-next` workflow change → next execution uses changed configuration。
6. Writing mode selection in chapter editor → preview → accept/discard。
7. Health/storyline tools visible with real or transparent missing data。

### 10.4 CLI/Headless E2E

Required CLI paths:

```bash
novelfork -p "显示当前状态" --book <book>
novelfork exec "写下一章候选稿" --book <book> --output-format stream-json
novelfork chat --session <session>
```

Assertions:

- Same session store as Studio。
- Same permission policy。
- Same candidate/checkpoint boundary。
- Pending confirmation stops execution。
- JSONL events valid and replayable。

### 10.5 Evidence Rules

- Unit tests prove internal behavior only。
- API tests prove route behavior only。
- Component tests prove rendering only。
- Feature completion requires Studio or CLI/headless end-to-end evidence。

---

## 11. Rollout Phases

### Phase 1：Capability Revalidation

Inventory all existing claimed capabilities and classify them by current product status.

Output:

- `product-capability-revalidation.md`
- updated specs README status
- list of current/not-wired/planned/non-goal capabilities

### Phase 2：Runtime Unification

Unify session, command, tool, permission, transcript and stream-json events.

Output:

- canonical runtime event model
- CLI/Studio/headless sharing same runtime path
- basic Claude/Codex-class commands working

### Phase 3：Settings/Routines Control Plane

Connect settings and routines to real runtime control.

Output:

- settings changes affect sessions/CLI/headless
- routines changes affect commands/tools/workflows
- MCP/subagent/tool policy managed in one place

### Phase 4：Novel Agent Pack MVP

Implement and wire `/novel:init`、`/novel:outline`、`/novel:write-next`、`/novel:audit`、`/novel:revise`.

Output:

- real write-next chain with PGI, Guided Plan, candidate, canvas and transcript

### Phase 5：Creative Workflow Completion

Wire writing modes, story jingwei, health tools, style/de-AI, publish checks into current workbench.

Output:

- selected text writing modes
- story jingwei dynamic flow
- health/storyline dashboards with real data or transparent missing sources

### Phase 6：Release Rebaseline

Define new release standard after end-to-end functionality is real.

Output:

- decide v0.1.0 retarget or v0.2.0
- fresh compile/smoke/release tasks if approved

---

## 12. Open Questions

These are explicit follow-up decisions, not blockers for requirements:

1. 是否直接 fork/吸收 LegnaCode-cli 的 ClaudeCodeCLI/Bun engineering patterns，还是只读取其方案后在现有 runtime 内实现？
2. Codex sandbox 是否在 Bun runtime 内模拟审批语义，还是后续引入 native sidecar？
3. MCP server 是先支持 client-only，还是同步提供 NovelFork 自身 MCP server？
4. `/novel:write-next` 的默认 workflow 是否固定为 Explorer→Planner→Writer→Auditor，还是由套路页 workflow recipe 决定？
5. v0.1.0 是否继续保留当前版本号，还是把真正 Agent 产品化后的版本作为 v0.2.0？

---

## 13. Design Review Checklist

- 不推翻当前前端叙事线/叙述者结构。
- 设置和套路页是核心控制面。
- Claude/Codex 能力是产品基线，不是参考备注。
- 小说创作能力通过 commands/tools/workflows 接入统一 runtime。
- Studio、CLI、headless 使用同一 runtime。
- 功能完成以端到端用户路径为准。
- AI 正文写入保持非破坏性边界。
- 未实现能力不得进入 current claim。
