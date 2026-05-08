export const CODEX_RUNTIME_CAPABILITY_STATUS_VALUES = ["current", "partial", "planned", "reference-only", "unsupported"] as const;

export type CodexRuntimeCapabilityStatus = (typeof CODEX_RUNTIME_CAPABILITY_STATUS_VALUES)[number];

export interface CodexRuntimeCapabilityStatusEntry {
  readonly id: "codex.approvalPolicy" | "codex.sandboxMode" | "codex.review" | "codex.imageInput" | "codex.mcpServers";
  readonly label: string;
  readonly value: string;
  readonly status: CodexRuntimeCapabilityStatus;
  readonly currentBehavior: string;
  readonly unsupportedReason?: string;
}

export type CodexSandboxMode = "planned";

export interface NormalizedCodexSandboxMode {
  readonly mode: CodexSandboxMode;
  readonly status: Extract<CodexRuntimeCapabilityStatus, "planned">;
  readonly reason: string;
}

const CODEX_RUNTIME_CAPABILITY_STATUSES: readonly CodexRuntimeCapabilityStatusEntry[] = [
  {
    id: "codex.approvalPolicy",
    label: "Codex approval policy",
    value: "permissionMode/toolPolicy",
    status: "partial",
    currentBehavior: "NovelFork 当前用 permissionMode、toolPolicy 与 pending confirmation 表达可执行审批语义。",
    unsupportedReason: "尚未实现 Codex sandbox escalation、untrusted/on-failure/on-request/never 的完整配置层或 granular approval_policy。",
  },
  {
    id: "codex.sandboxMode",
    label: "Codex sandbox mode",
    value: "planned",
    status: "planned",
    currentBehavior: "NovelFork 当前没有真实 OS sandbox，工具执行仍由 permissionMode/toolPolicy/dirty guard 控制。",
    unsupportedReason: "Codex read-only/workspace-write/danger-full-access OS sandbox not implemented in NovelFork yet.",
  },
  {
    id: "codex.review",
    label: "Codex code review",
    value: "reference-only",
    status: "reference-only",
    currentBehavior: "仅作为 Codex CLI capability reference，不提供 current review 子命令或 UI。",
    unsupportedReason: "Codex review workflow has no NovelFork runtime implementation.",
  },
  {
    id: "codex.imageInput",
    label: "Codex image input",
    value: "reference-only",
    status: "reference-only",
    currentBehavior: "仅作为 Codex CLI image attachment reference，不提供 current composer image input。",
    unsupportedReason: "Codex image input has no NovelFork chat contract yet.",
  },
  {
    id: "codex.mcpServers",
    label: "Codex MCP servers",
    value: "planned",
    status: "planned",
    currentBehavior: "NovelFork 当前只有 MCP 工具策略字段，不等价于 Codex MCP server/client 配置。",
    unsupportedReason: "Codex mcp_servers config and codex mcp management are not implemented as current runtime behavior.",
  },
];

export function getCodexRuntimeCapabilityStatuses(): readonly CodexRuntimeCapabilityStatusEntry[] {
  return CODEX_RUNTIME_CAPABILITY_STATUSES;
}

export function normalizeCodexSandboxMode(_value: unknown): NormalizedCodexSandboxMode {
  return {
    mode: "planned",
    status: "planned",
    reason: "Codex OS sandbox not implemented; unsupported sandbox requests are persisted only as planned status.",
  };
}
