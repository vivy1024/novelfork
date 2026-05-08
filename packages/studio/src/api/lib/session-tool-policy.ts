import {
  getSessionToolRiskDecision,
  normalizeSessionToolRisk,
  type CanvasContext,
  type SessionToolDefinition,
  type SessionToolRisk,
} from "../../shared/agent-native-workspace.js";
import type { SessionPermissionMode, SessionToolPolicy } from "../../shared/session-types.js";

export type SessionToolPolicyAction = "allow" | "deny" | "ask" | "inherit";

export interface SessionToolPolicyDecision {
  readonly action: SessionToolPolicyAction;
  readonly source?: "sessionConfig.toolPolicy.allow" | "sessionConfig.toolPolicy.deny" | "sessionConfig.toolPolicy.ask";
  readonly pattern?: string;
}

export type PolicyAnnotatedSessionToolDefinition = SessionToolDefinition & {
  readonly policy?: SessionToolPolicyDecision;
};

export type SessionToolPolicyResolutionReason =
  | "allowed"
  | "policy-allow"
  | "policy-ask"
  | "policy-denied"
  | "permission-denied"
  | "dirty-resource-blocked"
  | "risk-confirmation";

export interface SessionToolPolicyResolutionInput {
  readonly toolName: string;
  readonly risk: SessionToolRisk | unknown;
  readonly permissionMode: SessionPermissionMode;
  readonly toolPolicy?: SessionToolPolicy;
  readonly canvasContext?: CanvasContext;
}

export interface SessionToolPolicyResolution {
  readonly toolName: string;
  readonly visibleToModel: boolean;
  readonly requiresConfirmation: boolean;
  readonly denied: boolean;
  readonly risk: SessionToolRisk;
  readonly reason: SessionToolPolicyResolutionReason;
  readonly checkpointRequired: boolean;
  readonly permissionMode: SessionPermissionMode;
  readonly source?: SessionToolPolicyDecision["source"];
  readonly pattern?: string;
  readonly policyDecision: SessionToolPolicyDecision;
}

export interface SessionToolProviderFilterOptions {
  readonly permissionMode?: SessionPermissionMode;
  readonly canvasContext?: CanvasContext;
}

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

function buildResolution(input: SessionToolPolicyResolutionInput & {
  readonly risk: SessionToolRisk;
  readonly policyDecision: SessionToolPolicyDecision;
  readonly visibleToModel: boolean;
  readonly requiresConfirmation: boolean;
  readonly denied: boolean;
  readonly reason: SessionToolPolicyResolutionReason;
}): SessionToolPolicyResolution {
  return {
    toolName: input.toolName,
    visibleToModel: input.visibleToModel,
    requiresConfirmation: input.requiresConfirmation,
    denied: input.denied,
    risk: input.risk,
    reason: input.reason,
    checkpointRequired: !input.denied && (input.risk === "confirmed-write" || input.risk === "destructive"),
    permissionMode: input.permissionMode,
    ...(input.policyDecision.source ? { source: input.policyDecision.source } : {}),
    ...(input.policyDecision.pattern ? { pattern: input.policyDecision.pattern } : {}),
    policyDecision: input.policyDecision,
  };
}

export function resolveSessionToolPolicy(input: SessionToolPolicyResolutionInput): SessionToolPolicyResolution {
  const risk = normalizeSessionToolRisk(input.risk);
  const policyDecision = getSessionToolPolicyDecision(input.toolName, input.toolPolicy);

  if (policyDecision.action === "deny") {
    return buildResolution({ ...input, risk, policyDecision, visibleToModel: false, requiresConfirmation: false, denied: true, reason: "policy-denied" });
  }

  if (risk !== "read" && (input.permissionMode === "read" || input.permissionMode === "plan")) {
    return buildResolution({ ...input, risk, policyDecision, visibleToModel: false, requiresConfirmation: false, denied: true, reason: "permission-denied" });
  }

  if (risk !== "read" && input.canvasContext?.dirty === true) {
    return buildResolution({ ...input, risk, policyDecision, visibleToModel: false, requiresConfirmation: false, denied: true, reason: "dirty-resource-blocked" });
  }

  if (policyDecision.action === "ask") {
    return buildResolution({ ...input, risk, policyDecision, visibleToModel: true, requiresConfirmation: true, denied: false, reason: "policy-ask" });
  }

  if (policyDecision.action === "allow") {
    return buildResolution({ ...input, risk, policyDecision, visibleToModel: true, requiresConfirmation: false, denied: false, reason: "policy-allow" });
  }

  const riskDecision = getSessionToolRiskDecision(input.permissionMode, risk);
  if (riskDecision === "deny") {
    return buildResolution({ ...input, risk, policyDecision, visibleToModel: false, requiresConfirmation: false, denied: true, reason: "permission-denied" });
  }

  if (riskDecision === "confirm") {
    return buildResolution({ ...input, risk, policyDecision, visibleToModel: true, requiresConfirmation: true, denied: false, reason: "risk-confirmation" });
  }

  return buildResolution({ ...input, risk, policyDecision, visibleToModel: true, requiresConfirmation: false, denied: false, reason: "allowed" });
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
  options: SessionToolProviderFilterOptions = {},
): { readonly tools: readonly SessionToolDefinition[]; readonly deniedTools: readonly string[]; readonly resolutions: readonly SessionToolPolicyResolution[] } {
  const deniedTools: string[] = [];
  const resolutions: SessionToolPolicyResolution[] = [];
  const filtered = tools.filter((tool) => {
    const resolution = options.permissionMode
      ? resolveSessionToolPolicy({
        toolName: tool.name,
        risk: tool.risk,
        permissionMode: options.permissionMode,
        ...(policy ? { toolPolicy: policy } : {}),
        ...(options.canvasContext ? { canvasContext: options.canvasContext } : {}),
      })
      : resolveSessionToolPolicy({ toolName: tool.name, risk: tool.risk, permissionMode: "allow", ...(policy ? { toolPolicy: policy } : {}) });
    resolutions.push(resolution);
    if (resolution.visibleToModel) return true;
    deniedTools.push(tool.name);
    return false;
  });
  return { tools: filtered, deniedTools, resolutions };
}
