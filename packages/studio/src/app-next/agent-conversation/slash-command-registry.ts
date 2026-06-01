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
  /** Novel command 执行：从 binding 提取 bookId 调用后端 API */
  readonly bookId?: string;
  /** 对标 Claude Code CLI: 运行时命令启用/禁用注册表 */
  readonly commandEnabledRegistry?: CommandEnabledRegistryLike;
  /** 用户自定义命令（含 prompt 模板），避免展开时重复请求 API */
  readonly userCommands?: readonly UserCommand[];
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
  const bookId = context.bookId;

  const executeNovelCommand = bookId ? async (handlerId: string, _args: string) => {
    const NOVEL_API_MAP: Record<string, string> = {
      "novel.audit": `/api/books/${encodeURIComponent(bookId)}/audit`,
      "novel.detect": `/api/books/${encodeURIComponent(bookId)}/filter/scan-all`,
      "novel.hooks": `/api/books/${encodeURIComponent(bookId)}/hooks/generate`,
    };
    const endpoint = NOVEL_API_MAP[handlerId];
    if (!endpoint) return { ok: false as const, kind: "error" as const, code: "unhandled_novel_command", message: `Novel 命令 ${handlerId} 暂未实现。` };
    try {
      const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      if (!res.ok) return { ok: false as const, kind: "error" as const, code: "novel_api_error", message: `API 调用失败：${res.status}` };
      const data = await res.json();
      return { ok: true as const, kind: "status" as const, message: data.status === "writing" ? "写作管线已启动，请等待完成通知。" : JSON.stringify(data) };
    } catch (e) {
      return { ok: false as const, kind: "error" as const, code: "novel_network_error", message: e instanceof Error ? e.message : "网络错误" };
    }
  } : undefined;

  // /tools handler: fetch enabled tools from API
  const listTools = async () => {
    try {
      const res = await fetch("/api/tools/list");
      if (!res.ok) return [];
      const data = await res.json() as { tools?: { name: string; description: string }[] };
      return (data.tools ?? []).map((t) => ({ name: t.name, description: t.description }));
    } catch { return []; }
  };

  // /mcp handler: fetch MCP server statuses from API
  const listMcpServers = async () => {
    try {
      const res = await fetch("/api/mcp/registry");
      if (!res.ok) return [];
      const data = await res.json() as { servers?: { name: string; status: string; toolCount: number }[] };
      return (data.servers ?? []).map((s) => ({ name: s.name, status: s.status, toolCount: s.toolCount }));
    } catch { return []; }
  };

  // /agents handler: return available subagent types
  const listAgents = () => [
    { name: "explore", description: "探索子代理 — 只读代码搜索与文件浏览" },
    { name: "plan", description: "规划子代理 — 任务分解与方案设计" },
    { name: "general", description: "通用子代理 — 可读写的通用执行" },
  ];

  const execution = await executeRuntimeCommandInput(input, {
    sessionId: context.status?.sessionId,
    registry: registry.commands,
    status: context.status,
    handlers: {
      ...(compactSession ? { compactSession: (instructions) => compactSession(instructions) } : {}),
      ...(executeNovelCommand ? { executeNovelCommand } : {}),
      listTools,
      listMcpServers,
      listAgents,
    },
    // 对标 Claude Code CLI: 接入 command-enabled-registry 做运行时禁用检查
    ...(context.commandEnabledRegistry ? { isCommandEnabled: (id) => context.commandEnabledRegistry!.isEnabled(id) } : {}),
  });
  return { ...execution.result, runtimeEvents: execution.events } as SlashCommandExecutionResult;
}

/**
 * 将套路系统中的用户自定义命令转换为 SlashCommandDefinition 并合并到 registry。
 * 用户自定义命令执行时展开 prompt 模板作为普通消息发送。
 */
export interface UserCommand {
  id: string;
  name: string;
  description: string;
  prompt: string;
  enabled: boolean;
}

export function mergeUserCommandsIntoRegistry(
  baseRegistry: SlashCommandRegistry,
  userCommands: UserCommand[],
): SlashCommandRegistry {
  const userDefs = userCommands
    .filter(cmd => cmd.enabled && cmd.name.trim())
    .map(cmd => ({
      id: `/${cmd.name}`,
      name: cmd.name,
      aliases: [] as readonly string[],
      title: cmd.name,
      usage: `/${cmd.name} [参数]`,
      description: cmd.description || `用户自定义命令: ${cmd.name}`,
      scope: "session" as const,
      inputSchema: { type: "object" as const },
      permissionImpact: { mode: "none" as const, requiresConfirmation: false, description: "用户自定义命令" },
      runtimeHandler: "user-command",
      status: "current" as const,
      source: "builtin" as const,
      handler: "user-command",
    } as SlashCommandDefinition & { handler: string }));
  return { commands: [...baseRegistry.commands, ...userDefs] };
}

/**
 * 展开用户自定义命令的 prompt 模板。
 * 支持 {{input}} 占位符替换为用户输入的参数。
 */
export function expandUserCommandPrompt(prompt: string, args: string): string {
  return prompt.replace(/\{\{input\}\}/g, args).replace(/\{\{args\}\}/g, args);
}
