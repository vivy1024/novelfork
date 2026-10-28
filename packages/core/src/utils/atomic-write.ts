import { randomUUID } from "node:crypto";
import { mkdir, open, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * rename 覆盖目标时可重试的错误码。
 *
 * Windows 上目标文件正被另一个句柄打开（并发的 readFile、杀毒或索引服务扫描）时，
 * MoveFileEx 覆盖会失败成 EPERM / EACCES / EBUSY；句柄一释放就能成功。
 * 隔离实测：两路循环 readFile 的同时 writeFileAtomic 400 次，279 次 EPERM。
 * 其余错误码（ENOENT、ENOSPC……）重试也不会好，直接抛出。
 */
export const ATOMIC_RENAME_RETRYABLE_CODES: ReadonlySet<string> = new Set(["EPERM", "EACCES", "EBUSY"]);

/** 第一次失败后最多再重试的次数。 */
export const ATOMIC_RENAME_MAX_RETRIES = 8;
/** 第 n 次重试前等待 n × 该值毫秒：10, 20, … 80，累计 360ms。 */
export const ATOMIC_RENAME_RETRY_STEP_MS = 10;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 只对 rename 这一步做有限次退避重试；用尽后抛出最后一次的原始错误。 */
async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      if (attempt >= ATOMIC_RENAME_MAX_RETRIES || !code || !ATOMIC_RENAME_RETRYABLE_CODES.has(code)) throw error;
      await sleep((attempt + 1) * ATOMIC_RENAME_RETRY_STEP_MS);
    }
  }
}

/**
 * 原子写文本文件：先写同目录临时文件、fsync 落盘后再 rename 覆盖目标。
 *
 * 章节正文与章节索引都靠它保证「要么旧版、要么新版」：
 * 进程在写入中途崩溃或 rename 失败时，目标文件保持旧内容，不留下半截正文 / 半截索引。
 * 任何一步失败都会清理临时文件并把错误抛给调用方，由调用方决定如何向作者交代。
 *
 * rename 遇到 Windows 的瞬时占用（见 ATOMIC_RENAME_RETRYABLE_CODES）会短退避重试，
 * 重试用尽仍失败才抛出原始错误；与 novel-plugin 的同名实现保持同一套参数。
 *
 * 临时文件以 `.tmp` 结尾且带随机前缀：章节扫描（listChapterFiles）、
 * 档案导出（book-archive/registry.ts）与卷目录迁移都会跳过它，不会被当成新章节。
 */
export async function writeFileAtomic(path: string, content: string): Promise<void> {
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });
  const temporary = join(dir, `.${randomUUID()}.tmp`);
  try {
    const handle = await open(temporary, "w");
    try {
      await handle.writeFile(content, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await renameWithRetry(temporary, path);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}
