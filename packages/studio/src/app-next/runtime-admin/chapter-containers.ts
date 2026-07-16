import {
  createRuntimeAdminRequest,
  jsonRequest,
  type RuntimeAdminClientOptions,
} from "./client";

export interface RuntimeChapterSettings {
  readonly maxActiveWorktrees?: number;
  readonly maxActiveContainers?: number;
  readonly worktreeSizeWarningMb?: number;
  readonly autoSaveOnDormant?: boolean;
  readonly dormantAfterMinutes?: number;
}

export interface RuntimeContainerProxySettings {
  readonly enabled?: boolean;
  readonly port?: number;
}

export interface RuntimeContainerSettings {
  readonly portRangeStart?: number;
  readonly portRangeEnd?: number;
  readonly proxy?: RuntimeContainerProxySettings;
}

export interface RuntimeChapterContainerSettingsResponse {
  readonly chapters?: RuntimeChapterSettings;
  readonly containers?: RuntimeContainerSettings;
}

export interface RuntimeChapterContainerSettingsPatch {
  readonly chapters: Required<RuntimeChapterSettings>;
  readonly containers: {
    readonly portRangeStart: number;
    readonly portRangeEnd: number;
    readonly proxy: {
      readonly enabled: boolean;
      readonly port: number;
    };
  };
}

export function createChapterContainerSettingsClient(
  options: RuntimeAdminClientOptions = {},
) {
  const request = createRuntimeAdminRequest(options);
  return {
    get: () => request<RuntimeChapterContainerSettingsResponse>("/api/settings"),
    patch: (patch: RuntimeChapterContainerSettingsPatch) =>
      request<RuntimeChapterContainerSettingsResponse>(
        "/api/settings",
        jsonRequest("PATCH", patch),
      ),
  } as const;
}
