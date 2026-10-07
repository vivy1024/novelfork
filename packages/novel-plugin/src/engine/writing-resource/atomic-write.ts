import { randomUUID } from "node:crypto";
import { mkdir, open, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * 原子写文本文件：先写同目录临时文件、fsync 落盘后再 rename 覆盖目标。
 * 进程在写入中途崩溃时，目标文件只会是旧版本或新版本，不留下半截正文 / 半截索引；
 * 任何一步失败都会清理临时文件并把错误抛给调用方。
 * 临时文件以 .tmp 结尾，章节扫描与档案导出（registry.ts）都会跳过它。
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
