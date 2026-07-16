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

export function createDevicesClient(options: RuntimeAdminClientOptions = {}) {
  const request = createRuntimeAdminRequest(options);

  return {
    listDevices: () => request<RuntimeDevice[]>("/api/devices"),
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
  } as const;
}

export type DevicesClient = ReturnType<typeof createDevicesClient>;
