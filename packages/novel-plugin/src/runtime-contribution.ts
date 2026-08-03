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
  handleLoreRead,
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
  handlePgiAsk,
  handleWritingSkillsCheckCompliance,
  handleWritingSkillsImportLegacy,
  handleWritingSkillsRead,
  handleWritingSkillsRecommend,
  handleWritingSkillsWrite,
  type CockpitState,
  type NarrativeLineState,
} from "./handlers/index.js";
import { createWritingResourceService } from "./engine/writing-resource/service.js";
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

## 写新章硬纪律（不可跳过）
1. write.preflight →（确认一句指示）→ scene.spec → pipeline.write。
2. preflight 返回 blockers 非空：立即停写，只报告缺口（缺指示 / 近章记忆空 / 高风险 pending），不得硬写。
3. 只使用产品内 focus、近章事实、lore brief、伏笔与用户一句 Directives；禁止用写作理论、文风大道理或外部项目总结填空。
4. 软门（Writing Skills 文风要求、去 AI 味、跑题、传播力）只在写后 chapter.audit / pipeline.revise / rewrite.*，不得在写前用长文论约束。

## 长篇与平台
- 续写旧书：pipeline.import_chapters（默认 autoSettle+extractBrief）或 book.dissect(settle=true)；拆书产物是 draft/needs-review，确认后才 lore.write。
- 中盘防跑偏：outline.volume 维护卷纲（当前卷目标会进 preflight 与 scene.spec）；arc.character 查角色弧停滞或回退。
- 终局储备：outline.volume 的 endgameReserve 记底牌（宿敌/真相/金手指上限，逐卷解锁）与升级台阶（不越级）。返回的 overdraft 报「底牌提前动用」「越级/到顶」时必须如实转述并建议改纲，不得替作者打光底牌。
- 发布前：publish.check 做平台自检（敏感词/AI 率/格式/连续性）。pipeline.write 保存前已做单章轻检，默认只提醒；平台要求且命中阻断级敏感词时会 publish-blocked 不保存。

当用户要求写一章完整的新正文时：必须先 write.preflight；ok 后再 scene.spec 生成蓝图，再 pipeline.write。该管线会读取书籍的目标长度、语言与当前 Writing Skills，并在成功后自动章后结算。若 Runtime 没有可用文本模型，必须如实说明阻塞，绝不能改用 chapter.write 写入短文本充当新章节。chapter.write 只用于覆盖已存在的完整章节，并由服务端在写入前执行本书的硬长度与 Writing Skills 错误守卫；局部改写使用 rewrite.apply。所有写入仍会经过 Runtime 权限确认，模型不得自行创建文件、推断文件路径或传入书籍根目录。

查询、讨论、查看设定时只执行所需读取，不要强行进入写作管线。章节正文、Lore 静态设定与 Narrative Memory 动态事实必须保持边界；高风险或待确认事件不得冒充已确认事实。`;

const HOST_CONTROLLED_FIELDS = new Set(["bookId", "sessionId", "bookRoot"]);
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
  | "rewrite.segment"
  | "rewrite.apply"
  | "style.import"
  | "pipeline.revise"
  | "pipeline.import_chapters"
  | "book.dissect"
  | "outline.suggest_next"
  | "outline.volume"
  | "arc.character"
  | "publish.check"
  | "character.check_consistency"
  | "hooks.manage"
  | "pipeline.write"
  | "memory.settle_range";
type LegacyReadHandler = (input: Record<string, unknown>) => Promise<unknown> | unknown;

/** The Runtime schema validates model input; this adapter adds only trusted binding fields for legacy handlers. */
function bridgeLegacyHandler<TInput>(handler: (input: TInput) => Promise<unknown> | unknown): LegacyReadHandler {
  return (input) => handler(input as unknown as TInput);
}

const READY_LEGACY_HANDLERS: Readonly<Record<Exclude<ReadyRuntimeToolName, CustomReadyRuntimeToolName>, LegacyReadHandler>> = {
  "lore.read": bridgeLegacyHandler(handleLoreRead),
  "lore.write": bridgeLegacyHandler(handleLoreWrite),
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
  "pgi.ask": bridgeLegacyHandler(handlePgiAsk),
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

/** Reject host-owned fields even when a caller bypasses model JSON-schema validation. */
function containsHostControlledField(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsHostControlledField);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value as Record<string, unknown>).some(([key, child]) => (
    HOST_CONTROLLED_FIELDS.has(key) || containsHostControlledField(child)
  ));
}

/** Convert existing schema metadata into a model-safe, portable JSON Schema. */
export function toRuntimeInputSchema(schema: unknown): PortableJsonSchema {
  const sanitize = (value: unknown): PortableJsonValue => {
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (Array.isArray(value)) return value.map(sanitize);
    if (!value || typeof value !== "object") return String(value);

    const source = value as Record<string, unknown>;
    const isObjectSchema = source.type === "object";
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
    if (isObjectSchema) result.additionalProperties = false;
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

async function executeReadyTool(
  tool: NovelRuntimeToolCatalogEntry,
  input: Readonly<Record<string, unknown>>,
  context: ToolExecutionContext,
): Promise<RuntimeToolResult> {
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

    if (tool.name === "cockpit.snapshot") {
      const snapshot = await createCockpitService({ state: createBoundNovelState(binding) }).getSnapshot({
        bookId: binding.bookId,
      });
      return toRuntimeToolResult({
        ok: true,
        summary: "已读取驾驶舱快照。",
        data: { ...snapshot, storyDir: "story" },
      });
    }
    if (tool.name === "write.preflight") {
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
    if (tool.name === "memory.settle_range") {
      const { handleMemorySettleRange } = await import("./handlers/memory-settle-range.js");
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
        llmExtractor: context.generateText
          ? async ({ content, title, chapterNumber }) => {
              const generated = await context.generateText!({
                messages: [
                  {
                    role: "system",
                    content: "从章节正文抽取叙事事件，返回 JSON 数组，每项含 eventType/subject/predicate/object/evidenceText/confidence。",
                  },
                  {
                    role: "user",
                    content: `第${chapterNumber}章 ${title ?? ""}\n\n${content.slice(0, 12000)}`,
                  },
                ],
                temperature: 0.2,
                maxTokens: 2000,
              });
              try {
                const parsed = JSON.parse(generated.text) as unknown;
                return Array.isArray(parsed) ? parsed as any : [];
              } catch {
                return [];
              }
            }
          : undefined,
      });
      return toRuntimeToolResult({
        ok: result.ok,
        summary: result.summary,
        ...(result.ok ? {} : { error: result.error ?? "settle-range-failed" }),
        data: result,
      });
    }
    if (tool.name === "chapter.discard_range") {
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
    if (tool.name === "chapter.read") {
      if (typeof injectedInput.chapterNumber !== "number" || !Number.isInteger(injectedInput.chapterNumber)) {
        return fail("invalid-input", "chapterNumber 必须是整数。");
      }
      return toRuntimeToolResult(await handleChapterRead(
        { bookId: binding.bookId, chapterNumber: injectedInput.chapterNumber },
        undefined,
        { bookRoot: binding.root },
      ));
    }
    if (tool.name === "chapter.write") {
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
    if (tool.name === "chapter.list") {
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
    if (tool.name === "narrative.read_line") {
      const service = createNarrativeLineService({ state: createBoundNovelState(binding) });
      const snapshot = await service.getSnapshot({
        bookId: binding.bookId,
        includeWarnings: injectedInput.includeWarnings !== false,
      });
      return toRuntimeToolResult({ ok: true, summary: "已读取叙事线快照。", data: snapshot });
    }
    if (tool.name === "narrative.propose_change") {
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
    if (tool.name === "narrative.approve_change") {
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
    if (tool.name === "writing-skills.read") {
      return toRuntimeToolResult(await handleWritingSkillsRead({
        bookId: binding.bookId,
        ...(injectedInput.scope === "available" || injectedInput.scope === "enabled"
          ? { scope: injectedInput.scope }
          : {}),
      }, { bookRoot: binding.root }));
    }
    if (tool.name === "writing-skills.write") {
      return toRuntimeToolResult(await handleWritingSkillsWrite({
        bookId: binding.bookId,
        enabledWritingSkillIds: Array.isArray(injectedInput.enabledWritingSkillIds)
          ? injectedInput.enabledWritingSkillIds.filter((id): id is string => typeof id === "string")
          : [],
        ...(typeof injectedInput.discardUnmappedLegacyIds === "boolean"
          ? { discardUnmappedLegacyIds: injectedInput.discardUnmappedLegacyIds }
          : {}),
      }, { bookRoot: binding.root }));
    }
    if (tool.name === "writing-skills.recommend") {
      return toRuntimeToolResult(await handleWritingSkillsRecommend({
        bookId: binding.bookId,
        ...(typeof injectedInput.maxCount === "number" ? { maxCount: injectedInput.maxCount } : {}),
      }, { bookRoot: binding.root }));
    }
    if (tool.name === "writing-skills.check_compliance") {
      return toRuntimeToolResult(await handleWritingSkillsCheckCompliance({
        bookId: binding.bookId,
        content: typeof injectedInput.content === "string" ? injectedInput.content : "",
        ...(typeof injectedInput.chapterNumber === "number" ? { chapterNumber: injectedInput.chapterNumber } : {}),
      }, { bookRoot: binding.root }));
    }
    if (tool.name === "writing-skills.import_legacy") {
      return toRuntimeToolResult(await handleWritingSkillsImportLegacy(
        { bookId: binding.bookId },
        { bookRoot: binding.root, storage: getStorageDatabase() },
      ));
    }
    if (tool.name === "resource.manage") {
      const action = typeof injectedInput.action === "string" ? injectedInput.action : "";
      const service = createWritingResourceService({
        storage: getStorageDatabase(),
        resolveBookDir: (bookId) => requireBoundBookRoot(binding, bookId),
      });
      if (action === "list") {
        const filter = injectedInput.filter && typeof injectedInput.filter === "object"
          ? injectedInput.filter as Record<string, unknown>
          : {};
        const type = filter.type === "chapter" || filter.type === "candidate" || filter.type === "draft"
          ? filter.type
          : undefined;
        const status = filter.status === "draft"
          || filter.status === "candidate"
          || filter.status === "accepted"
          || filter.status === "rejected"
          || filter.status === "archived"
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
      scope: tool.scope,
    },
    handler: (input, context) => executeReadyTool(tool, input, context),
  })),
};
