import type { BookConfig, StateManager, StorageDatabase } from "@vivy1024/novelfork-core";
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

function readStringArray(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
  if (typeof raw === "string" && raw.trim()) return raw.split(/[,，\n]/u).map((item) => item.trim()).filter(Boolean);
  return [];
}

function parseJsonStringArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    return readStringArray(JSON.parse(raw));
  } catch {
    return [];
  }
}

function stripNameDecoration(value: string): string {
  return value.trim().replace(/\s*[（(][^）)]*[）)]\s*$/u, "").trim();
}

function matchesNarrativeSubject(subject: string, names: readonly string[]): boolean {
  const normalizedSubject = subject.trim();
  return names.some((rawName) => {
    const name = stripNameDecoration(rawName);
    if (!name) return false;
    return normalizedSubject === rawName.trim()
      || normalizedSubject === name
      || normalizedSubject.startsWith(`${name}（`)
      || normalizedSubject.startsWith(`${name}(`);
  });
}

export type ChapterBriefingOptions = Readonly<{
  /** 测试/隔离环境注入的存储；生产环境缺省使用进程级单例。 */
  storage?: StorageDatabase;
  /** 通过 StateManager.loadBookConfig 读取书籍配置。 */
  state?: Pick<StateManager, "loadBookConfig">;
  /** 已加载的配置，优先于 state，便于调用方复用已有读取结果。 */
  bookConfig?: Partial<Pick<BookConfig, "narrativeContract">>;
}>;

const RESOLVED_CONTRACT_STATES = new Set(["resolved", "closed", "completed", "done", "settled", "已解决", "已回收"]);
const OPEN_CONTRACT_STATES = new Set(["open", "active", "progressing", "planted", "overdue", "待回收", "已埋设"]);

function isResolvedContractState(value: unknown): boolean {
  return typeof value === "string" && RESOLVED_CONTRACT_STATES.has(value.trim().toLowerCase());
}

function isOpenContractState(value: unknown): boolean {
  return typeof value === "string" && OPEN_CONTRACT_STATES.has(value.trim().toLowerCase());
}

/**
 * 叙事契约命中率：已解决数量 ÷（已解决数量 + 超期未回收数量）。
 * 没有可计算数据时返回 null，而不是伪造 0%。
 */
export function computePromiseHitRate(resolvedCount: number, openOverdueCount: number): number | null {
  const denominator = resolvedCount + openOverdueCount;
  return denominator > 0 ? resolvedCount / denominator : null;
}

/**
 * 从叙事记忆存储统计粗略叙事契约命中率。
 */
export function computeNarrativeContractHitRate(storage: StorageDatabase, bookId: string, currentChapter?: number): number | null {
  let resolvedCount = 0;
  let openOverdueCount = 0;

  try {
    const chains = storage.sqlite.prepare<{
      status: string;
      urgency: string | null;
      trigger_chapter: number;
      last_progress_chapter: number | null;
    }>(`
      SELECT status, urgency, trigger_chapter, last_progress_chapter
      FROM jingwei_causal_chains
      WHERE book_id = ?
    `).all(bookId);
    for (const chain of chains) {
      if (isResolvedContractState(chain.status)) {
        resolvedCount += 1;
        continue;
      }
      if (!isOpenContractState(chain.status)) continue;
      const lastActive = chain.last_progress_chapter ?? chain.trigger_chapter;
      const overdueByChapter = currentChapter !== undefined && currentChapter - lastActive >= 100;
      if (chain.urgency === "overdue" || overdueByChapter) openOverdueCount += 1;
    }
  } catch {
    // 旧库可能尚未创建因果链表；继续统计经纬伏笔。
  }

  try {
    const foreshadowCategories = getJingweiCategoryAliases("foreshadowing");
    const rows = storage.sqlite.prepare<{ fields_json: string | null; lifecycle: string | null }>(`
      SELECT fields_json, lifecycle
      FROM story_jingwei_entry
      WHERE book_id = ?
        AND category IN (${sqlInPlaceholders(foreshadowCategories)})
        AND deleted_at IS NULL
    `).all(bookId, ...foreshadowCategories);
    for (const row of rows) {
      const fields = parseEntryFields(row.fields_json ?? "{}");
      const status = fields.status ?? fields.state ?? row.lifecycle;
      if (isResolvedContractState(status)) {
        resolvedCount += 1;
        continue;
      }
      if (!isOpenContractState(status)) continue;
      const planted = Number(fields.plantedChapter ?? fields.planted_chapter);
      const overdueByChapter = currentChapter !== undefined && Number.isFinite(planted) && planted > 0 && currentChapter - planted > 20;
      if (String(fields.urgency ?? "").toLowerCase() === "overdue" || status === "overdue" || overdueByChapter) openOverdueCount += 1;
    }
  } catch {
    // 旧库可能尚未创建经纬表；无数据时按 null 返回。
  }

  return computePromiseHitRate(resolvedCount, openOverdueCount);
}

function buildAppearanceWarnings(
  storage: StorageDatabase,
  bookId: string,
  chapterNumber: number,
  characters: readonly { title: string; fields_json: string; aliases_json?: string | null }[],
): string[] {
  try {
    const events = storage.sqlite.prepare<{ subject: string; last_chapter: number | null }>(`
      SELECT subject, MAX(chapter_number) AS last_chapter
      FROM narrative_event
      WHERE book_id = ?
      GROUP BY subject
    `).all(bookId);
    const warnings: string[] = [];
    for (const character of characters) {
      const fields = parseEntryFields(character.fields_json);
      const names = [
        character.title,
        stripNameDecoration(character.title),
        ...parseJsonStringArray(character.aliases_json),
        ...readStringArray(fields.aliases),
      ].filter(Boolean);
      const lastChapter = events
        .filter((event) => matchesNarrativeSubject(event.subject, names))
        .reduce((max, event) => Math.max(max, event.last_chapter ?? 0), 0);
      const gap = chapterNumber - lastChapter;
      if (lastChapter > 0 && gap >= 10) warnings.push(`- ⚠️ ${character.title} 已 ${gap} 章未出场`);
    }
    return warnings;
  } catch {
    // briefing 是增强信息，叙事事件表缺失/损坏时跳过告警，不阻断写作。
    return [];
  }
}

/**
 * Generate a structured briefing for the AI before writing a chapter.
 * This is injected into the system prompt.
 */
export async function buildChapterBriefing(
  bookId: string,
  chapterNumber: number,
  options: ChapterBriefingOptions = {},
): Promise<string> {
  const storage = options.storage ?? (await import("@vivy1024/novelfork-core/storage")).getStorageDatabase();
  let bookConfig = options.bookConfig;
  if (!bookConfig && options.state) {
    try {
      bookConfig = await options.state.loadBookConfig(bookId);
    } catch {
      bookConfig = undefined;
    }
  }

  const sections: string[] = [];

  // 1. Active characters (lifecycle = 'active')
  const characterCategories = getJingweiCategoryAliases("characters");
  const activeChars = storage.sqlite.prepare(
    `SELECT title, fields_json, aliases_json FROM story_jingwei_entry
     WHERE book_id = ?
       AND category IN (${sqlInPlaceholders(characterCategories)})
       AND lifecycle = 'active'
       AND deleted_at IS NULL
     ORDER BY sort_order`
  ).all(bookId, ...characterCategories) as Array<{ title: string; fields_json: string; aliases_json?: string | null }>;

  if (activeChars.length > 0) {
    const charLines = activeChars.slice(0, 10).map(c => {
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

  const appearanceWarnings = buildAppearanceWarnings(storage, bookId, chapterNumber, activeChars);
  if (appearanceWarnings.length > 0) sections.push(`【登场告警】\n${appearanceWarnings.join("\n")}`);

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
  const foreshadowCategories = getJingweiCategoryAliases("foreshadowing");
  const foreshadows = storage.sqlite.prepare(
    `SELECT title, fields_json FROM story_jingwei_entry
     WHERE book_id = ? AND category IN (${sqlInPlaceholders(foreshadowCategories)}) AND lifecycle = 'active' AND deleted_at IS NULL
     ORDER BY sort_order LIMIT 5`
  ).all(bookId, ...foreshadowCategories) as Array<{ title: string; fields_json: string }>;

  if (foreshadows.length > 0) {
    const fLines = foreshadows.map(f => {
      const fields = parseEntryFields(f.fields_json);
      return `- ${f.title}${fields.status ? "（" + String(fields.status) + "）" : ""}`;
    });
    sections.push(`【活跃伏笔】\n${fLines.join("\n")}`);
  }

  const hitRate = computeNarrativeContractHitRate(storage, bookId, chapterNumber);
  if (hitRate !== null) sections.push(`【叙事契约命中率】粗略命中率 ${Math.round(hitRate * 100)}%（已解决 / 已解决+超期未回收）`);

  const revealBudget = bookConfig?.narrativeContract?.revealBudget;
  if (revealBudget) {
    const description = revealBudget.description?.trim();
    sections.push(`【本章揭示预算】当前允许揭示至第 ${revealBudget.level} 层底牌${description ? `（${description}）` : ""}，勿越级揭底`);
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
