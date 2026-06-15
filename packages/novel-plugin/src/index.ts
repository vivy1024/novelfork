import type { PluginManifest, PluginAgentPreset, PluginToolDefinition } from "@vivy1024/novelfork-core";
import { NOVEL_TOOL_SCHEMAS } from "./tool-schemas.js";

// Re-export schemas for consumers (e.g. studio session-tool-registry)
export { NOVEL_TOOL_SCHEMAS } from "./tool-schemas.js";
export type { ToolInputSchema } from "./tool-schemas.js";

// Re-export handlers for use by studio and other consumers
export {
  handleChapterRead,
  handleJingweiReadBrief,
  handleJingweiReadCategory,
  handleJingweiSearch,
  handleJingweiReadContext,
  handleJingweiRead,
  handleJingweiWrite,
  handlePgiAsk,
  handleSceneSpec,
} from "./handlers/index.js";
export type {
  ChapterReadInput,
  ChapterReadResult,
  JingweiReadBriefInput,
  JingweiReadBriefResponse,
  JingweiReadCategoryInput,
  JingweiReadCategoryResponse,
  JingweiSearchInput,
  JingweiSearchResponse,
  JingweiReadContextInput,
  JingweiReadContextResult,
  JingweiReadInput,
  JingweiReadResult,
  JingweiWriteInput,
  JingweiWriteResult,
  JingweiWriteSuccess,
  JingweiWriteFailure,
  PgiAskInput,
  PgiAskResult,
  PgiAskSuccess,
  PgiAskFailure,
  PgiAskQuestionItem,
  AskUserQuestionInputItem,
  SceneSpecInput,
  SceneSpecResult,
  SceneSpec,
} from "./handlers/index.js";

// Re-export handler registry (plugin declares which tools it owns)
export { NOVEL_HANDLER_DECLARATIONS, isNovelPluginTool, getHandlerDeclaration } from "./handler-registry.js";
export type { NovelHandlerDeclaration } from "./handler-registry.js";

/**
 * 小说工具名列表 — 从 NOVEL_TOOL_SCHEMAS 动态生成，确保与 schema 定义同步。
 */
export const NOVEL_TOOL_NAMES: readonly string[] = Object.keys(NOVEL_TOOL_SCHEMAS);

/** Tool descriptions for manifest (brief summaries) */
const NOVEL_TOOL_DESCRIPTIONS: Record<string, string> = {
  "cockpit.snapshot": "获取驾驶舱快照（进度、伏笔、候选稿）",
  "pgi.ask": "PGI 追问引擎（生成追问 + 格式化回答）",
  "candidate.create_chapter": "创建章节候选稿",
  "narrative.read_line": "读取叙事线",
  "narrative.propose_change": "提议叙事线变更",
  "jingwei.read": "统一经纬读取（brief/category/search）",
  "jingwei.write": "经纬写入（支持 layer 分层与 canon 保护）",
  "chapter.read": "读取章节内容",
  "chapter.list": "列出章节",
  "chapter.audit": "审计章节",
  "pipeline.write": "写作管线（完整生成链路）",
  "pipeline.revise": "修订管线",
  "pipeline.import_chapters": "导入章节",
  "scene.spec": "场景蓝图生成",
  "rewrite.segment": "重写选段",
  "style.import": "导入文风样本",
  "outline.suggest_next": "建议下一步大纲",
  "character.check_consistency": "检查角色一致性",
  "hooks.manage": "管理伏笔",
  "presets.read": "读取预设规则",
  "presets.write": "写入预设规则",
  "presets.check_compliance": "检查预设合规",
  "beat.read": "读取节拍模板",
  "beat.write": "写入节拍模板",
  "resource.manage": "资源管理",
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
 * 小说 Agent 角色预设（v1.8: 合并为单一 novelist）
 */
export const NOVEL_AGENT_PRESET_LIST: PluginAgentPreset[] = [
  { agentId: "novelist", name: "📝 小说创作", tools: ["Bash", "Read", "Write", "Edit", "Grep", "Glob", "EnterWorktree", "ExitWorktree", "TaskCreate"] },
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
  uiSections: [
    {
      id: "novel-writing-config",
      label: "写作配置",
      icon: "PenLine",
      mountPoint: "routines",
      requiresBook: true,
      order: 100,
      componentKey: "novel-writing-config",
    },
  ],
  systemPromptExtensions: [],
};

export default NOVEL_PLUGIN_MANIFEST;
