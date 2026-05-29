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
  { toolName: "cockpit.get_snapshot", serviceKey: "cockpit", method: "getSnapshot" },
  { toolName: "cockpit.list_open_hooks", serviceKey: "cockpit", method: "listOpenHooks" },
  { toolName: "cockpit.list_recent_candidates", serviceKey: "cockpit", method: "listRecentCandidates" },

  // Questionnaire tools
  { toolName: "questionnaire.list_templates", serviceKey: "questionnaire", method: "listTemplates" },
  { toolName: "questionnaire.start", serviceKey: "questionnaire", method: "start" },
  { toolName: "questionnaire.suggest_answer", serviceKey: "questionnaire", method: "suggestAnswer" },
  { toolName: "questionnaire.submit_response", serviceKey: "questionnaire", method: "submitResponse" },

  // PGI tools
  { toolName: "pgi.generate_questions", serviceKey: "pgi", method: "generateQuestions" },
  { toolName: "pgi.record_answers", serviceKey: "pgi", method: "recordAnswers" },
  { toolName: "pgi.format_answers_for_prompt", serviceKey: "pgi", method: "formatAnswersForPrompt" },

  // Guided generation tools
  { toolName: "guided.enter", serviceKey: "guided", method: "enter" },
  { toolName: "guided.answer_question", serviceKey: "guided", method: "answerQuestion" },
  { toolName: "guided.exit", serviceKey: "guided", method: "exit" },

  // Candidate tools
  { toolName: "candidate.create_chapter", serviceKey: "candidate", method: "createChapter" },

  // Narrative tools
  { toolName: "narrative.read_line", serviceKey: "narrative", method: "readLine" },
  { toolName: "narrative.propose_change", serviceKey: "narrative", method: "proposeChange" },

  // Direct handlers (already implemented in novel-plugin)
  { toolName: "chapter.read", serviceKey: "direct", method: "handleChapterRead" },
  { toolName: "jingwei.read_brief", serviceKey: "direct", method: "handleJingweiReadBrief" },
  { toolName: "jingwei.read_category", serviceKey: "direct", method: "handleJingweiReadCategory" },
  { toolName: "jingwei.search", serviceKey: "direct", method: "handleJingweiSearch" },
  { toolName: "jingwei.read_context", serviceKey: "direct", method: "handleJingweiReadContext" },

  // Health/audit tools
  { toolName: "health.read_summary", serviceKey: "health" },
  { toolName: "chapter.audit", serviceKey: "audit" },
  { toolName: "rewrite.segment", serviceKey: "rewrite" },
  { toolName: "outline.suggest_next", serviceKey: "outline" },
  { toolName: "character.check_consistency", serviceKey: "character" },
  { toolName: "hooks.manage", serviceKey: "hooks" },

  // Scene spec (direct handler)
  { toolName: "scene.spec", serviceKey: "direct", method: "handleSceneSpec" },
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
