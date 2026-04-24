import { access, readdir, readFile, rename, stat } from "node:fs/promises";
import { join } from "node:path";

import type { StorageDatabase } from "./db.js";
import { createKvRepository } from "./repositories/kv-repo.js";

const DONE_KEY = "migration:json-to-sqlite:done";
const COMPLETED_AT_KEY = "migration:json-to-sqlite:completed_at";

type JsonRecord = Record<string, unknown>;

export interface RunJsonImportMigrationOptions {
  storageDir: string;
  now?: Date;
  warn?: (message: string, error?: unknown) => void;
}

export interface JsonImportMigrationResult {
  status: "imported" | "skipped";
  reason?: "already-done" | "no-source" | "sessions-exist";
  importedSessions: number;
  importedMessages: number;
  skippedSessions: number;
  backupSuffix?: string;
}

interface LegacySessionRecord extends JsonRecord {
  id?: unknown;
  createdAt?: unknown;
  lastModified?: unknown;
  updatedAt?: unknown;
  messageCount?: unknown;
  sessionConfig?: unknown;
}

interface LegacyMessageRecord extends JsonRecord {
  id?: unknown;
  role?: unknown;
  content?: unknown;
  timestamp?: unknown;
  seq?: unknown;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf-8")) as T;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseDate(value: unknown, fallback: Date): Date {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value);
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return new Date(parsed);
    }
  }
  return fallback;
}

function toMessageRole(value: unknown): "user" | "assistant" | "system" {
  return value === "assistant" || value === "system" ? value : "user";
}

function sanitizeSeq(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function backupSuffix(now: Date): string {
  return `migrated-${now.toISOString().replace(/[-:.]/gu, "")}.bak`;
}

async function listLegacyHistoryFiles(historyDir: string): Promise<string[]> {
  if (!(await isDirectory(historyDir))) {
    return [];
  }
  return (await readdir(historyDir))
    .filter((entry) => entry.endsWith(".json"))
    .map((entry) => join(historyDir, entry));
}

async function backupLegacyJsonFiles(storageDir: string, suffix: string): Promise<void> {
  const sessionsPath = join(storageDir, "sessions.json");
  if (await exists(sessionsPath)) {
    await rename(sessionsPath, `${sessionsPath}.${suffix}`);
  }

  for (const historyFile of await listLegacyHistoryFiles(join(storageDir, "session-history"))) {
    await rename(historyFile, `${historyFile}.${suffix}`);
  }
}

function countSessions(storage: StorageDatabase): number {
  const row = storage.sqlite.prepare(`SELECT COUNT(*) AS "count" FROM "session" WHERE "deleted_at" IS NULL`).get() as { count: number };
  return row.count;
}

function normalizeSessions(raw: unknown): LegacySessionRecord[] {
  return Array.isArray(raw) ? raw.filter(isRecord) : [];
}

function normalizeMessages(raw: unknown): LegacyMessageRecord[] {
  return Array.isArray(raw) ? raw.filter(isRecord) : [];
}

export async function runJsonImportMigrationIfNeeded(
  storage: StorageDatabase,
  options: RunJsonImportMigrationOptions,
): Promise<JsonImportMigrationResult> {
  const kv = createKvRepository(storage);
  if (await kv.get(DONE_KEY)) {
    return { status: "skipped", reason: "already-done", importedSessions: 0, importedMessages: 0, skippedSessions: 0 };
  }

  const sessionsPath = join(options.storageDir, "sessions.json");
  const historyDir = join(options.storageDir, "session-history");
  const hasSessionsJson = await exists(sessionsPath);
  const hasHistoryDir = await isDirectory(historyDir);
  if (!hasSessionsJson && !hasHistoryDir) {
    return { status: "skipped", reason: "no-source", importedSessions: 0, importedMessages: 0, skippedSessions: 0 };
  }

  if (countSessions(storage) > 0) {
    return { status: "skipped", reason: "sessions-exist", importedSessions: 0, importedMessages: 0, skippedSessions: 0 };
  }

  const now = options.now ?? new Date();
  let legacySessions: LegacySessionRecord[] = [];
  if (hasSessionsJson) {
    try {
      legacySessions = normalizeSessions(await readJson<unknown>(sessionsPath));
    } catch (error) {
      options.warn?.(`[json-import] skip corrupted sessions.json`, error);
      legacySessions = [];
    }
  }

  let importedSessions = 0;
  let importedMessages = 0;
  let skippedSessions = 0;

  const importOneSession = storage.sqlite.transaction((session: LegacySessionRecord, messages: LegacyMessageRecord[]) => {
    const sessionId = String(session.id);
    const createdAt = parseDate(session.createdAt, now);
    const updatedAt = parseDate(session.lastModified ?? session.updatedAt, createdAt);
    const normalizedMessages = messages.map((message, index) => ({
      seq: sanitizeSeq(message.seq, index + 1),
      id: typeof message.id === "string" && message.id.trim() ? message.id : `${sessionId}-${index + 1}`,
      role: toMessageRole(message.role),
      content: typeof message.content === "string" ? message.content : "",
      timestamp: parseDate(message.timestamp, updatedAt),
      metadataJson: JSON.stringify({ ...message }),
    })).sort((a, b) => a.seq - b.seq);

    storage.sqlite.prepare(`
      INSERT OR IGNORE INTO "session" (
        "id", "created_at", "updated_at", "message_count", "config_json", "metadata_json", "deleted_at"
      ) VALUES (?, ?, ?, ?, ?, ?, NULL)
    `).run(
      sessionId,
      createdAt.getTime(),
      updatedAt.getTime(),
      normalizedMessages.length,
      JSON.stringify(isRecord(session.sessionConfig) ? session.sessionConfig : {}),
      JSON.stringify(session),
    );

    let nextSeq = 1;
    for (const message of normalizedMessages) {
      const seq = Math.max(nextSeq, message.seq);
      storage.sqlite.prepare(`
        INSERT INTO "session_message" (
          "session_id", "seq", "id", "role", "content", "timestamp", "metadata_json"
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        sessionId,
        seq,
        message.id,
        message.role,
        message.content,
        message.timestamp.getTime(),
        message.metadataJson,
      );
      nextSeq = seq + 1;
    }

    const lastSeq = normalizedMessages.length > 0 ? nextSeq - 1 : 0;
    const availableFromSeq = normalizedMessages.length > 0 ? normalizedMessages[0]?.seq ?? 1 : 0;
    storage.sqlite.prepare(`
      INSERT OR REPLACE INTO "session_message_cursor" (
        "session_id", "last_seq", "available_from_seq", "updated_at"
      ) VALUES (?, ?, ?, ?)
    `).run(sessionId, lastSeq, availableFromSeq, updatedAt.getTime());

    return normalizedMessages.length;
  });

  for (const session of legacySessions) {
    if (typeof session.id !== "string" || !session.id.trim()) {
      skippedSessions += 1;
      options.warn?.("[json-import] skip session without valid id");
      continue;
    }

    const historyPath = join(historyDir, `${session.id}.json`);
    let messages: LegacyMessageRecord[] = [];
    if (await exists(historyPath)) {
      try {
        messages = normalizeMessages(await readJson<unknown>(historyPath));
      } catch (error) {
        skippedSessions += 1;
        options.warn?.(`[json-import] skip session ${session.id} because history JSON is corrupted`, error);
        continue;
      }
    }

    try {
      const importedMessageCount = importOneSession(session, messages);
      importedSessions += 1;
      importedMessages += importedMessageCount;
    } catch (error) {
      skippedSessions += 1;
      options.warn?.(`[json-import] skip session ${session.id}`, error);
    }
  }

  await kv.set(DONE_KEY, "true", now);
  await kv.set(COMPLETED_AT_KEY, now.toISOString(), now);
  const suffix = backupSuffix(now);
  await backupLegacyJsonFiles(options.storageDir, suffix);

  return {
    status: "imported",
    importedSessions,
    importedMessages,
    skippedSessions,
    backupSuffix: suffix,
  };
}
