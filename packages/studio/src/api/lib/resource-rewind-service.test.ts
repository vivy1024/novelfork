import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createResourceRewindService } from "./resource-rewind-service";

function sha256(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

describe("resource rewind service", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "novelfork-resource-rewind-"));
    await mkdir(join(root, "books", "book-1", "chapters"), { recursive: true });
    await mkdir(join(root, "books", "book-1", ".novelfork", "checkpoints", "checkpoint-1", "resources"), { recursive: true });
    await writeFile(join(root, "books", "book-1", "chapters", "0001_first.md"), "新正文", "utf-8");
    await writeFile(join(root, "books", "book-1", ".novelfork", "checkpoints", "checkpoint-1", "resources", "chapters__0001_first.md"), "旧正文", "utf-8");
    await writeFile(join(root, "books", "book-1", ".novelfork", "checkpoints", "checkpoint-1", "checkpoint.json"), JSON.stringify({
      id: "checkpoint-1",
      bookId: "book-1",
      sessionId: "session-1",
      messageId: "message-1",
      toolUseId: "tool-1",
      reason: "chapter-write",
      createdAt: "2026-05-06T10:00:00.000Z",
      resources: [{
        kind: "chapter",
        id: "chapter:1",
        path: "chapters/0001_first.md",
        beforeHash: sha256("旧正文"),
        snapshotRef: ".novelfork/checkpoints/checkpoint-1/resources/chapters__0001_first.md",
      }],
    }, null, 2), "utf-8");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  function service() {
    return createResourceRewindService({
      bookDir: (bookId) => join(root, "books", bookId),
      now: () => "2026-05-06T11:00:00.000Z",
      createId: () => "rewind-checkpoint-1",
    });
  }

  it("previews checkpoint restore with diff, hashes, and risk", async () => {
    const preview = await service().previewRewind({ bookId: "book-1", checkpointId: "checkpoint-1" });

    expect(preview).toMatchObject({
      ok: true,
      preview: {
        checkpointId: "checkpoint-1",
        resources: [{
          kind: "chapter",
          path: "chapters/0001_first.md",
          snapshotHash: sha256("旧正文"),
          currentHash: sha256("新正文"),
          currentExists: true,
          snapshotExists: true,
          changed: true,
          risk: "confirmed-write",
          diff: { before: "旧正文", after: "新正文" },
        }],
      },
    });
  });

  it("requires confirmation before applying a rewind and preserves content while pending", async () => {
    const result = await service().applyRewind({ bookId: "book-1", checkpointId: "checkpoint-1" });

    expect(result).toMatchObject({ ok: true, status: "pending-confirmation", confirmation: { toolName: "resource.rewind", risk: "destructive" } });
    await expect(readFile(join(root, "books", "book-1", "chapters", "0001_first.md"), "utf-8")).resolves.toBe("新正文");
  });

  it("records rejection without restoring content", async () => {
    const result = await service().applyRewind({
      bookId: "book-1",
      checkpointId: "checkpoint-1",
      confirmationDecision: { confirmationId: "confirm-rewind-1", decision: "rejected", reason: "先不回滚", decidedAt: "2026-05-06T11:01:00.000Z", sessionId: "session-1" },
    });

    expect(result).toMatchObject({ ok: true, status: "rejected", audit: { decision: "rejected", checkpointId: "checkpoint-1", reason: "先不回滚" } });
    await expect(readFile(join(root, "books", "book-1", "chapters", "0001_first.md"), "utf-8")).resolves.toBe("新正文");
  });

  it("restores approved resources, creates a safety checkpoint, and records audit", async () => {
    const result = await service().applyRewind({
      bookId: "book-1",
      checkpointId: "checkpoint-1",
      expectedCurrentHashes: { "chapters/0001_first.md": sha256("新正文") },
      confirmationDecision: { confirmationId: "confirm-rewind-1", decision: "approved", decidedAt: "2026-05-06T11:01:00.000Z", sessionId: "session-1" },
    });

    expect(result).toMatchObject({ ok: true, status: "applied", checkpointId: "checkpoint-1", safetyCheckpointId: "rewind-checkpoint-1", restoredResources: [{ path: "chapters/0001_first.md" }] });
    await expect(readFile(join(root, "books", "book-1", "chapters", "0001_first.md"), "utf-8")).resolves.toBe("旧正文");
    const safetyManifest = JSON.parse(await readFile(join(root, "books", "book-1", ".novelfork", "checkpoints", "rewind-checkpoint-1", "checkpoint.json"), "utf-8"));
    expect(safetyManifest).toMatchObject({ reason: "rewind-apply", resources: [expect.objectContaining({ beforeHash: sha256("新正文") })] });
    const audit = JSON.parse(await readFile(join(root, "books", "book-1", ".novelfork", "checkpoints", "rewind-audit.json"), "utf-8"));
    expect(audit).toEqual([expect.objectContaining({ decision: "approved", checkpointId: "checkpoint-1", safetyCheckpointId: "rewind-checkpoint-1" })]);
  });

  it("fails when the resource changed after preview", async () => {
    await writeFile(join(root, "books", "book-1", "chapters", "0001_first.md"), "第三版", "utf-8");

    const result = await service().applyRewind({
      bookId: "book-1",
      checkpointId: "checkpoint-1",
      expectedCurrentHashes: { "chapters/0001_first.md": sha256("新正文") },
      confirmationDecision: { confirmationId: "confirm-rewind-1", decision: "approved", decidedAt: "2026-05-06T11:01:00.000Z", sessionId: "session-1" },
    });

    expect(result).toEqual({ ok: false, error: "rewind-conflict", resource: "chapters/0001_first.md", expectedHash: sha256("新正文"), currentHash: sha256("第三版") });
    await expect(readFile(join(root, "books", "book-1", "chapters", "0001_first.md"), "utf-8")).resolves.toBe("第三版");
  });

  it("fails when the current resource was moved or deleted", async () => {
    await unlink(join(root, "books", "book-1", "chapters", "0001_first.md"));

    const result = await service().applyRewind({
      bookId: "book-1",
      checkpointId: "checkpoint-1",
      confirmationDecision: { confirmationId: "confirm-rewind-1", decision: "approved", decidedAt: "2026-05-06T11:01:00.000Z", sessionId: "session-1" },
    });

    expect(result).toEqual({ ok: false, error: "rewind-resource-moved", resource: "chapters/0001_first.md" });
  });
});
