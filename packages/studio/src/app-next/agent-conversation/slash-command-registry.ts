import { executeRuntimeCommandInput, type RuntimeCommandEvent } from "@vivy1024/novelfork-core/registry/command-executor";
import { getRuntimeCommandDefinition, listRuntimeCommands, type RuntimeCommandDefinition } from "@vivy1024/novelfork-core/registry/command-registry";

import type { SessionPermissionMode } from "@/shared/session-types";

/** 对标 CommandEnabledRegistry 接口（内联以避免 browser/server 边界违规） */
interface CommandEnabledRegistryLike {
  isEnabled(commandId: string): boolean;
}

export type SlashCommandName = string;

export interface SlashCommandDefinition extends RuntimeCommandDefinition {
  readonly name: SlashCommandName;
}

export type SlashCommandParseResult =
  | { readonly ok: true; readonly raw: string; readonly name: string; readonly args: string }
  | { readonly ok: false; readonly reason: "empty" | "not-slash" };

export type SlashCommandExecutionResult = (
  | { readonly ok: true; readonly kind: "status"; readonly message: string }
  | { readonly ok: true; readonly kind: "update-session-config"; readonly message: string; readonly patch: { readonly providerId?: string; readonly modelId?: string; readonly permissionMode?: SessionPermissionMode } }
  | { readonly ok: true; readonly kind: "fork-session"; readonly message: string; readonly title?: string }
  | { readonly ok: true; readonly kind: "resume-session"; readonly message: string; readonly sessionId: string }
  | { readonly ok: true; readonly kind: "focus-model"; readonly message: string }
  | { readonly ok: true; readonly kind: "compact-session"; readonly message: string; readonly summary: string; readonly budget: { readonly estimatedTokensBefore: number; readonly estimatedTokensAfter: number }; readonly compactedMessageCount: number }
  | { readonly ok: true; readonly kind: "compact-pending"; readonly message: string; readonly instructions?: string }
  | { readonly ok: false; readonly kind: "error"; readonly code: string; readonly message: string }
) & { readonly runtimeEvents: readonly RuntimeCommandEvent[] };

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
  /** 对标 Claude Code CLI: 运行时命令启用/禁用注册表 */
  readonly commandEnabledRegistry?: CommandEnabledRegistryLike;
}

function commandNameFromId(id: string): SlashCommandName {
  return id.replace(/^\//, "");
}

function toSlashCommandDefinition(command: RuntimeCommandDefinition): SlashCommandDefinition {
  return {
    ...command,
    name: commandNameFromId(command.id),
  };
}

export function createDefaultSlashCommandRegistry(): SlashCommandRegistry {
  return { commands: listRuntimeCommands().map(toSlashCommandDefinition) };
}

export function parseSlashCommandInput(input: string): SlashCommandParseResult {
  const raw = input.trim();
  if (!raw) return { ok: false, reason: "empty" };
  if (!raw.startsWith("/")) return { ok: false, reason: "not-slash" };
  const [nameWithSlash = "", ...rest] = raw.split(/\s+/);
  return { ok: true, raw, name: nameWithSlash.slice(1).toLowerCase(), args: rest.join(" ").trim() };
}

function aliasMatches(command: SlashCommandDefinition, query: string): boolean {
  return command.aliases.some((alias) => alias.replace(/^\//, "").startsWith(query));
}

export function getSlashCommandSuggestions(input: string, registry = createDefaultSlashCommandRegistry()): readonly SlashCommandDefinition[] {
  const parsed = parseSlashCommandInput(input);
  if (!parsed.ok) return [];
  const query = parsed.name;
  return registry.commands.filter((command) => command.name.startsWith(query) || aliasMatches(command, query));
}

function findCommand(registry: SlashCommandRegistry, name: string): SlashCommandDefinition | undefined {
  const normalized = name.startsWith("/") ? name : `/${name}`;
  const canonical = getRuntimeCommandDefinition(normalized);
  const canonicalId = canonical?.id;
  return registry.commands.find((command) => command.id === normalized || command.id === canonicalId || command.name === name || command.aliases.includes(normalized));
}

export async function executeSlashCommandInput(input: string, context: SlashCommandExecutionContext = {}): Promise<SlashCommandExecutionResult> {
  const registry = context.registry ?? createDefaultSlashCommandRegistry();
  const compactSession = context.compactSession;
  const execution = await executeRuntimeCommandInput(input, {
    sessionId: context.status?.sessionId,
    registry: registry.commands,
    status: context.status,
    handlers: {
      ...(compactSession ? { compactSession: (instructions) => compactSession(instructions) } : {}),
    },
    // 对标 Claude Code CLI: 接入 command-enabled-registry 做运行时禁用检查
    ...(context.commandEnabledRegistry ? { isCommandEnabled: (id) => context.commandEnabledRegistry!.isEnabled(id) } : {}),
  });
  return { ...execution.result, runtimeEvents: execution.events } as SlashCommandExecutionResult;
}
