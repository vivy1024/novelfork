/**
 * AI Relay routes — stateless snapshot-based AI execution.
 * Client sends a WriteSnapshot, server materializes it to a temp dir,
 * runs PipelineRunner, and returns the result. No persistent storage.
 *
 * Mounted in relay mode only. Standalone mode uses ai.ts instead.
 */

import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, rm, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  PipelineRunner,
  createLLMClient,
  createLogger,
  type PipelineConfig,
  type LLMConfig,
} from "@actalk/inkos-core";
import type { RouterContext } from "./context.js";

interface SnapshotChapter {
  readonly num: number;
  readonly title: string;
  readonly content: string;
  readonly status?: string;
  readonly wordCount?: number;
}

interface RelaySnapshot {
  readonly bookId: string;
  readonly bookConfig: Record<string, unknown>;
  readonly chapters: ReadonlyArray<SnapshotChapter>;
  readonly chapterIndex: ReadonlyArray<Record<string, unknown>>;
  readonly truthFiles: Record<string, string>;
  readonly outline?: string;
  readonly styleProfile?: string;
}

interface RelayLLMConfig {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly model: string;
  readonly provider?: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly stream?: boolean;
  readonly modelOverrides?: Record<string, string>;
  readonly thinkingBudget?: number;
  readonly apiFormat?: "chat" | "responses";
  readonly extra?: Record<string, unknown>;
  readonly headers?: Record<string, string>;
}

/**
 * Materialize a snapshot into a temporary projectRoot directory
 * that PipelineRunner can operate on.
 */
async function materializeSnapshot(
  snapshot: RelaySnapshot,
): Promise<string> {
  const runId = randomUUID();
  const root = join(tmpdir(), `inkos-relay-${runId}`);
  const bookDir = join(root, "books", snapshot.bookId);
  const storyDir = join(bookDir, "story");
  const chaptersDir = join(bookDir, "chapters");

  await mkdir(chaptersDir, { recursive: true });
  await mkdir(storyDir, { recursive: true });

  // book.json
  await writeFile(
    join(bookDir, "book.json"),
    JSON.stringify(snapshot.bookConfig, null, 2),
    "utf-8",
  );

  // chapter_index.json
  await writeFile(
    join(bookDir, "chapter_index.json"),
    JSON.stringify(snapshot.chapterIndex, null, 2),
    "utf-8",
  );

  // Chapter files
  for (const ch of snapshot.chapters) {
    const padded = String(ch.num).padStart(4, "0");
    const title = ch.title.replace(/[/\\:*?"<>|]/g, "_");
    const filename = `${padded}_${title}.md`;
    await writeFile(join(chaptersDir, filename), ch.content, "utf-8");
  }

  // Truth files
  for (const [name, content] of Object.entries(snapshot.truthFiles)) {
    await writeFile(join(storyDir, name), content, "utf-8");
  }

  // Outline
  if (snapshot.outline) {
    await writeFile(join(storyDir, "volume_outline.md"), snapshot.outline, "utf-8");
  }

  // Style profile
  if (snapshot.styleProfile) {
    await writeFile(join(bookDir, "style_profile.json"), snapshot.styleProfile, "utf-8");
  }

  // Minimal inkos.json so PipelineRunner doesn't crash
  await writeFile(
    join(root, "inkos.json"),
    JSON.stringify({ name: "relay-run", version: "0.1.0", language: (snapshot.bookConfig.language as string) ?? "zh", llm: {} }, null, 2),
    "utf-8",
  );

  return root;
}

function buildRelayPipelineConfig(
  root: string,
  llm: RelayLLMConfig,
): PipelineConfig {
  const llmConfig: LLMConfig = {
    apiKey: llm.apiKey,
    baseUrl: llm.baseUrl,
    model: llm.model,
    provider: (llm.provider as LLMConfig["provider"]) ?? "openai",
    temperature: llm.temperature ?? 0.7,
    maxTokens: llm.maxTokens ?? 8192,
    thinkingBudget: llm.thinkingBudget ?? 0,
    apiFormat: llm.apiFormat ?? "chat",
    extra: llm.extra,
    headers: llm.headers,
    stream: llm.stream ?? true,
  };

  const logger = createLogger({ tag: "relay", sinks: [] });

  return {
    client: createLLMClient(llmConfig),
    model: llm.model,
    projectRoot: root,
    defaultLLMConfig: llmConfig,
    modelOverrides: llm.modelOverrides,
    logger,
  };
}

async function cleanup(root: string): Promise<void> {
  try {
    await rm(root, { recursive: true, force: true });
  } catch { /* best effort */ }
}
export function createAIRelayRouter(_ctx: RouterContext): Hono {
  const app = new Hono();

  // --- Write Next (snapshot-based) ---
  app.post("/api/ai/write-next", async (c) => {
    const { snapshot, llm, wordCount } = await c.req.json<{
      snapshot: RelaySnapshot;
      llm: RelayLLMConfig;
      wordCount?: number;
    }>();

    let root: string | null = null;
    try {
      root = await materializeSnapshot(snapshot);
      const config = buildRelayPipelineConfig(root, llm);
      const runner = new PipelineRunner(config);
      const result = await runner.writeNextChapter(snapshot.bookId, wordCount);
      return c.json({ ok: true, result });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
    } finally {
      if (root) void cleanup(root);
    }
  });

  // --- Draft (snapshot-based) ---
  app.post("/api/ai/draft", async (c) => {
    const { snapshot, llm, wordCount, context } = await c.req.json<{
      snapshot: RelaySnapshot;
      llm: RelayLLMConfig;
      wordCount?: number;
      context?: string;
    }>();

    let root: string | null = null;
    try {
      root = await materializeSnapshot(snapshot);
      const config = buildRelayPipelineConfig(root, llm);
      if (context) (config as unknown as Record<string, unknown>).externalContext = context;
      const runner = new PipelineRunner(config);
      const result = await runner.writeDraft(snapshot.bookId, context, wordCount);
      return c.json({ ok: true, result });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
    } finally {
      if (root) void cleanup(root);
    }
  });

  // --- Audit (snapshot-based) ---
  app.post("/api/ai/audit", async (c) => {
    const { snapshot, llm, chapterNum } = await c.req.json<{
      snapshot: RelaySnapshot;
      llm: RelayLLMConfig;
      chapterNum: number;
    }>();

    let root: string | null = null;
    try {
      root = await materializeSnapshot(snapshot);
      const config = buildRelayPipelineConfig(root, llm);
      const runner = new PipelineRunner(config);
      const result = await runner.auditDraft(snapshot.bookId, chapterNum);
      return c.json(result);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
    } finally {
      if (root) void cleanup(root);
    }
  });
  // --- Revise (snapshot-based) ---
  app.post("/api/ai/revise", async (c) => {
    const { snapshot, llm, chapterNum, mode, brief } = await c.req.json<{
      snapshot: RelaySnapshot;
      llm: RelayLLMConfig;
      chapterNum: number;
      mode?: string;
      brief?: string;
    }>();

    let root: string | null = null;
    try {
      root = await materializeSnapshot(snapshot);
      const config = buildRelayPipelineConfig(root, llm);
      if (brief) (config as unknown as Record<string, unknown>).externalContext = brief;
      const runner = new PipelineRunner(config);
      const result = await runner.reviseDraft(
        snapshot.bookId,
        chapterNum,
        (mode ?? "spot-fix") as "spot-fix" | "polish" | "rewrite" | "rework" | "anti-detect",
      );
      return c.json({ ok: true, result });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
    } finally {
      if (root) void cleanup(root);
    }
  });

  // --- Detect (content-based, no snapshot needed) ---
  app.post("/api/ai/detect", async (c) => {
    const { content } = await c.req.json<{ content: string }>();
    if (!content?.trim()) return c.json({ error: "content is required" }, 400);
    try {
      const { analyzeAITells } = await import("@actalk/inkos-core");
      const result = analyzeAITells(content);
      return c.json(result);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
  });

  // --- Style Analyze (content-based, no snapshot needed) ---
  app.post("/api/ai/style", async (c) => {
    const { text, sourceName } = await c.req.json<{ text: string; sourceName: string }>();
    if (!text?.trim()) return c.json({ error: "text is required" }, 400);
    try {
      const { analyzeStyle } = await import("@actalk/inkos-core");
      const profile = analyzeStyle(text, sourceName ?? "unknown");
      return c.json(profile);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
  });

  return app;
}
