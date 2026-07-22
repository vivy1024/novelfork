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
import {
  createCockpitService,
  createNarrativeLineService,
  executeRuntimeDomainTool,
  handleBeatRead,
  handleBeatWrite,
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
  handlePresetsCheckCompliance,
  handlePresetsRead,
  handlePresetsWrite,
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

当用户要求写一章完整的新正文时，先用 scene.spec 生成蓝图，再使用 pipeline.write；该管线会读取书籍的目标长度、语言、预设与节拍。若 Runtime 没有可用文本模型，必须如实说明阻塞，绝不能改用 chapter.write 写入短文本充当新章节。chapter.write 只用于覆盖已存在的完整章节，并由服务端在写入前执行本书的硬长度和预设错误守卫；局部改写使用 rewrite.apply。所有写入仍会经过 Runtime 权限确认，模型不得自行创建文件、推断文件路径或传入书籍根目录。

查询、讨论、查看设定时只执行所需读取，不要强行进入写作管线。章节正文、Lore 静态设定与 Narrative Memory 动态事实必须保持边界；高风险或待确认事件不得冒充已确认事实。`;

const HOST_CONTROLLED_FIELDS = new Set(["bookId", "sessionId", "bookRoot"]);
type ReadyRuntimeToolName = (typeof NOVEL_READY_RUNTIME_TOOL_NAMES)[number];
type CustomReadyRuntimeToolName =
  | "cockpit.snapshot"
  | "chapter.read"
  | "chapter.write"
  | "chapter.list"
  | "narrative.read_line"
  | "narrative.propose_change"
  | "presets.read"
  | "presets.write"
  | "presets.check_compliance"
  | "beat.read"
  | "beat.write"
  | "resource.manage"
  | "scene.spec"
  | "chapter.audit"
  | "rewrite.segment"
  | "rewrite.apply"
  | "style.import"
  | "pipeline.revise"
  | "pipeline.import_chapters"
  | "outline.suggest_next"
  | "character.check_consistency"
  | "hooks.manage"
  | "pipeline.write";
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
        ...(typeof injectedInput.reason === "string" ? { reason: injectedInput.reason } : {}),
      });
      return toRuntimeToolResult({ ok: true, summary: "已生成叙事线变更草案。", data: preview });
    }
    if (tool.name === "presets.read") {
      return toRuntimeToolResult(await handlePresetsRead({
        bookId: binding.bookId,
        ...(typeof injectedInput.scope === "string" ? { scope: injectedInput.scope } : {}),
        ...(typeof injectedInput.category === "string" ? { category: injectedInput.category } : {}),
      }, { bookRoot: binding.root, storage: getStorageDatabase() }));
    }
    if (tool.name === "presets.write") {
      return toRuntimeToolResult(await handlePresetsWrite({
        bookId: binding.bookId,
        action: typeof injectedInput.action === "string" ? injectedInput.action : "",
        ...(Array.isArray(injectedInput.enabledPresetIds)
          ? { enabledPresetIds: injectedInput.enabledPresetIds.filter((id): id is string => typeof id === "string") }
          : {}),
        ...(typeof injectedInput.name === "string" ? { name: injectedInput.name } : {}),
        ...(typeof injectedInput.category === "string" ? { category: injectedInput.category } : {}),
        ...(typeof injectedInput.promptInjection === "string" ? { promptInjection: injectedInput.promptInjection } : {}),
        ...(typeof injectedInput.description === "string" ? { description: injectedInput.description } : {}),
      }, { bookRoot: binding.root, storage: getStorageDatabase() }));
    }
    if (tool.name === "presets.check_compliance") {
      return toRuntimeToolResult(await handlePresetsCheckCompliance({
        bookId: binding.bookId,
        content: typeof injectedInput.content === "string" ? injectedInput.content : "",
        ...(typeof injectedInput.chapterNumber === "number" ? { chapterNumber: injectedInput.chapterNumber } : {}),
      }, { bookRoot: binding.root, storage: getStorageDatabase() }));
    }
    if (tool.name === "beat.read") {
      return toRuntimeToolResult(await handleBeatRead(
        { bookId: binding.bookId },
        { bookRoot: binding.root, storage: getStorageDatabase() },
      ));
    }
    if (tool.name === "beat.write") {
      return toRuntimeToolResult(await handleBeatWrite({
        bookId: binding.bookId,
        action: typeof injectedInput.action === "string" ? injectedInput.action : "",
        ...(typeof injectedInput.templateId === "string" ? { templateId: injectedInput.templateId } : {}),
        ...(typeof injectedInput.name === "string" ? { name: injectedInput.name } : {}),
        ...(typeof injectedInput.description === "string" ? { description: injectedInput.description } : {}),
        ...(Array.isArray(injectedInput.beats) ? { beats: injectedInput.beats } : {}),
      }, { bookRoot: binding.root, storage: getStorageDatabase() }));
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
