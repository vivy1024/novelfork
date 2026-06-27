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
      "驾驶舱全景快照——一次性读取当前书籍的完整状态概览。\n\n返回内容：\n- progress：总章数、总字数、最近更新章节\n- hooks：所有未兑现伏笔（含到期章节）\n- chapters：最近正式章节与章节结果\n- health：书籍健康度评分\n- recentChapters：最近 5 章摘要\n\n使用时机：\n- 每次写作会话开始时首先调用，建立全局认知\n- 用户说「继续写」/「下一章」时先调用确认当前进度\n- 用户问「进度怎么样」/「写到哪了」/「伏笔状态」\n- 准备写下一章前的第一步\n- 与 chapter.list 的区别：cockpit 是概览（含伏笔/健康度），chapter.list 是纯章节列表\n\n不要用的时候：\n- 刚调用过且结果还在上下文中（除非被折叠提示了）\n\n注意：此工具只读不写，开销约 1000-3000 tokens，可放心频繁调用。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["cockpit.snapshot"]),
    risk: "read",
    renderer: "cockpit.snapshot",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "pgi.ask",
    description: "PGI 追问工具（三合一）：生成追问问题 + 返回 AskUserQuestion 格式 + 格式化用户回答为写作指示。替代旧的 pgi.generate_questions/record_answers/format_answers_for_prompt。\n\n使用时机：\n- 需要向用户确认写作方向/选择时\n- 用户指令模糊需要追问时\n\n不要用的时候：\n- 用户已经给了明确完整的指令（直接执行，不要多此一问）\n- 用户说「继续」/「接着写」（方向已确定，直接进 scene.spec）",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["pgi.ask"]),
    risk: "read",
    renderer: "pgi.ask",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
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
    description: "从参考文本提取文风档案（统计分析+LLM 定性描述），生成待确认的写作预设建议；不会自动写入 style_profile.json 或 style_guide.md。参考文本至少 2000 字。",
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
    description: "写作管线（v2）：接受 scene.spec 生成的结构化蓝图，执行 Writer→ContinuityAudit→Revise 流程生成章节结果。\n\n使用流程：\n1. 必须先调用 scene.spec 获得有效蓝图（硬前置条件，缺失会报错）\n2. 传入蓝图后自动生成正文 → 37 维一致性审计 → 定点修订\n3. 结果应进入正式章节或后续版本结算流程；不要再创建 candidate/draft 主对象\n\n使用时机：\n- 用户明确要求「写下一章」/「生成章节」时\n- 已有 scene.spec 蓝图准备就绪时\n\n不要用的时候：\n- 用户只是在问问题、查看设定、讨论方向（不要把所有交互都往写作流程引导）\n- 用户说「看看XX」/「告诉我XX」时——这是查询请求，不是写作请求\n\n注意：\n- 长度由蓝图中的 targetWordCount 控制（默认 3000-5000 字）\n- 如果审计发现 S1 级问题会自动修订，S3-S4 仅警告",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["pipeline.write"]),
    risk: "draft-write",
    renderer: "pipeline.chapter-result",
    enabledForModes: WRITE_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "lore.read",
    description: `Lore / 经纬静态设定读取工具。只读取作者显式维护的静态设定、规则、资料与备注，不返回完整动态剧情记忆。

职责边界：
- 适合读取人物设定、地点、势力、规则、物品、术语、作者备注、平台/书籍规则。
- 默认排除 archived、draft、needs-review、participates_in_ai=0 或等价非活跃条目。
- 写作、修订、审计前的动态叙事记忆召回请使用 memory.read。
- 关系变化、时间线、角色弧线、伏笔状态和 Pending NarrativeEvents 不属于 Lore。`,
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["lore.read"]),
    risk: "read",
    renderer: "jingwei.read",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "lore.write",
    description: `Lore / 经纬静态设定写入工具。用于创建或修改作者可审阅的静态设定。

职责边界：
- 适合写入 canon/reference/rules 类作者设定、世界规则、平台规则与作者备注。
- 写入 canon 或 rules 类设定时必须提供 reason，并提供 source 或 evidence。
- 动态事实、章节后抽取事实、诊断结果、市场材料、Pending NarrativeEvents 不得直接写入 Lore canon。
- 动态叙事事实应进入 memory.events / Narrative Memory 事件流程。`,
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["lore.write"]),
    risk: "draft-write",
    renderer: "jingwei.write",
    enabledForModes: WRITE_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "memory.read",
    description: "动态叙事记忆召回工具。用于写作、修订、审计、诊断前读取 Narrative Memory 的 ContextCards、通道状态、warnings 与 token budget；不要把它当静态 Lore 条目编辑器。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["memory.read"]),
    risk: "read",
    renderer: "narrative-memory.read",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "memory.graph",
    description: "动态叙事记忆关系图工具。读取 Narrative Memory 下的关系图、时间线、角色弧线、伏笔网络、矛盾地图、事件链等动态图谱，只读不修改 Lore。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["memory.graph"]),
    risk: "read",
    renderer: "narrative-memory.graph",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "memory.events",
    description: "Pending NarrativeEvents 工具。用于创建、列出、批准或拒绝 Pending NarrativeEvents；approve 会写入 Narrative Memory facts，pending event 不等于 confirmed memory，更不能自动写入 Lore canon。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["memory.events"]),
    risk: "draft-write",
    renderer: "narrative-memory.events",
    enabledForModes: WRITE_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "jingwei.audit",
    description: "经纬 / Lore 审计门禁。检查静态设定条目是否满足 active + confirmed + participates_in_ai 的 AI 读取门禁，并报告 draft、needs-review、archived、分区禁用或条目禁用等问题。只读，不会修改经纬。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["jingwei.audit"]),
    risk: "read",
    renderer: "jingwei.audit",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "jingwei.write",
    description: `deprecated alias of lore.write。经纬（Jingwei）现在只等价于 Lore 静态设定写入工具，用于管理作者显式维护、可审阅的静态设定。

action=create：创建新条目。必须传入 title、category、contentMd。
action=update：更新已有条目（传 entryId 或 title 匹配）。
action=delete：删除条目。

边界：
- 只写入静态设定、世界规则、平台规则、作者备注等 Lore 内容。
- 写入 canon 或 rules 类设定时必须提供 reason，并提供 source 或 evidence。
- 动态事实不得直接写入 Lore；章节后抽取事实、关系变化、伏笔推进、Pending NarrativeEvents 请使用 memory.events / Narrative Memory 流程。
- 不要把诊断结果、市场材料、工具临时输出直接写入 Lore canon。

兼容说明：旧会话可继续调用 jingwei.write，但新 prompt 应使用 lore.write。`,
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["jingwei.write"]),
    risk: "draft-write",
    renderer: "jingwei.write",
    enabledForModes: WRITE_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "scene.spec",
    description: "生成结构化写作蓝图（Scene Spec）。这是调用 pipeline.write 的硬前置条件——没有蓝图 pipeline.write 会报错。\n\n使用流程：\n1. 先调用 cockpit.snapshot 了解当前进度和待兑现伏笔\n2. 调用 lore.read(scope=brief) 获取作者显式维护的静态设定包\n3. 调用 memory.read(purpose=write) 获取动态叙事记忆、通道状态、时间线/伏笔/事实召回\n4. 可选调用 pgi.ask 向用户追问本章意图\n5. 然后调用 scene.spec 传入上述信息生成蓝图\n\n蓝图包含：涉及角色、地点、核心冲突、情绪弧线、章节目标、目标字数、必须包含的伏笔节点。\n\n不要用的时候：\n- 用户没有要求写章节时\n- 用户在做非写作操作（查看设定、整理 Lore、讨论方向）\n\n注意：经纬/Jingwei 是 lore.read 的 deprecated alias，只能读取静态设定；动态叙事记忆请使用 memory.read。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["scene.spec"]),
    risk: "read",
    renderer: "scene.spec",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "jingwei.read",
    description: `deprecated alias of lore.read。经纬（Jingwei）现在只等价于 Lore 静态设定读取工具。

scope=brief：返回作者显式维护的核心静态设定包 + 分类目录。
scope=category：按分类读取详细静态设定条目。
scope=search：关键词搜索静态设定。

默认过滤：archived、draft、needs-review、participates_in_ai=0 或等价非活跃条目不会作为 Agent 可读 Lore 返回。

使用时机：
- 用户说"看经纬"/"看设定"/"看世界模型" → scope=brief 返回给用户看
- 写作前读取静态设定 → 优先使用 lore.read
- 查找特定设定 → scope=search

不要用的时候：
- 不要用 jingwei.read 获取动态叙事记忆；动态叙事记忆请使用 memory.read。
- 关系图、时间线、角色弧线、伏笔网络、Pending NarrativeEvents 请使用 memory.graph / memory.events。`,
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["jingwei.read"]),
    risk: "read",
    renderer: "jingwei.read",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "resource.manage",
    description: "正式章节结果管理。\n\naction=list：列出所有正式章节结果（传 filter 可过滤）\naction=archive：归档正式章节结果（不删除但标记不活跃）\naction=delete：永久删除正式章节结果\n\n使用时机：\n- 用户说「删掉这个章节」→ delete 或 archive\n- 用户想看有哪些章节 → list",
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
