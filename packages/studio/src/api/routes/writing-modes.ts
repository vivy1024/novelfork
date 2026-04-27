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

export function createWritingModesRouter(_ctx: RouterContext): Hono {
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

    return c.json({ prompt, mode, bookId });
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
    return c.json({ prompt, bookId });
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
    return c.json({ prompts, count, bookId });
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
    return c.json({ prompt, bookId });
  });

  // ---- POST /api/books/:bookId/outline/branch/:branchId/expand ----
  app.post("/api/books/:bookId/outline/branch/:branchId/expand", async (c) => {
    const bookId = c.req.param("bookId");
    const branchId = c.req.param("branchId");
    const body = await readJsonBody(c);

    // 扩展分支为完整大纲 — 构建 prompt 返回给前端
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

    return c.json({ prompt, bookId, branchId });
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
