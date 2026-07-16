import {
  createRuntimeAdminRequest,
  jsonRequest,
  type RuntimeAdminClientOptions,
} from "./client";

export const RUNTIME_STORAGE_SCAN_PATH = "/api/storage/scan";

export type StorageCleanupTarget = "uploads" | "shares" | "worktrees" | "containers";
export type DatabaseCleanupTarget = "archivedSessions" | "staleSessions" | "apiRequestDumps";

export interface StorageCategoryResult {
  readonly key: string;
  readonly sizeBytes: number;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface StorageScanResult {
  readonly categories: readonly StorageCategoryResult[];
  readonly totalBytes: number;
  readonly scannedAt: number;
}

export type CachedStorageResult =
  | { readonly cached: false }
  | { readonly cached: true; readonly data: StorageScanResult };

export interface StorageCleanupResult {
  readonly ok: boolean;
  readonly removed?: number;
  readonly freedBytes?: number;
  readonly success?: boolean;
  readonly output?: string;
}

export interface DatabaseCleanupRequest {
  readonly target: DatabaseCleanupTarget;
  readonly olderThanDays?: number;
}

export interface DatabaseCleanupPreviewRequest extends DatabaseCleanupRequest {
  readonly sampleLimit?: number;
}

export interface DatabaseCleanupCounts {
  readonly sessions: number;
  readonly narrators: number;
  readonly descendantNarrators: number;
  readonly messages: number;
  readonly toolCalls: number;
  readonly apiRequests: number;
  readonly dumpsCleared: number;
}

export interface DatabaseCleanupNarratorSample {
  readonly type: "narrator";
  readonly id: string;
  readonly title: string | null;
  readonly status: string;
  readonly lastActivityAt: string;
  readonly messageCount: number;
  readonly descendantNarratorCount: number;
  readonly approxBytes: number;
}

export interface DatabaseCleanupApiRequestSample {
  readonly type: "apiRequest";
  readonly id: string;
  readonly narratorId: string | null;
  readonly narratorTitle: string | null;
  readonly chapterTitle: string | null;
  readonly createdAt: string;
  readonly approxBytes: number;
}

export interface DatabaseCleanupBlockedItem {
  readonly narratorId: string;
  readonly title: string | null;
  readonly lastActivityAt: string;
  readonly reasonCode: string;
  readonly blockingNarratorId: string;
  readonly blockingTitle: string | null;
  readonly blockingStatus: string;
}

export interface DatabaseCleanupPreviewResult {
  readonly target: DatabaseCleanupTarget;
  readonly olderThanDays?: number;
  readonly approxBytes: number;
  readonly oldestAt: string | null;
  readonly counts: DatabaseCleanupCounts;
  readonly blockedCount: number;
  readonly warningCodes: readonly "deletesUsageHistory"[];
  readonly samples: readonly (DatabaseCleanupNarratorSample | DatabaseCleanupApiRequestSample)[];
  readonly blocked: readonly DatabaseCleanupBlockedItem[];
}

export interface DatabaseCleanupExecutionResult extends DatabaseCleanupPreviewResult {
  readonly ok: true;
  readonly beforeBytes: number;
  readonly afterBytes: number;
  readonly freedBytes: number;
  readonly vacuumRan: boolean;
  readonly changed: boolean;
}

export interface DatabaseVacuumResult {
  readonly ok: true;
  readonly beforeBytes: number;
  readonly afterBytes: number;
  readonly freedBytes: number;
  readonly freelistBeforeBytes: number;
  readonly freelistAfterBytes: number;
  readonly vacuumRan: boolean;
  readonly checkpointRan: boolean;
  readonly optimized: boolean;
  readonly durationMs: number;
}

export function createStorageClient(options: RuntimeAdminClientOptions = {}) {
  const request = createRuntimeAdminRequest(options);
  return {
    cached: () => request<CachedStorageResult>("/api/storage/cached"),
    cleanup: (target: StorageCleanupTarget) =>
      request<StorageCleanupResult>(
        "/api/storage/cleanup",
        jsonRequest("POST", { target }),
      ),
    previewDatabase: (input: DatabaseCleanupPreviewRequest) =>
      request<DatabaseCleanupPreviewResult>(
        "/api/storage/database/preview",
        jsonRequest("POST", input),
      ),
    cleanupDatabase: (input: DatabaseCleanupRequest) =>
      request<DatabaseCleanupExecutionResult>(
        "/api/storage/database/cleanup",
        jsonRequest("POST", input),
      ),
    vacuumDatabase: () =>
      request<DatabaseVacuumResult>("/api/storage/database/vacuum", { method: "POST" }),
  } as const;
}
