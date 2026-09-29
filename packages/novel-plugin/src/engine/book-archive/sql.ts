/**
 * 档案读写用到的 SQLite 小工具。表名、列名只来自 registry 与目标库的 PRAGMA，
 * 从不直接使用档案里的字符串拼 SQL；值一律走参数绑定。
 */
import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";

export interface TableColumnInfo {
  readonly name: string;
  readonly type: string;
  readonly notNull: boolean;
  readonly hasDefault: boolean;
  /** 主键中的序号（从 1 起）；0 表示不是主键列。 */
  readonly pk: number;
}

export function quoteIdentifier(name: string): string {
  return `"${name.replaceAll("\"", "\"\"")}"`;
}

export function tableExists(storage: StorageDatabase, table: string): boolean {
  return Boolean(
    storage.sqlite.prepare<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table),
  );
}

export function listTableColumns(storage: StorageDatabase, table: string): TableColumnInfo[] {
  return storage.sqlite
    .prepare<{ name: string; type: string; notnull: number; dflt_value: unknown; pk: number }>(`PRAGMA table_info(${quoteIdentifier(table)})`)
    .all()
    .map((column) => ({
      name: column.name,
      type: (column.type ?? "").toUpperCase(),
      notNull: column.notnull === 1,
      hasDefault: column.dflt_value !== null && column.dflt_value !== undefined,
      pk: column.pk,
    }));
}

/** 单列 TEXT 主键的列名（这类主键是「自有 ID」，导入时要重映射）；其余情况返回 null。 */
export function ownedIdColumn(storage: StorageDatabase, table: string): string | null {
  const pkColumns = listTableColumns(storage, table).filter((column) => column.pk > 0);
  if (pkColumns.length !== 1) return null;
  const [column] = pkColumns;
  return column!.type.includes("INT") ? null : column!.name;
}

/** 单列 INTEGER 主键（rowid 别名）的列名：导入时丢弃原值，由目标库重新分配。 */
export function integerRowIdColumn(storage: StorageDatabase, table: string): string | null {
  const pkColumns = listTableColumns(storage, table).filter((column) => column.pk > 0);
  if (pkColumns.length !== 1) return null;
  const [column] = pkColumns;
  return column!.type === "INTEGER" ? column!.name : null;
}

export function selectBookRows(
  storage: StorageDatabase,
  table: string,
  bookId: string,
  parent?: { readonly table: string; readonly column: string },
  options: { readonly countOnly?: boolean } = {},
): Record<string, unknown>[] {
  const projection = options.countOnly ? "COUNT(*) AS count" : "*";
  const order = options.countOnly ? "" : " ORDER BY rowid";
  const sql = parent
    ? `SELECT ${projection} FROM ${quoteIdentifier(table)} WHERE ${quoteIdentifier(parent.column)} IN (SELECT id FROM ${quoteIdentifier(parent.table)} WHERE book_id = ?)${order}`
    : `SELECT ${projection} FROM ${quoteIdentifier(table)} WHERE book_id = ?${order}`;
  try {
    return storage.sqlite.prepare<Record<string, unknown>>(sql).all(bookId);
  } catch (error) {
    // WITHOUT ROWID 表没有 rowid，退回不排序。
    if (!options.countOnly && /rowid/iu.test(error instanceof Error ? error.message : "")) {
      return storage.sqlite.prepare<Record<string, unknown>>(sql.replace(" ORDER BY rowid", "")).all(bookId);
    }
    throw error;
  }
}
