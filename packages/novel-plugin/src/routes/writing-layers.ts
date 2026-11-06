import { Hono } from "hono";
import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";

import { dismissLayerAuthorityNotice, type LayerAuthorityField } from "../engine/writing-layers/layer-authority.js";
import {
  loadWritingLayerRevisions,
  resolveWritingLayers,
  saveWritingLayerFields,
  volumeOutlineReadOnlyError,
  writingLayerMovedError,
  type EditableWritingLayerField,
  type ResolvedWritingLayers,
  type WritingLayerRevisions,
  type WritingLayerSaveError,
} from "../engine/writing-layers/layer-store.js";
import type { RouterContext } from "./context.js";

export interface CreateWritingLayersRouterOptions {
  readonly resolveBookRoot?: (bookId: string) => string;
  /** 经纬所在的产品库；缺省用进程级单例（未初始化时当前聚焦 / 本书规则为空）。 */
  readonly storage?: StorageDatabase | (() => StorageDatabase | null);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const SAVE_ERROR_CODES: ReadonlySet<string> = new Set([
  "WRITING_LAYER_REVISION_CONFLICT",
  "VOLUME_OUTLINE_READ_ONLY",
  "WRITING_LAYER_MOVED",
  "WRITING_LAYER_UNREADABLE",
]);

/** 按 code 识别保存拒绝（不依赖 instanceof 的模块同一性），错误体结构与 routes/jingwei.ts 一致。 */
function saveErrorResponse(error: unknown) {
  if (!(error instanceof Error)) return null;
  const candidate = error as Partial<WritingLayerSaveError>;
  if (typeof candidate.code !== "string" || !SAVE_ERROR_CODES.has(candidate.code) || !candidate.explanation) return null;
  return {
    status: (candidate.statusCode ?? 409) as 409 | 422 | 503,
    body: {
      error: { code: candidate.code, message: error.message },
      explanation: candidate.explanation,
      ...(candidate.details?.fields ? { conflictFields: candidate.details.fields } : {}),
      ...(candidate.details?.revisions ? { currentRevisions: candidate.details.revisions } : {}),
    },
  };
}

function parseRevisions(value: unknown): Partial<WritingLayerRevisions> {
  if (!isRecord(value)) return {};
  return typeof value.authorIntent === "string" ? { authorIntent: value.authorIntent } : {};
}

async function defaultStorage(): Promise<StorageDatabase | null> {
  try {
    const { getStorageDatabase } = await import("@vivy1024/novelfork-core");
    return getStorageDatabase();
  } catch {
    return null;
  }
}

/** 设置页的只读视图：当前聚焦与本书规则来自经纬，作者意图来自它自己的文件。 */
function layersBody(bookId: string, layers: ResolvedWritingLayers) {
  return {
    bookId,
    bookDesign: layers.bookDesign,
    bookRulesRaw: layers.bookRulesRaw,
    bookRulesText: layers.bookRulesText,
    bookRules: layers.bookRuleEntries.map((rule) => ({ id: rule.id, title: rule.title, content: rule.content })),
    notices: layers.notices,
    styleGuideText: layers.styleGuideText,
  };
}

export function createWritingLayersRouter(
  ctx: RouterContext,
  options: CreateWritingLayersRouterOptions = {},
): Hono {
  const app = new Hono();
  const resolveBookRoot = options.resolveBookRoot ?? ((bookId: string) => ctx.state.bookDir(bookId));
  const resolveStorage = async (): Promise<StorageDatabase | null> => {
    if (typeof options.storage === "function") return options.storage();
    return options.storage ?? defaultStorage();
  };

  app.onError((error, c) => {
    const response = saveErrorResponse(error);
    if (response) return c.json(response.body, response.status);
    throw error;
  });

  app.get("/api/books/:bookId/writing-layers", async (c) => {
    const bookId = c.req.param("bookId");
    const bookRoot = resolveBookRoot(bookId);
    const storage = await resolveStorage();
    const [layers, revisions] = await Promise.all([
      resolveWritingLayers({ bookRoot, storage, bookId }),
      loadWritingLayerRevisions(bookRoot),
    ]);
    return c.json({ ...layersBody(bookId, layers), revisions });
  });

  /**
   * 只保存作者意图（可带 revisions.authorIntent 做乐观并发）。
   * 卷纲、当前聚焦、本书规则一律拒绝：权威都在经纬，story/ 下的同名文件不是可编辑来源。
   */
  app.put("/api/books/:bookId/writing-layers", async (c) => {
    const bookId = c.req.param("bookId");
    const bookRoot = resolveBookRoot(bookId);
    const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    const design = isRecord(body?.bookDesign) ? body.bookDesign : {};
    if (asString(design.volumeOutline) !== undefined) throw volumeOutlineReadOnlyError();
    const moved = [
      ...(asString(design.currentFocus) !== undefined ? ["currentFocus" as const] : []),
      ...(typeof body?.bookRulesRaw === "string" ? ["bookRulesRaw" as const] : []),
    ];
    if (moved.length > 0) throw writingLayerMovedError(moved);

    const patch: Partial<Record<EditableWritingLayerField, string>> = {
      ...(asString(design.authorIntent) !== undefined ? { authorIntent: asString(design.authorIntent)! } : {}),
    };
    const { revisions } = await saveWritingLayerFields(bookRoot, patch, parseRevisions(body?.revisions));
    const storage = await resolveStorage();
    const layers = await resolveWritingLayers({ bookRoot, storage, bookId });
    return c.json({ ...layersBody(bookId, layers), revisions });
  });

  /** 作者看过旧版迁移提示后收起它（只改迁移记账，不动任何内容）。 */
  app.post("/api/books/:bookId/writing-layers/notices/:field/dismiss", async (c) => {
    const bookId = c.req.param("bookId");
    const field = c.req.param("field");
    if (field !== "currentFocus" && field !== "bookRules") {
      return c.json({ error: { code: "WRITING_LAYER_NOTICE_UNKNOWN", message: `未知提示：${field}` } }, 400);
    }
    await dismissLayerAuthorityNotice(resolveBookRoot(bookId), field as LayerAuthorityField);
    return c.json({ ok: true, field });
  });

  return app;
}
