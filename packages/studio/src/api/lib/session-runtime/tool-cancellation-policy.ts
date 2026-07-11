import type { SessionToolDefinition } from "../../../shared/agent-native-workspace.js";

/** 工具能否在当前实现中安全响应取消。能力只能向更保守的方向收窄。 */
export type ToolCancellationCapability =
  | "process-killable"
  | "cooperative"
  | "commit-fenced"
  | "non-cancellable";

export interface ToolCancellationPolicy {
  capabilityFor(name: string, input?: Record<string, unknown>): ToolCancellationCapability;
  timeoutMsFor(name: string, input?: Record<string, unknown>): number | null;
}

const PROCESS_KILLABLE_TOOLS = new Set([
  "Bash",
  "Agent",
]);

const COOPERATIVE_TOOLS = new Set([
  "Read",
  "Glob",
  "Grep",
  "WebSearch",
  "WebFetch",
  "Await",
  "Sleep",
  "Snip",
  "AskUserQuestion",
  "Recall",
  "ToolSearch",
  "GetGoals",
  "CtxInspect",
  "LearningGuide",
  "TaskGet",
  "cockpit.snapshot",
  "pgi.ask",
  "narrative.read_line",
  "chapter.read",
  "chapter.list",
  "chapter.audit",
  "outline.suggest_next",
  "character.check_consistency",
  "presets.read",
  "beat.read",
  "presets.check_compliance",
  "lore.read",
  "jingwei.read",
  "jingwei.audit",
  "memory.read",
  "memory.graph",
  "memory.list",
  "memory.read_entry",
  "memory.search",
  "memory.export",
  "memory.stats",
]);

// There are no current handlers which implement a real stage/commit fence.
// Keep the category for future integration points, but do not assign tools here
// until a real rollback fence exists.
const COMMIT_FENCED_TOOLS = new Set<string>();

const NON_CANCELLABLE_TOOLS = new Set([
  "Write",
  "Edit",
  "ApplyPatch",
  "EnterWorktree",
  "ExitWorktree",
  "EnterPlanMode",
  "ExitPlanMode",
  "TaskCreate",
  "Browser",
  "Send",
  "ForkNarrator",
  "Terminal",
  "ShareFile",
  "StartPipeline",
  "EndPipeline",
  "AddGoal",
  "UpdateGoal",
  "TaskStop",
  "Skill",
  "narrative.propose_change",
  "rewrite.segment",
  "rewrite.apply",
  "style.import",
  "pipeline.revise",
  "pipeline.import_chapters",
  "presets.write",
  "beat.write",
  "pipeline.write",
  "lore.write",
  "jingwei.write",
  "memory.events",
  "memory.dedup",
  "memory.update",
  "memory.delete",
  "memory.bulk_approve",
  "memory.bulk_delete",
  "scene.spec",
  "resource.manage",
]);

const READ_ACTIONS = new Set([
  "read",
  "get",
  "list",
  "search",
  "status",
  "inspect",
  "preview",
  "query",
  "wait",
  "screenshot",
  "dom",
  "get_text",
  "check_due",
]);

function normalizeAction(input: Record<string, unknown>): string | undefined {
  const action = input.action;
  return typeof action === "string" ? action.toLowerCase() : undefined;
}

function explicitCapabilityFor(name: string, input: Record<string, unknown>): ToolCancellationCapability | undefined {
  if (PROCESS_KILLABLE_TOOLS.has(name)) return "process-killable";
  if (COOPERATIVE_TOOLS.has(name)) return "cooperative";
  if (COMMIT_FENCED_TOOLS.has(name)) return "commit-fenced";
  if (NON_CANCELLABLE_TOOLS.has(name)) return "non-cancellable";
  if (name === "hooks.manage") {
    const action = normalizeAction(input);
    if (action !== undefined && READ_ACTIONS.has(action)) return "cooperative";
    return "non-cancellable";
  }
  if (name.startsWith("mcp__")) return "non-cancellable";
  return undefined;
}

function narrowedByAction(
  capability: ToolCancellationCapability,
  input: Record<string, unknown>,
): ToolCancellationCapability {
  if (capability === "non-cancellable") return capability;
  const action = normalizeAction(input);
  if (action === undefined) return capability;
  if (READ_ACTIONS.has(action)) return capability;
  return "non-cancellable";
}

function positiveTimeout(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(Math.floor(value), 600_000);
}

export const toolCancellationPolicy: ToolCancellationPolicy = {
  capabilityFor(name, input = {}) {
    return narrowedByAction(explicitCapabilityFor(name, input) ?? "non-cancellable", input);
  },

  timeoutMsFor(name, input = {}) {
    const capability = this.capabilityFor(name, input);
    if (capability === "non-cancellable") return 120_000;
    if (name === "Bash") return positiveTimeout(input.timeoutMs, 120_000);
    if (name === "Await") return positiveTimeout(input.timeout, 30_000);
    return 120_000;
  },
};

export function capabilityFor(name: string, input: Record<string, unknown> = {}): ToolCancellationCapability {
  return toolCancellationPolicy.capabilityFor(name, input);
}

export function timeoutMsFor(name: string, input: Record<string, unknown> = {}): number | null {
  return toolCancellationPolicy.timeoutMsFor(name, input);
}

/** True only when a registered tool has a deliberate capability declaration. */
export function hasToolCancellationDeclaration(name: string): boolean {
  return explicitCapabilityFor(name, {}) !== undefined || name === "hooks.manage";
}

/**
 * Registration guard for static/plugin tools. Unknown direct calls remain safe
 * by default (non-cancellable), but new registered handlers must opt into a
 * deliberately reviewed declaration instead of silently becoming cancellable.
 */
export function assertToolCancellationDeclarations(tools: readonly Pick<SessionToolDefinition, "name">[]): void {
  const missing = tools
    .map((tool) => tool.name)
    .filter((name) => !hasToolCancellationDeclaration(name));
  if (missing.length > 0) {
    throw new Error(`工具取消能力未声明：${Array.from(new Set(missing)).join(", ")}`);
  }
}
