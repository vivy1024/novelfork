/**
 * After a chapter is written, extract changes and update jingwei entries.
 * This is called as a post-write hook in the pipeline.
 */
export interface ChapterChange {
  type: "realm_change" | "new_entity" | "relation_change" | "foreshadow_progress" | "location_move";
  entityName: string;
  fieldKey?: string;
  oldValue?: string;
  newValue?: string;
  description: string;
}

/**
 * Build a prompt to extract changes from a newly written chapter.
 */
export function buildChangeExtractionPrompt(chapterContent: string, currentJingwei: string): string {
  return `分析以下新写的章节内容，对比当前经纬资料，提取所有变化。

当前经纬资料：
${currentJingwei}

新章节内容：
${chapterContent}

请以 JSON 数组格式输出变化列表，每个变化包含：
- type: "realm_change" | "new_entity" | "relation_change" | "foreshadow_progress" | "location_move"
- entityName: 涉及的实体名称
- fieldKey: 变化的字段（如 "realm", "location"）
- oldValue: 旧值（如果有）
- newValue: 新值
- description: 变化描述

只输出 JSON 数组，不要其他文字。如果没有变化，输出空数组 []。`;
}

/**
 * Apply extracted changes to jingwei entries.
 * Creates progressions and updates fields.
 */
export async function applyChapterChanges(
  bookId: string,
  chapterNumber: number,
  changes: ChapterChange[],
): Promise<{ applied: number; skipped: number }> {
  const { getStorageDatabase } = await import("@vivy1024/novelfork-core/storage");
  const storage = getStorageDatabase();
  let applied = 0;
  let skipped = 0;

  for (const change of changes) {
    // Find entry by title or alias
    const entry = storage.sqlite.prepare(
      "SELECT id, fields_json FROM story_jingwei_entry WHERE book_id = ? AND deleted_at IS NULL AND (title = ? OR aliases_json LIKE ?)"
    ).get(bookId, change.entityName, `%${change.entityName}%`) as { id: string; fields_json: string } | undefined;

    if (!entry) {
      skipped++;
      continue;
    }

    // Create progression record
    const progId = `prog-${Date.now()}-${applied}`;
    storage.sqlite.prepare(
      "INSERT INTO jingwei_progressions (id, entry_id, field_key, old_value, new_value, chapter_number, description, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(progId, entry.id, change.fieldKey ?? change.type, change.oldValue ?? "", change.newValue ?? "", chapterNumber, change.description, Date.now());

    // Update fields_json if fieldKey provided
    if (change.fieldKey && change.newValue) {
      try {
        const fields = JSON.parse(entry.fields_json || "{}");
        fields[change.fieldKey] = change.newValue;
        storage.sqlite.prepare(
          "UPDATE story_jingwei_entry SET fields_json = ? WHERE id = ?"
        ).run(JSON.stringify(fields), entry.id);
      } catch { /* ignore parse errors */ }
    }

    applied++;
  }

  return { applied, skipped };
}
