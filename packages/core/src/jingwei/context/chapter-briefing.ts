/**
 * Generate a structured briefing for the AI before writing a chapter.
 * This is injected into the system prompt.
 */
export async function buildChapterBriefing(bookId: string, chapterNumber: number): Promise<string> {
  const { getStorageDatabase } = await import("../../storage/db.js");
  const storage = getStorageDatabase();

  const sections: string[] = [];

  // 1. Active characters (lifecycle = 'active')
  const activeChars = storage.sqlite.prepare(
    `SELECT title, fields_json FROM story_jingwei_entry
     WHERE book_id = ? AND category = 'character' AND lifecycle = 'active' AND deleted_at IS NULL
     ORDER BY sort_order LIMIT 10`
  ).all(bookId) as Array<{ title: string; fields_json: string }>;

  if (activeChars.length > 0) {
    const charLines = activeChars.map(c => {
      const fields = JSON.parse(c.fields_json || "{}");
      return `- ${c.title}：${fields.realm || ""}${fields.goal ? "，目标：" + fields.goal : ""}`;
    });
    sections.push(`【活跃角色】\n${charLines.join("\n")}`);
  }

  // 2. Overdue causal chains
  const overdueChains = storage.sqlite.prepare(
    `SELECT trigger_event, trigger_chapter, urgency FROM jingwei_causal_chains
     WHERE book_id = ? AND status IN ('open', 'progressing') AND urgency IN ('high', 'overdue')
     ORDER BY trigger_chapter LIMIT 5`
  ).all(bookId) as Array<{ trigger_event: string; trigger_chapter: number; urgency: string }>;

  if (overdueChains.length > 0) {
    const chainLines = overdueChains.map(c =>
      `- ${c.urgency === "overdue" ? "\u26a0\ufe0f" : "\u26a1"} ${c.trigger_event}（第${c.trigger_chapter}章埋设，已${chapterNumber - c.trigger_chapter}章未推进）`
    );
    sections.push(`【未解决事项】\n${chainLines.join("\n")}`);
  }

  // 3. Active foreshadowing
  const foreshadows = storage.sqlite.prepare(
    `SELECT title, fields_json FROM story_jingwei_entry
     WHERE book_id = ? AND category = 'foreshadowing' AND lifecycle = 'active' AND deleted_at IS NULL
     ORDER BY sort_order LIMIT 5`
  ).all(bookId) as Array<{ title: string; fields_json: string }>;

  if (foreshadows.length > 0) {
    const fLines = foreshadows.map(f => {
      const fields = JSON.parse(f.fields_json || "{}");
      return `- ${f.title}${fields.status ? "（" + fields.status + "）" : ""}`;
    });
    sections.push(`【活跃伏笔】\n${fLines.join("\n")}`);
  }

  // 4. Hard constraints (global visibility)
  const constraints = storage.sqlite.prepare(
    `SELECT title, content_md FROM story_jingwei_entry
     WHERE book_id = ? AND category IN ('worldview', 'special', 'power-system')
     AND visibility_rule_json LIKE '%global%' AND deleted_at IS NULL
     LIMIT 5`
  ).all(bookId) as Array<{ title: string; content_md: string }>;

  if (constraints.length > 0) {
    const cLines = constraints.map(c => `- ${c.title}：${(c.content_md || "").slice(0, 80)}`);
    sections.push(`【硬约束】\n${cLines.join("\n")}`);
  }

  if (sections.length === 0) return "";
  return `\u2550\u2550\u2550 第${chapterNumber}章写作 Briefing \u2550\u2550\u2550\n\n${sections.join("\n\n")}`;
}
