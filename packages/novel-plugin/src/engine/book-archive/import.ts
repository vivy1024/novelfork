/**
 * 项目档案导入：校验 → 生成新 bookId 下的全部数据 → 单事务写库。
 *
 * 默认且目前唯一的方式是「导入为新书」：不覆盖任何已有作品。
 * 文件先写进调用方给出的暂存目录；数据库写入在一个事务里完成，任何一步失败都整体回滚，
 * 并删掉暂存目录，不留半本书。暂存目录转正（改名为正式作品目录）与 Runtime 绑定由产品层负责。
 */
import { createHash } from "node:crypto";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";

import { ensureDissectionStagingSchema } from "../jingwei/dissection-staging.js";
import { rebuildBookFts } from "../jingwei/search/fts-index.js";
import { ensureSettlementLedgerSchema } from "../narrative-memory/settlement-idempotency.js";
import { ensureNarrativeMemorySchema } from "../narrative-memory/storage.js";
import { ensureNarrativeWaveSchema } from "../narrative-memory/wave/tag-graph.js";
import { rebuildNarrativeEntityIndex } from "../narrative-entity/entity-index.js";
import { computeModuleDigest } from "./export.js";
import {
  BookArchiveError,
  FILES_PREFIX,
  MANIFEST_PATH,
  TABLES_PREFIX,
  upgradeManifest,
  type BookArchiveManifest,
} from "./manifest.js";
import {
  ARCHIVE_TABLES,
  BOOK_ARCHIVE_MODULES,
  DERIVED_ENTITY_INDEX_TABLES,
  REGENERATED_ON_IMPORT,
  classifyBookFile,
  moduleLabel,
  type BookArchiveModuleId,
} from "./registry.js";
import { IdRemapper, isJsonColumn, isReferenceColumn, type IdRemapStats } from "./remap.js";
import {
  integerRowIdColumn,
  listTableColumns,
  ownedIdColumn,
  quoteIdentifier,
  selectBookRows,
  tableExists,
} from "./sql.js";
import { base64ToBytes, utf8Bytes, utf8Text } from "./bytes.js";
import { assertSafeArchivePath, readZip, ZipFormatError } from "./zip.js";

export interface ParsedArchiveTable {
  readonly name: string;
  readonly module: BookArchiveModuleId;
  readonly columns: readonly string[];
  readonly rows: readonly Record<string, unknown>[];
}

export interface ParsedArchiveFile {
  readonly path: string;
  /** book.json 为 null；其余文件按路径判定的模块。 */
  readonly module: BookArchiveModuleId | null;
  readonly data: Uint8Array;
}

export interface ParsedBookArchive {
  readonly manifest: BookArchiveManifest;
  readonly files: readonly ParsedArchiveFile[];
  readonly tables: readonly ParsedArchiveTable[];
  /** 档案里有、但本版不认识的表：不会导入，报告里列为无法恢复。 */
  readonly unknownTables: readonly { readonly name: string; readonly rows: number }[];
}

function sha256(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

function decodeValue(value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const blob = (value as { $blob?: unknown }).$blob;
    if (typeof blob === "string" && Object.keys(value).length === 1) return base64ToBytes(blob);
    // 只有 BLOB 会被序列化成对象；其它对象说明档案被改过。
    throw new BookArchiveError("invalid-row", "档案表数据里出现了无法识别的对象值，文件可能被改动过，已拒绝导入。");
  }
  return value;
}

/**
 * 解析并校验档案：路径安全、清单结构与版本、每个文件与表的大小和哈希、模块哈希、
 * 以及清单之外不得有多余条目。任何一项不符都整份拒绝，不做部分导入。
 */
export function readBookArchive(bytes: Uint8Array): ParsedBookArchive {
  let entries: Map<string, Uint8Array>;
  try {
    entries = readZip(bytes);
  } catch (error) {
    if (error instanceof ZipFormatError) throw new BookArchiveError(`zip-${error.code}`, error.message);
    throw error;
  }
  const manifestBytes = entries.get(MANIFEST_PATH);
  if (!manifestBytes) {
    throw new BookArchiveError("manifest-missing", "档案里没有 manifest.json，不是 NovelFork 项目档案或已损坏。");
  }
  let rawManifest: unknown;
  try {
    rawManifest = JSON.parse(utf8Text(manifestBytes));
  } catch {
    throw new BookArchiveError("invalid-manifest", "档案清单 manifest.json 不是合法 JSON，文件已损坏。");
  }
  const manifest = upgradeManifest(rawManifest);

  const consumed = new Set<string>([MANIFEST_PATH]);
  const takeVerified = (archivePath: string, expected: { bytes: number; sha256: string }, label: string): Uint8Array => {
    const data = entries.get(archivePath);
    if (!data) throw new BookArchiveError("entry-missing", `档案清单登记了${label}，但档案里找不到它，文件不完整，已拒绝导入。`);
    if (data.length !== expected.bytes || sha256(data) !== expected.sha256) {
      throw new BookArchiveError("hash-mismatch", `${label}的内容与清单记录的哈希不符，档案可能损坏或被改动过，已拒绝导入。`);
    }
    consumed.add(archivePath);
    return data;
  };

  const files: ParsedArchiveFile[] = [];
  if (manifest.bookFile.path !== "book.json") throw new BookArchiveError("invalid-manifest", "档案清单里的 book.json 路径无效。");
  files.push({
    path: "book.json",
    module: null,
    data: takeVerified(`${FILES_PREFIX}book.json`, manifest.bookFile, "书籍信息 book.json"),
  });

  const tables: ParsedArchiveTable[] = [];
  const unknownTables: { name: string; rows: number }[] = [];
  const registry = new Map(ARCHIVE_TABLES.map((spec) => [spec.name, spec]));
  const seenTables = new Set<string>();
  const seenFiles = new Set<string>(["book.json"]);
  for (const module of manifest.modules) {
    if (!module.included && (module.files.length > 0 || module.tables.length > 0)) {
      throw new BookArchiveError("invalid-manifest", `档案清单把「${module.label}」标为未导出，却登记了它的内容，清单前后矛盾，已拒绝导入。`);
    }
    if (computeModuleDigest(module) !== module.sha256) {
      throw new BookArchiveError("hash-mismatch", `「${module.label}」模块的汇总哈希与清单不符，档案可能被改动过，已拒绝导入。`);
    }
    for (const file of module.files) {
      assertSafeManifestPath(file.path);
      if (seenFiles.has(file.path)) throw new BookArchiveError("invalid-manifest", `档案清单重复登记了文件 ${file.path}。`);
      seenFiles.add(file.path);
      const classification = classifyBookFile(file.path);
      if (classification.kind !== "module") {
        const why = classification.kind === "excluded" ? classification.explanation : "book.json 只能作为书籍信息登记。";
        throw new BookArchiveError("forbidden-path", `档案里的文件 ${file.path} 不允许导入作品目录（${why}），已拒绝整份档案。`);
      }
      const data = takeVerified(`${FILES_PREFIX}${file.path}`, file, `文件 ${file.path} `);
      files.push({ path: file.path, module: classification.module, data });
    }
    for (const table of module.tables) {
      if (seenTables.has(table.name)) throw new BookArchiveError("invalid-manifest", `档案清单重复登记了表 ${table.name}。`);
      seenTables.add(table.name);
      const data = takeVerified(`${TABLES_PREFIX}${table.name}.jsonl`, { bytes: entries.get(`${TABLES_PREFIX}${table.name}.jsonl`)?.length ?? -1, sha256: table.sha256 }, `表 ${table.name} 的数据`);
      const lines = utf8Text(data).split("\n").filter((line) => line.length > 0);
      if (lines.length !== table.rows) {
        throw new BookArchiveError("row-count-mismatch", `表 ${table.name} 的行数（${lines.length}）与清单记录（${table.rows}）不符，档案不完整，已拒绝导入。`);
      }
      const rows = lines.map((line, index) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          throw new BookArchiveError("invalid-row", `表 ${table.name} 第 ${index + 1} 行不是合法 JSON，档案已损坏。`);
        }
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new BookArchiveError("invalid-row", `表 ${table.name} 第 ${index + 1} 行不是对象，档案已损坏。`);
        }
        const row: Record<string, unknown> = {};
        for (const [column, value] of Object.entries(parsed as Record<string, unknown>)) {
          if (!/^[a-z_][a-z0-9_]{0,63}$/u.test(column)) {
            throw new BookArchiveError("invalid-row", `表 ${table.name} 含非法列名，档案可能被改动过，已拒绝导入。`);
          }
          row[column] = decodeValue(value);
        }
        return row;
      });
      const spec = registry.get(table.name);
      if (!spec) {
        unknownTables.push({ name: table.name, rows: rows.length });
        continue;
      }
      tables.push({ name: table.name, module: spec.module, columns: table.columns, rows });
    }
  }

  for (const path of entries.keys()) {
    if (!consumed.has(path)) {
      throw new BookArchiveError("unexpected-entry", `档案里有清单没有登记的条目 ${path}，档案可能被改动过，已拒绝导入。`);
    }
  }
  return { manifest, files, tables, unknownTables };
}

function assertSafeManifestPath(path: string): void {
  try {
    assertSafeArchivePath(path);
  } catch (error) {
    if (error instanceof ZipFormatError) throw new BookArchiveError("unsafe-path", error.message);
    throw error;
  }
}

export type BookArchiveReportSeverity = "missing" | "unrecoverable" | "warning" | "info";

export interface BookArchiveReportItem {
  readonly severity: BookArchiveReportSeverity;
  readonly module?: BookArchiveModuleId;
  readonly target: string;
  readonly explanation: string;
}

export interface BookArchiveModuleReport {
  readonly id: BookArchiveModuleId;
  readonly label: string;
  readonly status: "imported" | "not-in-archive" | "not-selected";
  readonly files: number;
  readonly rows: number;
}

export interface BookArchiveImportReport {
  readonly sourceBookId: string;
  readonly bookId: string;
  readonly title: string;
  readonly exportedAt: string;
  readonly sourceNovelforkVersion: string;
  readonly modules: readonly BookArchiveModuleReport[];
  readonly items: readonly BookArchiveReportItem[];
  readonly idRemap: { readonly bookId: { readonly from: string; readonly to: string } } & IdRemapStats;
}

export interface ImportBookArchiveInput {
  readonly storage: StorageDatabase;
  readonly archive: ParsedBookArchive;
  readonly newBookId: string;
  /** 暂存目录：不得已存在，写入失败时会被删除。 */
  readonly stagingRoot: string;
  /** 要导入的模块；省略时导入档案里有的全部模块。 */
  readonly modules?: readonly BookArchiveModuleId[];
  /** 调整写入暂存目录的 book.json（例如去掉只属于源机器的标记）。 */
  readonly transformBookConfig?: (config: Record<string, unknown>) => Record<string, unknown>;
  readonly now?: Date;
}

/** 导入所需、但由各模块懒建的表：写库前先确保存在。 */
function ensureArchiveSchemas(storage: StorageDatabase): void {
  ensureNarrativeMemorySchema(storage);
  ensureSettlementLedgerSchema(storage);
  ensureNarrativeWaveSchema(storage);
  ensureDissectionStagingSchema(storage);
}

function containedPath(root: string, relativePath: string): string {
  const target = resolve(root, ...relativePath.split("/"));
  const rel = relative(resolve(root), target);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
    throw new BookArchiveError("unsafe-path", `档案路径 ${relativePath} 解析到了作品目录之外，已拒绝导入。`);
  }
  return target;
}

function remapJsonFile(remapper: IdRemapper, data: Uint8Array): Uint8Array {
  const text = utf8Text(data);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return data;
  }
  const remapped = remapper.remapJsonValue(parsed);
  if (JSON.stringify(remapped) === JSON.stringify(parsed)) return data;
  return utf8Bytes(`${JSON.stringify(remapped, null, 2)}\n`);
}

export async function importBookArchiveIntoStorage(input: ImportBookArchiveInput): Promise<BookArchiveImportReport> {
  const { storage, archive, newBookId, stagingRoot } = input;
  const { manifest } = archive;
  const now = input.now ?? new Date();
  const items: BookArchiveReportItem[] = [];
  const includedInArchive = new Set(manifest.modules.filter((module) => module.included).map((module) => module.id));
  const requested = new Set<BookArchiveModuleId>(input.modules && input.modules.length > 0 ? input.modules : BOOK_ARCHIVE_MODULES.map((module) => module.id));
  const selected = new Set<BookArchiveModuleId>([...requested].filter((id) => includedInArchive.has(id)));

  for (const module of BOOK_ARCHIVE_MODULES) {
    if (requested.has(module.id) && !includedInArchive.has(module.id)) {
      items.push({ severity: "missing", module: module.id, target: module.label, explanation: `档案导出时没有包含「${module.label}」模块，新书里没有这部分数据（${module.description}）。需要时请在源机器上勾选该模块重新导出。` });
    } else if (!requested.has(module.id) && includedInArchive.has(module.id)) {
      items.push({ severity: "info", module: module.id, target: module.label, explanation: `按你的选择没有导入「${module.label}」模块；档案里有这部分数据，需要时可重新导入。` });
    }
  }
  for (const entry of manifest.notIncluded) {
    if (entry.kind === "module") continue;
    // 导入时会为新书重新生成的（绑定、检索索引、实体索引）不算缺失，只作说明。
    const derived = entry.kind === "table" && REGENERATED_ON_IMPORT.has(entry.name);
    items.push({ severity: derived ? "info" : "missing", target: entry.rows !== undefined ? `${entry.name}（${entry.rows} 行）` : entry.name, explanation: entry.explanation });
  }
  for (const warning of manifest.warnings) {
    items.push({ severity: "warning", target: warning.table && warning.column ? `${warning.table}.${warning.column}` : warning.code, explanation: warning.explanation });
  }
  for (const table of archive.unknownTables) {
    items.push({ severity: "unrecoverable", target: `${table.name}（${table.rows} 行）`, explanation: `档案里的数据表 ${table.name} 本版 NovelFork 不认识，这部分数据没有导入。请升级到导出档案的 NovelFork 版本（${manifest.novelforkVersion}）后重新导入。` });
  }

  ensureArchiveSchemas(storage);

  // 目标库表结构核对：缺表、缺列的记录无法恢复；目标要求而档案没有的列会让插入失败，直接拒绝。
  /** 指向档案之外的表（如内置问卷模板）的外键：目标库里没有被引用的行时，这条记录无法恢复。 */
  type ExternalForeignKey = { column: string; table: string; to: string };
  type TablePlan = { table: ParsedArchiveTable; columns: string[]; owned: string | null; rowId: string | null; external: ExternalForeignKey[] };
  const archivedTableNames = new Set(ARCHIVE_TABLES.map((spec) => spec.name));
  const plans: TablePlan[] = [];
  for (const table of archive.tables) {
    if (!selected.has(table.module)) continue;
    if (!tableExists(storage, table.name)) {
      if (table.rows.length > 0) {
        items.push({ severity: "unrecoverable", module: table.module, target: `${table.name}（${table.rows.length} 行）`, explanation: `当前 NovelFork 的数据库没有表 ${table.name}，这部分数据无法恢复。请升级 NovelFork 后重新导入。` });
      }
      continue;
    }
    const targetColumns = listTableColumns(storage, table.name);
    const targetNames = new Set(targetColumns.map((column) => column.name));
    const rowId = integerRowIdColumn(storage, table.name);
    const archiveColumns = new Set<string>(table.columns);
    for (const row of table.rows) for (const column of Object.keys(row)) archiveColumns.add(column);
    const dropped = [...archiveColumns].filter((column) => !targetNames.has(column));
    if (dropped.length > 0 && table.rows.length > 0) {
      items.push({ severity: "unrecoverable", module: table.module, target: `${table.name}.${dropped.join(" / ")}`, explanation: `当前数据库的 ${table.name} 表没有这些列，${table.rows.length} 行记录里的这几项无法恢复，其余字段照常导入。` });
    }
    const missingRequired = targetColumns.filter((column) => column.notNull && !column.hasDefault && column.pk === 0 && !archiveColumns.has(column.name));
    if (missingRequired.length > 0 && table.rows.length > 0) {
      throw new BookArchiveError(
        "schema-mismatch",
        `档案里的 ${table.name} 缺少当前版本必填的列（${missingRequired.map((column) => column.name).join("、")}），无法按当前结构写入，已拒绝导入、没有写入任何数据。请用与导出端相同或更新的 NovelFork 导出后再试。`,
      );
    }
    plans.push({
      table,
      columns: targetColumns.map((column) => column.name).filter((column) => archiveColumns.has(column) && column !== rowId),
      owned: ownedIdColumn(storage, table.name),
      rowId,
      external: storage.sqlite
        .prepare<{ from: string; table: string; to: string | null }>(`PRAGMA foreign_key_list(${quoteIdentifier(table.name)})`)
        .all()
        .filter((fk) => fk.table !== "book" && !archivedTableNames.has(fk.table) && fk.to)
        .map((fk) => ({ column: fk.from, table: fk.table, to: fk.to as string })),
    });
  }

  // ID 重映射：先收集全部令牌，再逐个分配自有主键（检查目标库冲突）。
  const remapper = new IdRemapper(manifest.source.bookId, newBookId);
  for (const plan of plans) {
    if (!plan.owned) continue;
    for (const row of plan.table.rows) {
      const value = row[plan.owned];
      if (typeof value === "string") remapper.collectTokens(value);
    }
  }
  for (const plan of plans) {
    if (!plan.owned) continue;
    const exists = storage.sqlite.prepare(`SELECT 1 AS present FROM ${quoteIdentifier(plan.table.name)} WHERE ${quoteIdentifier(plan.owned)} = ? LIMIT 1`);
    for (const row of plan.table.rows) {
      const value = row[plan.owned];
      if (typeof value === "string") remapper.assignOwnedId(value, (candidate) => Boolean(exists.get(candidate)));
    }
  }

  const remapRow = (plan: TablePlan, row: Record<string, unknown>): unknown[] =>
    plan.columns.map((column) => {
      const value = row[column];
      if (value === undefined) return null;
      if (column === "book_id") return newBookId;
      if (typeof value !== "string") return value;
      if (column === plan.owned) return remapper.ownedId(value) ?? value;
      if (isJsonColumn(column)) return remapper.remapJsonText(value);
      if (isReferenceColumn(column)) return remapper.remapReference(value);
      return value;
    });

  // 1) 文件写进暂存目录。
  if (await stat(stagingRoot).catch(() => null)) {
    throw new BookArchiveError("staging-exists", "导入暂存目录已存在，可能有另一次导入正在进行。请稍后重试。");
  }
  const moduleFiles = new Map<BookArchiveModuleId, number>();
  const moduleRows = new Map<BookArchiveModuleId, number>();
  try {
    await mkdir(stagingRoot, { recursive: true });
    for (const file of archive.files) {
      if (file.module !== null && !selected.has(file.module)) continue;
      const target = containedPath(stagingRoot, file.path);
      await mkdir(dirname(target), { recursive: true });
      let data = file.data;
      if (file.module === null) {
        let config: Record<string, unknown>;
        try {
          const parsed = JSON.parse(utf8Text(file.data)) as unknown;
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not object");
          config = parsed as Record<string, unknown>;
        } catch {
          throw new BookArchiveError("book-json-invalid", "档案里的 book.json 无法解析，无法确定书名与设置，已拒绝导入。");
        }
        const remapped = remapper.remapJsonValue(config) as Record<string, unknown>;
        let next: Record<string, unknown> = { ...remapped, id: newBookId, title: manifest.source.title, updatedAt: now.toISOString() };
        if (input.transformBookConfig) next = input.transformBookConfig(next);
        data = utf8Bytes(`${JSON.stringify(next, null, 2)}\n`);
      } else {
        moduleFiles.set(file.module, (moduleFiles.get(file.module) ?? 0) + 1);
        if (file.path.endsWith(".json")) data = remapJsonFile(remapper, file.data);
      }
      await writeFile(target, data, { flag: "wx" });
    }
    // 没导入正文时也要有一本能打开的书：补空章节索引与 story 目录。
    await mkdir(join(stagingRoot, "chapters"), { recursive: true });
    await mkdir(join(stagingRoot, "story"), { recursive: true });
    const indexPath = join(stagingRoot, "chapters", "index.json");
    if (!(await stat(indexPath).catch(() => null))) await writeFile(indexPath, "[]\n", "utf8");

    // 2) 数据库：单事务，外键检查延迟到提交。
    storage.sqlite.transaction(() => {
      storage.sqlite.exec("PRAGMA defer_foreign_keys = ON");
      if (tableExists(storage, "book")) {
        const bookColumns = new Set(listTableColumns(storage, "book").map((column) => column.name));
        const chaptersImported = selected.has("chapters");
        const nowMs = now.getTime();
        const values: Record<string, unknown> = {
          id: newBookId,
          name: manifest.source.title,
          jingwei_mode: manifest.book?.jingweiMode ?? "dynamic",
          current_chapter: chaptersImported ? manifest.book?.currentChapter ?? 0 : 0,
          state_revision: chaptersImported ? manifest.book?.stateRevision ?? 0 : 0,
          created_at: manifest.book?.createdAt ?? nowMs,
          updated_at: nowMs,
        };
        const columns = Object.keys(values).filter((column) => bookColumns.has(column));
        storage.sqlite
          .prepare(`INSERT INTO "book" (${columns.map(quoteIdentifier).join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`)
          .run(...columns.map((column) => values[column]));
      }
      for (const plan of plans) {
        if (plan.table.rows.length === 0 || plan.columns.length === 0) continue;
        const insert = storage.sqlite.prepare(
          `INSERT INTO ${quoteIdentifier(plan.table.name)} (${plan.columns.map(quoteIdentifier).join(", ")}) VALUES (${plan.columns.map(() => "?").join(", ")})`,
        );
        const externalChecks = plan.external.map((fk) => ({
          fk,
          index: plan.columns.indexOf(fk.column),
          statement: storage.sqlite.prepare(`SELECT 1 AS present FROM ${quoteIdentifier(fk.table)} WHERE ${quoteIdentifier(fk.to)} = ? LIMIT 1`),
        })).filter((check) => check.index >= 0);
        let inserted = 0;
        const skippedByReference = new Map<string, number>();
        for (const row of plan.table.rows) {
          const values = remapRow(plan, row);
          const broken = externalChecks.find((check) => values[check.index] !== null && !check.statement.get(values[check.index]));
          if (broken) {
            const key = `${broken.fk.column} → ${broken.fk.table}.${broken.fk.to}`;
            skippedByReference.set(key, (skippedByReference.get(key) ?? 0) + 1);
            continue;
          }
          insert.run(...values);
          inserted += 1;
        }
        for (const [reference, count] of skippedByReference) {
          items.push({
            severity: "unrecoverable",
            module: plan.table.module,
            target: `${plan.table.name}（${count} 行）`,
            explanation: `${plan.table.name} 有 ${count} 行引用了本机不存在的共享数据（${reference}），这些行无法恢复，已跳过；其余数据照常导入。`,
          });
        }
        moduleRows.set(plan.table.module, (moduleRows.get(plan.table.module) ?? 0) + inserted);
      }
      if (selected.has("jingwei") && tableExists(storage, "story_jingwei_entry") && tableExists(storage, "jingwei_fts_doc")) {
        rebuildBookFts(storage, newBookId);
      }
    })();
  } catch (error) {
    await rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
    if (error instanceof BookArchiveError) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    throw new BookArchiveError("import-failed", `导入写入时失败，已整体回滚，没有留下任何数据（${detail}）。请确认档案来自同一或更早版本的 NovelFork 后重试。`);
  }

  // 3) 实体索引是经纬 + 事实 + 事件的派生数据，不随档案走，按新书重建。
  //    放在提交之后：它失败不影响已导入的作者数据，只在报告里提示，可稍后在叙事记忆里重新建索引。
  if (selected.has("jingwei") || selected.has("narrative")) {
    try {
      const rebuilt = rebuildNarrativeEntityIndex(storage, newBookId);
      items.push(rebuilt.ok
        ? {
            severity: "info",
            module: "narrative",
            target: "实体索引",
            explanation: `实体索引已按新书重建：${rebuilt.entities} 个实体、${rebuilt.relations} 条关系、${rebuilt.stateChanges} 条状态变化、${rebuilt.participants} 个事件参与者。它由经纬与事实、事件派生，所以不随档案导出。`,
          }
        : { severity: "warning", module: "narrative", target: "实体索引", explanation: rebuilt.explanation });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      items.push({
        severity: "warning",
        module: "narrative",
        target: "实体索引",
        explanation: `作者数据已全部导入，但实体索引重建失败（${detail}）。实体索引只是派生数据，可稍后在叙事记忆里重新建立索引，不影响继续写作。`,
      });
    }
  }

  const modules: BookArchiveModuleReport[] = BOOK_ARCHIVE_MODULES.map((module) => ({
    id: module.id,
    label: module.label,
    status: selected.has(module.id) ? "imported" : includedInArchive.has(module.id) ? "not-selected" : "not-in-archive",
    files: moduleFiles.get(module.id) ?? 0,
    rows: moduleRows.get(module.id) ?? 0,
  }));
  const skillFiles = moduleFiles.get("skills") ?? 0;
  if (skillFiles > 0) {
    items.push({ severity: "warning", module: "skills", target: moduleLabel("skills"), explanation: `导入了 ${skillFiles} 个书级技能文件。技能内容会进入叙述者的提示词，只应导入你信任的档案；可在写作技能面板里逐个检查或删除。` });
  }
  return {
    sourceBookId: manifest.source.bookId,
    bookId: newBookId,
    title: manifest.source.title,
    exportedAt: manifest.exportedAt,
    sourceNovelforkVersion: manifest.novelforkVersion,
    modules,
    items,
    idRemap: { bookId: { from: manifest.source.bookId, to: newBookId }, ...remapper.stats() },
  };
}

/**
 * 补偿：删除某本书在档案涉及的全部表里的数据与检索索引。
 * 产品层在「数据已写入、但转正或 Runtime 绑定失败」时调用，保证不留半本书。
 */
export function purgeBookArchiveData(storage: StorageDatabase, bookId: string): void {
  storage.sqlite.transaction(() => {
    // 先清派生的实体索引（外键指向实体，先子后父）。
    for (const table of [...DERIVED_ENTITY_INDEX_TABLES].reverse()) {
      if (tableExists(storage, table) && listTableColumns(storage, table).some((column) => column.name === "book_id")) {
        storage.sqlite.prepare(`DELETE FROM ${quoteIdentifier(table)} WHERE book_id = ?`).run(bookId);
      }
    }
    for (const spec of [...ARCHIVE_TABLES].reverse()) {
      if (!tableExists(storage, spec.name)) continue;
      if (spec.parent) {
        if (!tableExists(storage, spec.parent.table)) continue;
        storage.sqlite
          .prepare(`DELETE FROM ${quoteIdentifier(spec.name)} WHERE ${quoteIdentifier(spec.parent.column)} IN (SELECT id FROM ${quoteIdentifier(spec.parent.table)} WHERE book_id = ?)`)
          .run(bookId);
      } else {
        storage.sqlite.prepare(`DELETE FROM ${quoteIdentifier(spec.name)} WHERE book_id = ?`).run(bookId);
      }
    }
    if (tableExists(storage, "story_jingwei_entry") && tableExists(storage, "jingwei_fts_doc")) rebuildBookFts(storage, bookId);
    if (tableExists(storage, "book")) storage.sqlite.prepare(`DELETE FROM "book" WHERE id = ?`).run(bookId);
  })();
}

/** 统计某本书在档案涉及的表里还有多少行（测试与核对用）。 */
export function countBookArchiveRows(storage: StorageDatabase, bookId: string): Record<string, number> {
  const result: Record<string, number> = {};
  for (const spec of ARCHIVE_TABLES) {
    if (!tableExists(storage, spec.name)) continue;
    if (spec.parent && !tableExists(storage, spec.parent.table)) continue;
    const [row] = selectBookRows(storage, spec.name, bookId, spec.parent, { countOnly: true });
    const count = Number(row?.count ?? 0);
    if (count > 0) result[spec.name] = count;
  }
  return result;
}
