import {
  createRuntimeAdminRequest,
  type RuntimeAdminClientOptions,
} from "./client";

/**
 * Platform facts the Runtime derives at startup. Verified against a live
 * `/api/health` response: this is a structured object, not a string.
 */
export interface RuntimeEnvironmentInfo {
  readonly android: boolean;
  readonly proot: boolean;
  readonly termux: boolean;
  readonly containerSupport: boolean;
  readonly containerUnsupportedReason?: string;
}

/**
 * Build identity reported by the Runtime's `/api/health` endpoint.
 *
 * This is the only place a user can read which Runtime binary is actually
 * serving the product, so it is the primary evidence when diagnosing a report
 * against a specific release. `readiness` is added by the Runtime entrypoint and
 * degrades while startup continuation recovery is still running.
 */
export interface RuntimeHealth {
  readonly status: string;
  readonly version?: string;
  readonly commit?: string;
  readonly platform?: string;
  readonly gitAvailable?: boolean;
  readonly readiness?: string;
  readonly runtimeEnvironment?: RuntimeEnvironmentInfo;
}

/** Condense the platform facts into one line of product copy. */
export function describeRuntimeEnvironment(
  environment: RuntimeEnvironmentInfo | undefined,
): string {
  if (!environment) return "未知";
  const traits: string[] = [];
  if (environment.termux) traits.push("Termux");
  if (environment.proot) traits.push("proot");
  if (environment.android) traits.push("Android");
  const base = traits.length > 0 ? traits.join(" / ") : "标准桌面环境";
  return environment.containerSupport ? `${base} · 容器可用` : `${base} · 容器不可用`;
}

/**
 * A healthy Runtime reports `status: "ok"` and, once startup continuation
 * recovery finished, `readiness: "ready"`. Verified against a live response:
 * treating anything but `"ok"` as degraded would flag a healthy server.
 */
export function isRuntimeHealthy(health: RuntimeHealth | null): boolean {
  if (!health) return false;
  const readiness = health.readiness ?? health.status;
  return health.status === "ok" && (readiness === "ready" || readiness === "ok");
}

export interface RuntimeHealthClient {
  get(): Promise<RuntimeHealth>;
}

export function createRuntimeHealthClient(
  options?: RuntimeAdminClientOptions,
): RuntimeHealthClient {
  const request = createRuntimeAdminRequest(options);
  return {
    get: () => request<RuntimeHealth>("/api/health"),
  };
}
