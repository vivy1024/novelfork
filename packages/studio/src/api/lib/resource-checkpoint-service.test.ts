import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createResourceCheckpointService, shouldCreateFormalResourceCheckpoint } from "./resource-checkpoint-service";

function sha256(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

describe("resource checkpoint service", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "novelfork-resource-checkpoint-"));
    await mkdir(join(root, "books", "book-1", "chapters"), { recursive: true });
    await mkdir(join(root, "books", "book-1", "story"), { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("snapshots formal resource content before writes and records stable metadata", async () => {
    await writeFile(join(root, "books", "book-1", "chapters", "0001_first.md"), "旧正文", "utf-8");
    const service = createResourceCheckpointService({
      bookDir: (bookId) => join(root, "books", bookId),
      now: () => "2026-05-06T10:00:00.000Z",
      createId: () => "checkpoint-1",
    });

    const result = await service.createCheckpoint({
      bookId: "book-1",
      sessionId: "session-1",
      messageId: "message-1",
      toolUseId: "tool-1",
      reason: "chapter-save",
      resources: [{ kind: "chapter", id: "chapter:1", path: "chapters/0001_first.md" }],
    });

    expect(result).toMatchObject({ ok: true, checkpoint: { id: "checkpoint-1", sessionId: "session-1", messageId: "message-1", toolUseId: "tool-1" } });
    if (!result.ok) throw new Error("expected checkpoint success");
    expect(result.checkpoint.resources[0]).toMatchObject({
      kind: "chapter",
      id: "chapter:1",
      path: "chapters/0001_first.md",
      beforeHash: sha256("旧正文"),
      snapshotRef: ".novelfork/checkpoints/checkpoint-1/resources/chapters__0001_first.md",
    });
    await expect(readFile(join(root, "books", "book-1", ".novelfork", "checkpoints", "checkpoint-1", "resources", "chapters__0001_first.md"), "utf-8")).resolves.toBe("旧正文");
    const manifest = JSON.parse(await readFile(join(root, "books", "book-1", ".novelfork", "checkpoints", "checkpoint-1", "checkpoint.json"), "utf-8"));
    expect(manifest).toMatchObject({ id: "checkpoint-1", bookId: "book-1", reason: "chapter-save", resources: result.checkpoint.resources });
  });

  it("returns a real error when a required resource is missing", async () => {
    const service = createResourceCheckpointService({
      bookDir: (bookId) => join(root, "books", bookId),
      now: () => "2026-05-06T10:00:00.000Z",
      createId: () => "checkpoint-missing",
    });

    const result = await service.createCheckpoint({
      bookId: "book-1",
      sessionId: "session-1",
      resources: [{ kind: "chapter", id: "chapter:404", path: "chapters/0404_missing.md", required: true }],
    });

    expect(result).toEqual({ ok: false, error: "checkpoint-resource-missing", resource: "chapters/0404_missing.md" });
    await expect(readFile(join(root, "books", "book-1", ".novelfork", "checkpoints", "checkpoint-missing", "checkpoint.json"), "utf-8")).rejects.toThrow();
  });

  it("does not require checkpoints for candidate, draft, or prompt-preview resources", () => {
    expect(shouldCreateFormalResourceCheckpoint({ kind: "chapter", path: "chapters/0001.md" })).toBe(true);
    expect(shouldCreateFormalResourceCheckpoint({ kind: "truth", path: "story/story_bible.md" })).toBe(true);
    expect(shouldCreateFormalResourceCheckpoint({ kind: "candidate", path: "candidates/c1.md" })).toBe(false);
    expect(shouldCreateFormalResourceCheckpoint({ kind: "draft", path: "drafts/d1.md" })).toBe(false);
    expect(shouldCreateFormalResourceCheckpoint({ kind: "prompt-preview", path: "preview" })).toBe(false);
  });
});
