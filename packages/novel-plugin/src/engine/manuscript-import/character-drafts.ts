/**
 * 旧稿导入「全书综合」：从已应用事件与出场名单里统计候选人物，起草经纬人物草稿。
 *
 * 为什么要有：实体索引只认已关联经纬条目的称呼（entity-index 的出场名单只读 entry_id 非空的行），
 * 而导入的书往往一个人物条目都没有，于是实体图谱恒为空、依赖它的场景校验也全部失效。
 *
 * 规则（照章后结算起草伏笔草稿的先例，见 handlers/foreshadow-draft-staging.ts）：
 * - 只起草人物：候选必须至少一次以「人物角色」出现在已应用事件里（人物状态 / 关系 / 所在变化的主体，
 *   或关系变化的另一方）。出场名单不带类型，地点、势力、物品与人物混在一起，单凭出场名单分不出来，
 *   所以地点与势力这次不起草，交作者手建。
 * - 出现次数 = 人物角色事件条数 + 出场章数，达到 MIN_CHARACTER_DRAFT_OCCURRENCES 才起草。
 * - 不是现有经纬实体条目的名字或别名（含已删除的人物条目：作者删掉的草稿不再冒出来）。
 * - 写成 characters 类目、layer=dynamic、status=needs-review，附首次出现章、出现次数与一两句原文证据。
 *   作者确认前不进实体字典（entity-dictionary 排除待确认人物），也就不进实体索引与场景校验。
 * - 幂等：按经纬条目身份键（entry_key）与标题去重，已有的草稿不重复起草。
 */

import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";

import { getJingweiCategoryAliases, sqlInPlaceholders } from "../jingwei/category-compat.js";
import { generateEntryKey, normalizeText } from "../jingwei/entry-identity.js";
import { recordLedgerConflict } from "../jingwei/ledger-conflict-store.js";
import {
  buildEntityDictionary,
  expandEntityLookupKeys,
  resolveEntity,
  stripParentheticalSuffix,
} from "../narrative-memory/entity-dictionary.js";
import { looksLikeEntityName, looksLikeEventPhrase, splitCompositeSubject } from "../narrative-entity/entity-index.js";
import { upsertLedgerEntry } from "../../handlers/jingwei-ledger-store.js";

/**
 * 起草阈值：人物角色事件条数 + 出场章数至少 3。
 * 一章最多贡献一条出场记录；只在一章露面、只有一条事件的路人（1 + 1 = 2）不起草，
 * 跨两章出场且至少有一条事件（≥ 3），或在一章里推动了两条以上事件的人物才起草。
 * 宁可漏起草（作者可手建）也不往待确认里塞一堆路人。
 */
export const MIN_CHARACTER_DRAFT_OCCURRENCES = 3;

/** 单次综合最多起草的人物数，防止模型抽取异常时一次塞满待确认。 */
export const MAX_CHARACTER_DRAFTS_PER_RUN = 40;

/** 起草来源标记（fields.draftSource），导入报告据此统计仍待确认的草稿。 */
export const MANUSCRIPT_CHARACTER_DRAFT_SOURCE = "manuscript-import";

/** 主体是人物的事件类型。 */
const PERSON_SUBJECT_EVENT_TYPES = new Set(["character_state_changed", "relationship_changed", "location_changed"]);
/** 另一方也是人物（或势力）的事件类型；location_changed 的对象是地点，不算。 */
const PERSON_OBJECT_EVENT_TYPES = new Set(["relationship_changed"]);

export interface CharacterDraftCandidate {
  readonly name: string;
  readonly occurrences: number;
  readonly eventCount: number;
  readonly mentionChapters: number;
  readonly firstChapter: number;
  readonly evidence: readonly { readonly chapterNumber: number; readonly text: string }[];
}

export interface StagedCharacterDraft {
  readonly entryId: string;
  readonly title: string;
  readonly firstChapter: number;
  readonly occurrences: number;
}

export interface PendingCharacterDraft {
  readonly entryId: string;
  readonly title: string;
  readonly firstChapter: number | null;
  readonly occurrences: number | null;
}

interface CandidateAccumulator {
  name: string;
  eventCount: number;
  mentionChapterSet: Set<number>;
  firstChapter: number;
  evidence: { chapterNumber: number; text: string }[];
}

function tableExists(storage: StorageDatabase, table: string): boolean {
  return Boolean(storage.sqlite.prepare<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get(table));
}

function cleanName(raw: string): string {
  return raw.replace(/\s+/gu, " ").trim();
}

/** 一个原始称呼拆成可起草的人名；复合主体（「林照与沈默」）拆开，描述性短语与事件短语丢掉。 */
function namesOf(raw: unknown): string[] {
  if (typeof raw !== "string") return [];
  const trimmed = cleanName(raw);
  if (!trimmed) return [];
  return splitCompositeSubject(trimmed).names
    .map((name) => stripParentheticalSuffix(cleanName(name)) || cleanName(name))
    .filter((name) => name.length >= 2 && looksLikeEntityName(name) && !looksLikeEventPhrase(name));
}

function clipEvidence(text: string): string {
  const normalized = text.replace(/\s+/gu, " ").trim();
  return normalized.length > 120 ? `${normalized.slice(0, 119)}…` : normalized;
}

/**
 * 只读统计：从已应用事件与出场名单里数出候选人物（未按现有条目过滤）。
 * 结果按出现次数降序、首次出现章升序。
 */
export function collectCharacterCandidates(
  storage: StorageDatabase,
  bookId: string,
  range?: { readonly from: number; readonly to: number },
): CharacterDraftCandidate[] {
  if (!tableExists(storage, "narrative_event")) return [];
  const byKey = new Map<string, CandidateAccumulator>();
  const touch = (name: string, chapter: number): CandidateAccumulator => {
    const key = normalizeText(name);
    let acc = byKey.get(key);
    if (!acc) {
      acc = { name, eventCount: 0, mentionChapterSet: new Set(), firstChapter: chapter, evidence: [] };
      byKey.set(key, acc);
    }
    acc.firstChapter = Math.min(acc.firstChapter, chapter);
    return acc;
  };
  const rangeSql = range ? " AND chapter_number BETWEEN ? AND ?" : "";
  const rangeArgs = range ? [range.from, range.to] : [];

  const events = storage.sqlite.prepare<{ chapter_number: number; event_type: string; subject: string; object: string; evidence_text: string }>(`
    SELECT chapter_number, event_type, subject, object, evidence_text
    FROM narrative_event
    WHERE book_id = ? AND status = 'applied'${rangeSql}
    ORDER BY chapter_number ASC, id ASC
  `).all(bookId, ...rangeArgs);
  for (const event of events) {
    if (typeof event.chapter_number !== "number") continue;
    const sides: unknown[] = [];
    if (PERSON_SUBJECT_EVENT_TYPES.has(event.event_type)) sides.push(event.subject);
    if (PERSON_OBJECT_EVENT_TYPES.has(event.event_type)) sides.push(event.object);
    for (const raw of sides) {
      for (const name of namesOf(raw)) {
        const acc = touch(name, event.chapter_number);
        acc.eventCount += 1;
        const text = clipEvidence(event.evidence_text ?? "");
        // 证据最多两句，优先取不同章的
        if (text && acc.evidence.length < 2 && !acc.evidence.some((item) => item.chapterNumber === event.chapter_number || item.text === text)) {
          acc.evidence.push({ chapterNumber: event.chapter_number, text });
        }
      }
    }
  }
  // 只为至少当过一次人物角色的名字计出场：出场名单不带类型，单凭它分不出人物与地点
  const personKeys = new Set(byKey.keys());

  if (tableExists(storage, "narrative_chapter_mention")) {
    const mentions = storage.sqlite.prepare<{ chapter_number: number; entity_name: string }>(`
      SELECT chapter_number, entity_name FROM narrative_chapter_mention
      WHERE book_id = ?${rangeSql}
      ORDER BY chapter_number ASC, position ASC
    `).all(bookId, ...rangeArgs);
    for (const mention of mentions) {
      if (typeof mention.chapter_number !== "number") continue;
      for (const name of namesOf(mention.entity_name)) {
        if (!personKeys.has(normalizeText(name))) continue;
        touch(name, mention.chapter_number).mentionChapterSet.add(mention.chapter_number);
      }
    }
  }

  return [...byKey.values()]
    .map((acc) => ({
      name: acc.name,
      eventCount: acc.eventCount,
      mentionChapters: acc.mentionChapterSet.size,
      occurrences: acc.eventCount + acc.mentionChapterSet.size,
      firstChapter: acc.firstChapter,
      evidence: acc.evidence,
    }))
    .sort((a, b) => b.occurrences - a.occurrences || a.firstChapter - b.firstChapter || a.name.localeCompare(b.name, "zh"));
}

interface CharacterRow {
  id: string;
  title: string;
  entryKey: string | null;
  fieldsJson: string | null;
  aliasesJson: string | null;
  deletedAt: number | null;
  status: string | null;
}

function loadAllCharacterRows(storage: StorageDatabase, bookId: string): CharacterRow[] | null {
  if (!tableExists(storage, "story_jingwei_entry")) return null;
  const categories = getJingweiCategoryAliases("characters");
  try {
    return storage.sqlite.prepare<CharacterRow>(`
      SELECT id, title, entry_key AS entryKey, fields_json AS fieldsJson, aliases_json AS aliasesJson,
             deleted_at AS deletedAt, status
      FROM story_jingwei_entry
      WHERE book_id = ? AND category IN (${sqlInPlaceholders(categories)})
    `).all(bookId, ...categories);
  } catch {
    // 旧库缺 entry_key / status 列时退回只按标题与别名去重
    return storage.sqlite.prepare<Omit<CharacterRow, "entryKey" | "status">>(`
      SELECT id, title, fields_json AS fieldsJson, aliases_json AS aliasesJson, deleted_at AS deletedAt
      FROM story_jingwei_entry
      WHERE book_id = ? AND category IN (${sqlInPlaceholders(categories)})
    `).all(bookId, ...categories).map((row) => ({ ...row, entryKey: null, status: null }));
  }
}

function parseJson<T>(raw: string | null): T | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

function identityKeys(name: string): string[] {
  const stripped = stripParentheticalSuffix(name) || name;
  return [...new Set([
    generateEntryKey("characters", name),
    generateEntryKey("characters", stripped),
    `title:${normalizeText(name)}`,
    `title:${normalizeText(stripped)}`,
  ])];
}

/**
 * 起草人物草稿，返回本次新建的草稿。经纬表还不存在时不起草。
 * 已是现有实体条目（任意实体类目的名字或别名）、已有人物条目（含待确认与已删除）的名字跳过。
 */
export function stageManuscriptCharacterDrafts(
  storage: StorageDatabase,
  bookId: string,
  options: { readonly range?: { readonly from: number; readonly to: number }; readonly jobId?: string } = {},
): StagedCharacterDraft[] {
  const rows = loadAllCharacterRows(storage, bookId);
  if (!rows) return [];
  const candidates = collectCharacterCandidates(storage, bookId, options.range)
    .filter((candidate) => candidate.occurrences >= MIN_CHARACTER_DRAFT_OCCURRENCES);
  if (candidates.length === 0) return [];

  // 现有实体条目（已确认 / 未确认的人物、地点、势力、物品、伏笔）的全部称呼
  const dictionary = buildEntityDictionary(storage, bookId);
  // 人物条目（含待确认草稿、作者删掉的条目）的身份键与全部称呼：删掉的不再起草
  const knownKeys = new Set<string>();
  for (const row of rows) {
    if (row.entryKey) knownKeys.add(row.entryKey);
    const aliasColumn = parseJson<unknown[]>(row.aliasesJson);
    const lookupKeys = expandEntityLookupKeys({
      title: row.title,
      fields: parseJson<Record<string, unknown>>(row.fieldsJson),
      ...(Array.isArray(aliasColumn) ? { aliasColumn: aliasColumn.filter((item): item is string => typeof item === "string") } : {}),
    });
    for (const key of lookupKeys) for (const identity of identityKeys(key)) knownKeys.add(identity);
  }

  const staged: StagedCharacterDraft[] = [];
  for (const candidate of candidates) {
    if (staged.length >= MAX_CHARACTER_DRAFTS_PER_RUN) break;
    const title = candidate.name.slice(0, 200);
    if (resolveEntity(dictionary, title)) continue;
    const keys = identityKeys(title);
    if (keys.some((key) => knownKeys.has(key))) continue;

    const evidenceLines = candidate.evidence.map((item) => `- 第 ${item.chapterNumber} 章：${item.text}`);
    let stale = false;
    const entry = upsertLedgerEntry(storage, {
      bookId,
      category: "characters",
      title,
      contentMd: [
        `旧稿导入时从正文里统计到的人物：第 ${candidate.firstChapter} 章首次出现，共出现 ${candidate.occurrences} 次（事件 ${candidate.eventCount} 条、出场 ${candidate.mentionChapters} 章）。`,
        evidenceLines.length > 0 ? `\n正文依据：\n${evidenceLines.join("\n")}` : "",
        "\n待作者确认；确认前不进实体图谱、场景校验与写作注入。不是人物或不需要单独建档，直接删掉这条即可，之后不会再起草。",
      ].filter(Boolean).join("\n"),
      fields: {
        name: title,
        draftSource: MANUSCRIPT_CHARACTER_DRAFT_SOURCE,
        ...(options.jobId ? { draftJobId: options.jobId } : {}),
        firstChapter: candidate.firstChapter,
        occurrences: candidate.occurrences,
        evidence: candidate.evidence.map((item) => ({ chapterNumber: item.chapterNumber, text: item.text })),
      },
      status: "needs-review",
      reason: `旧稿导入从正文统计到人物（出现 ${candidate.occurrences} 次）`,
      changedBy: "manuscript-import",
      entryKey: keys[0]!,
      sourceRefs: candidate.evidence.length > 0
        ? candidate.evidence.map((item) => ({ chapterNumber: item.chapterNumber, excerpt: item.text }))
        : [{ chapterNumber: candidate.firstChapter, excerpt: title }],
      // 读取之后作者抢先建了同名条目：不覆盖作者那一条，冲突交待处理
      expectedVersion: 0,
      onStaleWrite: (conflict) => { stale = true; recordLedgerConflict(storage, bookId, conflict); },
    });
    for (const key of keys) knownKeys.add(key);
    if (!stale) {
      staged.push({ entryId: entry.id, title, firstChapter: candidate.firstChapter, occurrences: candidate.occurrences });
    }
  }
  return staged;
}

/** 本书仍待确认的导入人物草稿（作者确认或删除后就不再算）。 */
export function listPendingManuscriptCharacterDrafts(storage: StorageDatabase, bookId: string): PendingCharacterDraft[] {
  const rows = loadAllCharacterRows(storage, bookId) ?? [];
  const out: PendingCharacterDraft[] = [];
  for (const row of rows) {
    if (row.deletedAt !== null || row.status !== "needs-review") continue;
    const fields = parseJson<Record<string, unknown>>(row.fieldsJson) ?? {};
    if (fields.draftSource !== MANUSCRIPT_CHARACTER_DRAFT_SOURCE) continue;
    out.push({
      entryId: row.id,
      title: row.title,
      firstChapter: typeof fields.firstChapter === "number" ? fields.firstChapter : null,
      occurrences: typeof fields.occurrences === "number" ? fields.occurrences : null,
    });
  }
  return out.sort((a, b) => (b.occurrences ?? 0) - (a.occurrences ?? 0) || (a.firstChapter ?? 0) - (b.firstChapter ?? 0));
}
