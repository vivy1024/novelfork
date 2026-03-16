import { Command } from "commander";
import { StateManager } from "@actalk/inkos-core";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { findProjectRoot, resolveBookId, log, logError } from "../utils.js";

export const exportCommand = new Command("export")
  .description("Export book chapters to a single file")
  .argument("[book-id]", "Book ID (auto-detected if only one book)")
  .option("--format <format>", "Output format (txt, md)", "txt")
  .option("--output <path>", "Output file path")
  .option("--approved-only", "Only export approved chapters")
  .option("--json", "Output JSON metadata")
  .action(async (bookIdArg: string | undefined, opts) => {
    try {
      const root = findProjectRoot();
      const bookId = await resolveBookId(bookIdArg, root);
      const state = new StateManager(root);

      const book = await state.loadBookConfig(bookId);
      const index = await state.loadChapterIndex(bookId);
      const bookDir = state.bookDir(bookId);
      const chaptersDir = join(bookDir, "chapters");

      const chapters = opts.approvedOnly
        ? index.filter((ch) => ch.status === "approved")
        : index;

      if (chapters.length === 0) {
        throw new Error("No chapters to export.");
      }

      const parts: string[] = [];

      if (opts.format === "md") {
        parts.push(`# ${book.title}\n`);
        parts.push(`---\n`);
      } else {
        parts.push(`${book.title}\n\n`);
      }

      for (const ch of chapters) {
        const paddedNum = String(ch.number).padStart(4, "0");
        const files = await readdir(chaptersDir);
        const match = files.find((f) => f.startsWith(paddedNum));
        if (!match) continue;

        const content = await readFile(join(chaptersDir, match), "utf-8");
        parts.push(content);
        parts.push("\n\n");
      }

      const totalWords = chapters.reduce((sum, ch) => sum + ch.wordCount, 0);

      const outputPath =
        opts.output ?? join(root, `${bookId}_export.${opts.format}`);
      await writeFile(outputPath, parts.join("\n"), "utf-8");

      if (opts.json) {
        log(JSON.stringify({
          bookId,
          chaptersExported: chapters.length,
          totalWords,
          format: opts.format,
          outputPath,
        }, null, 2));
      } else {
        log(`Exported ${chapters.length} chapters (${totalWords} words)`);
        log(`Output: ${outputPath}`);
      }
    } catch (e) {
      if (opts.json) {
        log(JSON.stringify({ error: String(e) }));
      } else {
        logError(`Failed to export: ${e}`);
      }
      process.exit(1);
    }
  });
