import { Hono } from "hono";

import {
  loadWritingLayerRevisions,
  resolveWritingLayers,
  saveWritingLayerFields,
  volumeOutlineReadOnlyError,
  type EditableWritingLayerField,
  type WritingLayerRevisions,
  type WritingLayerSaveError,
} from "../engine/writing-layers/layer-store.js";
import type { RouterContext } from "./context.js";

export interface CreateWritingLayersRouterOptions {
  readonly resolveBookRoot?: (bookId: string) => string;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const SAVE_ERROR_CODES: ReadonlySet<string> = new Set(["WRITING_LAYER_REVISION_CONFLICT", "VOLUME_OUTLINE_READ_ONLY", "WRITING_LAYER_UNREADABLE"]);

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
  const result: Partial<WritingLayerRevisions> = {};
  for (const field of ["authorIntent", "currentFocus", "bookRulesRaw"] as const) {
    if (typeof value[field] === "string") result[field] = value[field] as string;
  }
  return result;
}

export function createWritingLayersRouter(
  ctx: RouterContext,
  options: CreateWritingLayersRouterOptions = {},
): Hono {
  const app = new Hono();
  const resolveBookRoot = options.resolveBookRoot ?? ((bookId: string) => ctx.state.bookDir(bookId));

  app.onError((error, c) => {
    const response = saveErrorResponse(error);
    if (response) return c.json(response.body, response.status);
    throw error;
  });

  app.get("/api/books/:bookId/writing-layers", async (c) => {
    const bookId = c.req.param("bookId");
    const bookRoot = resolveBookRoot(bookId);
    const [layers, revisions] = await Promise.all([resolveWritingLayers({ bookRoot }), loadWritingLayerRevisions(bookRoot)]);
    return c.json({
      bookId,
      bookDesign: layers.bookDesign,
      bookRulesRaw: layers.bookRulesRaw,
      bookRulesText: layers.bookRulesText,
      styleGuideText: layers.styleGuideText,
      revisions,
    });
  });

  /**
   * 只保存请求里出现的字段；每个字段可带 revisions[field]（GET 返回的值）做乐观并发。
   * 卷纲（bookDesign.volumeOutline）一律拒绝：权威在经纬 outline 条目，volume_outline.md 只是导出物。
   */
  app.put("/api/books/:bookId/writing-layers", async (c) => {
    const bookId = c.req.param("bookId");
    const bookRoot = resolveBookRoot(bookId);
    const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    const design = isRecord(body?.bookDesign) ? body.bookDesign : {};
    if (asString(design.volumeOutline) !== undefined) throw volumeOutlineReadOnlyError();

    const patch: Partial<Record<EditableWritingLayerField, string>> = {
      ...(asString(design.authorIntent) !== undefined ? { authorIntent: asString(design.authorIntent)! } : {}),
      ...(asString(design.currentFocus) !== undefined ? { currentFocus: asString(design.currentFocus)! } : {}),
      ...(typeof body?.bookRulesRaw === "string" ? { bookRulesRaw: body.bookRulesRaw } : {}),
    };
    const { revisions } = await saveWritingLayerFields(bookRoot, patch, parseRevisions(body?.revisions));
    const layers = await resolveWritingLayers({ bookRoot });
    return c.json({
      bookId,
      bookDesign: layers.bookDesign,
      bookRulesRaw: layers.bookRulesRaw,
      bookRulesText: layers.bookRulesText,
      revisions,
    });
  });

  return app;
}
