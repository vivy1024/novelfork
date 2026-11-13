/**
 * Novel-domain session tool definitions.
 *
 * Architecture: inputSchema definitions live in packages/novel-plugin/src/tool-schemas.ts
 * (the single source of truth). This file adds session-specific metadata (risk, renderer,
 * enabledForModes, visibility) that only the studio runtime needs.
 */
import { NOVEL_TOOL_SCHEMAS } from "../tool-schemas.js";
import type { ToolInputSchema } from "../tool-schemas.js";
import { getCategoryDefaultLayer } from "../engine/jingwei/unified-categories.js";

/** Portable equivalents of Studio's session-tool contracts. Keep this catalog Studio-free. */
export type NovelRuntimeToolRisk = "read" | "draft-write" | "confirmed-write" | "destructive";
export type NovelSessionPermissionMode = "ask" | "edit" | "allow" | "read" | "plan";
export type NovelSessionToolVisibility = "author" | "advanced";
export type NovelSessionToolScope = "universal" | "novel" | "all";
export type NovelRuntimeStatus = "ready" | "unavailable";

export interface NovelToolPermissionPolicy {
  readonly risk: NovelRuntimeToolRisk;
  readonly enabledForModes: readonly NovelSessionPermissionMode[];
  readonly visibility: NovelSessionToolVisibility;
  readonly resolveRisk?: (input?: Record<string, unknown>) => NovelRuntimeToolRisk;
}

export interface NovelSessionToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: ToolInputSchema;
  readonly risk: NovelRuntimeToolRisk;
  readonly renderer: string;
  readonly enabledForModes: readonly NovelSessionPermissionMode[];
  readonly visibility: NovelSessionToolVisibility;
  readonly resolveRisk?: (input?: Record<string, unknown>) => NovelRuntimeToolRisk;
  readonly scope?: NovelSessionToolScope;
}

export interface NovelRuntimeToolCatalogEntry extends NovelSessionToolDefinition {
  /** Whether this tool can be safely contributed to the portable Runtime today. */
  readonly runtimeStatus: NovelRuntimeStatus;
}

export const NOVEL_READY_RUNTIME_TOOL_NAMES = [
  "cockpit.snapshot",
  "write.preflight",
  "memory.read_line",
  "memory.propose_change",
  "memory.approve_change",
  "chapter.read",
  "chapter.write",
  "chapter.list",
  "chapter.discard_range",
  "chapter.audit",
  "chapter.propose_selection",
  "chapter.propose_revision",
  "lore.propose_update",
  "rewrite.apply",
  "pipeline.import_chapters",
  "book.dissect",
  "style.distill_index",
  "style.distill_preview",
  "style.distill_start",
  "style.distill_status",
  "style.distill_adopt",
  "outline.volume",
  "arc.character",
  "publish.check",
  "character.check_consistency",
  "character.voice.read",
  "character.voice.draft",
  "hooks.manage",
  "skills.recommend",
  "skills.check_compliance",
  "skills.import_legacy",
  "pipeline.write",
  "lore.read",
  "lore.write",
  "lore.relate",
  "lore.progress",
  "storyline.propose",
  "memory.read",
  "memory.graph",
  "memory.events",
  "memory.list",
  "memory.read_entry",
  "memory.search",
  "memory.search_text",
  "memory.dedup",
  "memory.export",
  "memory.stats",
  "memory.settle_range",
  "memory.settle_chapter",
  "memory.update",
  "memory.delete",
  "memory.bulk_approve",
  "memory.bulk_delete",
  "jingwei.audit",
  "resource.manage",
  "scene.spec",
  "market.scan",
  "market.query",
  "market.ranks",
  "market.sample_public_chapters",
  "workflow.get_current_step",
  "workflow.submit_step_output",
  "workflow.report_blocker",
  "workflow.list_recipes",
  "workflow.get_recipe",
  "workflow.edit_recipe",
  "workflow.start_run",
] as const;

const READY_RUNTIME_TOOL_NAMES = new Set<string>(NOVEL_READY_RUNTIME_TOOL_NAMES);
const ALL_SESSION_PERMISSION_MODES: readonly NovelSessionPermissionMode[] = ["ask", "edit", "allow", "read", "plan"];
const WRITE_SESSION_PERMISSION_MODES: readonly NovelSessionPermissionMode[] = ["ask", "edit", "allow"];

/** Preserve the Studio-compatible object-schema shape without importing Studio. */
function toJsonObjectSchema(schema: ToolInputSchema): ToolInputSchema {
  return schema;
}

// ─── 按输入判定风险（T-05a） ────────────────────────────────────────────────
// resolveRisk 必须与 handler 实际怎么解析输入保持一致：handler 会执行的写动作，
// 风险判定不能因为字段位置、大小写或缺省值不同而判低。

const RISK_RANK: Readonly<Record<NovelRuntimeToolRisk, number>> = { read: 0, "draft-write": 1, "confirmed-write": 2, destructive: 3 };

function maxRisk(risks: readonly NovelRuntimeToolRisk[]): NovelRuntimeToolRisk {
  return risks.reduce<NovelRuntimeToolRisk>((highest, risk) => (RISK_RANK[risk] > RISK_RANK[highest] ? risk : highest), "read");
}

/** 与 outline-volume / arc-character 的 parseAction 同口径：先 trim 再转小写。 */
function normalizedAction(input?: Record<string, unknown>): string {
  return typeof input?.action === "string" ? input.action.trim().toLowerCase() : "";
}

/**
 * lore.write 单条写入是否落 canon 层。与 jingwei-write-handler 的层级解析同口径：
 * 显式 layer 只认三个小写取值；未显式给出时 handler 按分类的 defaultLayer 落盘，
 * 分类缺省或为 "setting" 时 handler 按标题/正文推断分类，可能落到 canon 分类，按 canon 计（宁可多确认一次）。
 */
function loreWriteTargetsCanon(item: Record<string, unknown>): boolean {
  if (item.layer === "canon") return true;
  if (item.layer === "dynamic" || item.layer === "reference") return false;
  const category = typeof item.category === "string" ? item.category.trim() : "";
  if (!category || category === "setting") return true;
  return getCategoryDefaultLayer(category) === "canon";
}

/** handler 对 entries[] 逐项递归执行；超过这个嵌套深度直接按 confirmed-write 处理，不再展开。 */
const LORE_WRITE_MAX_ENTRY_DEPTH = 4;

/**
 * lore.write 风险：handler 收到非空 entries[] 时忽略顶层单条字段、逐项（可再嵌套）执行，
 * 所以批量调用取各项最高风险；任何一项是 delete/retire、canon 写入或覆盖、拆书候选晋升，都升到 confirmed-write。
 */
function resolveLoreWriteRisk(input: Record<string, unknown> | undefined, depth = 0): NovelRuntimeToolRisk {
  if (depth > LORE_WRITE_MAX_ENTRY_DEPTH) return "confirmed-write";
  const item = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  if (Array.isArray(item.entries) && item.entries.length > 0) {
    return maxRisk(item.entries.map((entry) => resolveLoreWriteRisk(entry as Record<string, unknown>, depth + 1)));
  }
  // 带 stagingId 的拒绝：handler 在任何正式写入之前就只把候选标为 rejected 并返回，不进正式经纬。
  if (item.stagingDecision === "reject" && typeof item.stagingId === "string" && item.stagingId.trim()) return "draft-write";
  if (item.action === "delete" || item.action === "retire") return "confirmed-write";
  if (item.stagingDecision === "promote") return "confirmed-write";
  if (item.confirmCanonEdit === true) return "confirmed-write";
  if (loreWriteTargetsCanon(item)) return "confirmed-write";
  return "draft-write";
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
      "驾驶舱全景快照——一次性读取当前书籍的完整状态概览。\n\n返回内容：\n- progress：总章数、总字数、最近更新章节\n- hooks：所有未兑现伏笔（含到期章节）\n- chapters：最近正式章节与章节结果\n- health：书籍健康度评分\n- recentChapters：最近 5 章摘要\n\n使用时机：\n- 每次写作会话开始时首先调用，建立全局认知\n- 用户说「继续写」/「下一章」时先调用确认当前进度\n- 用户问「进度怎么样」/「写到哪了」/「伏笔状态」\n- 准备写下一章前的第一步\n- 与 chapter.list 的区别：cockpit 是概览（含伏笔/健康度），chapter.list 是纯章节列表\n\n不要用的时候：\n- 刚调用过且结果还在上下文中（除非被折叠提示了）\n\nNUG/Kiro 调用参数：必须传入 `confirm: true`；当前书籍身份由宿主可信绑定注入，禁止传 `bookId`。\n\n参数：本工具没有业务参数，除上面的 `confirm` 外不要传任何字段（包括 `reason`、`purpose`、`chapterNumber` 等说明或筛选字段）；多传的字段会被严格校验拒绝，调用直接失败。\n\n注意：此工具只读不写，开销约 1000-3000 tokens，可放心频繁调用。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["cockpit.snapshot"]),
    risk: "read",
    renderer: "cockpit.snapshot",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "write.preflight",
    description:
      "写新章第一步：检查能不能写，并返回本章写前召回包（recall.text，后面生成正文以它为前情）。何时用：用户说写下一章、继续写；生成任何新正文之前（没对本章 preflight，pipeline.write 会以 recall-required 拒写；召回 30 分钟内有效）。何时别用：只是查设定或进度（用 cockpit.snapshot / lore.read）；写完后的审修。返回 ok=false 就停写，把 blockers 转述给作者；high-risk-pending 按系统提示的放行流程处理。needsUserConfirm=true 时，请作者确认一句本章指示，或传 acceptFocusDefault=true；resolvedDirective 可作为 scene.spec 的 userDirectives。writingSkillConstraints 里 severity=error 的条目，保存时会逐条校验。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["write.preflight"]),
    risk: "read",
    renderer: "write.preflight",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "memory.settle_range",
    description:
      "对历史章节批量补结算叙事记忆（事实抽取、状态回写），填补漏结算的空洞（例如 1–10 章）。按章读取已保存正文结算；重复调用不会重复写入。\n\n何时用：write.preflight 报 empty-recent-progress；作者要求回填旧章记忆。\n\n何时别用：要作废的试写章（先 chapter.discard_range）；单章刚写完（pipeline.write 已自动结算，失败时重试 memory.settle_chapter）。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["memory.settle_range"]),
    risk: "confirmed-write",
    renderer: "narrative-memory.admin",
    enabledForModes: WRITE_SESSION_PERMISSION_MODES,
    visibility: "advanced",
    scope: "novel",
  }),
  sessionTool({
    name: "memory.settle_chapter",
    description:
      "单章章后结算：把已保存的一章正文抽成叙事事件，低风险直接应用，高风险进入待确认。只读已保存的正文，读不到就返回 chapter-not-persisted。\n\n何时用：pipeline.write 落盘后由管线自动发起；返回 settlementError 时由你重试本章；改稿改变了剧情事实后重新结算本章。\n\n何时别用：回填多章历史空洞（用 memory.settle_range）；正文还没保存。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["memory.settle_chapter"]),
    risk: "confirmed-write",
    renderer: "narrative-memory.admin",
    enabledForModes: WRITE_SESSION_PERMISSION_MODES,
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
    name: "memory.read_line",
    description: "读取当前书籍的叙事线只读快照，包括节点、边与可计算 warnings。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["memory.read_line"]),
    risk: "read",
    renderer: "narrative.line",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "memory.propose_change",
    description: "生成叙事线变更草案和差异预览，不直接写入正式叙事线。可用 removeNodeIds/removeEdgeIds 提议删除作者节点；派生节点会被告警。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["memory.propose_change"]),
    risk: "draft-write",
    renderer: "narrative.mutationPreview",
    enabledForModes: WRITE_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "memory.approve_change",
    description: "对 memory.propose_change 的预览给出审批结论。approved 才写入叙事线；批准与驳回都会记入审批台账。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["memory.approve_change"]),
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
    description: "整章覆盖一章已存在的正文（按章节序号，只限当前书籍），写入前校验本书硬长度与技能错误项，并请作者批准。何时用：作者要求整章替换已有章节。何时别用：写新章（用 pipeline.write）；只改几段（用 rewrite.apply）。",
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
    description: "审计一章已写好的正文：节奏、AI 味、伏笔到期、连续性、设定一致性、视角。只读，不改正文。何时用：写完或改完一章后自检；作者要求审稿。何时别用：还没写正文（先 pipeline.write）；要改文字（用 rewrite.apply）。不传 content 就读已保存的章节。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["chapter.audit"]),
    risk: "read",
    renderer: "chapter.audit",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "chapter.propose_selection",
    description: "把写作台选区的候选改写交还作者审阅。requestId、from/to 和 sourceText 必须沿用作者划词指令的原值；这里只生成候选卡，不覆盖正文。作者在编辑器中确认后才应用。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["chapter.propose_selection"]),
    risk: "draft-write",
    renderer: "chapter.selection-candidate",
    enabledForModes: WRITE_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "chapter.propose_revision",
    description: "整章或大范围改动的候选：交出改前改后摘要与段落级统计，由作者在叙述者面板的候选卡里逐项核对后才应用。本工具只产候选，不直接改正文；采用时若正文已被改过会拒绝覆盖。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["chapter.propose_revision"]),
    risk: "draft-write",
    renderer: "chapter.revision",
    enabledForModes: WRITE_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "lore.propose_update",
    description: "提出设定条目的字段修改候选：按字段列出改前和改后，由作者在候选卡里逐项确认后才生效。本工具不直接改条目，没列出的字段保持不变。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["lore.propose_update"]),
    risk: "draft-write",
    renderer: "lore.update-proposal",
    enabledForModes: WRITE_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "storyline.propose",
    description: "剧情线归纳草稿。从已结算的叙事事件归纳剧情线时，用它逐条提交草稿（needs-review）：只产草稿，确认/驳回由作者在「故事推进 › 待确认」面板完成，你不能确认自己的草稿。同书同名的待审草稿不会重复创建。relatedEntryTitles 只按经纬条目标题解析关联，解析不出的名字会如实列出、不会建实体。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["storyline.propose"]),
    risk: "draft-write",
    renderer: "storyline.proposal",
    enabledForModes: WRITE_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "rewrite.apply",
    description: "把你改好的文本写回已存在章节的指定行号范围，支持 replace（替换）和 insert_after（行后插入）。何时用：局部改写、审计后修正几段。何时别用：整章替换（用 chapter.write）；作者划词请求（用 chapter.propose_selection）。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["rewrite.apply"]),
    risk: "confirmed-write",
    renderer: "tool.rewrite-apply",
    enabledForModes: WRITE_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "pipeline.import_chapters",
    description: "整书导入工具。接收 .txt/.md 文本 content 或书根内相对路径 filePath（兼容 UTF-8/GB18030），按章节切分追加导入当前书籍。默认 autoSettle=true 自动结算记忆、extractBrief=true 抽取草案并返回 preflight 预检；applyDissectDraft=true 才写草稿文件。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["pipeline.import_chapters"]),
    risk: "confirmed-write",
    renderer: "pipeline.import_chapters",
    enabledForModes: WRITE_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "book.dissect",
    description:
      "按目的拆解已有正文，抽出经纬草稿。purpose：写后续 / 同人 / 改编 / AI漫剧剧本（默认写后续）。\n\n实体（人物、地点、势力、规则）先进拆书候选区，作者确认前不进正式经纬。动态事实（谁在哪、伏笔状态）走 settle，不写进经纬。\n\n默认只返回草案；apply=true 才写入经纬草稿；settle=true 才结算叙事记忆。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["book.dissect"]),
    risk: "draft-write",
    resolveRisk: (input) => input?.apply === true || input?.settle === true ? "draft-write" : "read",
    renderer: "book.dissect",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "style.distill_index",
    description: "列出书根参考文件，或对大文件做零模型机械索引，返回高能章、推荐章 recommendedChapters 与分页概览（offset/limit），供 style.distill_preview 或 style.distill_start 抽样。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["style.distill_index"]),
    risk: "read", renderer: "generic", enabledForModes: ALL_SESSION_PERMISSION_MODES, scope: "novel",
  }),
  sessionTool({
    name: "style.distill_preview",
    description: "预览参考文本或 filePath（支持 chapterList/fromChapter/toChapter）的范围与估算 estimate，不改文风；确认后调 style.distill_start。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["style.distill_preview"]),
    risk: "read", renderer: "generic", enabledForModes: ALL_SESSION_PERMISSION_MODES, scope: "novel",
  }),
  sessionTool({
    name: "style.distill_start",
    description: "按参考文本或 filePath（支持 chapterList 抽样）生成待审文风包，或带 jobId 续跑。先存统计基线，再分批抽取六类规则（带原文证据与迁移判断，默认待审，每次最多 maxBatches 批，retryFailed=true 重试失败批），不自动覆盖预设。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["style.distill_start"]),
    risk: "draft-write", renderer: "generic", enabledForModes: WRITE_SESSION_PERMISSION_MODES, scope: "novel",
  }),
  sessionTool({
    name: "style.distill_status",
    description: "读取文风蒸馏任务的进度、规则、范文与统计指纹。recommendedRuleIds 为可迁移且证据逐字吻合的模型规则，作者同意全部采纳推荐时传给 style.distill_adopt。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["style.distill_status"]),
    risk: "read", renderer: "generic", enabledForModes: ALL_SESSION_PERMISSION_MODES, scope: "novel",
  }),
  sessionTool({
    name: "style.distill_adopt",
    description: "将作者明确点名的规则与范文采纳进本书文风预设（可迁移项进指南，作品专属项仅存证据）。须传 expectedVersion，预设已被改过时返回 409 冲突而不覆盖。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["style.distill_adopt"]),
    risk: "confirmed-write", renderer: "generic", enabledForModes: WRITE_SESSION_PERMISSION_MODES, scope: "novel",
  }),
  sessionTool({
    name: "outline.volume",
    description:
      "卷级大纲（卷纲）管理。\n\naction=get（默认）：读取 volumes 与当前卷；\naction=suggest：按目标章数/卷数按确定性规则生成草案（不落盘）；action=set：落盘 story/volume_outline.json + .md。\n\n用途：长篇中盘防跑偏——当前卷目标会进 write.preflight 与 scene.spec 上下文。\n不写 lore canon。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["outline.volume"]),
    risk: "confirmed-write",
    // handler 的 parseAction 先 trim 再转小写，这里同口径，避免 "SET" 被判成只读。
    resolveRisk: (input) => {
      const action = normalizedAction(input);
      return action === "suggest" ? "draft-write" : action === "set" ? "confirmed-write" : "read";
    },
    renderer: "outline.volume",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "arc.character",
    description:
      "角色弧线工具。\n\naction=status（默认，只读）：列出各角色弧类型、当前阶段、beats 数、最后推进章，并给出弧线不一致/停滞告警；\naction=sync：按确定性规则从指定章正文抽取 beats 并写入角色弧线记录（动态层）。\n\n用途：长篇人物成长线可见与纠偏。不动 canon 设定。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["arc.character"]),
    risk: "confirmed-write",
    // 与 handler 的 parseAction 同口径（trim + 小写）。
    resolveRisk: (input) => {
      const action = normalizedAction(input);
      return action === "sync" || action === "refine" ? "draft-write" : "read";
    },
    renderer: "character.arcs",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "publish.check",
    description:
      "投稿风险自检：汇总本地敏感词线索、AI 味线索、正文完整性与连续性证据，并展示规则来源、版本与可信度。\n\n平台缺省按 book.platform 映射（tomato→番茄、qidian→起点、jjwxc→晋江、qimao→七猫，其余 generic），仅用于选择写作建议。\n\n只读报告：高风险线索/提醒/建议及可定位正文证据。结果不能替代平台审核，也不会阻断 pipeline.write 保存。",
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
    name: "character.voice.read",
    description: "读取角色声线（存于经纬角色条目）：声音定位、句式指纹、认知滤镜、绝不会说的句式、愤怒/紧张/撒谎时的变化。每项带状态（已确认 / 待审 / 待补充）与原文依据，并给出当前会注入写对白的约束文本（只含已确认项）。返回的 expectedVersion 供 character.voice.draft 使用。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["character.voice.read"]),
    risk: "read", renderer: "generic", enabledForModes: ALL_SESSION_PERMISSION_MODES, scope: "novel",
  }),
  sessionTool({
    name: "character.voice.draft",
    description: "从角色卡原句、该角色的对白（作者提供的样本与近章正文）提取声线，写成待审草稿；会话有模型时增补，模型字段必须带能在材料里找到的原文依据，否则丢弃。依据不足的项保持「待补充」，不编造；已确认的项不会被覆盖。草稿不会进入写作约束，必须由作者在角色卡「声线」区块逐项确认——本工具不能确认声线。必须传 character.voice.read 返回的 expectedVersion，角色卡已被改过时返回冲突（409）。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["character.voice.draft"]),
    risk: "draft-write", renderer: "generic", enabledForModes: WRITE_SESSION_PERMISSION_MODES, scope: "novel",
  }),
  sessionTool({
    name: "hooks.manage",
    description: "伏笔管理：埋设、兑现、检查到期、列出、删除。何时用：本章埋下或兑现伏笔；想知道哪些伏笔该推进了（check_due）。何时别用：伏笔以外的动态字段推进（用 lore.progress）。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["hooks.manage"]),
    risk: "confirmed-write",
    resolveRisk: (input) => input?.action === "list" || input?.action === "check_due" ? "read" : "confirmed-write",
    renderer: "hooks.manage",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  // --- Writing Skills 工具组 ---
  // 只读推荐：按本书已落库的建书答案（题材/基调/平台/复杂度/AI 味容忍度）
  // 从内置 Skills 里挑出候选并给出理由。不写 book.json —— 启用由作者在
  // 写作台「技能文风 › 写作技能」里勾选（那里直接写 `.novelfork/skills`）。
  // renderer 显式声明为 "generic"：Studio 侧没有专用卡片，由
  // GenericToolResultRenderer 兜底（registry.tsx 的 resolveToolResultRendererKey
  // 对未登记键同样回落 generic）。推荐结果是扁平的 name+kind+reason 列表，
  // generic 卡片足够；真正需要作者交互的是随后的 AskUserQuestion，那由 Runtime 渲染。
  sessionTool({
    name: "skills.recommend",
    description: "按本书建书答案推荐应启用的 Writing Skills，返回候选与推荐理由。只读，不修改启用状态；确认后由作者在写作台「技能文风」里启用。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["skills.recommend"]),
    risk: "read",
    renderer: "generic",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "skills.check_compliance",
    description: "按当前生效 Writing Skills 中声明的安全检查规则审阅章节正文，返回违规项及 explanation。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["skills.check_compliance"]),
    risk: "read",
    renderer: "writing-skills.compliance",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "skills.import_legacy",
    description: "显式扫描并迁移旧 user_template Preset/Beat 数据为作者目录中的 Writing Skills；不自动覆盖冲突文件。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["skills.import_legacy"]),
    risk: "confirmed-write",
    renderer: "writing-skills.import",
    enabledForModes: WRITE_SESSION_PERMISSION_MODES,
    visibility: "advanced",
    scope: "novel",
  }),
  sessionTool({
    name: "pipeline.write",
    description: "保存新章：接收你写好的完整正文与 scene.spec 蓝图，做校验、确定性审计（含经纬设定核对）并保存为正式章节；工具不生成也不改写正文。\n\n前置：本会话已对本章 write.preflight 且通过；已调用 scene.spec 拿到有效蓝图（会把技能的硬性条目并入 sceneSpec.constraints）。\n\n拒存返回码：\n- recall-required：本章没做写前召回或已超过 30 分钟，回 write.preflight 重新召回\n- chapter-conflict：生成期间这一章被作者改过、删掉或同号章被新建；不覆盖，重新读取这一章再决定\n- context-not-ready：已有正式章但近章记忆为空，先 memory.settle_range 或 chapter.discard_range\n- high-risk-pending：按系统提示的放行流程处理后再写\n- beat-budget-invalid：情节点预算与本章目标不符，回 scene.spec 重排\n- length-out-of-range：长度超出本书硬范围，改好再交\n- writing-skill-compliance-failed：成品违反技能里 severity=error 的条目，改好再交\n\n返回：publishHint.warnings 列出违反的技能要求与可能的设定冲突（只提示，不拒存）；settlementDispatch 是章后结算结果；settlementError 表示正文已保存但结算失败，重试 memory.settle_chapter。\n\n可选：requireFactCheckPass=true 时，审计仍有严重事实/连续性问题就拒存（fact-check-failed）。autoRevise、maxReviseRounds、factCheckAutoRevise、adversarialAudit 为兼容旧调用保留，当前不生效。\n\n何时别用：作者只是在问问题、查设定、讨论方向；preflight 未通过。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["pipeline.write"]),
    risk: "confirmed-write",
    renderer: "pipeline.chapter-result",
    enabledForModes: WRITE_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "lore.read",
    description: "Lore / 经纬静态设定读取工具。只读取作者显式维护的静态设定、规则、资料与备注，不返回完整动态剧情记忆。\n\n职责边界：\n- 适合读取人物设定、地点、势力、规则、物品、术语、作者备注、平台/书籍规则。\n- 默认排除已归档、草稿、待审或设为不参与 AI 的条目。\n- 写作、修订、审计前的动态叙事记忆召回请使用 memory.read。\n- 关系变化、时间线、角色弧线、伏笔状态和 Pending NarrativeEvents 不属于 Lore。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["lore.read"]),
    risk: "read",
    renderer: "jingwei.read",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "lore.write",
    description: "Lore / 经纬静态设定写入工具。用于创建或修改作者可审阅的静态设定。\n\naction=create | update | delete | retire。\n- create/update：写入静态设定；canon/rules 必须 reason + source/evidence。\n- delete：仅非 canon。\n- retire：退役错误/过期条目（含 canon）。不改 layer/正文；归档并设为不参与 AI。必须 reason；canon 另需 confirmCanonEdit=true。\n\n职责边界：\n- 适合写入 canon/reference/rules 类作者设定、世界规则、平台规则与作者备注。\n- Canon 不能硬删或降级 layer；错误 canon 用 retire，不要试图改 layer 绕过。\n- 动态事实、章节后抽取事实、诊断结果、市场材料、Pending NarrativeEvents 不得直接写入 Lore canon。\n- 动态叙事事实应进入 memory.events / Narrative Memory 事件流程。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["lore.write"]),
    risk: "draft-write",
    // T-05a：delete/retire、canon 写入或覆盖（含按分类默认落 canon）、拆书候选晋升升为 confirmed-write；
    // 批量 entries[] 逐项（含嵌套）取最高风险。普通 dynamic/reference 写入保持草稿级。
    resolveRisk: (input) => resolveLoreWriteRisk(input),
    renderer: "jingwei.write",
    enabledForModes: WRITE_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "lore.relate",
    description: `经纬关系写入工具。把剧情中的角色/势力关系变化写进结构化字段，而不是只留在叙事记忆的自然语言里。

与 lore.write 的区别：
- 本工具只写 relationships 分类的动态关系状态（layer=dynamic、status=needs-review，作者确认后生效）。
- 条目以「主体 × 客体」为稳定关联键：同一对关系的多次变化 upsert 同一条，不会每次剧情点新建。
- 不碰 canon 设定；角色人设、世界规则等静态设定仍走 lore.write。

使用时机：
- 本章出现关系变化（结盟/敌对/师徒/情侣/决裂等），写完章或章后结算后落关系。
- 角色间第一次建立关系时也要写（建条目）。

不要用的时候：
- 静态人设/规则写入：用 lore.write。
- 只查询关系现状：用 lore.read。`,
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["lore.relate"]),
    risk: "draft-write",
    renderer: "jingwei.write",
    enabledForModes: WRITE_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "lore.progress",
    description: "经纬字段演变工具。对 dynamic 分类条目做字段级推进（如伏笔 status 由「已埋设」推进为「部分揭示」、冲突阶段变化），每次演变记入字段演变台账（旧值/新值/章号/依据），可完整回溯。\n\n约束：\n- 只允许推进 dynamic 分类条目（outline / relationships / conflicts / foreshadowing / timeline / chapter-summaries）。\n- canon/reference 分类（角色人设、世界规则等）拒绝推进：必须走 lore.write 并注明理由，经作者确认。\n- fieldKey 必须是条目里已有的字段键；新值是本章剧情后的状态。\n\n使用时机：\n- 冲突/时间线/卷纲的状态字段随剧情演变。\n- 需要在结构化字段里留「第 N 章发生了什么变化」的推进痕迹。\n\n不要用的时候：\n- 静态设定修改：用 lore.write。\n- 伏笔的标准埋设/兑现：优先 hooks.manage。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["lore.progress"]),
    risk: "draft-write",
    renderer: "jingwei.write",
    enabledForModes: WRITE_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "memory.read",
    description: "动态叙事记忆召回工具。用于修订、审计、诊断，或写章前按需补看某几个通道，读取 Narrative Memory 的 ContextCards、通道状态、warnings 与 token budget；不要把它当静态 Lore 条目编辑器。\n\n写新章的完整召回由 write.preflight 给出（recall.text）；pipeline.write 只认 write.preflight 记下的写前召回，memory.read 不记录召回，不能代替 write.preflight。",
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
    description: "Pending NarrativeEvents 工具。用于创建、列出、批准或拒绝 Pending NarrativeEvents；approve 会写入 Narrative Memory facts，pending event 不等于 confirmed memory，更不能自动写入 Lore canon。create 可传 events[] 一次写入多条（最多 20）。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["memory.events"]),
    risk: "draft-write",
    // T-05a：approve 会写入 Narrative Memory facts，reject 会结束待定事件；二者按动作升为 confirmed-write。list/create 保持草稿级。
    resolveRisk: (input) => input?.action === "approve" || input?.action === "reject" ? "confirmed-write" : "draft-write",
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
    name: "memory.search_text",
    description: "按关键词搜章节正文，返回命中的章号、带【】高亮的短片段和章内 offset / limit；要看上下文再用 chapter.read 按偏移读。摘要和设定没记下的旧细节（某章的物品、誓言、伤疤）用它找。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["memory.search_text"]),
    risk: "read",
    renderer: "generic",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    visibility: "author",
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
    description: "Narrative Memory 管理层删除工具。受控删除单条 fact/event：event 移入回收站可撤销、同步从结算台账剔除（该章事件删光时台账失效、可重新结算）；fact 物理删除；拒绝删除 log/vector；必须提供 reason。删整章请用 chapter.discard_range，不要用它按章清记忆。",
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
    description: "Narrative Memory 管理层批量删除工具。仅允许对显式筛选的 facts/events 删除，整批一个事务：events 移入回收站可撤销并同步修正结算台账，facts 物理删除；必须提供 filter 与 reason，禁止无条件全删。删整章或一段章节请用 chapter.discard_range（会归档正文并清理全部章域记忆），不要用 chapterRange 批删代替。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["memory.bulk_delete"]),
    risk: "confirmed-write",
    renderer: "narrative-memory.admin",
    enabledForModes: WRITE_SESSION_PERMISSION_MODES,
    visibility: "advanced",
    scope: "novel",
  }),
  sessionTool({
    name: "jingwei.audit",
    description: "经纬审计门禁。检查静态设定条目是否满足 active + confirmed + 参与 AI 的读取门禁，并报告草稿、待审、已归档、分区禁用或条目禁用等问题。只读，不会修改经纬。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["jingwei.audit"]),
    risk: "read",
    renderer: "jingwei.audit",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    visibility: "advanced",
    scope: "novel",
  }),
  sessionTool({
    name: "scene.spec",
    description: "校验你写的结构化本章蓝图（Scene Spec）；pipeline.write 只接受通过校验的蓝图。\n\n流程：先 write.preflight（blockers 非空不调用本工具）→ 用 resolvedDirective 或作者确认的一句指示作为 userDirectives → 需要时用 lore.read(scope=brief) 补静态设定、memory.read 补动态记忆 → 提交蓝图。\n\n硬约束：\n- userDirectives 必须是一句明确的本章目标（≥8 字），不要塞写作理论或文风大道理\n- 只有 focus 默认句时需 acceptFocusDefault=true 或补作者的话\n- 已有正式章但近章记忆空时返回 context-not-ready\n\n何时别用：作者没要求写章；preflight 未通过。文风、去 AI 味等软要求留到写后审修；章后结算由 pipeline.write 自动发起。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["scene.spec"]),
    risk: "read",
    renderer: "scene.spec",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "resource.manage",
    description: "正式章节结果管理。\n\naction=list：列出所有正式章节结果（传 filter 可过滤）\naction=archive：归档正式章节结果（不删除但标记不活跃）\naction=delete：删除正式章节结果（正文移入 chapters/_discarded 留底，该章叙事记忆与结算台账同步清理；连续多章请用 chapter.discard_range）\n\n使用时机：\n- 用户说「删掉这个章节」→ delete 或 archive\n- 用户想看有哪些章节 → list",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["resource.manage"]),
    risk: "confirmed-write",
    resolveRisk: (input) => input?.action === "list" ? "read" : input?.action === "delete" ? "destructive" : "confirmed-write",
    renderer: "resource.manage",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "market.scan",
    description: "扫描起点/番茄公开榜单并落历史快照。纯 HTTP，不登录、不绕验证码、不走 CDP。每平台每次最多 2 个榜单。数据写入 ~/.novelfork/market/snapshots/，与经纬/Lore 分离，禁止把榜单材料写入 lore.write。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["market.scan"]),
    risk: "read",
    renderer: "market.scan",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    scope: "universal",
  }),
  sessionTool({
    name: "market.query",
    description: "查询已落盘的公开榜单历史快照，可选生成题材/标题/字数分析。只读本地快照，不访问经纬或 Narrative Memory。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["market.query"]),
    risk: "read",
    renderer: "market.query",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    scope: "universal",
  }),
  sessionTool({
    name: "market.ranks",
    description: "读取市场研究榜单注册表：内置榜 + 用户自定义榜。只读，不扫网、不改经纬。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["market.ranks"]),
    risk: "read",
    renderer: "market.ranks",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    scope: "universal",
  }),
  sessionTool({
    name: "market.sample_public_chapters",
    description: "采样番茄公开免费章节的结构指标（字数、段落、对话比、问句/叹号、系统/冲突/金手指词）。参数 fanqieBookId 是番茄站公开书籍 ID，不是当前作品。最多 3 章，正文只用于计算后立即丢弃，不入库。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["market.sample_public_chapters"]),
    risk: "read",
    renderer: "market.sample_public_chapters",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    scope: "universal",
  }),
  sessionTool({
    name: "workflow.get_current_step",
    description:
      "读取作者启动的创作工作流当前工序：目标、允许的写入工具、必交产物结构、运行版本号，以及上一次的打回意见或阻塞说明。\n\n使用时机：\n- 系统提示里出现「创作工作流」简报，需要确认最新进度时\n- 提交被拒说版本不一致、或上下文被压缩后忘了进度时\n- 落盘工序需要取回作者批准的正文原文（approvedProse）时\n\n没有进行中的运行时返回 runStatus=none，按作者的普通指令继续即可。只读，可随时调用。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["workflow.get_current_step"]),
    risk: "read",
    renderer: "workflow",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "workflow.submit_step_output",
    description:
      "提交当前工序的产物。产物先进候选区，按类别做确定性校验；需要作者确认的工序会停在等待确认，否则自动进入下一道工序并在返回结果里给出下一道的简报。\n\n规则：\n- kind 必须与当前工序要求一致；runRevision 必须是最新值\n- 蓝图（scene-spec）通过后落成本章场景（待作者审核）；正文（prose）作为已批准版本钉住，落盘工序写入时必须原样使用\n- 返回「等待作者确认」后立即停止产出，不要调用写入工具\n- 校验不通过时按返回的说明修改后重交，不要编造通过",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["workflow.submit_step_output"]),
    risk: "draft-write",
    renderer: "workflow",
    enabledForModes: WRITE_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "workflow.report_blocker",
    description:
      "报告当前工序做不下去（缺关键输入、子代理不存在、工具持续失败等）。必须写清 what / why / action 三段。方案按本工序的失败策略自动重试、跳过或停下等作者处理。不要用它逃避可以完成的工作，也不要在做不到时编造产物。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["workflow.report_blocker"]),
    risk: "read",
    renderer: "workflow",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "workflow.list_recipes",
    description:
      "列出本书的创作工作流方案：id、名称、已发布还是草稿、版本号、工序数与结构问题数。只读。\n\n使用时机：作者让你「用某个工作流写这章」或「帮我设计一个工作流」时，先看有哪些方案可用。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["workflow.list_recipes"]),
    risk: "read",
    renderer: "generic",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "workflow.get_recipe",
    description:
      "读取一个工作流方案的完整结构：节点（起点 / 工序 / 汇合 / 终点）、连线（下一步 / 打回，分支工序的结果条件）与结构问题清单。只读；修改前先用它拿到版本号。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["workflow.get_recipe"]),
    risk: "read",
    renderer: "generic",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "workflow.edit_recipe",
    description:
      "新建或修改工作流草稿：用一批编辑指令（加节点、改节点、删节点、连线、断线、改名称）改图，不要整张重写。\n\n规则：\n- 你建的和改的一律是草稿，作者在「写作 › 工作流」的画布上确认发布后才能运行\n- 已发布的方案不能直接改，用 copyFrom 另建草稿\n- 一批指令里任一条不合法则整批不生效，按返回说明修正后重交\n- 草稿可以暂时有结构问题（返回 issues），但要在交给作者前修好\n- 并行：一道工序连出多条无条件连线；分支：工序声明 outcomes，出线带 outcome；多条分支会合前加汇合节点",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["workflow.edit_recipe"]),
    risk: "draft-write",
    renderer: "generic",
    enabledForModes: WRITE_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "workflow.start_run",
    description:
      "在某一章上启动一个已发布的工作流方案。启动后按返回的工序简报推进（workflow_submit_step_output / workflow_report_blocker）。你已有进行中的运行时不能再启动；草稿不能运行。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["workflow.start_run"]),
    risk: "draft-write",
    renderer: "workflow",
    enabledForModes: WRITE_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
] as const;

/**
 * 小说工具名列表 — 供 novel-plugin manifest 引用
 */
export function getNovelToolPermissionPolicy(toolName: string): NovelToolPermissionPolicy | null {
  const normalized = toolName.replace(/\./g, "_");
  const tool = NOVEL_RUNTIME_TOOL_CATALOG.find((entry) => entry.name === toolName || entry.name.replace(/\./g, "_") === normalized);
  if (!tool) return null;
  return {
    risk: tool.risk,
    enabledForModes: tool.enabledForModes,
    visibility: tool.visibility,
    ...(tool.resolveRisk ? { resolveRisk: tool.resolveRisk } : {}),
  };
}

/** Studio compatibility export; the portable catalog above remains authoritative. */
export const NOVEL_SESSION_TOOL_DEFINITIONS: readonly NovelSessionToolDefinition[] = NOVEL_RUNTIME_TOOL_CATALOG;

export const NOVEL_TOOL_NAMES: readonly string[] = NOVEL_RUNTIME_TOOL_CATALOG.map((t) => t.name);
