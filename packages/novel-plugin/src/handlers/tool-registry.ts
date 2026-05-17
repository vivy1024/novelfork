/**
 * Novel-domain session tool definitions.
 *
 * Architecture: inputSchema definitions live in packages/novel-plugin/src/tool-schemas.ts
 * (the single source of truth). This file adds session-specific metadata (risk, renderer,
 * enabledForModes, visibility) that only the studio runtime needs.
 */
import { NOVEL_TOOL_SCHEMAS } from "../tool-schemas.js";
import type { ToolInputSchema } from "../tool-schemas.js";
import type {
  JsonObjectSchema,
  SessionToolDefinition,
} from "@vivy1024/novelfork-studio/shared/agent-native-workspace";
import type { SessionPermissionMode } from "@vivy1024/novelfork-studio/shared/session-types";

const ALL_SESSION_PERMISSION_MODES: readonly SessionPermissionMode[] = ["ask", "edit", "allow", "read", "plan"];
const WRITE_SESSION_PERMISSION_MODES: readonly SessionPermissionMode[] = ["ask", "edit", "allow"];

/** Convert ToolInputSchema from novel-plugin to JsonObjectSchema used by session tools */
function toJsonObjectSchema(schema: ToolInputSchema): JsonObjectSchema {
  return schema as unknown as JsonObjectSchema;
}

function sessionTool(
  definition: Omit<SessionToolDefinition, "visibility"> & Partial<Pick<SessionToolDefinition, "visibility">>,
): SessionToolDefinition {
  return { visibility: "author", ...definition };
}

/**
 * 24 个小说领域工具定义 — session-level metadata wrapping novel-plugin schemas
 */
export const NOVEL_SESSION_TOOL_DEFINITIONS: readonly SessionToolDefinition[] = [
  sessionTool({
    name: "cockpit.get_snapshot",
    description: "读取当前书籍的驾驶舱快照，包括进度、当前焦点、风险、伏笔、候选稿与模型状态。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["cockpit.get_snapshot"]),
    risk: "read",
    renderer: "cockpit.snapshot",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "cockpit.list_open_hooks",
    description: "列出当前书籍仍待推进或回收的伏笔与开放 hook。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["cockpit.list_open_hooks"]),
    risk: "read",
    renderer: "cockpit.openHooks",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "cockpit.list_recent_candidates",
    description: "列出当前书籍最近生成的候选稿与可在画布打开的 artifact 引用。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["cockpit.list_recent_candidates"]),
    risk: "read",
    renderer: "cockpit.recentCandidates",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "questionnaire.list_templates",
    description: "列出可用于建立书籍前提、世界模型、人物弧光或主要矛盾的问卷模板。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["questionnaire.list_templates"]),
    risk: "read",
    renderer: "questionnaire.templates",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "questionnaire.start",
    description: "根据模板启动结构化问卷流程，返回待展示的问题卡，不写入正式经纬。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["questionnaire.start"]),
    risk: "read",
    renderer: "questionnaire.questions",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "questionnaire.suggest_answer",
    description: "基于真实 provider/model 上下文为问卷问题生成建议答案；模型不可用时应返回 unsupported。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["questionnaire.suggest_answer"]),
    risk: "read",
    renderer: "questionnaire.suggestion",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "questionnaire.submit_response",
    description: "提交问卷回答并准备写入 Bible/Jingwei 的事务化 mapping；正式写入必须经过确认。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["questionnaire.submit_response"]),
    risk: "confirmed-write",
    renderer: "jingwei.mutationPreview",
    enabledForModes: WRITE_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "pgi.generate_questions",
    description: "根据当前章节意图、伏笔、冲突与章节上下文生成 2-5 个生成前追问。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["pgi.generate_questions"]),
    risk: "read",
    renderer: "pgi.questions",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "pgi.record_answers",
    description: "记录 PGI 问题回答或跳过原因，用作后续候选稿 metadata 与写作上下文。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["pgi.record_answers"]),
    risk: "draft-write",
    renderer: "pgi.answers",
    enabledForModes: WRITE_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "pgi.format_answers_for_prompt",
    description: "将 PGI 问题与答案整理成 writer 可直接使用的本章作者指示。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["pgi.format_answers_for_prompt"]),
    risk: "read",
    renderer: "pgi.promptInstructions",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "candidate.create_chapter",
    description: "根据章节意图、PGI 指示和引导式计划生成下一章候选稿，不覆盖正式章节正文。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["candidate.create_chapter"]),
    risk: "draft-write",
    renderer: "candidate.created",
    enabledForModes: WRITE_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "narrative.read_line",
    description: "读取当前书籍的叙事线只读快照，包括节点、边与可计算 warnings。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["narrative.read_line"]),
    risk: "read",
    renderer: "narrative.line",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "narrative.propose_change",
    description: "生成叙事线变更草案和差异预览，不直接写入正式叙事线。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["narrative.propose_change"]),
    risk: "draft-write",
    renderer: "narrative.mutationPreview",
    enabledForModes: WRITE_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  // --- 小说上下文工具组 (Task 23) ---
  sessionTool({
    name: "chapter.read",
    description: "读取指定章节的正文内容、元数据和状态。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["chapter.read"]),
    risk: "read",
    renderer: "chapter.content",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "jingwei.read_context",
    description: "读取书籍的故事经纬上下文，包括前提、世界模型、人物弧光和核心矛盾。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["jingwei.read_context"]),
    risk: "read",
    renderer: "jingwei.context",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "health.read_summary",
    description: "读取作品健康度摘要，包括进度、风险、缺口和下一步建议。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["health.read_summary"]),
    risk: "read",
    renderer: "health.summary",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  // --- 新增小说工具组 (5 tools) ---
  sessionTool({
    name: "chapter.audit",
    description: "对单章执行质量审计，包括节奏分析、AI 味检测、伏笔到期检查、连续性检查。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["chapter.audit"]),
    risk: "read",
    renderer: "chapter.audit",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "rewrite.segment",
    description: "对章节中选定段落执行改写（续写/扩写/去AI味/风格改写），调用 LLM 生成改写结果。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["rewrite.segment"]),
    risk: "read",
    renderer: "tool.rewrite-segment",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "outline.suggest_next",
    description: "基于大纲、最近章节和待兑现伏笔，推荐下一章的 2-3 个写作方向。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["outline.suggest_next"]),
    risk: "read",
    renderer: "outline.suggestions",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "character.check_consistency",
    description: "检查角色在指定章节范围内的出现频率和上下文，辅助人设一致性审查。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["character.check_consistency"]),
    risk: "read",
    renderer: "character.consistency",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "hooks.manage",
    description: "伏笔统一管理：埋设、兑现、检查到期、列出所有伏笔。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["hooks.manage"]),
    risk: "draft-write",
    renderer: "hooks.manage",
    enabledForModes: WRITE_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  // --- 预设与节拍工具 (cockpit-redesign spec) ---
  sessionTool({
    name: "presets.get_rules",
    description: "读取当前书籍启用的预设规则列表，返回每条预设的名称、分类和 promptInjection。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["presets.get_rules"]),
    risk: "read",
    renderer: "presets.rules",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "presets.check_compliance",
    description: "对照启用的预设规则逐条检查章节内容，返回违规项列表。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["presets.check_compliance"]),
    risk: "read",
    renderer: "presets.compliance",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "beat.get_current",
    description: "读取当前书籍的节拍模板与节拍列表，返回模板名、节拍序号、名称、情绪基调、字数建议。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["beat.get_current"]),
    risk: "read",
    renderer: "beat.current",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "beat.set_template",
    description: "为当前书籍设置节拍模板。可用模板：opening-hooks（网文开篇钩子12式）、three-act（三幕结构）、save-the-cat（救猫咪15节拍）、heros-journey（英雄之旅17阶段）、chapter-ending-hooks（章节结尾钩子生成器）。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["beat.set_template"]),
    risk: "confirmed-write",
    renderer: "beat.current",
    enabledForModes: WRITE_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "presets.set_rules",
    description: "为当前书籍设置启用的预设规则列表。传空数组清空所有预设。可通过 presets.get_rules 查看当前启用的预设，通过 /api/presets 查看所有可用预设。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["presets.set_rules"]),
    risk: "confirmed-write",
    renderer: "presets.rules",
    enabledForModes: WRITE_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "jingwei.upsert_entry",
    description: "创建或更新经纬条目。按 title 匹配：标题相同则更新内容，不存在则创建。类别不存在时自动创建。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["jingwei.upsert_entry"]),
    risk: "confirmed-write",
    renderer: "jingwei.upsert",
    enabledForModes: WRITE_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
] as const;

/**
 * 小说工具名列表 — 供 novel-plugin manifest 引用
 */
export const NOVEL_TOOL_NAMES: readonly string[] = NOVEL_SESSION_TOOL_DEFINITIONS.map((t) => t.name);

/**
 * 小说 Agent 角色预设 — writer/hooks/chapter-hooks/outline
 */
export const NOVEL_AGENT_PRESETS: Record<string, { enable: string[]; disable: string[] }> = {
  writer: {
    enable: ["Bash", "Read", "Write", "Edit", "Grep", "Glob", "EnterWorktree", "ExitWorktree", "TaskCreate"],
    disable: ["Terminal", "Browser", "ForkNarrator", "Recall", "ShareFile"],
  },
  hooks: {
    enable: ["Read", "Write", "Grep", "Glob"],
    disable: ["Bash", "Terminal", "Browser", "ForkNarrator"],
  },
  "chapter-hooks": {
    enable: ["Read", "Grep", "Glob"],
    disable: ["Write", "Edit", "Bash", "Terminal", "Browser"],
  },
  outline: {
    enable: ["Read", "Write", "Edit", "Grep", "Glob"],
    disable: ["Bash", "Terminal", "Browser", "ForkNarrator"],
  },
};
