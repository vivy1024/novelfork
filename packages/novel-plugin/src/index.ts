import type { PluginManifest, PluginAgentPreset, PluginToolDefinition } from "@vivy1024/novelfork-core";
import { NOVEL_TOOL_SCHEMAS } from "./tool-schemas.js";

// Re-export schemas for consumers (e.g. studio session-tool-registry)
export { NOVEL_TOOL_SCHEMAS } from "./tool-schemas.js";
export type { ToolInputSchema } from "./tool-schemas.js";

// Re-export handlers for use by studio and other consumers
export { handleChapterRead, handleJingweiReadContext } from "./handlers/index.js";
export type { ChapterReadInput, ChapterReadResult, JingweiReadContextInput, JingweiReadContextResult } from "./handlers/index.js";

/**
 * 小说工具名列表 — 声明本插件提供的 24 个小说领域工具。
 * 完整定义（含 inputSchema）位于 tool-schemas.ts，本插件是唯一 source of truth。
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
  "chapter.audit",
  "rewrite.segment",
  "outline.suggest_next",
  "character.check_consistency",
  "hooks.manage",
];

/** Tool descriptions for manifest (brief summaries) */
const NOVEL_TOOL_DESCRIPTIONS: Record<string, string> = {
  "cockpit.get_snapshot": "获取驾驶舱快照（进度、伏笔、候选稿）",
  "cockpit.list_open_hooks": "列出未回收伏笔",
  "cockpit.list_recent_candidates": "列出最近候选稿",
  "questionnaire.list_templates": "列出问卷模板",
  "questionnaire.start": "启动问卷",
  "questionnaire.suggest_answer": "AI 建议问卷答案",
  "questionnaire.submit_response": "提交问卷回答",
  "pgi.generate_questions": "PGI 生成追问",
  "pgi.record_answers": "PGI 记录回答",
  "pgi.format_answers_for_prompt": "PGI 格式化答案为 prompt",
  "guided.enter": "进入引导式生成",
  "guided.answer_question": "回答引导式问题",
  "guided.exit": "退出引导式生成",
  "candidate.create_chapter": "创建章节候选稿",
  "narrative.read_line": "读取叙事线",
  "narrative.propose_change": "提议叙事线变更",
  "chapter.read": "读取章节内容",
  "jingwei.read_context": "读取经纬上下文",
  "health.read_summary": "读取健康度摘要",
  "chapter.audit": "审计章节",
  "rewrite.segment": "重写选段",
  "outline.suggest_next": "建议下一步大纲",
  "character.check_consistency": "检查角色一致性",
  "hooks.manage": "管理伏笔",
};

/** Get tool description by name */
function getToolDescription(name: string): string {
  return NOVEL_TOOL_DESCRIPTIONS[name] ?? name;
}

/** Full tool definitions with complete inputSchema — novel-plugin is the single source of truth */
export const NOVEL_TOOL_DEFINITIONS: readonly PluginToolDefinition[] = NOVEL_TOOL_NAMES.map(name => ({
  name,
  description: getToolDescription(name),
  inputSchema: NOVEL_TOOL_SCHEMAS[name] ?? { type: "object" as const },
  scope: "novel" as const,
}));

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
  id: "novelfork-novel",
  name: "novelfork-novel",
  displayName: "NovelFork 小说写作插件",
  version: "0.5.2",
  description: "小说写作核心插件，提供章节管理、经纬、驾驶舱、PGI、引导式生成等工具",
  projectType: "novel",
  tools: NOVEL_TOOL_DEFINITIONS,
  agentPresets: NOVEL_AGENT_PRESET_LIST,
  routes: [],
  systemPromptExtensions: [],
};

export default NOVEL_PLUGIN_MANIFEST;
