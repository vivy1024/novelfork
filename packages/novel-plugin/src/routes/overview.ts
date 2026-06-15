import { Hono } from "hono";
import { getStorageDatabase } from "@vivy1024/novelfork-core";

interface OverviewStats {
  volumeProgress: { current: number; total: number; percent: number };
  foreshadowing: { planted: number; revealed: number; recovered: number; abandoned: number; recoveryRate: number };
  activePlotLines: number;
  wordCount: { today: number; total: number };
  chapterCount: number;
}

interface SectionRow {
  id: string;
  key: string;
}

interface StatusCountRow {
  status: string | null;
  count: number;
}

interface CountRow {
  count: number;
  totalWords: number;
}

interface TodayWordsRow {
  todayWords: number;
}


export function createOverviewRouter(): Hono {
  const app = new Hono();

  app.get("/api/books/:id/overview-stats", async (c) => {
    const bookId = c.req.param("id");
    const storage = getStorageDatabase();

    // 1. Get all sections for this book
    const sections = storage.sqlite.prepare(
      `SELECT id, key FROM story_jingwei_section WHERE book_id = ? AND deleted_at IS NULL`
    ).all(bookId) as SectionRow[];

    const sectionsByKey = new Map<string, string[]>();
    for (const s of sections) {
      const existing = sectionsByKey.get(s.key) ?? [];
      existing.push(s.id);
      sectionsByKey.set(s.key, existing);
    }

    // Helper: get section IDs matching any of the given keys
    function getSectionIds(...keys: string[]): string[] {
      const ids: string[] = [];
      for (const key of keys) {
        const matched = sectionsByKey.get(key);
        if (matched) ids.push(...matched);
      }
      return ids;
    }

    // 2. Foreshadowing stats
    const foreshadowingSectionIds = getSectionIds("foreshadowing");
    const foreshadowing = { planted: 0, revealed: 0, recovered: 0, abandoned: 0, recoveryRate: 0 };

    if (foreshadowingSectionIds.length > 0) {
      const placeholders = foreshadowingSectionIds.map(() => "?").join(",");
      const rows = storage.sqlite.prepare(
        `SELECT json_extract(custom_fields_json, '$.status') as status, COUNT(*) as count
         FROM story_jingwei_entry
         WHERE book_id = ? AND deleted_at IS NULL
           AND section_id IN (${placeholders})
         GROUP BY json_extract(custom_fields_json, '$.status')`
      ).all(bookId, ...foreshadowingSectionIds) as StatusCountRow[];

      for (const row of rows) {
        const status = (row.status ?? "").toLowerCase();
        if (status === "planted" || status === "埋设") foreshadowing.planted += row.count;
        else if (status === "revealed" || status === "揭示") foreshadowing.revealed += row.count;
        else if (status === "recovered" || status === "回收") foreshadowing.recovered += row.count;
        else if (status === "abandoned" || status === "废弃") foreshadowing.abandoned += row.count;
        else foreshadowing.planted += row.count; // default: treat as planted
      }

      const total = foreshadowing.planted + foreshadowing.revealed + foreshadowing.recovered + foreshadowing.abandoned;
      foreshadowing.recoveryRate = total > 0
        ? Math.round(((foreshadowing.recovered + foreshadowing.revealed) / total) * 100)
        : 0;
    }

    // 3. Active plot lines (status = "进行中")
    const plotSectionIds = getSectionIds("conflicts", "plot", "plot-lines");
    let activePlotLines = 0;

    if (plotSectionIds.length > 0) {
      const placeholders = plotSectionIds.map(() => "?").join(",");
      const row = storage.sqlite.prepare(
        `SELECT COUNT(*) as count FROM story_jingwei_entry
         WHERE book_id = ? AND deleted_at IS NULL
           AND section_id IN (${placeholders})
           AND json_extract(custom_fields_json, '$.status') = '进行中'`
      ).all(bookId, ...plotSectionIds) as CountRow[];
      activePlotLines = row[0]?.count ?? 0;
    }

    // 4. Chapter count + word count
    const chapterSectionIds = getSectionIds("chapter-summaries", "chapters");
    let chapterCount = 0;
    let totalWords = 0;
    let todayWords = 0;

    if (chapterSectionIds.length > 0) {
      const placeholders = chapterSectionIds.map(() => "?").join(",");
      const row = storage.sqlite.prepare(
        `SELECT COUNT(*) as count, COALESCE(SUM(CAST(json_extract(custom_fields_json, '$.wordCount') AS INTEGER)), 0) as totalWords
         FROM story_jingwei_entry
         WHERE book_id = ? AND deleted_at IS NULL
           AND section_id IN (${placeholders})`
      ).all(bookId, ...chapterSectionIds) as CountRow[];
      chapterCount = row[0]?.count ?? 0;
      totalWords = row[0]?.totalWords ?? 0;

      // Today's words: entries updated today
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayStartMs = todayStart.getTime();

      const todayRow = storage.sqlite.prepare(
        `SELECT COALESCE(SUM(CAST(json_extract(custom_fields_json, '$.wordCount') AS INTEGER)), 0) as todayWords
         FROM story_jingwei_entry
         WHERE book_id = ? AND deleted_at IS NULL
           AND section_id IN (${placeholders})
           AND updated_at >= ?`
      ).all(bookId, ...chapterSectionIds, todayStartMs) as TodayWordsRow[];
      todayWords = todayRow[0]?.todayWords ?? 0;
    }

    // 5. Volume progress from outline
    const outlineSectionIds = getSectionIds("outline", "volume-outline");
    let volumeProgress = { current: chapterCount, total: 0, percent: 0 };

    if (outlineSectionIds.length > 0) {
      const placeholders = outlineSectionIds.map(() => "?").join(",");
      // Count total planned entries in outline as target chapter count
      const row = storage.sqlite.prepare(
        `SELECT COUNT(*) as count FROM story_jingwei_entry
         WHERE book_id = ? AND deleted_at IS NULL
           AND section_id IN (${placeholders})`
      ).all(bookId, ...outlineSectionIds) as CountRow[];
      const totalPlanned = row[0]?.count ?? 0;
      volumeProgress = {
        current: chapterCount,
        total: totalPlanned,
        percent: totalPlanned > 0 ? Math.round((chapterCount / totalPlanned) * 100) : 0,
      };
    }

    const stats: OverviewStats = {
      volumeProgress,
      foreshadowing,
      activePlotLines,
      wordCount: { today: todayWords, total: totalWords },
      chapterCount,
    };

    return c.json(stats);
  });

  return app;
}
