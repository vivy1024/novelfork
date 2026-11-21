/**
 * Novel plugin handler registry (25 streamlined tools).
 */

export interface NovelHandlerDeclaration {
  toolName: string;
  /** Which service handles this tool */
  serviceKey: string;
  /** Specific method on the service (optional) */
  method?: string;
}

export const NOVEL_HANDLER_DECLARATIONS: readonly NovelHandlerDeclaration[] = [
  // 核心写章与章节（8）
  { toolName: "book.overview", serviceKey: "cockpit", method: "getSnapshot" },
  { toolName: "chapter.preflight", serviceKey: "direct", method: "handleWritePreflight" },
  { toolName: "chapter.blueprint", serviceKey: "direct", method: "handleSceneSpec" },
  { toolName: "chapter.commit", serviceKey: "direct", method: "handleChapterCommit" },
  { toolName: "chapter.list", serviceKey: "inline", method: "listChapters" },
  { toolName: "chapter.audit", serviceKey: "inline", method: "auditChapter" },
  { toolName: "chapter.propose_selection", serviceKey: "direct", method: "proposeSelectionCandidate" },
  { toolName: "chapter.discard_range", serviceKey: "direct", method: "handleChapterDiscardRange" },

  // 经纬与大纲（4）
  { toolName: "jingwei.read", serviceKey: "direct", method: "handleJingweiRead" },
  { toolName: "jingwei.write", serviceKey: "direct", method: "handleJingweiWrite" },
  { toolName: "hooks.manage", serviceKey: "inline", method: "manageHooks" },
  { toolName: "outline.volume", serviceKey: "direct", method: "handleOutlineVolume" },

  // 叙事记忆（5）
  { toolName: "memory.read", serviceKey: "direct", method: "handleMemoryRead" },
  { toolName: "memory.search", serviceKey: "direct", method: "handleMemorySearch" },
  { toolName: "memory.graph", serviceKey: "direct", method: "handleMemoryGraph" },
  { toolName: "memory.events", serviceKey: "direct", method: "handleMemoryEvents" },
  { toolName: "memory.settle", serviceKey: "direct", method: "handleMemorySettle" },

  // 专项与工作流（8）
  { toolName: "character.inspect", serviceKey: "inline", method: "inspectCharacter" },
  { toolName: "style.manage", serviceKey: "direct", method: "executeStyleManageTool" },
  { toolName: "mechanism.distill", serviceKey: "direct", method: "executeMechanismDistillTool" },
  { toolName: "book.import", serviceKey: "inline", method: "importOrDissectBook" },
  { toolName: "market.radar", serviceKey: "direct", method: "executeMarketRadar" },
  { toolName: "skills.manage", serviceKey: "direct", method: "executeSkillsManage" },
  { toolName: "workflow.step", serviceKey: "direct", method: "executeWorkflowRunTool" },
  { toolName: "workflow.manage", serviceKey: "direct", method: "executeWorkflowRecipeTool" },
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
