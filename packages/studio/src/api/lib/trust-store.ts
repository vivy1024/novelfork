/**
 * Cumulative trust store — remembers operations the user has allowed.
 * Next time the same operation pattern is requested, auto-allow without asking.
 *
 * Currently uses in-memory Map. SQLite persistence is planned for a future phase.
 * Trust entries expire after 30 days of non-use.
 */

export interface TrustEntry {
  pattern: string;
  toolName: string;
  allowedAt: number;
  lastUsedAt: number;
  useCount: number;
}

const TRUST_EXPIRY_DAYS = 30;

const trustMap = new Map<string, TrustEntry>();

/**
 * Build a trust pattern from tool name and input fields.
 * Patterns are coarse-grained to avoid over-fitting to specific arguments.
 */
function buildTrustPattern(toolName: string, input: Record<string, unknown>): string {
  // For Bash: use command prefix (first word + glob)
  if (toolName === "Bash" && typeof input.command === "string") {
    const cmd = input.command.trim();
    const firstWord = cmd.split(/\s+/)[0] ?? cmd;
    return `Bash:${firstWord} *`;
  }
  // For Write/Edit: use file path directory
  if ((toolName === "Write" || toolName === "Edit") && typeof input.file_path === "string") {
    const filePath = input.file_path as string;
    const dir = filePath.split("/").slice(0, -1).join("/");
    return `${toolName}:${dir}/*`;
  }
  // Generic: tool name only
  return `${toolName}:*`;
}

/**
 * Check if an operation is trusted (previously allowed by user).
 */
export function isTrusted(toolName: string, input: Record<string, unknown>): boolean {
  const pattern = buildTrustPattern(toolName, input);
  const entry = trustMap.get(pattern);
  if (!entry) return false;

  // Check expiry
  const daysSinceUse = (Date.now() - entry.lastUsedAt) / (1000 * 60 * 60 * 24);
  if (daysSinceUse > TRUST_EXPIRY_DAYS) {
    trustMap.delete(pattern);
    return false;
  }

  return true;
}

/**
 * Record that user allowed an operation.
 */
export function recordTrust(toolName: string, input: Record<string, unknown>): void {
  const pattern = buildTrustPattern(toolName, input);
  const existing = trustMap.get(pattern);
  if (existing) {
    existing.lastUsedAt = Date.now();
    existing.useCount++;
  } else {
    trustMap.set(pattern, {
      pattern,
      toolName,
      allowedAt: Date.now(),
      lastUsedAt: Date.now(),
      useCount: 1,
    });
  }
}

/**
 * Get all current trust entries (for debugging/UI display).
 */
export function getAllTrustEntries(): readonly TrustEntry[] {
  return Array.from(trustMap.values());
}

/**
 * Revoke trust for a specific pattern.
 */
export function revokeTrust(pattern: string): boolean {
  return trustMap.delete(pattern);
}

/**
 * Clear all trust entries.
 */
export function clearAllTrust(): void {
  trustMap.clear();
}
