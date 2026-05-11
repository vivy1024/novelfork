export type RuntimeCommandScope = "session" | "runtime" | "tooling" | "extension" | "novel";
export type RuntimeCommandStatus = "current" | "partial" | "planned" | "unsupported" | "reference-only";
export type RuntimeCommandSource = "builtin" | "claude-adapter" | "codex-adapter" | "novel-agent-pack";

export interface RuntimeCommandInputSchema {
  readonly type: "object";
  readonly description: string;
  readonly properties?: Readonly<Record<string, { readonly type: string; readonly description: string }>>;
}

export interface RuntimeCommandPermissionImpact {
  readonly mode: "none" | "session-config" | "tool-read" | "tool-write" | "mcp" | "novel-write" | "novel-read";
  readonly requiresConfirmation: boolean;
  readonly description: string;
}

export interface RuntimeCommandDefinition {
  readonly id: string;
  readonly aliases: readonly string[];
  readonly title: string;
  readonly usage: string;
  readonly description: string;
  readonly scope: RuntimeCommandScope;
  readonly inputSchema: RuntimeCommandInputSchema;
  readonly permissionImpact: RuntimeCommandPermissionImpact;
  readonly runtimeHandler: string;
  readonly status: RuntimeCommandStatus;
  readonly source: RuntimeCommandSource;
  /** 该命令依赖的 session tools */
  readonly toolDependencies?: readonly string[];
  /** 当前缺口说明（status 非 current 时） */
  readonly gaps?: string;
}

const NO_ARGS: RuntimeCommandInputSchema = {
  type: "object",
  description: "No arguments.",
};

const TEXT_ARGS: RuntimeCommandInputSchema = {
  type: "object",
  description: "Optional free-form argument text.",
  properties: { args: { type: "string", description: "Command argument text." } },
};

const NONE: RuntimeCommandPermissionImpact = {
  mode: "none",
  requiresConfirmation: false,
  description: "只读取当前会话状态或显示帮助，不改变资源。",
};

const SESSION_CONFIG: RuntimeCommandPermissionImpact = {
  mode: "session-config",
  requiresConfirmation: false,
  description: "更新当前会话配置，如模型或权限模式。",
};

const TOOL_READ: RuntimeCommandPermissionImpact = {
  mode: "tool-read",
  requiresConfirmation: false,
  description: "读取工具、MCP 或子代理 registry，不直接执行工具。",
};


export const RUNTIME_COMMAND_REGISTRY: readonly RuntimeCommandDefinition[] = [
  {
    id: "/help",
    aliases: ["/?"],
    title: "命令帮助",
    usage: "/help",
    description: "显示当前可用命令帮助。",
    scope: "session",
    inputSchema: NO_ARGS,
    permissionImpact: NONE,
    runtimeHandler: "command.help",
    status: "current",
    source: "builtin",
  },
  {
    id: "/status",
    aliases: [],
    title: "会话状态",
    usage: "/status",
    description: "显示当前会话、模型与权限状态。",
    scope: "session",
    inputSchema: NO_ARGS,
    permissionImpact: NONE,
    runtimeHandler: "command.status",
    status: "current",
    source: "builtin",
  },
  {
    id: "/model",
    aliases: [],
    title: "模型切换",
    usage: "/model [provider:model]",
    description: "切换模型，或打开模型选择器。",
    scope: "runtime",
    inputSchema: TEXT_ARGS,
    permissionImpact: SESSION_CONFIG,
    runtimeHandler: "session.updateModel",
    status: "partial",
    source: "claude-adapter",
  },
  {
    id: "/permission",
    aliases: ["/permissions"],
    title: "权限模式",
    usage: "/permission [ask|edit|allow|read|plan]",
    description: "切换会话权限模式。",
    scope: "runtime",
    inputSchema: TEXT_ARGS,
    permissionImpact: SESSION_CONFIG,
    runtimeHandler: "session.updatePermissionMode",
    status: "partial",
    source: "claude-adapter",
  },
  {
    id: "/tools",
    aliases: ["/tool"],
    title: "工具列表",
    usage: "/tools",
    description: "查看当前会话可见工具与工具策略。",
    scope: "tooling",
    inputSchema: NO_ARGS,
    permissionImpact: TOOL_READ,
    runtimeHandler: "tools.list",
    status: "planned",
    source: "claude-adapter",
  },
  {
    id: "/mcp",
    aliases: [],
    title: "MCP Registry",
    usage: "/mcp",
    description: "查看 MCP servers、tools 与连接状态。",
    scope: "extension",
    inputSchema: NO_ARGS,
    permissionImpact: TOOL_READ,
    runtimeHandler: "mcp.list",
    status: "planned",
    source: "claude-adapter",
  },
  {
    id: "/agents",
    aliases: ["/subagents"],
    title: "子代理",
    usage: "/agents",
    description: "查看可用子代理、模型绑定与工具权限。",
    scope: "runtime",
    inputSchema: NO_ARGS,
    permissionImpact: TOOL_READ,
    runtimeHandler: "agents.list",
    status: "planned",
    source: "claude-adapter",
  },
  {
    id: "/compact",
    aliases: [],
    title: "压缩上下文",
    usage: "/compact [instructions]",
    description: "压缩上下文并记录 summary/budget。",
    scope: "session",
    inputSchema: TEXT_ARGS,
    permissionImpact: NONE,
    runtimeHandler: "session.compact",
    status: "partial",
    source: "claude-adapter",
  },
  {
    id: "/resume",
    aliases: ["/continue"],
    title: "恢复会话",
    usage: "/resume [sessionId]",
    description: "恢复指定会话。",
    scope: "session",
    inputSchema: TEXT_ARGS,
    permissionImpact: NONE,
    runtimeHandler: "session.resume",
    status: "partial",
    source: "claude-adapter",
  },
  {
    id: "/fork",
    aliases: [],
    title: "Fork 会话",
    usage: "/fork [title]",
    description: "从当前会话创建 fork。",
    scope: "session",
    inputSchema: TEXT_ARGS,
    permissionImpact: NONE,
    runtimeHandler: "session.fork",
    status: "partial",
    source: "claude-adapter",
  },
] as const;

function normalizeCommandLookup(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return "";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

export function listRuntimeCommands(): readonly RuntimeCommandDefinition[] {
  return RUNTIME_COMMAND_REGISTRY;
}

export function getRuntimeCommandDefinition(idOrAlias: string): RuntimeCommandDefinition | undefined {
  const normalized = normalizeCommandLookup(idOrAlias);
  return RUNTIME_COMMAND_REGISTRY.find((command) => command.id === normalized || command.aliases.includes(normalized));
}

export function formatRuntimeCommandHelp(commands: readonly RuntimeCommandDefinition[] = RUNTIME_COMMAND_REGISTRY): string {
  return commands
    .map((command) => `${command.usage} [${command.status}] — ${command.description}`)
    .join("\n");
}
