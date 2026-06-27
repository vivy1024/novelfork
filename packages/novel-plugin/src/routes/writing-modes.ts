import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { Hono } from "hono";
import {
  chatCompletion,
} from "@vivy1024/novelfork-core";
import {
  buildContinuationPrompt,
  buildExpansionPrompt,
  buildBridgePrompt,
  buildPolishPrompt,
  buildRewritePrompt,
  buildDialoguePrompt,
  buildVariantPrompts,
  buildBranchPrompt,
  parseFile,
  mergeStyleProfiles,
  detectStyleDrift,
  type InlineWriteContext,
  type ContinuationInput,
  type ExpansionInput,
  type ExpansionDirection,
  type BridgeInput,
  type BridgePurpose,
  type PolishInput,
  type RewriteInput,
  type DialogueInput,
  type DialogueCharacter,
  type VariantInput,
  type ImportStyleProfile,
} from "../engine/index.js";

import type { RouterContext } from "./context.js";


export function createWritingModesRouter(ctx: RouterContext): Hono {
  const app = new Hono();

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
    if (!mode || !["continuation", "expansion", "bridge", "polish", "rewrite"].includes(mode)) {
      return c.json({ error: "Invalid mode. Must be continuation, expansion, bridge, polish, or rewrite." }, 400);
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
    } else {
      const input: RewriteInput = { mode: "rewrite", selectedText, direction: asString(body.direction) };
      prompt = buildRewritePrompt(input, context);
    }

    const sessionLlm = await ctx.getSessionLlm(c);
    if (!sessionLlm) {
      return c.json(buildPromptPreviewResponse(prompt, { bookId, writingMode: mode, reason: "no-session-llm" }));
    }
    const runtimeConfig = await ctx.buildPipelineConfig(sessionLlm);
    const response = await chatCompletion(runtimeConfig.client, runtimeConfig.model, [
      { role: "system", content: "你是 NovelFork 的小说创作执行模型。请只输出可供用户复制、合并或明确应用到正式章节/多版本流程的正文内容，不要复述提示词。" },
      { role: "user", content: prompt },
    ], { temperature: 0.7, maxTokens: 2048 });

    return c.json({
      mode: "generated",
      writingMode: mode,
      content: response.content,
      promptPreview: prompt,
      model: runtimeConfig.model,
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

    const sessionLlm = await ctx.getSessionLlm(c);
    const runtimeConfig = await ctx.buildPipelineConfig(sessionLlm);
    const temperature = clampNumber(asNumber(body.temperature) ?? 0.7, 0, 2);
    const maxTokens = Math.min(8192, Math.max(256, asNumber(body.maxTokens) ?? 2048));
    const response = await chatCompletion(runtimeConfig.client, runtimeConfig.model, [
      {
        role: "system",
        content: "你是 NovelFork 的小说创作执行模型。请只输出可供用户复制、合并或明确应用到正式章节/多版本流程的正文、对话或大纲内容，不要复述提示词。",
      },
      { role: "user", content: prompt },
    ], { temperature, maxTokens });

    return c.json({
      bookId,
      sourceMode: asString(body.sourceMode) ?? "writing-mode",
      content: response.content,
      model: runtimeConfig.model,
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

    const sessionLlm = await ctx.getSessionLlm(c);
    if (!sessionLlm) {
      return c.json(buildPromptPreviewResponse(prompt, { bookId, reason: "no-session-llm" }));
    }
    const runtimeConfig = await ctx.buildPipelineConfig(sessionLlm);
    const response = await chatCompletion(runtimeConfig.client, runtimeConfig.model, [
      { role: "system", content: "你是 NovelFork 的小说创作执行模型。请只输出符合角色性格的对话内容，不要复述提示词。" },
      { role: "user", content: prompt },
    ], { temperature: 0.8, maxTokens: 2048 });

    return c.json({
      mode: "generated",
      content: response.content,
      promptPreview: prompt,
      model: runtimeConfig.model,
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

    const sessionLlm = await ctx.getSessionLlm(c);
    if (!sessionLlm) {
      return c.json({
        mode: "prompt-preview",
        promptPreviews: prompts,
        prompts,
        count,
        bookId,
        reason: "no-session-llm",
      });
    }
    const runtimeConfig = await ctx.buildPipelineConfig(sessionLlm);
    const variants: { content: string; prompt: string }[] = [];
    for (const prompt of prompts) {
      const response = await chatCompletion(runtimeConfig.client, runtimeConfig.model, [
        { role: "system", content: "你是 NovelFork 的小说创作执行模型。请只输出变体内容，不要复述提示词。" },
        { role: "user", content: prompt },
      ], { temperature: 0.9, maxTokens: 2048 });
      variants.push({ content: response.content, prompt });
    }

    return c.json({
      mode: "generated",
      variants,
      count,
      model: runtimeConfig.model,
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

    const sessionLlm = await ctx.getSessionLlm(c);
    if (!sessionLlm) {
      return c.json(buildPromptPreviewResponse(prompt, { bookId, reason: "no-session-llm" }));
    }
    const runtimeConfig = await ctx.buildPipelineConfig(sessionLlm);
    const response = await chatCompletion(runtimeConfig.client, runtimeConfig.model, [
      { role: "system", content: "你是 NovelFork 的小说创作执行模型。请输出大纲分支建议，不要复述提示词。" },
      { role: "user", content: prompt },
    ], { temperature: 0.8, maxTokens: 2048 });

    return c.json({
      mode: "generated",
      content: response.content,
      promptPreview: prompt,
      model: runtimeConfig.model,
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

    const sessionLlm = await ctx.getSessionLlm(c);
    if (!sessionLlm) {
      return c.json(buildPromptPreviewResponse(prompt, { bookId, branchId, reason: "no-session-llm" }));
    }
    const runtimeConfig = await ctx.buildPipelineConfig(sessionLlm);
    const response = await chatCompletion(runtimeConfig.client, runtimeConfig.model, [
      { role: "system", content: "你是 NovelFork 的小说创作执行模型。请输出扩展后的章节大纲，不要复述提示词。" },
      { role: "user", content: prompt },
    ], { temperature: 0.7, maxTokens: 3072 });

    return c.json({
      mode: "generated",
      content: response.content,
      promptPreview: prompt,
      model: runtimeConfig.model,
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

    // Support base: "auto" — read from stored style_profile.json
    if (base === "auto" || !base) {
      try {
        const profilePath = join(ctx.state.bookDir(bookId), "story", "style_profile.json");
        const raw = await readFile(profilePath, "utf-8");
        base = JSON.parse(raw) as ImportStyleProfile;
      } catch {
        // No stored profile — use sensible defaults as baseline
        base = { avgSentenceLength: 20, vocabularyDiversity: 0.65, sentenceLengthStdDev: 8, dialogueRatio: 0.3 };
      }
    }

    const drift = detectStyleDrift(current, base as ImportStyleProfile);
    return c.json({ drift, bookId, base, current });
  });

  return app;
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
