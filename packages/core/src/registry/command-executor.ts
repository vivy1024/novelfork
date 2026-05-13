import { getRuntimeCommandDefinition, listRuntimeCommands, type RuntimeCommandDefinition } from "./command-registry.js";

export type RuntimeCommandPatch = {
  readonly providerId?: string;
  readonly modelId?: string;
  readonly permissionMode?: RuntimeCommandPermissionMode;
};

export type RuntimeCommandPermissionMode = "ask" | "edit" | "allow" | "read" | "plan";

export type RuntimeCommandExecutionResult =
  | { readonly ok: true; readonly kind: "status"; readonly message: string }
  | { readonly ok: true; readonly kind: "update-session-config"; readonly message: string; readonly patch: RuntimeCommandPatch }
  | { readonly ok: true; readonly kind: "fork-session"; readonly message: string; readonly title?: string }
  | { readonly ok: true; readonly kind: "resume-session"; readonly message: string; readonly sessionId: string }
  | { readonly ok: true; readonly kind: "focus-model"; readonly message: string }
  | { readonly ok: true; readonly kind: "compact-session"; readonly message: string; readonly summary: string; readonly budget: { readonly estimatedTokensBefore: number; readonly estimatedTokensAfter: number }; readonly compactedMessageCount: number }
  | { readonly ok: true; readonly kind: "compact-pending"; readonly message: string; readonly instructions?: string }
  | { readonly ok: false; readonly kind: "error"; readonly code: string; readonly message: string };

export interface RuntimeCommandParsedInput {
  readonly raw: string;
  readonly name: string;
  readonly args: string;
}

export interface RuntimeCommandHandlerContext {
  readonly commandId: string;
  readonly commandName: string;
  readonly args: string;
  readonly raw: string;
}

export interface RuntimeCommandStatusContext {
  readonly sessionId?: string;
  readonly modelLabel?: string;
  readonly permissionMode?: RuntimeCommandPermissionMode;
}

export interface RuntimeCommandCompactResult {
  readonly ok: true;
  readonly summary: string;
  readonly budget: { readonly estimatedTokensBefore: number; readonly estimatedTokensAfter: number };
  readonly compactedMessageCount: number;
}

export interface RuntimeCommandHandlers {
  readonly updateSessionConfig?: (patch: RuntimeCommandPatch, context: RuntimeCommandHandlerContext) => Promise<{ readonly message?: string } | void> | { readonly message?: string } | void;
  readonly forkSession?: (title: string | undefined, context: RuntimeCommandHandlerContext) => Promise<{ readonly message?: string; readonly title?: string } | void> | { readonly message?: string; readonly title?: string } | void;
  readonly resumeSession?: (sessionId: string, context: RuntimeCommandHandlerContext) => Promise<{ readonly message?: string; readonly sessionId?: string } | void> | { readonly message?: string; readonly sessionId?: string } | void;
  readonly compactSession?: (instructions: string | undefined, context: RuntimeCommandHandlerContext) => Promise<RuntimeCommandCompactResult> | RuntimeCommandCompactResult;
  /** Novel command handler: 执行 /novel:* 命令的 workflow */
  readonly executeNovelCommand?: (handlerId: string, args: string, context: RuntimeCommandHandlerContext) => Promise<RuntimeCommandExecutionResult>;
  /** /tools handler: list enabled tools for the session */
  readonly listTools?: () => readonly { name: string; description: string }[];
  /** /mcp handler: list connected MCP servers */
  readonly listMcpServers?: () => readonly { name: string; status: string; toolCount: number }[];
  /** /agents handler: list available subagent types */
  readonly listAgents?: () => readonly { name: string; description: string }[];
}

export interface RuntimeCommandExecutionContext {
  readonly sessionId?: string;
  readonly registry?: readonly RuntimeCommandDefinition[];
  readonly status?: RuntimeCommandStatusContext;
  readonly handlers?: RuntimeCommandHandlers;
  /** 对标 Claude Code CLI isCommandEnabled: 运行时检查命令是否被禁用 */
  readonly isCommandEnabled?: (commandId: string) => boolean;
}

export type RuntimeCommandEvent =
  | {
    readonly type: "command_started";
    readonly session_id?: string;
    readonly command_id: string;
    readonly command_name: string;
    readonly raw: string;
    readonly args: string;
  }
  | {
    readonly type: "command_completed";
    readonly session_id?: string;
    readonly command_id: string;
    readonly command_name: string;
    readonly raw: string;
    readonly args: string;
    readonly result: RuntimeCommandExecutionResult;
  }
  | {
    readonly type: "command_error";
    readonly session_id?: string;
    readonly command_id?: string;
    readonly command_name?: string;
    readonly raw: string;
    readonly args?: string;
    readonly code: string;
    readonly message: string;
  };

export interface RuntimeCommandExecution {
  readonly ok: boolean;
  readonly command?: RuntimeCommandDefinition;
  readonly parsed?: RuntimeCommandParsedInput;
  readonly result: RuntimeCommandExecutionResult;
  readonly events: readonly RuntimeCommandEvent[];
}

const SESSION_PERMISSION_MODES = new Set<RuntimeCommandPermissionMode>(["ask", "edit", "allow", "read", "plan"]);

function withSession<T extends object>(sessionId: string | undefined, value: T): T & { readonly session_id?: string } {
  return sessionId ? { ...value, session_id: sessionId } : value;
}

function parseRuntimeCommandInput(input: string): RuntimeCommandParsedInput | null {
  const raw = input.trim();
  if (!raw || !raw.startsWith("/")) return null;
  const [nameWithSlash = "", ...rest] = raw.split(/\s+/);
  return { raw, name: nameWithSlash.slice(1).toLowerCase(), args: rest.join(" ").trim() };
}

function findCommand(parsed: RuntimeCommandParsedInput, registry: readonly RuntimeCommandDefinition[]): RuntimeCommandDefinition | undefined {
  const normalized = `/${parsed.name}`;
  const canonical = getRuntimeCommandDefinition(normalized);
  const canonicalId = canonical?.id;
  return registry.find((command) => command.id === normalized || command.id === canonicalId || command.aliases.includes(normalized));
}

function commandName(command: RuntimeCommandDefinition): string {
  return command.id.replace(/^\//, "");
}

function unavailableCommand(command: RuntimeCommandDefinition): RuntimeCommandExecutionResult | null {
  if (command.status === "current" || command.status === "partial") return null;
  const code = command.status === "planned" ? "planned_command" : command.status === "reference-only" ? "reference_only_command" : "unsupported_command";
  return { ok: false, kind: "error", code, message: `${command.id} 当前为 ${command.status}，来源 ${command.source}，尚不可执行。` };
}

function isPermissionMode(value: string): value is RuntimeCommandPermissionMode {
  return SESSION_PERMISSION_MODES.has(value as RuntimeCommandPermissionMode);
}

function helpMessage(registry: readonly RuntimeCommandDefinition[]): string {
  return registry.map((command) => `${command.usage} — ${command.description}（${command.status} / ${command.source}）`).join("\n");
}

function statusMessage(status?: RuntimeCommandStatusContext): string {
  const sessionId = status?.sessionId ?? "未绑定会话";
  const model = status?.modelLabel ?? "未配置模型";
  const permission = status?.permissionMode ?? "edit";
  return `会话：${sessionId}\n模型：${model}\n权限：${permission}`;
}

async function runCommand(command: RuntimeCommandDefinition, parsed: RuntimeCommandParsedInput, context: RuntimeCommandExecutionContext): Promise<RuntimeCommandExecutionResult> {
  const unavailable = unavailableCommand(command);
  if (unavailable) return unavailable;

  const handlerContext: RuntimeCommandHandlerContext = { commandId: command.id, commandName: commandName(command), args: parsed.args, raw: parsed.raw };

  switch (command.runtimeHandler) {
    case "command.help":
      return { ok: true, kind: "status", message: helpMessage(context.registry ?? listRuntimeCommands()) };
    case "command.status":
      return { ok: true, kind: "status", message: statusMessage(context.status) };
    case "session.updateModel": {
      if (!parsed.args) return { ok: true, kind: "focus-model", message: "打开模型选择器。" };
      const separator = parsed.args.includes("::") ? "::" : ":";
      const [providerId, ...modelParts] = parsed.args.split(separator);
      const modelId = modelParts.join(separator);
      if (!providerId?.trim() || !modelId?.trim()) return { ok: false, kind: "error", code: "invalid_model", message: "模型参数格式应为 provider:model。" };
      const patch = { providerId: providerId.trim(), modelId: modelId.trim() };
      const handled = await context.handlers?.updateSessionConfig?.(patch, handlerContext);
      return { ok: true, kind: "update-session-config", message: handled?.message ?? `切换模型为 ${patch.providerId}:${patch.modelId}`, patch };
    }
    case "session.updatePermissionMode": {
      if (!parsed.args) return { ok: false, kind: "error", code: "missing_permission_mode", message: "缺少权限模式。" };
      if (!isPermissionMode(parsed.args)) return { ok: false, kind: "error", code: "invalid_permission_mode", message: "无效权限模式，可选 ask/edit/allow/read/plan。" };
      const patch = { permissionMode: parsed.args };
      const handled = await context.handlers?.updateSessionConfig?.(patch, handlerContext);
      return { ok: true, kind: "update-session-config", message: handled?.message ?? `权限已切换为 ${parsed.args}`, patch };
    }
    case "session.fork": {
      const title = parsed.args || undefined;
      const handled = await context.handlers?.forkSession?.(title, handlerContext);
      return { ok: true, kind: "fork-session", message: handled?.message ?? (title ? `创建 fork：${title}` : "创建当前会话 fork。"), ...(handled?.title ?? title ? { title: handled?.title ?? title } : {}) };
    }
    case "session.resume": {
      if (!parsed.args) return { ok: false, kind: "error", code: "missing_session_id", message: "缺少 sessionId。" };
      const handled = await context.handlers?.resumeSession?.(parsed.args, handlerContext);
      const sessionId = handled?.sessionId ?? parsed.args;
      return { ok: true, kind: "resume-session", message: handled?.message ?? `恢复会话 ${sessionId}`, sessionId };
    }
    case "session.compact": {
      if (!context.handlers?.compactSession) return { ok: true, kind: "compact-pending", message: "Compact 流程将在后续任务接入。", ...(parsed.args ? { instructions: parsed.args } : {}) };
      const compacted = await context.handlers.compactSession(parsed.args || undefined, handlerContext);
      return {
        ok: true,
        kind: "compact-session",
        message: `Compact 完成：${compacted.compactedMessageCount} 条历史已压缩，预算 ${compacted.budget.estimatedTokensBefore} → ${compacted.budget.estimatedTokensAfter} tokens。`,
        summary: compacted.summary,
        budget: compacted.budget,
        compactedMessageCount: compacted.compactedMessageCount,
      };
    }
    case "tools.list": {
      const toolsList = context.handlers?.listTools?.() ?? [];
      if (toolsList.length === 0) return { ok: true, kind: "status", message: "当前会话无可用工具。" };
      const formatted = toolsList.map((t) => `• ${t.name} — ${t.description}`).join("\n");
      return { ok: true, kind: "status", message: `当前会话工具（${toolsList.length}）：\n${formatted}` };
    }
    case "mcp.list": {
      const servers = context.handlers?.listMcpServers?.() ?? [];
      if (servers.length === 0) return { ok: true, kind: "status", message: "无已连接的 MCP 服务器。" };
      const formatted = servers.map((s) => `• ${s.name} [${s.status}] — ${s.toolCount} 个工具`).join("\n");
      return { ok: true, kind: "status", message: `MCP 服务器（${servers.length}）：\n${formatted}` };
    }
    case "agents.list": {
      const agents = context.handlers?.listAgents?.() ?? [
        { name: "explore", description: "探索子代理 — 代码搜索与文件浏览" },
        { name: "plan", description: "规划子代理 — 任务分解与方案设计" },
        { name: "general", description: "通用子代理 — 通用对话与辅助" },
      ];
      const formatted = agents.map((a) => `• ${a.name} — ${a.description}`).join("\n");
      return { ok: true, kind: "status", message: `可用子代理（${agents.length}）：\n${formatted}` };
    }
    default: {
      // Novel command handlers: novel.init, novel.writeNext, novel.audit, etc.
      if (command.runtimeHandler.startsWith("novel.") && context.handlers?.executeNovelCommand) {
        return context.handlers.executeNovelCommand(command.runtimeHandler, parsed.args, handlerContext);
      }
      return { ok: false, kind: "error", code: "unhandled_command", message: `命令未处理：${command.id}` };
    }
  }
}

export async function executeRuntimeCommandInput(input: string, context: RuntimeCommandExecutionContext = {}): Promise<RuntimeCommandExecution> {
  const registry = context.registry ?? listRuntimeCommands();
  const parsed = parseRuntimeCommandInput(input);
  if (!parsed) {
    const result: RuntimeCommandExecutionResult = { ok: false, kind: "error", code: "not_command", message: "这不是斜杠命令。" };
    return { ok: false, result, events: [withSession(context.sessionId, { type: "command_error", raw: input, code: result.code, message: result.message })] };
  }

  const command = findCommand(parsed, registry);
  if (!command) {
    const result: RuntimeCommandExecutionResult = { ok: false, kind: "error", code: "unknown_command", message: `未知命令：/${parsed.name}` };
    return {
      ok: false,
      parsed,
      result,
      events: [withSession(context.sessionId, { type: "command_error", raw: parsed.raw, args: parsed.args, command_name: parsed.name, code: result.code, message: result.message })],
    };
  }

  // 对标 Claude Code CLI: isCommandEnabled 运行时禁用检查
  if (context.isCommandEnabled && !context.isCommandEnabled(command.id)) {
    const result: RuntimeCommandExecutionResult = { ok: false, kind: "error", code: "command_disabled", message: `命令 ${command.id} 已被禁用。可在套路页重新启用。` };
    const name = commandName(command);
    return {
      ok: false,
      command,
      parsed,
      result,
      events: [
        withSession(context.sessionId, { type: "command_started" as const, command_id: command.id, command_name: name, raw: parsed.raw, args: parsed.args }),
        withSession(context.sessionId, { type: "command_error" as const, command_id: command.id, command_name: name, raw: parsed.raw, args: parsed.args, code: result.code, message: result.message }),
      ],
    };
  }

  const name = commandName(command);
  const started: RuntimeCommandEvent = withSession(context.sessionId, { type: "command_started" as const, command_id: command.id, command_name: name, raw: parsed.raw, args: parsed.args });
  const result = await runCommand(command, parsed, context);
  const finished: RuntimeCommandEvent = result.ok
    ? withSession(context.sessionId, { type: "command_completed" as const, command_id: command.id, command_name: name, raw: parsed.raw, args: parsed.args, result })
    : withSession(context.sessionId, { type: "command_error" as const, command_id: command.id, command_name: name, raw: parsed.raw, args: parsed.args, code: result.code, message: result.message });

  return { ok: result.ok, command, parsed, result, events: [started, finished] };
}
