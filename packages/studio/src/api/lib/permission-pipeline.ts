/**
 * Permission Pipeline — bash command classification, path validation, and tool permission resolution.
 *
 * 对标 Claude Code CLI:
 * - src/utils/permissions/bashClassifier.ts (trusted/untrusted command classification)
 * - src/utils/permissions/pathValidation.ts (work directory boundary enforcement)
 * - src/utils/permissions/dangerousPatterns.ts (dangerous command detection)
 * - src/hooks/toolPermission/ (permission decision pipeline)
 */

import { resolve, relative } from "node:path";

// --- Types ---

export type BashCommandRisk = "read" | "write" | "network" | "destructive";
export type BashCommandClassificationType = "trusted" | "untrusted" | "dangerous";

export interface BashCommandClassification {
  readonly classification: BashCommandClassificationType;
  readonly risk: BashCommandRisk;
  readonly reason?: string;
}

export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access" | undefined;

export interface ToolPermissionInput {
  readonly toolName: string;
  readonly risk: string;
  readonly permissionMode: string;
  readonly workDir: string;
  readonly command?: string;
  readonly path?: string;
  readonly sandboxMode?: SandboxMode;
}

export interface ToolPermissionResult {
  readonly allowed: boolean;
  readonly requiresConfirmation?: boolean;
  readonly reason?: string;
  readonly classification?: BashCommandClassification;
}

// --- Dangerous patterns (对标 Claude Code CLI dangerousPatterns.ts) ---

const DANGEROUS_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\brm\s+(-[a-zA-Z]*[rf][a-zA-Z]*\s+){1,2}\//, reason: "recursive delete from root" },
  { pattern: /\bmkfs\b/, reason: "filesystem format" },
  { pattern: /\bdd\s+.*of=\/dev\//, reason: "raw device write" },
  { pattern: /\bformat\s+[a-zA-Z]:/i, reason: "disk format (Windows)" },
  { pattern: /\b(chmod|chown)\s+.*-R\s+\//, reason: "recursive permission change from root" },
  { pattern: />\s*\/dev\/sd[a-z]/, reason: "redirect to raw device" },
  { pattern: /\bshutdown\b/, reason: "system shutdown" },
  { pattern: /\breboot\b/, reason: "system reboot" },
  { pattern: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, reason: "fork bomb" },
  { pattern: /\brm\s+-[a-zA-Z]*r[a-zA-Z]*\s+~/, reason: "recursive delete home" },
  { pattern: /\b(curl|wget)\s+.*\|\s*(ba)?sh\b/, reason: "pipe remote script to shell" },
];

// --- Trusted command prefixes (对标 Claude Code CLI bashClassifier.ts) ---

const TRUSTED_READ_COMMANDS = [
  "ls", "cat", "head", "tail", "less", "more", "wc", "file", "stat",
  "find", "grep", "rg", "ag", "ack",
  "tree", "du", "df", "pwd", "echo", "printf", "date", "whoami",
  "git status", "git log", "git diff", "git show", "git branch", "git remote",
  "git rev-parse", "git describe", "git tag -l",
  "node --version", "npm --version", "bun --version", "pnpm --version",
  "python --version", "rustc --version", "go version",
  "which", "where", "type", "command -v",
];

const UNTRUSTED_WRITE_COMMANDS = [
  "rm", "mv", "cp", "mkdir", "rmdir", "touch",
  "git commit", "git push", "git merge", "git rebase", "git reset", "git checkout",
  "git add", "git stash", "git cherry-pick",
  "npm install", "npm uninstall", "npm run", "npm exec",
  "pnpm install", "pnpm add", "pnpm remove", "pnpm run", "pnpm exec",
  "bun install", "bun add", "bun remove", "bun run",
  "pip install", "pip uninstall",
  "cargo build", "cargo run", "cargo install",
  "chmod", "chown",
];

const NETWORK_COMMANDS = [
  "curl", "wget", "fetch", "http", "ssh", "scp", "rsync",
  "git clone", "git fetch", "git pull",
  "npm publish", "docker",
];

// --- Classification ---

export function isDangerousCommand(command: string): boolean {
  return DANGEROUS_PATTERNS.some(({ pattern }) => pattern.test(command));
}

function getDangerousReason(command: string): string | undefined {
  const match = DANGEROUS_PATTERNS.find(({ pattern }) => pattern.test(command));
  return match?.reason;
}

function getFirstToken(command: string): string {
  return command.trim().split(/\s+/)[0] ?? "";
}

function commandStartsWith(command: string, prefixes: readonly string[]): boolean {
  const trimmed = command.trim();
  return prefixes.some((prefix) => trimmed === prefix || trimmed.startsWith(prefix + " ") || trimmed.startsWith(prefix + "\t"));
}

export function classifyBashCommand(command: string): BashCommandClassification {
  // Check dangerous first
  if (isDangerousCommand(command)) {
    return { classification: "dangerous", risk: "destructive", reason: getDangerousReason(command) };
  }

  // Check network
  if (commandStartsWith(command, NETWORK_COMMANDS)) {
    return { classification: "untrusted", risk: "network" };
  }

  // Check trusted read
  if (commandStartsWith(command, TRUSTED_READ_COMMANDS)) {
    return { classification: "trusted", risk: "read" };
  }

  // Check known write commands
  if (commandStartsWith(command, UNTRUSTED_WRITE_COMMANDS)) {
    return { classification: "untrusted", risk: "write" };
  }

  // Default: untrusted write (unknown commands are not trusted)
  return { classification: "untrusted", risk: "write" };
}

// --- Path validation ---

export function isPathWithinWorkDir(filePath: string, workDir: string): boolean {
  // Absolute paths are always rejected (must be relative to workDir)
  if (filePath.startsWith("/") || /^[A-Za-z]:/.test(filePath)) {
    return false;
  }
  const absolutePath = resolve(workDir, filePath);
  const relativePath = relative(workDir, absolutePath);
  return !relativePath.startsWith("..");
}

// --- Tool permission validation ---

export function validateToolPermission(input: ToolPermissionInput): ToolPermissionResult {
  const { toolName, risk, permissionMode, command, sandboxMode } = input;

  // Sandbox enforcement (对标 Codex sandbox read-only/workspace-write/danger-full-access)
  if (sandboxMode === "read-only" && risk !== "read") {
    return { allowed: false, reason: "Write operations blocked by read-only sandbox mode" };
  }

  // danger-full-access bypasses all sandbox restrictions (but not dangerous pattern detection unless explicitly allowed)
  if (sandboxMode === "danger-full-access") {
    // Still block fork bombs and system-level destruction
    if (command && DANGEROUS_PATTERNS.some(({ pattern, reason }) => pattern.test(command) && (reason === "fork bomb" || reason === "system shutdown" || reason === "system reboot"))) {
      return { allowed: false, reason: "System-level dangerous commands blocked even in full-access sandbox" };
    }
    return { allowed: true };
  }

  // Dangerous commands are always blocked
  if (command && isDangerousCommand(command)) {
    return { allowed: false, reason: "Command blocked: dangerous pattern detected", classification: classifyBashCommand(command) };
  }

  // Bash tool: classify and apply policy
  if (toolName === "Bash" && command) {
    const classification = classifyBashCommand(command);
    if (classification.classification === "dangerous") {
      return { allowed: false, reason: "Command blocked: dangerous pattern detected", classification };
    }

    if (permissionMode === "read" && classification.risk !== "read") {
      return { allowed: false, reason: "Write/network commands blocked in read mode", classification };
    }

    if (permissionMode === "ask" && classification.classification === "untrusted") {
      return { allowed: false, requiresConfirmation: true, reason: "Untrusted command requires confirmation in ask mode", classification };
    }

    return { allowed: true, classification };
  }

  // Non-bash tools: apply simple risk-based policy
  if (risk === "read") {
    return { allowed: true };
  }

  if (risk === "destructive") {
    return { allowed: false, reason: "Destructive operations always require explicit approval" };
  }

  // Write risk
  if (permissionMode === "read") {
    return { allowed: false, reason: "Write tools blocked in read permission mode" };
  }

  if (permissionMode === "ask") {
    return { allowed: false, requiresConfirmation: true, reason: "Write tools require confirmation in ask mode" };
  }

  // allow / edit mode
  return { allowed: true };
}
