import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

import {
  DEFAULT_SESSION_CONFIG,
  type CreateNarratorSessionInput,
  type NarratorSessionRecord,
  type UpdateNarratorSessionInput,
} from "../../shared/session-types.js";
import { deleteSessionChatHistory, markSessionChatHistoryDeleted } from "./session-history-store.js";
import { loadUserConfig } from "./user-config-service.js";

function getSessionStoreFilePath(): string {
  const overrideDir = process.env.NOVELFORK_SESSION_STORE_DIR?.trim();
  if (overrideDir) {
    return join(overrideDir, "sessions.json");
  }
  return join(homedir(), ".inkos", "sessions.json");
}

async function ensureSessionStoreDir(): Promise<void> {
  await mkdir(dirname(getSessionStoreFilePath()), { recursive: true });
}

async function loadSessionRecords(): Promise<NarratorSessionRecord[]> {
  await ensureSessionStoreDir();
  const filePath = getSessionStoreFilePath();

  if (!existsSync(filePath)) {
    return [];
  }

  try {
    const raw = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as NarratorSessionRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function saveSessionRecords(records: NarratorSessionRecord[]): Promise<void> {
  await ensureSessionStoreDir();
  await writeFile(getSessionStoreFilePath(), JSON.stringify(records, null, 2), "utf-8");
}

let sessionStoreMutationQueue: Promise<void> = Promise.resolve();
let sessionStoreMutationHook: (() => Promise<void> | void) | undefined;

async function mutateSessionRecords<T>(
  mutator: (records: NarratorSessionRecord[]) => Promise<T> | T,
): Promise<T> {
  const previous = sessionStoreMutationQueue;
  let release!: () => void;
  sessionStoreMutationQueue = new Promise<void>((resolve) => {
    release = resolve;
  });

  await previous;
  try {
    await sessionStoreMutationHook?.();
    const records = await loadSessionRecords();
    const result = await mutator(records);
    await saveSessionRecords(records);
    return result;
  } finally {
    release();
  }
}

function sortSessions(records: NarratorSessionRecord[]): NarratorSessionRecord[] {
  return [...records].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) {
      return a.sortOrder - b.sortOrder;
    }
    return new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime();
  });
}

function parseModelReference(reference: string | undefined): { providerId: string; modelId: string } | null {
  if (!reference) {
    return null;
  }
  const [providerId, modelId] = reference.split(":");
  if (!providerId || !modelId) {
    return null;
  }
  return {
    providerId,
    modelId,
  };
}

export async function listSessions(): Promise<NarratorSessionRecord[]> {
  return sortSessions(await loadSessionRecords());
}

export async function getSessionById(id: string): Promise<NarratorSessionRecord | null> {
  const records = await loadSessionRecords();
  return records.find((record) => record.id === id) ?? null;
}

export async function createSession(input: CreateNarratorSessionInput): Promise<NarratorSessionRecord> {
  const userConfig = await loadUserConfig();
  const modelDefaults = parseModelReference(userConfig.modelDefaults?.defaultSessionModel);

  return mutateSessionRecords(async (records) => {
    const now = new Date().toISOString();
    const session: NarratorSessionRecord = {
      id: crypto.randomUUID(),
      title: input.title?.trim() || "Untitled Session",
      agentId: input.agentId?.trim() || "writer",
      kind: input.kind ?? "standalone",
      sessionMode: input.sessionMode ?? (input.agentId === "planner" ? "plan" : "chat"),
      status: "active",
      createdAt: now,
      lastModified: now,
      messageCount: 0,
      sortOrder: records.length,
      worktree: input.worktree,
      chapterId: input.chapterId,
      projectId: input.projectId,
      sessionConfig: {
        ...DEFAULT_SESSION_CONFIG,
        ...(modelDefaults ?? {}),
        permissionMode: userConfig.runtimeControls.defaultPermissionMode,
        reasoningEffort: userConfig.runtimeControls.defaultReasoningEffort,
        ...input.sessionConfig,
      },
      recentMessages: [],
    };

    records.push(session);
    return session;
  });
}

export async function updateSession(id: string, updates: UpdateNarratorSessionInput): Promise<NarratorSessionRecord | null> {
  return mutateSessionRecords(async (records) => {
    const index = records.findIndex((record) => record.id === id);
    if (index < 0) {
      return null;
    }

    const current = records[index]!;
    const updated: NarratorSessionRecord = {
      ...current,
      ...updates,
      id,
      lastModified: new Date().toISOString(),
      sessionConfig: {
        ...current.sessionConfig,
        ...updates.sessionConfig,
      },
    };

    records[index] = updated;
    return updated;
  });
}

export async function deleteSession(id: string): Promise<boolean> {
  markSessionChatHistoryDeleted(id);

  const deleted = await mutateSessionRecords(async (records) => {
    const index = records.findIndex((record) => record.id === id);
    if (index < 0) {
      return false;
    }

    records.splice(index, 1);
    return true;
  });

  if (deleted) {
    await deleteSessionChatHistory(id);
  }

  return deleted;
}

export const __testing = {
  setSessionStoreMutationHook(hook?: () => Promise<void> | void) {
    sessionStoreMutationHook = hook;
  },
  resetSessionStoreMutationQueue() {
    sessionStoreMutationQueue = Promise.resolve();
    sessionStoreMutationHook = undefined;
  },
};
