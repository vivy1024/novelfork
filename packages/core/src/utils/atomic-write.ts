import { randomUUID } from "node:crypto";
import { mkdir, open, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * 原子写文本文件：先写同目录临时文件、fsync 落盘后再 rename 覆盖目标。
 *
 * 章节正文与章节索引都靠它保证「要么旧版、要么新版」：
 * 进程在写入中途崩溃或 rename 失败时，目标文件保持旧内容，不留下半截正文 / 半截索引。
 * 任何一步失败都会清理临时文件并把错误抛给调用方，由调用方决定如何向作者交代。
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
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}
