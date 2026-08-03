import {
  createRuntimeAdminRequest,
  type RuntimeAdminClientOptions,
} from "./client";

// ── Types ────────────────────────────────────────────────────────────────────

export interface DependencyInfo {
  readonly name: string;
  readonly required: boolean;
  readonly installed: boolean;
  readonly version?: string;
  readonly platformSupported: boolean;
  readonly installCommands: Readonly<Record<string, string>>;
}

export interface DependencyCheckResult {
  readonly platform: "windows" | "macos" | "linux";
  readonly packageManager?: string;
  readonly runtimeEnvironment: string;
  readonly dependencies: readonly DependencyInfo[];
  readonly allRequiredMet: boolean;
}

// ── Client ───────────────────────────────────────────────────────────────────

export interface DependenciesClient {
  checkAll(): Promise<DependencyCheckResult>;
}

export function createDependenciesClient(
  options?: RuntimeAdminClientOptions,
): DependenciesClient {
  const request = createRuntimeAdminRequest(options);
  return {
    checkAll: () => request<DependencyCheckResult>("/api/dependencies"),
  };
}
