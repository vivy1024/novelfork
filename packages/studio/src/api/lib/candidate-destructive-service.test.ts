import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createCandidateDestructiveService } from "./candidate-destructive-service";

describe("candidate destructive service", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "novelfork-candidate-destructive-service-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  function service() {
    return createCandidateDestructiveService({ root });
  }

  it("hard-deletes a draft file and removes it from the draft index", async () => {
    const bookDir = join(root, "books", "book-1");
    await mkdir(join(bookDir, "drafts"), { recursive: true });
    await writeFile(join(bookDir, "drafts", "draft-1.md"), "draft body", "utf-8");
    await writeFile(join(bookDir, "drafts", "index.json"), JSON.stringify([
      { id: "draft-1", bookId: "book-1", title: "草稿", createdAt: "2026-05-05T00:00:00.000Z", updatedAt: "2026-05-05T00:00:00.000Z", wordCount: 4, fileName: "draft-1.md" },
    ], null, 2), "utf-8");

    await expect(service().deleteDraft("book-1", "draft-1")).resolves.toEqual({ ok: true, draftId: "draft-1", mode: "hard-delete" });
    await expect(access(join(bookDir, "drafts", "draft-1.md"))).rejects.toThrow();
    await expect(readFile(join(bookDir, "drafts", "index.json"), "utf-8")).resolves.toBe("[]");
  });

  it("reports missing draft deletes without rewriting the index", async () => {
    const bookDir = join(root, "books", "book-1");
    await mkdir(join(bookDir, "drafts"), { recursive: true });
    await writeFile(join(bookDir, "drafts", "index.json"), "[]", "utf-8");

    await expect(service().deleteDraft("book-1", "missing")).resolves.toEqual({ error: "Draft not found" });
  });

  it("hard-deletes a candidate content file and removes it from the candidate index", async () => {
    const bookDir = join(root, "books", "book-1");
    await mkdir(join(bookDir, "generated-candidates"), { recursive: true });
    await writeFile(join(bookDir, "generated-candidates", "cand-1.md"), "candidate body", "utf-8");
    await writeFile(join(bookDir, "generated-candidates", "index.json"), JSON.stringify([
      { id: "cand-1", bookId: "book-1", title: "候选", source: "write-next", status: "candidate", createdAt: "2026-05-05T00:00:00.000Z", updatedAt: "2026-05-05T00:00:00.000Z", contentFileName: "cand-1.md" },
    ], null, 2), "utf-8");

    await expect(service().deleteCandidate("book-1", "cand-1")).resolves.toEqual({ ok: true, candidateId: "cand-1", mode: "hard-delete" });
    await expect(access(join(bookDir, "generated-candidates", "cand-1.md"))).rejects.toThrow();
    await expect(readFile(join(bookDir, "generated-candidates", "index.json"), "utf-8")).resolves.toBe("[]");
  });

  it("reports missing candidate deletes without rewriting the index", async () => {
    const bookDir = join(root, "books", "book-1");
    await mkdir(join(bookDir, "generated-candidates"), { recursive: true });
    await writeFile(join(bookDir, "generated-candidates", "index.json"), "[]", "utf-8");

    await expect(service().deleteCandidate("book-1", "missing")).resolves.toEqual({ error: "Candidate not found" });
  });
});
