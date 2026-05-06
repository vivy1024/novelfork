export const PARITY_STATUSES = ["current", "partial", "planned", "non-goal", "unknown"] as const;

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
    if (entry.novelForkStatus === "non-goal" && entry.uiClaimAllowed !== false) {
      issues.push({ capability: entry.capability, code: "NON_GOAL_UI_CLAIM", message: "non-goal entries must be blocked from UI current claims" });
    }
  }
  return issues;
}

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
    capability: "Codex config file and profile overrides",
    upstreamEvidence: [
      { source: "local-cli", label: "codex --help", reference: "-c key=value, --profile from ~/.codex/config.toml", checkedAt: "2026-05-06" },
      { source: "official-docs", label: "Codex config reference", reference: "https://developers.openai.com/codex/config-reference", checkedAt: "2026-05-06" },
      { source: "novelfork-code", label: "NovelFork user settings", reference: "packages/studio/src/app-next/settings/SettingsTruthModel.ts", checkedAt: "2026-05-06" },
    ],
    novelForkStatus: "partial",
    surface: "/api/settings/user + SettingsTruthModel facts",
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
      { source: "novelfork-code", label: "NovelFork WebFetch proxy setting", reference: "SettingsTruthModel runtime.proxy.webFetch via /api/proxy", checkedAt: "2026-05-06" },
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
