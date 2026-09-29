/**
 * 伏笔当前阶段的派生读模型（读取时计算，不落库）。
 *
 * 单一权威源：伏笔只有经纬 `foreshadowing` 条目一份，状态存在 fields_json。
 * 叙事记忆里已应用的 hook_* 事件只是「正文里发生了什么」的证据：条目停在较早阶段时，
 * 按关联到它的事件把阶段往前推（埋设 → 推进 → 触发），并补上条目没填的章号。
 * 终态（已回收 / 已废弃）只看条目当前状态：事件既不能把伏笔推成已回收，也不能把作者标的终态翻回去；
 * 作者把已回收的伏笔拖回「已埋设」后，旧的回收事件不再让它显示为已回收。
 *
 * 没有关联到任何经纬伏笔条目的 hook 事件不构成伏笔，只留在事件流里作证据。
 * 此前的 `narrative_foreshadow` 表是按事件主语另存的第二份伏笔状态，已由迁移 0039 删除。
 */

import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";

import { getJingweiCategoryAliases, sqlInPlaceholders } from "../jingwei/category-compat.js";
import { buildEntityDictionary, resolveEntity } from "../narrative-memory/entity-dictionary.js";

export type ForeshadowPhase = "planted" | "reinforced" | "triggered" | "paid_off" | "abandoned" | "unknown";

export interface ForeshadowEntryInput {
  readonly id: string;
  readonly title?: string;
  readonly fields?: Record<string, unknown> | null;
  readonly lifecycle?: string;
}

export interface ForeshadowHookEventInput {
  readonly id?: string;
  readonly chapterNumber?: number;
  readonly eventType?: string;
  readonly subject?: string;
  readonly object?: string;
  readonly evidenceText?: string;
  readonly subjectEntryId?: string;
  /** 事件审核状态；只有 applied（或未标注）的事件才推动阶段。 */
  readonly status?: string;
}

export interface ForeshadowState {
  readonly entryId: string;
  /** 展示名：fields.name 优先，其次条目标题。 */
  readonly label: string;
  readonly phase: ForeshadowPhase;
  readonly setupChapter?: number;
  readonly triggerChapter?: number;
  readonly triggerCondition?: string;
  readonly payoffChapter?: number;
  /** 最近一条关联事件的正文依据。 */
  readonly evidenceText?: string;
}

const PHASE_RANK: Record<ForeshadowPhase, number> = {
  unknown: 0,
  planted: 1,
  reinforced: 2,
  triggered: 3,
  paid_off: 4,
  abandoned: 5,
};

const EVENT_PHASE: Record<string, ForeshadowPhase> = {
  hook_planted: "planted",
  hook_progressed: "reinforced",
  hook_triggered: "triggered",
  hook_resolved: "paid_off",
};

function clean(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/gu, " ").trim() : "";
}

function toChapter(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * 经纬条目上的伏笔状态 → 阶段。条目状态有中英两套写法（看板用中文，工具与旧数据用英文），都要认。
 * 脏值或缺失时按章号推断，推不出记 unknown，不猜。
 */
export function resolveForeshadowPhase(fields: Record<string, unknown> | null | undefined): ForeshadowPhase {
  const values = fields ?? {};
  const raw = clean(values.status).toLowerCase();
  if (["paid_off", "paid-off", "resolved", "已回收", "已兑现"].includes(raw)) return "paid_off";
  if (["abandoned", "contradicted", "已废弃"].includes(raw)) return "abandoned";
  if (["triggered", "paying_off", "唤醒中", "已触发"].includes(raw)) return "triggered";
  if (["reinforced", "progressing", "partial", "部分揭示"].includes(raw)) return "reinforced";
  if (["planted", "open", "pending", "已埋设"].includes(raw)) return "planted";
  if (toChapter(values.payoffChapter) !== undefined) return "paid_off";
  if (toChapter(values.triggerChapter) !== undefined) return "triggered";
  if (toChapter(values.plantedChapter) !== undefined) return "planted";
  return "unknown";
}

function isTerminal(phase: ForeshadowPhase): boolean {
  return phase === "paid_off" || phase === "abandoned";
}

function countsAsEvidence(event: ForeshadowHookEventInput): boolean {
  return event.status === undefined || event.status === "applied";
}

/**
 * 纯函数：经纬伏笔条目 + 叙事事件 → 每条伏笔的当前阶段。
 * resolveEntryId 用于事件没挂 subjectEntryId 时按主语名找条目（通常是实体字典）。
 */
export function deriveForeshadowStates(
  entries: readonly ForeshadowEntryInput[],
  events: readonly ForeshadowHookEventInput[],
  options: { readonly resolveEntryId?: (subject: string) => string | undefined } = {},
): ForeshadowState[] {
  const active = entries.filter((entry) => entry.lifecycle !== "archived" && entry.lifecycle !== "retired");
  const entryIds = new Set(active.map((entry) => entry.id));
  const eventsByEntry = new Map<string, ForeshadowHookEventInput[]>();
  for (const event of events) {
    if (!EVENT_PHASE[clean(event.eventType)] || !countsAsEvidence(event)) continue;
    const linked = event.subjectEntryId && entryIds.has(event.subjectEntryId)
      ? event.subjectEntryId
      : options.resolveEntryId?.(clean(event.subject));
    if (!linked || !entryIds.has(linked)) continue;
    const bucket = eventsByEntry.get(linked) ?? [];
    bucket.push(event);
    eventsByEntry.set(linked, bucket);
  }

  return active.map((entry) => {
    const fields = entry.fields ?? {};
    const linked = [...(eventsByEntry.get(entry.id) ?? [])]
      .sort((left, right) => (toChapter(left.chapterNumber) ?? 0) - (toChapter(right.chapterNumber) ?? 0));
    const firstOf = (phase: ForeshadowPhase) => linked.find((event) => EVENT_PHASE[clean(event.eventType)] === phase);

    const entryPhase = resolveForeshadowPhase(fields);
    let phase = entryPhase;
    if (!isTerminal(entryPhase)) {
      for (const event of linked) {
        const eventPhase = EVENT_PHASE[clean(event.eventType)]!;
        // 回收是终态，只由作者在条目上确认；回收事件只作证据，不推动阶段
        if (isTerminal(eventPhase)) continue;
        if (PHASE_RANK[eventPhase] > PHASE_RANK[phase]) phase = eventPhase;
      }
    }

    const planted = firstOf("planted");
    const triggered = firstOf("triggered");
    const setupChapter = toChapter(fields.plantedChapter) ?? toChapter(planted?.chapterNumber);
    const triggerChapter = toChapter(fields.triggerChapter) ?? toChapter(triggered?.chapterNumber);
    const triggerCondition = clean(fields.triggerCondition)
      || clean(triggered?.object).slice(0, 400)
      || clean(triggered?.evidenceText).slice(0, 400)
      || undefined;
    const payoffChapter = toChapter(fields.payoffChapter);
    const evidenceText = clean(linked.at(-1)?.evidenceText).slice(0, 400) || undefined;

    return {
      entryId: entry.id,
      label: clean(fields.name) || clean(entry.title) || "未命名伏笔",
      phase,
      ...(setupChapter !== undefined ? { setupChapter } : {}),
      ...(triggerChapter !== undefined ? { triggerChapter } : {}),
      ...(triggerCondition ? { triggerCondition } : {}),
      ...(payoffChapter !== undefined ? { payoffChapter } : {}),
      ...(evidenceText ? { evidenceText } : {}),
    };
  });
}

/**
 * 读本书未删除的经纬伏笔条目；表还没建好时返回空。
 * 待审（needs-review）条目是机器抽取的草稿，作者确认前不当作伏笔设定，这里不返回。
 */
export function loadForeshadowEntries(
  storage: StorageDatabase,
  bookId: string,
): Array<ForeshadowEntryInput & { readonly title: string; readonly fields: Record<string, unknown> }> {
  try {
    const categories = getJingweiCategoryAliases("foreshadowing");
    const rows = storage.sqlite.prepare<{ id: string; title: string; fieldsJson: string | null; lifecycle: string | null }>(`
      SELECT id, title, fields_json AS fieldsJson, lifecycle
      FROM story_jingwei_entry
      WHERE book_id = ? AND category IN (${sqlInPlaceholders(categories)}) AND deleted_at IS NULL
        AND (status IS NULL OR status <> 'needs-review')
      ORDER BY sort_order ASC, updated_at DESC
    `).all(bookId, ...categories);
    return rows.map((row) => {
      let fields: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(row.fieldsJson ?? "{}") as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) fields = parsed as Record<string, unknown>;
      } catch {
        fields = {};
      }
      return { id: row.id, title: row.title, fields, ...(row.lifecycle ? { lifecycle: row.lifecycle } : {}) };
    });
  } catch {
    return [];
  }
}

function loadHookEvents(storage: StorageDatabase, bookId: string): ForeshadowHookEventInput[] {
  try {
    return storage.sqlite.prepare<{
      id: string;
      chapterNumber: number;
      eventType: string;
      subject: string;
      object: string;
      evidenceText: string | null;
      subjectEntryId: string | null;
      status: string;
    }>(`
      SELECT id, chapter_number AS chapterNumber, event_type AS eventType, subject, object,
             evidence_text AS evidenceText, subject_entry_id AS subjectEntryId, status
      FROM narrative_event
      WHERE book_id = ? AND status = 'applied'
        AND event_type IN ('hook_planted', 'hook_progressed', 'hook_triggered', 'hook_resolved')
      ORDER BY chapter_number ASC, created_at ASC
    `).all(bookId).map((row) => ({
      id: row.id,
      chapterNumber: row.chapterNumber,
      eventType: row.eventType,
      subject: row.subject,
      object: row.object,
      ...(row.evidenceText ? { evidenceText: row.evidenceText } : {}),
      ...(row.subjectEntryId ? { subjectEntryId: row.subjectEntryId } : {}),
      status: row.status,
    }));
  } catch {
    return [];
  }
}

/** 从库里读条目与事件，派生本书每条伏笔的当前阶段。 */
export function loadForeshadowStates(storage: StorageDatabase, bookId: string): ForeshadowState[] {
  const entries = loadForeshadowEntries(storage, bookId);
  if (entries.length === 0) return [];
  const dictionary = buildEntityDictionary(storage, bookId);
  return deriveForeshadowStates(entries, loadHookEvents(storage, bookId), {
    resolveEntryId: (subject) => resolveEntity(dictionary, subject)?.entry.entryId,
  });
}
