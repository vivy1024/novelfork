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
  jingwei: { zh: "经纬", en: "Jingwei" },
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
const M = "manual" as const;

/**
 * 25 个精锐小说工具的套路与默认档位：
 * - 经精简压缩后，24 个高频/常规写作工具默认全量常驻（作者可在设置里按需调低），避免反复 ToolSearch 打断创作；
 * - 仅破坏性作废工具 `chapter.discard_range` 默认手动，需显式开启或 `/load` 才可用。
 */
const NOVEL_TOOL_ROUTINE_SPECS: Readonly<Record<string, NovelToolRoutineSpec>> = {
  // 核心写章与章节（8）
  "book.overview": ["write", "全书概览", "Book overview", "开工前或问整体进度时，一次读全书状态概览", "Whole-book status overview before starting or when asked about progress", R],
  "chapter.preflight": ["write", "写前预检", "Chapter preflight", "写新章第一步：检查就绪条件、取目标路径与写前召回包", "First step of a new chapter: readiness check, target path and recall pack", R],
  "chapter.blueprint": ["write", "章节蓝图", "Chapter blueprint", "预检通过后提交并缓存本章结构化蓝图，写正文前必做", "Submit and cache the chapter blueprint before drafting prose", R],
  "chapter.commit": ["write", "写章入库", "Commit chapter", "原生 Write/Edit 写盘后执行审计校验、正式入库与章后结算", "Validate, audit, commit and settle a chapter written to disk", R],
  "chapter.list": ["chapter", "章节目录", "List chapters", "列出全书章节的序号、标题、路径、字数与状态", "List chapters with number, title, file path, word count and status", R],
  "chapter.audit": ["chapter", "章节审计与自检", "Chapter audit", "单章质量审计或投稿前敏感词/AI 味风险自检", "Quality audit or pre-submission risk check for chapters", R],
  "chapter.propose_selection": ["chapter", "划词候选", "Selection proposal", "作者划词请求续写、润色或改写时交回候选文本", "Return a candidate for an author's selection request", R],
  "chapter.discard_range": ["chapter", "作废试写章节", "Discard chapters", "整段作废试写章节并抹去其记忆（破坏性操作）", "Discard a range of draft chapters and their memory (destructive)", M],
  // 经纬与大纲（4）
  "jingwei.read": ["jingwei", "查经纬设定", "Read Jingwei", "查角色、世界观、势力等静态设定或执行可用性审计", "Look up characters, world rules and factions or audit availability", R],
  "jingwei.write": ["jingwei", "写经纬设定", "Write Jingwei", "写入静态设定、关系变化、动态字段推进、改动候选与剧情线草稿", "Write static settings, relationships, progress, proposals and storylines", R],
  "hooks.manage": ["jingwei", "伏笔管理", "Hooks", "埋设、兑现、查到期、列出或删除伏笔", "Plant, pay off, check due, list or delete hooks", R],
  "outline.volume": ["jingwei", "卷纲", "Volume outline", "查看或维护卷级大纲与终局储备", "Read or maintain the volume outline and endgame reserve", R],
  // 叙事记忆（5）
  "memory.read": ["memory", "记忆召回", "Recall memory", "按通道补看近章事实、角色状态、关系与伏笔", "Recall recent facts, character states, relationships and hooks", R],
  "memory.search": ["memory", "记忆与正文检索", "Search memory", "按关键词查事实事件、搜章节正文旧细节或盘点记忆清单", "Search facts, chapter prose details or list memory inventory", R],
  "memory.graph": ["memory", "记忆关系图", "Memory graph", "查看关系图、时间线、角色弧、伏笔网络等动态图谱", "Read relationship, timeline, arc and hook graphs", R],
  "memory.events": ["memory", "叙事事件队列", "Memory events", "列出、记录、审批或批量批准叙事事件", "List, create, approve, reject or bulk-approve narrative events", R],
  "memory.settle": ["memory", "章后记忆结算", "Settle memory", "对已落盘单章或历史章节范围抽取叙事事件并更新记忆", "Settle one chapter or backfill a chapter range into narrative memory", R],
  // 专项与工作流（8）
  "character.inspect": ["jingwei", "角色核查与声线", "Inspect character", "查角色一致性、角色弧线状态/同步与声线读写草稿", "Inspect character consistency, arcs and voice constraints", R],
  "style.manage": ["style", "文风管理", "Style manager", "参考书索引、文风蒸馏预览/启动/采纳、规则瘦身与负反馈硬约束", "Reference index, style distillation, consolidation and negative overrides", R],
  "mechanism.distill": ["import", "中观机制拆解", "Mechanism cards", "从参考作品拆解可迁移剧情机制卡供大纲和细纲构思", "Distill transferable plot mechanism cards for outline and scene planning", R],
  "book.import": ["import", "旧书导入与拆书", "Import & dissect", "切章导入已有旧书文本，或按目的拆解正文抽取经纬草稿", "Import manuscript chapters or dissect text into Jingwei drafts", R],
  "market.radar": ["market", "市场榜单雷达", "Market radar", "查看榜单、扫榜、分析历史快照与采样公开样章指标", "List ranks, scan rankings, query trends and sample public chapters", R],
  "skills.manage": ["style", "写作技能管理", "Writing skills", "按建书答案推荐写作技能或校验正文技能合规项", "Recommend writing skills or check chapter compliance", R],
  "workflow.step": ["workflow", "工作流工序", "Workflow step", "工作流运行中读取当前工序、提交产物或报告阻塞", "Read current step, submit output or report blocker in a workflow run", R],
  "workflow.manage": ["workflow", "工作流方案", "Workflow manager", "列出、查看、编辑工作流方案草稿或在章节上启动运行", "List, inspect, edit workflow recipes or start a workflow run", R],
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

function legacyGroupOf(tool: Pick<NovelSessionToolDefinition, "name" | "visibility" | "risk">): LegacyNovelToolRoutineGroupId {
  if (tool.visibility === "advanced") {
    return tool.risk === "read" ? "novelfork.memory-inspect" : "novelfork.maintenance";
  }
  if (tool.name.startsWith("market.")) return "novelfork.market";
  return "novelfork.writing";
}

/** 旧组 id → 组内工具（canonical 名）。只含贡献给 Runtime 的工具。 */
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
