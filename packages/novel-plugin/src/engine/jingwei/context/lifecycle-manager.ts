/**
 * Auto-downgrade character lifecycle based on last appearance.
 * Called periodically or after each chapter.
 */
export async function updateCharacterLifecycles(bookId: string, currentChapter: number): Promise<{ downgraded: number }> {
  const { getStorageDatabase } = await import("@vivy1024/novelfork-core/storage");
  const storage = getStorageDatabase();

  // Get all active/recurring characters with their last appearance chapter
  const characters = storage.sqlite.prepare(
    `SELECT e.id, e.lifecycle, MAX(cs.chapter_number) as last_appearance
     FROM story_jingwei_entry e
     LEFT JOIN bible_chapter_summary cs ON cs.book_id = e.book_id
       AND cs.appearing_character_ids_json LIKE '%' || e.id || '%'
     WHERE e.book_id = ? AND e.category = 'character' AND e.lifecycle IN ('active', 'recurring') AND e.deleted_at IS NULL
     GROUP BY e.id`
  ).all(bookId) as Array<{ id: string; lifecycle: string; last_appearance: number | null }>;

  let downgraded = 0;
  for (const char of characters) {
    const gap = currentChapter - (char.last_appearance ?? 0);
    let newLifecycle = char.lifecycle;

    if (gap >= 100 && char.lifecycle !== "retired") {
      newLifecycle = "retired";
    } else if (gap >= 50 && char.lifecycle === "active") {
      newLifecycle = "dormant";
    }

    if (newLifecycle !== char.lifecycle) {
      storage.sqlite.prepare("UPDATE story_jingwei_entry SET lifecycle = ? WHERE id = ?").run(newLifecycle, char.id);
      downgraded++;
    }
  }

  return { downgraded };
}
