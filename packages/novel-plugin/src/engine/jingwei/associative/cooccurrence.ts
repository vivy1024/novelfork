/**
 * Tag co-occurrence matrix — tracks which entities appear together in chapters.
 * Used for associative retrieval (finding "weakly related but useful" entries).
 */

export interface CooccurrenceEdge {
  tagA: string;
  tagB: string;
  count: number;
  lastChapter: number;
}

/**
 * Extract entity names from chapter text using jingwei entries as dictionary.
 */
export async function extractChapterEntities(bookId: string, chapterText: string): Promise<string[]> {
  const { getStorageDatabase } = await import("@vivy1024/novelfork-core/storage");
  const storage = getStorageDatabase();

  // Get all entry names + aliases for this book
  const entries = storage.sqlite.prepare(
    "SELECT title, aliases_json FROM story_jingwei_entry WHERE book_id = ? AND deleted_at IS NULL"
  ).all(bookId) as Array<{ title: string; aliases_json: string }>;

  const found: string[] = [];
  for (const entry of entries) {
    if (chapterText.includes(entry.title)) {
      found.push(entry.title);
    }
    // Check aliases
    try {
      const aliases = JSON.parse(entry.aliases_json || "[]") as string[];
      for (const alias of aliases) {
        if (alias && chapterText.includes(alias) && !found.includes(entry.title)) {
          found.push(entry.title);
          break;
        }
      }
    } catch { /* ignore parse errors */ }
  }

  return found;
}

/**
 * Update co-occurrence matrix after a chapter is written.
 * Every pair of entities that appear in the same chapter gets +1 co-occurrence.
 */
export async function updateCooccurrence(bookId: string, chapterNumber: number, entities: string[]): Promise<number> {
  if (entities.length < 2) return 0;

  const { getStorageDatabase } = await import("@vivy1024/novelfork-core/storage");
  const storage = getStorageDatabase();
  let updated = 0;

  // Generate all pairs
  for (let i = 0; i < entities.length; i++) {
    for (let j = i + 1; j < entities.length; j++) {
      const [tagA, tagB] = [entities[i], entities[j]].sort(); // canonical order

      const existing = storage.sqlite.prepare(
        "SELECT count FROM jingwei_cooccurrence WHERE book_id = ? AND tag_a = ? AND tag_b = ?"
      ).get(bookId, tagA, tagB) as { count: number } | undefined;

      if (existing) {
        storage.sqlite.prepare(
          "UPDATE jingwei_cooccurrence SET count = count + 1, last_chapter = ? WHERE book_id = ? AND tag_a = ? AND tag_b = ?"
        ).run(chapterNumber, bookId, tagA, tagB);
      } else {
        storage.sqlite.prepare(
          "INSERT INTO jingwei_cooccurrence (book_id, tag_a, tag_b, count, last_chapter) VALUES (?, ?, ?, 1, ?)"
        ).run(bookId, tagA, tagB, chapterNumber);
      }
      updated++;
    }
  }

  return updated;
}
