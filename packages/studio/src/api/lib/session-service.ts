import {
  closeStorageDatabase,
  createSessionRepository,
  type StoredSessionRecord,
} from "@vivy1024/novelfork-core";

import {
  DEFAULT_SESSION_CONFIG,
  normalizeSessionPermissionMode,
  type CreateNarratorSessionInput,
  type NarratorSessionRecoveryMetadata,
  type NarratorSessionRecord,
  type SessionConfig,
  type UpdateNarratorSessionInput,
} from "../../shared/session-types.js";
import { deleteSessionChatHistory, markSessionChatHistoryDeleted } from "./session-history-store.js";
import { getSessionStorageDatabase } from "./session-storage.js";
import { loadUserConfig } from "./user-config-service.js";

export let sessionStoreMutationQueue: Promise<void> = Promise.resolve();
let sessionStoreMutationHook: (() => Promise<void> | void) | undefined;

function getSessionRepo() {
  return createSessionRepository(getSessionStorageDatabase());
}

function safeParseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function toDate(value: string | undefined, fallback: Date): Date {
  if (!value) return fallback;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed) : fallback;
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

function normalizeSessionConfig(value: unknown): SessionConfig {
  const merged = {
    ...DEFAULT_SESSION_CONFIG,
    ...(typeof value === "object" && value !== null ? value : {}),
  } as SessionConfig;

  return {
    ...merged,
    permissionMode: normalizeSessionPermissionMode(merged.permissionMode),
  };
}

function normalizeRecoveryMetadata(value: unknown): NarratorSessionRecoveryMetadata | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const metadata = value as Partial<NarratorSessionRecoveryMetadata>;
  const lastSeq = typeof metadata.lastSeq === "number" && Number.isFinite(metadata.lastSeq) ? Math.max(0, Math.floor(metadata.lastSeq)) : 0;
  const lastAckedSeq = typeof metadata.lastAckedSeq === "number" && Number.isFinite(metadata.lastAckedSeq)
    ? Math.max(0, Math.min(Math.floor(metadata.lastAckedSeq), lastSeq))
    : 0;
  const availableFromSeq = typeof metadata.availableFromSeq === "number" && Number.isFinite(metadata.availableFromSeq)
    ? Math.max(0, Math.floor(metadata.availableFromSeq))
    : 0;
  return {
    lastSeq,
    lastAckedSeq,
    availableFromSeq,
    pendingMessageCount: typeof metadata.pendingMessageCount === "number" && Number.isFinite(metadata.pendingMessageCount)
      ? Math.max(0, Math.floor(metadata.pendingMessageCount))
      : Math.max(0, lastSeq - lastAckedSeq),
    pendingToolCallCount: typeof metadata.pendingToolCallCount === "number" && Number.isFinite(metadata.pendingToolCallCount)
      ? Math.max(0, Math.floor(metadata.pendingToolCallCount))
      : 0,
    pendingToolCallSummary: Array.isArray(metadata.pendingToolCallSummary)
      ? metadata.pendingToolCallSummary.filter((item): item is string => typeof item === "string")
      : undefined,
    lastFailure: typeof metadata.lastFailure === "object" && metadata.lastFailure !== null
      && typeof metadata.lastFailure.reason === "string"
      && typeof metadata.lastFailure.message === "string"
      && typeof metadata.lastFailure.at === "string"
      ? metadata.lastFailure
      : undefined,
    updatedAt: typeof metadata.updatedAt === "string" ? metadata.updatedAt : new Date(0).toISOString(),
  };
}

function toNarratorSessionRecord(record: StoredSessionRecord): NarratorSessionRecord {
  const metadata = safeParseJson<Partial<NarratorSessionRecord>>(record.metadataJson, {});
  const sessionConfig = normalizeSessionConfig(safeParseJson<Partial<SessionConfig>>(record.configJson, metadata.sessionConfig ?? {}));
  const createdAt = metadata.createdAt ?? record.createdAt.toISOString();
  const lastModified = record.updatedAt.toISOString();

  return {
    id: record.id,
    title: metadata.title?.trim() || "Untitled Session",
    agentId: metadata.agentId?.trim() || "writer",
    kind: metadata.kind ?? "standalone",
    sessionMode: metadata.sessionMode ?? (metadata.agentId === "planner" ? "plan" : "chat"),
    status: metadata.status ?? "active",
    createdAt,
    lastModified,
    messageCount: record.messageCount,
    sortOrder: typeof metadata.sortOrder === "number" ? metadata.sortOrder : 0,
    worktree: metadata.worktree,
    chapterId: metadata.chapterId,
    projectId: metadata.projectId,
    sessionConfig,
    recentMessages: Array.isArray(metadata.recentMessages) ? metadata.recentMessages : [],
    recovery: normalizeRecoveryMetadata(metadata.recovery),
  };
}

function toStoredSessionInput(session: NarratorSessionRecord) {
  return {
    id: session.id,
    createdAt: toDate(session.createdAt, new Date()),
    updatedAt: toDate(session.lastModified, new Date()),
    messageCount: session.messageCount,
    configJson: JSON.stringify(session.sessionConfig),
    metadataJson: JSON.stringify(session),
  };
}

function sortSessions(records: NarratorSessionRecord[]): NarratorSessionRecord[] {
  return [...records].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) {
      return a.sortOrder - b.sortOrder;
    }
    return new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime();
  });
}

async function loadSessionRecords(): Promise<NarratorSessionRecord[]> {
  const records = await getSessionRepo().list();
  return records.map(toNarratorSessionRecord);
}

export async function listSessions(): Promise<NarratorSessionRecord[]> {
  return sortSessions(await loadSessionRecords());
}

export async function getSessionById(id: string): Promise<NarratorSessionRecord | null> {
  const record = await getSessionRepo().getById(id);
  return record ? toNarratorSessionRecord(record) : null;
}

export async function createSession(input: CreateNarratorSessionInput): Promise<NarratorSessionRecord> {
  const userConfig = await loadUserConfig();
  const modelDefaults = parseModelReference(userConfig.modelDefaults?.defaultSessionModel);
  const records = await loadSessionRecords();
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
    sessionConfig: normalizeSessionConfig({
      ...DEFAULT_SESSION_CONFIG,
      ...(modelDefaults ?? {}),
      permissionMode: userConfig.runtimeControls.defaultPermissionMode,
      reasoningEffort: userConfig.runtimeControls.defaultReasoningEffort,
      ...input.sessionConfig,
    }),
    recentMessages: [],
    recovery: {
      lastSeq: 0,
      lastAckedSeq: 0,
      availableFromSeq: 0,
      pendingMessageCount: 0,
      pendingToolCallCount: 0,
      updatedAt: now,
    },
  };

  await sessionStoreMutationHook?.();
  const stored = await getSessionRepo().create(toStoredSessionInput(session));
  return toNarratorSessionRecord(stored);
}

export async function updateSession(id: string, updates: UpdateNarratorSessionInput): Promise<NarratorSessionRecord | null> {
  await sessionStoreMutationHook?.();
  const current = await getSessionById(id);
  if (!current) {
    return null;
  }

  const updated: NarratorSessionRecord = {
    ...current,
    ...updates,
    id,
    lastModified: new Date().toISOString(),
    sessionConfig: normalizeSessionConfig({
      ...current.sessionConfig,
      ...updates.sessionConfig,
    }),
  };

  const stored = await getSessionRepo().update(id, toStoredSessionInput(updated));
  return stored ? toNarratorSessionRecord(stored) : null;
}

export async function deleteSession(id: string): Promise<boolean> {
  markSessionChatHistoryDeleted(id);
  const current = await getSessionById(id);
  if (!current) {
    return false;
  }

  await deleteSessionChatHistory(id);
  return getSessionRepo().softDelete(id);
}

export const __testing = {
  setSessionStoreMutationHook(hook?: () => Promise<void> | void) {
    sessionStoreMutationHook = hook;
  },
  resetSessionStoreMutationQueue() {
    sessionStoreMutationQueue = Promise.resolve();
    sessionStoreMutationHook = undefined;
    closeStorageDatabase();
  },
};
