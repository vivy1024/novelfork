/**
 * Integration tests for workspace-service.ts
 * Covers: path traversal rejection, normal CRUD, search, atomic writes, mtime conflict.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  resolveWithinWorkspace,
  buildProjectTree,
  readWorkspaceFile,
  writeWorkspaceFile,
  mkdirWorkspace,
  renameWorkspace,
  deleteWorkspace,
  searchWorkspace,
  WorkspaceSecurityError,
} from "../lib/workspace-service.js";

describe("workspace-service", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "inkos-ws-test-"));
    // Create a minimal InkOS structure
    await mkdir(join(root, "books", "test-book", "chapters"), { recursive: true });
    await mkdir(join(root, "books", "test-book", "story"), { recursive: true });
    await writeFile(join(root, "inkos.json"), '{"name": "test"}', "utf-8");
    await writeFile(join(root, "books", "test-book", "book.json"), '{"title": "Test"}', "utf-8");
    await writeFile(
      join(root, "books", "test-book", "chapters", "0001-first-chapter.md"),
      "# 第一章 起源\n\n萧云站在修炼舱前，Risk 指数显示 0.42。",
      "utf-8",
    );
    await writeFile(
      join(root, "books", "test-book", "story", "current_state.md"),
      "# Current State\n\n主角：萧云，L_fit=41",
      "utf-8",
    );
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------------------
  // Path traversal rejection
  // ---------------------------------------------------------------------------

  describe("resolveWithinWorkspace — security", () => {
    it("rejects .. traversal", () => {
      expect(() => resolveWithinWorkspace(root, "../etc/passwd")).toThrow(WorkspaceSecurityError);
      expect(() => resolveWithinWorkspace(root, "books/../../etc/passwd")).toThrow(WorkspaceSecurityError);
    });

    it("rejects absolute paths", () => {
      expect(() => resolveWithinWorkspace(root, "/etc/passwd")).toThrow(WorkspaceSecurityError);
      expect(() => resolveWithinWorkspace(root, "C:\\Windows\\System32")).toThrow(WorkspaceSecurityError);
    });

    it("rejects UNC paths", () => {
      expect(() => resolveWithinWorkspace(root, "\\\\server\\share")).toThrow(WorkspaceSecurityError);
      expect(() => resolveWithinWorkspace(root, "//server/share")).toThrow(WorkspaceSecurityError);
    });

    it("rejects null bytes", () => {
      expect(() => resolveWithinWorkspace(root, "books/test\0.json")).toThrow(WorkspaceSecurityError);
    });

    it("rejects empty path", () => {
      expect(() => resolveWithinWorkspace(root, "")).toThrow(WorkspaceSecurityError);
    });

    it("allows valid relative paths", () => {
      const result = resolveWithinWorkspace(root, "books/test-book/book.json");
      expect(result).toBe(join(root, "books", "test-book", "book.json"));
    });

    it("allows nested valid paths", () => {
      const result = resolveWithinWorkspace(root, "books/test-book/chapters/0001-first-chapter.md");
      expect(result).toContain("0001-first-chapter.md");
    });
  });

  // ---------------------------------------------------------------------------
  // Project tree
  // ---------------------------------------------------------------------------

  describe("buildProjectTree", () => {
    it("builds a story-aware tree", async () => {
      const tree = await buildProjectTree(root);
      expect(tree.length).toBeGreaterThan(0);

      // Find books directory
      const booksDir = tree.find(e => e.name === "books");
      expect(booksDir).toBeDefined();
      expect(booksDir!.type).toBe("directory");

      // Find inkos.json with config role
      const configFile = tree.find(e => e.name === "inkos.json");
      expect(configFile).toBeDefined();
      expect(configFile!.storyRole).toBe("config");
    });

    it("identifies chapter files", async () => {
      const tree = await buildProjectTree(root, "", 5);
      // Navigate to chapters
      const books = tree.find(e => e.name === "books");
      const book = books?.children?.find(e => e.name === "test-book");
      const chapters = book?.children?.find(e => e.name === "chapters");
      const chapterFile = chapters?.children?.find(e => e.name === "0001-first-chapter.md");
      expect(chapterFile?.storyRole).toBe("chapter");
    });

    it("identifies truth files", async () => {
      const tree = await buildProjectTree(root, "", 5);
      const books = tree.find(e => e.name === "books");
      const book = books?.children?.find(e => e.name === "test-book");
      const story = book?.children?.find(e => e.name === "story");
      const truthFile = story?.children?.find(e => e.name === "current_state.md");
      expect(truthFile?.storyRole).toBe("truth");
    });
  });

  // ---------------------------------------------------------------------------
  // File CRUD
  // ---------------------------------------------------------------------------

  describe("readWorkspaceFile", () => {
    it("reads a file with metadata", async () => {
      const result = await readWorkspaceFile(root, "inkos.json");
      expect(result.content).toBe('{"name": "test"}');
      expect(result.mtime).toBeTruthy();
      expect(result.size).toBeGreaterThan(0);
    });

    it("throws on traversal attempt", async () => {
      await expect(readWorkspaceFile(root, "../package.json")).rejects.toThrow(WorkspaceSecurityError);
    });
  });

  describe("writeWorkspaceFile", () => {
    it("writes a new file atomically", async () => {
      const result = await writeWorkspaceFile(root, "books/test-book/new-file.md", "hello");
      expect(result.mtime).toBeTruthy();
      expect(result.size).toBe(5);

      // Verify content
      const readBack = await readWorkspaceFile(root, "books/test-book/new-file.md");
      expect(readBack.content).toBe("hello");
    });

    it("creates parent directories for new files", async () => {
      await writeWorkspaceFile(root, "books/test-book/deep/nested/file.md", "nested content");
      const result = await readWorkspaceFile(root, "books/test-book/deep/nested/file.md");
      expect(result.content).toBe("nested content");
    });

    it("detects mtime conflicts", async () => {
      await writeWorkspaceFile(root, "books/test-book/conflict-test.md", "v1");
      const v1 = await readWorkspaceFile(root, "books/test-book/conflict-test.md");

      // Write v2
      await writeWorkspaceFile(root, "books/test-book/conflict-test.md", "v2");

      // Try to write with stale mtime
      await expect(
        writeWorkspaceFile(root, "books/test-book/conflict-test.md", "v3", v1.mtime),
      ).rejects.toThrow(/modified since/);
    });
  });

  describe("mkdirWorkspace", () => {
    it("creates directories", async () => {
      await mkdirWorkspace(root, "books/new-book/chapters");
      const tree = await buildProjectTree(root, "books/new-book");
      expect(tree.some(e => e.name === "chapters")).toBe(true);
    });
  });

  describe("renameWorkspace", () => {
    it("renames files within workspace", async () => {
      await writeWorkspaceFile(root, "books/test-book/rename-me.md", "content");
      await renameWorkspace(root, "books/test-book/rename-me.md", "books/test-book/renamed.md");
      const result = await readWorkspaceFile(root, "books/test-book/renamed.md");
      expect(result.content).toBe("content");
    });
  });

  describe("deleteWorkspace", () => {
    it("deletes files within workspace", async () => {
      await writeWorkspaceFile(root, "books/test-book/delete-me.md", "bye");
      await deleteWorkspace(root, "books/test-book/delete-me.md");
      await expect(readWorkspaceFile(root, "books/test-book/delete-me.md")).rejects.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // Search
  // ---------------------------------------------------------------------------

  describe("searchWorkspace", () => {
    it("finds text across workspace files", async () => {
      const results = await searchWorkspace(root, "萧云");
      expect(results.length).toBeGreaterThan(0);
      expect(results.some(r => r.path.includes("chapters"))).toBe(true);
    });

    it("supports scope filtering", async () => {
      const chaptersOnly = await searchWorkspace(root, "萧云", { scope: "chapters" });
      expect(chaptersOnly.every(r => r.storyRole === "chapter")).toBe(true);

      const truthOnly = await searchWorkspace(root, "L_fit", { scope: "truth" });
      expect(truthOnly.every(r => r.storyRole === "truth")).toBe(true);
    });

    it("respects maxResults", async () => {
      const results = await searchWorkspace(root, "a", { maxResults: 1 });
      expect(results.length).toBeLessThanOrEqual(1);
    });

    it("is case-insensitive", async () => {
      const results = await searchWorkspace(root, "risk");
      expect(results.some(r => r.content.includes("Risk"))).toBe(true);
    });
  });
});
