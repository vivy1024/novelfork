import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
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
import {
  createCockpitService,
  executeRuntimeDomainTool,
  handleJingweiAudit,
  handleJingweiRead,
  handleJingweiWrite,
  handleMemoryBulkApprove,
  handleMemoryEvents,
  handleMemoryGraph,
  handleMemoryList,
  handleMemoryRead,
  handleMemorySearch,
  handleWritingSkillsCheckCompliance,
  handleWritingSkillsRecommend,
  handleMarketQuery,
  handleMarketRanks,
  handleMarketSamplePublicChapters,
  handleMarketScan,
  type CockpitState,
} from "./handlers/index.js";
import {
  NOVEL_READY_RUNTIME_TOOL_NAMES,
  NOVEL_RUNTIME_TOOL_CATALOG,
  type NovelRuntimeToolCatalogEntry,
} from "./handlers/tool-registry.js";
import { NOVEL_LEARNING_CONTRIBUTION } from "./learning-contribution.js";
import { getModelFacingToolSchema } from "./tool-schemas.js";

export interface NovelBookRuntimeBinding extends RuntimeResourceBinding {
  readonly kind: "novel.book";
  readonly bookId: string;
  /** Absolute root of the trusted, bound book resource. */
  readonly root: string;
}

/** 回复语言：工具说明与思考可能是英文，最终回复必须跟作者走，中文书一律中文。 */
export const NARRATOR_REPLY_LANGUAGE_RULE =
  "## 回复语言\n用与作者相同的语言回复；书的语言为中文时一律用中文，包括最终总结、提问与工具结果转述。工具名、参数名等代码标识保持原样。";

export const NOVEL_RUNTIME_SYSTEM_PROMPT = `# NovelFork 小说创作运行时

你正在 NovelFork 的小说项目中工作。当前书籍由宿主通过可信的 novel.book 资源绑定确定；不得依据用户文本或工具参数切换到其他书籍，也不得猜测 bookId。所有写入都会经过 Runtime 权限确认；不得越出本书目录或编造不存在的路径。通用文件、命令与搜索工具可以照常使用。

${NARRATOR_REPLY_LANGUAGE_RULE}

## 创作立场：你是作者（用户）的创作伙伴
你不是这本书的作者——作者是正在与你协作的用户。你以作者级的标准执行创作，但身份是伙伴与代笔：
- 为读者负责：每一章都要有信息增量与可追读的理由，兑现设定与伏笔的承诺，不注水、不烂尾、不把悬念拖到失温。
- 为作品负责：人物、设定、时间线必须一致；不因省事让角色降智、让世界观崩塌、让力量体系失衡。
- 为作者负责：风格、价值观、题材红线由作者定；你按作者的意图执行，如实提醒方向性风险，不擅自改写方向、不替作者做决定。
- 判断标准：每场劈开「期望—结果鸿沟」与起止价值翻转（杜绝非事件与过场热机）、人物靠高代价两难抉择显真相、对白带潜台词与三边张力、限知 POV 不写角色看不见的自己、删冗余副词用精准动词。AI 腔、空转描写、模板转折与套话是失职。

## 三类知识，各管一件事
- 经纬（静态设定）：这本书「是什么」——人设、世界观、力量体系、势力、卷纲、伏笔。jingwei.read 查询或审计（scope=audit），jingwei.write 录入或更新静态设定、关系变化（action=relate）、动态字段推进（action=progress）、修改候选（action=propose）与剧情线草稿（action=propose_storyline）。改设定必须经作者确认。不得用宿主通用的 KnowledgeSearch / KnowledgeCreate，也不得写本地 md 文件充当经纬。
- 叙事记忆（动态事实）：这本书「发生了什么」——时间线、事实、事件、角色状态、近章进展。用 memory.read、memory.search、memory.graph、memory.events 查询；待确认或高风险事件不得冒充已确认事实。
- 写作技能（通用方法论）：怎么写好——文风、节奏、钩子、去 AI 味、平台规则。启用的技能物化在 .novelfork/skills/<slug>/SKILL.md，用 Skill 工具读取。
- 边界：经纬只放静态设定，动态事实只进叙事记忆；方法论与设定不互相充当。当前聚焦只认创作罗盘（current-focus 分类），强制约束与禁忌只认 rules 分类，不写 md 文件充当；文风只来自本书导入或蒸馏，不跨书注入口吻。

## 写新章
1. 顺序：chapter.preflight →（作者确认一句本章指示）→ 按需读技能 → chapter.blueprint → EnterPlanMode + ExitPlanMode 呈蓝图审批 → 原生 Write 写正文到 targetChapterPath → chapter.commit。
2. 写前查：前情以 chapter.preflight 返回的 recall.text 为准；新角色、新地点、新规则先用 jingwei.read 查有没有既有设定，查不到就如实说「设定缺失」并建议补充，禁止现编一个当 canon 用。
3. 技能：按各技能的 description 判断本章该读哪些，用 Skill 工具读取。成品必须满足 preflight 返回的 writingSkillConstraints；severity=error 的条目在提交时逐条校验，不满足就拒存，改好文件后重新调用 chapter.commit。
4. 只用产品内的 focus、近章事实、经纬摘要、伏笔与作者的一句指示；禁止用写作理论、文风大道理或外部项目总结填空。
5. 蓝图审批与流式写盘：先调 chapter.blueprint 校验并缓存结构化蓝图，随即调用 EnterPlanMode 与 ExitPlanMode（mode="inline"，直接提交返回的 planMarkdown）呈给作者审批修改（开启自动反思放行时由 Runtime 自动通过）；审批通过后，用原生 Write 把正文写入 targetChapterPath（写作台实时流式呈现），写完立刻调 chapter.commit 审计、入库、自动 Git 记录并结算。审计未过用原生 Edit 改后重交 chapter.commit。

## 写后沉淀
- chapter.commit 落盘后会自动发起一次 memory.settle，面板可见。返回 settlementError 时正文已保存，由你重试 memory.settle 结算本章，不要让作者自己调工具；历史章节空洞同样用 memory.settle（传 fromChapter/toChapter）回填。
- 本章出现新角色、新地点、新规则：用 jingwei.write 落经纬草稿（needs-review），作者确认后才升 canon；关系变化用 action=relate，动态字段推进用 action=progress。

## 停写与高风险事件放行
chapter.preflight 或 chapter.commit 返回 blockers 时立即停写，不得硬写，也不得换工具绕过；没有可用文本模型时如实说明阻塞。缺指示、近章记忆空等缺口只报告给作者。high-risk-pending（高风险事件待确认）按以下流程放行，不替作者做选择：① memory.events（action=list）取出待确认事件；② 用 AskUserQuestion 同步问作者（每次最多 4 条，多了分批），每条选「批准」或「驳回」；③ 按作者的选择逐条调用 memory.events 的 approve / reject，作者也可以直接在「待确认」面板处理；④ 全部处理完再重新 chapter.preflight，通过后再写。

## 读章与改稿
- 读章节或局部改稿：先用 chapter.list 获取章节相对路径 path，直接用原生 Read 读取，用原生 Edit 局部修改或 Write 整章覆盖；改完后调用 chapter.commit（mode=revision）同步字数索引、刷新审计并重新结算。
- 作者从写作台划词发来续写、润色、改写、扩写或精简请求时：你先生成候选文本，再调用 chapter.propose_selection；requestId、chapterNumber、from、to、sourceText 原样带回，candidateText 填你生成的新文。工具只把候选交回写作台，不改文件。

## 其他场景（触发 → 工具）
- 全局概览 → book.overview；章节目录 → chapter.list。
- 续写旧书与拆书 → book.import（action=import_chapters 或 action=dissect）；拆书产物是待审草稿，作者确认后才 jingwei.write。
- 学习文风 → style.manage（index / preview / start / status / adopt / consolidate / negative_override）；只采纳作者点名确认的条目。start 在后台跑批并立即返回 jobId，之后用 status 查进度，跑完再读待审条目，不要重复 start。
- 角色核查、弧线与声线 → character.inspect（consistency / arc_status / arc_sync / voice_read / voice_draft）；待审声线须作者确认后才生效。
- 中盘防跑偏 → outline.volume 维护卷纲与终局储备，overdraft 告警如实转述并建议改纲；hooks.manage 管理伏笔。
- 质量审校与投稿自检 → chapter.audit（mode=quality 质量审计 | mode=publish 投稿风险自检）。
- 市场榜单调研 → market.radar（ranks / scan / query / sample）；工作流执行与方案 → workflow.step / workflow.manage。

查询、讨论、查看设定时只做所需的读取，不要强行进入写章流程。`;

const HOST_CONTROLLED_FIELDS = new Set(["bookId", "sessionId", "bookRoot", "skipContextGate", "writePreflight"]);
type ReadyRuntimeToolName = (typeof NOVEL_READY_RUNTIME_TOOL_NAMES)[number];
type CustomReadyRuntimeToolName =
  | "book.overview"
  | "chapter.preflight"
  | "chapter.blueprint"
  | "chapter.commit"
  | "chapter.list"
  | "chapter.audit"
  | "chapter.propose_selection"
  | "chapter.discard_range"
  | "jingwei.read"
  | "jingwei.write"
  | "hooks.manage"
  | "outline.volume"
  | "memory.search"
  | "memory.events"
  | "memory.settle"
  | "character.inspect"
  | "style.manage"
  | "mechanism.distill"
  | "book.import"
  | "market.radar"
  | "skills.manage"
  | "workflow.step"
  | "workflow.manage";
type LegacyReadHandler = (input: Record<string, unknown>) => Promise<unknown> | unknown;

function bridgeLegacyHandler<TInput>(handler: (input: TInput) => Promise<unknown> | unknown): LegacyReadHandler {
  return (input) => handler(input as unknown as TInput);
}

const READY_LEGACY_HANDLERS: Readonly<Record<Exclude<ReadyRuntimeToolName, CustomReadyRuntimeToolName>, LegacyReadHandler>> = {
  "memory.read": bridgeLegacyHandler(handleMemoryRead),
  "memory.graph": bridgeLegacyHandler(handleMemoryGraph),
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
): CockpitState {
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
 * 只有声明了 properties 的对象才收紧为 additionalProperties: false。
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
    const explicitlyOpen = source.additionalProperties === true;
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
    if (isObjectSchema && explicitlyOpen) {
      result.additionalProperties = true;
    } else if (isObjectSchema && declaresProperties) {
      result.additionalProperties = false;
    }
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
    return fail("invalid-handler-result", "处理器返回了不可识别的结果。");
  }
  const source = result as Record<string, unknown>;
  if (typeof source.ok !== "boolean") {
    return fail("invalid-handler-result", "处理器结果缺少 ok 状态。");
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
    return fail("non-portable-handler-result", "处理器结果不能转换为可移植 JSON。");
  }
}

function isMarketTool(name: string): boolean {
  return matchesToolName(name, "market.radar");
}

async function executeMarketRadarTool(
  input: Readonly<Record<string, unknown>>,
): Promise<RuntimeToolResult> {
  if (containsHostControlledField(input)) {
    return fail("forged-host-field", "bookId、sessionId 和 bookRoot 只能由可信宿主绑定，不能由模型提供。");
  }
  const action = typeof input.action === "string" ? input.action.trim().toLowerCase() : "";
  try {
    if (action === "ranks") {
      return toRuntimeToolResult(await handleMarketRanks());
    }
    if (action === "scan") {
      return toRuntimeToolResult(await handleMarketScan({
        ...(typeof input.platform === "string" ? { platform: input.platform as "qidian" | "fanqie" | "all" } : {}),
        ...(Array.isArray(input.rankTypes) ? { rankTypes: input.rankTypes.filter((item): item is string => typeof item === "string") } : {}),
        ...(typeof input.maxPages === "number" ? { maxPages: input.maxPages } : {}),
        ...(Array.isArray(input.categories) ? { categories: input.categories.filter((item): item is string => typeof item === "string") } : {}),
        ...(typeof input.limit === "number" ? { limit: input.limit } : {}),
      }));
    }
    if (action === "query") {
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
    if (action === "sample") {
      if (typeof input.fanqieBookId !== "string" || !input.fanqieBookId.trim()) {
        return fail("invalid-input", "market.radar(action=sample) 需要番茄公开书籍 fanqieBookId。");
      }
      return toRuntimeToolResult(await handleMarketSamplePublicChapters({
        fanqieBookId: input.fanqieBookId,
        ...(typeof input.maxChapters === "number" ? { maxChapters: input.maxChapters } : {}),
      }));
    }
    return fail("invalid-action", `未知的 market.radar action：${String(input.action ?? "")}。支持 ranks | scan | query | sample。`);
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
    return executeMarketRadarTool(input);
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
    bookRoot: binding.root,
  };
  try {
    const domainResult = await executeRuntimeDomainTool(tool.name, input, binding, context);
    if (domainResult) return domainResult;

    if (matchesToolName(tool.name, "book.overview")) {
      const snapshot = await createCockpitService({ state: createBoundNovelState(binding) }).getSnapshot({
        bookId: binding.bookId,
      });
      return toRuntimeToolResult({
        ok: true,
        summary: "已读取全书概览。",
        data: { ...snapshot, storyDir: "story" },
      });
    }
    if (matchesToolName(tool.name, "chapter.preflight")) {
      const { handleWritePreflight } = await import("./handlers/write-preflight.js");
      const preflight = await handleWritePreflight({
        bookId: binding.bookId,
        bookRoot: binding.root,
        ...(context.sessionId ? { sessionId: context.sessionId } : {}),
        cockpitState: createBoundNovelState(binding),
        ...(typeof injectedInput.chapterNumber === "number" ? { chapterNumber: injectedInput.chapterNumber } : {}),
        ...(typeof injectedInput.userDirectives === "string" ? { userDirectives: injectedInput.userDirectives } : {}),
        ...(typeof injectedInput.acceptFocusDefault === "boolean"
          ? { acceptFocusDefault: injectedInput.acceptFocusDefault }
          : {}),
        ...(context.loadedSkills ? { loadedSkills: context.loadedSkills } : {}),
        ...(typeof injectedInput.userDirectives === "string"
          ? { taskText: injectedInput.userDirectives }
          : {}),
        buildRecall: true,
        ...(injectedInput.sceneSpec && typeof injectedInput.sceneSpec === "object" && !Array.isArray(injectedInput.sceneSpec)
          ? { sceneSpec: injectedInput.sceneSpec as never }
          : {}),
        ...(Array.isArray(injectedInput.pinnedSampleIds)
          ? { pinnedSampleIds: injectedInput.pinnedSampleIds.filter((item): item is string => typeof item === "string") }
          : {}),
      });
      const blockerText = preflight.blockers.length > 0
        ? ` blockers=${preflight.blockers.map((item) => item.code).join(",")}`
        : "";
      const pathHint = preflight.targetChapterPath ? ` 目标路径：${preflight.targetChapterPath}。` : "";
      return toRuntimeToolResult({
        ok: preflight.ok,
        summary: preflight.ok
          ? `写前上下文就绪：第${preflight.chapterNumber}章，近章 ${preflight.recentChapters.length} 条。${pathHint}${preflight.recall ? `已召回写前资料约 ${preflight.recall.estimatedTokens} tokens；先提交 chapter.blueprint，再用原生 Write 写盘到目标路径，最后调用 chapter.commit 入库结算。` : ""}`
          : `写前上下文未就绪：${preflight.blockers.map((item) => item.message).join("；") || "存在 blockers"}${blockerText}`,
        ...(preflight.ok ? {} : { error: "context-not-ready" }),
        data: preflight,
      });
    }
    if (matchesToolName(tool.name, "chapter.list")) {
      const chapters = await createBoundNovelState(binding).loadChapterIndex(binding.bookId);
      const fromChapter = typeof injectedInput.fromChapter === "number" && Number.isFinite(injectedInput.fromChapter)
        ? injectedInput.fromChapter
        : undefined;
      const toChapter = typeof injectedInput.toChapter === "number" && Number.isFinite(injectedInput.toChapter)
        ? injectedInput.toChapter
        : undefined;
      const statusFilter = typeof injectedInput.status === "string" && injectedInput.status.trim()
        ? injectedInput.status.trim().toLowerCase()
        : undefined;
      const items = chapters
        .map((chapter) => {
          const fileName = typeof (chapter as unknown as { fileName?: unknown }).fileName === "string"
            ? (chapter as unknown as { fileName: string }).fileName
            : undefined;
          return {
            number: chapter.number,
            title: chapter.title ?? `第${chapter.number}章`,
            ...(fileName ? { path: fileName.startsWith("chapters/") ? fileName : `chapters/${fileName}` } : {}),
            wordCount: chapter.wordCount ?? 0,
            status: chapter.status ?? "draft",
          };
        })
        .filter((item) => (
          (fromChapter === undefined || item.number >= fromChapter)
          && (toChapter === undefined || item.number <= toChapter)
          && (statusFilter === undefined || item.status.toLowerCase() === statusFilter)
        ));
      return toRuntimeToolResult({
        ok: true,
        summary: `共 ${items.length} 章。`,
        data: { bookId: binding.bookId, chapters: items },
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
    if (matchesToolName(tool.name, "jingwei.read")) {
      const scope = typeof injectedInput.scope === "string" ? injectedInput.scope.trim().toLowerCase() : "brief";
      if (scope === "audit") {
        return toRuntimeToolResult(await handleJingweiAudit({
          bookId: binding.bookId,
          ...(Array.isArray(injectedInput.entryIds)
            ? { entryIds: injectedInput.entryIds.filter((item): item is string => typeof item === "string") }
            : {}),
          ...(typeof injectedInput.chapterNumber === "number" ? { chapterNumber: injectedInput.chapterNumber } : {}),
        }));
      }
      return toRuntimeToolResult(await handleJingweiRead(injectedInput as unknown as Parameters<typeof handleJingweiRead>[0]));
    }
    if (matchesToolName(tool.name, "jingwei.write")) {
      return toRuntimeToolResult(await handleJingweiWrite(injectedInput as unknown as Parameters<typeof handleJingweiWrite>[0]));
    }
    if (matchesToolName(tool.name, "memory.search")) {
      const mode = typeof injectedInput.mode === "string" ? injectedInput.mode.trim().toLowerCase() : "facts";
      if (mode === "text") {
        const { handleMemorySearchText } = await import("./handlers/memory-search-text.js");
        return toRuntimeToolResult(await handleMemorySearchText({
          bookId: binding.bookId,
          bookRoot: binding.root,
          query: typeof injectedInput.query === "string" ? injectedInput.query : "",
          ...(injectedInput.match === "any" || injectedInput.match === "all" ? { match: injectedInput.match } : {}),
          ...(typeof injectedInput.fromChapter === "number" ? { fromChapter: injectedInput.fromChapter } : {}),
          ...(typeof injectedInput.toChapter === "number" ? { toChapter: injectedInput.toChapter } : {}),
          ...(typeof injectedInput.limit === "number" ? { limit: injectedInput.limit } : {}),
        }));
      }
      if (mode === "list") {
        return toRuntimeToolResult(await handleMemoryList(injectedInput as unknown as Parameters<typeof handleMemoryList>[0]));
      }
      if (mode === "facts") {
        return toRuntimeToolResult(await handleMemorySearch(injectedInput as unknown as Parameters<typeof handleMemorySearch>[0]));
      }
      return fail("invalid-mode", `未知的 memory.search mode：${String(injectedInput.mode ?? "")}。支持 facts | text | list。`);
    }
    if (matchesToolName(tool.name, "memory.events")) {
      const action = typeof injectedInput.action === "string" ? injectedInput.action.trim().toLowerCase() : "";
      if (action === "bulk_approve") {
        return toRuntimeToolResult(await handleMemoryBulkApprove(injectedInput as unknown as Parameters<typeof handleMemoryBulkApprove>[0]));
      }
      return toRuntimeToolResult(await handleMemoryEvents(injectedInput as unknown as Parameters<typeof handleMemoryEvents>[0]));
    }
    if (matchesToolName(tool.name, "skills.manage")) {
      const action = typeof injectedInput.action === "string" ? injectedInput.action.trim().toLowerCase() : "";
      if (action === "recommend") {
        return toRuntimeToolResult(await handleWritingSkillsRecommend({
          bookId: binding.bookId,
          ...(typeof injectedInput.maxCount === "number" ? { maxCount: injectedInput.maxCount } : {}),
        }, { bookRoot: binding.root }));
      }
      if (action === "check_compliance") {
        return toRuntimeToolResult(await handleWritingSkillsCheckCompliance({
          bookId: binding.bookId,
          content: typeof injectedInput.content === "string" ? injectedInput.content : "",
          ...(typeof injectedInput.chapterNumber === "number" ? { chapterNumber: injectedInput.chapterNumber } : {}),
          ...(context.loadedSkills ? { loadedSkills: context.loadedSkills } : {}),
        }, { bookRoot: binding.root }));
      }
      return fail("invalid-action", `未知的 skills.manage action：${String(injectedInput.action ?? "")}。支持 recommend | check_compliance。`);
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
  return executeReadyToolImpl(tool, input, context);
}

/**
 * 模型看到精简 schema，服务端按目录里的完整 schema 校验；两者相同时只给 inputSchema。
 */
function runtimeInputSchemas(tool: NovelRuntimeToolCatalogEntry): {
  inputSchema: PortableJsonSchema;
  validationInputSchema?: PortableJsonSchema;
} {
  const modelSchema = getModelFacingToolSchema(tool.name) ?? tool.inputSchema;
  if (modelSchema === tool.inputSchema) return { inputSchema: toRuntimeInputSchema(tool.inputSchema) };
  return {
    inputSchema: toRuntimeInputSchema(modelSchema),
    validationInputSchema: toRuntimeInputSchema(tool.inputSchema),
  };
}

const READY_RUNTIME_TOOLS = NOVEL_RUNTIME_TOOL_CATALOG.filter(
  (tool): tool is NovelRuntimeToolCatalogEntry & { readonly runtimeStatus: "ready" } => tool.runtimeStatus === "ready",
);

export const NOVEL_RUNTIME_CONTRIBUTION: RuntimePluginContribution = {
  id: "novelfork-novel",
  projectTypes: ["novel"],
  promptExtensions: [
    {
      // 稳定 id：Runtime 把每个带 id 的扩展当成独立上下文段（product.<id>），改名会让会话重发整段。
      id: "novelfork-novel.core",
      content: NOVEL_RUNTIME_SYSTEM_PROMPT,
      position: "after",
      order: 100,
      agentId: "novelist",
    },
  ],
  learning: NOVEL_LEARNING_CONTRIBUTION,
  tools: READY_RUNTIME_TOOLS.map((tool) => ({
    definition: {
      name: tool.name,
      description: tool.description,
      ...runtimeInputSchemas(tool),
      renderer: tool.renderer,
      risk: tool.risk,
      enabledForModes: tool.enabledForModes,
      visibility: tool.visibility,
      scope: tool.scope,
    },
    handler: (input, context) => executeReadyTool(tool, input, context),
  })),
};
