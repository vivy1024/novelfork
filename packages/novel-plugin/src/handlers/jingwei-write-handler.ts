/**
 * jingwei.write handler — 经纬写入工具，支持 layer 分层与 canon 写入保护。
 *
 * layer 语义：
 * - canon: 不可变真相，只能追加内容，不能修改已有部分
 * - dynamic: 每章可更新（默认）
 * - reference: 按需查阅的参考资料
 */
import { getStorageDatabase } from "@vivy1024/novelfork-core";
import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";
import type { JingweiLayer } from "../engine/jingwei/types.js";
import { createStoryJingweiEntryRepository } from "../engine/jingwei/repositories/entry-repo.js";
import {
  getDissectionStaging,
  withPendingDissectionStaging,
  type DissectionStagingRecord,
} from "../engine/jingwei/dissection-staging.js";
import { mergeAliases, mergeSourceRefs } from "../engine/jingwei/entry-identity.js";
import {
  LEGACY_CATEGORY_MAP,
  JINGWEI_CATEGORIES,
  categoryAllowsCanon,
  getCategoryDefaultLayer,
} from "../engine/jingwei/unified-categories.js";

/**
 * 结构性账本分类：经纬是它们的唯一权威源（卷纲 / 伏笔 / 章摘要）。
 * 这些分类天然按章推进，允许 layer=dynamic 写入经纬，不再被动态边界守卫拦截。
 */
const LEDGER_CATEGORIES = new Set(["outline", "foreshadowing", "chapter-summaries"]);

// ─── Types ───────────────────────────────────────────────────────────────────

export interface JingweiWriteInput {
  bookId: string;
  /**
   * create | update | delete | retire
   * retire：作者/Agent 退役错误或过期条目（含 canon）。不改 layer、不改正文，
   * 只将条目退出 AI 可读集合（participates_in_ai=0 + soft-delete/archived）。
   */
  action?: "create" | "update" | "delete" | "retire";
  title: string;
  contentMd?: string;
  summaryMd?: string;
  category?: string;
  layer?: JingweiLayer;
  aliases?: string[];
  tags?: string[];
  visibility?: string;
  relatedEntryIds?: string[];
  entryId?: string;
  entryKey?: string;
  sourceRefs?: Array<{ chapterNumber: number; excerpt: string; path?: string; fileName?: string }>;
  fields?: Record<string, unknown>;
  mode?: "overwrite" | "append";
  /** 优先层级，影响默认 importance 与注入详细度 */
  priorityTier?: "core" | "relevant" | "reference" | "auto";
  /** 重要度评分 0-100，省略时按 priorityTier 映射 */
  importance?: number;
  /** 确认修改 canon 条目（canon 条目 update/retire 时必须为 true） */
  confirmCanonEdit?: boolean;
  /** 条目状态 */
  status?: "draft" | "confirmed" | "needs-review";
  /** 变更原因（存入 revision history）；retire 时必填 */
  reason?: string;
  /** 设定来源；canon/rules 写入时与 evidence 至少提供一项 */
  source?: string;
  /** 证据摘录；canon/rules 写入时与 source 至少提供一项 */
  evidence?: string;
  /** 拆书暂存候选 ID：确认提升或拒绝时传入 */
  stagingId?: string;
  /** 对 staging 候选的处理：promote 提升，reject 拒绝 */
  stagingDecision?: "promote" | "reject";
}

export interface JingweiWriteSuccess {
  ok: true;
  summary: string;
  data: {
    action: "created" | "updated" | "deleted" | "retired";
    entryId: string;
    bookId: string;
    category?: string;
    title?: string;
    layer?: JingweiLayer;
  };
}

export interface JingweiWriteFailure {
  ok: false;
  error: string;
  summary: string;
}

export type JingweiWriteResult = JingweiWriteSuccess | JingweiWriteFailure;

// ─── Helpers ─────────────────────────────────────────────────────────────────

const CATEGORY_NAMES: Record<string, string> = {
  character: "角色管理",
  event: "事件记录",
  worldview: "世界观设定",
  "power-system": "力量体系",
  geography: "地理地图",
  faction: "势力阵营",
  item: "物品列表",
  skill: "功法体系",
  currency: "货币体系",
  special: "特殊设定",
  outline: "大纲设定",
  relationship: "人物关系",
  foreshadowing: "伏笔管理",
  plot: "情节脉络",
  timeline: "时间线",
  "chapter-summary": "章节摘要",
  setting: "通用设定",
};

function inferCategory(raw: string, entryTitle: string, content: string): string {
  if (raw && raw !== "setting") return raw;
  const text = (entryTitle + " " + content.slice(0, 500)).toLowerCase();
  if (/伏笔|foreshadow|hook|悬念/.test(text)) return "foreshadowing";
  if (/大纲|卷.*章|outline|volume|节拍|beat/.test(text)) return "outline";
  if (/主角|配角|角色|人物|character|弧光/.test(text)) return "character";
  if (/世界观|worldview|力量体系|修炼体系|境界/.test(text)) return "worldview";
  if (/地图|地理|geography|部洲/.test(text)) return "geography";
  if (/前提|premise|核心矛盾|主题/.test(text)) return "worldview";
  if (/情节|plot|subplot|事件/.test(text)) return "plot";
  if (/时间线|timeline/.test(text)) return "timeline";
  if (/势力|faction|阵营|组织/.test(text)) return "faction";
  return raw || "setting";
}

/** Legacy normalizeCategory: map old names to unified enum, but allow free-form */
function normalizeCategoryLegacy(raw: string): string {
  const mapped = LEGACY_CATEGORY_MAP[raw];
  if (mapped) return mapped.category;
  if ((JINGWEI_CATEGORIES as readonly string[]).includes(raw)) return raw;
  // Free-form: return trimmed value as-is (custom category)
  return raw.trim() || "unclassified";
}

/** importance 默认值：写入参数优先，否则按 priorityTier 映射 */
function hasStagingEvidence(staging: DissectionStagingRecord): boolean {
  return staging.sourceRefs.some((ref) => (ref.chapterNumber > 0 || Boolean(ref.path?.trim() || ref.fileName?.trim())) && ref.excerpt.trim().length > 0);
}

function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== "string" || !raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function tableHasColumn(storage: ReturnType<typeof getStorageDatabase>, table: string, column: string): boolean {
  const rows = storage.sqlite.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === column);
}

function promoteStagingEntry(
  storage: ReturnType<typeof getStorageDatabase>,
  staging: DissectionStagingRecord,
  options: {
    readonly category: string;
    readonly layer: JingweiLayer;
    readonly tags: readonly string[];
    readonly relatedEntryIds: readonly string[];
    readonly visibility: string;
    readonly priorityTier: "core" | "relevant" | "reference" | "auto";
    readonly importance: number;
    readonly preferredEntryId?: string;
    readonly confirmCanonEdit: boolean;
    readonly now: Date;
  },
): { action: "created" | "updated"; entryId: string } {
  if (staging.duplicateCandidates.length > 1 && !options.preferredEntryId) {
    throw new Error("duplicate-review-required");
  }
  const preferredId = options.preferredEntryId ?? (staging.duplicateCandidates.length === 1 ? staging.duplicateCandidates[0]?.entryId : undefined);
  const existing = preferredId
    ? storage.sqlite.prepare(`
        SELECT id, title, content_md, summary_md, category, fields_json, tags_json, aliases_json,
          related_chapter_numbers_json, related_entry_ids_json, visibility_rule_json, participates_in_ai,
          token_budget, priority_tier, layer, importance, summary_l0, source, lifecycle, status, version,
          parent_id, sort_order, entry_key, source_refs_json, section_id
        FROM story_jingwei_entry
        WHERE book_id = ? AND id = ? AND deleted_at IS NULL
      `).get(staging.bookId, preferredId) as Record<string, unknown> | undefined
    : storage.sqlite.prepare(`
        SELECT id, title, content_md, summary_md, category, fields_json, tags_json, aliases_json,
          related_chapter_numbers_json, related_entry_ids_json, visibility_rule_json, participates_in_ai,
          token_budget, priority_tier, layer, importance, summary_l0, source, lifecycle, status, version,
          parent_id, sort_order, entry_key, source_refs_json, section_id
        FROM story_jingwei_entry
        WHERE book_id = ? AND title = ? AND category = ? AND deleted_at IS NULL
        ORDER BY updated_at DESC LIMIT 1
      `).get(staging.bookId, staging.proposedTitle, options.category) as Record<string, unknown> | undefined;

  let sectionId = storage.sqlite.prepare(`
    SELECT id FROM story_jingwei_section WHERE book_id = ? AND key = ? AND deleted_at IS NULL
  `).get(staging.bookId, options.category) as { id: string } | undefined;
  if (!sectionId) {
    const id = crypto.randomUUID();
    const now = options.now.getTime();
    storage.sqlite.prepare(`
      INSERT INTO story_jingwei_section (
        id, book_id, key, name, description, "order", enabled, show_in_sidebar,
        participates_in_ai, default_visibility, fields_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, '', 0, 1, 1, 1, 'tracked', '[]', ?, ?)
    `).run(id, staging.bookId, options.category, CATEGORY_NAMES[options.category] ?? options.category, now, now);
    sectionId = { id };
  }

  const entryId = existing ? String(existing.id) : crypto.randomUUID();
  const fields = { ...staging.fields, stagingId: staging.id, sourceRefs: staging.sourceRefs };
  const now = options.now.getTime();
  const aliases = mergeAliases(existing ? parseJson<string[]>(existing.aliases_json, []) : [], staging.aliases, staging.proposedTitle);
  const sourceRefs = mergeSourceRefs(existing ? parseJson(existing.source_refs_json, []) : [], staging.sourceRefs);
  const entryKey = existing?.entry_key ? String(existing.entry_key) : staging.entryKey;
  const hasIdentity = tableHasColumn(storage, "story_jingwei_entry", "entry_key");

  if (existing) {
    if (String(existing.layer ?? "dynamic") === "canon" && !options.confirmCanonEdit) throw new Error("canon-confirm-required");
    if (String(existing.layer ?? options.layer) === "canon" && options.layer !== "canon") throw new Error("canon-immutable");
    const snapshot = {
      title: String(existing.title ?? ""),
      contentMd: String(existing.content_md ?? ""),
      summaryMd: existing.summary_md == null ? null : String(existing.summary_md),
      category: String(existing.category ?? options.category),
      layer: String(existing.layer ?? options.layer),
      status: String(existing.status ?? "confirmed"),
      fields: parseJson<Record<string, unknown>>(existing.fields_json, {}),
      tags: parseJson<string[]>(existing.tags_json, []),
      aliases: parseJson<string[]>(existing.aliases_json, []),
      entryKey: existing.entry_key == null ? null : String(existing.entry_key),
      sourceRefs: parseJson(existing.source_refs_json, []),
      relatedChapterNumbers: parseJson<number[]>(existing.related_chapter_numbers_json, []),
      relatedEntryIds: parseJson<string[]>(existing.related_entry_ids_json, []),
      visibilityRule: parseJson<Record<string, unknown>>(existing.visibility_rule_json, { type: "tracked" }),
      participatesInAi: Boolean(existing.participates_in_ai),
      tokenBudget: existing.token_budget == null ? null : Number(existing.token_budget),
      priorityTier: String(existing.priority_tier ?? "auto"),
      importance: Number(existing.importance ?? 40),
      summaryL0: existing.summary_l0 == null ? null : String(existing.summary_l0),
      sectionId: String(existing.section_id),
      parentId: existing.parent_id == null ? null : String(existing.parent_id),
      sortOrder: Number(existing.sort_order ?? 0),
      lifecycle: String(existing.lifecycle ?? "active"),
    };
    storage.sqlite.prepare(`
      INSERT INTO jingwei_revision (
        id, entry_id, book_id, content_md, category, layer, snapshot_json, reason, changed_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(), entryId, staging.bookId, snapshot.contentMd, snapshot.category, snapshot.layer,
      JSON.stringify(snapshot), "promote staging", "agent", now,
    );
    const identitySet = hasIdentity ? `, entry_key = ?, source_refs_json = ?` : "";
    const values: unknown[] = [
      sectionId.id, staging.proposedTitle, staging.contentMd, options.category,
      JSON.stringify(fields), JSON.stringify(fields), JSON.stringify(options.tags), JSON.stringify(aliases),
      JSON.stringify(options.relatedEntryIds), JSON.stringify({ type: options.visibility }),
      options.priorityTier, options.layer, options.importance, now, staging.bookId, entryId,
    ];
    if (hasIdentity) values.splice(14, 0, entryKey, JSON.stringify(sourceRefs));
    storage.sqlite.prepare(`
      UPDATE story_jingwei_entry SET section_id = ?, title = ?, content_md = ?, category = ?,
        fields_json = ?, custom_fields_json = ?, tags_json = ?, aliases_json = ?,
        related_entry_ids_json = ?, visibility_rule_json = ?, participates_in_ai = 1, priority_tier = ?, layer = ?,
        importance = ?, source = 'agent-write', lifecycle = 'active', status = 'confirmed',
        version = COALESCE(version, 1) + 1, updated_at = ?${identitySet}
      WHERE book_id = ? AND id = ? AND deleted_at IS NULL
    `).run(...values);
  } else {
    const columns = [
      "id", "book_id", "section_id", "title", "content_md", "category", "fields_json", "custom_fields_json",
      "parent_id", "sort_order", "lifecycle", "status", "version", "tags_json", "aliases_json",
      "related_chapter_numbers_json", "related_entry_ids_json", "visibility_rule_json", "participates_in_ai",
      "token_budget", "priority_tier", "layer", "importance", "summary_l0", "source", "revision_history",
      "conflict_status", "conflict_detail", "created_at", "updated_at", "deleted_at",
    ];
    const values: unknown[] = [
      entryId, staging.bookId, sectionId.id, staging.proposedTitle, staging.contentMd, options.category,
      JSON.stringify(fields), JSON.stringify(fields), null, 0, "active", "confirmed", 1,
      JSON.stringify(options.tags), JSON.stringify(aliases), "[]", JSON.stringify(options.relatedEntryIds),
      JSON.stringify({ type: options.visibility }), 1, null, options.priorityTier, options.layer, options.importance,
      null, "agent-write", "[]", "none", null, now, now, null,
    ];
    if (hasIdentity) {
      columns.splice(24, 0, "entry_key", "source_refs_json");
      values.splice(24, 0, entryKey, JSON.stringify(sourceRefs));
    }
    storage.sqlite.prepare(`
      INSERT INTO story_jingwei_entry (${columns.join(", ")})
      VALUES (${columns.map(() => "?").join(", ")})
    `).run(...values);
  }

  const row = storage.sqlite.prepare(`
    SELECT id FROM story_jingwei_entry WHERE book_id = ? AND id = ?
  `).get(staging.bookId, entryId) as { id: string } | undefined;
  if (!row) throw new Error("promoted-entry-not-found");
  return { action: existing ? "updated" : "created", entryId };
}

function resolveImportance(raw: unknown, priorityTier: string): number {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.max(0, Math.min(100, Math.round(raw)));
  }
  switch (priorityTier) {
    case "core": return 80;
    case "relevant": return 50;
    case "reference": return 20;
    default: return 40; // auto
  }
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export async function handleJingweiWrite(
  input: JingweiWriteInput,
  options: { readonly storage?: StorageDatabase } = {},
): Promise<JingweiWriteResult> {
  const storage = options.storage ?? getStorageDatabase();
  const entryRepo = createStoryJingweiEntryRepository(storage);

  // Parse & validate input
  let bookId = String(input.bookId);
  let title = String(input.title || "").trim();
  const action =
    input.action === "delete"
      ? "delete"
      : input.action === "create"
        ? "create"
        : input.action === "update"
          ? "update"
          : input.action === "retire"
            ? "retire"
            : undefined;

  const stagingId = typeof input.stagingId === "string" ? input.stagingId.trim() : "";
  const stagingDecision = input.stagingDecision === "reject" ? "reject" : input.stagingDecision === "promote" ? "promote" : undefined;
  let staging: ReturnType<typeof getDissectionStaging> | null = null;
  if (stagingDecision && !stagingId) {
    return { ok: false, error: "staging-id-required", summary: "stagingDecision 必须与 stagingId 一起提供。" };
  }
  if (stagingId) {
    staging = getDissectionStaging(storage, bookId, stagingId);
    if (!staging) return { ok: false, error: "staging-not-found", summary: "拆书暂存的候选不存在。" };
    if (staging.status !== "needs-review") return { ok: false, error: "staging-not-pending", summary: "该候选已处理过，不能重复操作。" };
    if (!stagingDecision) return { ok: false, error: "staging-decision-required", summary: "提供 stagingId 时必须明确 stagingDecision：promote 或 reject。" };
    if (stagingDecision === "reject") {
      try {
        withPendingDissectionStaging(storage, bookId, stagingId, "rejected", () => undefined);
        return {
          ok: true,
          summary: `已拒绝拆书候选「${staging.proposedTitle}」，不进入正式经纬。`,
          data: { action: "retired", entryId: stagingId, bookId, category: staging.category, title: staging.proposedTitle },
        };
      } catch (error) {
        if (error instanceof Error && error.message === "staging-not-pending") {
          return { ok: false, error: "staging-not-pending", summary: "该候选已处理过，不能重复操作。" };
        }
        return { ok: false, error: "staging-reject-failed", summary: `拒绝拆书候选失败：${error instanceof Error ? error.message : String(error)}` };
      }
    }
    if (!hasStagingEvidence(staging)) {
      return { ok: false, error: "staging-missing-evidence", summary: "候选没有正文证据，不能提升进正式经纬。" };
    }
    if (action === "delete" || action === "retire") {
      return { ok: false, error: "staging-action-invalid", summary: "staging 候选只能通过 stagingDecision=promote/reject 处理，不能与 delete/retire 混用。" };
    }
    title = staging.proposedTitle;
  }

  if (!title && !input.entryId) {
    return { ok: false, error: "invalid-input", summary: "title 或 entryId 不能都为空。" };
  }

  // Validate bookId — strict match only
  const bookExists = storage.sqlite.prepare(`SELECT id FROM book WHERE id = ?`).get(bookId) as { id: string } | undefined;
  if (!bookExists) {
    const available = (storage.sqlite.prepare("SELECT id FROM book LIMIT 5").all() as Array<{ id: string }>).map(r => r.id).join(", ");
    return { ok: false, error: "book-not-found", summary: `bookId "${bookId}" 在数据库中不存在。可用的书籍：${available}` };
  }

  // ─── DELETE action ───
  if (action === "delete") {
    try {
      // Find entry by ID or title
      const entryId = input.entryId ? String(input.entryId) : undefined;
      let targetId: string | undefined;

      if (entryId) {
        const row = storage.sqlite.prepare(`SELECT id, layer FROM story_jingwei_entry WHERE book_id = ? AND id = ? AND deleted_at IS NULL`).get(bookId, entryId) as { id: string; layer?: string } | undefined;
        if (!row) return { ok: false, error: "entry-not-found", summary: `条目 ID "${entryId}" 不存在。` };
        if (row.layer === "canon") {
          return {
            ok: false,
            error: "canon-immutable",
            summary: "Canon 条目不能硬删除。若内容错误或过期，请使用 action=retire + confirmCanonEdit=true + reason（退出 AI，保留审计）。",
          };
        }
        targetId = row.id;
      } else {
        const row = storage.sqlite.prepare(`SELECT id, layer FROM story_jingwei_entry WHERE book_id = ? AND title = ? AND deleted_at IS NULL`).get(bookId, title) as { id: string; layer?: string } | undefined;
        if (!row) return { ok: false, error: "entry-not-found", summary: `条目「${title}」不存在。` };
        if (row.layer === "canon") {
          return {
            ok: false,
            error: "canon-immutable",
            summary: `Canon 条目「${title}」不能硬删除。请使用 action=retire + confirmCanonEdit=true + reason。`,
          };
        }
        targetId = row.id;
      }

      await entryRepo.softDelete(bookId, targetId, new Date());
      return { ok: true, summary: `已删除经纬条目「${title || targetId}」。`, data: { action: "deleted", entryId: targetId, bookId } };
    } catch (error) {
      return { ok: false, error: "delete-failed", summary: `删除失败：${error instanceof Error ? error.message : String(error)}` };
    }
  }

  // ─── RETIRE action（含 canon：退出 AI，不改 layer/正文） ───
  if (action === "retire") {
    try {
      const entryId = input.entryId ? String(input.entryId) : undefined;
      const reason = String(input.reason || "").trim();
      if (!reason) {
        return {
          ok: false,
          error: "invalid-input",
          summary: "retire 必须提供 reason（说明为何退役，供审计）。",
        };
      }

      type RetireRow = {
        id: string;
        title: string;
        layer?: string | null;
        category?: string | null;
        content_md?: string | null;
      };
      let row: RetireRow | undefined;
      if (entryId) {
        row = storage.sqlite
          .prepare(
            `SELECT id, title, layer, category, content_md FROM story_jingwei_entry WHERE book_id = ? AND id = ? AND deleted_at IS NULL`,
          )
          .get(bookId, entryId) as RetireRow | undefined;
        if (!row) return { ok: false, error: "entry-not-found", summary: `条目 ID "${entryId}" 不存在或已退役。` };
      } else {
        row = storage.sqlite
          .prepare(
            `SELECT id, title, layer, category, content_md FROM story_jingwei_entry WHERE book_id = ? AND title = ? AND deleted_at IS NULL`,
          )
          .get(bookId, title) as RetireRow | undefined;
        if (!row) return { ok: false, error: "entry-not-found", summary: `条目「${title}」不存在或已退役。` };
      }

      const existingLayer = (row.layer as JingweiLayer) || "dynamic";
      if (existingLayer === "canon" && input.confirmCanonEdit !== true) {
        return {
          ok: false,
          error: "canon-confirm-required",
          summary: `退役 Canon 条目「${row.title}」需要 confirmCanonEdit: true，并填写 reason。此操作不会改 layer/正文，只会退出 AI 可读集合。`,
        };
      }

      await entryRepo.retire(bookId, row.id, { reason, changedBy: "agent-retire", retiredAt: new Date() });

      return {
        ok: true,
        summary: `已退役经纬条目「${row.title}」（layer=${existingLayer} 保留；已退出 AI：participates_in_ai=0 + archived）。`,
        data: {
          action: "retired",
          entryId: row.id,
          bookId,
          category: row.category ?? undefined,
          title: row.title,
          layer: existingLayer,
        },
      };
    } catch (error) {
      return {
        ok: false,
        error: "retire-failed",
        summary: `退役失败：${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  // ─── CREATE / UPDATE action ───
  const contentMd = staging && stagingDecision === "promote" ? staging.contentMd : String(input.contentMd || "");
  if (!contentMd && action === "create") {
    return { ok: false, error: "invalid-input", summary: "创建条目时 contentMd 不能为空。" };
  }

  // Validate action value
  if (input.action && !["create", "update", "delete", "retire"].includes(input.action)) {
    return {
      ok: false,
      error: "invalid-action",
      summary: `无效的 action 值「${input.action}」。可选值：create | update | delete | retire。`,
    };
  }

  const rawCategory = staging && stagingDecision === "promote" ? staging.category : String(input.category || "").trim();
  const explicitLayer: JingweiLayer | null = (input.layer === "canon" || input.layer === "dynamic" || input.layer === "reference")
    ? input.layer
    : null;
  const aliases = staging && stagingDecision === "promote"
    ? [...staging.aliases]
    : (Array.isArray(input.aliases) ? input.aliases.filter((a): a is string => typeof a === "string") : []);
  const tags = Array.isArray(input.tags) ? input.tags.filter((t): t is string => typeof t === "string") : [];
  const visibility = String(input.visibility || "tracked");
  const priorityTier = (input.priorityTier === "core" || input.priorityTier === "relevant" || input.priorityTier === "reference" || input.priorityTier === "auto")
    ? input.priorityTier
    : "auto";
  const importance = resolveImportance(input.importance, priorityTier);
  const relatedEntryIds = Array.isArray(input.relatedEntryIds)
    ? input.relatedEntryIds.filter((id): id is string => typeof id === "string")
    : [];
  const entryStatus = (input.status === "draft" || input.status === "confirmed" || input.status === "needs-review")
    ? input.status
    : "confirmed";

  const rawInferred = inferCategory(rawCategory, title, contentMd);
  const category = normalizeCategoryLegacy(rawInferred);

  // 分类表态：层级由分类的 defaultLayer 决定（写入方未显式指定时），
  // 是否允许 canon 由 allowCanon 决定 —— 取代此前按内容/分类名正则猜测。
  const layer: JingweiLayer = explicitLayer ?? getCategoryDefaultLayer(category);
  const isRulesCategory = /(^|[-_])(rules?|rule|platform|book-rules)([-_]|$)|规则/.test(category) || /平台规则|书籍规则|规则/.test(title);
  const writesProtectedLore = layer === "canon" || isRulesCategory;
  const reason = String(input.reason || (staging && stagingDecision === "promote" ? staging.classificationReason : "")).trim();
  const sourceOrEvidence = String(input.source || input.evidence || (staging && stagingDecision === "promote" ? staging.sourceRefs[0]?.excerpt : "")).trim();

  // 1) 分类不允许 canon 时，禁止把随剧情推进的对象写成不可变真相。
  if (layer === "canon" && !categoryAllowsCanon(category)) {
    return {
      ok: false,
      error: "canon-not-allowed-for-category",
      summary: `分类「${category}」随剧情推进，不能写入 canon 层。请使用 layer=dynamic（作者可审的结构性账本）或 reference（纯参考资料）。`,
    };
  }

  // 2) 结构性账本分类（卷纲/伏笔/章摘要）是经纬的权威承载，允许 dynamic 写入；
  //    其余分类若内容像「逐章变化记录」，仍应进 Narrative Memory 而不是经纬。
  const isLedgerCategory = LEDGER_CATEGORIES.has(category);
  const titleLooksDynamicChapter =
    /第\s*[\d一二三四五六七八九十百千]+\s*章/.test(title)
    && /(关系|状态|伏笔|时间线|结算|事件变化|叙事事件)/.test(title);
  const bodyLooksDynamicSettlement = /(关系变化|状态变化|伏笔推进|时间线推进|本章结算|叙事事件)/.test(`${title}\n${contentMd}`);
  if (!isLedgerCategory && (titleLooksDynamicChapter || bodyLooksDynamicSettlement) && layer !== "reference" && !writesProtectedLore) {
    return {
      ok: false,
      error: "dynamic-memory-boundary",
      summary: "内容像章后动态变化（关系/状态/伏笔/时间线），请进入 Narrative Memory，而不是经纬。结构性账本请用 outline / foreshadowing / chapter-summaries 分类；静态参考可改用 layer=reference。",
    };
  }

  if (writesProtectedLore && (!reason || !sourceOrEvidence)) {
    return {
      ok: false,
      error: "lore-write-gate-required",
      summary: "写入 canon 或 rules 类 Lore 静态设定时，必须提供 reason，并提供 source 或 evidence。动态事实请进入 memory.events / Narrative Memory 流程。",
    };
  }

  if (!title) {
    return { ok: false, error: "invalid-input", summary: "title 不能为空。" };
  }

  if (staging && stagingDecision === "promote") {
    try {
      const promoted = withPendingDissectionStaging(storage, bookId, staging.id, "accepted", (pending) =>
        promoteStagingEntry(storage, pending, {
          category,
          layer,
          tags,
          relatedEntryIds,
          visibility,
          priorityTier,
          importance,
          preferredEntryId: input.entryId,
          confirmCanonEdit: input.confirmCanonEdit === true,
          now: new Date(),
        }),
      );
      return {
        ok: true,
        summary: `${promoted.action === "updated" ? "已更新" : "已创建"}经纬条目「${staging.proposedTitle}」（${category}，layer=${layer}，staging 已 accepted）。`,
        data: { action: promoted.action, entryId: promoted.entryId, bookId, category, title: staging.proposedTitle, layer },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === "staging-not-pending") return { ok: false, error: "staging-not-pending", summary: "该候选已处理过，不能重复操作。" };
      if (message === "duplicate-review-required") return { ok: false, error: "duplicate-review-required", summary: "存在多个重复候选，必须显式指定 entryId。" };
      if (message === "canon-confirm-required") return { ok: false, error: "canon-confirm-required", summary: `Canon 条目「${staging.proposedTitle}」需要确认后才能修改。` };
      if (message === "canon-immutable") return { ok: false, error: "canon-immutable", summary: "Canon 条目的 layer 不能被修改。" };
      return { ok: false, error: "write-failed", summary: `经纬提升失败，数据已回滚：${message}` };
    }
  }

  try {
    // Ensure section exists
    const sectionRows = storage.sqlite.prepare(
      `SELECT id FROM story_jingwei_section WHERE book_id = ? AND key = ?`
    ).all(bookId, category) as Array<{ id: string }>;

    let sectionId: string;
    if (sectionRows.length > 0) {
      sectionId = sectionRows[0]!.id;
    } else {
      sectionId = crypto.randomUUID();
      const name = CATEGORY_NAMES[category] ?? category;
      const sectionNow = Date.now();
      storage.sqlite.prepare(`
        INSERT INTO story_jingwei_section (id, book_id, key, name, description, "order", enabled, show_in_sidebar, participates_in_ai, default_visibility, fields_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, '', 0, 1, 1, 1, 'tracked', '[]', ?, ?)
      `).run(sectionId, bookId, category, name, sectionNow, sectionNow);
    }

    // Find existing entry by title
    let targetEntryId = input.entryId;
    if (!targetEntryId && input.entryKey) {
      const match = storage.sqlite.prepare(`SELECT id FROM story_jingwei_entry WHERE book_id = ? AND entry_key = ? AND deleted_at IS NULL`).get(bookId, input.entryKey) as any;
      if (match) targetEntryId = match.id;
    }
    const existingRows = targetEntryId ? storage.sqlite.prepare(`SELECT id, section_id, content_md, layer, category FROM story_jingwei_entry WHERE book_id = ? AND id = ? AND deleted_at IS NULL`).all(bookId, targetEntryId) as any[] : storage.sqlite.prepare(
      `SELECT id, section_id, content_md, layer, category FROM story_jingwei_entry WHERE book_id = ? AND title = ? AND category = ? AND deleted_at IS NULL`
    ).all(bookId, title, category) as Array<{ id: string; section_id: string; content_md: string; layer: string | null; category: string | null }>;

    const fields = input.fields && typeof input.fields === "object" ? input.fields : undefined;
    const now = new Date();

    if (existingRows.length > 0) {
      const existing = existingRows[0]!;
      const existingLayer = (existing.layer as JingweiLayer) || "dynamic";

      // Canon write protection: requires explicit confirmation
      if (existingLayer === "canon") {
        if (input.confirmCanonEdit !== true) {
          return {
            ok: false,
            error: "canon-confirm-required",
            summary: `Canon 条目「${title}」需要确认后才能修改。请添加 confirmCanonEdit: true 参数确认修改。`,
          };
        }
        // Critical fix: Canon 条目的 layer 不能被降级（防止先降级再删除的绕过攻击）
        if (layer !== "canon") {
          return {
            ok: false,
            error: "canon-immutable",
            summary: "Canon 条目的 layer 不能被修改。如需废弃，请联系管理员。",
          };
        }
        // Content protection: only check if contentMd is actually provided and different
        // (allows category/metadata-only updates without triggering canon protection)
        const oldContent = existing.content_md;
        if (contentMd && oldContent && oldContent.length > 0 && !contentMd.startsWith(oldContent)) {
          return {
            ok: false,
            error: "canon-immutable",
            summary: "Canon 条目只能追加内容，不能修改已有部分。",
          };
        }
      }

      // Append mode: concatenate new content to existing content
      let finalContentMd = contentMd;
      if (input.mode === "append" && existing.content_md && existing.content_md.trim().length > 0 && contentMd) {
        finalContentMd = existing.content_md + "\n\n" + contentMd;
      }

      const entryId = existing.id;
      const updated = await entryRepo.update(bookId, entryId, {
        contentMd: finalContentMd,
        ...(input.summaryMd !== undefined ? { summaryMd: input.summaryMd } : {}),
        tags,
        aliases,
        ...(input.entryKey ? { entryKey: input.entryKey } : {}),
        ...(input.sourceRefs ? { sourceRefs: input.sourceRefs } : {}),
        relatedEntryIds,
        visibilityRule: { type: visibility as "tracked" | "global" | "nested" },
        sectionId,
        layer,
        priorityTier,
        importance,
        ...(fields ? { fields, customFields: fields } : {}),
        category,
        status: entryStatus,
        source: "agent-write",
        changedBy: "agent",
        revisionReason: input.reason,
        updatedAt: now,
      });
      if (!updated) throw new Error(`经纬条目不存在：${entryId}`);

      return {
        ok: true,
        summary: `已更新经纬条目「${title}」（${category}，layer=${layer}）。`,
        data: { action: "updated", entryId, bookId, category, title, layer },
      };
    } else {
      const entryId = crypto.randomUUID();
      await entryRepo.create({
        id: entryId,
        bookId,
        sectionId,
        title,
        contentMd,
        summaryMd: input.summaryMd ?? null,
        category,
        fields: fields ?? {},
        customFields: fields ?? {},
        parentId: null,
        sortOrder: 0,
        lifecycle: "active",
        status: entryStatus,
        version: 1,
        tags,
        aliases,
        ...(input.entryKey ? { entryKey: input.entryKey } : {}),
        ...(input.sourceRefs ? { sourceRefs: input.sourceRefs } : {}),
        relatedChapterNumbers: [],
        relatedEntryIds,
        visibilityRule: { type: visibility as "tracked" | "global" | "nested" },
        participatesInAi: true,
        tokenBudget: null,
        layer,
        priorityTier,
        importance,
        source: "agent-write",
        createdAt: now,
        updatedAt: now,
      });

      return {
        ok: true,
        summary: `已创建经纬条目「${title}」（${category}，layer=${layer}）。`,
        data: { action: "created", entryId, bookId, category, title, layer },
      };
    }
  } catch (error) {
    return {
      ok: false,
      error: "write-failed",
      summary: `经纬写入失败：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
