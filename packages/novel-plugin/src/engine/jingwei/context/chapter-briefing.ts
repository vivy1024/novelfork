import { getJingweiCategoryAliases, sqlInPlaceholders } from "../category-compat.js";

/**
 * 从经纬条目 fields_json 解析结构化字段；损坏的 JSON 返回空对象（不抛出）。
 */
function parseEntryFields(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function readFieldString(fields: Record<string, unknown>, key: string): string {
  const value = fields[key];
  return typeof value === "string" ? value.trim() : "";
}

/** classic_quotes 只取第一句；兼容 string[] 与 "A, B" / "A\nB" 形态的字符串。 */
function readFirstQuote(fields: Record<string, unknown>): string {
  const raw = fields.classic_quotes;
  if (Array.isArray(raw)) {
    const first = raw.find((item): item is string => typeof item === "string" && item.trim().length > 0);
    return (first ?? "").trim();
  }
  if (typeof raw === "string" && raw.trim()) {
    return raw.split(/[,，\n]/u)[0]?.trim() ?? "";
  }
  return "";
}

/**
 * Generate a structured briefing for the AI before writing a chapter.
 * This is injected into the system prompt.
 */
export async function buildChapterBriefing(bookId: string, chapterNumber: number): Promise<string> {
  const { getStorageDatabase } = await import("@vivy1024/novelfork-core/storage");
  const storage = getStorageDatabase();

  const sections: string[] = [];

  // 1. Active characters (lifecycle = 'active')
  const characterCategories = getJingweiCategoryAliases("characters");
  const activeChars = storage.sqlite.prepare(
    `SELECT title, fields_json FROM story_jingwei_entry
     WHERE book_id = ?
       AND category IN (${sqlInPlaceholders(characterCategories)})
       AND lifecycle = 'active'
       AND deleted_at IS NULL
     ORDER BY sort_order LIMIT 10`
  ).all(bookId, ...characterCategories) as Array<{ title: string; fields_json: string }>;

  if (activeChars.length > 0) {
    const charLines = activeChars.map(c => {
      const fields = parseEntryFields(c.fields_json);
      // 角色内核输出：动机/恐惧/执念/信奉/性格/口头禅。空字段整段省略。
      const realm = readFieldString(fields, "realm");
      // goal 是旧字段：core_motive 缺失时才兜底，两者都有时只输出 core_motive。
      const motive = readFieldString(fields, "core_motive") || readFieldString(fields, "goal");
      const fear = readFieldString(fields, "core_fear");
      const obsession = readFieldString(fields, "core_obsession");
      const belief = readFieldString(fields, "core_belief");
      const personality = readFieldString(fields, "personality");
      const quote = readFirstQuote(fields);

      const nameWithRealm = realm ? `${c.title}（${realm}）` : c.title;
      const parts = [
        motive ? `动机: ${motive}` : "",
        fear ? `恐惧: ${fear}` : "",
        obsession ? `执念: ${obsession}` : "",
        belief ? `信奉: ${belief}` : "",
        personality ? `性格: ${personality}` : "",
        quote ? `口头禅: "${quote}"` : "",
      ].filter(Boolean);
      return `- ${nameWithRealm}${parts.length > 0 ? `｜${parts.join("｜")}` : ""}`;
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
  const hardConstraintCategories = [
    ...getJingweiCategoryAliases("world-model"),
    ...getJingweiCategoryAliases("power-system"),
    ...getJingweiCategoryAliases("rules"),
  ].filter((category, index, all) => all.indexOf(category) === index);
  const constraints = storage.sqlite.prepare(
    `SELECT title, content_md FROM story_jingwei_entry
     WHERE book_id = ?
       AND category IN (${sqlInPlaceholders(hardConstraintCategories)})
       AND visibility_rule_json LIKE '%global%'
       AND deleted_at IS NULL
     LIMIT 5`
  ).all(bookId, ...hardConstraintCategories) as Array<{ title: string; content_md: string }>;

  if (constraints.length > 0) {
    const cLines = constraints.map(c => `- ${c.title}：${(c.content_md || "").slice(0, 80)}`);
    sections.push(`【硬约束】\n${cLines.join("\n")}`);
  }

  if (sections.length === 0) return "";
  return `\u2550\u2550\u2550 第${chapterNumber}章写作 Briefing \u2550\u2550\u2550\n\n${sections.join("\n\n")}`;
}
