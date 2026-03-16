import { Command } from "commander";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { PipelineRunner, StateManager, type BookConfig } from "@actalk/inkos-core";
import { loadConfig, buildPipelineConfig, findProjectRoot, resolveContext, resolveBookId, log, logError } from "../utils.js";

export const bookCommand = new Command("book")
  .description("Manage books");

bookCommand
  .command("create")
  .description("Create a new book with AI-generated foundation")
  .requiredOption("--title <title>", "Book title")
  .option("--genre <genre>", "Genre", "xuanhuan")
  .option("--platform <platform>", "Target platform", "tomato")
  .option("--target-chapters <n>", "Target chapter count", "200")
  .option("--chapter-words <n>", "Words per chapter", "3000")
  .option("--context <text>", "External context / instructions (natural language)")
  .option("--context-file <path>", "Read external context from file")
  .option("--json", "Output JSON")
  .action(async (opts) => {
    try {
      const config = await loadConfig();
      const root = findProjectRoot();

      const bookId = opts.title
        .toLowerCase()
        .replace(/[^a-z0-9\u4e00-\u9fff]/g, "-")
        .replace(/-+/g, "-")
        .slice(0, 30);

      const now = new Date().toISOString();
      const book: BookConfig = {
        id: bookId,
        title: opts.title,
        platform: opts.platform,
        genre: opts.genre,
        status: "outlining",
        targetChapters: parseInt(opts.targetChapters, 10),
        chapterWordCount: parseInt(opts.chapterWords, 10),
        createdAt: now,
        updatedAt: now,
      };

      const bookDir = join(root, "books", bookId);
      try {
        await access(bookDir);
        throw new Error(`Book "${bookId}" already exists at books/${bookId}/. Use a different title or delete the existing book first.`);
      } catch (e) {
        if (e instanceof Error && e.message.includes("already exists")) throw e;
        // Directory doesn't exist, good
      }

      if (!opts.json) log(`Creating book "${book.title}" (${book.genre} / ${book.platform})...`);

      const context = await resolveContext(opts);

      const pipeline = new PipelineRunner(buildPipelineConfig(config, root, { externalContext: context }));

      await pipeline.initBook(book);

      if (opts.json) {
        log(JSON.stringify({
          bookId,
          title: book.title,
          genre: book.genre,
          platform: book.platform,
          location: `books/${bookId}/`,
          nextStep: `inkos write next ${bookId}`,
        }, null, 2));
      } else {
        log(`Book created: ${bookId}`);
        log(`  Location: books/${bookId}/`);
        log(`  Story bible, outline, book rules generated.`);
        log("");
        log(`Next: inkos write next ${bookId}`);
      }
    } catch (e) {
      if (opts.json) {
        log(JSON.stringify({ error: String(e) }));
      } else {
        logError(`Failed to create book: ${e}`);
      }
      process.exit(1);
    }
  });

bookCommand
  .command("update")
  .description("Update book settings")
  .argument("[book-id]", "Book ID (auto-detected if only one book)")
  .option("--chapter-words <n>", "Words per chapter")
  .option("--target-chapters <n>", "Target chapter count")
  .option("--status <status>", "Book status (outlining/active/paused/completed)")
  .option("--json", "Output JSON")
  .action(async (bookIdArg: string | undefined, opts) => {
    try {
      const root = findProjectRoot();
      const bookId = await resolveBookId(bookIdArg, root);
      const state = new StateManager(root);
      const book = await state.loadBookConfig(bookId);

      const updates: Record<string, unknown> = {};
      if (opts.chapterWords) updates.chapterWordCount = parseInt(opts.chapterWords, 10);
      if (opts.targetChapters) updates.targetChapters = parseInt(opts.targetChapters, 10);
      if (opts.status) updates.status = opts.status;

      if (Object.keys(updates).length === 0) {
        if (opts.json) {
          log(JSON.stringify(book, null, 2));
        } else {
          log(`Book: ${book.title} (${bookId})`);
          log(`  Words/chapter: ${book.chapterWordCount}`);
          log(`  Target chapters: ${book.targetChapters}`);
          log(`  Status: ${book.status}`);
          log(`  Genre: ${book.genre} | Platform: ${book.platform}`);
        }
        return;
      }

      const updated: BookConfig = {
        ...book,
        ...updates,
        updatedAt: new Date().toISOString(),
      };
      await state.saveBookConfig(bookId, updated);

      if (opts.json) {
        log(JSON.stringify(updated, null, 2));
      } else {
        for (const [key, value] of Object.entries(updates)) {
          log(`  ${key}: ${(book as Record<string, unknown>)[key]} → ${value}`);
        }
      }
    } catch (e) {
      if (opts.json) {
        log(JSON.stringify({ error: String(e) }));
      } else {
        logError(`Failed to update book: ${e}`);
      }
      process.exit(1);
    }
  });

bookCommand
  .command("list")
  .description("List all books")
  .option("--json", "Output JSON")
  .action(async (opts) => {
    try {
      const root = findProjectRoot();
      const state = new StateManager(root);
      const bookIds = await state.listBooks();

      if (bookIds.length === 0) {
        if (opts.json) {
          log(JSON.stringify({ books: [] }));
        } else {
          log("No books found. Create one with: inkos book create --title '...'");
        }
        return;
      }

      const books = [];
      for (const id of bookIds) {
        const book = await state.loadBookConfig(id);
        const nextChapter = await state.getNextChapterNumber(id);
        const info = {
          id,
          title: book.title,
          genre: book.genre,
          platform: book.platform,
          status: book.status,
          chapters: nextChapter - 1,
        };
        books.push(info);
        if (!opts.json) {
          log(`  ${id} | ${book.title} | ${book.genre}/${book.platform} | ${book.status} | chapters: ${nextChapter - 1}`);
        }
      }

      if (opts.json) {
        log(JSON.stringify({ books }, null, 2));
      }
    } catch (e) {
      if (opts.json) {
        log(JSON.stringify({ error: String(e) }));
      } else {
        logError(`Failed to list books: ${e}`);
      }
      process.exit(1);
    }
  });
