/**
 * 档案清单（manifest.json）的结构、校验与版本升级。
 */
import { z } from "zod";

import {
  BOOK_ARCHIVE_FORMAT,
  BOOK_ARCHIVE_FORMAT_VERSION,
  BOOK_ARCHIVE_MODULE_IDS,
  type BookArchiveModuleId,
} from "./registry.js";

export const MANIFEST_PATH = "manifest.json";
export const FILES_PREFIX = "files/";
export const TABLES_PREFIX = "tables/";

/** 档案处理错误：code 给程序判断，message 即 explanation，说明发生了什么、为什么、怎么办。 */
export class BookArchiveError extends Error {
  readonly code: string;
  constructor(code: string, explanation: string) {
    super(explanation);
    this.name = "BookArchiveError";
    this.code = code;
  }
  get explanation(): string {
    return this.message;
  }
}

const sha256Hex = z.string().regex(/^[a-f0-9]{64}$/u);

const ManifestFileSchema = z.object({
  path: z.string().min(1).max(1024),
  bytes: z.number().int().min(0),
  sha256: sha256Hex,
}).strict();

const ManifestTableSchema = z.object({
  name: z.string().regex(/^[a-z_][a-z0-9_]{0,63}$/u),
  rows: z.number().int().min(0),
  columns: z.array(z.string().regex(/^[a-z_][a-z0-9_]{0,63}$/u)).max(200),
  sha256: sha256Hex,
}).strict();

const ManifestModuleSchema = z.object({
  id: z.enum(BOOK_ARCHIVE_MODULE_IDS as [BookArchiveModuleId, ...BookArchiveModuleId[]]),
  label: z.string(),
  included: z.boolean(),
  itemCount: z.number().int().min(0),
  sha256: sha256Hex,
  files: z.array(ManifestFileSchema),
  tables: z.array(ManifestTableSchema),
}).strict();

const NotIncludedSchema = z.object({
  kind: z.enum(["module", "table", "file", "runtime"]),
  name: z.string(),
  rows: z.number().int().min(0).optional(),
  explanation: z.string(),
}).strict();

const WarningSchema = z.object({
  code: z.string(),
  explanation: z.string(),
  table: z.string().optional(),
  column: z.string().optional(),
  count: z.number().int().min(0).optional(),
}).strict();

export const BookArchiveManifestSchema = z.object({
  format: z.literal(BOOK_ARCHIVE_FORMAT),
  formatVersion: z.literal(BOOK_ARCHIVE_FORMAT_VERSION),
  exportedAt: z.string(),
  novelforkVersion: z.string(),
  source: z.object({
    bookId: z.string().min(1).max(200),
    title: z.string().min(1).max(500),
    schemaMigrations: z.array(z.string()),
  }).strict(),
  book: z.object({
    jingweiMode: z.string().nullable(),
    currentChapter: z.number().int().min(0),
    stateRevision: z.number().int().min(0),
    createdAt: z.number().nullable(),
    updatedAt: z.number().nullable(),
  }).strict().nullable(),
  bookFile: ManifestFileSchema,
  modules: z.array(ManifestModuleSchema),
  notIncluded: z.array(NotIncludedSchema),
  warnings: z.array(WarningSchema),
}).strict();

export type BookArchiveManifest = z.infer<typeof BookArchiveManifestSchema>;
export type BookArchiveManifestModule = z.infer<typeof ManifestModuleSchema>;
export type BookArchiveManifestFile = z.infer<typeof ManifestFileSchema>;
export type BookArchiveManifestTable = z.infer<typeof ManifestTableSchema>;
export type BookArchiveNotIncluded = z.infer<typeof NotIncludedSchema>;
export type BookArchiveWarning = z.infer<typeof WarningSchema>;

/**
 * 旧格式版本逐级升级到当前版本。当前只有第 1 版；以后改格式时在这里补
 * `{ from: 1, upgrade: (v1) => v2 }`，升级不了的版本不要登记，读取时会被明确拒绝。
 */
const MANIFEST_UPGRADES: ReadonlyArray<{ readonly from: number; readonly upgrade: (manifest: Record<string, unknown>) => Record<string, unknown> }> = [];

export function upgradeManifest(raw: unknown): BookArchiveManifest {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new BookArchiveError("invalid-manifest", "档案清单 manifest.json 不是对象，文件已损坏或不是 NovelFork 项目档案。");
  }
  let manifest = raw as Record<string, unknown>;
  if (manifest.format !== BOOK_ARCHIVE_FORMAT) {
    throw new BookArchiveError("not-book-archive", "这不是 NovelFork 项目档案（manifest.json 的 format 不符）。请选择在「我的作品」里导出的 .zip 档案。");
  }
  const version = manifest.formatVersion;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    throw new BookArchiveError("invalid-format-version", "档案格式版本无效，无法判断如何读取。");
  }
  if (version > BOOK_ARCHIVE_FORMAT_VERSION) {
    throw new BookArchiveError(
      "format-too-new",
      `档案格式版本为 ${version}，当前 NovelFork 只能读取到第 ${BOOK_ARCHIVE_FORMAT_VERSION} 版。请先把 NovelFork 升级到导出档案的版本（${String(manifest.novelforkVersion ?? "未知")}）或更新，再导入。`,
    );
  }
  let current = version;
  while (current < BOOK_ARCHIVE_FORMAT_VERSION) {
    const step = MANIFEST_UPGRADES.find((candidate) => candidate.from === current);
    if (!step) {
      throw new BookArchiveError("format-unsupported", `档案格式第 ${current} 版已不再支持读取，无法导入。请用导出它的 NovelFork 版本打开原书后重新导出。`);
    }
    manifest = step.upgrade(manifest);
    current += 1;
  }
  const parsed = BookArchiveManifestSchema.safeParse(manifest);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new BookArchiveError(
      "invalid-manifest",
      `档案清单 manifest.json 结构不符（${issue ? `${issue.path.join(".") || "根"}：${issue.message}` : "未知字段"}），文件可能被改动过，已拒绝导入。`,
    );
  }
  return parsed.data;
}
