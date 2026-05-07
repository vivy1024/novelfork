import { PROXY_API_PATH, USER_SETTINGS_API_PATH } from "../backend-contract";

export const PARITY_STATUSES = ["current", "partial", "planned", "non-goal", "reference-only", "unknown"] as const;

export type ParityStatus = (typeof PARITY_STATUSES)[number];

export interface ParityEvidence {
  readonly source: "local-cli" | "official-docs" | "local-source" | "novelfork-code" | "browser" | "test";
  readonly label: string;
  readonly reference: string;
  readonly checkedAt: string;
}

export interface ParityMatrixEntry {
  readonly capability: string;
  readonly upstreamEvidence: readonly ParityEvidence[];
  readonly novelForkStatus: ParityStatus;
  readonly surface: string;
  readonly verification: string;
  readonly notes: string;
  readonly uiClaimAllowed?: boolean;
}

export interface ParityMatrixValidationIssue {
  readonly capability: string;
  readonly code: "INVALID_STATUS" | "MISSING_EVIDENCE" | "MISSING_DATE" | "NON_GOAL_UI_CLAIM";
  readonly message: string;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function validateParityMatrix(entries: readonly ParityMatrixEntry[]): ParityMatrixValidationIssue[] {
  const issues: ParityMatrixValidationIssue[] = [];
  for (const entry of entries) {
    if (!(PARITY_STATUSES as readonly string[]).includes(entry.novelForkStatus)) {
      issues.push({ capability: entry.capability, code: "INVALID_STATUS", message: `Invalid status: ${entry.novelForkStatus}` });
    }
    if (entry.upstreamEvidence.length === 0) {
      issues.push({ capability: entry.capability, code: "MISSING_EVIDENCE", message: "At least one upstream evidence item is required" });
    }
    for (const evidence of entry.upstreamEvidence) {
      if (!DATE_PATTERN.test(evidence.checkedAt)) {
        issues.push({ capability: entry.capability, code: "MISSING_DATE", message: `Evidence '${evidence.label}' must use YYYY-MM-DD checkedAt` });
      }
    }
    if ((entry.novelForkStatus === "non-goal" || entry.novelForkStatus === "reference-only") && entry.uiClaimAllowed !== false) {
      issues.push({ capability: entry.capability, code: "NON_GOAL_UI_CLAIM", message: "non-goal/reference-only entries must be blocked from UI current claims" });
    }
  }
  return issues;
}

export const CLAUDE_CODE_PARITY_MATRIX: readonly ParityMatrixEntry[] = [
  {
    capability: "Claude slash command loading",
    upstreamEvidence: [
      { source: "local-source", label: "Claude commands registry", reference: "claude/restored-cli-src/src/commands.ts#getCommands loads bundled, skill dir, workflow, plugin, dynamic skills and built-ins", checkedAt: "2026-05-07" },
      { source: "local-source", label: "Claude command type", reference: "claude/restored-cli-src/src/types/command.ts supports prompt/local/local-jsx commands, aliases, availability, hidden/sensitive/immediate flags", checkedAt: "2026-05-07" },
      { source: "novelfork-code", label: "NovelFork slash registry", reference: "packages/studio/src/app-next/agent-conversation/slash-command-registry.ts static DEFAULT_COMMANDS", checkedAt: "2026-05-07" },
    ],
    novelForkStatus: "partial",
    uiClaimAllowed: false,
    surface: "Composer slash command suggestions/execution",
    verification: "slash-command-registry tests + Task19 source audit",
    notes: "NovelFork 当前只有 /help、/status、/model、/permission、/fork、/resume、/compact 的静态 registry；未实现 Claude 的 skills/plugins/workflows/MCP 动态命令、availability/isEnabled、aliases 去重、sensitive/immediate、本地 JSX 命令生命周期或 model-invocation 边界，因此只能作为 NovelFork 自身 partial slash 能力。",
  },
  {
    capability: "Claude permission modes and rule pipeline",
    upstreamEvidence: [
      { source: "local-source", label: "Claude permission modes", reference: "claude/restored-cli-src/src/types/permissions.ts EXTERNAL_PERMISSION_MODES acceptEdits/bypassPermissions/default/dontAsk/plan plus internal auto/bubble", checkedAt: "2026-05-07" },
      { source: "local-source", label: "Claude permission pipeline", reference: "claude/restored-cli-src/src/utils/permissions/permissions.ts has rule sources, deny/ask/allow precedence, tool.checkPermissions, hooks, classifier, sandbox and headless fallback", checkedAt: "2026-05-07" },
      { source: "novelfork-code", label: "NovelFork permission mode/toolPolicy", reference: "packages/studio/src/shared/session-types.ts + packages/studio/src/api/lib/session-tool-policy.ts + session-tool-executor.ts", checkedAt: "2026-05-07" },
    ],
    novelForkStatus: "partial",
    uiClaimAllowed: false,
    surface: "SessionConfig.permissionMode、sessionConfig.toolPolicy、工具确认门",
    verification: "session-tool-policy/session-tool-executor tests + Task19 source audit",
    notes: "NovelFork ask/edit/allow/read/plan 是写作产品语义，不是 Claude default/acceptEdits/bypassPermissions/dontAsk/plan 的 1:1 移植；toolPolicy 只支持简单通配符 allow/deny/ask，缺少 Claude 的多来源规则、ruleContent、MCP server/tool 规则、PermissionRequest hooks、classifier/auto mode、sandbox auto-allow 与 bypass-immune safety checks。",
  },
  {
    capability: "Claude session resume/fork storage",
    upstreamEvidence: [
      { source: "local-source", label: "Claude session storage", reference: "claude/restored-cli-src/src/utils/sessionStorage.ts JSONL transcript, parentUuid chain, project dir, sidecar metadata, progress filtering", checkedAt: "2026-05-07" },
      { source: "local-source", label: "Claude session restore", reference: "claude/restored-cli-src/src/utils/sessionRestore.ts restores file history, attribution, todos, context collapse, agent/worktree state", checkedAt: "2026-05-07" },
      { source: "novelfork-code", label: "NovelFork session lifecycle", reference: "packages/studio/src/api/lib/session-lifecycle-service.ts", checkedAt: "2026-05-07" },
    ],
    novelForkStatus: "partial",
    uiClaimAllowed: false,
    surface: "SessionCenter resume/continue/fork, /api/sessions/lifecycle/latest, /:id/fork, /:id/restore",
    verification: "session-lifecycle-service tests + Task19 source audit",
    notes: "NovelFork resume/continue/fork 已是自身 session store 的 current 能力，但不是 Claude JSONL transcript/resume 的完整移植；fork 只写入 system summary，不复制 parentUuid 链、file history、attribution、worktree/todo/context-collapse/agent metadata。",
  },
  {
    capability: "Claude headless/result/usage envelope",
    upstreamEvidence: [
      { source: "local-source", label: "Claude usage API", reference: "claude/restored-cli-src/src/services/api/usage.ts fetches OAuth utilization/rate limits", checkedAt: "2026-05-07" },
      { source: "local-source", label: "Claude bootstrap usage state", reference: "claude/restored-cli-src/src/bootstrap/state.ts tracks model usage, cost and token counters", checkedAt: "2026-05-07" },
      { source: "novelfork-code", label: "NovelFork headless chat", reference: "packages/studio/src/api/lib/session-headless-chat-service.ts NDJSON events + unknown cost + cumulative token envelope", checkedAt: "2026-05-07" },
    ],
    novelForkStatus: "partial",
    uiClaimAllowed: false,
    surface: "POST /api/sessions/headless-chat、novelfork chat/exec stream-json",
    verification: "session-headless-chat-service tests + Task19 source audit",
    notes: "NovelFork 有 text/stream-json input、NDJSON output、permission_request/result、duration/usage/unknown cost 与 max_turns/max_budget stop result；但没有 Claude SDK/print 模式完整事件 taxonomy、OAuth utilization、per-model cost tracker、rate-limit usage UI 或完整 transcript/result 兼容。",
  },
  {
    capability: "Claude terminal TUI / Chrome bridge / remote control / plugin market",
    upstreamEvidence: [
      { source: "local-source", label: "Claude command registry feature commands", reference: "claude/restored-cli-src/src/commands.ts includes chrome, bridge, remoteControlServer, plugin, ide, mcp, vim, usage and other terminal commands", checkedAt: "2026-05-07" },
      { source: "novelfork-code", label: "NovelFork Web workspace", reference: "packages/studio/src/app-next uses Web Agent Shell and does not mount Claude terminal TUI", checkedAt: "2026-05-07" },
    ],
    novelForkStatus: "non-goal",
    uiClaimAllowed: false,
    surface: "能力矩阵/设置 parity facts",
    verification: "SettingsTruthModel parity facts + docs guard",
    notes: "这些能力只作为参考边界；NovelFork v0.1.0 不复制 Claude 终端 TUI、Chrome bridge、remote-control server、IDE/plugin 市场。",
  },
] as const;

export const CODEX_CLI_PARITY_MATRIX: readonly ParityMatrixEntry[] = [
  {
    capability: "Codex TUI",
    upstreamEvidence: [
      { source: "local-cli", label: "codex --help", reference: "codex-cli 0.80.0 exposes interactive CLI when no subcommand is specified", checkedAt: "2026-05-06" },
      { source: "official-docs", label: "Codex CLI command reference", reference: "https://developers.openai.com/codex/cli/reference#codex-interactive", checkedAt: "2026-05-06" },
    ],
    novelForkStatus: "non-goal",
    uiClaimAllowed: false,
    surface: "NovelFork Web 工作台 /next，不提供 Codex 终端 TUI",
    verification: "SettingsTruthModel parity facts + docs guard",
    notes: "Codex `codex` 启动交互式终端 UI；NovelFork 明确不复制终端 TUI，只保留 Web 会话透明化。",
  },
  {
    capability: "Codex non-interactive exec",
    upstreamEvidence: [
      { source: "local-cli", label: "codex exec --help", reference: "exec supports --json, --output-schema, --output-last-message, resume", checkedAt: "2026-05-06" },
      { source: "official-docs", label: "Codex non-interactive mode", reference: "https://developers.openai.com/codex/noninteractive", checkedAt: "2026-05-06" },
      { source: "novelfork-code", label: "NovelFork headless chat", reference: "packages/studio/src/api/routes/session.ts headless-chat + packages/cli chat/exec", checkedAt: "2026-05-06" },
    ],
    novelForkStatus: "partial",
    surface: "POST /api/sessions/headless-chat、novelfork chat/exec stream-json",
    verification: "conversation-parity-v1 headless stream-json tests；Task 12 matrix guard",
    notes: "NovelFork 已有 headless text/stream-json 会话 envelope，但不是 Codex CLI `codex exec` 的完整 JSONL event taxonomy、schema output 或 API key CI 语义。",
  },
  {
    capability: "Codex exec JSONL event taxonomy",
    upstreamEvidence: [
      { source: "local-cli", label: "codex exec --help", reference: "codex-cli 0.80.0 exposes --json but local help is only a reference baseline", checkedAt: "2026-05-07" },
      { source: "official-docs", label: "Codex non-interactive mode", reference: "https://developers.openai.com/codex/noninteractive", checkedAt: "2026-05-07" },
    ],
    novelForkStatus: "reference-only",
    uiClaimAllowed: false,
    surface: "parity matrix only；不作为 current UI 能力",
    verification: "Task19 source audit；NovelFork headless events must not be advertised as Codex-compatible taxonomy",
    notes: "NovelFork 当前 NDJSON 事件命名为 user_message/assistant_delta/tool_use/tool_result/permission_request/result，未移植 Codex exec 的完整 JSONL event schema、structured output schema、resume event taxonomy 或 CI API key 语义；只能作为参考差距。",
  },
  {
    capability: "Codex config file and profile overrides",
    upstreamEvidence: [
      { source: "local-cli", label: "codex --help", reference: "-c key=value, --profile from ~/.codex/config.toml", checkedAt: "2026-05-06" },
      { source: "official-docs", label: "Codex config reference", reference: "https://developers.openai.com/codex/config-reference", checkedAt: "2026-05-06" },
      { source: "novelfork-code", label: "NovelFork user settings", reference: "packages/studio/src/app-next/settings/SettingsTruthModel.ts", checkedAt: "2026-05-06" },
    ],
    novelForkStatus: "partial",
    surface: `${USER_SETTINGS_API_PATH} + SettingsTruthModel facts`,
    verification: "SettingsTruthModel unit tests",
    notes: "NovelFork 使用自身 settings schema 和 session config；没有 `~/.codex/config.toml`、profile layer 或 `-c` TOML override 兼容层。",
  },
  {
    capability: "Codex sandbox modes",
    upstreamEvidence: [
      { source: "local-cli", label: "codex --help", reference: "--sandbox read-only|workspace-write|danger-full-access", checkedAt: "2026-05-06" },
      { source: "official-docs", label: "Codex config reference sandbox_mode", reference: "https://developers.openai.com/codex/config-reference#sandbox_mode", checkedAt: "2026-05-06" },
      { source: "official-docs", label: "Codex Windows sandbox", reference: "https://developers.openai.com/codex/windows#windows-sandbox", checkedAt: "2026-05-06" },
    ],
    novelForkStatus: "planned",
    uiClaimAllowed: false,
    surface: "能力矩阵 / parity 设置事实；不渲染 current sandbox 控件",
    verification: "parity-matrix.test.ts + SettingsTruthModel.test.ts",
    notes: "Codex sandbox 明确区分 read-only、workspace-write、danger-full-access，并在 Windows 原生提供 elevated/unelevated sandbox；NovelFork 当前只有 permissionMode/toolPolicy/dirty guard，没有真实 OS sandbox，因此不得显示 Codex sandbox 已接入。",
  },
  {
    capability: "Codex approval policy",
    upstreamEvidence: [
      { source: "local-cli", label: "codex --help", reference: "--ask-for-approval untrusted|on-failure|on-request|never; local 0.80.0 still lists on-failure", checkedAt: "2026-05-06" },
      { source: "official-docs", label: "Codex CLI reference approvals", reference: "https://developers.openai.com/codex/cli/reference#global-flags", checkedAt: "2026-05-06" },
      { source: "official-docs", label: "Codex config reference granular approvals", reference: "https://developers.openai.com/codex/config-reference#approval_policy", checkedAt: "2026-05-06" },
      { source: "novelfork-code", label: "NovelFork permissionMode/toolPolicy", reference: "packages/studio/src/app-next/agent-conversation/surface + session-tool-policy", checkedAt: "2026-05-06" },
    ],
    novelForkStatus: "partial",
    uiClaimAllowed: false,
    surface: "SessionConfig permissionMode + toolPolicy ask/allow/deny",
    verification: "ConversationSurface/session route/tool policy tests + Task 12 matrix guard",
    notes: "Codex official policy is untrusted/on-request/never plus granular approval toggles;本机 0.80.0 help 仍列 on-failure。NovelFork permissionMode/toolPolicy 能表达 ask/allow/deny 和 pending confirmation，但没有 Codex execpolicy、sandbox escalation approval 或 granular approval_policy 的完整模型。",
  },
  {
    capability: "Codex MCP server/client configuration",
    upstreamEvidence: [
      { source: "local-cli", label: "codex mcp --help", reference: "mcp list/get/add/remove/login/logout; mcp-server stdio", checkedAt: "2026-05-06" },
      { source: "official-docs", label: "Codex MCP docs", reference: "https://developers.openai.com/codex/mcp", checkedAt: "2026-05-06" },
      { source: "official-docs", label: "Codex config reference mcp_servers", reference: "https://developers.openai.com/codex/config-reference#mcp_servers", checkedAt: "2026-05-06" },
    ],
    novelForkStatus: "planned",
    surface: "SettingsTruthModel runtime MCP strategy 仅为 user setting/toolAccess 事实",
    verification: "SettingsTruthModel runtime facts mark source/API；无 Codex MCP config current claim",
    notes: "Codex 支持 `mcp_servers.<id>` 命令/URL/env/tool allow-deny/OAuth 等配置；NovelFork 当前仅有 MCP 工具策略字段与工具 allow/blocklist，不等价于 Codex MCP server 管理。",
  },
  {
    capability: "Codex subagents",
    upstreamEvidence: [
      { source: "official-docs", label: "Codex subagents", reference: "https://developers.openai.com/codex/subagents", checkedAt: "2026-05-06" },
      { source: "novelfork-code", label: "NovelFork narrator subagents", reference: "packages/studio user settings explore/plan/general subagent model fields", checkedAt: "2026-05-06" },
    ],
    novelForkStatus: "partial",
    surface: "Explore/Plan/General 子代理模型设置 + 内部 narrator subagent 流程",
    verification: "SettingsTruthModel model/runtime tests",
    notes: "Codex subagents 可在 CLI/App 中显式 spawn，继承 sandbox/approval，并支持 `~/.codex/agents/`/`.codex/agents/` TOML custom agents；NovelFork 有 narrator/subagent 模型配置和内部代理，但无 Codex agent TOML 格式或 sandbox 继承语义。",
  },
  {
    capability: "Codex web search",
    upstreamEvidence: [
      { source: "local-cli", label: "codex --help", reference: "--search enables web search", checkedAt: "2026-05-06" },
      { source: "official-docs", label: "Codex CLI features web search", reference: "https://developers.openai.com/codex/cli/features#web-search", checkedAt: "2026-05-06" },
      { source: "novelfork-code", label: "NovelFork WebFetch proxy setting", reference: `SettingsTruthModel runtime.proxy.webFetch via ${PROXY_API_PATH}`, checkedAt: "2026-05-06" },
    ],
    novelForkStatus: "partial",
    surface: "WebFetch tool/proxy setting；非 Codex native web_search flag",
    verification: "SettingsTruthModel runtime facts tests",
    notes: "Codex CLI 有 cached/live/disabled web_search 与 `--search`；NovelFork 暴露 WebFetch 代理和工具能力，但不是 Codex first-party web_search event/model。",
  },
  {
    capability: "Codex image input",
    upstreamEvidence: [
      { source: "local-cli", label: "codex --help", reference: "--image/-i FILE attaches images to initial prompt", checkedAt: "2026-05-06" },
      { source: "official-docs", label: "Codex CLI features image inputs", reference: "https://developers.openai.com/codex/cli/features#image-inputs", checkedAt: "2026-05-06" },
    ],
    novelForkStatus: "planned",
    surface: "能力矩阵；当前会话 composer 未接 Codex-style image attachment",
    verification: "Task 12 matrix guard",
    notes: "Codex CLI 支持 PNG/JPEG 等 image input；NovelFork 当前对话输入没有等价图片附件合同，不能宣称已接入。",
  },
  {
    capability: "Codex code review",
    upstreamEvidence: [
      { source: "local-cli", label: "codex review --help", reference: "review supports --uncommitted, --base, --commit, --title", checkedAt: "2026-05-06" },
      { source: "official-docs", label: "Codex CLI command overview", reference: "https://developers.openai.com/codex/cli/reference#command-overview", checkedAt: "2026-05-06" },
    ],
    novelForkStatus: "planned",
    surface: "NovelFork 没有 Codex-style review subcommand/UI",
    verification: "Task 12 matrix guard",
    notes: "本机 Codex CLI 暴露 non-interactive `review`；NovelFork 当前没有 PR/commit review 专用命令或 UI，后续若做需另开 spec。",
  },
  {
    capability: "Codex Windows native support boundary",
    upstreamEvidence: [
      { source: "local-cli", label: "codex sandbox --help", reference: "sandbox windows subcommand is available in local 0.80.0", checkedAt: "2026-05-06" },
      { source: "official-docs", label: "Codex Windows docs", reference: "https://developers.openai.com/codex/windows", checkedAt: "2026-05-06" },
      { source: "novelfork-code", label: "NovelFork project rules", reference: "CLAUDE.md / project instructions require native Windows and forbid WSL requirement", checkedAt: "2026-05-06" },
    ],
    novelForkStatus: "partial",
    uiClaimAllowed: false,
    surface: "项目运行约束与能力矩阵；不要求用户切换 WSL",
    verification: "Task 12 SettingsTruthModel facts mention Windows native boundary",
    notes: "Codex 官方 Windows 文档提供 native sandbox，并把 WSL2 作为需要 Linux-native workflow 时的选择；NovelFork 项目同样坚持 Windows 原生，但并未实现 Codex native sandbox，所以只能标 partial。",
  },
] as const;

export function parityEntryCanBeAdvertisedAsCurrent(entry: ParityMatrixEntry): boolean {
  return entry.novelForkStatus === "current" && entry.uiClaimAllowed !== false;
}
