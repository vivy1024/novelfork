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
  "skills.read",
  "skills.write",
  "skills.recommend",
  "skills.check_compliance",
  "skills.import_legacy",
  "pipeline.write",
  "lore.read",
  "lore.write",
  "lore.relate",
  "lore.progress",
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
      "写章前硬门预检：组装最小上下文包（currentFocus、近章摘要/事实、本章伏笔、resolvedDirective、memoryHealth），并对缺失输入硬拦截。\n\n使用时机：\n- 写新章前的第一步（先于 scene.spec / pipeline.write）\n- 用户说「继续写」「下一章」时先核验上下文是否就绪\n\n返回：\n- ok=false 时 blockers 含 missing-directive / empty-recent-progress / high-risk-pending / book-not-found，必须停写并报告\n- ok=true 时可用 resolvedDirective 作为 scene.spec 的 userDirectives\n- needsUserConfirm=true：仅有 focus 默认句，需用户确认或 acceptFocusDefault=true\n\nWriting Skills 相关字段是告知，不是门禁：\n- requiredSkillAcknowledgements：本章相关的已启用技能清单。按各自 description 自行判断是否需要读；不读也能写章\n- writingSkillConstraints：这些技能声明的可机器校验条目（与保存前的合规校验同一份判据）。severity=error 的条目若不满足，章节保存时会被 writing-skill-compliance-failed 拒绝\n- warnings 里的 skills-not-acknowledged 只是提醒尚未加载哪些技能，不阻断\n\n不要用的时候：\n- 只是查询设定/进度（用 cockpit.snapshot / lore.read / memory.read）\n- 写后审修（chapter.audit / skills.check_compliance / rewrite.*）\n\n纪律：禁止用写作理论或外部项目总结代替 memory/lore。技能是否生效看成品能否通过 writingSkillConstraints 的逐条校验，不看是否交过引用。",
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
    name: "memory.settle_chapter",
    description:
      "单章章后结算：把刚落盘的一章正文抽成 NarrativeEvents，低风险直接应用，高风险进入待审。\n\n行为：只读取**已落盘**的正式章节正文（读不到就报 chapter-not-persisted 并拒绝结算），因此「先保存正文、再更新记忆」是硬约束而非约定。\n\n使用时机：\n- pipeline.write 保存成功后由管线自动发起，作为写章闭环的正常一步；结果在叙述者面板可见\n- 该次结算失败时重试同一章（结算失败不影响已保存的正文）\n\n不要用的时候：\n- 回填多章历史空洞：用 memory.settle_range\n- 正文尚未保存：先保存章节",
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
    description: "整章正文改动候选（T5.3）。整章或大范围改动必须先走它：交出 before/after 摘要与段落级统计，由作者在叙述者面板候选卡里逐项核对后才应用；本工具只产候选，从不直接改正文。adopt 时服务端按 originalHash 闸门防止覆盖最新正文。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["chapter.propose_revision"]),
    risk: "draft-write",
    renderer: "chapter.revision",
    enabledForModes: WRITE_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "lore.propose_update",
    description: "经纬条目字段改动候选（T5.3）。任何设定字段改动必须先走它：按字段列出 before/after，由作者候选卡逐项核对后才应用（应用走 PUT entries 的 fieldsPatch 合并，其余字段原样保留）；本工具只产候选，从不直接改条目。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["lore.propose_update"]),
    risk: "draft-write",
    renderer: "lore.update-proposal",
    enabledForModes: WRITE_SESSION_PERMISSION_MODES,
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
      "按目的拆解已有正文，抽出经纬草稿。purpose：写后续 / 同人 / 改编 / AI漫剧剧本（默认写后续）。\n\n实体（人物、地点、势力、规则）进 dissection_staging，确认前不进正式经纬。动态事实（谁在哪、伏笔状态）走 settle，不写进经纬。\n\n默认只返回草案；apply=true 才写入经纬草稿；settle=true 才结算叙事记忆。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["book.dissect"]),
    risk: "draft-write",
    resolveRisk: (input) => input?.apply === true || input?.settle === true ? "draft-write" : "read",
    renderer: "book.dissect",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "style.distill_preview",
    description: "预览参考文本的章节范围与可分析覆盖，不保存正文、不修改本书文风。作者确认范围后再使用 style.distill_start。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["style.distill_preview"]),
    risk: "read", renderer: "generic", enabledForModes: ALL_SESSION_PERMISSION_MODES, scope: "novel",
  }),
  sessionTool({
    name: "style.distill_start",
    description: "根据作者提供的参考文本生成可审阅文风来源包，或带 jobId 继续已有任务。先保存确定性基线与统计指纹，再用当前会话模型按章节批次抽取声音、语言、节奏、对话、场景写法与一致性规则；每条带原文证据与可迁移判断，一律待审。每次调用最多处理 maxBatches 批，剩余批次再次调用继续，失败批次带 retryFailed=true 重试。结果不自动启用或覆盖本书文风预设。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["style.distill_start"]),
    risk: "draft-write", renderer: "generic", enabledForModes: WRITE_SESSION_PERMISSION_MODES, scope: "novel",
  }),
  sessionTool({
    name: "style.distill_status",
    description: "读取指定文风蒸馏任务的状态、来源证据、规则、范文和统计指纹。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["style.distill_status"]),
    risk: "read", renderer: "generic", enabledForModes: ALL_SESSION_PERMISSION_MODES, scope: "novel",
  }),
  sessionTool({
    name: "style.distill_adopt",
    description: "把作者在对话中明确确认的文风来源条目采纳进本书文风预设。只写入点名的规则与范文；可迁移条目进入本书文风指南，作品专属条目只保存为来源证据。必须传 style.distill_status 返回的 expectedVersion，预设已被改过时返回冲突（status 409）而不覆盖。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["style.distill_adopt"]),
    risk: "confirmed-write", renderer: "generic", enabledForModes: WRITE_SESSION_PERMISSION_MODES, scope: "novel",
  }),
  sessionTool({
    name: "outline.volume",
    description:
      "卷级大纲（卷纲）管理。\n\naction=get（默认）：读取 volumes 与当前卷；\naction=suggest：按目标章数/卷数按确定性规则生成草案（不落盘）；action=set：落盘 story/volume_outline.json + .md。\n\n用途：长篇中盘防跑偏——当前卷目标会进 write.preflight 与 scene.spec 上下文。\n不写 lore canon。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["outline.volume"]),
    risk: "confirmed-write",
    resolveRisk: (input) => input?.action === "suggest" ? "draft-write" : input?.action === "set" ? "confirmed-write" : "read",
    renderer: "outline.volume",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "arc.character",
    description:
      "角色弧线工具。\n\naction=status（默认，只读）：列出各角色弧类型、当前阶段、beats 数、最后推进章，并给出弧线不一致/停滞告警；\naction=sync：按确定性规则从指定章正文抽取 beats 并写入动态弧线表。\n\n用途：长篇人物成长线可见与纠偏。写入 jingwei_character_arc（dynamic），不动 canon。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["arc.character"]),
    risk: "confirmed-write",
    resolveRisk: (input) => input?.action === "sync" || input?.action === "refine" ? "draft-write" : "read",
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
    description: "伏笔统一管理：埋设、兑现、检查到期、列出所有伏笔。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["hooks.manage"]),
    risk: "confirmed-write",
    resolveRisk: (input) => input?.action === "list" || input?.action === "check_due" ? "read" : "confirmed-write",
    renderer: "hooks.manage",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  // --- Writing Skills 工具组 ---
  sessionTool({
    name: "skills.read",
    description: "读取当前项目的 Writing Skills。scope=enabled 返回 `.novelfork/skills/` 中自动发现的完整正文；scope=available 返回 catalog 与项目文件的合并视图。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["skills.read"]),
    risk: "read",
    renderer: "writing-skills.list",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "skills.write",
    description: "管理当前项目 `.novelfork/skills/` 中的 Writing Skill 文件；项目目录扫描结果是唯一生效来源。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["skills.write"]),
    risk: "confirmed-write",
    renderer: "writing-skills.list",
    enabledForModes: WRITE_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  // 只读推荐：按本书已落库的建书答案（题材/基调/平台/复杂度/AI 味容忍度）
  // 从内置 Skills 里挑出候选并给出理由。不写 book.json —— 启用仍走
  // skills.write，保留 Runtime 权限确认。
  // renderer 显式声明为 "generic"：Studio 侧没有专用卡片，由
  // GenericToolResultRenderer 兜底（registry.tsx 的 resolveToolResultRendererKey
  // 对未登记键同样回落 generic）。推荐结果是扁平的 name+kind+reason 列表，
  // generic 卡片足够；真正需要作者交互的是随后的 AskUserQuestion，那由 Runtime 渲染。
  sessionTool({
    name: "skills.recommend",
    description: "按本书建书答案推荐应启用的 Writing Skills，返回候选与推荐理由。只读，不修改启用状态；确认后请用 skills.write 落库。",
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
    description: "写作管线（v2）：接受 scene.spec 生成的结构化蓝图，执行 Writer→ContinuityAudit→Revise 流程生成章节结果。\n\n使用流程：\n1. 先 write.preflight（blockers 非空禁止继续）；技能清单与 writingSkillConstraints 是参考，不需要为了通过门禁去逐个读技能\n2. 必须先调用 scene.spec 获得有效蓝图（硬前置条件，缺失会报错）；scene.spec 会把技能的硬性条目并入 sceneSpec.constraints\n3. 传入蓝图与正文 → 一致性审计 → 定点修订\n4. 正文落盘成功后自动发起一次 memory.settle_chapter 结算（面板可见的独立工具调用）\n\n硬门：\n- 已有正式章但近章记忆/摘要为空 → context-not-ready（先 memory.settle_range 或 chapter.discard_range）\n- 情节点预算不合规（合计低于/高于书籍章目标）→ beat-budget-invalid（回 scene.spec 重排预算，不要硬写）\n- 保存前按启用技能声明的 checks 校验成品，硬性违规 → writing-skill-compliance-failed（这是 Writing Skills 唯一的硬门；入口不再因「未提交技能引用」阻断）\n\n返回中的可观测字段：\n- publishHint.warnings：逐条列出违反了哪个技能的哪条要求\n- settlementDispatch：章后结算这一步工具调用的结果（工具名 / 是否成功）\n- settlementError：正文已保存但章后结算失败，重试 memory.settle_chapter 即可（正文已在库，不会丢稿）\n\n可选质量强化：\n- factCheckAutoRevise=true：审修后仍有事实/连续性 critical 时，额外做 1 轮事实专项 spot-fix + 复审\n- requireFactCheckPass=true：复审仍不过则 fact-check-failed 不保存\n\n使用时机：\n- 用户明确要求「写下一章」/「生成章节」且 preflight ok 时\n- 已有 scene.spec 蓝图准备就绪时\n\n不要用的时候：\n- 用户只是在问问题、查看设定、讨论方向\n- preflight blockers 非空时",
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
    description: `经纬字段演变工具。对 dynamic 分类条目做字段级推进（如伏笔 status 由「已埋设」推进为「部分揭示」、冲突阶段变化），每次演变写入 jingwei_progressions 台账（旧值/新值/章号/依据），可完整回溯。

约束：
- 只允许推进 dynamic 分类条目（outline / relationships / conflicts / foreshadowing / timeline / chapter-summaries）。
- canon/reference 分类（角色人设、世界规则等）拒绝推进：必须走 lore.write 并注明理由，经作者确认。
- fieldKey 必须命中条目 fields_json 里的真实字段键；新值是本章剧情后的状态。

使用时机：
- 伏笔兑现/推进（但 hooks.manage 更适合伏笔标准操作，这里用于其它动态字段）。
- 冲突/时间线/卷纲的状态字段随剧情演变。
- 需要在结构化字段里留「第 N 章发生了什么变化」的推进痕迹。

不要用的时候：
- 静态设定修改：用 lore.write。
- 伏笔的标准埋设/兑现：优先 hooks.manage。`,
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["lore.progress"]),
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
    description: "Pending NarrativeEvents 工具。用于创建、列出、批准或拒绝 Pending NarrativeEvents；approve 会写入 Narrative Memory facts，pending event 不等于 confirmed memory，更不能自动写入 Lore canon。create 可传 events[] 一次写入多条（最多 20）。",
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
    name: "scene.spec",
    description: "生成结构化写作蓝图（Scene Spec）。这是调用 pipeline.write 的硬前置条件——没有蓝图 pipeline.write 会报错。\n\n使用流程：\n1. 必须先 write.preflight；blockers 非空禁止调用本工具\n2. 用 preflight.resolvedDirective（或用户确认后的一句指示）作为 userDirectives\n3. 可选：lore.read(scope=brief) 静态设定、memory.read 动态记忆\n4. 再调用 scene.spec 生成蓝图\n\n硬约束：\n- userDirectives 必须是一句明确本章目标（≥8 字），禁止塞写作理论/文风大道理\n- 仅有 focus 默认句时需 acceptFocusDefault=true 或补用户句\n- 已有正式章但近章记忆空时会 context-not-ready\n\n不要用的时候：\n- 用户没有要求写章节时\n- preflight 未通过时\n\n注意：软门（文风/去 AI）留在写后 audit/revise；pipeline.write 成功后自动章后结算。",
    inputSchema: toJsonObjectSchema(NOVEL_TOOL_SCHEMAS["scene.spec"]),
    risk: "read",
    renderer: "scene.spec",
    enabledForModes: ALL_SESSION_PERMISSION_MODES,
    scope: "novel",
  }),
  sessionTool({
    name: "resource.manage",
    description: "正式章节结果管理。\n\naction=list：列出所有正式章节结果（传 filter 可过滤）\naction=archive：归档正式章节结果（不删除但标记不活跃）\naction=delete：永久删除正式章节结果\n\n使用时机：\n- 用户说「删掉这个章节」→ delete 或 archive\n- 用户想看有哪些章节 → list",
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
      "新建或修改工作流草稿：用一批编辑指令（加节点、改节点、删节点、连线、断线、改名称）改图，不要整张重写。\n\n规则：\n- 你建的和改的一律是草稿，作者在「故事推进 › 执行」的画布上确认发布后才能运行\n- 已发布的方案不能直接改，用 copyFrom 另建草稿\n- 一批指令里任一条不合法则整批不生效，按返回说明修正后重交\n- 草稿可以暂时有结构问题（返回 issues），但要在交给作者前修好\n- 并行：一道工序连出多条无条件连线；分支：工序声明 outcomes，出线带 outcome；多条分支会合前加汇合节点",
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

/**
 * 小说 Agent 角色预设 — 与 AGENT_ROLES 保持一致
 */
export const NOVEL_AGENT_PRESETS: Record<string, { enable: string[]; disable: string[] }> = {
  novelist: {
    enable: ["Bash", "Read", "Write", "Edit", "Grep", "Glob", "EnterWorktree", "ExitWorktree", "TaskCreate", "Terminal", "Browser", "Recall", "ShareFile"],
    disable: [],
  },
};
