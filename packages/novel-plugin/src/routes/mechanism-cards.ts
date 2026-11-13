import { Hono, type Context } from "hono";
import type { RuntimeTextGenerator } from "@vivy1024/novelfork-core/plugins";

import {
  deleteMechanismCard,
  extractAndSaveMechanismCards,
  loadMechanismCards,
  MechanismCardError,
  updateMechanismCard,
} from "../engine/writing-layers/mechanism-cards.js";
import type { RouterContext } from "./context.js";

export interface CreateMechanismCardsRouterOptions {
  readonly resolveBookRoot?: (bookId: string) => string;
  readonly resolveTextGenerator?: (c: Context) => Promise<RuntimeTextGenerator | undefined>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringList(value: unknown): string[] | undefined {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)
    : undefined;
}

export function createMechanismCardsRouter(
  ctx: RouterContext,
  options: CreateMechanismCardsRouterOptions = {},
): Hono {
  const app = new Hono();
  const resolveBookRoot = options.resolveBookRoot ?? ((bookId: string) => ctx.state.bookDir(bookId));

  async function resolveGenerator(c: Context): Promise<RuntimeTextGenerator | undefined> {
    if (options.resolveTextGenerator) return options.resolveTextGenerator(c);
    if (!ctx.resolveTextGeneration) return undefined;
    const generation = await ctx.resolveTextGeneration(c).catch(() => null);
    if (!generation || !generation.available) return undefined;
    return async (request) => {
      const result = await generation.generateText(request);
      return {
        text: result.text,
        ...(result.outputTruncated ? { outputTruncated: true } : {}),
        ...(typeof result.usage?.completionTokens === "number" ? { usage: { completionTokens: result.usage.completionTokens } } : {}),
      };
    };
  }

  app.onError((error, c) => {
    if (!(error instanceof MechanismCardError)) throw error;
    const status = error.code === "MECHANISM_CARD_NOT_FOUND"
      ? 404
      : error.code === "MECHANISM_CARD_INVALID_INPUT"
        ? 400
        : error.code === "MECHANISM_CARD_CONFLICT"
          ? 409
          : 422;
    return c.json({
      error: error.message,
      code: error.code,
      explanation: {
        what: error.message,
        why: "机制卡数据需要经过结构与原著专名脱敏校验。",
        next: "检查输入参数或清洗残留原著专名后重试。",
      },
    }, status);
  });

  app.get("/api/books/:bookId/mechanism-cards", async (c) => {
    const bookRoot = resolveBookRoot(c.req.param("bookId"));
    const loaded = await loadMechanismCards(bookRoot);
    return c.json({ ok: true, ...loaded });
  });

  app.post("/api/books/:bookId/mechanism-cards/extract", async (c) => {
    const bookRoot = resolveBookRoot(c.req.param("bookId"));
    const body = await c.req.json().catch(() => null);
    if (!isRecord(body)) {
      return c.json({ error: "请求体必须是对象。", code: "MECHANISM_CARD_INVALID_INPUT" }, 400);
    }
    const generateText = await resolveGenerator(c);
    const range = isRecord(body.chapterRange)
      ? {
        ...(typeof body.chapterRange.from === "number" ? { from: Math.trunc(body.chapterRange.from) } : {}),
        ...(typeof body.chapterRange.to === "number" ? { to: Math.trunc(body.chapterRange.to) } : {}),
      }
      : undefined;
    const result = await extractAndSaveMechanismCards({
      bookRoot,
      ...(typeof body.sourceTitle === "string" ? { sourceTitle: body.sourceTitle } : {}),
      ...(typeof body.filePath === "string" ? { filePath: body.filePath } : {}),
      ...(typeof body.text === "string" ? { text: body.text } : {}),
      ...(range ? { chapterRange: range } : {}),
      ...(stringList(body.extraForbiddenTerms) ? { extraForbiddenTerms: stringList(body.extraForbiddenTerms) } : {}),
      ...(generateText ? { generateText } : {}),
    });
    return c.json({ ok: true, ...result }, 201);
  });

  app.patch("/api/books/:bookId/mechanism-cards/:cardId", async (c) => {
    const bookRoot = resolveBookRoot(c.req.param("bookId"));
    const cardId = c.req.param("cardId");
    const body = await c.req.json().catch(() => null);
    if (!isRecord(body)) {
      return c.json({ error: "请求体必须是对象。", code: "MECHANISM_CARD_INVALID_INPUT" }, 400);
    }
    const abstractSlots = Array.isArray(body.abstractSlots)
      ? body.abstractSlots.flatMap((slot) => {
        if (!isRecord(slot) || typeof slot.slot !== "string" || typeof slot.roleDescription !== "string") return [];
        return [{ slot: slot.slot, roleDescription: slot.roleDescription }];
      })
      : undefined;
    const status = body.status === "confirmed" || body.status === "needs-review" ? body.status : undefined;
    const updated = await updateMechanismCard(bookRoot, cardId, {
      ...(typeof body.name === "string" ? { name: body.name } : {}),
      ...(typeof body.readerDesire === "string" ? { readerDesire: body.readerDesire } : {}),
      ...(typeof body.emotionChain === "string" ? { emotionChain: body.emotionChain } : {}),
      ...(typeof body.triggerAndPayoff === "string" ? { triggerAndPayoff: body.triggerAndPayoff } : {}),
      ...(abstractSlots ? { abstractSlots } : {}),
      ...(stringList(body.forbiddenSourceTerms) !== undefined ? { forbiddenSourceTerms: stringList(body.forbiddenSourceTerms) } : {}),
      ...(stringList(body.tags) !== undefined ? { tags: stringList(body.tags) } : {}),
      ...(status ? { status } : {}),
    });
    return c.json({ ok: true, ...updated });
  });

  app.delete("/api/books/:bookId/mechanism-cards/:cardId", async (c) => {
    const bookRoot = resolveBookRoot(c.req.param("bookId"));
    const cardId = c.req.param("cardId");
    const deleted = await deleteMechanismCard(bookRoot, cardId);
    return c.json({ ok: true, ...deleted });
  });

  return app;
}
