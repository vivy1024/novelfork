/**
 * jingwei.write handler — 经纬写入工具，支持 layer 分层与 canon 写入保护。
 *
 * layer 语义：
 * - canon: 不可变真相，只能追加内容，不能修改已有部分
 * - dynamic: 每章可更新（默认）
 * - reference: 按需查阅的参考资料
 */
import { getStorageDatabase } from "@vivy1024/novelfork-core";
import type { JingweiLayer } from "../engine/jingwei/types.js";
import { LEGACY_CATEGORY_MAP, JINGWEI_CATEGORIES } from "../engine/jingwei/unified-categories.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface JingweiWriteInput {
  bookId: string;
  action?: "create" | "update" | "delete";
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
  fields?: Record<string, unknown>;
  mode?: "overwrite" | "append";
  /** 优先层级，影响默认 importance 与注入详细度 */
  priorityTier?: "core" | "relevant" | "reference" | "auto";
  /** 重要度评分 0-100，省略时按 priorityTier 映射 */
  importance?: number;
  /** 确认修改 canon 条目（canon 条目更新时必须为 true） */
  confirmCanonEdit?: boolean;
  /** 条目状态 */
  status?: "draft" | "confirmed" | "needs-review";
  /** 变更原因（存入 revision history） */
  reason?: string;
}

export interface JingweiWriteSuccess {
  ok: true;
  summary: string;
  data: {
    action: "created" | "updated" | "deleted";
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

export async function handleJingweiWrite(input: JingweiWriteInput): Promise<JingweiWriteResult> {
  const storage = getStorageDatabase();

  // Parse & validate input
  let bookId = String(input.bookId);
  const title = String(input.title || "").trim();
  const action = input.action === "delete" ? "delete" : input.action === "create" ? "create" : input.action === "update" ? "update" : undefined;

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
        if (row.layer === "canon") return { ok: false, error: "canon-immutable", summary: "Canon 条目不能删除。如需废弃，请将其 layer 改为 reference。" };
        targetId = row.id;
      } else {
        const row = storage.sqlite.prepare(`SELECT id, layer FROM story_jingwei_entry WHERE book_id = ? AND title = ? AND deleted_at IS NULL`).get(bookId, title) as { id: string; layer?: string } | undefined;
        if (!row) return { ok: false, error: "entry-not-found", summary: `条目「${title}」不存在。` };
        if (row.layer === "canon") return { ok: false, error: "canon-immutable", summary: `Canon 条目「${title}」不能删除。如需废弃，请将其 layer 改为 reference。` };
        targetId = row.id;
      }

      const now = Date.now();
      storage.sqlite.prepare(`UPDATE story_jingwei_entry SET deleted_at = ?, updated_at = ? WHERE id = ?`).run(now, now, targetId);
      return { ok: true, summary: `已删除经纬条目「${title || targetId}」。`, data: { action: "deleted", entryId: targetId, bookId } };
    } catch (error) {
      return { ok: false, error: "delete-failed", summary: `删除失败：${error instanceof Error ? error.message : String(error)}` };
    }
  }

  // ─── CREATE / UPDATE action ───
  const contentMd = String(input.contentMd || "");
  if (!contentMd && action === "create") {
    return { ok: false, error: "invalid-input", summary: "创建条目时 contentMd 不能为空。" };
  }

  // Validate action value
  if (input.action && !["create", "update", "delete"].includes(input.action)) {
    return { ok: false, error: "invalid-action", summary: `无效的 action 值「${input.action}」。可选值：create | update | delete。` };
  }

  const rawCategory = String(input.category || "").trim();
  const layer: JingweiLayer = (input.layer === "canon" || input.layer === "dynamic" || input.layer === "reference")
    ? input.layer
    : "dynamic";
  const aliases = Array.isArray(input.aliases) ? input.aliases.filter((a): a is string => typeof a === "string") : [];
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

  if (!title) {
    return { ok: false, error: "invalid-input", summary: "title 不能为空。" };
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
    const existingRows = storage.sqlite.prepare(
      `SELECT id, section_id, content_md, layer, category FROM story_jingwei_entry WHERE book_id = ? AND title = ? AND deleted_at IS NULL`
    ).all(bookId, title) as Array<{ id: string; section_id: string; content_md: string; layer: string | null; category: string | null }>;

    const visibilityJson = JSON.stringify({ type: visibility });
    const aliasesJson = JSON.stringify(aliases);
    const tagsJson = JSON.stringify(tags);
    const relatedEntryIdsJson = JSON.stringify(relatedEntryIds);
    const fieldsJson = input.fields && typeof input.fields === "object"
      ? JSON.stringify(input.fields)
      : "{}";
    const now = Date.now();

    if (existingRows.length > 0) {
      const existing = existingRows[0]!;
      const existingLayer = (existing.layer as JingweiLayer) || "dynamic";
      const existingCategory = existing.category || "unclassified";

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

      // Save revision before overwriting
      const revisionId = crypto.randomUUID();
      storage.sqlite.prepare(`
        INSERT INTO jingwei_revision (id, entry_id, book_id, content_md, category, layer, reason, changed_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(revisionId, existing.id, bookId, existing.content_md, existingCategory, existingLayer, input.reason ?? null, "agent", now);

      // Append mode: concatenate new content to existing content
      let finalContentMd = contentMd;
      if (input.mode === "append" && existing.content_md && existing.content_md.trim().length > 0 && contentMd) {
        finalContentMd = existing.content_md + "\n\n" + contentMd;
      }

      // Update existing entry (version increment + no summary generation)
      const entryId = existing.id;
      storage.sqlite.prepare(`
        UPDATE story_jingwei_entry
        SET content_md = ?, tags_json = ?, aliases_json = ?, related_entry_ids_json = ?, visibility_rule_json = ?, section_id = ?, layer = ?, priority_tier = ?, importance = ?, custom_fields_json = ?, category = ?, status = ?, version = version + 1, updated_at = ?
        WHERE id = ?
      `).run(finalContentMd, tagsJson, aliasesJson, relatedEntryIdsJson, visibilityJson, sectionId, layer, priorityTier, importance, fieldsJson, category, entryStatus, now, entryId);

      return {
        ok: true,
        summary: `已更新经纬条目「${title}」（${category}，layer=${layer}）。`,
        data: { action: "updated", entryId, bookId, category, title, layer },
      };
    } else {
      // Create new entry
      const entryId = crypto.randomUUID();
      storage.sqlite.prepare(`
        INSERT INTO story_jingwei_entry (id, book_id, section_id, title, content_md, tags_json, aliases_json, custom_fields_json, related_chapter_numbers_json, related_entry_ids_json, visibility_rule_json, participates_in_ai, token_budget, layer, priority_tier, importance, status, version, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, 1, NULL, ?, ?, ?, ?, 1, ?, ?)
      `).run(entryId, bookId, sectionId, title, contentMd, tagsJson, aliasesJson, fieldsJson, relatedEntryIdsJson, visibilityJson, layer, priorityTier, importance, entryStatus, now, now);

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
