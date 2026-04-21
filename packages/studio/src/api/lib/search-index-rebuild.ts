import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { globalSearchIndex } from "./search-index.js";

function parseChapterFileName(fileName: string): { readonly number: number; readonly title?: string } | null {
  const match = fileName.match(/^(\d+)(?:[_-](.+))?\.md$/i);
  if (!match) return null;

  const number = Number.parseInt(match[1]!, 10);
  if (!Number.isFinite(number)) return null;

  const rawTitle = match[2]?.replace(/_/g, " ").trim();
  return {
    number,
    ...(rawTitle ? { title: rawTitle } : {}),
  };
}

export interface SearchIndexRebuildState {
  listBooks(): Promise<ReadonlyArray<string>>;
  bookDir(bookId: string): string;
  loadChapterIndex(bookId: string): Promise<ReadonlyArray<{ readonly number: number; readonly title?: string }>>;
}

export interface SearchIndexRebuildSummary {
  readonly bookCount: number;
  readonly indexedDocuments: number;
  readonly skippedBooks: number;
}

const truthFiles = [
  "story_bible.md",
  "volume_outline.md",
  "current_state.md",
  "character_matrix.md",
  "style_guide.md",
] as const;

export async function rebuildSearchIndex(state: SearchIndexRebuildState): Promise<SearchIndexRebuildSummary> {
  globalSearchIndex.clear();

  const bookIds = await state.listBooks();
  let indexedDocuments = 0;
  let skippedBooks = 0;

  for (const bookId of bookIds) {
    try {
      indexedDocuments += await indexBookSearchDocuments(state, bookId);
    } catch {
      skippedBooks += 1;
    }
  }

  return {
    bookCount: bookIds.length,
    indexedDocuments,
    skippedBooks,
  };
}

async function indexBookSearchDocuments(state: SearchIndexRebuildState, bookId: string): Promise<number> {
  const bookDir = state.bookDir(bookId);
  const chaptersDir = join(bookDir, "chapters");
  const storyDir = join(bookDir, "story");
  const indexedAt = Date.now();
  let indexed = 0;
  const indexedChapterNumbers = new Set<number>();

  const [chapters, chapterFiles] = await Promise.all([
    state.loadChapterIndex(bookId),
    readdir(chaptersDir).catch(() => [] as string[]),
  ]);

  for (const chapter of chapters) {
    const paddedNumber = String(chapter.number).padStart(4, "0");
    const match = chapterFiles.find((file) =>
      file.startsWith(`${paddedNumber}_`) || file.startsWith(`${paddedNumber}-`),
    );
    if (!match) continue;

    const content = await readFile(join(chaptersDir, match), "utf-8").catch(() => "");
    globalSearchIndex.index({
      id: `chapter:${bookId}:${chapter.number}`,
      type: "chapter",
      title: chapter.title || `Chapter ${chapter.number}`,
      content,
      bookId,
      timestamp: indexedAt,
      metadata: { chapterNumber: chapter.number },
    });
    indexedChapterNumbers.add(chapter.number);
    indexed += 1;
  }

  // Recovery path: if chapters/index.json is missing or stale, still index
  // the markdown chapter files we can actually see on disk.
  for (const fileName of chapterFiles) {
    const chapter = parseChapterFileName(fileName);
    if (!chapter || indexedChapterNumbers.has(chapter.number)) continue;

    const content = await readFile(join(chaptersDir, fileName), "utf-8").catch(() => "");
    globalSearchIndex.index({
      id: `chapter:${bookId}:${chapter.number}`,
      type: "chapter",
      title: chapter.title || `Chapter ${chapter.number}`,
      content,
      bookId,
      timestamp: indexedAt,
      metadata: { chapterNumber: chapter.number },
    });
    indexedChapterNumbers.add(chapter.number);
    indexed += 1;
  }

  for (const fileName of truthFiles) {
    try {
      const content = await readFile(join(storyDir, fileName), "utf-8");
      globalSearchIndex.index({
        id: `setting:${bookId}:${fileName}`,
        type: "setting",
        title: fileName.replace(".md", "").replace(/_/g, " "),
        content,
        bookId,
        timestamp: indexedAt,
        metadata: { fileName },
      });
      indexed += 1;
    } catch {
      // Skip missing truth files.
    }
  }

  return indexed;
}
