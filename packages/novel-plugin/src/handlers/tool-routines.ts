/**
 * 小说工具在 NarraFork「套路 › 可选工具」里的套路：每个工具一个，作者可以像 NarraFork
 * 自带的可选工具一样逐个设成手动 / 自动 / 常驻（全局或本书覆盖）。
 */
import { NOVEL_RUNTIME_TOOL_CATALOG, type NovelSessionToolDefinition } from "./tool-registry.js";

/** NarraFork「可选工具」的三档：手动（只有 /load 才装）、自动（不预装，ToolSearch 按需发现加载）、常驻（新会话默认装）。 */
export type NovelToolRoutineMode = "manual" | "auto" | "resident";

/** 每个小说工具一个套路：`novelfork.<工具名>`，点号保留、下划线换连字符（Runtime 套路 id 只认小写字母数字、连字符与点）。 */
export type NovelToolRoutineId = `novelfork.${string}`;

export interface NovelToolRoutineDefinition {
  /** 套路 id，也是 /load 的参数；带 novelfork 命名空间，不与 NarraFork 自带套路冲突。 */
  readonly id: NovelToolRoutineId;
  readonly nameZh: string;
  readonly nameEn: string;
  readonly descriptionZh: string;
  readonly descriptionEn: string;
  /** 全局与本书都没设置时的档位；作者在「套路 › 可选工具」或本书覆盖里随时改。 */
  readonly defaultMode: NovelToolRoutineMode;
}

/** 套路名前缀：Runtime 的可选工具页按名称展示，前缀让同类工具读起来成组。 */
const ROUTINE_GROUP_LABELS = {
  write: { zh: "创作", en: "Writing" },
  chapter: { zh: "章节", en: "Chapters" },
  lore: { zh: "经纬", en: "Lore" },
  memory: { zh: "记忆", en: "Memory" },
  style: { zh: "文风技能", en: "Style & skills" },
  import: { zh: "导入", en: "Import" },
  market: { zh: "市场", en: "Market" },
  workflow: { zh: "工作流", en: "Workflow" },
} as const;

type NovelToolRoutineGroup = keyof typeof ROUTINE_GROUP_LABELS;

/** [分组, 中文名, 英文名, 中文用途, 英文用途, 默认档位] */
type NovelToolRoutineSpec = readonly [NovelToolRoutineGroup, string, string, string, string, NovelToolRoutineMode];

const R = "resident" as const;
const A = "auto" as const;
const M = "manual" as const;

/**
 * 每个小说工具的套路与默认档位。分档原则：
 * - 常驻：日常写章、读写章节、经纬、伏笔、卷纲、记忆召回 / 搜索 / 结算、工作流运行
 *   （进行中的运行靠 get_current_step / submit_step_output / report_blocker 推进，设成手动会让运行卡死）。
 * - 自动：低频但会被写作台按钮、系统提示或内置技能点名的工具（拆书、导入旧书、投稿自检、
 *   文风蒸馏、技能推荐与合规、声线草稿、市场调研、资料诊断、工作流方案编辑）。不占每轮工具表，
 *   叙述者需要时用 ToolSearch 按需装上；设成手动会让这些按钮发出去后找不到工具。
 * - 手动：会改删数据的维护操作（作废章节、改删记忆、批量批准、导入旧技能）与纯诊断读取；
 *   作者 /load 或在「套路 › 可选工具」改档位后才可用。
 */
const NOVEL_TOOL_ROUTINE_SPECS: Readonly<Record<string, NovelToolRoutineSpec>> = {
  "cockpit.snapshot": ["write", "全书概览", "Book snapshot", "开工前或作者问整体进度时，一次读全书状态概览", "Whole-book status overview before starting or when asked about progress", R],
  "write.preflight": ["write", "写前预检", "Preflight", "写新章第一步：检查能不能写并取回写前召回包", "First step of a new chapter: check readiness and fetch the recall pack", R],
  "scene.spec": ["write", "章节蓝图", "Scene spec", "预检通过后提交本章结构化蓝图，写正文前必做", "Submit the chapter blueprint after preflight, before drafting prose", R],
  "pipeline.write": ["write", "写章落盘", "Save chapter", "提交写好的新章正文：校验、审计、保存并章后结算", "Submit a drafted new chapter: validate, audit, save and settle", R],
  "chapter.audit": ["write", "章节审计", "Chapter audit", "检查一章的节奏、AI 味、伏笔到期与连续性", "Audit one chapter for pacing, AI tells, due hooks and continuity", R],
  "publish.check": ["write", "投稿自检", "Publish check", "投稿前做敏感词、AI 味与完整性风险自检", "Pre-submission risk check: sensitive terms, AI tells, completeness", A],
  "chapter.read": ["chapter", "读章节", "Read chapter", "读取某一章的正文与状态", "Read one chapter's text and status", R],
  "chapter.list": ["chapter", "章节目录", "List chapters", "列出全书章节的序号、标题、字数与状态", "List chapters with number, title, word count and status", R],
  "chapter.write": ["chapter", "覆盖章节", "Overwrite chapter", "整章覆盖一个已存在章节的正文（需作者批准）", "Overwrite an existing chapter's full text (needs approval)", R],
  "rewrite.apply": ["chapter", "局部改写", "Apply rewrite", "把改写结果写回某章的指定行范围", "Write a rewrite back into a line range of a chapter", R],
  "chapter.propose_selection": ["chapter", "划词候选", "Selection proposal", "作者划词请求续写、润色或改写时交回候选文本", "Return a candidate for an author's selection request", R],
  "chapter.propose_revision": ["chapter", "整章改动候选", "Revision proposal", "整章或大范围改动先交候选，由作者核对后应用", "Propose whole-chapter changes for the author to review first", R],
  "resource.manage": ["chapter", "章节结果管理", "Chapter results", "列出、归档或删除正式章节结果资源", "List, archive or delete formal chapter result resources", R],
  "chapter.discard_range": ["chapter", "作废试写章节", "Discard chapters", "整段作废试写章节并抹去其记忆（会删除数据）", "Discard a range of draft chapters and their memory (deletes data)", M],
  "lore.read": ["lore", "查设定", "Read lore", "写前或讨论时查角色、世界观、势力等静态设定", "Look up characters, world rules and factions", R],
  "lore.write": ["lore", "写设定", "Write lore", "新建或修改作者可审阅的静态设定条目", "Create or update reviewable lore entries", R],
  "lore.relate": ["lore", "关系变化", "Relationships", "记录角色或势力之间的关系变化", "Record relationship changes between characters or factions", R],
  "lore.progress": ["lore", "设定推进", "Lore progress", "推进伏笔、冲突等动态字段并留演变台账", "Advance dynamic fields such as hooks or conflicts, with history", R],
  "lore.propose_update": ["lore", "设定改动候选", "Lore proposal", "改设定字段前先交逐字段候选给作者核对", "Propose field-level lore changes for the author to review", R],
  "outline.volume": ["lore", "卷纲", "Volume outline", "查看或维护卷级大纲与终局储备", "Read or maintain the volume outline and endgame reserve", R],
  "arc.character": ["lore", "角色弧线", "Character arcs", "查看或同步角色弧线，发现停滞或回退", "Read or sync character arcs to spot stalls", R],
  "hooks.manage": ["lore", "伏笔", "Hooks", "埋设、兑现、查到期或列出伏笔", "Plant, pay off, check due or list hooks", R],
  "storyline.propose": ["lore", "剧情线草稿", "Storyline drafts", "从已结算事件归纳剧情线并提交草稿", "Draft storylines from settled events", R],
  "character.check_consistency": ["lore", "人设一致性", "Character consistency", "检查角色在章节范围内的出场与上下文", "Check a character's appearances across chapters", R],
  "character.voice.read": ["lore", "读声线", "Read voice", "写对白前查看角色声线与当前约束", "Read a character's voice before writing dialogue", R],
  "character.voice.draft": ["lore", "声线草稿", "Voice draft", "作者要求整理角色声线时生成待审草稿", "Draft a character voice for author review when asked", A],
  "jingwei.audit": ["lore", "设定可用性诊断", "Lore audit", "排查某条设定为什么没进入写作上下文", "Diagnose why a lore entry is not used in writing", A],
  "memory.read": ["memory", "记忆召回", "Recall memory", "按通道补看近章事实、角色状态与伏笔", "Recall recent facts, character states and hooks", R],
  "memory.search": ["memory", "记忆搜索", "Search memory", "按关键词查正文里提过的事实与事件", "Search facts and events by keyword", R],
  "memory.search_text": ["memory", "搜正文", "Search chapter text", "按关键词在章节正文里找旧细节，再按偏移读原文", "Find old details in chapter text, then read by offset", A],
  "memory.graph": ["memory", "记忆关系图", "Memory graph", "查看关系图、时间线、伏笔网络等动态图谱", "Read relationship, timeline and hook graphs", R],
  "memory.events": ["memory", "待确认事件", "Pending events", "列出、批准或驳回待确认的叙事事件", "List, approve or reject pending narrative events", R],
  "memory.settle_chapter": ["memory", "单章结算", "Settle chapter", "正文落盘后把一章抽成叙事事件（失败时重试）", "Settle one saved chapter into narrative events", R],
  "memory.settle_range": ["memory", "补结算", "Backfill settlement", "回填历史章节漏掉的叙事记忆", "Backfill narrative memory for past chapters", R],
  "memory.read_line": ["memory", "读叙事线", "Read narrative line", "读取叙事线的节点、边与告警", "Read the narrative line with warnings", R],
  "memory.propose_change": ["memory", "叙事线改动草案", "Narrative line proposal", "提出叙事线改动并预览差异", "Propose narrative line changes with a diff", R],
  "memory.approve_change": ["memory", "叙事线审批", "Narrative line approval", "对叙事线草案记录批准或驳回", "Approve or reject a narrative line proposal", R],
  "memory.list": ["memory", "记忆清单", "List memory", "清理前盘点记忆条目摘要（诊断用）", "Inventory memory entries before cleanup", A],
  "memory.read_entry": ["memory", "读记忆条目", "Read memory entry", "按 id 精确查看一条记忆（诊断用）", "Inspect one memory entry by id", M],
  "memory.dedup": ["memory", "记忆去重检查", "Memory dedup", "清理前找出重复的记忆条目", "Find duplicate memory entries before cleanup", M],
  "memory.export": ["memory", "导出记忆", "Export memory", "以 JSON 导出叙事记忆", "Export narrative memory as JSON", A],
  "memory.stats": ["memory", "记忆统计", "Memory stats", "统计记忆数量、状态分布与重复风险", "Count memory and its status distribution", A],
  "memory.update": ["memory", "改记忆条目", "Update memory", "修正单条记忆事实或事件（会改数据）", "Correct one memory fact or event (modifies data)", M],
  "memory.delete": ["memory", "删记忆条目", "Delete memory", "删除单条记忆事实或事件（会删除数据）", "Delete one memory fact or event (deletes data)", M],
  "memory.bulk_approve": ["memory", "批量批准事件", "Bulk approve", "一次批准多条待确认事件（会改数据）", "Approve many pending events at once (modifies data)", M],
  "memory.bulk_delete": ["memory", "批量删记忆", "Bulk delete", "按筛选条件批量删除记忆（会删除数据）", "Bulk delete filtered memory (deletes data)", M],
  "style.distill_index": ["style", "参考书机械索引", "Style source index", "列出书根参考文件或扫描大文件切章与推荐抽样章", "List reference files or mechanically index chapters for sampling", A],
  "style.distill_preview": ["style", "文风蒸馏预览", "Style preview", "作者要学一段文风时先预览切章范围", "Preview the range before distilling a style", A],
  "style.distill_start": ["style", "文风蒸馏", "Style distill", "从参考文本分批抽取待审文风条目", "Extract reviewable style rules from reference text", A],
  "style.distill_status": ["style", "文风蒸馏结果", "Style status", "读取文风蒸馏任务的进度与条目", "Read a style distillation job and its rules", A],
  "style.distill_adopt": ["style", "采纳文风", "Adopt style", "把作者点名确认的文风条目写进本书预设", "Adopt author-confirmed style rules into the book", A],
  "skills.recommend": ["style", "技能推荐", "Skill recommendation", "建书引导时按本书答案推荐写作技能", "Recommend writing skills during book setup", A],
  "skills.check_compliance": ["style", "技能合规检查", "Skill compliance", "按已启用技能的规则检查章节违规", "Check a chapter against enabled skill rules", A],
  "skills.import_legacy": ["style", "导入旧版技能", "Import legacy skills", "把旧版预设迁移为写作技能（一次性维护）", "Migrate legacy presets into writing skills (one-off)", M],
  "pipeline.import_chapters": ["import", "导入旧书", "Import chapters", "把已有的整本文本切章导入本书", "Import an existing manuscript as chapters", A],
  "book.dissect": ["import", "拆书", "Dissect book", "从已有正文抽取经纬草稿", "Extract lore drafts from existing text", A],
  "market.scan": ["market", "扫榜", "Scan rankings", "扫描平台公开榜单并留快照（访问外部站点）", "Scan public platform rankings (fetches external sites)", A],
  "market.query": ["market", "榜单分析", "Query rankings", "查询已存的榜单快照并做题材分析", "Query saved ranking snapshots and analyze them", A],
  "market.ranks": ["market", "榜单清单", "Ranking list", "查看可用的榜单列表", "List available rankings", A],
  "market.sample_public_chapters": ["market", "样章采样", "Sample chapters", "采样公开免费章节的结构指标（访问外部站点）", "Sample structure metrics of public chapters (fetches external sites)", A],
  "workflow.get_current_step": ["workflow", "当前工序", "Current step", "工作流运行中读取当前工序简报", "Read the current step brief of a workflow run", R],
  "workflow.submit_step_output": ["workflow", "提交工序产物", "Submit step", "工作流运行中提交当前工序的产物", "Submit the current step's output in a workflow run", R],
  "workflow.report_blocker": ["workflow", "报告受阻", "Report blocker", "当前工序确实做不下去时报告原因", "Report why the current step cannot be completed", R],
  "workflow.start_run": ["workflow", "启动工作流", "Start run", "在某一章上启动已发布的工作流方案", "Start a published workflow on a chapter", R],
  "workflow.list_recipes": ["workflow", "方案列表", "List recipes", "列出本书的工作流方案", "List this book's workflow recipes", R],
  "workflow.get_recipe": ["workflow", "查看方案", "Read recipe", "读取一个工作流方案的完整结构", "Read a workflow recipe's full structure", R],
  "workflow.edit_recipe": ["workflow", "编辑方案", "Edit recipe", "新建或修改工作流方案草稿", "Create or edit a workflow recipe draft", A],
};

/** 工具名 → 套路 id：`novelfork.` + 工具名（点号保留，下划线换连字符）。 */
export function getNovelToolRoutineId(toolName: string): NovelToolRoutineId {
  return `novelfork.${toolName.toLowerCase().replace(/_/g, "-")}`;
}

/** 某个工具的套路定义；没有登记档位的工具返回 null。 */
export function getNovelToolRoutine(toolName: string): NovelToolRoutineDefinition | null {
  const spec = NOVEL_TOOL_ROUTINE_SPECS[toolName];
  if (!spec) return null;
  const [groupKey, nameZh, nameEn, whenZh, whenEn, defaultMode] = spec;
  const group = ROUTINE_GROUP_LABELS[groupKey];
  return {
    id: getNovelToolRoutineId(toolName),
    nameZh: `${group.zh}·${nameZh}`,
    nameEn: `${group.en} · ${nameEn}`,
    descriptionZh: whenZh,
    descriptionEn: whenEn,
    defaultMode,
  };
}

/** 已登记档位的工具名（canonical）。 */
export const NOVEL_TOOL_ROUTINE_TOOL_NAMES: readonly string[] = Object.keys(NOVEL_TOOL_ROUTINE_SPECS);

/** 全部小说工具套路（按目录顺序，一个工具一个）。 */
export const NOVEL_TOOL_ROUTINES: readonly NovelToolRoutineDefinition[] = NOVEL_RUNTIME_TOOL_CATALOG
  .map((tool) => getNovelToolRoutine(tool.name))
  .filter((routine): routine is NovelToolRoutineDefinition => routine !== null);

/** 给定工具（canonical 名）的套路，每个工具一个；没有登记档位的工具不返回。 */
export function listNovelToolRoutines(
  tools: readonly Pick<NovelSessionToolDefinition, "name">[],
): Array<NovelToolRoutineDefinition & { readonly toolNames: readonly string[] }> {
  return tools.flatMap((tool) => {
    const routine = getNovelToolRoutine(tool.name);
    return routine ? [{ ...routine, toolNames: [tool.name] }] : [];
  });
}

/** 旧版（按组）套路 id；只用于把作者对旧组设过的档位迁移到逐工具套路。 */
export type LegacyNovelToolRoutineGroupId =
  | "novelfork.writing"
  | "novelfork.market"
  | "novelfork.memory-inspect"
  | "novelfork.maintenance";

/** 旧版分组规则（按 visibility / risk / 名称），冻结在这里只为迁移，不再决定新套路。 */
function legacyGroupOf(tool: Pick<NovelSessionToolDefinition, "name" | "visibility" | "risk">): LegacyNovelToolRoutineGroupId {
  if (tool.visibility === "advanced") {
    return tool.risk === "read" ? "novelfork.memory-inspect" : "novelfork.maintenance";
  }
  if (tool.name.startsWith("market.")) return "novelfork.market";
  return "novelfork.writing";
}

/** 旧组 id → 组内工具（canonical 名）。只含贡献给 Runtime 的工具，与旧版套路成员一致。 */
export const LEGACY_NOVEL_TOOL_ROUTINE_GROUPS: Readonly<Record<LegacyNovelToolRoutineGroupId, readonly string[]>> = (() => {
  const groups: Record<LegacyNovelToolRoutineGroupId, string[]> = {
    "novelfork.writing": [],
    "novelfork.market": [],
    "novelfork.memory-inspect": [],
    "novelfork.maintenance": [],
  };
  for (const tool of NOVEL_RUNTIME_TOOL_CATALOG) {
    if (tool.runtimeStatus === "ready") groups[legacyGroupOf(tool)].push(tool.name);
  }
  return groups;
})();
