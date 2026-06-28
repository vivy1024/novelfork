/**
 * Novel plugin handler registry.
 *
 * This file declares which handlers the novel plugin provides.
 * The actual handler implementations remain in studio's service layer
 * (渐进迁移 — handlers will be moved here incrementally in future).
 *
 * For now, this serves as the plugin's declaration of what it handles,
 * enabling the studio to route tool calls through the plugin system.
 */

export interface NovelHandlerDeclaration {
  toolName: string;
  /** Which service handles this tool */
  serviceKey: string;
  /** Specific method on the service (optional) */
  method?: string;
}

export const NOVEL_HANDLER_DECLARATIONS: readonly NovelHandlerDeclaration[] = [
  // Cockpit tools
  { toolName: "cockpit.snapshot", serviceKey: "cockpit", method: "getSnapshot" },

  // PGI tools
  { toolName: "pgi.ask", serviceKey: "direct", method: "handlePgiAsk" },

  // Narrative tools
  { toolName: "narrative.read_line", serviceKey: "narrative", method: "readLine" },
  { toolName: "narrative.propose_change", serviceKey: "narrative", method: "proposeChange" },

  // Direct handlers (already implemented in novel-plugin)
  { toolName: "chapter.read", serviceKey: "direct", method: "handleChapterRead" },
  { toolName: "chapter.list", serviceKey: "inline", method: "listChapters" },
  { toolName: "pipeline.write", serviceKey: "direct", method: "handlePipelineWrite" },
  { toolName: "lore.write", serviceKey: "direct", method: "handleLoreWrite" },
  { toolName: "lore.read", serviceKey: "direct", method: "handleLoreRead" },
  { toolName: "jingwei.write", serviceKey: "direct", method: "handleJingweiWrite" },
  { toolName: "jingwei.read", serviceKey: "direct", method: "handleJingweiRead" },
  { toolName: "jingwei.audit", serviceKey: "direct", method: "handleJingweiAudit" },
  { toolName: "memory.read", serviceKey: "direct", method: "handleMemoryRead" },
  { toolName: "memory.graph", serviceKey: "direct", method: "handleMemoryGraph" },
  { toolName: "memory.events", serviceKey: "direct", method: "handleMemoryEvents" },
  { toolName: "memory.list", serviceKey: "direct", method: "handleMemoryList" },
  { toolName: "memory.read_entry", serviceKey: "direct", method: "handleMemoryReadEntry" },
  { toolName: "memory.search", serviceKey: "direct", method: "handleMemorySearch" },
  { toolName: "memory.update", serviceKey: "direct", method: "handleMemoryUpdate" },
  { toolName: "memory.delete", serviceKey: "direct", method: "handleMemoryDelete" },
  { toolName: "memory.dedup", serviceKey: "direct", method: "handleMemoryDedup" },
  { toolName: "memory.export", serviceKey: "direct", method: "handleMemoryExport" },
  { toolName: "memory.stats", serviceKey: "direct", method: "handleMemoryStats" },
  { toolName: "memory.bulk_approve", serviceKey: "direct", method: "handleMemoryBulkApprove" },
  { toolName: "memory.bulk_delete", serviceKey: "direct", method: "handleMemoryBulkDelete" },

  // Audit/quality tools
  { toolName: "chapter.audit", serviceKey: "inline", method: "auditChapter" },
  { toolName: "rewrite.segment", serviceKey: "inline", method: "rewriteSegment" },
  { toolName: "outline.suggest_next", serviceKey: "inline", method: "suggestNext" },
  { toolName: "character.check_consistency", serviceKey: "inline", method: "checkConsistency" },
  { toolName: "hooks.manage", serviceKey: "inline", method: "manageHooks" },

  // Presets/Beat tools (v2 consolidated)
  { toolName: "presets.read", serviceKey: "inline", method: "readPresets" },
  { toolName: "presets.write", serviceKey: "inline", method: "writePresets" },
  { toolName: "presets.check_compliance", serviceKey: "inline", method: "checkCompliance" },
  { toolName: "beat.read", serviceKey: "inline", method: "readBeat" },
  { toolName: "beat.write", serviceKey: "inline", method: "writeBeat" },

  // Scene spec (direct handler)
  { toolName: "scene.spec", serviceKey: "direct", method: "handleSceneSpec" },

  // Resource management
  { toolName: "resource.manage", serviceKey: "inline", method: "manageResource" },
];

/**
 * Check if a tool name belongs to the novel plugin.
 */
export function isNovelPluginTool(toolName: string): boolean {
  return NOVEL_HANDLER_DECLARATIONS.some((d) => d.toolName === toolName);
}

/**
 * Get the handler declaration for a specific tool.
 */
export function getHandlerDeclaration(toolName: string): NovelHandlerDeclaration | undefined {
  return NOVEL_HANDLER_DECLARATIONS.find((d) => d.toolName === toolName);
}
