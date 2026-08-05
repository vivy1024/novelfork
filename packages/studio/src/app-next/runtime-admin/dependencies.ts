import {
  createRuntimeAdminRequest,
  encodePathSegment,
  jsonRequest,
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

/**
 * Result of an install attempt. The Runtime replies 500 with the same shape when
 * the package manager command fails, so `error` carries the real diagnostic
 * (truncated stderr/stdout) rather than a generic message.
 */
export interface DependencyInstallResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly dependency?: DependencyInfo;
}

/** Dependencies the Runtime accepts for automated installation. */
export const INSTALLABLE_DEPENDENCIES = ["git", "rg", "dtach"] as const;

export type InstallableDependency = (typeof INSTALLABLE_DEPENDENCIES)[number];

export function isInstallableDependency(name: string): name is InstallableDependency {
  return (INSTALLABLE_DEPENDENCIES as readonly string[]).includes(name);
}

// ── Client ───────────────────────────────────────────────────────────────────

export interface DependenciesClient {
  checkAll(): Promise<DependencyCheckResult>;
  install(name: string): Promise<DependencyInstallResult>;
}

export function createDependenciesClient(
  options?: RuntimeAdminClientOptions,
): DependenciesClient {
  const request = createRuntimeAdminRequest(options);
  return {
    checkAll: () => request<DependencyCheckResult>("/api/dependencies"),
    install: (name: string) =>
      request<DependencyInstallResult>(
        `/api/dependencies/${encodePathSegment(name)}/install`,
        jsonRequest("POST", {}),
      ),
  };
}
