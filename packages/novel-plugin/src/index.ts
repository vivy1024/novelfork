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
  handleJingweiAudit,
  handleLoreRead,
  handleLoreWrite,
  handleMemoryRead,
  handleMemoryGraph,
  handleMemoryEvents,
  handleMemoryList,
  handleMemoryReadEntry,
  handleMemorySearch,
  handleMemoryStats,
  handleMemoryExport,
  handleMemoryDedup,
  handleMemoryUpdate,
  handleMemoryDelete,
  handleMemoryBulkApprove,
  handleMemoryBulkDelete,
  handlePgiAsk,
  handleWritingSkillsRead,
  handleWritingSkillsWrite,
  handleWritingSkillsRecommend,
  handleWritingSkillsCheckCompliance,
  handleWritingSkillsImportLegacy,
  handleSceneSpec,
} from "./handlers/index.js";
export type {
  ChapterReadInput,
  ChapterReadResult,
  TrustedChapterReadOptions,
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
  JingweiAuditFinding,
  JingweiAuditInput,
  JingweiAuditResult,
  JingweiAuditSeverity,
  JingweiWriteSuccess,
  JingweiWriteFailure,
  LoreReadInput,
  LoreWriteInput,
  MemoryReadInput,
  MemoryGraphInput,
  MemoryEventsInput,
  MemoryBulkApproveInput,
  MemoryBulkDeleteInput,
  MemoryDedupInput,
  MemoryDeleteInput,
  MemoryEntryKind,
  MemoryExportInput,
  MemoryListInput,
  MemoryReadEntryInput,
  MemorySearchInput,
  MemoryStatsInput,
  MemoryUpdateInput,
  PgiAskInput,
  PgiAskResult,
  PgiAskSuccess,
  PgiAskFailure,
  PgiAskQuestionItem,
  AskUserQuestionInputItem,
  LegacyWritingSkillsImportReport,
  TrustedWritingSkillOptions,
  WritingSkillComplianceViolation,
  WritingSkillProjectReport,
  WritingSkillsReadInput,
  WritingSkillsWriteInput,
  WritingSkillsRecommendInput,
  WritingSkillsCheckComplianceInput,
  WritingSkillsImportLegacyInput,
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
  "cockpit.snapshot": "获取驾驶舱快照（进度、伏笔、章节概览）",
  "pgi.ask": "PGI 追问引擎（生成追问 + 格式化回答）",
  "narrative.read_line": "读取叙事线",
  "narrative.propose_change": "提议叙事线变更",
  "narrative.approve_change": "审批叙事线变更（批准或驳回）",
  "lore.read": "Lore 静态设定读取（brief/category/search）",
  "lore.write": "Lore 静态设定写入（含 canon/rules 门禁）",
  "jingwei.read": "deprecated alias of lore.read（静态设定读取）",
  "jingwei.write": "deprecated alias of lore.write（静态设定写入）",
  "jingwei.audit": "经纬 / Lore 读取门禁审计",
  "memory.read": "动态叙事记忆召回",
  "memory.graph": "动态记忆图谱读取",
  "memory.events": "Pending NarrativeEvents 管理",
  "memory.list": "列出 Narrative Memory 条目",
  "memory.read_entry": "读取单条 Narrative Memory 条目",
  "memory.search": "搜索 Narrative Memory 条目",
  "memory.update": "更新 Narrative Memory fact/event",
  "memory.delete": "删除 Narrative Memory fact/event",
  "memory.dedup": "查找 Narrative Memory 重复候选",
  "memory.export": "导出 Narrative Memory 数据",
  "memory.stats": "统计 Narrative Memory 数据",
  "memory.bulk_approve": "批量批准 Pending NarrativeEvents",
  "memory.bulk_delete": "批量删除 Narrative Memory fact/event",
  "chapter.read": "读取章节内容",
  "chapter.list": "列出章节",
  "chapter.audit": "审计章节",
  "pipeline.write": "写作管线（完整生成链路）",
  "pipeline.import_chapters": "导入章节",
  "scene.spec": "场景蓝图生成",
  "rewrite.segment": "重写选段",
  "style.import": "导入文风样本",
  "outline.suggest_next": "建议下一步大纲",
  "character.check_consistency": "检查角色一致性",
  "hooks.manage": "管理伏笔",
  "writing-skills.read": "读取 Writing Skills",
  "writing-skills.write": "设置 Writing Skills",
  "writing-skills.recommend": "推荐 Writing Skills",
  "writing-skills.check_compliance": "检查 Writing Skills 合规",
  "writing-skills.import_legacy": "导入旧 Preset/Beat 为 Writing Skills",
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

export { NOVEL_RUNTIME_CONTRIBUTION, NOVEL_RUNTIME_SYSTEM_PROMPT } from "./runtime-contribution.js";
export { NOVEL_LEARNING_CONTRIBUTION } from "./learning-contribution.js";
export type { NovelBookRuntimeBinding } from "./runtime-contribution.js";

export default NOVEL_PLUGIN_MANIFEST;
