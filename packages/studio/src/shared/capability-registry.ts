/**
 * Unified Capability Registry — single source of truth for all runtime capabilities.
 *
 * Consumed by the Routines page, settings facts, and runtime tool/command resolution.
 */

import { listRuntimeCommands, type RuntimeCommandDefinition } from "@vivy1024/novelfork-core/registry/command-registry";

export const CAPABILITY_REGISTRY_ENTRY_KINDS = [
  "command",
  "tool",
  "skill",
  "hook",
  "subagent",
  "mcp-tool",
  "prompt-fragment",
  "workflow-recipe",
  "genre-preset",
  "writing-mode",
] as const;

export type CapabilityRegistryEntryKind = (typeof CAPABILITY_REGISTRY_ENTRY_KINDS)[number];

export type CapabilityRegistryEntryStatus = "current" | "partial" | "planned" | "reference-only" | "unsupported";

export type CapabilityRegistryEntrySource = "builtin" | "core" | "plugin" | "user" | "mcp" | "imported";

export type CapabilityRegistryEntryScope = "global" | "project" | "session";

export interface CapabilityRegistryEntry {
  readonly id: string;
  readonly name: string;
  readonly kind: CapabilityRegistryEntryKind;
  readonly source: CapabilityRegistryEntrySource;
  readonly status: CapabilityRegistryEntryStatus;
  readonly scope: CapabilityRegistryEntryScope;
  readonly enabled: boolean;
  readonly permissions?: readonly string[];
  readonly modelBinding?: string;
  readonly lastRun?: string;
  readonly description?: string;
}

function commandToEntry(command: RuntimeCommandDefinition): CapabilityRegistryEntry {
  return {
    id: `command:${command.id}`,
    name: command.title || command.id,
    kind: "command",
    source: "core",
    status: command.status === "current" ? "current" : command.status === "partial" ? "partial" : "planned",
    scope: "global",
    enabled: command.status === "current" || command.status === "partial",
    description: command.description,
  };
}

const BUILTIN_TOOLS: readonly CapabilityRegistryEntry[] = [
  { id: "tool:cockpit.get_snapshot", name: "cockpit.get_snapshot", kind: "tool", source: "builtin", status: "current", scope: "global", enabled: true, description: "读取驾驶舱快照" },
  { id: "tool:chapter.read", name: "chapter.read", kind: "tool", source: "builtin", status: "current", scope: "global", enabled: true, description: "读取章节内容" },
  { id: "tool:chapter.save_checkpointed", name: "chapter.save_checkpointed", kind: "tool", source: "builtin", status: "current", scope: "global", enabled: true, description: "保存章节（带 checkpoint）" },
  { id: "tool:candidate.create_chapter", name: "candidate.create_chapter", kind: "tool", source: "builtin", status: "current", scope: "global", enabled: true, description: "创建候选稿" },
  { id: "tool:candidate.apply_to_chapter", name: "candidate.apply_to_chapter", kind: "tool", source: "builtin", status: "current", scope: "global", enabled: true, description: "应用候选稿到正式章节" },
  { id: "tool:guided.create_plan", name: "guided.create_plan", kind: "tool", source: "builtin", status: "current", scope: "global", enabled: true, description: "创建引导计划" },
  { id: "tool:guided.approve_plan", name: "guided.approve_plan", kind: "tool", source: "builtin", status: "current", scope: "global", enabled: true, description: "批准引导计划" },
  { id: "tool:audit.continuity", name: "audit.continuity", kind: "tool", source: "builtin", status: "current", scope: "global", enabled: true, description: "连续性审计" },
  { id: "tool:audit.ai_taste", name: "audit.ai_taste", kind: "tool", source: "builtin", status: "current", scope: "global", enabled: true, description: "AI 味检测" },
  { id: "tool:style.extract_profile", name: "style.extract_profile", kind: "tool", source: "builtin", status: "current", scope: "global", enabled: true, description: "提取文风档案" },
];

const PLANNED_HOOKS: readonly CapabilityRegistryEntry[] = [
  { id: "hook:onSessionStart", name: "onSessionStart", kind: "hook", source: "core", status: "planned", scope: "global", enabled: false, description: "会话启动时加载上下文" },
  { id: "hook:onToolResult", name: "onToolResult", kind: "hook", source: "core", status: "planned", scope: "global", enabled: false, description: "工具执行后触发审计" },
  { id: "hook:onTurnComplete", name: "onTurnComplete", kind: "hook", source: "core", status: "planned", scope: "global", enabled: false, description: "轮次完成后持久化" },
];

const PLANNED_MCP_TOOLS: readonly CapabilityRegistryEntry[] = [
  { id: "mcp-tool:github.search", name: "github.search", kind: "mcp-tool", source: "mcp", status: "planned", scope: "global", enabled: false, description: "GitHub 搜索（需配置 MCP server）" },
  { id: "mcp-tool:memory.recall", name: "memory.recall", kind: "mcp-tool", source: "mcp", status: "planned", scope: "global", enabled: false, description: "向量记忆召回（需配置 MCP server）" },
];

const WORKFLOW_RECIPES: readonly CapabilityRegistryEntry[] = [
  { id: "workflow-recipe:write-next", name: "/novel:write-next", kind: "workflow-recipe", source: "core", status: "partial", scope: "global", enabled: true, description: "context → PGI → Guided Plan → approve → Writer candidate → canvas open" },
  { id: "workflow-recipe:audit-continuity", name: "/novel:audit", kind: "workflow-recipe", source: "core", status: "planned", scope: "global", enabled: false, description: "连续性审计工作流" },
];

const GENRE_PRESETS: readonly CapabilityRegistryEntry[] = [
  { id: "genre-preset:xianxia", name: "仙侠", kind: "genre-preset", source: "builtin", status: "current", scope: "global", enabled: true, description: "仙侠题材预设" },
  { id: "genre-preset:xuanhuan", name: "玄幻", kind: "genre-preset", source: "builtin", status: "current", scope: "global", enabled: true, description: "玄幻题材预设" },
  { id: "genre-preset:urban", name: "都市", kind: "genre-preset", source: "builtin", status: "current", scope: "global", enabled: true, description: "都市题材预设" },
  { id: "genre-preset:scifi", name: "科幻", kind: "genre-preset", source: "builtin", status: "current", scope: "global", enabled: true, description: "科幻题材预设" },
];

const WRITING_MODES: readonly CapabilityRegistryEntry[] = [
  { id: "writing-mode:continue", name: "续写", kind: "writing-mode", source: "builtin", status: "current", scope: "global", enabled: true, description: "续写当前章节" },
  { id: "writing-mode:rewrite", name: "重写", kind: "writing-mode", source: "builtin", status: "current", scope: "global", enabled: true, description: "重写选中段落" },
  { id: "writing-mode:expand", name: "扩写", kind: "writing-mode", source: "builtin", status: "current", scope: "global", enabled: true, description: "扩写选中段落" },
  { id: "writing-mode:polish", name: "润色", kind: "writing-mode", source: "builtin", status: "current", scope: "global", enabled: true, description: "润色选中段落" },
];

/**
 * Returns the full capability registry combining commands, tools, hooks, MCP, workflows, presets, and writing modes.
 */
export function getCapabilityRegistry(): readonly CapabilityRegistryEntry[] {
  const commands = listRuntimeCommands().map(commandToEntry);
  return [
    ...commands,
    ...BUILTIN_TOOLS,
    ...PLANNED_HOOKS,
    ...PLANNED_MCP_TOOLS,
    ...WORKFLOW_RECIPES,
    ...GENRE_PRESETS,
    ...WRITING_MODES,
  ];
}
