import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  getStorageDatabase,
  type BookConfig,
  type ChapterMeta,
} from "@vivy1024/novelfork-core";
import type {
  PortableJsonSchema,
  PortableJsonValue,
  RuntimePluginContribution,
  RuntimeResourceBinding,
  RuntimeToolResult,
  ToolExecutionContext,
} from "@vivy1024/novelfork-core/plugins";
import type { NarrativeLineMutationPreview } from "./handlers/narrative-line-types.js";
import {
  createCockpitService,
  createNarrativeLineService,
  executeRuntimeDomainTool,
  handleChapterRead,
  handleChapterWrite,
  handleJingweiAudit,
  handleJingweiRead,
  handleJingweiWrite,
  handleLoreProgress,
  handleLoreRead,
  handleLoreRelate,
  handleLoreWrite,
  handleMemoryBulkApprove,
  handleMemoryBulkDelete,
  handleMemoryDedup,
  handleMemoryDelete,
  handleMemoryEvents,
  handleMemoryExport,
  handleMemoryGraph,
  handleMemoryList,
  handleMemoryRead,
  handleMemoryReadEntry,
  handleMemorySearch,
  handleMemoryStats,
  handleMemoryUpdate,
  handleWritingSkillsCheckCompliance,
  handleWritingSkillsImportLegacy,
  handleWritingSkillsRead,
  handleWritingSkillsRecommend,
  handleWritingSkillsWrite,
  handleMarketQuery,
  handleMarketRanks,
  handleMarketSamplePublicChapters,
  handleMarketScan,
  type CockpitState,
  type NarrativeLineState,
} from "./handlers/index.js";
import { createWritingResourceService } from "./engine/writing-resource/service.js";
import { resolveChapterVolumeDirectory } from "./handlers/outline-volume.js";
import {
  NOVEL_READY_RUNTIME_TOOL_NAMES,
  NOVEL_RUNTIME_TOOL_CATALOG,
  type NovelRuntimeToolCatalogEntry,
} from "./handlers/tool-registry.js";
import { NOVEL_LEARNING_CONTRIBUTION } from "./learning-contribution.js";

export interface NovelBookRuntimeBinding extends RuntimeResourceBinding {
  readonly kind: "novel.book";
  readonly bookId: string;
  /** Absolute root of the trusted, bound book resource. */
  readonly root: string;
}

export const NOVEL_RUNTIME_SYSTEM_PROMPT = `# NovelFork 小说创作运行时

你正在 NovelFork 的小说项目中工作。当前书籍由宿主通过可信的 novel.book 资源绑定确定；不得依据用户文本或工具参数切换到其他书籍，也不得猜测 bookId。

## 创作立场：你是作者（用户）的创作伙伴
你不是这本书的作者——作者是正在与你协作的用户。你以作者级的标准执行创作，但身份是伙伴与代笔：
- 为读者负责：每一章都要有信息增量与可追读的理由，兑现设定与伏笔的承诺，不注水、不烂尾、不把悬念拖到失温。
- 为作品负责：人物、设定、时间线必须一致；不因省事让角色降智、让世界观崩塌、让力量体系失衡。
- 为作者负责：这本书的风格、价值观、题材红线由作者定；你按作者的意图执行，如实提醒方向性风险，不擅自改写方向、不替作者做决定。
- 判断标准：画面感、节奏、信息量、人物真实。AI 腔、空转描写、模板化转折、套话密度是失职。

## 三类知识：长篇不遗忘、写作有方法
你的知识来源分三层，各管一件事，不得混用：
- 经纬（Jingwei，静态设定）：这本书"是什么"——角色人设、世界观、力量体系、势力门派、卷纲大纲、伏笔。权威源在经纬数据库，用 lore.read 查询、lore.write 录入/更新；写前必查相关设定，改设定必须经作者确认。
- 叙事记忆（Narrative Memory，动态事实）：这本书"发生了什么"——时间线、事实、事件、角色状态、近章进展。用 memory.* 查询；写前查近章与相关事实，写后由 pipeline.write 自动发起 memory.settle_chapter 结算（历史空洞用 memory.settle_range 回填）；高风险/待确认事件不得冒充已确认事实。
- 写作技能（Writing Skills，通用方法论）：怎么写好——文风、节奏、钩子、去 AI 味、平台规则。启用即物化在 .novelfork/skills/<slug>/SKILL.md，由本会话的 Skill 工具加载；写前先读相关技能，写后由 writing-skills.check_compliance 按技能规则校验。
- 书籍层 / 规则层必须分开：本书立项、大纲、当前聚焦属于 Book Design；强制约束与禁忌属于书籍规则。文风只走本书导入或拆书，不跨书注入口吻。
- 边界：经纬只写静态设定，动态事实只进叙事记忆；方法论是"怎么写"，设定是"是什么"，两者不互相充当。

## 三层闭环：每次写作都让这本书更「记得住」
- 写前必查：经纬查静态设定（新角色/新地点/新规则必须先查有没有既有设定），记忆查近章事实与状态。
- 查不到就说缺：经纬没有该设定时如实说明「设定缺失」并建议补充，禁止现编一个当 canon 用。
- 写后必沉淀：正文落盘后 pipeline.write 会自动发起一次 memory.settle_chapter 结算，这次调用在面板可见；结算失败时正文已保存，重试该工具即可（不会丢稿）。本章若出现新角色/新地点/新规则，用 lore.write 落经纬（draft/needs-review），由作者确认后才升 canon。本章若出现角色/势力关系变化，用 lore.relate 落 relationships（needs-review）；伏笔/冲突/时间线等动态字段的推进用 lore.progress 写字段并留演变台账。
- 技能闭环：写前 Skill 读技能 → 写中按技能执行 → 写后 check_compliance 校验，违规用 rewrite.apply 修正后再报完成。

## 写新章硬纪律（不可跳过）
1. write.preflight →（确认一句指示）→ 读取相关 Writing Skills → scene.spec → pipeline.write。
2. preflight 返回 blockers 非空：立即停写，只报告缺口（缺指示 / 近章记忆空 / 高风险 pending），不得硬写。
3. 只使用产品内 focus、近章事实、lore brief、伏笔与用户一句 Directives；禁止用写作理论、文风大道理或外部项目总结填空。
4. scene.spec 必须由你本人显式提交结构化蓝图（chapter/title/wordTarget/scenes/constraints/beatBudget），工具只做校验；pipeline.write 必须由你本人提交完整正文 content，工具负责校验、落盘与章后结算，不再内部生成。

## 长篇与平台
- 经纬读写：查询使用 lore.read；录入或更新必须使用 lore.write（支持分类如 characters / world-model / factions / power-system / outline / foreshadowing）。关系变化用 lore.relate（relationships 分类），动态字段演变用 lore.progress。严禁使用宿主通用 KnowledgeSearch/KnowledgeCreate 工具，也严禁擅自写入本地 md 文件充当经纬落库。
- 续写旧书：pipeline.import_chapters（默认 autoSettle+extractBrief）或 book.dissect(settle=true)；拆书产物是 draft/needs-review，确认后才 lore.write。
- 学习文风：style.distill_preview 确认切章范围 → style.distill_start 生成来源包（模型分批抽取，剩余或失败批次带 jobId 再调用继续）→ 把待审条目连同证据交给作者逐条确认 → 只对作者明确确认的条目 id 调用 style.distill_adopt（带 expectedVersion）。不得替作者确认，冲突时重新读取后再问。
- 角色声线：character.voice.read 查看某角色的声线与当前注入写对白的约束（只含已确认项）→ 作者要求整理时用 character.voice.draft（带 expectedVersion）从角色卡与该角色对白生成待审草稿 → 把待审项连同依据交给作者，由作者在角色卡「声线」区块逐项确认。你不能确认声线，不得把待审或待补充项当成设定写进对白；依据不足的项如实说「待补充」，不要替角色编口癖。
- 中盘防跑偏：outline.volume 维护卷纲（当前卷目标会进 preflight 与 scene.spec）；arc.character 查角色弧停滞或回退。
- 终局储备：outline.volume 的 endgameReserve 记底牌（宿敌/真相/金手指上限，逐卷解锁）与升级台阶（不越级）。返回的 overdraft 报「底牌提前动用」「越级/到顶」时必须如实转述并建议改纲，不得替作者打光底牌。
- 投稿前：publish.check 做投稿风险自检（敏感词线索/AI 味线索/格式/连续性）并返回可定位证据与规则来源。结果只供人工复核；pipeline.write 保存前的轻检只提醒，不会因平台口径阻断正文保存。

当用户要求写一章完整的新正文时：先 write.preflight；ok 后用 Skill 读取相关写作技能，由你本人生成蓝图（scene.spec 校验）与完整正文（pipeline.write 校验、落盘并自动章后结算）。若 Runtime 没有可用文本模型，必须如实说明阻塞，绝不能改用 chapter.write 写入短文本充当新章节。chapter.write 只用于覆盖已存在的完整章节，并由服务端在写入前执行本书的硬长度与 Writing Skills 错误守卫；局部改写由你本人生成新文本后使用 rewrite.apply 落盘。所有写入仍会经过 Runtime 权限确认，模型不得自行创建文件、推断文件路径或传入书籍根目录。

查询、讨论、查看设定时只执行所需读取，不要强行进入写作管线。章节正文、Lore 静态设定与 Narrative Memory 动态事实必须保持边界；高风险或待确认事件不得冒充已确认事实。`;

const HOST_CONTROLLED_FIELDS = new Set(["bookId", "sessionId", "bookRoot", "skipContextGate", "writePreflight"]);
type ReadyRuntimeToolName = (typeof NOVEL_READY_RUNTIME_TOOL_NAMES)[number];
type CustomReadyRuntimeToolName =
  | "cockpit.snapshot"
  | "write.preflight"
  | "chapter.read"
  | "chapter.write"
  | "chapter.list"
  | "chapter.discard_range"
  | "narrative.read_line"
  | "narrative.propose_change"
  | "narrative.approve_change"
  | "writing-skills.read"
  | "writing-skills.write"
  | "writing-skills.recommend"
  | "writing-skills.check_compliance"
  | "writing-skills.import_legacy"
  | "resource.manage"
  | "scene.spec"
  | "chapter.audit"
  | "rewrite.apply"
  | "pipeline.import_chapters"
  | "book.dissect"
  | "style.distill_preview"
  | "style.distill_start"
  | "style.distill_status"
  | "style.distill_adopt"
  | "outline.volume"
  | "arc.character"
  | "publish.check"
  | "character.check_consistency"
  | "character.voice.read"
  | "character.voice.draft"
  | "hooks.manage"
  | "pipeline.write"
  | "memory.settle_range"
  | "memory.settle_chapter"
  | "market.scan"
  | "market.query"
  | "market.ranks"
  | "market.sample_public_chapters"
  | "workflow.get_current_step"
  | "workflow.submit_step_output"
  | "workflow.report_blocker"
  | "workflow.list_recipes"
  | "workflow.get_recipe"
  | "workflow.edit_recipe"
  | "workflow.start_run";
type LegacyReadHandler = (input: Record<string, unknown>) => Promise<unknown> | unknown;

/** The Runtime schema validates model input; this adapter adds only trusted binding fields for legacy handlers. */
function bridgeLegacyHandler<TInput>(handler: (input: TInput) => Promise<unknown> | unknown): LegacyReadHandler {
  return (input) => handler(input as unknown as TInput);
}

const READY_LEGACY_HANDLERS: Readonly<Record<Exclude<ReadyRuntimeToolName, CustomReadyRuntimeToolName>, LegacyReadHandler>> = {
  "lore.read": bridgeLegacyHandler(handleLoreRead),
  "lore.write": bridgeLegacyHandler(handleLoreWrite),
  "lore.relate": bridgeLegacyHandler(handleLoreRelate),
  "lore.progress": bridgeLegacyHandler(handleLoreProgress),
  "memory.read": bridgeLegacyHandler(handleMemoryRead),
  "memory.graph": bridgeLegacyHandler(handleMemoryGraph),
  "memory.events": bridgeLegacyHandler(handleMemoryEvents),
  "memory.list": bridgeLegacyHandler(handleMemoryList),
  "memory.read_entry": bridgeLegacyHandler(handleMemoryReadEntry),
  "memory.search": bridgeLegacyHandler(handleMemorySearch),
  "memory.dedup": bridgeLegacyHandler(handleMemoryDedup),
  "memory.export": bridgeLegacyHandler(handleMemoryExport),
  "memory.stats": bridgeLegacyHandler(handleMemoryStats),
  "memory.update": bridgeLegacyHandler(handleMemoryUpdate),
  "memory.delete": bridgeLegacyHandler(handleMemoryDelete),
  "memory.bulk_approve": bridgeLegacyHandler(handleMemoryBulkApprove),
  "memory.bulk_delete": bridgeLegacyHandler(handleMemoryBulkDelete),
  "jingwei.audit": bridgeLegacyHandler(handleJingweiAudit),
  "jingwei.write": bridgeLegacyHandler(handleJingweiWrite),
  "jingwei.read": bridgeLegacyHandler(handleJingweiRead),
};

function fail(error: string, summary: string): RuntimeToolResult {
  return { ok: false, error, summary };
}

function trustedBookBinding(context: ToolExecutionContext): NovelBookRuntimeBinding | undefined {
  const binding = context.resourceBindings["novel.book"];
  if (
    !binding
    || binding.kind !== "novel.book"
    || typeof binding.bookId !== "string"
    || !binding.bookId.trim()
    || typeof binding.root !== "string"
    || !binding.root.trim()
  ) {
    return undefined;
  }
  return binding as NovelBookRuntimeBinding;
}

function requireBoundBookRoot(binding: NovelBookRuntimeBinding, bookId: string): string {
  if (bookId !== binding.bookId) throw new Error("The requested book does not match the trusted binding.");
  return binding.root;
}

function createBoundNovelState(
  binding: NovelBookRuntimeBinding,
): NarrativeLineState & CockpitState {
  return {
    bookDir: (bookId) => requireBoundBookRoot(binding, bookId),
    loadBookConfig: async (bookId) => {
      const bookRoot = requireBoundBookRoot(binding, bookId);
      const parsed = JSON.parse(await readFile(join(bookRoot, "book.json"), "utf8")) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error(`Invalid book.json for ${bookId}.`);
      }
      return parsed as BookConfig;
    },
    loadChapterIndex: async (bookId) => {
      const bookRoot = requireBoundBookRoot(binding, bookId);
      try {
        const parsed = JSON.parse(await readFile(join(bookRoot, "chapters", "index.json"), "utf8")) as unknown;
        if (!Array.isArray(parsed)) return [];
        return parsed.filter((entry): entry is ChapterMeta => (
          Boolean(entry)
          && typeof entry === "object"
          && typeof (entry as { number?: unknown }).number === "number"
        ));
      } catch {
        return [];
      }
    },
  };
}

/**
 * 剥掉 preview 里所有层级的宿主字段。
 *
 * narrative.propose_change 的结果需要能被模型原样回传给 narrative.approve_change。
 * 但服务端归一化会给 preview 本身以及每个 node/edge 都写上 bookId，而
 * containsHostControlledField 是递归检查的 —— 原样回传会被 forged-host-field
 * 拒绝，审批闭环就断在这里。书籍身份始终由可信绑定解析，模型不需要看到它。
 */
function toModelSafePreview(preview: NarrativeLineMutationPreview): Record<string, unknown> {
  const stripBookId = <T extends { readonly bookId?: string }>(items: readonly T[] | undefined) => (
    (items ?? []).map(({ bookId: _bookId, ...rest }) => rest)
  );
  const { bookId: _previewBookId, nodes, edges, ...rest } = preview;
  return {
    ...rest,
    nodes: stripBookId(nodes),
    edges: stripBookId(edges),
  };
}

export function normalizeToolName(name: string): string {
  return name.replace(/\./g, "_");
}

function matchesToolName(requested: string, catalogName: string): boolean {
  return requested === catalogName || normalizeToolName(requested) === normalizeToolName(catalogName);
}

/** Reject host-owned fields even when a caller bypasses model JSON-schema validation. */
function containsHostControlledField(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsHostControlledField);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value as Record<string, unknown>).some(([key, child]) => (
    HOST_CONTROLLED_FIELDS.has(key) || containsHostControlledField(child)
  ));
}

/**
 * Convert existing schema metadata into a model-safe, portable JSON Schema.
 *
 * 只有声明了 properties 的对象才收紧为 additionalProperties: false。
 * 自由载荷对象（cockpitSnapshot、loreBrief、memoryContext、memory.update 的 patch 等）
 * 本身没有字段清单，收紧后会把工具自己返回、原样回传的真实数据全部判非法 ——
 * narrative.approve_change 的 preview 已经踩过这个坑。
 */
export function toRuntimeInputSchema(schema: unknown): PortableJsonSchema {
  const sanitize = (value: unknown): PortableJsonValue => {
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (Array.isArray(value)) return value.map(sanitize);
    if (!value || typeof value !== "object") return String(value);

    const source = value as Record<string, unknown>;
    const isObjectSchema = source.type === "object";
    const declaresProperties = Boolean(
      source.properties && typeof source.properties === "object" && !Array.isArray(source.properties),
    );
    const result: Record<string, PortableJsonValue> = {};
    for (const [key, child] of Object.entries(source)) {
      if (key === "properties" && isObjectSchema && child && typeof child === "object" && !Array.isArray(child)) {
        const properties: Record<string, PortableJsonValue> = {};
        for (const [propertyName, propertySchema] of Object.entries(child as Record<string, unknown>)) {
          if (!HOST_CONTROLLED_FIELDS.has(propertyName)) properties[propertyName] = sanitize(propertySchema);
        }
        result.properties = properties;
        continue;
      }
      if (key === "required" && isObjectSchema && Array.isArray(child)) {
        result.required = child.filter((name): name is string => typeof name === "string" && !HOST_CONTROLLED_FIELDS.has(name));
        continue;
      }
      if (key === "additionalProperties" && isObjectSchema) continue;
      result[key] = sanitize(child);
    }
    if (isObjectSchema && declaresProperties) result.additionalProperties = false;
    return result;
  };

  return sanitize(schema) as PortableJsonSchema;
}

function toPortableValue(value: unknown): PortableJsonValue | undefined {
  if (value === undefined) return undefined;
  const serialized = JSON.stringify(value);
  return serialized === undefined ? undefined : JSON.parse(serialized) as PortableJsonValue;
}

function toRuntimeToolResult(result: unknown): RuntimeToolResult {
  if (!result || typeof result !== "object") {
    return fail("invalid-handler-result", "旧处理器返回了不可识别的结果。");
  }
  const source = result as Record<string, unknown>;
  if (typeof source.ok !== "boolean") {
    return fail("invalid-handler-result", "旧处理器结果缺少 ok 状态。");
  }

  try {
    const data = toPortableValue(source.data);
    return {
      ok: source.ok,
      ...(typeof source.summary === "string" ? { summary: source.summary } : {}),
      ...(typeof source.error === "string" ? { error: source.error } : {}),
      ...(data === undefined ? {} : { data }),
    };
  } catch {
    return fail("non-portable-handler-result", "旧处理器结果不能转换为可移植 JSON。");
  }
}

function isMarketTool(name: string): boolean {
  return matchesToolName(name, "market.scan")
    || matchesToolName(name, "market.query")
    || matchesToolName(name, "market.ranks")
    || matchesToolName(name, "market.sample_public_chapters");
}

async function executeMarketTool(
  tool: NovelRuntimeToolCatalogEntry,
  input: Readonly<Record<string, unknown>>,
): Promise<RuntimeToolResult> {
  if (containsHostControlledField(input)) {
    return fail("forged-host-field", "bookId、sessionId 和 bookRoot 只能由可信宿主绑定，不能由模型提供。");
  }
  try {
    if (matchesToolName(tool.name, "market.scan")) {
      return toRuntimeToolResult(await handleMarketScan({
        ...(typeof input.platform === "string" ? { platform: input.platform as "qidian" | "fanqie" | "all" } : {}),
        ...(Array.isArray(input.rankTypes) ? { rankTypes: input.rankTypes.filter((item): item is string => typeof item === "string") } : {}),
        ...(typeof input.maxPages === "number" ? { maxPages: input.maxPages } : {}),
        ...(Array.isArray(input.categories) ? { categories: input.categories.filter((item): item is string => typeof item === "string") } : {}),
        ...(typeof input.limit === "number" ? { limit: input.limit } : {}),
      }));
    }
    if (matchesToolName(tool.name, "market.query")) {
      return toRuntimeToolResult(await handleMarketQuery({
        ...(typeof input.platform === "string" ? { platform: input.platform as "qidian" | "fanqie" } : {}),
        ...(typeof input.rankType === "string" ? { rankType: input.rankType } : {}),
        ...(typeof input.fromDate === "string" ? { fromDate: input.fromDate } : {}),
        ...(typeof input.toDate === "string" ? { toDate: input.toDate } : {}),
        ...(typeof input.analyze === "boolean" ? { analyze: input.analyze } : {}),
        ...(Array.isArray(input.categories) ? { categories: input.categories.filter((item): item is string => typeof item === "string") } : {}),
        ...(typeof input.limit === "number" ? { limit: input.limit } : {}),
      }));
    }
    if (matchesToolName(tool.name, "market.ranks")) {
      return toRuntimeToolResult(await handleMarketRanks());
    }
    if (typeof input.fanqieBookId !== "string" || !input.fanqieBookId.trim()) {
      return fail("invalid-input", "market.sample_public_chapters 需要番茄公开书籍 fanqieBookId。");
    }
    return toRuntimeToolResult(await handleMarketSamplePublicChapters({
      fanqieBookId: input.fanqieBookId,
      ...(typeof input.maxChapters === "number" ? { maxChapters: input.maxChapters } : {}),
    }));
  } catch (error) {
    return fail("handler-failed", `市场工具执行失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

async function executeReadyToolImpl(
  tool: NovelRuntimeToolCatalogEntry,
  input: Readonly<Record<string, unknown>>,
  context: ToolExecutionContext,
): Promise<RuntimeToolResult> {
  if (isMarketTool(tool.name)) {
    return executeMarketTool(tool, input);
  }
  const binding = trustedBookBinding(context);
  if (!binding) {
    return fail("missing-resource-binding", "缺少可信的 novel.book 资源绑定，拒绝执行小说工具。");
  }
  if (containsHostControlledField(input)) {
    return fail("forged-host-field", "bookId、sessionId 和 bookRoot 只能由可信宿主绑定，不能由模型提供。");
  }

  const injectedInput: Record<string, unknown> = {
    ...input,
    bookId: binding.bookId,
    // bookRoot remains host-owned and lets memory.read load this book's
    // persisted narrativeMemory config without accepting a model path.
    bookRoot: binding.root,
  };
  try {
    const domainResult = await executeRuntimeDomainTool(tool.name, input, binding, context);
    if (domainResult) return domainResult;

    if (matchesToolName(tool.name, "cockpit.snapshot")) {
      const snapshot = await createCockpitService({ state: createBoundNovelState(binding) }).getSnapshot({
        bookId: binding.bookId,
      });
      return toRuntimeToolResult({
        ok: true,
        summary: "已读取驾驶舱快照。",
        data: { ...snapshot, storyDir: "story" },
      });
    }
    if (matchesToolName(tool.name, "write.preflight")) {
      const { handleWritePreflight } = await import("./handlers/write-preflight.js");
      const preflight = await handleWritePreflight({
        bookId: binding.bookId,
        bookRoot: binding.root,
        cockpitState: createBoundNovelState(binding),
        ...(typeof injectedInput.chapterNumber === "number" ? { chapterNumber: injectedInput.chapterNumber } : {}),
        ...(typeof injectedInput.userDirectives === "string" ? { userDirectives: injectedInput.userDirectives } : {}),
        ...(typeof injectedInput.acceptFocusDefault === "boolean"
          ? { acceptFocusDefault: injectedInput.acceptFocusDefault }
          : {}),
        ...(Array.isArray(injectedInput.acknowledgedSkills)
          ? { acknowledgedSkills: injectedInput.acknowledgedSkills as never }
          : {}),
        ...(context.loadedSkills ? { loadedSkills: context.loadedSkills } : {}),
        ...(typeof injectedInput.userDirectives === "string"
          ? { taskText: injectedInput.userDirectives }
          : {}),
      });
      const blockerText = preflight.blockers.length > 0
        ? ` blockers=${preflight.blockers.map((item) => item.code).join(",")}`
        : "";
      return toRuntimeToolResult({
        ok: preflight.ok,
        summary: preflight.ok
          ? `写前上下文就绪：第${preflight.chapterNumber}章，近章 ${preflight.recentChapters.length} 条。`
          : `写前上下文未就绪：${preflight.blockers.map((item) => item.message).join("；") || "存在 blockers"}${blockerText}`,
        ...(preflight.ok ? {} : { error: "context-not-ready" }),
        data: preflight,
      });
    }
    if (matchesToolName(tool.name, "memory.settle_range")) {
      const { handleMemorySettleRange } = await import("./handlers/memory-settle-range.js");
      const { createRuntimeChapterEventExtractor } = await import("./engine/narrative-memory/chapter-event-extractor.js");
      if (typeof injectedInput.fromChapter !== "number" || typeof injectedInput.toChapter !== "number") {
        return fail("invalid-input", "fromChapter/toChapter 必须是数字。");
      }
      const result = await handleMemorySettleRange({
        bookId: binding.bookId,
        bookRoot: binding.root,
        fromChapter: injectedInput.fromChapter,
        toChapter: injectedInput.toChapter,
        ...(typeof injectedInput.source === "string"
          ? { source: injectedInput.source as "accepted-resources" | "chapter-files" }
          : {}),
        ...(typeof injectedInput.dryRun === "boolean" ? { dryRun: injectedInput.dryRun } : {}),
        // 补结算同样走 LLM 抽取：用 host 的 generateText 能力构造；缺失时抽取失败、
        // 对应章保持未结算，agent 重新调用本工具即可补上。
        ...(context.generateText ? { llmExtractor: createRuntimeChapterEventExtractor(context.generateText) } : {}),
      });
      return toRuntimeToolResult({
        ok: result.ok,
        summary: result.summary,
        ...(result.ok ? {} : { error: result.error ?? "settle-range-failed" }),
        data: result,
      });
    }
    if (matchesToolName(tool.name, "chapter.discard_range")) {
      const { handleChapterDiscardRange } = await import("./handlers/chapter-discard-range.js");
      if (typeof injectedInput.fromChapter !== "number" || typeof injectedInput.toChapter !== "number") {
        return fail("invalid-input", "fromChapter/toChapter 必须是数字。");
      }
      if (injectedInput.confirm !== true) {
        return fail("confirm-required", "chapter.discard_range 必须 confirm=true。");
      }
      const result = await handleChapterDiscardRange({
        bookId: binding.bookId,
        bookRoot: binding.root,
        fromChapter: injectedInput.fromChapter,
        toChapter: injectedInput.toChapter,
        confirm: true,
        ...(typeof injectedInput.deleteMemory === "boolean" ? { deleteMemory: injectedInput.deleteMemory } : {}),
        ...(typeof injectedInput.resetHooks === "string"
          ? { resetHooks: injectedInput.resetHooks as "untouched" | "planned-only" | "none" }
          : {}),
        ...(typeof injectedInput.hardDelete === "boolean" ? { hardDelete: injectedInput.hardDelete } : {}),
      });
      return toRuntimeToolResult({
        ok: result.ok,
        summary: result.summary,
        ...(result.ok ? {} : { error: result.error ?? "discard-range-failed" }),
        data: result,
      });
    }
    if (matchesToolName(tool.name, "chapter.read")) {
      if (typeof injectedInput.chapterNumber !== "number" || !Number.isInteger(injectedInput.chapterNumber)) {
        return fail("invalid-input", "chapterNumber 必须是整数。");
      }
      return toRuntimeToolResult(await handleChapterRead(
        { bookId: binding.bookId, chapterNumber: injectedInput.chapterNumber },
        undefined,
        { bookRoot: binding.root },
      ));
    }
    if (matchesToolName(tool.name, "chapter.write")) {
      if (typeof injectedInput.chapterNumber !== "number" || !Number.isInteger(injectedInput.chapterNumber)) {
        return fail("invalid-input", "chapterNumber 必须是整数。");
      }
      if (typeof injectedInput.content !== "string") {
        return fail("invalid-input", "content 必须是字符串。");
      }
      return toRuntimeToolResult(await handleChapterWrite(
        { bookId: binding.bookId, chapterNumber: injectedInput.chapterNumber, content: injectedInput.content },
        { bookRoot: binding.root, storage: getStorageDatabase() },
      ));
    }
    if (matchesToolName(tool.name, "chapter.list")) {
      const chapters = await createBoundNovelState(binding).loadChapterIndex(binding.bookId);
      const items = chapters.map((chapter) => ({
        number: chapter.number,
        title: chapter.title ?? `第${chapter.number}章`,
        wordCount: chapter.wordCount ?? 0,
        status: chapter.status ?? "draft",
      }));
      return toRuntimeToolResult({
        ok: true,
        summary: `共 ${items.length} 章。`,
        data: { bookId: binding.bookId, chapters: items },
      });
    }
    if (matchesToolName(tool.name, "narrative.read_line")) {
      const service = createNarrativeLineService({ state: createBoundNovelState(binding) });
      const snapshot = await service.getSnapshot({
        bookId: binding.bookId,
        includeWarnings: injectedInput.includeWarnings !== false,
      });
      return toRuntimeToolResult({ ok: true, summary: "已读取叙事线快照。", data: snapshot });
    }
    if (matchesToolName(tool.name, "narrative.propose_change")) {
      if (typeof injectedInput.summary !== "string" || !injectedInput.summary.trim()) {
        return fail("invalid-input", "summary 必须是非空字符串。");
      }
      const service = createNarrativeLineService({ state: createBoundNovelState(binding) });
      const preview = await service.proposeChange({
        bookId: binding.bookId,
        summary: injectedInput.summary,
        ...(Array.isArray(injectedInput.nodes) ? { nodes: injectedInput.nodes } : {}),
        ...(Array.isArray(injectedInput.edges) ? { edges: injectedInput.edges } : {}),
        ...(Array.isArray(injectedInput.removeNodeIds) ? { removeNodeIds: injectedInput.removeNodeIds } : {}),
        ...(Array.isArray(injectedInput.removeEdgeIds) ? { removeEdgeIds: injectedInput.removeEdgeIds } : {}),
        ...(typeof injectedInput.reason === "string" ? { reason: injectedInput.reason } : {}),
      });
      return toRuntimeToolResult({
        ok: true,
        summary: "已生成叙事线变更草案。",
        data: toModelSafePreview(preview),
      });
    }
    if (matchesToolName(tool.name, "narrative.approve_change")) {
      const decision = injectedInput.decision === "approved" || injectedInput.decision === "rejected"
        ? injectedInput.decision
        : null;
      if (!decision) return fail("invalid-input", "decision 必须是 approved 或 rejected。");
      const rawPreview = injectedInput.preview;
      if (!rawPreview || typeof rawPreview !== "object" || Array.isArray(rawPreview)) {
        return fail("invalid-input", "preview 必须是 narrative.propose_change 返回的对象。");
      }
      const previewRecord = rawPreview as Record<string, unknown>;
      if (typeof previewRecord.summary !== "string" || !previewRecord.summary.trim()) {
        return fail("invalid-input", "preview.summary 必须是非空字符串。");
      }
      const service = createNarrativeLineService({ state: createBoundNovelState(binding) });
      // bookId 一律取可信绑定，忽略 preview 里携带的值。
      const result = await service.applyChange({
        bookId: binding.bookId,
        preview: {
          id: typeof previewRecord.id === "string" ? previewRecord.id : `narrative-preview:${binding.bookId}:runtime`,
          bookId: binding.bookId,
          summary: previewRecord.summary,
          ...(Array.isArray(previewRecord.nodes) ? { nodes: previewRecord.nodes as never } : {}),
          ...(Array.isArray(previewRecord.edges) ? { edges: previewRecord.edges as never } : {}),
          ...(Array.isArray(previewRecord.removeNodeIds)
            ? { removeNodeIds: previewRecord.removeNodeIds.filter((id): id is string => typeof id === "string") }
            : {}),
          ...(Array.isArray(previewRecord.removeEdgeIds)
            ? { removeEdgeIds: previewRecord.removeEdgeIds.filter((id): id is string => typeof id === "string") }
            : {}),
        },
        decision,
        ...(typeof injectedInput.reason === "string" ? { reason: injectedInput.reason } : {}),
      });
      return toRuntimeToolResult({
        ok: true,
        summary: result.applied ? "叙事线变更已应用。" : "叙事线变更已驳回，并记入审批台账。",
        data: { ...result, preview: toModelSafePreview(result.preview) },
      });
    }
    if (matchesToolName(tool.name, "writing-skills.read")) {
      return toRuntimeToolResult(await handleWritingSkillsRead({
        bookId: binding.bookId,
        ...(injectedInput.scope === "available" || injectedInput.scope === "enabled"
          ? { scope: injectedInput.scope }
          : {}),
      }, { bookRoot: binding.root }));
    }
    if (matchesToolName(tool.name, "writing-skills.write")) {
      return toRuntimeToolResult(await handleWritingSkillsWrite({
        bookId: binding.bookId,
        ...(Array.isArray(injectedInput.addSkillIds)
          ? { addSkillIds: injectedInput.addSkillIds.filter((id): id is string => typeof id === "string") }
          : {}),
        ...(Array.isArray(injectedInput.removeSkillIds)
          ? { removeSkillIds: injectedInput.removeSkillIds.filter((id): id is string => typeof id === "string") }
          : {}),
        ...(Array.isArray(injectedInput.refreshSkillIds)
          ? { refreshSkillIds: injectedInput.refreshSkillIds.filter((id): id is string => typeof id === "string") }
          : {}),
      }, { bookRoot: binding.root }));
    }
    if (matchesToolName(tool.name, "writing-skills.recommend")) {
      return toRuntimeToolResult(await handleWritingSkillsRecommend({
        bookId: binding.bookId,
        ...(typeof injectedInput.maxCount === "number" ? { maxCount: injectedInput.maxCount } : {}),
      }, { bookRoot: binding.root }));
    }
    if (matchesToolName(tool.name, "writing-skills.check_compliance")) {
      return toRuntimeToolResult(await handleWritingSkillsCheckCompliance({
        bookId: binding.bookId,
        content: typeof injectedInput.content === "string" ? injectedInput.content : "",
        ...(typeof injectedInput.chapterNumber === "number" ? { chapterNumber: injectedInput.chapterNumber } : {}),
        ...(context.loadedSkills ? { loadedSkills: context.loadedSkills } : {}),
      }, { bookRoot: binding.root }));
    }
    if (matchesToolName(tool.name, "writing-skills.import_legacy")) {
      return toRuntimeToolResult(await handleWritingSkillsImportLegacy({
        bookId: binding.bookId,
      }, { bookRoot: binding.root }));
    }
    if (matchesToolName(tool.name, "resource.manage")) {
      const action = typeof injectedInput.action === "string" ? injectedInput.action : "";
      const storage = getStorageDatabase();
      const service = createWritingResourceService({
        storage,
        resolveBookDir: (bookId) => requireBoundBookRoot(binding, bookId),
        resolveChapterVolumeDirectory: (bookId, chapterNumber) => resolveChapterVolumeDirectory(
          storage,
          bookId,
          chapterNumber,
        ),
      });
      if (action === "list") {
        const filter = injectedInput.filter && typeof injectedInput.filter === "object"
          ? injectedInput.filter as Record<string, unknown>
          : {};
        // 写作资源只有正式章节：候选稿/草稿过滤值已下线，旧参数按未指定处理。
        const type = filter.type === "chapter" ? filter.type : undefined;
        const status = filter.status === "accepted" || filter.status === "archived"
          ? filter.status
          : undefined;
        const resources = await service.list(binding.bookId, {
          ...(type ? { type } : {}),
          ...(status ? { status } : {}),
        });
        const items = resources.map((resource) => ({
          id: resource.id,
          type: resource.type,
          status: resource.status,
          title: resource.title,
          chapterNumber: resource.chapterNumber,
          wordCount: resource.wordCount,
        }));
        return toRuntimeToolResult({
          ok: true,
          summary: `共 ${items.length} 个写作资源。`,
          data: { bookId: binding.bookId, resources: items },
        });
      }
      const resourceId = typeof injectedInput.resourceId === "string" ? injectedInput.resourceId.trim() : "";
      if (!resourceId) return fail("invalid-input", "action 非 list 时 resourceId 必填。");
      if (action === "archive") {
        const resource = await service.update(binding.bookId, resourceId, { status: "archived" });
        return toRuntimeToolResult({ ok: true, summary: `已归档资源「${resource.title}」。`, data: { resource } });
      }
      if (action === "delete") {
        const resource = await service.softDelete(binding.bookId, resourceId);
        return toRuntimeToolResult({ ok: true, summary: `已删除资源「${resource.title}」。`, data: { resource } });
      }
      return fail("invalid-input", `未知 action: ${action}。支持 list/archive/delete。`);
    }

    const handler = READY_LEGACY_HANDLERS[tool.name as Exclude<ReadyRuntimeToolName, CustomReadyRuntimeToolName>];
    return toRuntimeToolResult(await handler(injectedInput));
  } catch (error) {
    return fail("handler-failed", `小说工具执行失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

async function executeReadyTool(
  tool: NovelRuntimeToolCatalogEntry,
  input: Readonly<Record<string, unknown>>,
  context: ToolExecutionContext,
): Promise<RuntimeToolResult> {
  // 工具直接使用当前 Runtime Agent 上下文；禁止包装出任何内部模型调用链。
  return executeReadyToolImpl(tool, input, context);
}

const READY_RUNTIME_TOOLS = NOVEL_RUNTIME_TOOL_CATALOG.filter(
  (tool): tool is NovelRuntimeToolCatalogEntry & { readonly runtimeStatus: "ready" } => tool.runtimeStatus === "ready",
);

export const NOVEL_RUNTIME_CONTRIBUTION: RuntimePluginContribution = {
  id: "novelfork-novel",
  projectTypes: ["novel"],
  promptExtensions: [
    {
      id: "novelfork-novel.workflow",
      content: NOVEL_RUNTIME_SYSTEM_PROMPT,
      position: "after",
      order: 100,
      agentId: "novelist",
    },
  ],
  agentPresets: [
    {
      id: "novelist",
      name: "小说创作",
      tools: READY_RUNTIME_TOOLS.map((tool) => tool.name),
      systemPromptSuffix: NOVEL_RUNTIME_SYSTEM_PROMPT,
    },
  ],
  learning: NOVEL_LEARNING_CONTRIBUTION,
  tools: READY_RUNTIME_TOOLS.map((tool) => ({
    definition: {
      name: tool.name,
      description: tool.description,
      inputSchema: toRuntimeInputSchema(tool.inputSchema),
      renderer: tool.renderer,
      risk: tool.risk,
      enabledForModes: tool.enabledForModes,
      visibility: tool.visibility,
      scope: tool.scope,
    },
    handler: (input, context) => executeReadyTool(tool, input, context),
  })),
};
