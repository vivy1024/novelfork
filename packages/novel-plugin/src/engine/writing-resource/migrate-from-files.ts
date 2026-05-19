import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { WritingResourceService } from "./service.js";
import type { WritingResourceStatus, WritingResourceType } from "./types.js";

export type FileWritingResourceMigrationResult = {
  readonly imported: number;
  readonly skipped: number;
  readonly booksScanned: number;
};

const MIGRATION_MARKER = ".writing-resource-migrated.json";

export async function migrateWritingResourcesFromFiles(input: {
  readonly root: string;
  readonly service: WritingResourceService;
  readonly now?: () => number;
}): Promise<FileWritingResourceMigrationResult> {
  const booksDir = join(input.root, "books");
  const now = input.now ?? (() => Date.now());
  const bookIds = await listDirectories(booksDir);
  let imported = 0;
  let skipped = 0;

  for (const bookId of bookIds) {
    const bookDir = join(booksDir, bookId);
    const markerPath = join(bookDir, MIGRATION_MARKER);
    if (await exists(markerPath)) { skipped += 1; continue; }

    const existing = input.service.list(bookId, { includeDeleted: true });
    if (existing.length > 0) {
      await writeMarker(markerPath, { status: "skipped-existing-db", at: now(), count: existing.length });
      skipped += 1;
      continue;
    }

    const count = await migrateBook(bookId, bookDir, input.service, now);
    imported += count;
    await writeMarker(markerPath, { status: "imported", at: now(), count });
  }

  return { imported, skipped, booksScanned: bookIds.length };
}

async function migrateBook(bookId: string, bookDir: string, service: WritingResourceService, now: () => number): Promise<number> {
  let count = 0;
  count += await migrateIndexedResources({ bookId, bookDir, service, now, dirName: "chapters", type: "chapter", defaultStatus: "accepted" });
  count += await migrateIndexedResources({ bookId, bookDir, service, now, dirName: "generated-candidates", type: "candidate", defaultStatus: "candidate" });
  count += await migrateIndexedResources({ bookId, bookDir, service, now, dirName: "drafts", type: "draft", defaultStatus: "draft" });
  return count;
}

async function migrateIndexedResources(input: {
  readonly bookId: string;
  readonly bookDir: string;
  readonly service: WritingResourceService;
  readonly now: () => number;
  readonly dirName: string;
  readonly type: WritingResourceType;
  readonly defaultStatus: WritingResourceStatus;
}): Promise<number> {
  const dir = join(input.bookDir, input.dirName);
  const indexPath = join(dir, "index.json");
  const raw = await readText(indexPath);
  if (!raw) return 0;
  const records = safeArrayJson(raw);
  let count = 0;
  for (const record of records) {
    if (!isRecord(record)) continue;
    const id = stringValue(record.id) ?? `wr-${randomUUID()}`;
    const fileName = stringValue(record.contentFileName) ?? stringValue(record.fileName);
    const title = stringValue(record.title) ?? `未命名${input.type}`;
    const content = fileName ? (await readText(join(dir, fileName)) ?? "") : stringValue(record.content) ?? "";
    const timestamp = Date.parse(stringValue(record.updatedAt) ?? stringValue(record.createdAt) ?? "") || input.now();
    const chapterNumber = numberValue(record.chapterNumber) ?? numberValue(record.number) ?? numberValue(record.targetChapterId);
    const status = normalizeStatus(stringValue(record.status), input.defaultStatus);
    input.service.create({
      id,
      bookId: input.bookId,
      type: input.type,
      status,
      title,
      content,
      chapterNumber: input.type === "chapter" ? chapterNumber : (input.type === "candidate" ? numberValue(record.targetChapterId) : null),
      parentId: stringValue(record.parentId) ?? stringValue(record.sourceCandidateId) ?? null,
      version: numberValue(record.version) ?? 1,
      source: stringValue(record.source) ?? "import:file",
      metadata: isRecord(record.metadata) ? record.metadata : {},
      createdAt: Date.parse(stringValue(record.createdAt) ?? "") || timestamp,
      updatedAt: timestamp,
      acceptedAt: status === "accepted" ? timestamp : null,
    });
    count += 1;
  }
  return count;
}

async function listDirectories(path: string): Promise<string[]> {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

async function exists(path: string): Promise<boolean> {
  try { await readFile(path); return true; } catch { return false; }
}

async function readText(path: string): Promise<string | null> {
  try { return await readFile(path, "utf-8"); } catch { return null; }
}

async function writeMarker(path: string, value: Record<string, unknown>): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2), "utf-8");
}

function safeArrayJson(raw: string): unknown[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeStatus(value: string | undefined, fallback: WritingResourceStatus): WritingResourceStatus {
  if (value === "draft" || value === "candidate" || value === "accepted" || value === "rejected" || value === "archived") return value;
  return fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}
