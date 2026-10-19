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
): Promise<{ applied: number; skipped: number; conflicted: number }> {
  const { getStorageDatabase } = await import("@vivy1024/novelfork-core/storage");
  const storage = getStorageDatabase();
  let applied = 0;
  let skipped = 0;
  let conflicted = 0;

  for (const change of changes) {
    // Find entry by title or alias
    const entry = storage.sqlite.prepare(
      "SELECT id, fields_json, COALESCE(version, 1) AS version FROM story_jingwei_entry WHERE book_id = ? AND deleted_at IS NULL AND (title = ? OR aliases_json LIKE ?)"
    ).get(bookId, change.entityName, `%${change.entityName}%`) as { id: string; fields_json: string; version: number } | undefined;

    if (!entry) {
      skipped++;
      continue;
    }

    // Update fields_json if fieldKey provided
    if (change.fieldKey && change.newValue) {
      try {
        const fields = JSON.parse(entry.fields_json || "{}");
        fields[change.fieldKey] = change.newValue;
        const columns = new Set((storage.sqlite.prepare(`PRAGMA table_info('story_jingwei_entry')`).all() as Array<{ name: string }>).map((row) => row.name));
        const setClauses = ["fields_json = ?"];
        const values: unknown[] = [JSON.stringify(fields)];
        if (columns.has("updated_at")) {
          setClauses.push("updated_at = ?");
          values.push(Date.now());
        }
        if (columns.has("entry_key")) setClauses.push("entry_key = COALESCE(entry_key, id)");
        if (columns.has("source_refs_json")) setClauses.push("source_refs_json = COALESCE(source_refs_json, '[]')");
        values.push(entry.id);
        // T-24：机器只在自己读到的那一版上写。作者在这中间手改保存过就一行都不写，
        // 冲突记进待处理队列由作者核对，机器这一版不落库。
        if (columns.has("version")) {
          setClauses.push("version = COALESCE(version, 1) + 1");
          const result = storage.sqlite.prepare(
            `UPDATE story_jingwei_entry SET ${setClauses.join(", ")} WHERE id = ? AND COALESCE(version, 1) = ?`
          ).run(...values, entry.version);
          if (result.changes === 0) {
            const { recordLedgerConflict } = await import("../ledger-conflict-store.js");
            const now = storage.sqlite.prepare(
              `SELECT COALESCE(version, 1) AS version, category FROM story_jingwei_entry WHERE id = ? AND book_id = ?`
            ).get(entry.id, bookId) as { version: number; category: string } | undefined;
            recordLedgerConflict(storage, bookId, {
              reason: `第${chapterNumber}章章后变化抽取`,
              info: {
                kind: "version-mismatch",
                entryId: entry.id,
                category: String(now?.category ?? ""),
                title: change.entityName,
                expectedVersion: entry.version,
                currentVersion: now?.version ?? entry.version,
                changedBy: "auto-update",
                changedFields: [change.fieldKey],
              },
            });
            conflicted++;
            continue;
          }
        } else {
          storage.sqlite.prepare(`UPDATE story_jingwei_entry SET ${setClauses.join(", ")} WHERE id = ?`).run(...values);
        }

        // 演变台账（可在经纬条目页回看「谁把什么字段从什么推进到什么」）。
        // 位置在版本校验**之后**：冲突时这次推进并没有发生，先落台账会让作者看到一次
        // 从未生效的推进，而且与刚记下的冲突互相矛盾（B4）。
        // book_id 是 NOT NULL（见 0012 迁移与 lore-story-progress 的建表），原先漏了它，
        // 这条 INSERT 在真实库上必然抛 NOT NULL，整个函数跟着失败。
        // id 用随机值：原先的 `prog-${Date.now()}-${applied}` 里 applied 只在成功末尾 +1，
        // 同一批里连续两条被跳过/冲突的变化会算出同一个 id。
        storage.sqlite.prepare(
          "INSERT INTO jingwei_progressions (id, book_id, entry_id, field_key, old_value, new_value, chapter_number, description, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ).run(
          `prog-${crypto.randomUUID()}`,
          bookId,
          entry.id,
          change.fieldKey,
          change.oldValue ?? "",
          change.newValue,
          chapterNumber,
          change.description,
          Date.now(),
        );
      } catch { /* ignore parse errors */ }
    }

    applied++;
  }

  return { applied, skipped, conflicted };
}
