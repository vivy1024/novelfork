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
 * 小说领域工具定义 — session-level metadata wrapping novel-plugin schemas
 */
export const NOVEL_SESSION_TOOL_DEFINITIONS: readonly SessionToolDefinition[] = [
  sessionTool({
    name: "cockpit.snapshot",
    description:
      "一次性读取当前书籍的驾驶舱全景快照，合并了 cockpit.get_snapshot、cockpit.list_open_hooks、cockpit.list_recent_candidates 的输出。返回 progress/hooks/candidates/health/recentChapters。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["cockpit.snapshot"]),
    risk: "read",
    renderer: "cockpit.snapshot",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "pgi.ask",
    description: "PGI 追问工具（三合一）：生成追问问题 + 返回 AskUserQuestion 格式 + 格式化用户回答为写作指示。替代旧的 pgi.generate_questions/record_answers/format_answers_for_prompt。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["pgi.ask"]),
    risk: "read",
    renderer: "pgi.ask",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "candidate.create_chapter",
    description: "仅保存已有章节正文为候选稿。不会生成正文、不会审计、不会修订、不会同步经纬；完整写下一章必须优先调用 pipeline.write。",
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
    name: "chapter.list",
    description: "列出书籍的所有章节（序号、标题、字数、状态）。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["chapter.list"]),
    risk: "read",
    renderer: "chapter.list",
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
    name: "rewrite.apply",
    description: "将改写结果写回章节文件指定行号范围。支持 replace（替换）和 insert_after（行后插入）两种模式。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["rewrite.apply"]),
    risk: "draft-write",
    renderer: "tool.rewrite-apply",
    enabledForModes: WRITE_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "style.import",
    description: "从参考文本提取文风档案（统计分析+LLM 定性描述），生成 style_profile.json 和 style_guide.md。参考文本至少 2000 字。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["style.import"]),
    risk: "draft-write",
    renderer: "style.import",
    enabledForModes: WRITE_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "pipeline.revise",
    description: "修订已有章节。支持 5 种模式：polish（润色）、rewrite（重写）、rework（大改）、spot-fix（定点修复）、anti-detect（去AI味）。不填章节号则修订最新章。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["pipeline.revise"]),
    risk: "draft-write",
    renderer: "pipeline.revise",
    enabledForModes: WRITE_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "pipeline.import_chapters",
    description: "整书导入工具。从 .txt/.md 文件中按章节标题分割并导入所有章节到指定书籍。自动生成文风统计。文件路径需为服务器本地路径。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["pipeline.import_chapters"]),
    risk: "draft-write",
    renderer: "pipeline.import_chapters",
    enabledForModes: WRITE_SESSION_PERMISSION_MODES,
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
  // v2 合并工具：presets.read/write、beat.read/write（旧工具名保留兼容，但默认隐藏）
  sessionTool({
    name: "presets.read",
    description: "读取预设。scope=enabled（默认）返回当前书籍已启用规则（含 promptInjection 全文）；scope=available 返回全部可用预设（含启用标记，可按 category 过滤）。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["presets.read"]),
    risk: "read",
    renderer: "presets.rules",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "presets.write",
    description: "写预设。action=enable/disable/set 改变书籍启用的预设列表（传 enabledPresetIds）；action=create 创建自定义预设（传 name/category/promptInjection）。promptInjection 是注入写作 prompt 的规则全文。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["presets.write"]),
    risk: "confirmed-write",
    renderer: "presets.rules",
    enabledForModes: WRITE_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "beat.read",
    description: "读取当前书籍的节拍模板与节拍列表，返回模板名、节拍序号、名称、情绪基调、字数建议；未选中模板时返回可选模板列表。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["beat.read"]),
    risk: "read",
    renderer: "beat.current",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "beat.write",
    description: "写节拍。action=select 切换到已有模板（传 templateId，可用：opening-hooks/three-act/save-the-cat/heros-journey/chapter-ending-hooks）；action=create 创建自定义节拍（传 name/description/beats）。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["beat.write"]),
    risk: "confirmed-write",
    renderer: "beat.current",
    enabledForModes: WRITE_SESSION_PERMISSION_MODES,
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
    name: "pipeline.write",
    description: "精简写作管线（v2）：接受 scene.spec 生成的结构化蓝图，执行 Writer→AuditRevise 两步生成章节候选稿。前置条件：必须先调用 scene.spec 获得有效蓝图。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["pipeline.write"]),
    risk: "draft-write",
    renderer: "pipeline.chapter-result",
    enabledForModes: WRITE_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "jingwei.write",
    description: "经纬写入/删除工具。action=create/update 创建或更新条目；action=delete 删除条目（Canon 条目不可删除）。支持 layer 分层：canon（不可变）、dynamic（默认）、reference。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["jingwei.write"]),
    risk: "draft-write",
    renderer: "jingwei.write",
    enabledForModes: WRITE_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "scene.spec",
    description: "生成结构化写作蓝图（Scene Spec）。包含角色、地点、冲突、情绪、结果等约束，是调用 pipeline.write 的硬前置条件。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["scene.spec"]),
    risk: "read",
    renderer: "scene.spec",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "jingwei.read",
    description: "统一经纬读取工具。scope=brief 返回核心包+分类目录；scope=category 按分类分页读取；scope=search 按关键词搜索。替代旧的 read_brief/read_category/search/read_context。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["jingwei.read"]),
    risk: "read",
    renderer: "jingwei.read",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "resource.manage",
    description: "写作资源管理工具。action=list 列出资源；accept/reject/archive/restore/delete 管理候选稿/草稿/章节状态；create_draft 创建空草稿。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["resource.manage"]),
    risk: "confirmed-write",
    renderer: "resource.manage",
    enabledForModes: WRITE_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
] as const;

/**
 * 小说工具名列表 — 供 novel-plugin manifest 引用
 */
export const NOVEL_TOOL_NAMES: readonly string[] = NOVEL_SESSION_TOOL_DEFINITIONS.map((t) => t.name);

/**
 * 小说 Agent 角色预设 — 与 AGENT_ROLES 保持一致
 */
export const NOVEL_AGENT_PRESETS: Record<string, { enable: string[]; disable: string[] }> = {
  novelist: {
    enable: ["Bash", "Read", "Write", "Edit", "Grep", "Glob", "EnterWorktree", "ExitWorktree", "TaskCreate", "Terminal", "Browser", "Recall", "ShareFile"],
    disable: [],
  },
};
