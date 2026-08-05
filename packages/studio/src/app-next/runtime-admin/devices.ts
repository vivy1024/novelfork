import {
  createRuntimeAdminRequest,
  encodePathSegment,
  jsonRequest,
  type RuntimeAdminClientOptions,
} from "./client";

export type DeviceConnectionMode = "reverse" | "direct";
export type DeviceScope = "global" | "project";
export type DeviceStatus = "online" | "offline";

export interface RuntimeDevice {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly description: string | null;
  readonly tokenPrefix: string;
  readonly connectionMode: DeviceConnectionMode;
  readonly directUrl: string | null;
  readonly status: DeviceStatus;
  readonly lastSeenAt: string | null;
  readonly platformOs: string | null;
  readonly platformArch: string | null;
  readonly shellPath: string | null;
  readonly defaultCwd: string | null;
  readonly agentVersion: string | null;
  readonly capabilities: Readonly<Record<string, unknown>> | null;
  readonly scope: DeviceScope;
  readonly projectId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly revokedAt: string | null;
}

export interface CreateRuntimeDeviceInput {
  readonly name: string;
  readonly slug?: string;
  readonly description?: string;
  readonly connectionMode: DeviceConnectionMode;
  readonly directUrl?: string;
  readonly scope: DeviceScope;
  readonly projectId?: string;
}

export interface UpdateRuntimeDeviceInput {
  readonly name?: string;
  readonly description?: string | null;
  readonly connectionMode?: DeviceConnectionMode;
  readonly directUrl?: string | null;
  readonly scope?: DeviceScope;
  readonly projectId?: string | null;
}

export interface IssuedDeviceToken {
  readonly token: string;
}

export interface CreatedRuntimeDevice extends IssuedDeviceToken {
  readonly device: RuntimeDevice;
}

export interface DeviceTransferInput {
  readonly direction: "download" | "upload";
  readonly remotePath: string;
  readonly localPath: string;
  readonly recursive?: boolean;
}

export interface DeviceTransferResult {
  readonly ok: boolean;
  readonly filesTransferred: number;
  readonly bytesTransferred: number;
}

/** Handshake phase the Runtime reports for a device connection. */
export type DeviceConnectionStage =
  | "ready"
  | "waiting_for_executor"
  | "idle"
  | "connecting"
  | "waiting_auth_init"
  | "authenticating"
  | "waiting_hello"
  | "reconnect_wait"
  | "offline";

/**
 * Connection diagnostics from `GET /api/devices/:id/diagnostics`.
 *
 * Without these fields a failed device connection is indistinguishable from an
 * idle one: the stage tells the operator where the handshake stopped and
 * `lastError` carries the actual transport failure.
 */
export interface DeviceConnectionDiagnostics {
  readonly deviceId: string;
  readonly mode: DeviceConnectionMode;
  readonly online: boolean;
  readonly stage: DeviceConnectionStage;
  readonly directUrl?: string | null;
  readonly socketState?: "connecting" | "open" | "closing" | "closed";
  readonly lastError?: string | null;
  readonly lastEventAt?: number;
  readonly lastSeenAt?: string | null;
  readonly agentVersion?: string;
  readonly protocolVersion?: number;
  readonly platform?: Readonly<Record<string, unknown>>;
  readonly capabilities?: Readonly<Record<string, unknown>>;
  readonly defaultCwd?: string | null;
}

/** Result of `POST /api/devices/:id/test`; `stage` may also be rpc_ready/rpc_failed. */
export interface DeviceConnectionTestResult {
  readonly ok: boolean;
  readonly stage: string;
  readonly latencyMs?: number;
  readonly message?: string;
  readonly diagnostics: DeviceConnectionDiagnostics;
}

/**
 * Minimal project shape from `GET /api/projects`, used to bind a project-scoped
 * device without asking the operator to memorize project ids.
 */
export interface RuntimeProjectOption {
  readonly id: string;
  readonly name: string;
  readonly status?: string;
}

export function createDevicesClient(options: RuntimeAdminClientOptions = {}) {
  const request = createRuntimeAdminRequest(options);

  return {
    listDevices: () => request<RuntimeDevice[]>("/api/devices"),
    listProjects: () => request<RuntimeProjectOption[]>("/api/projects?status=active"),
    createDevice: (input: CreateRuntimeDeviceInput) =>
      request<CreatedRuntimeDevice>("/api/devices", jsonRequest("POST", input)),
    updateDevice: (id: string, input: UpdateRuntimeDeviceInput) =>
      request<RuntimeDevice>(
        `/api/devices/${encodePathSegment(id)}`,
        jsonRequest("PATCH", input),
      ),
    rotateToken: (id: string) =>
      request<IssuedDeviceToken>(
        `/api/devices/${encodePathSegment(id)}/rotate-token`,
        { method: "POST" },
      ),
    deleteDevice: (id: string) =>
      request<{ success: boolean }>(`/api/devices/${encodePathSegment(id)}`, { method: "DELETE" }),
    transferFiles: (id: string, input: DeviceTransferInput) =>
      request<DeviceTransferResult>(
        `/api/devices/${encodePathSegment(id)}/transfers`,
        jsonRequest("POST", input),
      ),
    diagnostics: (id: string) =>
      request<DeviceConnectionDiagnostics>(
        `/api/devices/${encodePathSegment(id)}/diagnostics`,
      ),
    testConnection: (id: string) =>
      request<DeviceConnectionTestResult>(
        `/api/devices/${encodePathSegment(id)}/test`,
        { method: "POST" },
      ),
  } as const;
}

export type DevicesClient = ReturnType<typeof createDevicesClient>;
