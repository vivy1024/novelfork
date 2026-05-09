import {
  closeStorageDatabase,
  createSessionRepository,
  type StoredSessionRecord,
} from "@vivy1024/novelfork-core";

import {
  DEFAULT_SESSION_CONFIG,
  normalizeSessionPermissionMode,
  type CreateNarratorSessionInput,
  type NarratorSessionKind,
  type NarratorSessionRecoveryMetadata,
  type NarratorSessionRecord,
  type NarratorSessionStatus,
  type SessionConfig,
  type UpdateNarratorSessionInput,
} from "../../shared/session-types.js";
import { deleteSessionChatHistory, markSessionChatHistoryDeleted } from "./session-history-store.js";
import { getSessionStorageDatabase } from "./session-storage.js";
import { normalizeSessionToolPolicy } from "./session-tool-policy.js";
import { loadUserConfig } from "./user-config-service.js";
import { loadGlobalRoutines } from "./routines-service.js";
import type { SessionToolPolicy } from "../../shared/session-types.js";

export type SessionListBinding = "standalone" | "book" | "chapter";
export type SessionListSort = "manual" | "recent" | "lastModified-desc";

export interface ListSessionsOptions {
  readonly kind?: NarratorSessionKind;
  readonly projectId?: string;
  readonly chapterId?: string;
  readonly status?: NarratorSessionStatus;
  readonly binding?: SessionListBinding;
  readonly search?: string;
  readonly sort?: SessionListSort;
}

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
  // Support both "providerId:modelId" and "provider name:modelId" formats
  const colonIndex = reference.indexOf(":");
  if (colonIndex === -1) {
    return null;
  }
  const providerId = reference.slice(0, colonIndex).trim();
  const modelId = reference.slice(colonIndex + 1).trim();
  if (!providerId || !modelId) {
    return null;
  }
  return { providerId, modelId };
}

function normalizeSessionConfig(value: unknown): SessionConfig {
  const merged = {
    ...DEFAULT_SESSION_CONFIG,
    ...(typeof value === "object" && value !== null ? value : {}),
  } as SessionConfig;

  const toolPolicy = normalizeSessionToolPolicy((merged as { toolPolicy?: unknown }).toolPolicy);
  const { toolPolicy: _ignoredToolPolicy, ...rest } = merged as SessionConfig & { toolPolicy?: unknown };
  return {
    ...rest,
    permissionMode: normalizeSessionPermissionMode(merged.permissionMode),
    ...(toolPolicy ? { toolPolicy } : {}),
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
    ...(metadata.cumulativeUsage ? { cumulativeUsage: metadata.cumulativeUsage } : {}),
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

function sortSessionsByRecentActivity(records: NarratorSessionRecord[]): NarratorSessionRecord[] {
  return [...records].sort((a, b) => {
    const modifiedDelta = new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime();
    if (modifiedDelta !== 0) return modifiedDelta;
    return a.sortOrder - b.sortOrder;
  });
}

function getSessionBinding(session: NarratorSessionRecord): SessionListBinding {
  if (session.chapterId) return "chapter";
  if (session.projectId) return "book";
  return "standalone";
}

function normalizeSearch(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function matchesSessionSearch(session: NarratorSessionRecord, search: string): boolean {
  if (!search) return true;
  return [
    session.id,
    session.title,
    session.agentId,
    session.projectId,
    session.chapterId,
    session.sessionConfig.providerId,
    session.sessionConfig.modelId,
  ].some((value) => value?.toLowerCase().includes(search));
}

function filterSessions(records: NarratorSessionRecord[], options: ListSessionsOptions): NarratorSessionRecord[] {
  const search = normalizeSearch(options.search);
  return records.filter((session) => {
    if (options.kind && session.kind !== options.kind) return false;
    if (options.status && session.status !== options.status) return false;
    if (options.projectId && session.projectId !== options.projectId) return false;
    if (options.chapterId && session.chapterId !== options.chapterId) return false;
    if (options.binding && getSessionBinding(session) !== options.binding) return false;
    return matchesSessionSearch(session, search);
  });
}

async function loadSessionRecords(): Promise<NarratorSessionRecord[]> {
  const records = await getSessionRepo().list();
  return records.map(toNarratorSessionRecord);
}

export async function listSessions(options: ListSessionsOptions = {}): Promise<NarratorSessionRecord[]> {
  const sessions = filterSessions(await loadSessionRecords(), options);
  return options.sort === "recent" || options.sort === "lastModified-desc" ? sortSessionsByRecentActivity(sessions) : sortSessions(sessions);
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

  // 从 routines 继承工具权限配置
  let inheritedToolPolicy: SessionToolPolicy | undefined;
  try {
    const routines = await loadGlobalRoutines();
    if (routines.permissions.length > 0) {
      const allow = routines.permissions.filter(p => p.permission === "allow").map(p => p.tool);
      const deny = routines.permissions.filter(p => p.permission === "deny").map(p => p.tool);
      const ask = routines.permissions.filter(p => p.permission === "ask").map(p => p.tool);
      if (allow.length > 0 || deny.length > 0 || ask.length > 0) {
        inheritedToolPolicy = {
          ...(allow.length > 0 ? { allow } : {}),
          ...(deny.length > 0 ? { deny } : {}),
          ...(ask.length > 0 ? { ask } : {}),
        };
      }
    }
  } catch { /* routines 加载失败不阻塞会话创建 */ }

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
      ...(inheritedToolPolicy ? { toolPolicy: inheritedToolPolicy } : {}),
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
