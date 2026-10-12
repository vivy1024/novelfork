import { AsyncLocalStorage } from "node:async_hooks";
import { resolve } from "node:path";

/**
 * 章节索引的按书串行锁（进程内、可重入）。
 *
 * index.json 的每次修改都是「读整份 → 改 → 整份写回」。原子写只保证单个文件不留半截，
 * 挡不住两个写入方交错：写作台保存、叙述者写章、对账、导入同时发生时，后写回的一方
 * 会抹掉前一方的条目。所有读改写都必须包在这把锁里。
 *
 * 不复用 StateManager.acquireBookLock：那是跨进程文件锁，冲突即抛错不等待，且外层
 * 写章流程已经持有它。产品的这些写入方都在同一进程，进程内排队即可。
 * 可重入：同一条异步调用链里嵌套的同步/对账直接执行，不会自锁。
 */

const tails = new Map<string, Promise<void>>();
const held = new AsyncLocalStorage<ReadonlySet<string>>();

function lockKey(bookRoot: string): string {
  const absolute = resolve(bookRoot);
  return process.platform === "win32" ? absolute.toLowerCase() : absolute;
}

export async function withChapterIndexLock<T>(bookRoot: string, task: () => Promise<T>): Promise<T> {
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
