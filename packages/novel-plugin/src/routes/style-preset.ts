import { Hono, type Context } from "hono";
import type { RuntimeTextGenerator } from "@vivy1024/novelfork-core/plugins";

import {
  appendRuntimeNegativeOverride,
  consolidateAndSaveStylePreset,
} from "../engine/writing-layers/style-consolidate.js";
import { createStylePreset, type StylePreset } from "../engine/writing-layers/style-preset.js";
import { loadStylePreset, saveStylePreset, StylePresetError } from "../engine/writing-layers/style-preset-store.js";
import type { RouterContext } from "./context.js";

export interface CreateStylePresetRouterOptions {
  readonly resolveBookRoot?: (bookId: string) => string;
  readonly resolveTextGenerator?: (c: Context) => Promise<RuntimeTextGenerator | undefined>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanStringArray(value: unknown, limit: number): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return [...new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))].slice(0, limit);
}

export function createStylePresetRouter(
  ctx: RouterContext,
  options: CreateStylePresetRouterOptions = {},
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
    if (!(error instanceof StylePresetError)) throw error;
    const status = error.code === "STYLE_PRESET_CONFLICT" ? 409 : error.code === "STYLE_PRESET_INVALID" ? 400 : 422;
    return c.json({
      error: error.message,
      code: error.code,
      explanation: {
        what: error.message,
        why: "文风配置不能静默覆盖或丢失。",
        next: "请重新读取最新文风预设后再重试。",
      },
    }, status);
  });

  app.post("/api/books/:bookId/style-preset/consolidate", async (c) => {
    const bookRoot = resolveBookRoot(c.req.param("bookId"));
    const body = await c.req.json().catch(() => ({}));
    const record = isRecord(body) ? body : {};
    const expectedRevision = Object.hasOwn(record, "expectedRevision")
      ? (record.expectedRevision === null || typeof record.expectedRevision === "string" ? record.expectedRevision : undefined)
      : undefined;
    const maxRules = typeof record.maxRules === "number" && Number.isFinite(record.maxRules)
      ? Math.trunc(record.maxRules)
      : undefined;
    const generateText = await resolveGenerator(c);
    const result = await consolidateAndSaveStylePreset({
      bookRoot,
      ...(generateText ? { generateText } : {}),
      ...(maxRules !== undefined ? { maxRules } : {}),
      ...(expectedRevision !== undefined ? { expectedRevision } : {}),
    });
    return c.json({ ok: true, ...result });
  });

  app.post("/api/books/:bookId/style-preset/negative-override", async (c) => {
    const bookRoot = resolveBookRoot(c.req.param("bookId"));
    const body = await c.req.json().catch(() => null);
    if (!isRecord(body) || typeof body.feedbackText !== "string" || !body.feedbackText.trim()) {
      return c.json({
        error: "必须提供非空的 feedbackText。",
        code: "STYLE_PRESET_INVALID",
        explanation: {
          what: "负反馈内容为空。",
          why: "需要知道作者具体讨厌哪种写法，才能转成最高优先级反例约束。",
          next: "请传入一句具体的纠偏说明，如「别用英文缩写」「少写心理独白」。",
        },
      }, 400);
    }
    const result = await appendRuntimeNegativeOverride(bookRoot, body.feedbackText);
    return c.json({ ok: true, ...result });
  });

  app.patch("/api/books/:bookId/style-preset/sources/:sourceId", async (c) => {
    const bookRoot = resolveBookRoot(c.req.param("bookId"));
    const sourceId = c.req.param("sourceId");
    const body = await c.req.json().catch(() => null);
    if (!isRecord(body)) {
      return c.json({ error: "请求体必须是对象。", code: "STYLE_PRESET_INVALID" }, 400);
    }
    const current = await loadStylePreset(bookRoot);
    if (Object.hasOwn(body, "expectedRevision") && body.expectedRevision !== current.revision) {
      throw new StylePresetError("文风预设已被更新；请重新载入后再修改来源配置。", "STYLE_PRESET_CONFLICT");
    }
    const preset = current.preset ?? createStylePreset();
    const target = preset.sources.find((item) => item.id === sourceId);
    if (!target) {
      return c.json({
        error: `找不到来源包「${sourceId}」。`,
        code: "STYLE_SOURCE_NOT_FOUND",
        explanation: {
          what: `文风预设里不存在 ID 为「${sourceId}」的来源。`,
          why: "只能对已采纳进文风预设的来源设置主副角色与触发标签。",
          next: "请先采纳该来源，或核对 sourceId 后再试。",
        },
      }, 404);
    }
    if (body.role !== undefined && body.role !== "primary_voice" && body.role !== "register_overlay") {
      return c.json({ error: "role 只能为 primary_voice 或 register_overlay。", code: "STYLE_PRESET_INVALID" }, 400);
    }
    const nextRole = (body.role as "primary_voice" | "register_overlay" | undefined) ?? target.role;
    const triggerTags = body.triggerTags !== undefined ? cleanStringArray(body.triggerTags, 50) : target.triggerTags;
    const forbiddenSourceTerms = body.forbiddenSourceTerms !== undefined ? cleanStringArray(body.forbiddenSourceTerms, 200) : target.forbiddenSourceTerms;

    const updatedTarget: StylePreset["sources"][number] = {
      ...target,
      ...(nextRole ? { role: nextRole } : {}),
      ...(triggerTags !== undefined ? { triggerTags } : {}),
      ...(forbiddenSourceTerms !== undefined ? { forbiddenSourceTerms } : {}),
    };
    const nextSources = preset.sources.map((item, idx) => {
      if (item.id === sourceId) return updatedTarget;
      if (nextRole === "primary_voice" && (item.role === "primary_voice" || (item.role === undefined && idx === 0))) {
        return { ...item, role: "register_overlay" as const };
      }
      return item;
    });
    const saved = await saveStylePreset(bookRoot, { ...preset, sources: nextSources }, current.revision);
    return c.json({ ok: true, ...saved });
  });

  return app;
}
