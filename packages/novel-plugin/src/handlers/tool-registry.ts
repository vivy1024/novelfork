/**
 * Novel-domain session tool definitions (25 streamlined tools).
 *
 * Architecture: inputSchema definitions live in packages/novel-plugin/src/tool-schemas.ts
 * (the single source of truth). This file adds session-specific metadata (risk, renderer,
 * enabledForModes, visibility) that only the studio/product runtime needs.
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
  // 核心写章与章节（8）
  "book.overview",
  "chapter.preflight",
  "chapter.blueprint",
  "chapter.commit",
  "chapter.list",
  "chapter.audit",
  "chapter.propose_selection",
  "chapter.discard_range",
  // 经纬与大纲（4）
  "jingwei.read",
  "jingwei.write",
  "hooks.manage",
  "outline.volume",
  // 叙事记忆（5）
  "memory.read",
  "memory.search",
  "memory.graph",
  "memory.events",
  "memory.settle",
  // 专项与工作流（8）
  "character.inspect",
  "style.manage",
  "mechanism.distill",
  "book.import",
  "market.radar",
  "skills.manage",
  "workflow.step",
  "workflow.manage",
] as const;

const READY_RUNTIME_TOOL_NAMES = new Set<string>(NOVEL_READY_RUNTIME_TOOL_NAMES);
const ALL_SESSION_PERMISSION_MODES: readonly NovelSessionPermissionMode[] = ["ask", "edit", "allow", "read", "plan"];
const WRITE_SESSION_PERMISSION_MODES: readonly NovelSessionPermissionMode[] = ["ask", "edit", "allow"];

function toJsonObjectSchema(schema: ToolInputSchema): ToolInputSchema {
  return schema;
}

const RISK_RANK: Readonly<Record<NovelRuntimeToolRisk, number>> = { read: 0, "draft-write": 1, "confirmed-write": 2, destructive: 3 };

function maxRisk(risks: readonly NovelRuntimeToolRisk[]): NovelRuntimeToolRisk {
  return risks.reduce<NovelRuntimeToolRisk>((highest, risk) => (RISK_RANK[risk] > RISK_RANK[highest] ? risk : highest), "read");
}

function normalizedAction(input?: Record<string, unknown>): string {
  return typeof input?.action === "string" ? input.action.trim().toLowerCase() : "";
}

function jingweiWriteTargetsCanon(item: Record<string, unknown>): boolean {
  if (item.layer === "canon") return true;
  if (item.layer === "dynamic" || item.layer === "reference") return false;
  const category = typeof item.category === "string" ? item.category.trim() : "";
  if (!category || category === "setting") return true;
  return getCategoryDefaultLayer(category) === "canon";
}

const JINGWEI_WRITE_MAX_ENTRY_DEPTH = 4;

/**
 * jingwei.write 按动作与层级判定风险：
 * - relate / progress / propose / propose_storyline / stagingDecision=reject → draft-write
 * - delete / retire / stagingDecision=promote / confirmCanonEdit / 目标为 canon → confirmed-write
 * - 批量 entries[] 取各项最高风险
 */
function resolveJingweiWriteRisk(input: Record<string, unknown> | undefined, depth = 0): NovelRuntimeToolRisk {
  if (depth > JINGWEI_WRITE_MAX_ENTRY_DEPTH) return "confirmed-write";
  const item = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const action = normalizedAction(item);
  if (action === "relate" || action === "progress" || action === "propose" || action === "propose_storyline") {
    return "draft-write";
  }
  if (Array.isArray(item.entries) && item.entries.length > 0) {
    return maxRisk(item.entries.map((entry) => resolveJingweiWriteRisk(entry as Record<string, unknown>, depth + 1)));
  }
  if (item.stagingDecision === "reject" && typeof item.stagingId === "string" && item.stagingId.trim()) return "draft-write";
  if (action === "delete" || action === "retire") return "confirmed-write";
  if (item.stagingDecision === "promote") return "confirmed-write";
  if (item.confirmCanonEdit === true) return "confirmed-write";
  if (jingweiWriteTargetsCanon(item)) return "confirmed-write";
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
 * 25 个小说领域工具定义
 */
export const NOVEL_RUNTIME_TOOL_CATALOG: readonly NovelRuntimeToolCatalogEntry[] = [
  // ─── 1. 核心写章与章节（8） ───────────────────────────────────────────────
  sessionTool({
    name: "book.overview",
    description:
      "全书概览：一次读取当前书籍总章数、字数、当前卷、未兑现伏笔、最近正式章节摘要与健康度。何时用：会话开始、作者问进度或写前摸底。只读，无业务参数。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["book.overview"]!),
    risk: "read",
    renderer: "cockpit.snapshot",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "chapter.preflight",
    description:
      "写新章第一步：检查就绪条件，返回目标章节路径（targetChapterPath）与写前召回包（recall.text）。没做本章预检，chapter.commit 会以 recall-required 拒存（30 分钟有效）。ok=false 立即停写并转述 blockers；needsUserConfirm=true 时先向作者确认本章目标或传 acceptFocusDefault=true；writingSkillConstraints 中 severity=error 条目在提交时逐条校验。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["chapter.preflight"]!),
    risk: "read",
    renderer: "write.preflight",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "chapter.blueprint",
    description:
      "校验并缓存结构化写作蓝图（Scene Spec），写正文前必调。返回 planMarkdown 后须用 EnterPlanMode + ExitPlanMode（inline_plan）呈给作者审批修改，通过后再写正文。userDirectives 须≥8 字明确目标。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["chapter.blueprint"]!),
    risk: "read",
    renderer: "scene.spec",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "chapter.commit",
    description:
      "章节入库结算：当你用原生 Write/Edit 将章节正文写到目标章节文件后，调用本工具完成长度与技能合规校验、确定性审计、正式索引入库并自动发起 memory.settle。\n- mode=new（默认）：写新章入库，自动复用已缓存的 chapter.blueprint 蓝图与 chapter.preflight 召回。\n- mode=revision：已有章节改稿后更新索引、刷新审计并重新结算。\n返回 settlementError 时正文已保存，由你直接重试 memory.settle。拒存码（recall-required / context-not-ready / high-risk-pending / beat-budget-invalid / length-out-of-range / writing-skill-compliance-failed）须按说明修好重交。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["chapter.commit"]!),
    risk: "confirmed-write",
    renderer: "pipeline.chapter-result",
    enabledForModes: WRITE_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "chapter.list",
    description: "列出全书所有章节的序号、标题、相对文件路径（path）、字数与状态。读/改章节正文直接用原生 Read / Edit / Write 操作对应路径。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["chapter.list"]!),
    risk: "read",
    renderer: "chapter.list",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "chapter.audit",
    description:
      "章节质量与投稿自检（只读，不改正文）：\n- mode=quality（默认）：审计单章节奏、AI 味、伏笔到期、连续性、经纬设定一致与视角（不传 content 自动读已保存章节）。\n- mode=publish：投稿前敏感词、AI 味、完整性与平台适配风险自检。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["chapter.audit"]!),
    risk: "read",
    renderer: "chapter.audit",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "chapter.propose_selection",
    description:
      "向写作台返回划词选区候选文本（不写文件）。requestId、from/to、sourceText 必须沿用作者划词指令原值，作者在编辑器确认后才应用。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["chapter.propose_selection"]!),
    risk: "draft-write",
    renderer: "chapter.selection-candidate",
    enabledForModes: WRITE_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "chapter.discard_range",
    description:
      "整段作废试写章节：从正史归档范围内章节并清除章域叙事记忆，按策略重置伏笔。须传 confirm=true；不可逆清理记忆，不动 canon 静态设定。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["chapter.discard_range"]!),
    risk: "destructive",
    renderer: "chapter.discard_range",
    enabledForModes: WRITE_SESSION_PERMISSION_MODES,
    visibility: "advanced",
    scope: "novel",
  }),

  // ─── 2. 经纬与大纲（4） ───────────────────────────────────────────────────
  sessionTool({
    name: "jingwei.read",
    description:
      "经纬静态设定读取（只读）：读取作者维护的角色、世界观、势力、规则、物品等静态设定。\n- scope=brief（默认）：核心包+分类目录\n- scope=category：按分类分页读\n- scope=search：关键词搜索\n- scope=audit：诊断设定条目是否满足启用门禁。动态剧情记忆请用 memory.read。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["jingwei.read"]!),
    risk: "read",
    renderer: "jingwei.read",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "jingwei.write",
    description:
      "经纬写入与剧情结构推进：\n- action=create/update/delete/retire：维护静态设定（canon/rules 须传 reason + source/evidence；错误 canon 用 retire 不硬删；可传 entries[] 批量写入）。\n- action=relate：记录角色/势力动态关系变化（进待审）。\n- action=progress：推进动态分类字段并留演变台账。\n- action=propose：提交字段修改候选给作者确认。\n- action=propose_storyline：提交剧情线归纳草稿（待审）。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["jingwei.write"]!),
    risk: "draft-write",
    resolveRisk: (input) => resolveJingweiWriteRisk(input),
    renderer: "jingwei.write",
    enabledForModes: WRITE_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "hooks.manage",
    description: "伏笔管理（plant 埋设 | payoff 兑现 | check_due 查到期 | list 列出 | delete 删除）。伏笔之外的动态字段推进用 jingwei.write(action=progress)。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["hooks.manage"]!),
    risk: "confirmed-write",
    resolveRisk: (input) => {
      const action = normalizedAction(input);
      return action === "list" || action === "check_due" ? "read" : "confirmed-write";
    },
    renderer: "hooks.manage",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "outline.volume",
    description:
      "卷级大纲与终局储备管理：action=get（默认，读卷纲）| suggest（按规则出草案不落盘）| set（落盘卷纲与底牌储备）。当前卷目标自动注入写前预检与蓝图。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["outline.volume"]!),
    risk: "confirmed-write",
    resolveRisk: (input) => {
      const action = normalizedAction(input);
      return action === "suggest" ? "draft-write" : action === "set" ? "confirmed-write" : "read";
    },
    renderer: "outline.volume",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),

  // ─── 3. 叙事记忆（5） ─────────────────────────────────────────────────────
  sessionTool({
    name: "memory.read",
    description:
      "动态叙事记忆召回（只读）：按通道补看近章事实、角色状态、关系、时间线与伏笔。写新章仍须先调 chapter.preflight，本工具不替代写前预检。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["memory.read"]!),
    risk: "read",
    renderer: "narrative-memory.read",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "memory.search",
    description:
      "叙事记忆与正文检索（只读）：\n- mode=facts（默认）：关键词搜索事实与事件\n- mode=text：按关键词搜章节正文旧细节（返回章号与命中片段，看上下文用原生 Read）\n- mode=list：按状态/章节范围盘点记忆清单。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["memory.search"]!),
    risk: "read",
    renderer: "narrative-memory.admin",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "memory.graph",
    description: "动态叙事图谱（只读）：查看 relationship / timeline / character_arc / foreshadowing / conflict / event_chain / wave 视图。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["memory.graph"]!),
    risk: "read",
    renderer: "narrative-memory.graph",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "memory.events",
    description:
      "叙事事件队列管理：action=list 列出待确认事件 | create 记录事件（可传 events[] 批量）| approve/reject 审批单条 | bulk_approve 批量批准。pending 事件不等于已确认记忆，更不得直接改 canon。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["memory.events"]!),
    risk: "draft-write",
    resolveRisk: (input) => {
      const action = normalizedAction(input);
      if (action === "list") return "read";
      if (action === "approve" || action === "reject" || action === "bulk_approve") return "confirmed-write";
      return "draft-write";
    },
    renderer: "narrative-memory.events",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "memory.settle",
    description:
      "章后叙事记忆结算：只从已落盘正文抽取叙事事件（低风险自动应用，高风险入待确认）。\n- 传 chapterNumber（或 action=chapter）：单章结算，用于 chapter.commit 结算失败重试或改稿重结。\n- 传 fromChapter+toChapter（或 action=range）：批量回填历史章节记忆空洞。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["memory.settle"]!),
    risk: "confirmed-write",
    renderer: "narrative-memory.admin",
    enabledForModes: WRITE_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),

  // ─── 4. 专项与工作流（8） ─────────────────────────────────────────────────
  sessionTool({
    name: "character.inspect",
    description:
      "角色深度核查与声线管理：\n- action=consistency：查角色在章节范围内的出场与语境\n- action=arc_status / arc_sync：查角色弧线停滞或按章同步 beats\n- action=voice_read / voice_draft：读角色声线约束或生成待审声线草稿（草稿须作者确认才生效）。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["character.inspect"]!),
    risk: "read",
    resolveRisk: (input) => {
      const action = normalizedAction(input);
      return action === "arc_sync" || action === "voice_draft" ? "draft-write" : "read";
    },
    renderer: "character.consistency",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "style.manage",
    description:
      "文风蒸馏与约束管理：action=index（列参考文件/大文件机械索引）| preview（预览切章与估算）| start（分批抽待审规则或 jobId 续跑）| status（读进度与推荐规则）| adopt（采纳作者点名确认的规则/范文）| consolidate（规则瘦身归约）| negative_override（置顶作者口头负反馈硬约束）。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["style.manage"]!),
    risk: "draft-write",
    resolveRisk: (input) => {
      const action = normalizedAction(input);
      if (action === "index" || action === "preview" || action === "status") return "read";
      if (action === "start") return "draft-write";
      return "confirmed-write";
    },
    renderer: "generic",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "mechanism.distill",
    description:
      "中观拆书机制卡管理（extract | list | update | delete | recall）：剥离原著专名提炼可迁移剧情机制，仅供大纲与细纲规划参考，不混入正文文风。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["mechanism.distill"]!),
    risk: "confirmed-write",
    resolveRisk: (input) => {
      const action = normalizedAction(input);
      if (action === "list" || action === "recall") return "read";
      if (action === "extract") return "draft-write";
      return "confirmed-write";
    },
    renderer: "generic",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "book.import",
    description:
      "旧书导入与拆书：\n- action=import_chapters：切章导入 .txt/.md 文本或书根内相对路径 filePath（默认 autoSettle 与 extractBrief）。\n- action=dissect：按目的（写后续/同人/改编/AI漫剧剧本）拆解已有正文抽取经纬草稿（apply=true 写草稿，settle=true 结算记忆）。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["book.import"]!),
    risk: "confirmed-write",
    resolveRisk: (input) => {
      const action = normalizedAction(input);
      if (action === "dissect") {
        return input?.apply === true || input?.settle === true ? "draft-write" : "read";
      }
      return "confirmed-write";
    },
    renderer: "book.dissect",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "market.radar",
    description:
      "网文市场榜单与样章分析（与当前书无关，严禁将榜单材料写入经纬）：action=ranks（查榜单清单）| scan（扫公开榜单存快照）| query（查历史快照与题材分析）| sample（采样番茄公开免费章节结构指标，不入库）。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["market.radar"]!),
    risk: "read",
    renderer: "market.query",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    scope: "universal",
  }),
  sessionTool({
    name: "skills.manage",
    description: "写作技能管理（只读）：action=recommend（按建书答案推荐写作技能）| check_compliance（按已启用技能校验章节正文合规项）。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["skills.manage"]!),
    risk: "read",
    renderer: "writing-skills.compliance",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "workflow.step",
    description:
      "创作工作流工序执行：action=current（读当前工序简报与运行版本号，无运行时返回 none）| submit（提交当前工序产物 kind+payload，等作者确认时立即停写）| blocker（报告工序受阻 what/why/suggestion）。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["workflow.step"]!),
    risk: "draft-write",
    resolveRisk: (input) => {
      const action = normalizedAction(input);
      return action === "submit" ? "draft-write" : "read";
    },
    renderer: "workflow",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "workflow.manage",
    description:
      "创作工作流方案管理：action=list（列方案）| get（读方案结构与版本号）| edit（用 ops 指令新建或修改草稿，已发布方案须 copyFrom 另建草稿）| start（在指定章节启动已发布方案）。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["workflow.manage"]!),
    risk: "draft-write",
    resolveRisk: (input) => {
      const action = normalizedAction(input);
      return action === "list" || action === "get" ? "read" : "draft-write";
    },
    renderer: "workflow",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
] as const;

/**
 * 小说工具权限策略查询 — 供 novel-plugin 与 product-runtime 引用
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
