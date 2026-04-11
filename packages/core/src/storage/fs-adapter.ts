import { readFile, writeFile, mkdir, readdir, stat, rm, unlink, open } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { StateManager } from "../state/manager.js";
import type { BookConfig } from "../models/book.js";
import type { ChapterMeta } from "../models/chapter.js";
import type {
  StorageAdapter,
  TruthFilesData,
  ControlDocuments,
  WriteSnapshot,
  MutationSet,
  WriteLockHandle,
} from "./adapter.js";

/**
 * Maps truth-file logical names to their on-disk filenames inside `story/`.
 */
const TRUTH_FILE_MAP: Readonly<Record<string, string>> = {
  currentState: "current_state.md",
  particleLedger: "particle_ledger.md",
  pendingHooks: "pending_hooks.md",
  storyBible: "story_bible.md",
  volumeOutline: "volume_outline.md",
  bookRules: "book_rules.md",
};

export class FileSystemStorageAdapter implements StorageAdapter {
  private readonly state: StateManager;
  private readonly activeLocks = new Map<string, string>();

  constructor(private readonly projectRoot: string) {
    this.state = new StateManager(projectRoot);
  }

  // ---------------------------------------------------------------------------
  // Books
  // ---------------------------------------------------------------------------

  async listBooks(): Promise<string[]> {
    const books = await this.state.listBooks();
    return [...books];
  }

  async loadBookConfig(bookId: string): Promise<BookConfig> {
    return this.state.loadBookConfig(bookId);
  }

  async saveBookConfig(bookId: string, config: BookConfig): Promise<void> {
    await this.state.saveBookConfig(bookId, config);
  }

  async deleteBook(bookId: string): Promise<void> {
    const bookDir = this.state.bookDir(bookId);
    await rm(bookDir, { recursive: true, force: true });
  }

  // ---------------------------------------------------------------------------
  // Chapters
  // ---------------------------------------------------------------------------

  async loadChapterIndex(bookId: string): Promise<ChapterMeta[]> {
    const index = await this.state.loadChapterIndex(bookId);
    return [...index];
  }

  async loadChapterContent(bookId: string, num: number): Promise<string> {
    const chaptersDir = join(this.state.bookDir(bookId), "chapters");
    const files = await readdir(chaptersDir);
    const paddedNum = String(num).padStart(4, "0");
    const chapterFile = files.find(
      (f) => f.startsWith(paddedNum) && f.endsWith(".md"),
    );
    if (!chapterFile) {
      throw new Error(
        `Chapter ${num} file not found in ${chaptersDir}`,
      );
    }
    return readFile(join(chaptersDir, chapterFile), "utf-8");
  }

  async saveChapterContent(
    bookId: string,
    num: number,
    content: string,
    meta: ChapterMeta,
  ): Promise<void> {
    const chaptersDir = join(this.state.bookDir(bookId), "chapters");
    await mkdir(chaptersDir, { recursive: true });

    // Remove any existing file for this chapter number
    try {
      const files = await readdir(chaptersDir);
      const paddedNum = String(num).padStart(4, "0");
      for (const f of files) {
        if (f.startsWith(paddedNum) && f.endsWith(".md")) {
          await unlink(join(chaptersDir, f));
        }
      }
    } catch {
      // directory may not exist yet
    }

    const paddedNum = String(num).padStart(4, "0");
    const safeTitle = (meta.title || "untitled")
      .replace(/[/\\?%*:|"<>]/g, "_")
      .slice(0, 80);
    const fileName = `${paddedNum}_${safeTitle}.md`;
    await writeFile(join(chaptersDir, fileName), content, "utf-8");

    // Update the chapter index
    const index = [...(await this.state.loadChapterIndex(bookId))];
    const existingIdx = index.findIndex((c) => c.number === num);
    if (existingIdx >= 0) {
      index[existingIdx] = { ...meta };
    } else {
      index.push({ ...meta });
      index.sort((a, b) => a.number - b.number);
    }
    await this.state.saveChapterIndex(bookId, index);
  }

  // ---------------------------------------------------------------------------
  // Truth files
  // ---------------------------------------------------------------------------

  async loadTruthFiles(bookId: string): Promise<TruthFilesData> {
    const storyDir = join(this.state.bookDir(bookId), "story");
    const readSafe = async (path: string): Promise<string> => {
      try {
        return await readFile(path, "utf-8");
      } catch {
        return "";
      }
    };

    const [
      currentState,
      particleLedger,
      pendingHooks,
      storyBible,
      volumeOutline,
      bookRules,
    ] = await Promise.all([
      readSafe(join(storyDir, "current_state.md")),
      readSafe(join(storyDir, "particle_ledger.md")),
      readSafe(join(storyDir, "pending_hooks.md")),
      readSafe(join(storyDir, "story_bible.md")),
      readSafe(join(storyDir, "volume_outline.md")),
      readSafe(join(storyDir, "book_rules.md")),
    ]);

    return {
      currentState,
      particleLedger,
      pendingHooks,
      storyBible,
      volumeOutline,
      bookRules,
    };
  }

  async saveTruthFile(
    bookId: string,
    file: string,
    content: string,
  ): Promise<void> {
    const fileName = TRUTH_FILE_MAP[file];
    if (!fileName) {
      throw new Error(
        `Unknown truth file key "${file}". Valid keys: ${Object.keys(TRUTH_FILE_MAP).join(", ")}`,
      );
    }
    const storyDir = join(this.state.bookDir(bookId), "story");
    await mkdir(storyDir, { recursive: true });
    await writeFile(join(storyDir, fileName), content, "utf-8");
  }

  // ---------------------------------------------------------------------------
  // Control documents
  // ---------------------------------------------------------------------------

  async loadControlDocuments(bookId: string): Promise<ControlDocuments> {
    return this.state.loadControlDocuments(bookId);
  }

  // ---------------------------------------------------------------------------
  // Write snapshot
  // ---------------------------------------------------------------------------

  async prepareWriteSnapshot(bookId: string): Promise<WriteSnapshot> {
    const [bookConfig, chapterIndex, truthFiles, controlDocs] =
      await Promise.all([
        this.loadBookConfig(bookId),
        this.loadChapterIndex(bookId),
        this.loadTruthFiles(bookId),
        this.loadControlDocuments(bookId),
      ]);

    // Collect recent 3 chapters (content + summary from index)
    const sorted = [...chapterIndex].sort((a, b) => b.number - a.number);
    const recentEntries = sorted.slice(0, 3);
    const recentChapters = await Promise.all(
      recentEntries.map(async (entry) => {
        let content: string | undefined;
        try {
          content = await this.loadChapterContent(bookId, entry.number);
        } catch {
          content = undefined;
        }
        return {
          num: entry.number,
          summary: entry.title,
          content,
        };
      }),
    );

    // Read outline (volume_outline is already in truthFiles, but the
    // interface exposes it separately for convenience)
    const outline = truthFiles.volumeOutline;

    // Read style profile if available
    let styleProfile: string | undefined;
    try {
      const storyDir = join(this.state.bookDir(bookId), "story");
      styleProfile = await readFile(
        join(storyDir, "style_profile.json"),
        "utf-8",
      );
    } catch {
      styleProfile = undefined;
    }

    return {
      bookConfig,
      chapterIndex,
      recentChapters,
      truthFiles,
      controlDocs,
      outline,
      styleProfile,
    };
  }

  // ---------------------------------------------------------------------------
  // Mutation set
  // ---------------------------------------------------------------------------

  async applyMutationSet(
    bookId: string,
    mutations: MutationSet,
    lockId: string,
  ): Promise<void> {
    const activeLockId = this.activeLocks.get(bookId);
    if (activeLockId !== lockId) {
      throw new Error(
        `Lock mismatch for book "${bookId}": expected "${activeLockId}", got "${lockId}"`,
      );
    }

    const bookDir = this.state.bookDir(bookId);

    // Apply file operations
    for (const op of mutations.operations) {
      const fullPath = join(bookDir, op.path);
      switch (op.op) {
        case "create":
        case "update": {
          const dir = fullPath.replace(/[\\/][^\\/]+$/, "");
          await mkdir(dir, { recursive: true });
          await writeFile(fullPath, op.content ?? "", "utf-8");
          break;
        }
        case "delete": {
          await unlink(fullPath).catch(() => undefined);
          break;
        }
      }
    }

    // Apply chapter index updates
    if (mutations.chapterUpdates && mutations.chapterUpdates.length > 0) {
      const index = [...(await this.state.loadChapterIndex(bookId))];
      for (const update of mutations.chapterUpdates) {
        const idx = index.findIndex((c) => c.number === update.num);
        if (idx >= 0) {
          index[idx] = {
            ...index[idx],
            ...update.meta,
            status: update.status as ChapterMeta["status"],
            updatedAt: new Date().toISOString(),
          };
        }
      }
      await this.state.saveChapterIndex(bookId, index);
    }
  }

  // ---------------------------------------------------------------------------
  // Write lock
  // ---------------------------------------------------------------------------

  async acquireWriteLock(bookId: string): Promise<WriteLockHandle> {
    const bookDir = this.state.bookDir(bookId);
    await mkdir(bookDir, { recursive: true });

    const lockPath = join(bookDir, ".write.lock");
    const lockId = randomUUID();

    let handle: import("node:fs/promises").FileHandle;
    try {
      handle = await open(lockPath, "wx");
    } catch (e) {
      const code = (e as NodeJS.ErrnoException | undefined)?.code;
      if (code === "EEXIST") {
        // Check if the lock is stale (owning process dead)
        let lockData = "";
        try {
          lockData = await readFile(lockPath, "utf-8");
        } catch {
          lockData = "pid:unknown ts:unknown";
        }
        const pidMatch = lockData.match(/pid:(\d+)/);
        if (pidMatch) {
          const pid = Number.parseInt(pidMatch[1]!, 10);
          if (Number.isInteger(pid) && pid > 0 && !this.isProcessAlive(pid)) {
            await unlink(lockPath).catch(() => undefined);
            return this.acquireWriteLock(bookId);
          }
        }
        throw new Error(
          `Book "${bookId}" is locked by another process (${lockData}). ` +
            `If this is stale, delete ${lockPath}`,
        );
      }
      throw e;
    }

    try {
      await handle.writeFile(
        `pid:${process.pid} ts:${Date.now()} lockId:${lockId}`,
        "utf-8",
      );
    } catch (error) {
      await handle.close().catch(() => undefined);
      await unlink(lockPath).catch(() => undefined);
      throw error;
    }
    await handle.close();

    this.activeLocks.set(bookId, lockId);

    return {
      lockId,
      release: () => {
        this.activeLocks.delete(bookId);
        unlink(lockPath).catch(() => undefined);
      },
    };
  }

  private isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      return code !== "ESRCH";
    }
  }
}
