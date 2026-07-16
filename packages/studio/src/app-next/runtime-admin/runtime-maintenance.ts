import {
  createRuntimeAdminRequest,
  jsonRequest,
  type RuntimeAdminClientOptions,
} from "./client";

export type RuntimeCleanupTarget = "terminals" | "containers" | "browsers";

export interface RuntimeDiagnosticFields {
  readonly reason?: string;
  readonly message?: string;
  readonly error?: string;
  readonly code?: string;
  readonly dbError?: string;
}

export interface RuntimeTerminalInfo extends RuntimeDiagnosticFields {
  readonly running: number;
  readonly exited: number;
  readonly orphanSockets: number;
}

export interface RuntimeContainerInfo extends RuntimeDiagnosticFields {
  readonly running: number;
  readonly stopped: number;
  readonly podmanAvailable: boolean;
}

export interface RuntimeBrowserInfo extends RuntimeDiagnosticFields {
  readonly processRunning: boolean;
  readonly connected: boolean;
  readonly headedRunning: boolean;
  readonly headedConnected: boolean;
  readonly activeSessions: number;
}

export interface RuntimeScanResult {
  readonly terminals: RuntimeTerminalInfo;
  readonly containers: RuntimeContainerInfo;
  readonly browsers: RuntimeBrowserInfo;
  readonly scannedAt: number;
}

export type CachedRuntimeResult =
  | { readonly cached: false }
  | { readonly cached: true; readonly data: RuntimeScanResult };

export interface RuntimeCleanupError {
  readonly target: string;
  readonly id?: string;
  readonly error: string;
}

export interface RuntimeCleanupResult {
  readonly ok: boolean;
  readonly dryRun?: boolean;
  readonly killed?: number;
  readonly stopped?: number;
  readonly closedSessions?: number;
  readonly browserClosed?: boolean;
  readonly errors?: readonly RuntimeCleanupError[];
}

export function createRuntimeMaintenanceClient(options: RuntimeAdminClientOptions = {}) {
  const request = createRuntimeAdminRequest(options);
  return {
    cached: () => request<CachedRuntimeResult>("/api/runtime/cached"),
    scan: () => request<RuntimeScanResult>("/api/runtime/scan"),
    cleanup: (target: RuntimeCleanupTarget) =>
      request<RuntimeCleanupResult>(
        "/api/runtime/cleanup",
        jsonRequest("POST", { target }),
      ),
  } as const;
}
