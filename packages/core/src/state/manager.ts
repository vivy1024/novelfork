import { readFile, writeFile, mkdir, readdir, rm, stat, unlink, open, rename } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import type { BookConfig } from "../models/book.js";
import type { ChapterMeta } from "../models/chapter.js";
import { writeFileAtomic } from "../utils/atomic-write.js";
import {
  bootstrapStructuredStateFromMarkdown,
  listChapterFiles,
  resolveChapterFilePaths,
  resolveDurableStoryProgress,
} from "./state-bootstrap.js";

// ---------------------------------------------------------------------------
// 书籍写锁（T-13）
//
// 锁文件 `<书目录>/.write.lock` 是跨进程互斥：`open(wx)` 原子创建者持锁。
// 内容是结构化的 key:value 行：`pid:<pid> ts:<开始毫秒> host:<主机名> token:<令牌>`。
// 保留旧格式的 `pid:` / `ts:` 前缀，旧版本程序读到新锁仍能解析；旧格式锁（只有 pid/ts）同样能被这里解析。
//
// 陈旧判定（只有判为陈旧才会回收）：
// - 别的主机（共享盘/同步盘）：本机无法判断那边是否还在写，绝不自动回收，报错并给出处理建议；
// - 同主机、pid 不存活：陈旧；
// - 同主机、pid 就是本进程、但本进程内存里没有这把锁的持有记录：陈旧（释放失败的残留，或 pid 恰好被本进程复用）；
// - 同主机、pid 存活且不是本进程：锁龄超过 BOOK_LOCK_MAX_AGE_MS 视为陈旧，兜底 pid 被系统复用；
// - 内容不完整（刚建文件还没写入，或写入途中崩溃）：按文件修改时间给短宽限，超过才算陈旧。
//
// 回收不是直接删除：先 rename 到唯一的认领名，谁 rename 成功谁继续；改名后核对内容确实是判定时那把陈旧锁再删，
// 否则说明带走的是别人刚建的新锁，原样放回。这样两个争用者同时判陈旧时，后到者删不掉先到者的新锁。
// ---------------------------------------------------------------------------

const BOOK_LOCK_FILE_NAME = ".write.lock";
/** 同主机、持锁进程存活但不是本进程时的锁龄上限。写一章（含模型调用）远小于此，超过只可能是 pid 被复用。 */
export const BOOK_LOCK_MAX_AGE_MS = 6 * 60 * 60 * 1000;
/** 锁文件内容不完整时的宽限：对方从建文件到写完内容只需毫秒级。 */
const BOOK_LOCK_UNPARSEABLE_GRACE_MS = 60 * 1000;
/** 删除锁文件的重试间隔（共 5 次尝试）：Windows 上杀软、索引器、同步盘会短暂占用文件。 */
const BOOK_LOCK_UNLINK_RETRY_DELAYS_MS = [25, 50, 100, 200] as const;
const BOOK_LOCK_RETRYABLE_UNLINK_CODES: ReadonlySet<string> = new Set(["EBUSY", "EPERM", "EACCES"]);
/** 获取锁的尝试轮数：每轮「原子建文件 → 已存在则判定 → 陈旧则条件回收」。 */
const BOOK_LOCK_MAX_ATTEMPTS = 5;

interface BookLockRecord {
  readonly pid?: number;
  readonly hostname?: string;
  readonly startedAt?: number;
  readonly token?: string;
}

/** 与产品层 DiagnosticExplanation 同形：发生了什么 / 为什么要看 / 建议怎么做。 */
export interface BookLockExplanation {
  readonly whatHappened: string;
  readonly whyItMatters: string;
  readonly suggestedAction: string;
}

/** 拿不到书籍写锁。message 保留「is locked」字样，供既有调用方识别；展示请读 explanation。 */
export class BookLockError extends Error {
  constructor(
    message: string,
    readonly code: "book-locked" | "book-locked-foreign-host",
    readonly lockPath: string,
    readonly explanation: BookLockExplanation,
  ) {
    super(message);
    this.name = "BookLockError";
  }
}

type BookLockVerdict =
  | { readonly kind: "gone" }
  | { readonly kind: "stale"; readonly raw: string }
  | { readonly kind: "held"; readonly error: BookLockError };

/**
 * 本进程当前持有的锁令牌。挂在 globalThis 上：同一进程里即使 core 被加载成两份模块实例，
 * 也共用这一份记录，避免一份把另一份持有的锁误判为「本进程 pid 但无持有记录」而回收。
 */
function heldBookLockTokens(): Set<string> {
  const registry = globalThis as unknown as Record<symbol, Set<string> | undefined>;
  const key = Symbol.for("novelfork.core.heldBookLockTokens");
  let tokens = registry[key];
  if (!tokens) {
    tokens = new Set<string>();
    registry[key] = tokens;
  }
  return tokens;
}

function errnoCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}

function formatBookLock(record: Required<BookLockRecord>): string {
  return `pid:${record.pid} ts:${record.startedAt} host:${encodeURIComponent(record.hostname)} token:${record.token}`;
}

function parseBookLock(raw: string): BookLockRecord {
  const field = (name: string): string | undefined => raw.match(new RegExp(`(?:^|\\s)${name}:(\\S+)`, "u"))?.[1];
  const positiveInteger = (value: string | undefined): number | undefined => {
    if (!value || !/^\d+$/u.test(value)) return undefined;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
  };
  const hostField = field("host");
  let host: string | undefined;
  if (hostField) {
    try {
      host = decodeURIComponent(hostField);
    } catch {
      host = hostField;
    }
  }
  return {
    pid: positiveInteger(field("pid")),
    startedAt: positiveInteger(field("ts")),
    hostname: host,
    token: field("token"),
  };
}

function sameHost(recorded: string): boolean {
  return recorded.trim().toLowerCase() === hostname().trim().toLowerCase();
}

function describeLockTime(startedAt: number | undefined): string {
  return startedAt ? `${new Date(startedAt).toISOString()} 起` : "开始时间未知";
}

async function delay(ms: number): Promise<void> {
  await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, ms));
}

/**
 * 删除锁文件（或回收用的认领文件），对短暂占用做有界重试。
 * 返回 true 表示文件已不存在；重试用尽仍失败则记 warn 并返回 false，不抛错——
 * 残留的锁文件写着本进程 pid，本进程内存里已无持有记录，后续获取会把它判为陈旧回收，不会自锁。
 */
async function unlinkBookLockFile(path: string): Promise<boolean> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await unlink(path);
      return true;
    } catch (error) {
      const code = errnoCode(error);
      if (code === "ENOENT") return true;
      const retryDelay = BOOK_LOCK_UNLINK_RETRY_DELAYS_MS[attempt];
      if (code === undefined || !BOOK_LOCK_RETRYABLE_UNLINK_CODES.has(code) || retryDelay === undefined) {
        console.warn(
          `[book-lock] 删除锁文件失败（已尝试 ${attempt + 1} 次）：${path}：${error instanceof Error ? error.message : String(error)}。` +
            "本进程已不再持有这把锁，残留文件会在下次获取时按陈旧锁回收。",
        );
        return false;
      }
      await delay(retryDelay);
    }
  }
}

export interface StateManagerOptions {
  /**
   * Server-owned book directory resolver for a trusted external binding.
   * Callers must reject unknown book IDs instead of falling back to another
   * project directory.
   */
  readonly resolveBookDir?: (bookId: string) => string;
}

export class StateManager {
  constructor(
    private readonly projectRoot: string,
    private readonly options: StateManagerOptions = {},
  ) {}

  private static defaultAuthorIntent(language: "zh" | "en"): string {
    return language === "zh"
      ? "# 作者意图\n\n（在这里描述这本书的长期创作方向。）\n"
      : "# Author Intent\n\n(Describe the long-horizon vision for this book here.)\n";
  }

  private static defaultCurrentFocus(language: "zh" | "en"): string {
    return language === "zh"
      ? "# 当前聚焦\n\n## 当前重点\n\n（描述接下来 1-3 章最需要优先推进的内容。）\n"
      : "# Current Focus\n\n## Active Focus\n\n(Describe what the next 1-3 chapters should prioritize.)\n";
  }

  async ensureControlDocuments(bookId: string, authorIntent?: string): Promise<void> {
    const language = await this.resolveControlDocumentLanguage(bookId);
    await this.ensureControlDocumentsAt(this.bookDir(bookId), language, authorIntent);
  }

  async ensureControlDocumentsAt(
    bookDir: string,
    language: "zh" | "en",
    authorIntent?: string,
  ): Promise<void> {
    const storyDir = join(bookDir, "story");
    const runtimeDir = join(storyDir, "runtime");

    await mkdir(storyDir, { recursive: true });
    await mkdir(runtimeDir, { recursive: true });

    await this.writeIfMissing(
      join(storyDir, "author_intent.md"),
      authorIntent?.trim()
        ? authorIntent.trimEnd() + "\n"
        : StateManager.defaultAuthorIntent(language),
    );

    await this.writeIfMissing(
      join(storyDir, "current_focus.md"),
      StateManager.defaultCurrentFocus(language),
    );
  }

  async loadControlDocuments(bookId: string): Promise<{
    authorIntent: string;
    currentFocus: string;
    runtimeDir: string;
  }> {
    await this.ensureControlDocuments(bookId);

    const storyDir = join(this.bookDir(bookId), "story");
    const runtimeDir = join(storyDir, "runtime");
    const [authorIntent, currentFocus] = await Promise.all([
      readFile(join(storyDir, "author_intent.md"), "utf-8"),
      readFile(join(storyDir, "current_focus.md"), "utf-8"),
    ]);

    return { authorIntent, currentFocus, runtimeDir };
  }

  private async resolveControlDocumentLanguage(bookId: string): Promise<"zh" | "en"> {
    try {
      const raw = await readFile(join(this.bookDir(bookId), "book.json"), "utf-8");
      const parsed = JSON.parse(raw) as { language?: unknown };
      return parsed.language === "zh" ? "zh" : "en";
    } catch {
      return "en";
    }
  }

  /**
   * 获取书籍写锁（跨进程，冲突即报错不排队）。规则见文件头「书籍写锁（T-13）」。
   * 返回的释放函数只删除仍带本次令牌的锁文件：锁若已被判陈旧并由新持有者接管，不得误删。
   */
  async acquireBookLock(bookId: string): Promise<() => Promise<void>> {
    const bookDir = this.bookDir(bookId);
    await mkdir(bookDir, { recursive: true });
    const lockPath = join(bookDir, BOOK_LOCK_FILE_NAME);
    const token = randomUUID();
    const held = heldBookLockTokens();

    for (let attempt = 1; attempt <= BOOK_LOCK_MAX_ATTEMPTS; attempt += 1) {
      // 先登记再建文件：同进程的并发争用者读到带本令牌的锁时，能认出这把锁有人持有，不会当成自锁残留回收。
      held.add(token);
      let handle: FileHandle;
      try {
        handle = await open(lockPath, "wx");
      } catch (error) {
        held.delete(token);
        if (errnoCode(error) !== "EEXIST") throw error;
        const verdict = await this.judgeExistingBookLock(bookId, lockPath);
        if (verdict.kind === "held") throw verdict.error;
        if (verdict.kind === "stale") await this.reclaimStaleBookLock(lockPath, verdict.raw);
        // gone / 回收完毕 / 回收时发现已被别人接管：都回到下一轮重新原子创建、重新判定。
        continue;
      }
      try {
        await handle.writeFile(
          formatBookLock({ pid: process.pid, hostname: hostname(), startedAt: Date.now(), token }),
          "utf-8",
        );
        await handle.close();
      } catch (error) {
        await handle.close().catch(() => undefined);
        await unlink(lockPath).catch(() => undefined);
        held.delete(token);
        throw error;
      }
      return this.createBookLockRelease(lockPath, token);
    }

    throw new BookLockError(
      `Book "${bookId}" is locked: gave up after ${BOOK_LOCK_MAX_ATTEMPTS} attempts to reclaim a stale lock. ` +
        `If this is stale, delete ${lockPath}`,
      "book-locked",
      lockPath,
      {
        whatHappened: `连续 ${BOOK_LOCK_MAX_ATTEMPTS} 次尝试回收本书的陈旧写锁都没有成功，可能有多个写入任务在同时争抢这本书。`,
        whyItMatters: "拿不到写锁时继续写入，会和别的任务互相覆盖章节与索引，所以这次没有写。",
        suggestedAction: `稍等片刻后重试；若一直如此，确认没有别的任务在写这本书后，删除锁文件 ${lockPath} 再试。`,
      },
    );
  }

  /** 读取已存在的锁文件并判定：仍被持有 / 已陈旧 / 已被删除。 */
  private async judgeExistingBookLock(bookId: string, lockPath: string): Promise<BookLockVerdict> {
    let raw: string;
    try {
      raw = await readFile(lockPath, "utf-8");
    } catch (error) {
      if (errnoCode(error) === "ENOENT") return { kind: "gone" };
      return {
        kind: "held",
        error: new BookLockError(
          `Book "${bookId}" is locked: the lock file cannot be read (${error instanceof Error ? error.message : String(error)}). ` +
            `If this is stale, delete ${lockPath}`,
          "book-locked",
          lockPath,
          {
            whatHappened: `本书的写锁文件暂时读不了（${errnoCode(error) ?? "未知错误"}），无法判断是否有别的任务在写。`,
            whyItMatters: "看不清锁的归属时贸然回收，可能让两个任务同时写同一本书、互相覆盖章节。",
            suggestedAction: "稍后重试；若一直读不了，检查该文件是否被杀毒或同步软件占用、当前账户是否有权限。",
          },
        ),
      };
    }

    const record = parseBookLock(raw);
    if (record.pid === undefined) {
      const ageMs = await this.bookLockFileAgeMs(lockPath);
      if (ageMs === undefined) return { kind: "gone" };
      if (ageMs > BOOK_LOCK_UNPARSEABLE_GRACE_MS) return { kind: "stale", raw };
      return {
        kind: "held",
        error: new BookLockError(
          `Book "${bookId}" is locked: the lock file is being written by another task. If this is stale, delete ${lockPath}`,
          "book-locked",
          lockPath,
          {
            whatHappened: "本书的写锁文件刚被创建、内容还没写完，可能另一个写入任务正在启动。",
            whyItMatters: "两个任务同时写同一本书会互相覆盖章节与索引，所以同一时间只允许一个写入。",
            suggestedAction: "稍等几秒后重试。",
          },
        ),
      };
    }

    if (record.hostname !== undefined && !sameHost(record.hostname)) {
      return {
        kind: "held",
        error: new BookLockError(
          `Book "${bookId}" is locked by another machine (host ${record.hostname}, pid ${record.pid}). ` +
            `Confirm nothing is writing there, then delete ${lockPath}`,
          "book-locked-foreign-host",
          lockPath,
          {
            whatHappened: `本书的写锁由另一台电脑「${record.hostname}」持有（进程 ${record.pid}，${describeLockTime(record.startedAt)}）。`,
            whyItMatters: "书放在共享盘或同步盘上时，本机无法判断那台电脑上的任务是否还在运行；自动回收可能让两台电脑同时写同一本书，互相覆盖章节。",
            suggestedAction: `先确认那台电脑上没有在写这本书（关掉那边的 NovelFork 即可），再删除锁文件 ${lockPath} 后重试。`,
          },
        ),
      };
    }

    if (!this.isProcessAlive(record.pid)) return { kind: "stale", raw };

    if (record.pid === process.pid) {
      if (record.token !== undefined && heldBookLockTokens().has(record.token)) {
        return {
          kind: "held",
          error: new BookLockError(
            `Book "${bookId}" is locked by another task in this process (${raw}). If this is stale, delete ${lockPath}`,
            "book-locked",
            lockPath,
            {
              whatHappened: `本书正被当前程序里的另一个写入任务占用（${describeLockTime(record.startedAt)}）。`,
              whyItMatters: "两个任务同时写同一本书会互相覆盖章节与索引，所以同一时间只允许一个写入。",
              suggestedAction: "等正在进行的写章、导入或整理完成后再试。",
            },
          ),
        };
      }
      // 本进程 pid、但内存里没有这把锁：释放时没删掉的残留，或 pid 被本进程复用。
      return { kind: "stale", raw };
    }

    const startedAt = record.startedAt ?? await this.bookLockFileMtimeMs(lockPath);
    if (startedAt !== undefined && Date.now() - startedAt > BOOK_LOCK_MAX_AGE_MS) {
      return { kind: "stale", raw };
    }
    return {
      kind: "held",
      error: new BookLockError(
        `Book "${bookId}" is locked by another process (${raw}). If this is stale, delete ${lockPath}`,
        "book-locked",
        lockPath,
        {
          whatHappened: `本书正被本机另一个写入任务占用（进程 ${record.pid}，${describeLockTime(record.startedAt)}）。`,
          whyItMatters: "两个任务同时写同一本书会互相覆盖章节与索引，所以同一时间只允许一个写入。",
          suggestedAction: `等那个任务结束后再试；若确认没有任务在跑，删除锁文件 ${lockPath} 后重试。持锁超过 6 小时的锁会被自动回收。`,
        },
      ),
    };
  }

  /**
   * 条件回收陈旧锁：rename 到唯一认领名，谁改名成功谁继续；改名后核对内容确实是判定时那把陈旧锁才删除，
   * 否则说明带走的是别人刚建的新锁，用 wx 原样放回（锁位已被第三方占用时不覆盖）。
   * 本函数不负责建新锁；调用方回到下一轮重新原子创建、重新判定。
   */
  private async reclaimStaleBookLock(lockPath: string, staleRaw: string): Promise<void> {
    // 改名前再核对一次：内容变了说明有人刚接管，直接交回调用方重新判定，缩小争用窗口。
    const current = await readFile(lockPath, "utf-8").catch(() => undefined);
    if (current !== staleRaw) return;

    const claimPath = join(dirname(lockPath), `.write.reclaim-${randomUUID()}.lock`);
    try {
      await rename(lockPath, claimPath);
    } catch (error) {
      if (errnoCode(error) === "ENOENT") return;
      throw error;
    }

    const claimed = await readFile(claimPath, "utf-8").catch(() => undefined);
    if (claimed === undefined) {
      // 读不出认领到的内容：无法确认是不是陈旧锁，宁可留下认领文件，也不删可能属于别人的锁。
      console.warn(`[book-lock] 回收陈旧锁时读不出认领文件，已保留：${claimPath}`);
      return;
    }
    if (claimed !== staleRaw) {
      await this.restoreBookLock(lockPath, claimed);
    }
    await unlinkBookLockFile(claimPath);
  }

  private async restoreBookLock(lockPath: string, content: string): Promise<void> {
    let handle: FileHandle;
    try {
      handle = await open(lockPath, "wx");
    } catch (error) {
      console.warn(
        `[book-lock] 回收陈旧锁时误带走了新持有者的锁，且锁位已被占用，无法放回：${lockPath}` +
          `（${error instanceof Error ? error.message : String(error)}）`,
      );
      return;
    }
    try {
      await handle.writeFile(content, "utf-8");
    } finally {
      await handle.close().catch(() => undefined);
    }
  }

  private createBookLockRelease(lockPath: string, token: string): () => Promise<void> {
    let released = false;
    return async () => {
      if (released) return;
      released = true;
      try {
        let current: string;
        try {
          current = await readFile(lockPath, "utf-8");
        } catch (error) {
          if (errnoCode(error) !== "ENOENT") {
            console.warn(
              `[book-lock] 释放时读不出锁文件，未删除：${lockPath}（${error instanceof Error ? error.message : String(error)}）。` +
                "本进程已不再持有这把锁，残留文件会在下次获取时按陈旧锁回收。",
            );
          }
          return;
        }
        // 已被新持有者接管（锁里不是本次令牌）：不得误删别人的锁。
        if (parseBookLock(current).token !== token) return;
        await unlinkBookLockFile(lockPath);
      } finally {
        // 不管文件删没删掉，本进程都不再持有这把锁；残留文件会被「本进程 pid 但无持有记录」判为陈旧。
        heldBookLockTokens().delete(token);
      }
    };
  }

  private async bookLockFileMtimeMs(lockPath: string): Promise<number | undefined> {
    try {
      return (await stat(lockPath)).mtimeMs;
    } catch {
      return undefined;
    }
  }

  private async bookLockFileAgeMs(lockPath: string): Promise<number | undefined> {
    const mtimeMs = await this.bookLockFileMtimeMs(lockPath);
    return mtimeMs === undefined ? undefined : Date.now() - mtimeMs;
  }

  private isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      if (code === "ESRCH") {
        return false;
      }
      return true;
    }
  }

  get booksDir(): string {
    return join(this.projectRoot, "books");
  }

  bookDir(bookId: string): string {
    if (this.options.resolveBookDir) return this.options.resolveBookDir(bookId);
    return join(this.booksDir, bookId);
  }

  stateDir(bookId: string): string {
    return join(this.bookDir(bookId), "story", "state");
  }

  async loadProjectConfig(): Promise<Record<string, unknown>> {
    const configPath = join(this.projectRoot, "novelfork.json");
    const raw = await readFile(configPath, "utf-8");
    return JSON.parse(raw);
  }

  async saveProjectConfig(config: Record<string, unknown>): Promise<void> {
    const configPath = join(this.projectRoot, "novelfork.json");
    await writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");
  }

  async loadBookConfig(bookId: string): Promise<BookConfig> {
    const configPath = join(this.bookDir(bookId), "book.json");
    const raw = await readFile(configPath, "utf-8");
    if (!raw.trim()) {
      throw new Error(`book.json is empty for book "${bookId}"`);
    }
    return JSON.parse(raw) as BookConfig;
  }

  async saveBookConfig(bookId: string, config: BookConfig): Promise<void> {
    await this.saveBookConfigAt(this.bookDir(bookId), config);
  }

  async saveBookConfigAt(bookDir: string, config: BookConfig): Promise<void> {
    await mkdir(bookDir, { recursive: true });
    await writeFile(
      join(bookDir, "book.json"),
      JSON.stringify(config, null, 2),
      "utf-8",
    );
  }

  async ensureRuntimeState(bookId: string, fallbackChapter = 0): Promise<void> {
    await bootstrapStructuredStateFromMarkdown({
      bookDir: this.bookDir(bookId),
      fallbackChapter,
    });
  }

  async listBooks(): Promise<ReadonlyArray<string>> {
    try {
      const entries = await readdir(this.booksDir);
      const bookIds: string[] = [];
      for (const entry of entries) {
        const bookJsonPath = join(this.booksDir, entry, "book.json");
        try {
          await stat(bookJsonPath);
          bookIds.push(entry);
        } catch {
          // not a book directory
        }
      }
      return bookIds;
    } catch {
      return [];
    }
  }

  async getNextChapterNumber(bookId: string): Promise<number> {
    const durableChapter = await resolveDurableStoryProgress({
      bookDir: this.bookDir(bookId),
    });
    // Ensure structured state is bootstrapped (side-effect: creates missing
    // JSON files), but do NOT trust its chapter number for progress — only
    // the contiguous durable artifact chain is authoritative.
    await bootstrapStructuredStateFromMarkdown({
      bookDir: this.bookDir(bookId),
      fallbackChapter: durableChapter,
    });
    return durableChapter + 1;
  }

  async getPersistedChapterCount(bookId: string): Promise<number> {
    const chaptersDir = join(this.bookDir(bookId), "chapters");
    const chapterFiles = await listChapterFiles(chaptersDir);
    return new Set(chapterFiles.map((file) => file.chapterNumber)).size;
  }

  async loadChapterIndex(bookId: string): Promise<ReadonlyArray<ChapterMeta>> {
    const indexPath = join(this.bookDir(bookId), "chapters", "index.json");
    try {
      const raw = await readFile(indexPath, "utf-8");
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }

  async saveChapterIndex(
    bookId: string,
    index: ReadonlyArray<ChapterMeta>,
  ): Promise<void> {
    await this.saveChapterIndexAt(this.bookDir(bookId), index);
  }

  async saveChapterIndexAt(
    bookDir: string,
    index: ReadonlyArray<ChapterMeta>,
  ): Promise<void> {
    const chaptersDir = join(bookDir, "chapters");
    await mkdir(chaptersDir, { recursive: true });
    // 原子替换：索引被写坏时整本书的章节都会失联，必须与正文一样「要么旧版、要么新版」。
    await writeFileAtomic(
      join(chaptersDir, "index.json"),
      JSON.stringify(index, null, 2),
    );
  }

  async snapshotState(bookId: string, chapterNumber: number): Promise<void> {
    await this.snapshotStateAt(this.bookDir(bookId), chapterNumber);
  }

  async snapshotStateAt(bookDir: string, chapterNumber: number): Promise<void> {
    const storyDir = join(bookDir, "story");
    const snapshotDir = join(storyDir, "snapshots", String(chapterNumber));
    await mkdir(snapshotDir, { recursive: true });

    const files = [
      "current_state.md", "particle_ledger.md", "pending_hooks.md",
      "chapter_summaries.md", "subplot_board.md", "emotional_arcs.md", "character_matrix.md",
    ];
    await Promise.all(
      files.map(async (f) => {
        try {
          const content = await readFile(join(storyDir, f), "utf-8");
          await writeFile(join(snapshotDir, f), content, "utf-8");
        } catch {
          // file doesn't exist yet
        }
      }),
    );

    const stateDir = join(bookDir, "story", "state");
    const snapshotStateDir = join(snapshotDir, "state");
    try {
      const stateFiles = await readdir(stateDir);
      if (stateFiles.length > 0) {
        await mkdir(snapshotStateDir, { recursive: true });
        await Promise.all(
          stateFiles.map(async (fileName) => {
            const content = await readFile(join(stateDir, fileName), "utf-8");
            await writeFile(join(snapshotStateDir, fileName), content, "utf-8");
          }),
        );
      }
    } catch {
      // state directory missing — skip
    }
  }

  async isCompleteBookDirectory(bookDir: string): Promise<boolean> {
    const requiredPaths = [
      join(bookDir, "book.json"),
      // [CLEANUP] story_bible.md 已废弃，不再作为完整性检查条件
      join(bookDir, "story", "volume_outline.md"),
      join(bookDir, "story", "book_rules.md"),
      join(bookDir, "story", "current_state.md"),
      join(bookDir, "story", "pending_hooks.md"),
      join(bookDir, "chapters", "index.json"),
    ];

    for (const requiredPath of requiredPaths) {
      try {
        await stat(requiredPath);
      } catch {
        return false;
      }
    }

    return true;
  }

  async restoreState(bookId: string, chapterNumber: number): Promise<boolean> {
    const storyDir = join(this.bookDir(bookId), "story");
    const snapshotDir = join(storyDir, "snapshots", String(chapterNumber));

    const files = [
      "current_state.md", "particle_ledger.md", "pending_hooks.md",
      "chapter_summaries.md", "subplot_board.md", "emotional_arcs.md", "character_matrix.md",
    ];
    try {
      // current_state.md and pending_hooks.md are required;
      // particle_ledger.md is optional (numericalSystem=false genres don't have it)
      // the rest are optional (may not exist in older snapshots)
      const requiredFiles = ["current_state.md", "pending_hooks.md"];
      const optionalFiles = files.filter((f) => !requiredFiles.includes(f));

      await Promise.all(
        requiredFiles.map(async (f) => {
          const content = await readFile(join(snapshotDir, f), "utf-8");
          await writeFile(join(storyDir, f), content, "utf-8");
        }),
      );

      await Promise.all(
        optionalFiles.map(async (f) => {
          try {
            const content = await readFile(join(snapshotDir, f), "utf-8");
            await writeFile(join(storyDir, f), content, "utf-8");
          } catch {
            // Optional file missing — skip
          }
        }),
      );

      const stateDir = this.stateDir(bookId);
      let restoredStructuredState = false;
      try {
        const snapshotStateDir = join(snapshotDir, "state");
        const stateFiles = await readdir(snapshotStateDir);
        if (stateFiles.length > 0) {
          restoredStructuredState = true;
          await mkdir(stateDir, { recursive: true });
          await Promise.all(
            stateFiles.map(async (fileName) => {
              const content = await readFile(join(snapshotStateDir, fileName), "utf-8");
              await writeFile(join(stateDir, fileName), content, "utf-8");
            }),
          );
        }
      } catch {
        // snapshot structured state missing — skip
      }
      if (!restoredStructuredState) {
        await rm(stateDir, { recursive: true, force: true });
      }

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Roll back state to the snapshot at `targetChapter`, removing all chapters
   * after it and their associated files (chapter markdown, snapshots, runtime).
   * Used by review reject to undo a bad chapter and everything that followed.
   *
   * Returns the list of chapter numbers that were discarded.
   */
  async rollbackToChapter(
    bookId: string,
    targetChapter: number,
  ): Promise<ReadonlyArray<number>> {
    const restored = await this.restoreState(bookId, targetChapter);
    if (!restored) {
      throw new Error(`Cannot restore snapshot for chapter ${targetChapter} in "${bookId}"`);
    }

    const bookDir = this.bookDir(bookId);
    const chaptersDir = join(bookDir, "chapters");
    const index = await this.loadChapterIndex(bookId);

    const kept: ChapterMeta[] = [];
    const discarded: number[] = [];

    for (const entry of index) {
      if (entry.number <= targetChapter) {
        kept.push(entry);
      } else {
        discarded.push(entry.number);
      }
    }

    // Delete chapter markdown files recursively. Indexed fileName paths are
    // also removed so files whose names do not expose a chapter number cannot
    // survive rollback.
    const chapterFiles = await listChapterFiles(chaptersDir);
    const chapterPathsToDelete = new Set(
      chapterFiles
        .filter((file) => file.chapterNumber > targetChapter)
        .map((file) => file.path),
    );
    const indexedChapterPaths = await Promise.all(
      discarded.map((chapterNumber) => resolveChapterFilePaths(chaptersDir, chapterNumber)),
    );
    for (const paths of indexedChapterPaths) {
      for (const path of paths) chapterPathsToDelete.add(path);
    }
    await Promise.all(
      [...chapterPathsToDelete].map((path) => unlink(path).catch(() => undefined)),
    );

    // Delete snapshots for discarded chapters
    const snapshotsDir = join(bookDir, "story", "snapshots");
    try {
      const snapshots = await readdir(snapshotsDir);
      for (const snap of snapshots) {
        const num = parseInt(snap, 10);
        if (Number.isFinite(num) && num > targetChapter) {
          await rm(join(snapshotsDir, snap), { recursive: true, force: true });
        }
      }
    } catch {
      // snapshots directory missing
    }

    // Delete runtime artifacts for discarded chapters
    const runtimeDir = join(bookDir, "story", "runtime");
    try {
      const runtimeFiles = await readdir(runtimeDir);
      for (const file of runtimeFiles) {
        const match = file.match(/^chapter-(\d+)\./);
        if (!match) continue;
        const num = parseInt(match[1]!, 10);
        if (num > targetChapter) {
          await unlink(join(runtimeDir, file)).catch(() => {});
        }
      }
    } catch {
      // runtime directory missing
    }


    // Drop any persisted sqlite acceleration index so discarded chapters
    // cannot leak back into retrieval after the markdown/state rollback.
    await Promise.all([
      rm(join(bookDir, "story", "memory.db"), { force: true }),
      rm(join(bookDir, "story", "memory.db-shm"), { force: true }),
      rm(join(bookDir, "story", "memory.db-wal"), { force: true }),
    ]);

    await this.saveChapterIndex(bookId, kept);
    return discarded;
  }

  /**
   * 只在文件确实不存在时创建默认模板：wx 由操作系统原子判定「不存在才创建」。
   * 已存在（EEXIST）直接跳过；其它错误（EBUSY/EPERM 等）抛出，绝不拿默认模板覆盖作者写的内容。
   */
  private async writeIfMissing(path: string, content: string): Promise<void> {
    try {
      await writeFile(path, content, { encoding: "utf-8", flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException | undefined)?.code === "EEXIST") return;
      throw error;
    }
  }
}
