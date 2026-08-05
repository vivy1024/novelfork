/**
 * Novel-domain session tool definitions.
 *
 * Architecture: inputSchema definitions live in packages/novel-plugin/src/tool-schemas.ts
 * (the single source of truth). This file adds session-specific metadata (risk, renderer,
 * enabledForModes, visibility) that only the studio runtime needs.
 */
import { NOVEL_TOOL_SCHEMAS } from "../tool-schemas.js";
import type { ToolInputSchema } from "../tool-schemas.js";

/** Portable equivalents of Studio's session-tool contracts. Keep this catalog Studio-free. */
export type NovelRuntimeToolRisk = "read" | "draft-write" | "confirmed-write" | "destructive";
export type NovelSessionPermissionMode = "ask" | "edit" | "allow" | "read" | "plan";
export type NovelSessionToolVisibility = "author" | "advanced";
export type NovelSessionToolScope = "universal" | "novel" | "all";
export type NovelRuntimeStatus = "ready" | "unavailable";

export interface NovelSessionToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: ToolInputSchema;
  readonly risk: NovelRuntimeToolRisk;
  readonly renderer: string;
  readonly enabledForModes: readonly NovelSessionPermissionMode[];
  readonly visibility: NovelSessionToolVisibility;
  readonly scope?: NovelSessionToolScope;
}

export interface NovelRuntimeToolCatalogEntry extends NovelSessionToolDefinition {
  /** Whether this tool can be safely contributed to the portable Runtime today. */
  readonly runtimeStatus: NovelRuntimeStatus;
}

export const NOVEL_READY_RUNTIME_TOOL_NAMES = [
  "cockpit.snapshot",
  "write.preflight",
  "pgi.ask",
  "narrative.read_line",
  "narrative.propose_change",
  "narrative.approve_change",
  "chapter.read",
  "chapter.write",
  "chapter.list",
  "chapter.discard_range",
  "chapter.audit",
  "rewrite.segment",
  "rewrite.apply",
  "style.import",
  "pipeline.revise",
  "pipeline.import_chapters",
  "book.dissect",
  "outline.suggest_next",
  "outline.volume",
  "arc.character",
  "publish.check",
  "character.check_consistency",
  "hooks.manage",
  "writing-skills.read",
  "writing-skills.write",
  "writing-skills.recommend",
  "writing-skills.check_compliance",
  "writing-skills.import_legacy",
  "pipeline.write",
  "lore.read",
  "lore.write",
  "memory.read",
  "memory.graph",
  "memory.events",
  "memory.list",
  "memory.read_entry",
  "memory.search",
  "memory.dedup",
  "memory.export",
  "memory.stats",
  "memory.settle_range",
  "memory.update",
  "memory.delete",
  "memory.bulk_approve",
  "memory.bulk_delete",
  "jingwei.audit",
  "jingwei.write",
  "jingwei.read",
  "resource.manage",
  "scene.spec",
] as const;

const READY_RUNTIME_TOOL_NAMES = new Set<string>(NOVEL_READY_RUNTIME_TOOL_NAMES);
const ALL_SESSION_PERMISSION_MODES: readonly NovelSessionPermissionMode[] = ["ask", "edit", "allow", "read", "plan"];
const WRITE_SESSION_PERMISSION_MODES: readonly NovelSessionPermissionMode[] = ["ask", "edit", "allow"];

/** Preserve the Studio-compatible object-schema shape without importing Studio. */
function toJsonObjectSchema(schema: ToolInputSchema): ToolInputSchema {
  return schema;
}

function sessionTool(
  definition: Omit<NovelSessionToolDefinition, "visibility"> & Partial<Pick<NovelSessionToolDefinition, "visibility">>,
): NovelRuntimeToolCatalogEntry {
  return {
    visibility: "author",
    runtimeStatus: READY_RUNTIME_TOOL_NAMES.has(definition.name) ? "ready" : "unavailable",
    ...definition,
  };
}

/**
 * 小说领域工具定义 — session-level metadata wrapping novel-plugin schemas
 */
export const NOVEL_RUNTIME_TOOL_CATALOG: readonly NovelRuntimeToolCatalogEntry[] = [
  sessionTool({
    name: "cockpit.snapshot",
    description:
      "驾驶舱全景快照——一次性读取当前书籍的完整状态概览。\n\n返回内容：\n- progress：总章数、总字数、最近更新章节\n- hooks：所有未兑现伏笔（含到期章节）\n- chapters：最近正式章节与章节结果\n- health：书籍健康度评分\n- recentChapters：最近 5 章摘要\n\n使用时机：\n- 每次写作会话开始时首先调用，建立全局认知\n- 用户说「继续写」/「下一章」时先调用确认当前进度\n- 用户问「进度怎么样」/「写到哪了」/「伏笔状态」\n- 准备写下一章前的第一步\n- 与 chapter.list 的区别：cockpit 是概览（含伏笔/健康度），chapter.list 是纯章节列表\n\n不要用的时候：\n- 刚调用过且结果还在上下文中（除非被折叠提示了）\n\nNUG/Kiro 调用参数：必须传入 `confirm: true`；当前书籍身份由宿主可信绑定注入，禁止传 `bookId`。\n\n注意：此工具只读不写，开销约 1000-3000 tokens，可放心频繁调用。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["cockpit.snapshot"]),
    risk: "read",
    renderer: "cockpit.snapshot",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "write.preflight",
    description:
      "写章前硬门预检：组装最小上下文包（currentFocus、近章摘要/事实、本章伏笔、resolvedDirective、memoryHealth），并对缺失输入硬拦截。\n\n使用时机：\n- 写新章前的第一步（先于 scene.spec / pipeline.write）\n- 用户说「继续写」「下一章」时先核验上下文是否就绪\n\n返回：\n- ok=false 时 blockers 含 missing-directive / empty-recent-progress / high-risk-pending 等，必须停写并报告\n- ok=true 时可用 resolvedDirective 作为 scene.spec 的 userDirectives\n- needsUserConfirm=true：仅有 focus 默认句，需用户确认或 acceptFocusDefault=true\n\n不要用的时候：\n- 只是查询设定/进度（用 cockpit.snapshot / lore.read / memory.read）\n- 写后审修（chapter.audit / pipeline.revise）\n\n纪律：禁止用写作理论或外部项目总结代替 memory/lore；软门（文风/去 AI 味）不在本工具。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["write.preflight"]),
    risk: "read",
    renderer: "write.preflight",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "memory.settle_range",
    description:
      "对历史章节批量/补结算 Narrative Memory（事实抽取、状态回写）。用于填补正史数据空洞（例如 1–10 章漏结算）。\n\n行为：按章读取已有正文 → settleConfirmedChapter；幂等（同 id 事件复用）。\n\n使用时机：\n- write.preflight 报 empty-recent-progress\n- 用户要求回填旧章记忆\n\n不要用的时候：\n- 废稿正史：先 chapter.discard_range，不要给废稿养正史\n- 单章刚写完：pipeline.write 已自动结算",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["memory.settle_range"]),
    risk: "confirmed-write",
    renderer: "narrative-memory.admin",
    enabledForModes: WRITE_SESSION_PERMISSION_MODES,
    visibility: "advanced",
    scope: "novel",
  }),
  sessionTool({
    name: "chapter.discard_range",
    description:
      "试写整段作废：从正史抹去范围内章节结果与章域 Narrative Memory，并按策略重置伏笔。\n\n必须 confirm=true。默认归档正文 + 清除范围内 events/facts；hardDelete=true 才尽量物理删文件。\n\n使用时机：\n- 用户说这 N 章写废了要丢掉重开\n- 丢弃后应再 write.preflight 确认近章记忆已空/干净\n\n风险：confirmed-write，不可逆清理记忆；不动 canon 经纬正文设定。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["chapter.discard_range"]),
    risk: "destructive",
    renderer: "chapter.discard_range",
    enabledForModes: WRITE_SESSION_PERMISSION_MODES,
    visibility: "advanced",
    scope: "novel",
  }),
  sessionTool({
    name: "pgi.ask",
    description: "PGI 追问工具（三合一）：生成追问问题 + 返回 AskUserQuestion 格式 + 格式化用户回答为写作指示。替代旧的 pgi.generate_questions/record_answers/format_answers_for_prompt。\n\n使用时机：\n- 需要向用户确认写作方向/选择时\n- 用户指令模糊需要追问时\n\n不要用的时候：\n- 用户已经给了明确完整的指令（直接执行，不要多此一问）\n- 用户说「继续」/「接着写」（方向已确定，先 write.preflight 再 scene.spec）",
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
    description: "生成叙事线变更草案和差异预览，不直接写入正式叙事线。可用 removeNodeIds/removeEdgeIds 提议删除作者节点；派生节点会被告警。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["narrative.propose_change"]),
    risk: "draft-write",
    renderer: "narrative.mutationPreview",
    enabledForModes: WRITE_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "narrative.approve_change",
    description: "对 narrative.propose_change 的预览给出审批结论。approved 才写入叙事线；批准与驳回都会记入审批台账。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["narrative.approve_change"]),
    risk: "confirmed-write",
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
    name: "chapter.write",
    description: "受控覆盖指定的已存在章节正文。只能按章节序号写入当前可信书籍，不能创建任意文件或改写其他书籍；Runtime 会在真正写入前请求用户批准。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["chapter.write"]),
    risk: "confirmed-write",
    renderer: "chapter.content",
    enabledForModes: WRITE_SESSION_PERMISSION_MODES,
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
    description: "将改写结果写回当前可信书籍中已存在章节的指定行号范围。支持 replace（替换）和 insert_after（行后插入）两种模式。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["rewrite.apply"]),
    risk: "confirmed-write",
    renderer: "tool.rewrite-apply",
    enabledForModes: WRITE_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "style.import",
    description: "从参考文本提取文风档案（统计分析+LLM 定性描述）。默认只生成待确认建议；saveAsWritingSkill=true 时保存为作者级 Writing Skill 并可选 enableOnBook 启用。参考文本至少 2000 字。",
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
    risk: "confirmed-write",
    renderer: "pipeline.revise",
    enabledForModes: WRITE_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "pipeline.import_chapters",
    description: "整书导入工具。接收显式 .txt/.md 文本内容，按章节标题分割并追加导入当前可信书籍。\n\n闭环（默认）：\n- autoSettle=true：导入后 memory.settle_range\n- extractBrief=true：抽取角色/地点/钩子/焦点草案并返回 preflight 预检\n- applyDissectDraft=true 才写入 story 草稿文件\n\n不接受服务器文件路径。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["pipeline.import_chapters"]),
    risk: "confirmed-write",
    renderer: "pipeline.import_chapters",
    enabledForModes: WRITE_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "book.dissect",
    description:
      "拆解已有正文为续写知识包（角色卡/世界要素/关系/伏笔/章摘要/建议 focus）。\n\n默认只返回草案；apply=true 写入**经纬 dynamic 层且 status=needs-review**（待作者确认，不进 canon）；settle=true 可同时批量结算叙事记忆。\n\n权威源：伏笔→经纬 foreshadowing；章摘要→chapter-summaries；角色→characters；世界→world-model/locations/factions/power-system/rules。story/*.md 仅为导出物。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["book.dissect"]),
    risk: "draft-write",
    renderer: "book.dissect",
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
    name: "outline.volume",
    description:
      "卷级大纲（卷纲）管理。\n\naction=get（默认）：读取 volumes 与当前卷；\naction=suggest：按目标章数/卷数生成草案（不落盘，可 LLM 精修）；\naction=set：落盘 story/volume_outline.json + .md。\n\n用途：长篇中盘防跑偏——当前卷目标会进 write.preflight 与 scene.spec 上下文。\n不写 lore canon。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["outline.volume"]),
    risk: "confirmed-write",
    renderer: "outline.volume",
    enabledForModes: WRITE_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "arc.character",
    description:
      "角色弧线工具。\n\naction=status（默认，只读）：列出各角色弧类型、当前阶段、beats 数、最后推进章，并给出弧线不一致/停滞告警；\naction=sync：按规则从指定章正文抽取 beats 并写入动态弧线表；\naction=refine：同 sync 但用 LLM 精修 beats。\n\n用途：长篇人物成长线可见与纠偏。写入 jingwei_character_arc（dynamic），不动 canon。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["arc.character"]),
    risk: "confirmed-write",
    renderer: "character.arcs",
    enabledForModes: WRITE_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "publish.check",
    description:
      "平台发布向自检：敏感词、AI 率估算、格式规范、连续性汇总，并对照平台 profile 检查章字数目标。\n\n平台缺省按 book.platform 映射（tomato→番茄、qidian→起点、jjwxc→晋江、qimao→七猫，其余 generic）。\n\n只读报告：block/warn/suggest 计数与逐项明细。pipeline.write 成功后会自动做单章轻检并给 publishHint；此工具用于全书或指定范围的完整核验。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["publish.check"]),
    risk: "read",
    renderer: "compliance.publish-readiness",
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
    risk: "confirmed-write",
    renderer: "hooks.manage",
    enabledForModes: WRITE_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  // --- Writing Skills 工具组 ---
  sessionTool({
    name: "writing-skills.read",
    description: "读取当前项目的 Writing Skills。scope=enabled 返回 `.novelfork/skills/` 中自动发现的完整正文；scope=available 返回 catalog 与项目文件的合并视图。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["writing-skills.read"]),
    risk: "read",
    renderer: "writing-skills.list",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "writing-skills.write",
    description: "管理当前项目 `.novelfork/skills/` 中的 Writing Skill 文件；项目目录扫描结果是唯一生效来源。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["writing-skills.write"]),
    risk: "confirmed-write",
    renderer: "writing-skills.list",
    enabledForModes: WRITE_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  // 只读推荐：按本书已落库的建书答案（题材/基调/平台/复杂度/AI 味容忍度）
  // 从内置 Skills 里挑出候选并给出理由。不写 book.json —— 启用仍走
  // writing-skills.write，保留 Runtime 权限确认。
  // renderer 显式声明为 "generic"：Studio 侧没有专用卡片，由
  // GenericToolResultRenderer 兜底（registry.tsx 的 resolveToolResultRendererKey
  // 对未登记键同样回落 generic）。推荐结果是扁平的 name+kind+reason 列表，
  // generic 卡片足够；真正需要作者交互的是随后的 AskUserQuestion，那由 Runtime 渲染。
  sessionTool({
    name: "writing-skills.recommend",
    description: "按本书建书答案推荐应启用的 Writing Skills，返回候选与推荐理由。只读，不修改启用状态；确认后请用 writing-skills.write 落库。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["writing-skills.recommend"]),
    risk: "read",
    renderer: "generic",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "writing-skills.check_compliance",
    description: "按当前生效 Writing Skills 中声明的安全检查规则审阅章节正文，返回违规项及 explanation。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["writing-skills.check_compliance"]),
    risk: "read",
    renderer: "writing-skills.compliance",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "writing-skills.import_legacy",
    description: "显式扫描并迁移旧 user_template Preset/Beat 数据为作者目录中的 Writing Skills；不自动覆盖冲突文件。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["writing-skills.import_legacy"]),
    risk: "confirmed-write",
    renderer: "writing-skills.import",
    enabledForModes: WRITE_SESSION_PERMISSION_MODES,
    visibility: "advanced",
    scope: "novel",
  }),
  sessionTool({
    name: "pipeline.write",
    description: "写作管线（v2）：接受 scene.spec 生成的结构化蓝图，执行 Writer→ContinuityAudit→Revise 流程生成章节结果。\n\n使用流程：\n1. 先 write.preflight（blockers 非空禁止继续）\n2. 必须先调用 scene.spec 获得有效蓝图（硬前置条件，缺失会报错）\n3. 传入蓝图后自动生成正文 → 一致性审计 → 定点修订\n4. 成功后自动章后结算 Narrative Memory\n\n硬门：\n- 已有正式章但近章记忆/摘要为空 → context-not-ready（先 memory.settle_range 或 chapter.discard_range）\n- 软质量（AI 味/传播力/文风）不在写前拦截，请写后 chapter.audit / pipeline.revise\n\n可选质量强化：\n- factCheckAutoRevise=true：审修后仍有事实/连续性 critical 时，额外做 1 轮事实专项 spot-fix + 复审\n- requireFactCheckPass=true：复审仍不过则 fact-check-failed 不保存\n\n使用时机：\n- 用户明确要求「写下一章」/「生成章节」且 preflight ok 时\n- 已有 scene.spec 蓝图准备就绪时\n\n不要用的时候：\n- 用户只是在问问题、查看设定、讨论方向\n- preflight blockers 非空时",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["pipeline.write"]),
    risk: "confirmed-write",
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

action=create | update | delete | retire。
- create/update：写入静态设定；canon/rules 必须 reason + source/evidence。
- delete：仅非 canon。
- retire：退役错误/过期条目（含 canon）。不改 layer/正文；设 participates_in_ai=0 + archived。必须 reason；canon 另需 confirmCanonEdit=true。

职责边界：
- 适合写入 canon/reference/rules 类作者设定、世界规则、平台规则与作者备注。
- Canon 不能硬删或降级 layer；错误 canon 用 retire，不要试图改 layer 绕过。
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
    name: "memory.list",
    description: "Narrative Memory 管理层只读工具。列出指定书籍下的 facts/events/retrieval logs/context vectors 摘要；用于审计、清理前盘点，不替代 memory.read 写作召回。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["memory.list"]),
    risk: "read",
    renderer: "narrative-memory.admin",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    visibility: "advanced",
    scope: "novel",
  }),
  sessionTool({
    name: "memory.read_entry",
    description: "Narrative Memory 管理层只读工具。按 kind + id 读取单条 fact/event/log/vector 完整内容；用于精确检查，不替代 memory.read。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["memory.read_entry"]),
    risk: "read",
    renderer: "narrative-memory.admin",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    visibility: "advanced",
    scope: "novel",
  }),
  sessionTool({
    name: "memory.search",
    description: "Narrative Memory 管理层搜索工具。跨 facts/events/logs/vector 元数据搜索关键词，返回命中字段和匹配原因；只读。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["memory.search"]),
    risk: "read",
    renderer: "narrative-memory.admin",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    visibility: "advanced",
    scope: "novel",
  }),
  sessionTool({
    name: "memory.dedup",
    description: "Narrative Memory 管理层去重检查工具。返回重复候选组，不会自动删除；用于清理前审计。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["memory.dedup"]),
    risk: "read",
    renderer: "narrative-memory.admin",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    visibility: "advanced",
    scope: "novel",
  }),
  sessionTool({
    name: "memory.export",
    description: "Narrative Memory 管理层导出工具。以 JSON 结构导出指定书籍 facts/events/retrieval logs/context vector 元数据；只读。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["memory.export"]),
    risk: "read",
    renderer: "narrative-memory.admin",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    visibility: "advanced",
    scope: "novel",
  }),
  sessionTool({
    name: "memory.stats",
    description: "Narrative Memory 管理层统计工具。统计 facts/events/logs/vectors 数量、状态分布、layer/category 分布和重复风险；只读。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["memory.stats"]),
    risk: "read",
    renderer: "narrative-memory.admin",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    visibility: "advanced",
    scope: "novel",
  }),
  sessionTool({
    name: "memory.update",
    description: "Narrative Memory 管理层写工具。受控更新单条 fact/event；拒绝修改 log/vector；必须提供 reason。不要用于写作前召回。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["memory.update"]),
    risk: "confirmed-write",
    renderer: "narrative-memory.admin",
    enabledForModes: WRITE_SESSION_PERMISSION_MODES,
    visibility: "advanced",
    scope: "novel",
  }),
  sessionTool({
    name: "memory.delete",
    description: "Narrative Memory 管理层删除工具。受控硬删除单条 fact/event；拒绝删除 log/vector；必须提供 reason。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["memory.delete"]),
    risk: "confirmed-write",
    renderer: "narrative-memory.admin",
    enabledForModes: WRITE_SESSION_PERMISSION_MODES,
    visibility: "advanced",
    scope: "novel",
  }),
  sessionTool({
    name: "memory.bulk_approve",
    description: "Narrative Memory 管理层批量审批工具。仅批量批准 pending events，并写入 Narrative Memory facts；返回成功/失败/跳过明细。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["memory.bulk_approve"]),
    risk: "confirmed-write",
    renderer: "narrative-memory.admin",
    enabledForModes: WRITE_SESSION_PERMISSION_MODES,
    visibility: "advanced",
    scope: "novel",
  }),
  sessionTool({
    name: "memory.bulk_delete",
    description: "Narrative Memory 管理层批量删除工具。仅允许对显式筛选的 facts/events 硬删除；必须提供 filter 与 reason，禁止无条件全删。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["memory.bulk_delete"]),
    risk: "confirmed-write",
    renderer: "narrative-memory.admin",
    enabledForModes: WRITE_SESSION_PERMISSION_MODES,
    visibility: "advanced",
    scope: "novel",
  }),
  sessionTool({
    name: "jingwei.audit",
    description: "经纬审计门禁。检查静态设定条目是否满足 active + confirmed + participates_in_ai 的 AI 读取门禁，并报告 draft、needs-review、archived、分区禁用或条目禁用等问题。只读，不会修改经纬。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["jingwei.audit"]),
    risk: "read",
    renderer: "jingwei.audit",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    visibility: "advanced",
    scope: "novel",
  }),
  sessionTool({
    name: "jingwei.write",
    description: `兼容别名（= lore.write）。经纬静态设定写入工具，用于管理作者显式维护、可审阅的静态设定。

action=create：创建新条目。必须传入 title、category、contentMd。
action=update：更新已有条目（传 entryId 或 title 匹配）。
action=delete：删除非 canon 条目。
action=retire：退役错误/过期条目（含 canon）。不改 layer、不改正文；设 participates_in_ai=0 并 archived 软删。必须 reason；canon 另需 confirmCanonEdit=true。

边界：
- 只写入静态设定、世界规则、平台规则、作者备注等 Lore 内容。
- 写入 canon 或 rules 类设定时必须提供 reason，并提供 source 或 evidence。
- Canon 不能硬删或降级 layer；错误 canon 请 retire，不要试图改 layer 绕过。
- 动态事实不得直接写入 Lore；章节后抽取事实、关系变化、伏笔推进、Pending NarrativeEvents 请使用 memory.events / Narrative Memory 流程。
- 不要把诊断结果、市场材料、工具临时输出直接写入 Lore canon。

兼容说明：jingwei.* 与 lore.* 等价；经纬是产品名，lore 是后端工具名。`,
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["jingwei.write"]),
    risk: "draft-write",
    renderer: "jingwei.write",
    enabledForModes: WRITE_SESSION_PERMISSION_MODES,
    visibility: "advanced",
    scope: "novel",
  }),
  sessionTool({
    name: "scene.spec",
    description: "生成结构化写作蓝图（Scene Spec）。这是调用 pipeline.write 的硬前置条件——没有蓝图 pipeline.write 会报错。\n\n使用流程：\n1. 必须先 write.preflight；blockers 非空禁止调用本工具\n2. 用 preflight.resolvedDirective（或用户确认后的一句指示）作为 userDirectives\n3. 可选：lore.read(scope=brief) 静态设定、memory.read 动态记忆\n4. 再调用 scene.spec 生成蓝图\n\n硬约束：\n- userDirectives 必须是一句明确本章目标（≥8 字），禁止塞写作理论/文风大道理\n- 仅有 focus 默认句时需 acceptFocusDefault=true 或补用户句\n- 已有正式章但近章记忆空时会 context-not-ready\n\n不要用的时候：\n- 用户没有要求写章节时\n- preflight 未通过时\n\n注意：软门（文风/去 AI）留在写后 audit/revise；pipeline.write 成功后自动章后结算。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["scene.spec"]),
    risk: "read",
    renderer: "scene.spec",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "jingwei.read",
    description: `兼容别名（= lore.read）。经纬静态设定读取工具。

scope=brief：返回作者显式维护的核心静态设定包 + 分类目录。
scope=category：按分类读取详细静态设定条目。
scope=search：关键词搜索静态设定。

默认过滤：archived、draft、needs-review、participates_in_ai=0 或等价非活跃条目不会作为 Agent 可读经纬返回。

使用时机：
- 用户说"看经纬"/"看设定"/"看世界模型" → scope=brief
- 写作前读取静态设定 → lore.read 或 jingwei.read
- 查找特定设定 → scope=search

不要用的时候：
- 不要用经纬读取动态叙事记忆；动态请用 memory.read / memory.graph / memory.events。`,
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["jingwei.read"]),
    risk: "read",
    renderer: "jingwei.read",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    visibility: "advanced",
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
/** Studio compatibility export; the portable catalog above remains authoritative. */
export const NOVEL_SESSION_TOOL_DEFINITIONS: readonly NovelSessionToolDefinition[] = NOVEL_RUNTIME_TOOL_CATALOG;

export const NOVEL_TOOL_NAMES: readonly string[] = NOVEL_RUNTIME_TOOL_CATALOG.map((t) => t.name);

/**
 * 小说 Agent 角色预设 — 与 AGENT_ROLES 保持一致
 */
export const NOVEL_AGENT_PRESETS: Record<string, { enable: string[]; disable: string[] }> = {
  novelist: {
    enable: ["Bash", "Read", "Write", "Edit", "Grep", "Glob", "EnterWorktree", "ExitWorktree", "TaskCreate", "Terminal", "Browser", "Recall", "ShareFile"],
    disable: [],
  },
};
