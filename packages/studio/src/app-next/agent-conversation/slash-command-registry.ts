import { SESSION_PERMISSION_MODES, type SessionPermissionMode } from "@/shared/session-types";

export type SlashCommandName = "help" | "status" | "model" | "permission" | "fork" | "resume" | "compact";

export interface SlashCommandDefinition {
  readonly name: SlashCommandName;
  readonly usage: string;
  readonly description: string;
}

export type SlashCommandParseResult =
  | { readonly ok: true; readonly raw: string; readonly name: string; readonly args: string }
  | { readonly ok: false; readonly reason: "empty" | "not-slash" };

export type SlashCommandExecutionResult =
  | { readonly ok: true; readonly kind: "status"; readonly message: string }
  | { readonly ok: true; readonly kind: "update-session-config"; readonly message: string; readonly patch: { readonly providerId?: string; readonly modelId?: string; readonly permissionMode?: SessionPermissionMode } }
  | { readonly ok: true; readonly kind: "fork-session"; readonly message: string; readonly title?: string }
  | { readonly ok: true; readonly kind: "resume-session"; readonly message: string; readonly sessionId: string }
  | { readonly ok: true; readonly kind: "focus-model"; readonly message: string }
  | { readonly ok: true; readonly kind: "compact-session"; readonly message: string; readonly summary: string; readonly budget: { readonly estimatedTokensBefore: number; readonly estimatedTokensAfter: number }; readonly compactedMessageCount: number }
  | { readonly ok: true; readonly kind: "compact-pending"; readonly message: string; readonly instructions?: string }
  | { readonly ok: false; readonly kind: "error"; readonly code: string; readonly message: string };

export interface SlashCommandRegistry {
  readonly commands: readonly SlashCommandDefinition[];
}

export interface SlashCommandStatusContext {
  readonly sessionId?: string;
  readonly modelLabel?: string;
  readonly permissionMode?: SessionPermissionMode;
}

export interface SlashCommandCompactResult {
  readonly ok: true;
  readonly summary: string;
  readonly budget: { readonly estimatedTokensBefore: number; readonly estimatedTokensAfter: number };
  readonly compactedMessageCount: number;
}

export interface SlashCommandExecutionContext {
  readonly registry?: SlashCommandRegistry;
  readonly status?: SlashCommandStatusContext;
  readonly compactSession?: (instructions?: string) => Promise<SlashCommandCompactResult>;
}

const DEFAULT_COMMANDS: readonly SlashCommandDefinition[] = [
  { name: "help", usage: "/help", description: "显示会话命令帮助。" },
  { name: "status", usage: "/status", description: "显示当前会话、模型与权限状态。" },
  { name: "model", usage: "/model [provider:model]", description: "切换模型，或打开模型选择器。" },
  { name: "permission", usage: "/permission [ask|edit|allow|read|plan]", description: "切换会话权限模式。" },
  { name: "fork", usage: "/fork [title]", description: "从当前会话创建 fork。" },
  { name: "resume", usage: "/resume [sessionId]", description: "恢复指定会话。" },
  { name: "compact", usage: "/compact [instructions]", description: "压缩上下文；当前登记为后续 compact 流程入口。" },
];

export function createDefaultSlashCommandRegistry(): SlashCommandRegistry {
  return { commands: DEFAULT_COMMANDS };
}

export function parseSlashCommandInput(input: string): SlashCommandParseResult {
  const raw = input.trim();
  if (!raw) return { ok: false, reason: "empty" };
  if (!raw.startsWith("/")) return { ok: false, reason: "not-slash" };
  const [nameWithSlash = "", ...rest] = raw.split(/\s+/);
  return { ok: true, raw, name: nameWithSlash.slice(1).toLowerCase(), args: rest.join(" ").trim() };
}

export function getSlashCommandSuggestions(input: string, registry = createDefaultSlashCommandRegistry()): readonly SlashCommandDefinition[] {
  const parsed = parseSlashCommandInput(input);
  if (!parsed.ok) return [];
  const query = parsed.name;
  return registry.commands.filter((command) => command.name.startsWith(query));
}

function findCommand(registry: SlashCommandRegistry, name: string): SlashCommandDefinition | undefined {
  return registry.commands.find((command) => command.name === name);
}

function isPermissionMode(value: string): value is SessionPermissionMode {
  return (SESSION_PERMISSION_MODES as readonly string[]).includes(value);
}

function helpMessage(registry: SlashCommandRegistry): string {
  return registry.commands.map((command) => `${command.usage} — ${command.description}`).join("\n");
}

function statusMessage(status?: SlashCommandStatusContext): string {
  const sessionId = status?.sessionId ?? "未绑定会话";
  const model = status?.modelLabel ?? "未配置模型";
  const permission = status?.permissionMode ?? "edit";
  return `会话：${sessionId}\n模型：${model}\n权限：${permission}`;
}

export async function executeSlashCommandInput(input: string, context: SlashCommandExecutionContext = {}): Promise<SlashCommandExecutionResult> {
  const registry = context.registry ?? createDefaultSlashCommandRegistry();
  const parsed = parseSlashCommandInput(input);
  if (!parsed.ok) {
    return { ok: false, kind: "error", code: parsed.reason, message: "这不是斜杠命令。" };
  }
  const command = findCommand(registry, parsed.name);
  if (!command) return { ok: false, kind: "error", code: "unknown_command", message: `未知命令：/${parsed.name}` };

  switch (command.name) {
    case "help":
      return { ok: true, kind: "status", message: helpMessage(registry) };
    case "status":
      return { ok: true, kind: "status", message: statusMessage(context.status) };
    case "model": {
      if (!parsed.args) return { ok: true, kind: "focus-model", message: "打开模型选择器。" };
      const separator = parsed.args.includes("::") ? "::" : ":";
      const [providerId, modelId] = parsed.args.split(separator);
      if (!providerId?.trim() || !modelId?.trim()) return { ok: false, kind: "error", code: "invalid_model", message: "模型参数格式应为 provider:model。" };
      return { ok: true, kind: "update-session-config", message: `切换模型为 ${providerId.trim()}:${modelId.trim()}`, patch: { providerId: providerId.trim(), modelId: modelId.trim() } };
    }
    case "permission": {
      if (!parsed.args) return { ok: false, kind: "error", code: "missing_permission_mode", message: "缺少权限模式。" };
      if (!isPermissionMode(parsed.args)) return { ok: false, kind: "error", code: "invalid_permission_mode", message: "无效权限模式，可选 ask/edit/allow/read/plan。" };
      return { ok: true, kind: "update-session-config", message: `权限已切换为 ${parsed.args}`, patch: { permissionMode: parsed.args } };
    }
    case "fork":
      return { ok: true, kind: "fork-session", message: parsed.args ? `创建 fork：${parsed.args}` : "创建当前会话 fork。", ...(parsed.args ? { title: parsed.args } : {}) };
    case "resume":
      if (!parsed.args) return { ok: false, kind: "error", code: "missing_session_id", message: "缺少 sessionId。" };
      return { ok: true, kind: "resume-session", message: `恢复会话 ${parsed.args}`, sessionId: parsed.args };
    case "compact": {
      if (!context.compactSession) {
        return { ok: true, kind: "compact-pending", message: "Compact 流程将在后续任务接入。", ...(parsed.args ? { instructions: parsed.args } : {}) };
      }
      const compacted = await context.compactSession(parsed.args || undefined);
      return {
        ok: true,
        kind: "compact-session",
        message: `Compact 完成：${compacted.compactedMessageCount} 条历史已压缩，预算 ${compacted.budget.estimatedTokensBefore} → ${compacted.budget.estimatedTokensAfter} tokens。`,
        summary: compacted.summary,
        budget: compacted.budget,
        compactedMessageCount: compacted.compactedMessageCount,
      };
    }
    default:
      return { ok: false, kind: "error", code: "unhandled_command", message: `命令未处理：/${command.name}` };
  }
}
