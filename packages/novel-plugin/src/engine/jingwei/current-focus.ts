/**
 * 创作罗盘（current-focus）——经纬单例条目的字段约定与读写。
 *
 * 不新增第 17 个统一分类：落库 category 仍用自由值 `current-focus`
 *（jingwei-write 允许非枚举类目）。驾驶舱 / 写章管线 / 写作侧栏共用本模块，
 * 避免再各写一套解析。
 */
interface FocusStorage {
  readonly sqlite: {
    prepare<T>(sql: string): { get: (bookId: string) => T | undefined };
  };
}

export const CURRENT_FOCUS_CATEGORY = "current-focus";
export const CURRENT_FOCUS_TITLE = "创作罗盘";

export interface CurrentFocusFields {
  readonly goal: string;
  readonly mustKeep: string;
  readonly mustAvoid: string;
  readonly notes: string;
}

export function emptyCurrentFocus(): CurrentFocusFields {
  return { goal: "", mustKeep: "", mustAvoid: "", notes: "" };
}

function textField(fields: Record<string, unknown> | undefined, ...keys: string[]): string {
  for (const key of keys) {
    const value = fields?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

export function parseCurrentFocusFields(fields: Record<string, unknown> | undefined): CurrentFocusFields {
  return {
    goal: textField(fields, "goal"),
    mustKeep: textField(fields, "mustKeep", "must_keep"),
    mustAvoid: textField(fields, "mustAvoid", "must_avoid"),
    notes: textField(fields, "notes"),
  };
}

export function currentFocusHasContent(fields: CurrentFocusFields): boolean {
  return Boolean(fields.goal || fields.mustKeep || fields.mustAvoid || fields.notes);
}

/**
 * 序列化为驾驶舱 / 写章上下文可读文本。
 * 第一行必须是本章目标（无标题），供 directiveFromFocus 直接取用。
 */
export function serializeCurrentFocusDoc(fields: CurrentFocusFields): string {
  const blocks: string[] = [];
  if (fields.goal) blocks.push(fields.goal);
  if (fields.mustKeep) blocks.push(`必须守住：\n${fields.mustKeep}`);
  if (fields.mustAvoid) blocks.push(`必须避开：\n${fields.mustAvoid}`);
  if (fields.notes) blocks.push(`备注：\n${fields.notes}`);
  return blocks.join("\n\n").trim();
}

export function isPlaceholderFocusDoc(content: string | null | undefined): boolean {
  const text = (content ?? "").trim();
  if (!text) return true;
  if (/^#\s*(当前聚焦|Current Focus)/u.test(text) && /（描述接下来|Describe what the next/u.test(text)) {
    return true;
  }
  const meaningful = text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#") && line !== "（在这里描述这本书的长期创作方向。）");
  return meaningful.length === 0;
}

export function selectCurrentFocusEntry<T extends { category?: string; updatedAt?: string | Date }>(
  entries: readonly T[],
): T | undefined {
  const matches = entries.filter((entry) => entry.category === CURRENT_FOCUS_CATEGORY || entry.category === "focus");
  if (matches.length === 0) return undefined;
  return [...matches].sort((left, right) => String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? "")))[0];
}

/** 从经纬 SQLite 读出创作罗盘正文；没有有效内容时返回 null（调用方再回退大纲/md）。 */
export function readCurrentFocusDocFromStorage(storage: FocusStorage, bookId: string): string | null {
  const row = storage.sqlite.prepare<{
    content_md: string | null;
    fields_json: string | null;
  }>(`
    SELECT content_md, fields_json
    FROM story_jingwei_entry
    WHERE book_id = ? AND category IN ('current-focus', 'focus') AND deleted_at IS NULL
    ORDER BY updated_at DESC
    LIMIT 1
  `).get(bookId);
  if (!row) return null;
  let fields: Record<string, unknown> = {};
  try {
    fields = JSON.parse(row.fields_json ?? "{}") as Record<string, unknown>;
  } catch {
    fields = {};
  }
  const parsed = parseCurrentFocusFields(fields);
  if (currentFocusHasContent(parsed)) return serializeCurrentFocusDoc(parsed);
  const markdown = (row.content_md ?? "").trim();
  if (markdown && !isPlaceholderFocusDoc(markdown)) return markdown;
  return null;
}
