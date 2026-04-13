/**
 * Auto Backup Plugin
 *
 * Automatically backs up chapters after completion.
 */

import { InkOSPlugin } from "@actalk/inkos-core/plugins";
import type {
  PluginManifest,
  PluginTool,
  PluginHook,
} from "@actalk/inkos-core/plugins";
import { writeFile, mkdir, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";

export default class AutoBackupPlugin extends InkOSPlugin {
  getManifest(): PluginManifest {
    return {
      name: "auto-backup",
      displayName: "Auto Backup",
      version: "1.0.0",
      description: "Automatically backup chapters after completion",
      author: "InkOS Team",
      tools: ["backup_chapter"],
      hooks: ["chapter-complete"],
    };
  }

  getTools(): PluginTool[] {
    return [
      {
        definition: {
          name: "backup_chapter",
          description: "Manually backup a chapter",
          parameters: [
            {
              name: "bookId",
              type: "string",
              description: "Book ID",
              required: true,
            },
            {
              name: "chapterNumber",
              type: "number",
              description: "Chapter number",
              required: true,
            },
          ],
          source: "plugin",
        },
        handler: async (args: Record<string, unknown>) => {
          const { bookId, chapterNumber } = args;
          this.ctx.logger.info(`Backing up chapter ${chapterNumber} of book ${bookId}`);

          try {
            await this.backupChapter(bookId as string, chapterNumber as number);
            return JSON.stringify({ success: true, message: "Backup created" });
          } catch (e) {
            return JSON.stringify({
              success: false,
              error: e instanceof Error ? e.message : String(e),
            });
          }
        },
      },
    ];
  }

  getHooks(): PluginHook[] {
    return [
      {
        stage: "chapter-complete",
        handler: async (ctx) => {
          const { book, chapterNumber } = ctx;
          this.ctx.logger.info(`Auto-backing up chapter ${chapterNumber} of ${book.title}`);

          try {
            await this.backupChapter(book.id, chapterNumber);
          } catch (e) {
            this.ctx.logger.error(`Failed to backup chapter: ${e}`);
          }
        },
      },
    ];
  }

  private async backupChapter(bookId: string, chapterNumber: number): Promise<void> {
    const backupDir = (this.ctx.config.backupDir as string) || "./backups";
    const maxBackups = (this.ctx.config.maxBackups as number) || 5;

    // Create backup directory
    const bookBackupDir = join(backupDir, bookId);
    await mkdir(bookBackupDir, { recursive: true });

    // Generate backup filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupFile = join(bookBackupDir, `chapter-${chapterNumber}-${timestamp}.json`);

    // Read chapter content (placeholder - would need actual chapter data)
    const chapterData = {
      bookId,
      chapterNumber,
      timestamp: new Date().toISOString(),
      content: "Chapter content would be here",
    };

    // Write backup
    await writeFile(backupFile, JSON.stringify(chapterData, null, 2), "utf-8");
    this.ctx.logger.info(`Backup created: ${backupFile}`);

    // Cleanup old backups
    await this.cleanupOldBackups(bookBackupDir, chapterNumber, maxBackups);
  }

  private async cleanupOldBackups(
    backupDir: string,
    chapterNumber: number,
    maxBackups: number
  ): Promise<void> {
    try {
      const files = await readdir(backupDir);
      const chapterBackups = files
        .filter((f) => f.startsWith(`chapter-${chapterNumber}-`))
        .sort()
        .reverse();

      // Remove old backups
      if (chapterBackups.length > maxBackups) {
        const toDelete = chapterBackups.slice(maxBackups);
        for (const file of toDelete) {
          await unlink(join(backupDir, file));
          this.ctx.logger.info(`Deleted old backup: ${file}`);
        }
      }
    } catch (e) {
      this.ctx.logger.error(`Failed to cleanup old backups: ${e}`);
    }
  }

  validateConfig(config: Record<string, unknown>): boolean {
    if (config.maxBackups && typeof config.maxBackups !== "number") {
      return false;
    }
    if (config.backupDir && typeof config.backupDir !== "string") {
      return false;
    }
    return true;
  }
}
