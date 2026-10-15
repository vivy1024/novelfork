import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile, readFile, mkdir, stat, utimes } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { StateManager } from "../state/manager.js";
import type { BookConfig } from "../models/book.js";
import type { ChapterMeta } from "../models/chapter.js";

/**
 * 书籍锁测试用的文件系统故障注入（T-13）。默认全部透传真实实现，只有用例显式设置时才生效：
 * - unlinkFailures：对指定路径的 unlink 先抛几次指定错误码（模拟 Windows 上杀软/索引器占用锁文件）；
 * - slowRemoval：对指定锁路径的第 N 次「移除类」操作（unlink 它，或以它为源 rename）人为延迟，
 *   用来稳定复现两个争用者同时判定陈旧时的交错。
 */
const fsControl = vi.hoisted(() => ({
  unlinkFailures: new Map<string, { remaining: number; code: string }>(),
  slowRemoval: undefined as undefined | { path: string; nth: number; delayMs: number; seen: number },
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const delayIfTargeted = async (path: string): Promise<void> => {
    const slow = fsControl.slowRemoval;
    if (!slow || path !== slow.path) return;
    slow.seen += 1;
    if (slow.seen === slow.nth) await new Promise((resolveDelay) => setTimeout(resolveDelay, slow.delayMs));
  };
  return {
    ...actual,
    unlink: async (path: Parameters<typeof actual.unlink>[0]) => {
      const key = String(path);
      const failure = fsControl.unlinkFailures.get(key);
      if (failure && failure.remaining > 0) {
        failure.remaining -= 1;
        const error = new Error(`${failure.code}: resource busy or locked, unlink '${key}'`) as NodeJS.ErrnoException;
        error.code = failure.code;
        throw error;
      }
      await delayIfTargeted(key);
      return actual.unlink(path);
    },
    rename: async (from: Parameters<typeof actual.rename>[0], to: Parameters<typeof actual.rename>[1]) => {
      await delayIfTargeted(String(from));
      return actual.rename(from, to);
    },
  };
});

describe("StateManager", () => {
  let tempDir: string;
  let manager: StateManager;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "novelfork-test-"));
    manager = new StateManager(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // BookConfig persistence
  // -------------------------------------------------------------------------

  describe("saveBookConfig / loadBookConfig", () => {
    const bookConfig: BookConfig = {
      id: "test-book",
      title: "Test Novel",
      platform: "tomato",
      genre: "xuanhuan",
      status: "active",
      targetChapters: 200,
      chapterWordCount: 3000,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };

    it("round-trips a BookConfig through save and load", async () => {
      await manager.saveBookConfig("test-book", bookConfig);
      const loaded = await manager.loadBookConfig("test-book");
      expect(loaded).toEqual(bookConfig);
    });

    it("creates the book directory on save", async () => {
      await manager.saveBookConfig("new-book", {
        ...bookConfig,
        id: "new-book",
      });
      const dirStat = await stat(manager.bookDir("new-book"));
      expect(dirStat.isDirectory()).toBe(true);
    });

    it("throws when loading a non-existent book", async () => {
      await expect(manager.loadBookConfig("nope")).rejects.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // ChapterIndex persistence
  // -------------------------------------------------------------------------

  describe("saveChapterIndex / loadChapterIndex", () => {
    const chapters: ReadonlyArray<ChapterMeta> = [
      {
        number: 1,
        title: "Ch1",
        status: "drafted",
        wordCount: 3000,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        auditIssues: [],
        lengthWarnings: [],
      },
      {
        number: 2,
        title: "Ch2",
        status: "drafting",
        wordCount: 0,
        createdAt: "2026-01-02T00:00:00Z",
        updatedAt: "2026-01-02T00:00:00Z",
        auditIssues: ["pacing issue"],
        lengthWarnings: [],
      },
    ];

    it("round-trips chapter index through save and load", async () => {
      await manager.saveChapterIndex("book-a", chapters);
      const loaded = await manager.loadChapterIndex("book-a");
      expect(loaded).toEqual(chapters);
    });

    it("returns empty array when no index exists", async () => {
      const loaded = await manager.loadChapterIndex("nonexistent");
      expect(loaded).toEqual([]);
    });

    it("creates the chapters directory on save", async () => {
      await manager.saveChapterIndex("book-b", []);
      const dirStat = await stat(
        join(manager.bookDir("book-b"), "chapters"),
      );
      expect(dirStat.isDirectory()).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // getNextChapterNumber
  // -------------------------------------------------------------------------

  describe("getNextChapterNumber", () => {
    it("returns 1 for an empty book (no chapters)", async () => {
      const next = await manager.getNextChapterNumber("empty-book");
      expect(next).toBe(1);
    });

    it("returns the first missing chapter when the chapter index has gaps", async () => {
      const chapters: ReadonlyArray<ChapterMeta> = [
        {
          number: 1,
          title: "Ch1",
          status: "published",
          wordCount: 3000,
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
          auditIssues: [],
          lengthWarnings: [],
        },
        {
          number: 5,
          title: "Ch5",
          status: "drafted",
          wordCount: 2800,
          createdAt: "2026-01-05T00:00:00Z",
          updatedAt: "2026-01-05T00:00:00Z",
          auditIssues: [],
          lengthWarnings: [],
        },
        {
          number: 3,
          title: "Ch3",
          status: "approved",
          wordCount: 3100,
          createdAt: "2026-01-03T00:00:00Z",
          updatedAt: "2026-01-03T00:00:00Z",
          auditIssues: [],
          lengthWarnings: [],
        },
      ];
      await manager.saveChapterIndex("book-x", chapters);
      const next = await manager.getNextChapterNumber("book-x");
      expect(next).toBe(2);
    });

    it("returns 2 when only chapter 1 exists", async () => {
      const chapters: ReadonlyArray<ChapterMeta> = [
        {
          number: 1,
          title: "Ch1",
          status: "drafted",
          wordCount: 3000,
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
          auditIssues: [],
          lengthWarnings: [],
        },
      ];
      await manager.saveChapterIndex("book-y", chapters);
      const next = await manager.getNextChapterNumber("book-y");
      expect(next).toBe(2);
    });

    it("uses durable story progress when chapter index lags behind persisted chapter files", async () => {
      const bookId = "stale-index-book";
      const bookDir = manager.bookDir(bookId);
      const chaptersDir = join(bookDir, "chapters");
      const storyDir = join(bookDir, "story");
      await mkdir(chaptersDir, { recursive: true });
      await mkdir(storyDir, { recursive: true });
      await Promise.all([
        manager.saveChapterIndex(bookId, [
          {
            number: 1,
            title: "Ch1",
            status: "ready-for-review",
            wordCount: 3000,
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z",
            auditIssues: [],
            lengthWarnings: [],
          },
          {
            number: 2,
            title: "Ch2",
            status: "ready-for-review",
            wordCount: 3000,
            createdAt: "2026-01-02T00:00:00Z",
            updatedAt: "2026-01-02T00:00:00Z",
            auditIssues: [],
            lengthWarnings: [],
          },
        ]),
        writeFile(
          join(chaptersDir, "0003_Lantern_Vault.md"),
          "# Chapter 3: Lantern Vault\n\nPersisted body.",
          "utf-8",
        ),
        writeFile(
          join(storyDir, "current_state.md"),
          [
            "# Current State",
            "",
            "| Field | Value |",
            "| --- | --- |",
            "| Current Chapter | 3 |",
            "| Current Goal | Enter the vault without alerting the wardens |",
            "",
          ].join("\n"),
          "utf-8",
        ),
      ]);

      const next = await manager.getNextChapterNumber(bookId);

      expect(next).toBe(4);
    });

    it("ignores non-contiguous poisoned chapter numbers when calculating the next chapter", async () => {
      const bookId = "poisoned-next-chapter-book";
      const bookDir = manager.bookDir(bookId);
      const chaptersDir = join(bookDir, "chapters");
      const storyDir = join(bookDir, "story");
      const stateDir = join(storyDir, "state");
      await mkdir(chaptersDir, { recursive: true });
      await mkdir(stateDir, { recursive: true });

      const indexedChapters: ReadonlyArray<ChapterMeta> = [
        ...Array.from({ length: 12 }, (_, index) => ({
          number: index + 1,
          title: `Ch${index + 1}`,
          status: "ready-for-review" as const,
          wordCount: 3000,
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
          auditIssues: [],
          lengthWarnings: [],
        })),
        {
          number: 142,
          title: "Poisoned Ch142",
          status: "audit-failed",
          wordCount: 3200,
          createdAt: "2026-01-13T00:00:00Z",
          updatedAt: "2026-01-13T00:00:00Z",
          auditIssues: [],
          lengthWarnings: [],
        },
      ];

      await manager.saveChapterIndex(bookId, indexedChapters);
      await Promise.all([
        ...Array.from({ length: 12 }, (_, index) => writeFile(
          join(chaptersDir, `${String(index + 1).padStart(4, "0")}_Ch${index + 1}.md`),
          `# Chapter ${index + 1}\n\nStable body.`,
          "utf-8",
        )),
        writeFile(
          join(chaptersDir, "0142_Poisoned.md"),
          "# Chapter 142\n\nPoisoned body.",
          "utf-8",
        ),
        writeFile(
          join(storyDir, "current_state.md"),
          [
            "# Current State",
            "",
            "| Field | Value |",
            "| --- | --- |",
            "| Current Chapter | 12 |",
            "| Current Goal | Enter the next true chapter cleanly |",
            "",
          ].join("\n"),
          "utf-8",
        ),
        writeFile(
          join(storyDir, "pending_hooks.md"),
          [
            "| hook_id | start_chapter | type | status | last_advanced | expected_payoff | notes |",
            "| --- | --- | --- | --- | --- | --- | --- |",
            "| H001 | 1 | mystery | progressing | 《三体》游戏内第141号文明继续展开 | Reveal the true enemy | Narrative text must not drive chapter progress |",
            "",
          ].join("\n"),
          "utf-8",
        ),
        writeFile(
          join(storyDir, "chapter_summaries.md"),
          [
            "| chapter | title | characters | events | stateChanges | hookActivity | mood | chapterType |",
            "| --- | --- | --- | --- | --- | --- | --- | --- |",
            ...Array.from({ length: 12 }, (_, index) =>
              `| ${index + 1} | Ch${index + 1} | Lin Yue | Event ${index + 1} | Shift ${index + 1} | Hook ${index + 1} | tense | mainline |`),
            "| 142 | Poisoned Ch142 | Lin Yue | Poisoned event | Poisoned shift | Poisoned hook | tense | mainline |",
            "",
          ].join("\n"),
          "utf-8",
        ),
        writeFile(join(stateDir, "manifest.json"), JSON.stringify({
          schemaVersion: 2,
          language: "en",
          lastAppliedChapter: 141,
          projectionVersion: 1,
          migrationWarnings: [],
        }, null, 2), "utf-8"),
      ]);

      const next = await manager.getNextChapterNumber(bookId);

      expect(next).toBe(13);
    });

    it("counts recursively stored volume chapters when resolving next chapter progress", async () => {
      const bookId = "nested-volume-progress-book";
      const chaptersDir = join(manager.bookDir(bookId), "chapters");
      await mkdir(join(chaptersDir, "卷01"), { recursive: true });
      await mkdir(join(chaptersDir, "卷02", "支线"), { recursive: true });
      await Promise.all([
        writeFile(join(chaptersDir, "卷01", "0001_First.md"), "chapter 1", "utf-8"),
        writeFile(join(chaptersDir, "卷02", "支线", "0002_Second.md"), "chapter 2", "utf-8"),
      ]);

      await expect(manager.getNextChapterNumber(bookId)).resolves.toBe(3);
      await expect(manager.getPersistedChapterCount(bookId)).resolves.toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // listBooks
  // -------------------------------------------------------------------------

  describe("listBooks", () => {
    it("returns empty array when no books directory exists", async () => {
      const books = await manager.listBooks();
      expect(books).toEqual([]);
    });

    it("returns book IDs for directories with book.json", async () => {
      const bookConfig: BookConfig = {
        id: "alpha",
        title: "Alpha",
        platform: "tomato",
        genre: "urban",
        status: "active",
        targetChapters: 100,
        chapterWordCount: 3000,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      };
      await manager.saveBookConfig("alpha", bookConfig);
      await manager.saveBookConfig("beta", { ...bookConfig, id: "beta", title: "Beta" });

      // Create a decoy directory without book.json
      await mkdir(join(manager.booksDir, "not-a-book"), { recursive: true });

      const books = await manager.listBooks();
      expect(books).toContain("alpha");
      expect(books).toContain("beta");
      expect(books).not.toContain("not-a-book");
      expect(books).toHaveLength(2);
    });
  });

  // -------------------------------------------------------------------------
  // snapshotState / restoreState
  // -------------------------------------------------------------------------

  describe("snapshotState / restoreState", () => {
    const bookId = "snap-book";

    beforeEach(async () => {
      const storyDir = join(manager.bookDir(bookId), "story");
      await mkdir(storyDir, { recursive: true });
      await writeFile(
        join(storyDir, "current_state.md"),
        "# State at ch1",
        "utf-8",
      );
      await writeFile(
        join(storyDir, "particle_ledger.md"),
        "# Ledger at ch1",
        "utf-8",
      );
      await writeFile(
        join(storyDir, "pending_hooks.md"),
        "# Hooks at ch1",
        "utf-8",
      );
    });

    it("snapshots current state files to a numbered directory", async () => {
      await manager.snapshotState(bookId, 1);

      const snapshotDir = join(
        manager.bookDir(bookId),
        "story",
        "snapshots",
        "1",
      );
      const state = await readFile(
        join(snapshotDir, "current_state.md"),
        "utf-8",
      );
      expect(state).toBe("# State at ch1");

      const ledger = await readFile(
        join(snapshotDir, "particle_ledger.md"),
        "utf-8",
      );
      expect(ledger).toBe("# Ledger at ch1");

      const hooks = await readFile(
        join(snapshotDir, "pending_hooks.md"),
        "utf-8",
      );
      expect(hooks).toBe("# Hooks at ch1");
    });

    it("copies structured runtime state into snapshot/state when present", async () => {
      const stateDir = manager.stateDir(bookId);
      await mkdir(stateDir, { recursive: true });
      await writeFile(
        join(stateDir, "manifest.json"),
        JSON.stringify({
          schemaVersion: 2,
          language: "en",
          lastAppliedChapter: 1,
          projectionVersion: 1,
          migrationWarnings: [],
        }, null, 2),
        "utf-8",
      );

      await manager.snapshotState(bookId, 1);

      const snapshotManifest = await readFile(
        join(manager.bookDir(bookId), "story", "snapshots", "1", "state", "manifest.json"),
        "utf-8",
      );
      expect(snapshotManifest).toContain("\"schemaVersion\": 2");
    });

    it("restores state from a previous snapshot", async () => {
      await manager.snapshotState(bookId, 1);

      // Modify the current state files
      const storyDir = join(manager.bookDir(bookId), "story");
      await writeFile(
        join(storyDir, "current_state.md"),
        "# State at ch2 (modified)",
        "utf-8",
      );
      await writeFile(
        join(storyDir, "particle_ledger.md"),
        "# Ledger at ch2 (modified)",
        "utf-8",
      );
      await writeFile(
        join(storyDir, "pending_hooks.md"),
        "# Hooks at ch2 (modified)",
        "utf-8",
      );

      const restored = await manager.restoreState(bookId, 1);
      expect(restored).toBe(true);

      // Verify restored content
      const state = await readFile(
        join(storyDir, "current_state.md"),
        "utf-8",
      );
      expect(state).toBe("# State at ch1");

      const ledger = await readFile(
        join(storyDir, "particle_ledger.md"),
        "utf-8",
      );
      expect(ledger).toBe("# Ledger at ch1");
    });

    it("restores structured runtime state files from snapshot/state", async () => {
      const stateDir = manager.stateDir(bookId);
      await mkdir(stateDir, { recursive: true });
      await writeFile(
        join(stateDir, "manifest.json"),
        JSON.stringify({
          schemaVersion: 2,
          language: "en",
          lastAppliedChapter: 1,
          projectionVersion: 1,
          migrationWarnings: [],
        }, null, 2),
        "utf-8",
      );

      await manager.snapshotState(bookId, 1);
      await writeFile(
        join(stateDir, "manifest.json"),
        JSON.stringify({
          schemaVersion: 2,
          language: "en",
          lastAppliedChapter: 9,
          projectionVersion: 1,
          migrationWarnings: [],
        }, null, 2),
        "utf-8",
      );

      const restored = await manager.restoreState(bookId, 1);
      expect(restored).toBe(true);

      const manifest = await readFile(join(stateDir, "manifest.json"), "utf-8");
      expect(manifest).toContain("\"lastAppliedChapter\": 1");
    });

    it("returns false when restoring from non-existent snapshot", async () => {
      const restored = await manager.restoreState(bookId, 999);
      expect(restored).toBe(false);
    });

    it("rewrite chapter 2 then getNextChapterNumber returns 2", async () => {
      const rwBookId = "rewrite-book";
      const chapDir = join(manager.bookDir(rwBookId), "chapters");
      const storyDir = join(manager.bookDir(rwBookId), "story");
      await mkdir(chapDir, { recursive: true });
      await mkdir(storyDir, { recursive: true });

      // Simulate 3 chapters written
      await writeFile(join(chapDir, "0001_ch1.md"), "# Chapter 1\nContent 1", "utf-8");
      await writeFile(join(chapDir, "0002_ch2.md"), "# Chapter 2\nContent 2", "utf-8");
      await writeFile(join(chapDir, "0003_ch3.md"), "# Chapter 3\nContent 3", "utf-8");
      const mkEntry = (n: number) => ({
        number: n, title: `Ch${n}`, status: "approved" as const, wordCount: 100,
        createdAt: "", updatedAt: "", auditIssues: [] as string[], lengthWarnings: [] as string[],
      });
      const fullIndex = [mkEntry(1), mkEntry(2), mkEntry(3)];
      await manager.saveChapterIndex(rwBookId, fullIndex);

      // Snapshot state at chapter 1 (before chapter 2)
      await writeFile(join(storyDir, "current_state.md"), "State at ch1", "utf-8");
      await writeFile(join(storyDir, "pending_hooks.md"), "Hooks at ch1", "utf-8");
      await manager.snapshotState(rwBookId, 1);

      // Simulate rewrite of chapter 2: trim index, delete ch2+ch3, restore state
      const trimmed = fullIndex.filter((ch) => ch.number < 2);
      await manager.saveChapterIndex(rwBookId, trimmed);
      const { rm } = await import("node:fs/promises");
      await rm(join(chapDir, "0002_ch2.md"));
      await rm(join(chapDir, "0003_ch3.md"));
      await manager.restoreState(rwBookId, 1);

      // Next chapter should be 2, not 4
      const next = await manager.getNextChapterNumber(rwBookId);
      expect(next).toBe(2);
    });

    it("rewrite restore drops poisoned live structured state when the snapshot only has markdown jingwei files", async () => {
      const rwBookId = "rewrite-book-markdown-only";
      const chapDir = join(manager.bookDir(rwBookId), "chapters");
      const storyDir = join(manager.bookDir(rwBookId), "story");
      const stateDir = join(storyDir, "state");
      await mkdir(chapDir, { recursive: true });
      await mkdir(storyDir, { recursive: true });

      await writeFile(join(chapDir, "0001_ch1.md"), "# Chapter 1\nContent 1", "utf-8");
      await writeFile(join(chapDir, "0002_ch2.md"), "# Chapter 2\nContent 2", "utf-8");
      await writeFile(join(chapDir, "0003_ch3.md"), "# Chapter 3\nContent 3", "utf-8");
      const mkEntry = (n: number) => ({
        number: n, title: `Ch${n}`, status: "approved" as const, wordCount: 100,
        createdAt: "", updatedAt: "", auditIssues: [] as string[], lengthWarnings: [] as string[],
      });
      const fullIndex = [mkEntry(1), mkEntry(2), mkEntry(3)];
      await manager.saveChapterIndex(rwBookId, fullIndex);

      await writeFile(join(storyDir, "current_state.md"), "State at ch1", "utf-8");
      await writeFile(join(storyDir, "pending_hooks.md"), "Hooks at ch1", "utf-8");
      await manager.snapshotState(rwBookId, 1);

      await mkdir(stateDir, { recursive: true });
      await writeFile(join(stateDir, "manifest.json"), JSON.stringify({
        schemaVersion: 2,
        language: "en",
        lastAppliedChapter: 4,
        projectionVersion: 1,
        migrationWarnings: [],
      }, null, 2), "utf-8");
      await writeFile(join(stateDir, "current_state.json"), JSON.stringify({
        chapter: 3,
        facts: [],
      }, null, 2), "utf-8");

      const trimmed = fullIndex.filter((ch) => ch.number < 2);
      await manager.saveChapterIndex(rwBookId, trimmed);
      const { rename } = await import("node:fs/promises");
      await rename(join(chapDir, "0002_ch2.md"), join(chapDir, "0002_ch2.md.bak"));
      await rename(join(chapDir, "0003_ch3.md"), join(chapDir, "0003_ch3.md.bak"));
      await manager.restoreState(rwBookId, 1);

      const next = await manager.getNextChapterNumber(rwBookId);
      expect(next).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // acquireBookLock
  // -------------------------------------------------------------------------

  describe("acquireBookLock", () => {
    it("acquires a lock and returns a release function", async () => {
      // Ensure book directory exists
      await mkdir(manager.bookDir("lock-book"), { recursive: true });

      const release = await manager.acquireBookLock("lock-book");
      expect(typeof release).toBe("function");

      // Lock file should exist
      const lockPath = join(manager.bookDir("lock-book"), ".write.lock");
      const lockStat = await stat(lockPath);
      expect(lockStat.isFile()).toBe(true);

      // Release the lock
      await release();

      // Lock file should be gone
      await expect(stat(lockPath)).rejects.toThrow();
    });

    it("throws when lock is already held", async () => {
      await mkdir(manager.bookDir("lock-book-2"), { recursive: true });

      const release = await manager.acquireBookLock("lock-book-2");

      await expect(
        manager.acquireBookLock("lock-book-2"),
      ).rejects.toThrow(/is locked/);

      await release();
    });

    it("allows re-acquiring lock after release", async () => {
      await mkdir(manager.bookDir("lock-book-3"), { recursive: true });

      const release1 = await manager.acquireBookLock("lock-book-3");
      await release1();

      const release2 = await manager.acquireBookLock("lock-book-3");
      expect(typeof release2).toBe("function");
      await release2();
    });

    it("allows only one concurrent lock claimant", async () => {
      await mkdir(manager.bookDir("lock-book-4"), { recursive: true });

      const results = await Promise.allSettled([
        manager.acquireBookLock("lock-book-4"),
        manager.acquireBookLock("lock-book-4"),
      ]);

      const fulfilled = results.filter((result) => result.status === "fulfilled");
      const rejected = results.filter((result) => result.status === "rejected");

      for (const result of fulfilled) {
        await result.value();
      }

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(String(rejected[0]?.reason)).toMatch(/is locked/);
    });

    it("reclaims a stale lock when the recorded pid is no longer alive", async () => {
      await mkdir(manager.bookDir("lock-book-5"), { recursive: true });
      const lockPath = join(manager.bookDir("lock-book-5"), ".write.lock");
      await writeFile(lockPath, "pid:424242 ts:123", "utf-8");

      const killSpy = vi.spyOn(process, "kill").mockImplementation((((pid: number) => {
        if (pid === 424242) {
          const error = new Error("no such process") as NodeJS.ErrnoException;
          error.code = "ESRCH";
          throw error;
        }
        return true;
      }) as unknown) as typeof process.kill);

      try {
        const release = await manager.acquireBookLock("lock-book-5");
        const lockData = await readFile(lockPath, "utf-8");

        expect(typeof release).toBe("function");
        expect(lockData).toContain(`pid:${process.pid}`);

        await release();
      } finally {
        killSpy.mockRestore();
      }
    });

      it("does not reclaim a lock held by a live process just because it is older than 10 minutes (T-13)", async () => {
        await mkdir(manager.bookDir("lock-book-6"), { recursive: true });
        const lockPath = join(manager.bookDir("lock-book-6"), ".write.lock");
        const elevenMinutesAgo = Date.now() - 11 * 60 * 1000;
        await writeFile(lockPath, `pid:424243 ts:${elevenMinutesAgo}`, "utf-8");

        const killSpy = vi.spyOn(process, "kill").mockImplementation((() => true) as unknown as typeof process.kill);

        try {
          await expect(manager.acquireBookLock("lock-book-6")).rejects.toThrow(/is locked/);
          const lockData = await readFile(lockPath, "utf-8");
          expect(lockData).toContain("pid:424243");
        } finally {
          killSpy.mockRestore();
        }
      });

      it("does not let the original holder delete a lock that a new holder has taken over (T-13)", async () => {
        const originalRelease = await manager.acquireBookLock("lock-book-7");
        const lockPath = join(manager.bookDir("lock-book-7"), ".write.lock");

        // 模拟：原持有者超时后被判陈旧，新持有者已经接管了锁文件（pid 不同）。
        await writeFile(lockPath, "pid:999991 ts:999999999999", "utf-8");

        await originalRelease();

        // 释放不得删除别人的锁：文件必须仍在，且仍是新持有者的内容。
        const survived = await readFile(lockPath, "utf-8").then(
          (content) => content,
          () => undefined,
        );
        expect(survived, "original holder's release deleted the new holder's lock file").toBeDefined();
        expect(survived).toContain("pid:999991");
      });

    describe("T-13 陈旧判定、释放重试与条件回收", () => {
      const localHost = encodeURIComponent(hostname());
      const SEVEN_HOURS = 7 * 60 * 60 * 1000;

      afterEach(() => {
        fsControl.unlinkFailures.clear();
        fsControl.slowRemoval = undefined;
      });

      async function lockPathFor(bookId: string): Promise<string> {
        await mkdir(manager.bookDir(bookId), { recursive: true });
        return join(manager.bookDir(bookId), ".write.lock");
      }

      function mockPidsAlive(deadPids: readonly number[] = []) {
        return vi.spyOn(process, "kill").mockImplementation((((pid: number) => {
          if (deadPids.includes(pid)) {
            const error = new Error("no such process") as NodeJS.ErrnoException;
            error.code = "ESRCH";
            throw error;
          }
          return true;
        }) as unknown) as typeof process.kill);
      }

      it("新锁文件是结构化内容：pid、主机名、开始时间、令牌，且兼容旧解析的 pid:/ts: 前缀", async () => {
        const lockPath = await lockPathFor("lock-t13-format");
        const release = await manager.acquireBookLock("lock-t13-format");
        try {
          const content = await readFile(lockPath, "utf-8");
          expect(content).toMatch(new RegExp(`^pid:${process.pid} ts:\\d+ host:\\S+ token:\\S+$`));
          expect(content).toContain(`host:${localHost}`);
        } finally {
          await release();
        }
      });

      it("pid 被复用：同主机、pid 存活但不是本进程、锁龄超过 6 小时，视为陈旧并回收", async () => {
        const lockPath = await lockPathFor("lock-t13-reuse");
        await writeFile(lockPath, `pid:424244 ts:${Date.now() - SEVEN_HOURS} host:${localHost} token:ghost-token`, "utf-8");
        const killSpy = mockPidsAlive();
        try {
          const release = await manager.acquireBookLock("lock-t13-reuse");
          expect(await readFile(lockPath, "utf-8")).toContain(`pid:${process.pid}`);
          await release();
        } finally {
          killSpy.mockRestore();
        }
      });

      it("旧格式锁文件（pid:xxx ts:xxx）同样按 6 小时兜底回收", async () => {
        const lockPath = await lockPathFor("lock-t13-legacy-old");
        await writeFile(lockPath, `pid:424245 ts:${Date.now() - SEVEN_HOURS}`, "utf-8");
        const killSpy = mockPidsAlive();
        try {
          const release = await manager.acquireBookLock("lock-t13-legacy-old");
          expect(await readFile(lockPath, "utf-8")).toContain(`pid:${process.pid}`);
          await release();
        } finally {
          killSpy.mockRestore();
        }
      });

      it("锁来自别的主机（共享盘/同步盘）时不自动回收，报错带三段式 explanation，锁文件原样保留", async () => {
        const lockPath = await lockPathFor("lock-t13-foreign");
        const foreign = `pid:424246 ts:${Date.now() - SEVEN_HOURS} host:other-machine-xyz token:remote-token`;
        await writeFile(lockPath, foreign, "utf-8");
        // 即使本机查不到这个 pid（本机视角下「已死」），也不能据此回收别的机器的锁。
        const killSpy = mockPidsAlive([424246]);
        try {
          const error = await manager.acquireBookLock("lock-t13-foreign").then(
            () => undefined,
            (reason: unknown) => reason as Error & { code?: string; explanation?: Record<string, string> },
          );
          expect(error, "foreign-host lock must not be reclaimed").toBeDefined();
          expect(error?.message).toMatch(/is locked/);
          expect(error?.code).toBe("book-locked-foreign-host");
          expect(error?.explanation?.whatHappened).toContain("other-machine-xyz");
          expect(error?.explanation?.whyItMatters).toBeTruthy();
          expect(error?.explanation?.suggestedAction).toBeTruthy();
          expect(await readFile(lockPath, "utf-8")).toBe(foreign);
        } finally {
          killSpy.mockRestore();
        }
      });

      it("锁里是本进程 pid、但本进程内存里没有这把锁的持有记录：视为陈旧（自锁残留）", async () => {
        const lockPath = await lockPathFor("lock-t13-self");
        await writeFile(lockPath, `pid:${process.pid} ts:${Date.now()} host:${localHost} token:leftover-token`, "utf-8");
        const release = await manager.acquireBookLock("lock-t13-self");
        const content = await readFile(lockPath, "utf-8");
        expect(content).toContain(`pid:${process.pid}`);
        expect(content).not.toContain("leftover-token");
        await release();
      });

      it("内容不完整的锁文件在短宽限内视为正在写入，超过宽限后视为陈旧", async () => {
        const lockPath = await lockPathFor("lock-t13-empty");
        await writeFile(lockPath, "", "utf-8");
        await expect(manager.acquireBookLock("lock-t13-empty")).rejects.toThrow(/is locked/);

        const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
        await utimes(lockPath, tenMinutesAgo, tenMinutesAgo);
        const release = await manager.acquireBookLock("lock-t13-empty");
        expect(await readFile(lockPath, "utf-8")).toContain(`pid:${process.pid}`);
        await release();
      });

      it("释放时锁文件被短暂占用（EBUSY）：有界重试后删除成功", async () => {
        const lockPath = await lockPathFor("lock-t13-busy");
        const release = await manager.acquireBookLock("lock-t13-busy");
        fsControl.unlinkFailures.set(lockPath, { remaining: 2, code: "EBUSY" });

        await release();

        await expect(stat(lockPath)).rejects.toThrow();
      });

      it("释放重试仍失败：记 warn 不抛错，且本进程随后可以重新拿到这把锁（不自锁）", async () => {
        const lockPath = await lockPathFor("lock-t13-stuck");
        const release = await manager.acquireBookLock("lock-t13-stuck");
        fsControl.unlinkFailures.set(lockPath, { remaining: 1000, code: "EPERM" });
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        try {
          await expect(release()).resolves.toBeUndefined();
          expect(warnSpy).toHaveBeenCalled();
        } finally {
          warnSpy.mockRestore();
          fsControl.unlinkFailures.clear();
        }

        const releaseAgain = await manager.acquireBookLock("lock-t13-stuck");
        await releaseAgain();
        await expect(stat(lockPath)).rejects.toThrow();
      });

      it("两个争用者同时判定同一把陈旧锁时，只能有一个拿到锁", async () => {
        const lockPath = await lockPathFor("lock-t13-race");
        await writeFile(lockPath, `pid:424247 ts:${Date.now()} host:${localHost} token:dead-token`, "utf-8");
        const killSpy = mockPidsAlive([424247]);
        // 让后到的那个争用者的「移除陈旧锁」慢半拍：先到者此时已经建好了新锁。
        fsControl.slowRemoval = { path: lockPath, nth: 2, delayMs: 60, seen: 0 };
        try {
          const results = await Promise.allSettled([
            manager.acquireBookLock("lock-t13-race"),
            manager.acquireBookLock("lock-t13-race"),
          ]);
          const fulfilled = results.filter((result): result is PromiseFulfilledResult<() => Promise<void>> => result.status === "fulfilled");
          const rejected = results.filter((result) => result.status === "rejected");
          expect(fulfilled, "both claimants believed they hold the lock").toHaveLength(1);
          expect(rejected).toHaveLength(1);
          expect(String((rejected[0] as PromiseRejectedResult).reason)).toMatch(/is locked/);
          // 赢家的锁文件仍然在位：后到者没有把它删掉或改名带走。
          expect(await readFile(lockPath, "utf-8")).toContain(`pid:${process.pid}`);
          for (const result of fulfilled) await result.value();
        } finally {
          killSpy.mockRestore();
        }
      });
    });
  });

  // -------------------------------------------------------------------------
  // Path helpers
  // -------------------------------------------------------------------------

  describe("path helpers", () => {
    it("booksDir points to <projectRoot>/books", () => {
      expect(manager.booksDir).toBe(join(tempDir, "books"));
    });

    it("bookDir returns <booksDir>/<bookId>", () => {
      expect(manager.bookDir("my-book")).toBe(
        join(tempDir, "books", "my-book"),
      );
    });

    it("stateDir returns <bookDir>/story/state", () => {
      expect(manager.stateDir("my-book")).toBe(
        join(tempDir, "books", "my-book", "story", "state"),
      );
    });

    it("uses a trusted resolver without falling back to another book directory", () => {
      const externalRoot = join(tempDir, "external-workspace");
      const bound = new StateManager(tempDir, {
        resolveBookDir: (bookId) => {
          if (bookId !== "bound-book") throw new Error("binding mismatch");
          return externalRoot;
        },
      });

      expect(bound.bookDir("bound-book")).toBe(externalRoot);
      expect(bound.stateDir("bound-book")).toBe(join(externalRoot, "story", "state"));
      expect(() => bound.bookDir("other-book")).toThrow("binding mismatch");
    });
  });

  // -------------------------------------------------------------------------
  // Input governance control docs
  // -------------------------------------------------------------------------

  describe("ensureControlDocuments", () => {
    it("creates author intent, current focus, and runtime directory", async () => {
      await manager.ensureControlDocuments(
        "control-book",
        "# Initial Brief\n\nKeep the focus on mentor conflict.\n",
      );

      const storyDir = join(manager.bookDir("control-book"), "story");
      const authorIntent = await readFile(
        join(storyDir, "author_intent.md"),
        "utf-8",
      );
      const currentFocus = await readFile(
        join(storyDir, "current_focus.md"),
        "utf-8",
      );
      const runtimeStat = await stat(join(storyDir, "runtime"));

      expect(authorIntent).toContain("mentor conflict");
      expect(currentFocus).toContain("Current Focus");
      expect(runtimeStat.isDirectory()).toBe(true);
    });

    it("bootstraps and returns safe defaults for legacy books", async () => {
      const storyDir = join(manager.bookDir("legacy-book"), "story");
      await mkdir(storyDir, { recursive: true });
      await writeFile(
        join(storyDir, "story_bible.md"),
        "# Story Bible\n\nLegacy books may not have control docs yet.\n",
        "utf-8",
      );

      const controlDocs = await manager.loadControlDocuments("legacy-book");

      expect(controlDocs.authorIntent).toContain("# Author Intent");
      expect(controlDocs.currentFocus).toContain("# Current Focus");
      expect(controlDocs.runtimeDir).toBe(join(storyDir, "runtime"));
    });

    it("creates localized Chinese defaults for Chinese books", async () => {
      await manager.saveBookConfig("zh-book", {
        id: "zh-book",
        title: "中文书",
        platform: "tomato",
        genre: "other",
        status: "outlining",
        targetChapters: 100,
        chapterWordCount: 2200,
        language: "zh",
        createdAt: "2026-03-24T00:00:00Z",
        updatedAt: "2026-03-24T00:00:00Z",
      });

      await manager.ensureControlDocuments("zh-book");

      const storyDir = join(manager.bookDir("zh-book"), "story");
      const authorIntent = await readFile(
        join(storyDir, "author_intent.md"),
        "utf-8",
      );
      const currentFocus = await readFile(
        join(storyDir, "current_focus.md"),
        "utf-8",
      );

      expect(authorIntent).toContain("# 作者意图");
      expect(currentFocus).toContain("# 当前聚焦");
      expect(currentFocus).not.toContain("# Current Focus");
    });

    it("bootstraps structured runtime state from legacy markdown jingwei files", async () => {
      const bookId = "runtime-state-book";
      const storyDir = join(manager.bookDir(bookId), "story");
      await mkdir(storyDir, { recursive: true });
      await Promise.all([
        writeFile(
          join(storyDir, "current_state.md"),
          [
            "# Current State",
            "",
            "| Field | Value |",
            "| --- | --- |",
            "| Current Chapter | 3 |",
            "| Current Goal | Trace the mentor debt |",
            "",
          ].join("\n"),
          "utf-8",
        ),
        writeFile(
          join(storyDir, "pending_hooks.md"),
          [
            "| hook_id | start_chapter | type | status | last_advanced | expected_payoff | notes |",
            "| --- | --- | --- | --- | --- | --- | --- |",
            "| mentor-debt | 1 | relationship | open | 3 | 10 | Still unresolved |",
            "",
          ].join("\n"),
          "utf-8",
        ),
        writeFile(
          join(storyDir, "chapter_summaries.md"),
          [
            "| chapter | title | characters | events | stateChanges | hookActivity | mood | chapterType |",
            "| --- | --- | --- | --- | --- | --- | --- | --- |",
            "| 3 | River Ledger | Lin Yue | He checks the old ledger | Debt sharpens | mentor-debt advanced | tense | mainline |",
            "",
          ].join("\n"),
          "utf-8",
        ),
      ]);

      await manager.ensureRuntimeState(bookId, 3);

      const manifest = await readFile(join(manager.stateDir(bookId), "manifest.json"), "utf-8");
      const currentState = await readFile(join(manager.stateDir(bookId), "current_state.json"), "utf-8");

      expect(manifest).toContain("\"schemaVersion\": 2");
      expect(currentState).toContain("\"chapter\": 3");
    });

    it("does not treat future hook start chapters as lastAppliedChapter during bootstrap", async () => {
      const bookId = "runtime-state-future-hooks-book";
      const storyDir = join(manager.bookDir(bookId), "story");
      await mkdir(storyDir, { recursive: true });
      await Promise.all([
        writeFile(
          join(storyDir, "current_state.md"),
          [
            "# Current State",
            "",
            "| Field | Value |",
            "| --- | --- |",
            "| Current Chapter | 1 |",
            "| Current Goal | Survive the harbor fallout |",
            "",
          ].join("\n"),
          "utf-8",
        ),
        writeFile(
          join(storyDir, "pending_hooks.md"),
          [
            "| hook_id | start_chapter | type | status | last_advanced | expected_payoff | notes |",
            "| --- | --- | --- | --- | --- | --- | --- |",
            "| long-payoff-1 | 108 | mystery | open | 1 | 108 | Future payoff anchor |",
            "| long-payoff-2 | 181 | relationship | open | 1 | 181 | Even later payoff anchor |",
            "",
          ].join("\n"),
          "utf-8",
        ),
        writeFile(
          join(storyDir, "chapter_summaries.md"),
          [
            "| chapter | title | characters | events | stateChanges | hookActivity | mood | chapterType |",
            "| --- | --- | --- | --- | --- | --- | --- | --- |",
            "| 1 | Harbor Ash | Lin Yue | He survives the harbor fallout | The debt line opens | long-payoff-1 seeded | tense | opening |",
            "",
          ].join("\n"),
          "utf-8",
        ),
      ]);

      await manager.ensureRuntimeState(bookId, 1);

      const manifest = JSON.parse(
        await readFile(join(manager.stateDir(bookId), "manifest.json"), "utf-8"),
      ) as { lastAppliedChapter: number };

      expect(manifest.lastAppliedChapter).toBe(1);
    });

    it("does not treat narrative digits inside hook markdown as runtime chapter progress during bootstrap", async () => {
      const bookId = "runtime-state-narrative-digit-book";
      const storyDir = join(manager.bookDir(bookId), "story");
      await mkdir(storyDir, { recursive: true });
      await Promise.all([
        writeFile(
          join(storyDir, "current_state.md"),
          [
            "# Current State",
            "",
            "| Field | Value |",
            "| --- | --- |",
            "| Current Chapter | 12 |",
            "| Current Goal | Continue after the imported twelfth chapter |",
            "",
          ].join("\n"),
          "utf-8",
        ),
        writeFile(
          join(storyDir, "pending_hooks.md"),
          [
            "| hook_id | start_chapter | type | status | last_advanced | expected_payoff | notes |",
            "| --- | --- | --- | --- | --- | --- | --- |",
            "| H001 | 1 | mystery | progressing | 《三体》游戏内第141号文明展开到墨子时代 | Reveal the threat | Narrative prose, not chapter metadata |",
            "",
          ].join("\n"),
          "utf-8",
        ),
        writeFile(
          join(storyDir, "chapter_summaries.md"),
          [
            "| chapter | title | characters | events | stateChanges | hookActivity | mood | chapterType |",
            "| --- | --- | --- | --- | --- | --- | --- | --- |",
            ...Array.from({ length: 12 }, (_, index) =>
              `| ${index + 1} | Ch${index + 1} | Lin Yue | Event ${index + 1} | Shift ${index + 1} | Hook ${index + 1} | tense | mainline |`),
            "",
          ].join("\n"),
          "utf-8",
        ),
      ]);

      await manager.ensureRuntimeState(bookId, 12);

      const manifest = JSON.parse(
        await readFile(join(manager.stateDir(bookId), "manifest.json"), "utf-8"),
      ) as { lastAppliedChapter: number };
      const hooks = JSON.parse(
        await readFile(join(manager.stateDir(bookId), "hooks.json"), "utf-8"),
      ) as { hooks: Array<{ hookId: string; lastAdvancedChapter: number }> };

      expect(manifest.lastAppliedChapter).toBe(12);
      expect(hooks.hooks[0]?.hookId).toBe("H001");
      expect(hooks.hooks[0]?.lastAdvancedChapter).toBe(0);
    });

    it("repairs poisoned manifest chapter when it runs ahead of persisted runtime state", async () => {
      const bookId = "runtime-state-poisoned-book";
      const storyDir = join(manager.bookDir(bookId), "story");
      const stateDir = join(storyDir, "state");
      await mkdir(stateDir, { recursive: true });
      await Promise.all([
        writeFile(
          join(storyDir, "current_state.md"),
          [
            "# Current State",
            "",
            "| Field | Value |",
            "| --- | --- |",
            "| Current Chapter | 2 |",
            "| Current Goal | Reach the ledger vault |",
            "",
          ].join("\n"),
          "utf-8",
        ),
        writeFile(
          join(storyDir, "pending_hooks.md"),
          [
            "| hook_id | start_chapter | type | status | last_advanced | expected_payoff | notes |",
            "| --- | --- | --- | --- | --- | --- | --- |",
            "| vault-ledger | 1 | mystery | progressing | 2 | 4 | Ledger trail remains open |",
            "",
          ].join("\n"),
          "utf-8",
        ),
        writeFile(
          join(storyDir, "chapter_summaries.md"),
          [
            "| chapter | title | characters | events | stateChanges | hookActivity | mood | chapterType |",
            "| --- | --- | --- | --- | --- | --- | --- | --- |",
            "| 1 | Harbor Ash | Lin Yue | Survives the harbor fallout | Debt line opens | vault-ledger seeded | tense | opening |",
            "| 2 | Lantern Wharf | Lin Yue | Tracks the ledger to the wharf | Goal narrows to the vault | vault-ledger advanced | wary | investigation |",
            "",
          ].join("\n"),
          "utf-8",
        ),
        writeFile(join(stateDir, "manifest.json"), JSON.stringify({
          schemaVersion: 2,
          language: "en",
          lastAppliedChapter: 3,
          projectionVersion: 1,
          migrationWarnings: [],
        }, null, 2), "utf-8"),
        writeFile(join(stateDir, "current_state.json"), JSON.stringify({
          chapter: 2,
          facts: [
            {
              subject: "protagonist",
              predicate: "Current Goal",
              object: "Reach the ledger vault",
              validFromChapter: 2,
              validUntilChapter: null,
              sourceChapter: 2,
            },
          ],
        }, null, 2), "utf-8"),
        writeFile(join(stateDir, "hooks.json"), JSON.stringify({
          hooks: [
            {
              hookId: "vault-ledger",
              startChapter: 1,
              type: "mystery",
              status: "progressing",
              lastAdvancedChapter: 2,
              expectedPayoff: "4",
              notes: "Persisted structured hook state",
            },
          ],
        }, null, 2), "utf-8"),
        writeFile(join(stateDir, "chapter_summaries.json"), JSON.stringify({
          rows: [
            {
              chapter: 1,
              title: "Harbor Ash",
              characters: "Lin Yue",
              events: "Survives the harbor fallout",
              stateChanges: "Debt line opens",
              hookActivity: "vault-ledger seeded",
              mood: "tense",
              chapterType: "opening",
            },
            {
              chapter: 2,
              title: "Lantern Wharf",
              characters: "Lin Yue",
              events: "Tracks the ledger to the wharf",
              stateChanges: "Goal narrows to the vault",
              hookActivity: "vault-ledger advanced",
              mood: "wary",
              chapterType: "investigation",
            },
          ],
        }, null, 2), "utf-8"),
      ]);

      await manager.ensureRuntimeState(bookId, 2);

      const manifest = JSON.parse(
        await readFile(join(stateDir, "manifest.json"), "utf-8"),
      ) as { lastAppliedChapter: number };
      const currentState = JSON.parse(
        await readFile(join(stateDir, "current_state.json"), "utf-8"),
      ) as { chapter: number; facts: Array<{ object: string }> };
      const hooks = JSON.parse(
        await readFile(join(stateDir, "hooks.json"), "utf-8"),
      ) as { hooks: Array<{ lastAdvancedChapter: number }> };
      const summaries = JSON.parse(
        await readFile(join(stateDir, "chapter_summaries.json"), "utf-8"),
      ) as { rows: Array<{ chapter: number; title: string }> };

      expect(manifest.lastAppliedChapter).toBe(2);
      expect(currentState.chapter).toBe(2);
      expect(currentState.facts[0]?.object).toBe("Reach the ledger vault");
      expect(hooks.hooks[0]?.lastAdvancedChapter).toBe(2);
      expect(summaries.rows.map((row) => row.chapter)).toEqual([1, 2]);
      expect(summaries.rows.at(-1)?.title).toBe("Lantern Wharf");
    });

    it("normalizes emphasized hook ids when bootstrapping structured runtime state from markdown", async () => {
      const bookId = "runtime-state-emphasized-hook-book";
      const storyDir = join(manager.bookDir(bookId), "story");
      await mkdir(storyDir, { recursive: true });
      await Promise.all([
        writeFile(
          join(storyDir, "current_state.md"),
          [
            "# Current State",
            "",
            "| Field | Value |",
            "| --- | --- |",
            "| Current Chapter | 3 |",
            "| Current Goal | Follow the ledger trail |",
            "",
          ].join("\n"),
          "utf-8",
        ),
        writeFile(
          join(storyDir, "pending_hooks.md"),
          [
            "| hook_id | start_chapter | type | status | last_advanced | expected_payoff | notes |",
            "| --- | --- | --- | --- | --- | --- | --- |",
            "| **H009** | 3 | mystery | open | 3 | 9 | Bold markdown leaked into hook id |",
            "",
          ].join("\n"),
          "utf-8",
        ),
        writeFile(
          join(storyDir, "chapter_summaries.md"),
          [
            "| chapter | title | characters | events | stateChanges | hookActivity | mood | chapterType |",
            "| --- | --- | --- | --- | --- | --- | --- | --- |",
            "| 3 | Lantern Wharf | Lin Yue | Follows the ledger trail | Goal narrows to the ledger trail | H009 advanced | wary | investigation |",
            "",
          ].join("\n"),
          "utf-8",
        ),
      ]);

      await manager.ensureRuntimeState(bookId, 3);

      const hooks = JSON.parse(
        await readFile(join(manager.stateDir(bookId), "hooks.json"), "utf-8"),
      ) as { hooks: Array<{ hookId: string }> };

      expect(hooks.hooks.map((hook) => hook.hookId)).toEqual(["H009"]);
    });
  });

  // -------------------------------------------------------------------------
  // rollbackToChapter — reject a chapter and discard downstream state
  // -------------------------------------------------------------------------

  describe("rollbackToChapter", () => {
    const bookId = "rollback-book";

    async function setupRollbackBook(): Promise<void> {
      await manager.saveBookConfig(bookId, {
        id: bookId,
        title: "Rollback Test",
        platform: "tomato",
        genre: "xuanhuan",
        status: "active",
        targetChapters: 10,
        chapterWordCount: 3000,
        createdAt: "2026-03-31T00:00:00Z",
        updatedAt: "2026-03-31T00:00:00Z",
      });

      const bookDir = manager.bookDir(bookId);
      const storyDir = join(bookDir, "story");
      const chaptersDir = join(bookDir, "chapters");
      const runtimeDir = join(storyDir, "runtime");
      await mkdir(runtimeDir, { recursive: true });
      await mkdir(chaptersDir, { recursive: true });

      // Write initial state (chapter 0 baseline)
      await writeFile(join(storyDir, "current_state.md"), "# State\n\n- Initial state.\n", "utf-8");
      await writeFile(join(storyDir, "pending_hooks.md"), "# Hooks\n\n- hook-1\n", "utf-8");
      await writeFile(join(storyDir, "chapter_summaries.md"), "# Summaries\n", "utf-8");
      await manager.snapshotState(bookId, 0);

      // Write chapter 1 state + file
      await writeFile(join(storyDir, "current_state.md"), "# State\n\n- After chapter 1.\n", "utf-8");
      await writeFile(join(storyDir, "pending_hooks.md"), "# Hooks\n\n- hook-1\n- hook-2\n", "utf-8");
      await writeFile(join(storyDir, "chapter_summaries.md"), "# Summaries\n\n| 1 | Title 1 |\n", "utf-8");
      await writeFile(join(chaptersDir, "0001_Title_One.md"), "# Chapter 1\n\nContent 1.", "utf-8");
      await manager.snapshotState(bookId, 1);

      // Write chapter 2 state + file
      await writeFile(join(storyDir, "current_state.md"), "# State\n\n- After chapter 2.\n", "utf-8");
      await writeFile(join(storyDir, "pending_hooks.md"), "# Hooks\n\n- hook-1\n- hook-2\n- hook-3\n", "utf-8");
      await writeFile(join(storyDir, "chapter_summaries.md"), "# Summaries\n\n| 1 | Title 1 |\n| 2 | Title 2 |\n", "utf-8");
      await writeFile(join(chaptersDir, "0002_Title_Two.md"), "# Chapter 2\n\nContent 2.", "utf-8");
      await writeFile(join(runtimeDir, "chapter-002.intent.md"), "intent 2", "utf-8");
      await manager.snapshotState(bookId, 2);

      // Write chapter 3 state + file
      await writeFile(join(storyDir, "current_state.md"), "# State\n\n- After chapter 3.\n", "utf-8");
      await writeFile(join(storyDir, "pending_hooks.md"), "# Hooks\n\n- hook-1\n- hook-2\n- hook-3\n- hook-4\n", "utf-8");
      await writeFile(join(storyDir, "chapter_summaries.md"), "# Summaries\n\n| 1 | Title 1 |\n| 2 | Title 2 |\n| 3 | Title 3 |\n", "utf-8");
      await writeFile(join(chaptersDir, "0003_Title_Three.md"), "# Chapter 3\n\nContent 3.", "utf-8");
      await writeFile(join(runtimeDir, "chapter-003.intent.md"), "intent 3", "utf-8");
      await manager.snapshotState(bookId, 3);

      // Save index with all 3 chapters
      const now = "2026-03-31T00:00:00Z";
      await manager.saveChapterIndex(bookId, [
        { number: 1, title: "Title One", status: "approved", wordCount: 100, createdAt: now, updatedAt: now, auditIssues: [], lengthWarnings: [] },
        { number: 2, title: "Title Two", status: "ready-for-review", wordCount: 100, createdAt: now, updatedAt: now, auditIssues: [], lengthWarnings: [] },
        { number: 3, title: "Title Three", status: "audit-failed", wordCount: 100, createdAt: now, updatedAt: now, auditIssues: ["pacing"], lengthWarnings: [] },
      ]);
    }

    it("deletes nested volume files and indexed paths during rollback", async () => {
      const nestedBookId = "rollback-nested-volume-book";
      const bookDir = manager.bookDir(nestedBookId);
      const storyDir = join(bookDir, "story");
      const chaptersDir = join(bookDir, "chapters");
      await mkdir(storyDir, { recursive: true });
      await mkdir(join(chaptersDir, "卷01"), { recursive: true });
      await mkdir(join(chaptersDir, "卷02"), { recursive: true });
      await mkdir(join(chaptersDir, "卷03"), { recursive: true });

      await Promise.all([
        writeFile(join(storyDir, "current_state.md"), "# State at chapter 1", "utf-8"),
        writeFile(join(storyDir, "pending_hooks.md"), "# Hooks at chapter 1", "utf-8"),
        writeFile(join(storyDir, "chapter_summaries.md"), "# Summaries", "utf-8"),
      ]);
      await manager.snapshotState(nestedBookId, 1);

      const now = "2026-04-01T00:00:00Z";
      const chapterIndex = [
        { number: 1, title: "Keep", status: "approved", wordCount: 100, createdAt: now, updatedAt: now, auditIssues: [], lengthWarnings: [], fileName: "卷01/0001_Keep.md" },
        { number: 2, title: "Discard", status: "approved", wordCount: 100, createdAt: now, updatedAt: now, auditIssues: [], lengthWarnings: [], fileName: "卷02/0002_Discard.md" },
        { number: 3, title: "Indexed only", status: "approved", wordCount: 100, createdAt: now, updatedAt: now, auditIssues: [], lengthWarnings: [], fileName: "卷03/indexed-only.md" },
      ];
      await Promise.all([
        writeFile(join(chaptersDir, "卷01", "0001_Keep.md"), "keep", "utf-8"),
        writeFile(join(chaptersDir, "卷02", "0002_Discard.md"), "discard", "utf-8"),
        writeFile(join(chaptersDir, "卷03", "indexed-only.md"), "discard by index", "utf-8"),
        writeFile(join(chaptersDir, "index.json"), JSON.stringify(chapterIndex), "utf-8"),
      ]);

      await expect(manager.rollbackToChapter(nestedBookId, 1)).resolves.toEqual([2, 3]);
      await expect(stat(join(chaptersDir, "卷01", "0001_Keep.md"))).resolves.toBeDefined();
      await expect(stat(join(chaptersDir, "卷02", "0002_Discard.md"))).rejects.toThrow();
      await expect(stat(join(chaptersDir, "卷03", "indexed-only.md"))).rejects.toThrow();
    });

    it("restores state to the target chapter and removes subsequent chapters", async () => {
      await setupRollbackBook();

      const discarded = await manager.rollbackToChapter(bookId, 1);

      expect(discarded).toEqual([2, 3]);

      // State should be restored to chapter 1 snapshot
      const bookDir = manager.bookDir(bookId);
      const state = await readFile(join(bookDir, "story", "current_state.md"), "utf-8");
      expect(state).toContain("After chapter 1");
      expect(state).not.toContain("After chapter 3");

      const hooks = await readFile(join(bookDir, "story", "pending_hooks.md"), "utf-8");
      expect(hooks).toContain("hook-2");
      expect(hooks).not.toContain("hook-4");

      // Chapter index should only have chapter 1
      const index = await manager.loadChapterIndex(bookId);
      expect(index).toHaveLength(1);
      expect(index[0]!.number).toBe(1);
      expect(index[0]!.status).toBe("approved");

      // Chapter files for 2 and 3 should be deleted
      const chaptersDir = join(bookDir, "chapters");
      const { readdir: rd } = await import("node:fs/promises");
      const remaining = (await rd(chaptersDir)).filter((f) => f.endsWith(".md"));
      expect(remaining).toEqual(["0001_Title_One.md"]);

      // Snapshots for 2 and 3 should be deleted
      const snapshotsDir = join(bookDir, "story", "snapshots");
      const snapshots = await rd(snapshotsDir);
      expect(snapshots.sort()).toEqual(["0", "1"]);
    });

    it("rolls back to chapter 0 (initial state) when rejecting chapter 1", async () => {
      await setupRollbackBook();

      const discarded = await manager.rollbackToChapter(bookId, 0);

      expect(discarded).toEqual([1, 2, 3]);

      const bookDir = manager.bookDir(bookId);
      const state = await readFile(join(bookDir, "story", "current_state.md"), "utf-8");
      expect(state).toContain("Initial state");

      const index = await manager.loadChapterIndex(bookId);
      expect(index).toHaveLength(0);
    });

    it("throws when the target snapshot does not exist", async () => {
      await setupRollbackBook();

      await expect(manager.rollbackToChapter(bookId, 99)).rejects.toThrow("Cannot restore snapshot");
    });

    it("removes sqlite memory files when rolling back", async () => {
      await setupRollbackBook();

      const storyDir = join(manager.bookDir(bookId), "story");
      await Promise.all([
        writeFile(join(storyDir, "memory.db"), "stale db", "utf-8"),
        writeFile(join(storyDir, "memory.db-shm"), "stale shm", "utf-8"),
        writeFile(join(storyDir, "memory.db-wal"), "stale wal", "utf-8"),
      ]);

      await manager.rollbackToChapter(bookId, 1);

      await expect(stat(join(storyDir, "memory.db"))).rejects.toThrow();
      await expect(stat(join(storyDir, "memory.db-shm"))).rejects.toThrow();
      await expect(stat(join(storyDir, "memory.db-wal"))).rejects.toThrow();
    });
  });
});
