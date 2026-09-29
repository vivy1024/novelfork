/**
 * 项目档案导出：一本书的书目录文件 + 产品库里按书存储的各表 → 单个 zip。
 *
 * 档案布局：
 *   manifest.json              清单：格式版本、导出时间、NovelFork 版本、源 bookId、模块清单（条目数与哈希）
 *   files/<相对路径>            书目录文件（book.json 必带）
 *   tables/<表名>.jsonl         各表一行一条记录
 */
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";

import {
  BookArchiveError,
  FILES_PREFIX,
  MANIFEST_PATH,
  TABLES_PREFIX,
  type BookArchiveManifest,
  type BookArchiveManifestFile,
  type BookArchiveManifestModule,
  type BookArchiveManifestTable,
  type BookArchiveNotIncluded,
  type BookArchiveWarning,
} from "./manifest.js";
import {
  ARCHIVE_TABLES,
  BOOK_ARCHIVE_FORMAT,
  BOOK_ARCHIVE_FORMAT_VERSION,
  BOOK_ARCHIVE_MODULE_IDS,
  BOOK_ARCHIVE_MODULES,
  NOT_ARCHIVED_RUNTIME,
  NOT_ARCHIVED_TABLES,
  classifyBookFile,
  moduleLabel,
  type ArchiveTableSpec,
  type BookArchiveModuleId,
} from "./registry.js";
import { isJsonColumn, isReferenceColumn } from "./remap.js";
import {
  listTableColumns,
  ownedIdColumn,
  selectBookRows,
  tableExists,
} from "./sql.js";
import { asBytes, bytesToBase64, utf8Bytes, utf8Text } from "./bytes.js";
import { writeZip, type ZipEntryInput } from "./zip.js";

export interface ExportBookArchiveInput {
  readonly storage: StorageDatabase;
  /** 服务端可信绑定解析出的作品根目录。 */
  readonly bookRoot: string;
  readonly bookId: string;
  /** 要导出的模块；省略时全选。 */
  readonly modules?: readonly BookArchiveModuleId[];
  readonly novelforkVersion: string;
  readonly now?: Date;
}

export interface ExportBookArchiveResult {
  readonly bytes: Uint8Array;
  readonly manifest: BookArchiveManifest;
  /** 建议的下载文件名（不含路径）。 */
  readonly fileName: string;
}

function sha256(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function moduleDigest(files: readonly BookArchiveManifestFile[], tables: readonly BookArchiveManifestTable[]): string {
  const lines = [
    ...files.map((file) => `file:${file.path}:${file.sha256}`),
    ...tables.map((table) => `table:${table.name}:${table.rows}:${table.sha256}`),
  ].sort();
  return sha256(lines.join("\n"));
}

export function computeModuleDigest(module: Pick<BookArchiveManifestModule, "files" | "tables">): string {
  return moduleDigest(module.files, module.tables);
}

/** 把一行记录转成可 JSON 序列化的形式；BLOB 用 {"$blob": base64} 包装。 */
export function encodeRow(row: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [column, value] of Object.entries(row)) {
    if (value instanceof Uint8Array) result[column] = { $blob: bytesToBase64(value) };
    else if (typeof value === "bigint") result[column] = Number(value);
    else result[column] = value;
  }
  return result;
}

interface WalkedFile {
  readonly relativePath: string;
  readonly absolutePath: string;
}

async function walkBookRoot(
  root: string,
  notIncluded: BookArchiveNotIncluded[],
): Promise<WalkedFile[]> {
  const files: WalkedFile[] = [];
  const walk = async (directory: string, prefix: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolutePath = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        notIncluded.push({ kind: "file", name: relativePath, explanation: "符号链接不导出：它指向作品目录之外的内容，换机器后不一定存在。" });
        continue;
      }
      if (entry.isDirectory()) {
        // 被排除的隐藏目录（.git、.worktrees 等）整体记一条，不深入遍历。
        const probe = classifyBookFile(`${relativePath}/_`);
        if (probe.kind === "excluded" && relativePath.split("/").length === 1 && entry.name.startsWith(".")) {
          notIncluded.push({ kind: "file", name: `${relativePath}/`, explanation: probe.explanation });
          continue;
        }
        await walk(absolutePath, relativePath);
        continue;
      }
      if (!entry.isFile()) continue;
      const classification = classifyBookFile(relativePath);
      if (classification.kind === "excluded") {
        notIncluded.push({ kind: "file", name: relativePath, explanation: classification.explanation });
        continue;
      }
      files.push({ relativePath, absolutePath });
    }
  };
  await walk(root, "");
  return files;
}

function serializeTable(rows: readonly Record<string, unknown>[]): string {
  return rows.map((row) => JSON.stringify(encodeRow(row))).join("\n") + (rows.length > 0 ? "\n" : "");
}

function collectJsonStrings(value: unknown, into: string[]): void {
  if (typeof value === "string") into.push(value);
  else if (Array.isArray(value)) for (const item of value) collectJsonStrings(item, into);
  else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      into.push(key);
      collectJsonStrings(item, into);
    }
  }
}

/** 取出一行里可能是引用的字符串：引用列的值与 JSON 列里的字符串叶子。 */
export function referenceCandidates(row: Record<string, unknown>, ownedColumn: string | null): Array<{ column: string; value: string }> {
  const result: Array<{ column: string; value: string }> = [];
  for (const [column, value] of Object.entries(row)) {
    if (typeof value !== "string" || column === ownedColumn || column === "book_id") continue;
    if (isJsonColumn(column)) {
      try {
        const strings: string[] = [];
        collectJsonStrings(JSON.parse(value), strings);
        for (const item of strings) result.push({ column, value: item });
      } catch {
        // 不是合法 JSON：按普通值看待。
        result.push({ column, value });
      }
    } else if (isReferenceColumn(column)) {
      result.push({ column, value });
    }
  }
  return result;
}

export async function exportBookArchive(input: ExportBookArchiveInput): Promise<ExportBookArchiveResult> {
  const { storage, bookRoot, bookId } = input;
  const requested = new Set<BookArchiveModuleId>(input.modules && input.modules.length > 0 ? input.modules : BOOK_ARCHIVE_MODULE_IDS);
  const now = input.now ?? new Date();

  const bookJsonBytes = asBytes(await readFile(join(bookRoot, "book.json")).catch(() => {
    throw new BookArchiveError("book-json-missing", "作品目录里没有可读的 book.json，无法确定书名与设置，导出已中止。请先在「我的作品」里修复作品绑定。");
  }));
  let bookConfig: Record<string, unknown>;
  try {
    bookConfig = JSON.parse(utf8Text(bookJsonBytes)) as Record<string, unknown>;
  } catch {
    throw new BookArchiveError("book-json-invalid", "作品的 book.json 无法解析，导出已中止。请先修正 book.json 再导出。");
  }
  const title = typeof bookConfig.title === "string" && bookConfig.title.trim() ? bookConfig.title.trim() : bookId;

  const notIncluded: BookArchiveNotIncluded[] = [];
  const warnings: BookArchiveWarning[] = [];
  const zipEntries: ZipEntryInput[] = [];
  const walked = await walkBookRoot(bookRoot, notIncluded);

  const moduleFiles = new Map<BookArchiveModuleId, BookArchiveManifestFile[]>();
  const moduleTables = new Map<BookArchiveModuleId, BookArchiveManifestTable[]>();
  for (const id of BOOK_ARCHIVE_MODULE_IDS) {
    moduleFiles.set(id, []);
    moduleTables.set(id, []);
  }

  const bookFile: BookArchiveManifestFile = { path: "book.json", bytes: bookJsonBytes.length, sha256: sha256(bookJsonBytes) };
  zipEntries.push({ path: `${FILES_PREFIX}book.json`, data: bookJsonBytes });

  for (const file of walked) {
    const classification = classifyBookFile(file.relativePath);
    if (classification.kind !== "module" || !requested.has(classification.module)) continue;
    const data = asBytes(await readFile(file.absolutePath));
    moduleFiles.get(classification.module)!.push({ path: file.relativePath, bytes: data.length, sha256: sha256(data) });
    zipEntries.push({ path: `${FILES_PREFIX}${file.relativePath}`, data });
  }

  // 表数据。只处理当前库里存在的表；懒建表还没建出来就等于没有数据。
  const includedRows = new Map<string, { spec: ArchiveTableSpec; rows: Record<string, unknown>[]; owned: string | null }>();
  const excludedOwnedIds = new Map<string, BookArchiveModuleId>();
  for (const spec of ARCHIVE_TABLES) {
    if (!tableExists(storage, spec.name)) continue;
    if (spec.parent && !tableExists(storage, spec.parent.table)) continue;
    const rows = selectBookRows(storage, spec.name, bookId, spec.parent);
    const owned = ownedIdColumn(storage, spec.name);
    if (!requested.has(spec.module)) {
      if (owned) for (const row of rows) if (typeof row[owned] === "string") excludedOwnedIds.set(row[owned] as string, spec.module);
      continue;
    }
    includedRows.set(spec.name, { spec, rows, owned });
    const text = serializeTable(rows);
    const data = utf8Bytes(text);
    const columns = listTableColumns(storage, spec.name).map((column) => column.name);
    moduleTables.get(spec.module)!.push({ name: spec.name, rows: rows.length, columns, sha256: sha256(data) });
    zipEntries.push({ path: `${TABLES_PREFIX}${spec.name}.jsonl`, data });
  }

  // 只导出部分模块时，检查保留下来的数据是否引用了没导出的模块，逐项提示。
  if (excludedOwnedIds.size > 0) {
    const dangling = new Map<string, { table: string; column: string; module: BookArchiveModuleId; count: number }>();
    for (const { spec, rows, owned } of includedRows.values()) {
      for (const row of rows) {
        for (const candidate of referenceCandidates(row, owned)) {
          const target = excludedOwnedIds.get(candidate.value);
          if (!target) continue;
          const key = `${spec.name}.${candidate.column}:${target}`;
          const current = dangling.get(key) ?? { table: spec.name, column: candidate.column, module: target, count: 0 };
          current.count += 1;
          dangling.set(key, current);
        }
      }
    }
    for (const item of dangling.values()) {
      warnings.push({
        code: "dangling-reference",
        table: item.table,
        column: item.column,
        count: item.count,
        explanation: `${item.table}.${item.column} 有 ${item.count} 处引用了未导出的「${moduleLabel(item.module)}」模块数据；导入后这些引用会指向不存在的记录。需要完整迁移时请连同「${moduleLabel(item.module)}」一起导出。`,
      });
    }
  }

  // 未包含的表：登记过原因的，以及没登记的新表。
  const knownTables = new Set<string>([...ARCHIVE_TABLES.map((spec) => spec.name), "book"]);
  for (const spec of NOT_ARCHIVED_TABLES) {
    knownTables.add(spec.name);
    if (!tableExists(storage, spec.name)) continue;
    if (spec.parent && !tableExists(storage, spec.parent.table)) continue;
    const rows = selectBookRows(storage, spec.name, bookId, spec.parent, { countOnly: true });
    if (rows.length > 0 && (rows[0]!.count as number) > 0) {
      notIncluded.push({ kind: "table", name: spec.name, rows: rows[0]!.count as number, explanation: spec.explanation });
    }
  }
  const allTables = storage.sqlite
    .prepare<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
    .all();
  for (const { name } of allTables) {
    if (knownTables.has(name) || name.startsWith("sqlite_")) continue;
    const columns = listTableColumns(storage, name).map((column) => column.name);
    if (!columns.includes("book_id")) continue;
    const count = (storage.sqlite.prepare<{ count: number }>(`SELECT COUNT(*) AS count FROM "${name.replaceAll("\"", "\"\"")}" WHERE book_id = ?`).get(bookId)?.count) ?? 0;
    if (count > 0) {
      notIncluded.push({
        kind: "table",
        name,
        rows: count,
        explanation: `数据表 ${name} 尚未纳入项目档案格式（本版不认识它），这 ${count} 行没有导出。请更新 NovelFork 后重新导出，或把情况反馈给开发者。`,
      });
    }
  }
  for (const runtime of NOT_ARCHIVED_RUNTIME) notIncluded.push({ kind: "runtime", name: runtime.name, explanation: runtime.explanation });
  for (const module of BOOK_ARCHIVE_MODULES) {
    if (!requested.has(module.id)) {
      notIncluded.push({ kind: "module", name: module.label, explanation: `导出时没有勾选「${module.label}」模块（${module.description}）。` });
    }
  }

  const bookRow = tableExists(storage, "book")
    ? storage.sqlite.prepare<Record<string, unknown>>(`SELECT * FROM "book" WHERE id = ?`).get(bookId)
    : undefined;
  const migrations = tableExists(storage, "drizzle_migrations")
    ? storage.sqlite.prepare<{ name: string }>(`SELECT name FROM "drizzle_migrations" ORDER BY id`).all().map((row) => row.name)
    : [];

  const modules: BookArchiveManifestModule[] = BOOK_ARCHIVE_MODULES.map((module) => {
    const files = moduleFiles.get(module.id)!;
    const tables = moduleTables.get(module.id)!;
    return {
      id: module.id,
      label: module.label,
      included: requested.has(module.id),
      itemCount: files.length + tables.reduce((sum, table) => sum + table.rows, 0),
      sha256: moduleDigest(files, tables),
      files,
      tables,
    };
  });

  const numberOrZero = (value: unknown): number => (typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0);
  const numberOrNull = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
  const manifest: BookArchiveManifest = {
    format: BOOK_ARCHIVE_FORMAT,
    formatVersion: BOOK_ARCHIVE_FORMAT_VERSION,
    exportedAt: now.toISOString(),
    novelforkVersion: input.novelforkVersion,
    source: { bookId, title, schemaMigrations: migrations },
    book: bookRow
      ? {
          jingweiMode: typeof bookRow.jingwei_mode === "string" ? bookRow.jingwei_mode : null,
          currentChapter: numberOrZero(bookRow.current_chapter),
          stateRevision: numberOrZero(bookRow.state_revision),
          createdAt: numberOrNull(bookRow.created_at),
          updatedAt: numberOrNull(bookRow.updated_at),
        }
      : null,
    bookFile,
    modules,
    notIncluded,
    warnings,
  };

  const bytes = writeZip([
    { path: MANIFEST_PATH, data: utf8Bytes(`${JSON.stringify(manifest, null, 2)}\n`) },
    ...zipEntries,
  ], now);
  const stamp = now.toISOString().slice(0, 10);
  const safeTitle = title.replace(/[\\/:*?"<>|\u0000-\u001f]+/gu, "_").slice(0, 80) || "作品";
  return { bytes, manifest, fileName: `${safeTitle}-档案-${stamp}.zip` };
}
