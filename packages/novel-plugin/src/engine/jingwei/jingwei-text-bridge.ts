/**
 * jingwei-text-bridge.ts — 经纬 DB → 纯文本桥接层
 *
 * 从经纬 SQLite 数据库读取条目，格式化为纯文本输出。
 * 替代旧的 InkOS 机制（从 books/<bookId>/story/*.md 文件读取设定数据）。
 *
 * 映射关系：
 *   story_bible.md     → 全部 participatesInAi=true 条目
 *   current_state.md   → category = world-model
 *   pending_hooks.md   → category = foreshadowing
 *   volume_outline.md  → category = outline
 *   particle_ledger.md → category = props
 *   book_rules.md      → category = rules
 */

import { getStorageDatabase, type StorageDatabase } from "@vivy1024/novelfork-core/storage";

// ---------- types ----------

interface RawEntryRow {
  id: string;
  title: string;
  content_md: string;
  priority_tier: string | null;
  category: string | null;
}

// priority tier 排序权重：core > relevant > reference > auto/其他
const PRIORITY_ORDER: Record<string, number> = {
  core: 0,
  relevant: 1,
  reference: 2,
  auto: 3,
};

function priorityWeight(tier: string | null): number {
  return PRIORITY_ORDER[tier ?? "auto"] ?? 3;
}

// ---------- internal helpers ----------

function formatEntries(rows: RawEntryRow[]): string {
  const sorted = rows
    .filter((row) => row.content_md && row.content_md.trim().length > 0)
    .sort((a, b) => priorityWeight(a.priority_tier) - priorityWeight(b.priority_tier));

  if (sorted.length === 0) return "";

  return sorted
    .map((row) => `## ${row.title}\n${row.content_md}`)
    .join("\n\n")
    .trim();
}

/**
 * 查询指定分类的条目（通过 entry 表上的 category 列 + section 的 key/builtinKind 联合匹配）。
 * 兼容两种分类来源：
 *   1. overhaul 迁移后 entry 表直接有 category 列
 *   2. 旧数据通过 section.key 或 section.builtin_kind 确定分类
 */
function queryByCategory(storage: StorageDatabase, bookId: string, category: string): RawEntryRow[] {
  // 使用 UNION 合并两种查询路径，避免重复
  const sql = `
    SELECT DISTINCT e."id", e."title", e."content_md", COALESCE(e."priority_tier", 'auto') AS "priority_tier", e."category"
    FROM "story_jingwei_entry" e
    WHERE e."book_id" = ?
      AND e."deleted_at" IS NULL
      AND e."participates_in_ai" = 1
      AND (
        e."category" = ?
        OR e."section_id" IN (
          SELECT s."id" FROM "story_jingwei_section" s
          WHERE s."book_id" = ? AND s."deleted_at" IS NULL
            AND (s."key" = ? OR s."builtin_kind" = ?)
        )
      )
  `;
  return storage.sqlite.prepare(sql).all(bookId, category, bookId, category, category) as RawEntryRow[];
}

function queryAllForAi(storage: StorageDatabase, bookId: string): RawEntryRow[] {
  const sql = `
    SELECT e."id", e."title", e."content_md", COALESCE(e."priority_tier", 'auto') AS "priority_tier", e."category"
    FROM "story_jingwei_entry" e
    WHERE e."book_id" = ?
      AND e."deleted_at" IS NULL
      AND e."participates_in_ai" = 1
  `;
  return storage.sqlite.prepare(sql).all(bookId) as RawEntryRow[];
}

// ---------- public API ----------

/**
 * 读取单个分类的经纬文本（替代从对应 MD 文件读取）。
 *
 * @param bookId - 书籍 ID
 * @param category - 经纬分类（如 "world-model", "foreshadowing", "outline", "props", "rules"）
 * @param storage - 可选，传入已有的 StorageDatabase 实例
 */
export async function loadJingweiCategoryAsText(
  bookId: string,
  category: string,
  storage?: StorageDatabase,
): Promise<string> {
  const db = storage ?? getStorageDatabase();
  const rows = queryByCategory(db, bookId, category);
  return formatEntries(rows);
}

/**
 * 读取所有参与 AI 的经纬条目，拼接为完整文本（替代 story_bible.md）。
 *
 * @param bookId - 书籍 ID
 * @param storage - 可选，传入已有的 StorageDatabase 实例
 */
export async function loadJingweiBibleAsText(
  bookId: string,
  storage?: StorageDatabase,
): Promise<string> {
  const db = storage ?? getStorageDatabase();
  const rows = queryAllForAi(db, bookId);
  return formatEntries(rows);
}

/**
 * 批量读取多个分类，返回 Record<category, text>。
 *
 * @param bookId - 书籍 ID
 * @param categories - 要读取的分类列表
 * @param storage - 可选，传入已有的 StorageDatabase 实例
 */
export async function loadJingweiCategoriesAsText(
  bookId: string,
  categories: string[],
  storage?: StorageDatabase,
): Promise<Record<string, string>> {
  const db = storage ?? getStorageDatabase();
  const result: Record<string, string> = {};
  for (const category of categories) {
    result[category] = formatEntries(queryByCategory(db, bookId, category));
  }
  return result;
}

/**
 * 兼容层：模拟旧 loadJingweiFiles 的返回格式。
 * 方便逐步迁移——消费方可以先用这个，再逐步改为直接调用上面的函数。
 *
 * @param bookId - 书籍 ID
 * @param storage - 可选，传入已有的 StorageDatabase 实例
 */
export async function loadJingweiFilesFromDB(
  bookId: string,
  storage?: StorageDatabase,
): Promise<{
  currentState: string;
  particleLedger: string;
  pendingHooks: string;
  storyBible: string;
  volumeOutline: string;
  bookRules: string;
}> {
  const db = storage ?? getStorageDatabase();
  const [currentState, particleLedger, pendingHooks, storyBible, volumeOutline, bookRules] = await Promise.all([
    loadJingweiCategoryAsText(bookId, "world-model", db),
    loadJingweiCategoryAsText(bookId, "props", db),
    loadJingweiCategoryAsText(bookId, "foreshadowing", db),
    loadJingweiBibleAsText(bookId, db),
    loadJingweiCategoryAsText(bookId, "outline", db),
    loadJingweiCategoryAsText(bookId, "rules", db),
  ]);

  return {
    currentState,
    particleLedger,
    pendingHooks,
    storyBible,
    volumeOutline,
    bookRules,
  };
}
