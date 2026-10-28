import { AsyncLocalStorage } from "node:async_hooks";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { writeFileAtomic } from "../writing-resource/atomic-write.js";

/**
 * book.json 的按书串行锁（进程内、可重入）与锁内读改写 helper。
 *
 * book.json 的每个写入方（书籍设置、建书十一问、改绑目录、章节保存后的时间戳、叙事记忆配置）
 * 都是「读整份 → 改 → 整份写回」。原子写只保证文件不留半截，挡不住两个写入方交错：
 * 拿着请求开始时读到的旧配置写回的一方，会把期间别人改过的字段整份冲掉。
 * 所有写入都必须经 `updateBookConfig`（锁内重读最新内容再改）或包在 `withBookConfigLock` 里。
 *
 * 写法与 `writing-resource/chapter-index-lock.ts` 一致：锁 key 为 resolve 后的书根，
 * Windows 下转小写；同一条异步调用链里嵌套加锁直接执行，不会自锁。
 * 加锁顺序固定为「章节索引锁 → book.json 锁」：持有本锁时不得再去拿章节索引锁。
 */

const tails = new Map<string, Promise<void>>();
const held = new AsyncLocalStorage<ReadonlySet<string>>();

function lockKey(bookRoot: string): string {
  const absolute = resolve(bookRoot);
  return process.platform === "win32" ? absolute.toLowerCase() : absolute;
}

export async function withBookConfigLock<T>(bookRoot: string, task: () => Promise<T>): Promise<T> {
  const key = lockKey(bookRoot);
  const current = held.getStore();
  if (current?.has(key)) return task();

  const previous = tails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((resolveRelease) => {
    release = resolveRelease;
  });
  const tail = previous.then(() => mine);
  tails.set(key, tail);

  await previous;
  try {
    return await held.run(new Set([...(current ?? []), key]), task);
  } finally {
    release();
    if (tails.get(key) === tail) tails.delete(key);
  }
}

export class BookConfigUnreadableError extends Error {
  readonly code = "BOOK_CONFIG_UNREADABLE";
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "BookConfigUnreadableError";
  }
}

function unreadableExplanation(detail: string): string {
  return [
    `发生了什么：本书的 book.json 无法读取或解析（${detail}），这次修改没有写入。`,
    "为什么要看：在读不出原配置的情况下写回，会把 book.json 覆盖成只剩本次修改的残缺内容，书名、字数目标等设置都会丢失。",
    "建议怎么做：检查 book.json 是否被其他程序占用，或用文本编辑器确认它是合法 JSON（可从备份恢复）；修复后再重试。",
  ].join("\n");
}

/**
 * 读取 book.json 的最新内容。文件不存在返回 null；
 * 其他读取错误、解析失败或不是对象时抛 `BookConfigUnreadableError`，绝不当成空对象。
 */
export async function readBookConfigFile(bookRoot: string): Promise<Record<string, unknown> | null> {
  let raw: string;
  try {
    raw = await readFile(join(bookRoot, "book.json"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    const code = (error as NodeJS.ErrnoException).code ?? (error instanceof Error ? error.message : String(error));
    throw new BookConfigUnreadableError(unreadableExplanation(`读取失败：${code}`), { cause: error });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new BookConfigUnreadableError(unreadableExplanation("内容不是合法 JSON"), { cause: error });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new BookConfigUnreadableError(unreadableExplanation("内容不是 JSON 对象"));
  }
  return parsed as Record<string, unknown>;
}

/**
 * 锁内读改写 book.json：在锁里重新读取最新内容交给 `mutate`，再原子写回。
 * `mutate` 拿到的 `current` 为 null 表示文件不存在；返回 null 表示不写。
 * 返回实际写入的配置（未写入时为 null）。
 */
export async function updateBookConfig(
  bookRoot: string,
  mutate: (
    current: Record<string, unknown> | null,
  ) => Record<string, unknown> | null | Promise<Record<string, unknown> | null>,
): Promise<Record<string, unknown> | null> {
  return withBookConfigLock(bookRoot, async () => {
    const current = await readBookConfigFile(bookRoot);
    const next = await mutate(current);
    if (!next) return null;
    await writeFileAtomic(join(bookRoot, "book.json"), `${JSON.stringify(next, null, 2)}\n`);
    return next;
  });
}
