import { Hono, type Context } from "hono";
import {
  buildContinuationPrompt,
  buildExpansionPrompt,
  buildBridgePrompt,
  buildPolishPrompt,
  buildRewritePrompt,
  buildNaturalizePrompt,
  buildCompressPrompt,
  buildDialoguePrompt,
  buildVariantPrompts,
  buildBranchPrompt,
  parseFile,
  mergeStyleProfiles,
  detectStyleDrift,
  distillStyleProfile,
  type InlineWriteContext,
  type ContinuationInput,
  type ExpansionInput,
  type ExpansionDirection,
  type BridgeInput,
  type BridgePurpose,
  type PolishInput,
  type RewriteInput,
  type NaturalizeInput,
  type CompressInput,
  type DialogueInput,
  type DialogueCharacter,
  type VariantInput,
  type ImportStyleProfile,
} from "../engine/index.js";

import type { HostTextGenerationAvailability, HostTextGenerationRequest, RouterContext } from "./context.js";
import { adoptRevisionSamples, readChapterVaultDetail, summarizeStyleVault, type AdoptRevisionInput } from "../engine/writing-layers/style-vault.js";
import { STYLE_SCENE_TYPES } from "../engine/writing-layers/style-preset.js";
import {
  loadStylePreset, readStyleFingerprint, saveStylePreset, StylePresetError, updateStyleFingerprint,
} from "../engine/writing-layers/style-preset-store.js";

type UnavailableGeneration = Extract<HostTextGenerationAvailability, { available: false }>;

const HOST_WITHOUT_TEXT_GENERATION: UnavailableGeneration = {
  available: false,
  code: "MODEL_HOST_UNSUPPORTED",
  message: "当前入口没有接到服务端模型。",
  suggestedAction: "复制提示词自行使用，或在叙述者对话里请叙述者执行同样的写作动作。",
};

function modelUnavailableExplanation(unavailable: UnavailableGeneration) {
  return {
    what: unavailable.message,
    why: "网页写作动作要用 Runtime 里配置的模型才能直接生成；没有可用模型时只返回提示词预览，不写入任何章节。",
    next: unavailable.suggestedAction,
  };
}

/** 模型调用本身失败（供应商报错、超时等）；与「没有模型」分开说明。 */
class WritingModelRequestError extends Error {
  constructor(readonly model: string | undefined, cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
  }
}

export function createWritingModesRouter(ctx: RouterContext): Hono {
  const app = new Hono();

  /** 服务端文本生成由宿主按当前登录用户提供；宿主缺席或报错都按「无模型」处理。 */
  async function resolveGeneration(c: Context): Promise<HostTextGenerationAvailability> {
    if (!ctx.resolveTextGeneration) return HOST_WITHOUT_TEXT_GENERATION;
    try {
      return await ctx.resolveTextGeneration(c);
    } catch (error) {
      return {
        available: false,
        code: "MODEL_STATUS_FAILED",
        message: `读取模型配置失败：${error instanceof Error ? error.message : String(error)}`,
        suggestedAction: "稍后重试；若反复失败，检查设置里的模型与供应商配置。",
      };
    }
  }

  async function generate(
    generation: Extract<HostTextGenerationAvailability, { available: true }>,
    request: HostTextGenerationRequest,
  ) {
    try {
      const result = await generation.generateText(request);
      return { content: result.text, model: result.model ?? generation.model, usage: result.usage };
    } catch (error) {
      throw new WritingModelRequestError(generation.model, error);
    }
  }

  app.onError((error, c) => {
    if (error instanceof WritingModelRequestError) {
      return c.json({
        error: `模型调用失败：${error.message}`,
        code: "MODEL_REQUEST_FAILED",
        ...(error.model ? { model: error.model } : {}),
        explanation: {
          what: `模型调用失败：${error.message}`,
          why: "这次没有拿到生成结果，也没有写入任何章节。",
          next: "稍后重试；若反复失败，检查设置里的模型与供应商配置。",
        },
      }, 502);
    }
    if (!(error instanceof StylePresetError)) throw error;
    const status = error.code === "STYLE_PRESET_CONFLICT" ? 409 : error.code === "STYLE_PRESET_INVALID" ? 400 : 422;
    return c.json({ error: error.message, code: error.code, explanation: {
      what: error.message, why: "文风配置不能静默覆盖或丢失。", next: "保留你的修改，重新载入有效预设后再保存。",
    } }, status);
  });

  app.get("/api/books/:bookId/style/preset", async (c) => {
    return c.json(await loadStylePreset(ctx.state.bookDir(c.req.param("bookId"))));
  });
  app.put("/api/books/:bookId/style/preset", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || !Object.hasOwn(body, "expectedRevision") ||
      (body.expectedRevision !== null && typeof body.expectedRevision !== "string")) {
      return c.json({ error: "保存文风预设必须携带读取时的 expectedRevision。" }, 400);
    }
    return c.json(await saveStylePreset(ctx.state.bookDir(c.req.param("bookId")), body.preset, body.expectedRevision));
  });

  // 文风金库：AI 原稿与当前正文逐句比对得出人工占比；只读，不写正文也不写预设。
  app.get("/api/books/:bookId/style/vault", async (c) => {
    return c.json({ ok: true, ...(await summarizeStyleVault(ctx.state.bookDir(c.req.param("bookId")))) });
  });
  app.get("/api/books/:bookId/style/vault/chapters/:chapterNumber", async (c) => {
    const chapterNumber = Number(c.req.param("chapterNumber"));
    if (!Number.isInteger(chapterNumber) || chapterNumber <= 0) {
      return c.json({ error: "章号必须是正整数。", code: "STYLE_VAULT_INVALID_CHAPTER" }, 400);
    }
    try {
      return c.json({ ok: true, ...(await readChapterVaultDetail(ctx.state.bookDir(c.req.param("bookId")), chapterNumber)) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({
        error: message,
        code: "STYLE_VAULT_UNAVAILABLE",
        explanation: {
          whatHappened: message,
          whyItMatters: "没有可比对的 AI 原稿与正文，就算不出这一章的人工占比。",
          suggestedAction: "确认章节存在；原稿损坏时可让叙述者重写本章生成新原稿，或忽略这一章的占比。",
        },
      }, 404);
    }
  });

  // 作者把改稿段采纳为本书范文：写入文风预设「作者改稿」来源，带版本号防覆盖。
  app.post("/api/books/:bookId/style/vault/adopt", async (c) => {
    const body = await c.req.json().catch(() => null) as { expectedRevision?: unknown; samples?: unknown } | null;
    if (!body || !Object.hasOwn(body, "expectedRevision") || (body.expectedRevision !== null && typeof body.expectedRevision !== "string")) {
      return c.json({ error: "采纳改稿必须携带读取文风预设时的 expectedRevision。", code: "STYLE_VAULT_REVISION_REQUIRED" }, 400);
    }
    const samples = Array.isArray(body.samples) ? body.samples.filter((item): item is AdoptRevisionInput => (
      Boolean(item) && typeof item === "object"
      && Number.isInteger((item as AdoptRevisionInput).chapterNumber) && (item as AdoptRevisionInput).chapterNumber > 0
      && typeof (item as AdoptRevisionInput).authorText === "string" && (item as AdoptRevisionInput).authorText.trim().length > 0
      && typeof (item as AdoptRevisionInput).aiText === "string"
      && ((item as AdoptRevisionInput).sceneType === undefined || (STYLE_SCENE_TYPES as readonly string[]).includes((item as AdoptRevisionInput).sceneType!))
    )) : [];
    if (samples.length === 0) return c.json({ error: "没有可采纳的改稿段。", code: "STYLE_VAULT_EMPTY_ADOPTION" }, 400);
    return c.json(await adoptRevisionSamples(ctx.state.bookDir(c.req.param("bookId")), samples, body.expectedRevision as string | null));
  });

  // Removed v1 apply endpoint: keep a tombstone response so stale clients do not
  // silently fall through to 404 or attempt legacy candidate/draft writes.
  app.post("/api/books/:bookId/writing-modes/apply", (c) => c.json({
    code: "WRITING_MODE_APPLY_REPOSITION_REQUIRED",
    error: "writing-modes/apply has been removed. Use formal chapter resources and dedicated writing actions instead.",
  }, 410));

  // ---- POST /api/books/:bookId/inline-write ----
  app.post("/api/books/:bookId/inline-write", async (c) => {
    const body = await readJsonBody(c);
    const bookId = c.req.param("bookId");
    const mode = asString(body.mode);
    if (!mode || !["continuation", "expansion", "bridge", "polish", "rewrite", "naturalize", "compress"].includes(mode)) {
      return c.json({ error: "Invalid mode. Must be continuation, expansion, bridge, polish, rewrite, naturalize, or compress." }, 400);
    }

    const context: InlineWriteContext = {
      bookId,
      chapterNumber: asNumber(body.chapterNumber) ?? 1,
      beforeText: asString(body.beforeText) ?? "",
      afterText: asString(body.afterText),
      styleGuide: asString(body.styleGuide),
      bookRules: asString(body.bookRules),
    };

    const selectedText = asString(body.selectedText) ?? "";

    let prompt: string;
    if (mode === "continuation") {
      const input: ContinuationInput = { mode: "continuation", selectedText, direction: asString(body.direction) };
      prompt = buildContinuationPrompt(input, context);
    } else if (mode === "expansion") {
      const input: ExpansionInput = {
        mode: "expansion",
        selectedText,
        direction: asString(body.direction),
        expansionDirection: (asString(body.expansionDirection) as ExpansionDirection) ?? "sensory",
      };
      prompt = buildExpansionPrompt(input, context);
    } else if (mode === "bridge") {
      const input: BridgeInput = {
        mode: "bridge",
        selectedText,
        direction: asString(body.direction),
        purpose: (asString(body.purpose) as BridgePurpose) ?? "scene-transition",
      };
      prompt = buildBridgePrompt(input, context);
    } else if (mode === "polish") {
      const input: PolishInput = { mode: "polish", selectedText, direction: asString(body.direction) };
      prompt = buildPolishPrompt(input, context);
    } else if (mode === "naturalize") {
      const input: NaturalizeInput = { mode: "naturalize", selectedText, direction: asString(body.direction) };
      prompt = buildNaturalizePrompt(input, context);
    } else if (mode === "compress") {
      const input: CompressInput = { mode: "compress", selectedText, direction: asString(body.direction) };
      prompt = buildCompressPrompt(input, context);
    } else {
      const input: RewriteInput = { mode: "rewrite", selectedText, direction: asString(body.direction) };
      prompt = buildRewritePrompt(input, context);
    }

    const generation = await resolveGeneration(c);
    if (!generation.available) {
      return c.json(buildPromptPreviewResponse(prompt, { bookId, writingMode: mode, ...unavailableFields(generation) }));
    }
    const response = await generate(generation, { messages: [
      { role: "system", content: "你是 NovelFork 的小说创作执行模型。请只输出可供用户复制、合并或明确应用到正式章节/多版本流程的正文内容，不要复述提示词。" },
      { role: "user", content: prompt },
    ], temperature: 0.7, maxTokens: 2048 });

    return c.json({
      mode: "generated",
      writingMode: mode,
      content: response.content,
      promptPreview: prompt,
      model: response.model,
      usage: response.usage,
      bookId,
    });
  });

  // ---- POST /api/books/:bookId/writing-modes/execute-prompt ----
  app.post("/api/books/:bookId/writing-modes/execute-prompt", async (c) => {
    const body = await readJsonBody(c);
    const bookId = c.req.param("bookId");
    const prompt = asString(body.prompt)?.trim();
    if (!prompt) return c.json({ error: "Prompt is required." }, 400);

    const generation = await resolveGeneration(c);
    if (!generation.available) {
      // 这里要的就是执行结果，退回提示词预览没有意义：明确告诉作者为什么没执行。
      return c.json({
        error: generation.message,
        code: "MODEL_UNAVAILABLE",
        ...unavailableFields(generation),
        bookId,
      }, 422);
    }
    const temperature = clampNumber(asNumber(body.temperature) ?? 0.7, 0, 2);
    const maxTokens = Math.min(8192, Math.max(256, asNumber(body.maxTokens) ?? 2048));
    const response = await generate(generation, { messages: [
      {
        role: "system",
        content: "你是 NovelFork 的小说创作执行模型。请只输出可供用户复制、合并或明确应用到正式章节/多版本流程的正文、对话或大纲内容，不要复述提示词。",
      },
      { role: "user", content: prompt },
    ], temperature, maxTokens });

    return c.json({
      bookId,
      sourceMode: asString(body.sourceMode) ?? "writing-mode",
      content: response.content,
      model: response.model,
      usage: response.usage,
    });
  });

  // ---- POST /api/books/:bookId/dialogue/generate ----
  app.post("/api/books/:bookId/dialogue/generate", async (c) => {
    const body = await readJsonBody(c);
    const bookId = c.req.param("bookId");

    const characters: DialogueCharacter[] = Array.isArray(body.characters)
      ? (body.characters as Record<string, unknown>[]).map((ch) => ({
          name: asString(ch.name) ?? "",
          personality: asString(ch.personality),
          speechStyle: asString(ch.speechStyle),
        }))
      : [];

    if (characters.length === 0) {
      return c.json({ error: "At least one character is required." }, 400);
    }

    const input: DialogueInput = {
      characters,
      scene: asString(body.scene) ?? "",
      purpose: asString(body.purpose) ?? "",
      turns: asNumber(body.turns) ?? 5,
      direction: asString(body.direction),
    };

    const context: InlineWriteContext = {
      bookId,
      chapterNumber: asNumber(body.chapterNumber) ?? 1,
      beforeText: asString(body.beforeText) ?? "",
      afterText: asString(body.afterText),
      styleGuide: asString(body.styleGuide),
      bookRules: asString(body.bookRules),
    };

    const prompt = buildDialoguePrompt(input, context);

    const generation = await resolveGeneration(c);
    if (!generation.available) {
      return c.json(buildPromptPreviewResponse(prompt, { bookId, ...unavailableFields(generation) }));
    }
    const response = await generate(generation, { messages: [
      { role: "system", content: "你是 NovelFork 的小说创作执行模型。请只输出符合角色性格的对话内容，不要复述提示词。" },
      { role: "user", content: prompt },
    ], temperature: 0.8, maxTokens: 2048 });

    return c.json({
      mode: "generated",
      content: response.content,
      promptPreview: prompt,
      model: response.model,
      usage: response.usage,
      bookId,
    });
  });

  // ---- POST /api/books/:bookId/variants/generate ----
  app.post("/api/books/:bookId/variants/generate", async (c) => {
    const body = await readJsonBody(c);
    const bookId = c.req.param("bookId");

    const input: VariantInput = {
      mode: "variant",
      selectedText: asString(body.selectedText) ?? "",
      direction: asString(body.direction),
    };

    const context: InlineWriteContext = {
      bookId,
      chapterNumber: asNumber(body.chapterNumber) ?? 1,
      beforeText: asString(body.beforeText) ?? "",
      afterText: asString(body.afterText),
      styleGuide: asString(body.styleGuide),
      bookRules: asString(body.bookRules),
    };

    const count = Math.min(5, Math.max(2, asNumber(body.count) ?? 3));
    const prompts = buildVariantPrompts(input, context, count);

    const generation = await resolveGeneration(c);
    if (!generation.available) {
      return c.json({
        mode: "prompt-preview",
        promptPreviews: prompts,
        prompts,
        count,
        bookId,
        ...unavailableFields(generation),
      });
    }
    const variants: { content: string; prompt: string }[] = [];
    let model = generation.model;
    for (const prompt of prompts) {
      const response = await generate(generation, { messages: [
        { role: "system", content: "你是 NovelFork 的小说创作执行模型。请只输出变体内容，不要复述提示词。" },
        { role: "user", content: prompt },
      ], temperature: 0.9, maxTokens: 2048 });
      model = response.model ?? model;
      variants.push({ content: response.content, prompt });
    }

    return c.json({
      mode: "generated",
      variants,
      count,
      model,
      usage: { total: variants.length },
      bookId,
    });
  });

  // ---- POST /api/books/:bookId/outline/branch ----
  app.post("/api/books/:bookId/outline/branch", async (c) => {
    const body = await readJsonBody(c);
    const bookId = c.req.param("bookId");

    const outline = Array.isArray(body.outline) ? body.outline as { id: string; title: string; summary: string }[] : [];
    const hooks = Array.isArray(body.hooks) ? body.hooks as { id: string; description: string; status: "planted" | "growing" | "resolved" }[] : [];
    const state = asString(body.state) ?? "";
    const summaries = Array.isArray(body.summaries) ? body.summaries as { chapterNumber: number; summary: string }[] : [];

    const prompt = buildBranchPrompt(outline, hooks, state, summaries);

    const generation = await resolveGeneration(c);
    if (!generation.available) {
      return c.json(buildPromptPreviewResponse(prompt, { bookId, ...unavailableFields(generation) }));
    }
    const response = await generate(generation, { messages: [
      { role: "system", content: "你是 NovelFork 的小说创作执行模型。请输出大纲分支建议，不要复述提示词。" },
      { role: "user", content: prompt },
    ], temperature: 0.8, maxTokens: 2048 });

    return c.json({
      mode: "generated",
      content: response.content,
      promptPreview: prompt,
      model: response.model,
      usage: response.usage,
      bookId,
    });
  });

  // ---- POST /api/books/:bookId/outline/branch/:branchId/expand ----
  app.post("/api/books/:bookId/outline/branch/:branchId/expand", async (c) => {
    const bookId = c.req.param("bookId");
    const branchId = c.req.param("branchId");
    const body = await readJsonBody(c);

    const branchTitle = asString(body.title) ?? "";
    const branchDescription = asString(body.description) ?? "";
    const chapters = Array.isArray(body.chapters) ? body.chapters : [];

    const prompt = [
      "# 大纲分支扩展任务",
      `将以下分支扩展为完整的章节大纲。`,
      `## 分支信息`,
      `- ID: ${branchId}`,
      `- 标题: ${branchTitle}`,
      `- 描述: ${branchDescription}`,
      `## 已有章节规划`,
      JSON.stringify(chapters, null, 2),
      "## 输出要求",
      "- 为每章补充详细的场景列表、角色出场、情绪曲线",
      "- 标注伏笔的埋设和回收时机",
    ].join("\n\n");

    const generation = await resolveGeneration(c);
    if (!generation.available) {
      return c.json(buildPromptPreviewResponse(prompt, { bookId, branchId, ...unavailableFields(generation) }));
    }
    const response = await generate(generation, { messages: [
      { role: "system", content: "你是 NovelFork 的小说创作执行模型。请输出扩展后的章节大纲，不要复述提示词。" },
      { role: "user", content: prompt },
    ], temperature: 0.7, maxTokens: 3072 });

    return c.json({
      mode: "generated",
      content: response.content,
      promptPreview: prompt,
      model: response.model,
      usage: response.usage,
      bookId,
      branchId,
    });
  });

  // ---- POST /api/works/import ----
  app.post("/api/works/import", async (c) => {
    const body = await readJsonBody(c);
    const content = asString(body.content) ?? "";
    const filename = asString(body.filename) ?? "untitled.txt";

    if (!content.trim()) {
      return c.json({ error: "Content is empty." }, 400);
    }

    const result = parseFile(content, filename);
    return c.json({ ...result, filename });
  });

  // ---- GET /api/books/:bookId/style/profile ----
  //
  // 兼容统计面板；新预设存在时，指纹与指南都从预设派生，不再读旧文件。
  app.get("/api/books/:bookId/style/profile", async (c) => {
    const bookId = c.req.param("bookId");
    const loaded = await loadStylePreset(ctx.state.bookDir(bookId));
    const profile = loaded.preset?.fingerprint ?? null;
    return c.json({ profile, exists: profile !== null, guideText: loaded.guideText, source: loaded.source });
  });

  // ---- POST /api/books/:bookId/style/distill ----
  //
  // 纯统计蒸馏：从作者提供的参考样文提取文风指纹并落盘。不调模型。
  app.post("/api/books/:bookId/style/distill", async (c) => {
    const body = await readJsonBody(c);
    const bookId = c.req.param("bookId");
    const samples = Array.isArray(body.samples)
      ? body.samples.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : typeof body.text === "string" && body.text.trim() ? [body.text] : [];
    if (samples.length === 0) {
      return c.json({ error: "samples 至少需要一段非空参考正文。" }, 400);
    }

    const profile = distillStyleProfile(samples);
    // persist 缺省为 true：作者点「提取并设为基准」就是要它生效。
    const persist = body.persist !== false;
    if (persist) {
      await updateStyleFingerprint(ctx.state.bookDir(bookId), profile);
    }
    return c.json({ profile, persisted: persist, bookId });
  });

  // ---- GET /api/style/personal-profile ----
  app.get("/api/style/personal-profile", async (c) => {
    const raw = c.req.query("profiles");
    if (!raw) {
      return c.json({ error: "Missing profiles query parameter (JSON array)." }, 400);
    }

    let profiles: ImportStyleProfile[];
    try {
      profiles = JSON.parse(raw) as ImportStyleProfile[];
    } catch {
      return c.json({ error: "Invalid JSON in profiles parameter." }, 400);
    }

    if (!Array.isArray(profiles)) {
      return c.json({ error: "profiles must be a JSON array." }, 400);
    }

    const merged = mergeStyleProfiles(profiles);
    return c.json({ profile: merged });
  });

  // ---- POST /api/books/:bookId/style/drift-check ----
  app.post("/api/books/:bookId/style/drift-check", async (c) => {
    const body = await readJsonBody(c);
    const bookId = c.req.param("bookId");

    const current = body.current as ImportStyleProfile | undefined;
    let base = body.base as ImportStyleProfile | string | undefined;

    if (!current) {
      return c.json({ error: "current StyleProfile is required." }, 400);
    }

    // 与统计面板、写作指南共用同一份启用预设。
    if (base === "auto" || !base) {
      const profile = await readStyleFingerprint(ctx.state.bookDir(bookId));
      base = profile ? { ...profile, dialogueRatio: profile.dialogueRatio ?? 0 } :
        { avgSentenceLength: 20, vocabularyDiversity: 0.65, sentenceLengthStdDev: 8, dialogueRatio: 0.3 };
    }

    const drift = detectStyleDrift(current, base as ImportStyleProfile);
    return c.json({ drift, bookId, base, current });
  });

  return app;
}

/** 没有可用模型时随预览一起返回的说明；reason 保持稳定值，细分原因看 code。 */
function unavailableFields(unavailable: UnavailableGeneration) {
  return {
    reason: "model-unavailable" as const,
    modelUnavailableCode: unavailable.code,
    explanation: modelUnavailableExplanation(unavailable),
  };
}

function buildPromptPreviewResponse<T extends Record<string, unknown>>(prompt: string, extra: T) {
  return {
    mode: "prompt-preview" as const,
    promptPreview: prompt,
    prompt,
    ...extra,
  };
}

type JsonContext = { readonly req: { json: <T>() => Promise<T> } };

async function readJsonBody(c: JsonContext): Promise<Record<string, unknown>> {
  return c.req.json<Record<string, unknown>>().catch(() => ({}));
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
