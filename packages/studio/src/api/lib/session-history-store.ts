import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { NarratorSessionChatMessage } from "../../shared/session-types.js";
import { resolveRuntimeStorageDir } from "./runtime-storage-paths.js";

function getSessionHistoryDir(): string {
  const overrideDir = process.env.NOVELFORK_SESSION_STORE_DIR?.trim();
  if (overrideDir) {
    return join(overrideDir, "session-history");
  }
  return resolveRuntimeStorageDir("session-history");
}

function getSessionHistoryFilePath(sessionId: string): string {
  return join(getSessionHistoryDir(), `${sessionId}.json`);
}

async function ensureSessionHistoryDir(): Promise<void> {
  await mkdir(getSessionHistoryDir(), { recursive: true });
}

const historyWriteQueues = new Map<string, Promise<void>>();
const deletedHistorySessions = new Set<string>();

export function markSessionChatHistoryDeleted(sessionId: string): void {
  deletedHistorySessions.add(sessionId);
}

export function isSessionChatHistoryDeleted(sessionId: string): boolean {
  return deletedHistorySessions.has(sessionId);
}

async function runSessionHistoryWrite<T>(sessionId: string, task: () => Promise<T>): Promise<T> {
  const previous = historyWriteQueues.get(sessionId) ?? Promise.resolve();
  let release!: () => void;
  const current = previous.then(() => new Promise<void>((resolve) => {
    release = resolve;
  }));
  historyWriteQueues.set(sessionId, current);

  await previous;
  try {
    return await task();
  } finally {
    release();
    if (historyWriteQueues.get(sessionId) === current) {
      historyWriteQueues.delete(sessionId);
    }
  }
}

export async function loadSessionChatHistory(sessionId: string): Promise<NarratorSessionChatMessage[]> {
  if (isSessionChatHistoryDeleted(sessionId)) {
    return [];
  }

  await ensureSessionHistoryDir();
  const filePath = getSessionHistoryFilePath(sessionId);

  if (!existsSync(filePath)) {
    return [];
  }

  try {
    const raw = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as NarratorSessionChatMessage[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveSessionChatHistory(sessionId: string, messages: NarratorSessionChatMessage[]): Promise<void> {
  if (isSessionChatHistoryDeleted(sessionId)) {
    return;
  }

  await ensureSessionHistoryDir();
  await writeFile(getSessionHistoryFilePath(sessionId), JSON.stringify(messages, null, 2), "utf-8");
}

export async function appendSessionChatHistory(
  sessionId: string,
  messages: NarratorSessionChatMessage[],
  seedMessages: NarratorSessionChatMessage[] = [],
): Promise<NarratorSessionChatMessage[]> {
  if (isSessionChatHistoryDeleted(sessionId)) {
    return [];
  }

  return runSessionHistoryWrite(sessionId, async () => {
    if (isSessionChatHistoryDeleted(sessionId)) {
      return [];
    }

    const existingMessages = await loadSessionChatHistory(sessionId);
    const nextMessages = existingMessages.length > 0 ? [...existingMessages] : [...seedMessages];
    nextMessages.push(...messages);
    await saveSessionChatHistory(sessionId, nextMessages);
    return nextMessages;
  });
}

export async function deleteSessionChatHistory(sessionId: string): Promise<void> {
  markSessionChatHistoryDeleted(sessionId);
  await runSessionHistoryWrite(sessionId, async () => {
    await rm(getSessionHistoryFilePath(sessionId), { force: true });
  });
}
