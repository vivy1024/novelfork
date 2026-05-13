/**
 * Permission Pipeline — bash command classification, path validation, and tool permission resolution.
 *
 * 对标 Claude Code CLI:
 * - src/utils/permissions/bashClassifier.ts (trusted/untrusted command classification)
 * - src/utils/permissions/pathValidation.ts (work directory boundary enforcement)
 * - src/utils/permissions/dangerousPatterns.ts (dangerous command detection)
 * - src/hooks/toolPermission/ (permission decision pipeline)
 */

import { resolve, relative, sep } from "node:path";
import type { CommandBlockRule } from "../../types/settings.js";

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

// --- Multi-source permission rules (对标 Claude Code CLI PermissionRule system) ---
// Claude 的规则来源: userSettings / projectSettings / localSettings / flagSettings / policySettings / cliArg / command / session
// 优先级: deny > ask > allow（deny 总是赢）

export type PermissionRuleSource = "user" | "project" | "session" | "cli" | "policy" | "default";
export type PermissionRuleBehavior = "allow" | "deny" | "ask";

export interface PermissionRule {
  readonly source: PermissionRuleSource;
  readonly behavior: PermissionRuleBehavior;
  readonly toolName?: string;  // 具体工具名，undefined 表示通配
  readonly pattern?: string;   // shell 命令模式匹配
  readonly reason?: string;
}

/**
 * 对标 Claude: 合并多来源规则，deny > ask > allow
 */
export function resolvePermissionRules(rules: readonly PermissionRule[], toolName: string, command?: string): PermissionRuleBehavior {
  const matchingRules = rules.filter((rule) => {
    if (rule.toolName && rule.toolName !== toolName && rule.toolName !== "*") return false;
    if (rule.pattern && command && !commandMatchesPattern(command, rule.pattern)) return false;
    if (rule.pattern && !command) return false;
    return true;
  });

  // deny 总是赢
  if (matchingRules.some((rule) => rule.behavior === "deny")) return "deny";
  // ask 优先于 allow
  if (matchingRules.some((rule) => rule.behavior === "ask")) return "ask";
  // 有 allow 规则
  if (matchingRules.some((rule) => rule.behavior === "allow")) return "allow";
  // 无匹配规则：默认 ask
  return "ask";
}

/**
 * 命令模式匹配规则：
 * - "*" 匹配所有命令
 * - "rm*" 匹配所有以 "rm" 开头的命令（包括 rm、rmdir、rm -rf 等）
 * - "git push" 匹配 "git push" 及其所有子命令（如 "git push --force"）
 * - 匹配基于命令文本前缀，不做 token 分词
 */
function commandMatchesPattern(command: string, pattern: string): boolean {
  if (pattern === "*") return true;
  if (pattern.endsWith("*")) {
    return command.startsWith(pattern.slice(0, -1));
  }
  return command.trim().startsWith(pattern);
}


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
  // 解析为绝对路径（相对路径基于 workDir 解析，绝对路径直接使用）
  const absolutePath = (filePath.startsWith("/") || /^[A-Za-z]:/.test(filePath))
    ? resolve(filePath)
    : resolve(workDir, filePath);
  const normalizedWorkDir = resolve(workDir);
  // 检查解析后的绝对路径是否在 workDir 内（或等于 workDir）
  const relativePath = relative(normalizedWorkDir, absolutePath);
  return relativePath === "" || (!relativePath.startsWith("..") && !relativePath.startsWith(sep + ".."));
}

// --- Command allow/block list (Phase 4.2) ---

export function checkCommandAgainstLists(
  command: string,
  allowlist: readonly string[],
  blocklist: readonly CommandBlockRule[],
): { allowed: boolean; blocked: boolean; reason?: string } {
  const trimmed = command.trim();

  // Blocklist takes priority (deny > allow)
  for (const rule of blocklist) {
    if (commandMatchesPattern(trimmed, rule.pattern)) {
      return { allowed: false, blocked: true, reason: rule.rejectHint ?? `命令匹配黑名单规则: ${rule.pattern}` };
    }
  }

  // If allowlist is non-empty, command must match at least one pattern
  if (allowlist.length > 0) {
    const isAllowed = allowlist.some(pattern => commandMatchesPattern(trimmed, pattern));
    if (isAllowed) {
      return { allowed: true, blocked: false };
    }
    // Not in allowlist — don't block, but don't auto-allow either (let other checks decide)
  }

  return { allowed: false, blocked: false }; // neutral
}

// --- Directory access control (Phase 4.3) ---

export function checkPathAgainstDirectoryLists(
  filePath: string,
  workDir: string,
  allowlist: readonly string[],
  blocklist: readonly string[],
): { allowed: boolean; blocked: boolean; reason?: string } {
  const absolutePath = (filePath.startsWith("/") || /^[A-Za-z]:/.test(filePath))
    ? resolve(filePath)
    : resolve(workDir, filePath);
  const normalizedPath = absolutePath.toLowerCase().replace(/\\/g, "/");

  // Blocklist takes priority
  for (const dir of blocklist) {
    const normalizedDir = resolve(dir).toLowerCase().replace(/\\/g, "/");
    if (normalizedPath.startsWith(normalizedDir)) {
      return { allowed: false, blocked: true, reason: `路径在黑名单目录内: ${dir}` };
    }
  }

  // If allowlist is non-empty, path must be within at least one allowed directory
  if (allowlist.length > 0) {
    const isAllowed = allowlist.some(dir => {
      const normalizedDir = resolve(dir).toLowerCase().replace(/\\/g, "/");
      return normalizedPath.startsWith(normalizedDir);
    });
    if (isAllowed) {
      return { allowed: true, blocked: false };
    }
    // Not in allowlist — soft check, don't block (workDir boundary is the hard check)
  }

  return { allowed: false, blocked: false }; // neutral
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
