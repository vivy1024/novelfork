/**
 * 剧情线状态卡 —— 叙事记忆宏观层轻量版。
 *
 * 长篇写作的大局观问题：写第 200 章时，Agent 眼里只有零散事实，
 * 不知道每条剧情线（角色/势力/地点/道具）现在停在哪。
 * 本模块从当前章有效的叙事事实中，按主体聚合成一句话状态的汇总卡，
 * 随写前上下文一起注入。纯确定性实现，不调用模型。
 */
import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";

export interface StorylineStateCardInput {
  readonly bookId: string;
  /** 视角章号；事实按有效区间过滤，缺省查全书。 */
  readonly chapterNumber?: number;
  /** 最多展示的主体数（默认 8）。 */
  readonly maxSubjects?: number;
  /** 每个主体最多展示的事实条数（默认 3）。 */
  readonly maxFactsPerSubject?: number;
}

interface FactRow {
  subject: string;
  predicate: string;
  object: string;
  sourceChapter: number | null;
  validUntilChapter: number | null;
  updatedAt: string;
}

const DEFAULT_MAX_SUBJECTS = 8;
const DEFAULT_MAX_FACTS_PER_SUBJECT = 3;

function formatFact(fact: FactRow): string {
  const span = fact.validUntilChapter !== null
    ? `第${fact.sourceChapter ?? "?"}章起，第${fact.validUntilChapter}章止`
    : fact.sourceChapter !== null
      ? `第${fact.sourceChapter}章起`
      : "";
  const relation = fact.predicate ? `${fact.predicate}${fact.object}` : fact.object;
  return span ? `${relation}（${span}）` : relation;
}

/** 主体排序权重：事实越多、最近更新越新的主体排前面。 */
function subjectScore(facts: readonly FactRow[], now: number): number {
  const latest = facts.reduce((max, fact) => Math.max(max, Date.parse(fact.updatedAt) || 0), 0);
  const recency = latest > 0 ? (now - latest) / 86_400_000 : 0;
  return facts.length * 100 - recency;
}

export function buildStorylineStateCard(
  storage: StorageDatabase,
  input: StorylineStateCardInput,
): string {
  const chapterNumber = input.chapterNumber;
  const maxSubjects = Math.max(1, input.maxSubjects ?? DEFAULT_MAX_SUBJECTS);
  const maxFacts = Math.max(1, input.maxFactsPerSubject ?? DEFAULT_MAX_FACTS_PER_SUBJECT);

  const rows = storage.sqlite.prepare(`
    SELECT subject, predicate, object, source_chapter AS sourceChapter,
      valid_until_chapter AS validUntilChapter, updated_at AS updatedAt
    FROM narrative_fact
    WHERE book_id = ?
      AND (? IS NULL OR (valid_from_chapter IS NULL OR valid_from_chapter <= ?))
      AND (? IS NULL OR (valid_until_chapter IS NULL OR valid_until_chapter >= ?))
      AND subject <> ''
      AND object <> ''
    ORDER BY updated_at DESC
    LIMIT 400
  `).all(
    input.bookId,
    chapterNumber ?? null,
    chapterNumber ?? null,
    chapterNumber ?? null,
    chapterNumber ?? null,
  ) as FactRow[];

  if (rows.length === 0) return "";

  const bySubject = new Map<string, FactRow[]>();
  for (const row of rows) {
    const subject = row.subject.trim();
    if (!subject) continue;
    const bucket = bySubject.get(subject) ?? [];
    if (bucket.length < maxFacts) bucket.push(row);
    bySubject.set(subject, bucket);
  }

  const now = Date.now();
  const subjects = [...bySubject.entries()]
    .sort((left, right) => subjectScore(right[1], now) - subjectScore(left[1], now))
    .slice(0, maxSubjects)
    .map(([subject, facts]) => {
      const lines = facts
        .map((fact) => formatFact(fact))
        .filter((text) => text.trim().length > 0)
        .join("；");
      return lines ? `- ${subject}：${lines}` : null;
    })
    .filter((line): line is string => line !== null);

  if (subjects.length === 0) return "";
  const header = chapterNumber !== undefined
    ? `【剧情线当前状态 · 第${chapterNumber}章视角】`
    : "【剧情线当前状态】";
  return `${header}\n${subjects.join("\n")}`;
}
