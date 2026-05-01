import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { Hono } from "hono";
import {
  buildContinuationPrompt,
  buildExpansionPrompt,
  buildBridgePrompt,
  buildDialoguePrompt,
  buildVariantPrompts,
  buildBranchPrompt,
  parseFile,
  mergeStyleProfiles,
  detectStyleDrift,
  chatCompletion,
  type InlineWriteContext,
  type ContinuationInput,
  type ExpansionInput,
  type ExpansionDirection,
  type BridgeInput,
  type BridgePurpose,
  type DialogueInput,
  type DialogueCharacter,
  type VariantInput,
  type ImportStyleProfile,
} from "@vivy1024/novelfork-core";

import type { RouterContext } from "./context.js";

type WritingModeApplyTarget = "candidate" | "draft" | "chapter-insert" | "chapter-replace";

interface CandidateRecord {
  readonly id: string;
  readonly bookId: string;
  readonly targetChapterId?: string;
  readonly title: string;
  readonly source: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly status: "candidate";
  readonly contentFileName: string;
  readonly metadata?: Record<string, unknown>;
}

interface DraftRecord {
  readonly id: string;
  readonly bookId: string;
  readonly title: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly wordCount: number;
  readonly fileName: string;
  readonly metadata?: Record<string, unknown>;
}

export function createWritingModesRouter(ctx: RouterContext): Hono {
  const app = new Hono();

  // ---- POST /api/books/:bookId/inline-write ----
  app.post("/api/books/:bookId/inline-write", async (c) => {
    const body = await readJsonBody(c);
    const bookId = c.req.param("bookId");
    const mode = asString(body.mode);
    if (!mode || !["continuation", "expansion", "bridge"].includes(mode)) {
      return c.json({ error: "Invalid mode. Must be continuation, expansion, or bridge." }, 400);
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
    } else {
      const input: BridgeInput = {
        mode: "bridge",
        selectedText,
        direction: asString(body.direction),
        purpose: (asString(body.purpose) as BridgePurpose) ?? "scene-transition",
      };
      prompt = buildBridgePrompt(input, context);
    }

    const sessionLlm = await ctx.getSessionLlm(c);
    if (!sessionLlm) {
      return c.json(buildPromptPreviewResponse(prompt, { bookId, writingMode: mode, reason: "no-session-llm" }));
    }
    const runtimeConfig = await ctx.buildPipelineConfig(sessionLlm);
    const response = await chatCompletion(runtimeConfig.client, runtimeConfig.model, [
      { role: "system", content: "你是 NovelFork 的小说创作执行模型。请只输出可直接进入作品候选区的正文内容，不要复述提示词。" },
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
        content: "你是 NovelFork 的小说创作执行模型。请只输出可直接进入作品候选区的正文、对话或大纲内容，不要复述提示词。",
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

  // ---- POST /api/books/:bookId/writing-modes/apply ----
  app.post("/api/books/:bookId/writing-modes/apply", async (c) => {
    const bookId = c.req.param("bookId");
    const body = await readJsonBody(c);
    const requestedTarget = parseApplyTarget(body.target);
    if (!requestedTarget) {
      return c.json({ error: "Apply target must be candidate, draft, chapter-insert, or chapter-replace." }, 400);
    }

    const rawContent = asString(body.content) ?? "";
    const content = rawContent.trim();
    if (!content) return c.json({ error: "Generated content is required." }, 400);

    const sourceMode = asString(body.sourceMode) ?? "writing-mode";
    const chapterNumber = asNumber(body.chapterNumber);
    const title = asString(body.title)?.trim() || defaultApplyTitle(requestedTarget, sourceMode);
    const baseMetadata = buildAiResultMetadata(body, { bookId, sourceMode, ...(chapterNumber !== undefined ? { chapterNumber } : {}) });
    const timestamp = new Date().toISOString();
    const bookDir = join(ctx.root, "books", bookId);
    await mkdir(bookDir, { recursive: true });

    if (requestedTarget === "draft") {
      const resourceId = buildSafeId("draft");
      const record: DraftRecord = {
        id: resourceId,
        bookId,
        title,
        createdAt: timestamp,
        updatedAt: timestamp,
        wordCount: countWords(content),
        fileName: `${resourceId}.md`,
        metadata: baseMetadata,
      };
      await saveDraftRecord(bookDir, record, content);
      return c.json({
        target: "draft",
        requestedTarget,
        resourceId,
        status: "draft",
        metadata: baseMetadata,
      }, 201);
    }

    const resourceId = buildSafeId("wm-candidate");
    const nonDestructive = requestedTarget === "chapter-insert" || requestedTarget === "chapter-replace";
    const metadata = { ...baseMetadata, nonDestructive };
    const record: CandidateRecord = {
      id: resourceId,
      bookId,
      ...(chapterNumber ? { targetChapterId: String(chapterNumber) } : {}),
      title,
      source: `writing-mode:${sourceMode}`,
      createdAt: timestamp,
      updatedAt: timestamp,
      status: "candidate",
      contentFileName: `${resourceId}.md`,
      metadata,
    };
    await saveCandidateRecord(bookDir, record, content);
    return c.json({
      target: "candidate",
      requestedTarget,
      resourceId,
      status: "candidate",
      metadata,
    }, 201);
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
    const base = body.base as ImportStyleProfile | undefined;

    if (!current || !base) {
      return c.json({ error: "Both current and base StyleProfile are required." }, 400);
    }

    const drift = detectStyleDrift(current, base);
    return c.json({ drift, bookId });
  });

  return app;
}

// ---- Helpers ----

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function buildAiResultMetadata(body: Record<string, unknown>, defaults: Record<string, unknown>): Record<string, unknown> {
  const nested = isRecord(body.metadata) ? body.metadata : {};
  const metadata: Record<string, unknown> = { ...nested, ...defaults };
  for (const key of ["provider", "model", "runId", "requestId"] as const) {
    const value = asString(body[key]);
    if (value) metadata[key] = value;
  }
  return metadata;
}

function parseApplyTarget(value: unknown): WritingModeApplyTarget | undefined {
  if (value === "candidate" || value === "draft" || value === "chapter-insert" || value === "chapter-replace") return value;
  return undefined;
}

function defaultApplyTitle(target: WritingModeApplyTarget, sourceMode: string): string {
  if (target === "draft") return `写作模式草稿：${sourceMode}`;
  if (target === "chapter-insert") return `正文插入候选：${sourceMode}`;
  if (target === "chapter-replace") return `正文替换候选：${sourceMode}`;
  return `写作模式候选：${sourceMode}`;
}

function buildSafeId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

async function saveCandidateRecord(bookDir: string, record: CandidateRecord, content: string): Promise<void> {
  const dir = join(bookDir, "generated-candidates");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, record.contentFileName), content, "utf-8");
  const candidates = await loadIndex<CandidateRecord>(join(dir, "index.json"));
  await writeFile(join(dir, "index.json"), JSON.stringify([...candidates, record], null, 2), "utf-8");
}

async function saveDraftRecord(bookDir: string, record: DraftRecord, content: string): Promise<void> {
  const dir = join(bookDir, "drafts");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, record.fileName), content, "utf-8");
  const drafts = await loadIndex<DraftRecord>(join(dir, "index.json"));
  await writeFile(join(dir, "index.json"), JSON.stringify([...drafts, record], null, 2), "utf-8");
}

async function loadIndex<T>(filePath: string): Promise<T[]> {
  try {
    return JSON.parse(await readFile(filePath, "utf-8")) as T[];
  } catch {
    return [];
  }
}

function countWords(content: string): number {
  return content.replace(/\s+/g, "").length;
}
