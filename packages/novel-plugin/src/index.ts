import type { PluginManifest, PluginAgentPreset } from "@vivy1024/novelfork-core";

// Re-export handlers for use by studio and other consumers
export { handleChapterRead, handleJingweiReadContext } from "./handlers/index.js";
export type { ChapterReadInput, ChapterReadResult, JingweiReadContextInput, JingweiReadContextResult } from "./handlers/index.js";

/**
 * 小说工具名列表 — 声明本插件提供的 19 个小说领域工具。
 * 完整定义（含 inputSchema）位于 studio 的 session-tool-registry-novel.ts，
 * 此处仅声明名称用于 manifest 注册和 UI 展示。
 */
export const NOVEL_TOOL_NAMES: readonly string[] = [
  "cockpit.get_snapshot",
  "cockpit.list_open_hooks",
  "cockpit.list_recent_candidates",
  "questionnaire.list_templates",
  "questionnaire.start",
  "questionnaire.suggest_answer",
  "questionnaire.submit_response",
  "pgi.generate_questions",
  "pgi.record_answers",
  "pgi.format_answers_for_prompt",
  "guided.enter",
  "guided.answer_question",
  "guided.exit",
  "candidate.create_chapter",
  "narrative.read_line",
  "narrative.propose_change",
  "chapter.read",
  "jingwei.read_context",
  "health.read_summary",
];

/**
 * 小说 Agent 角色预设
 */
export const NOVEL_AGENT_PRESET_LIST: PluginAgentPreset[] = [
  { agentId: "writer", name: "📝 写书", tools: ["Bash", "Read", "Write", "Edit", "Grep", "Glob", "EnterWorktree", "ExitWorktree", "TaskCreate"] },
  { agentId: "hooks", name: "🎣 伏笔", tools: ["Read", "Write", "Grep", "Glob"] },
  { agentId: "chapter-hooks", name: "🪝 章末钩子", tools: ["Read", "Grep", "Glob"] },
  { agentId: "outline", name: "📋 大纲与经纬", tools: ["Read", "Write", "Edit", "Grep", "Glob"] },
];

export const NOVEL_PLUGIN_MANIFEST: PluginManifest = {
  name: "novelfork-novel",
  displayName: "NovelFork 小说写作插件",
  version: "0.2.0",
  description: "小说写作核心插件，提供章节管理、经纬、驾驶舱、PGI、引导式生成等工具",
  projectType: "novel",
  tools: NOVEL_TOOL_NAMES,
  agentPresets: NOVEL_AGENT_PRESET_LIST,
  routes: [],
  systemPromptExtensions: [],
};

export default NOVEL_PLUGIN_MANIFEST;
