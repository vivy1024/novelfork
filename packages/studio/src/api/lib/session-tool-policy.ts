import type { SessionToolDefinition } from "../../shared/agent-native-workspace.js";
import type { SessionToolPolicy } from "../../shared/session-types.js";

export type SessionToolPolicyAction = "allow" | "deny" | "ask" | "inherit";

export interface SessionToolPolicyDecision {
  readonly action: SessionToolPolicyAction;
  readonly source?: "sessionConfig.toolPolicy.allow" | "sessionConfig.toolPolicy.deny" | "sessionConfig.toolPolicy.ask";
  readonly pattern?: string;
}

export type PolicyAnnotatedSessionToolDefinition = SessionToolDefinition & {
  readonly policy?: SessionToolPolicyDecision;
};

function normalizePolicyList(values: readonly string[] | undefined): string[] {
  if (!Array.isArray(values)) return [];
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

export function normalizeSessionToolPolicy(value: unknown): SessionToolPolicy | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Partial<Record<keyof SessionToolPolicy, unknown>>;
  const allow = normalizePolicyList(record.allow as readonly string[] | undefined);
  const deny = normalizePolicyList(record.deny as readonly string[] | undefined);
  const ask = normalizePolicyList(record.ask as readonly string[] | undefined);
  return allow.length || deny.length || ask.length ? { allow, deny, ask } : undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}

export function matchesToolPolicyPattern(pattern: string, toolName: string): boolean {
  const trimmed = pattern.trim();
  if (!trimmed) return false;
  if (trimmed === "*") return true;
  if (!trimmed.includes("*")) return trimmed === toolName;
  const regex = new RegExp(`^${trimmed.split("*").map(escapeRegExp).join(".*")}$`);
  return regex.test(toolName);
}

function findPolicyPattern(patterns: readonly string[] | undefined, toolName: string): string | undefined {
  return normalizePolicyList(patterns).find((pattern) => matchesToolPolicyPattern(pattern, toolName));
}

export function getSessionToolPolicyDecision(
  toolName: string,
  policy: SessionToolPolicy | undefined,
): SessionToolPolicyDecision {
  const normalized = normalizeSessionToolPolicy(policy);
  if (!normalized) return { action: "inherit" };

  const deniedBy = findPolicyPattern(normalized.deny, toolName);
  if (deniedBy) return { action: "deny", source: "sessionConfig.toolPolicy.deny", pattern: deniedBy };

  const askedBy = findPolicyPattern(normalized.ask, toolName);
  if (askedBy) return { action: "ask", source: "sessionConfig.toolPolicy.ask", pattern: askedBy };

  const allowedBy = findPolicyPattern(normalized.allow, toolName);
  if (allowedBy) return { action: "allow", source: "sessionConfig.toolPolicy.allow", pattern: allowedBy };

  return { action: "inherit" };
}

export function annotateSessionToolsWithPolicy(
  tools: readonly SessionToolDefinition[],
  policy: SessionToolPolicy | undefined,
): PolicyAnnotatedSessionToolDefinition[] {
  return tools.flatMap((tool) => {
    const decision = getSessionToolPolicyDecision(tool.name, policy);
    if (decision.action === "deny") return [];
    if (decision.action === "inherit") return [tool];
    return [{ ...tool, policy: decision }];
  });
}

export function filterSessionToolsForProvider(
  tools: readonly SessionToolDefinition[],
  policy: SessionToolPolicy | undefined,
): { readonly tools: readonly SessionToolDefinition[]; readonly deniedTools: readonly string[] } {
  const deniedTools: string[] = [];
  const filtered = tools.filter((tool) => {
    const decision = getSessionToolPolicyDecision(tool.name, policy);
    if (decision.action !== "deny") return true;
    deniedTools.push(tool.name);
    return false;
  });
  return { tools: filtered, deniedTools };
}
