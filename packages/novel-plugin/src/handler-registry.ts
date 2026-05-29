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
  { toolName: "pgi.ask", serviceKey: "direct", method: "handlePgiAsk" },
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
  { toolName: "pipeline.write", serviceKey: "direct", method: "handlePipelineWrite" },
  { toolName: "jingwei.write", serviceKey: "direct", method: "handleJingweiWrite" },
  { toolName: "jingwei.read", serviceKey: "direct", method: "handleJingweiRead" },

  // Health/audit tools (implemented in session-tool-executor inline)
  { toolName: "health.read_summary", serviceKey: "cockpit", method: "getSnapshot" },
  { toolName: "chapter.audit", serviceKey: "inline", method: "auditChapter" },
  { toolName: "rewrite.segment", serviceKey: "inline", method: "rewriteSegment" },
  { toolName: "outline.suggest_next", serviceKey: "inline", method: "suggestNext" },
  { toolName: "character.check_consistency", serviceKey: "inline", method: "checkConsistency" },
  { toolName: "hooks.manage", serviceKey: "inline", method: "manageHooks" },

  // Presets/Beat tools (implemented in session-tool-executor inline)
  { toolName: "presets.get_rules", serviceKey: "inline", method: "getPresetRules" },
  { toolName: "presets.check_compliance", serviceKey: "inline", method: "checkCompliance" },
  { toolName: "presets.set_rules", serviceKey: "inline", method: "setPresetRules" },
  { toolName: "presets.create_custom", serviceKey: "inline", method: "createCustomPreset" },
  { toolName: "beat.get_current", serviceKey: "inline", method: "getBeatCurrent" },
  { toolName: "beat.set_template", serviceKey: "inline", method: "setBeatTemplate" },
  { toolName: "beat.create_custom", serviceKey: "inline", method: "createCustomBeat" },

  // Pipeline tools
  { toolName: "pipeline.generate_chapter", serviceKey: "inline", method: "generateChapter" },

  // v2 merged tools
  { toolName: "cockpit.snapshot", serviceKey: "cockpit", method: "getSnapshot" },
  { toolName: "jingwei.upsert_entry", serviceKey: "inline", method: "upsertEntry" },

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
