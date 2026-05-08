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

const NOVEL_WRITE: RuntimeCommandPermissionImpact = {
  mode: "novel-write",
  requiresConfirmation: true,
  description: "可能创建候选稿、计划或小说资源草案，必须保留候选区/确认门边界。",
};

const NOVEL_READ: RuntimeCommandPermissionImpact = {
  mode: "novel-read",
  requiresConfirmation: false,
  description: "读取小说上下文并生成分析或报告，不直接覆盖正式资源。",
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
  {
    id: "/novel:init",
    aliases: [],
    title: "初始化小说项目",
    usage: "/novel:init",
    description: "创建或初始化小说项目、经纬、基础文件和默认叙述者会话。",
    scope: "novel",
    inputSchema: TEXT_ARGS,
    permissionImpact: NOVEL_WRITE,
    runtimeHandler: "novel.init",
    status: "planned",
    source: "novel-agent-pack",
  },
  {
    id: "/novel:outline",
    aliases: [],
    title: "生成候选大纲",
    usage: "/novel:outline",
    description: "读取经纬、叙事线和当前大纲，生成候选大纲或分支。",
    scope: "novel",
    inputSchema: TEXT_ARGS,
    permissionImpact: NOVEL_WRITE,
    runtimeHandler: "novel.outline",
    status: "planned",
    source: "novel-agent-pack",
  },
  {
    id: "/novel:write-next",
    aliases: ["/novel:next"],
    title: "生成下一章候选稿",
    usage: "/novel:write-next",
    description: "执行 cockpit/context → PGI → Guided Plan → approve → candidate.create_chapter 工具链。",
    scope: "novel",
    inputSchema: TEXT_ARGS,
    permissionImpact: NOVEL_WRITE,
    runtimeHandler: "novel.writeNext",
    status: "planned",
    source: "novel-agent-pack",
  },
  {
    id: "/novel:audit",
    aliases: [],
    title: "小说审计",
    usage: "/novel:audit",
    description: "调用连续性、设定和结构审计工具或显示缺口。",
    scope: "novel",
    inputSchema: TEXT_ARGS,
    permissionImpact: NOVEL_READ,
    runtimeHandler: "novel.audit",
    status: "planned",
    source: "novel-agent-pack",
  },
  {
    id: "/novel:revise",
    aliases: [],
    title: "修订候选稿",
    usage: "/novel:revise",
    description: "基于审计结果生成修订候选稿，不覆盖正式章节。",
    scope: "novel",
    inputSchema: TEXT_ARGS,
    permissionImpact: NOVEL_WRITE,
    runtimeHandler: "novel.revise",
    status: "planned",
    source: "novel-agent-pack",
  },
  {
    id: "/novel:de-ai",
    aliases: [],
    title: "去 AI 味",
    usage: "/novel:de-ai",
    description: "分析并优化 AI 痕迹，输出候选修订。",
    scope: "novel",
    inputSchema: TEXT_ARGS,
    permissionImpact: NOVEL_WRITE,
    runtimeHandler: "novel.deAi",
    status: "planned",
    source: "novel-agent-pack",
  },
  {
    id: "/novel:style-transfer",
    aliases: [],
    title: "文风迁移",
    usage: "/novel:style-transfer",
    description: "基于风格 profile 生成候选风格迁移结果。",
    scope: "novel",
    inputSchema: TEXT_ARGS,
    permissionImpact: NOVEL_WRITE,
    runtimeHandler: "novel.styleTransfer",
    status: "planned",
    source: "novel-agent-pack",
  },
  {
    id: "/novel:publish-check",
    aliases: [],
    title: "发布检查",
    usage: "/novel:publish-check",
    description: "运行发布前格式、合规和质量检查。",
    scope: "novel",
    inputSchema: TEXT_ARGS,
    permissionImpact: NOVEL_READ,
    runtimeHandler: "novel.publishCheck",
    status: "planned",
    source: "novel-agent-pack",
  },
  {
    id: "/novel:health",
    aliases: [],
    title: "作品健康度",
    usage: "/novel:health",
    description: "汇总作品健康度、风险与下一步建议。",
    scope: "novel",
    inputSchema: TEXT_ARGS,
    permissionImpact: NOVEL_READ,
    runtimeHandler: "novel.health",
    status: "planned",
    source: "novel-agent-pack",
  },
  {
    id: "/novel:storyline",
    aliases: [],
    title: "叙事线",
    usage: "/novel:storyline",
    description: "读取或规划叙事线节点、边和变更草案。",
    scope: "novel",
    inputSchema: TEXT_ARGS,
    permissionImpact: NOVEL_WRITE,
    runtimeHandler: "novel.storyline",
    status: "planned",
    source: "novel-agent-pack",
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
