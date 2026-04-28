export type RuntimeCapabilityStatus = "planned" | "unavailable" | "disabled" | "not-configured";

export type UnsupportedCapabilityHttpStatus = 501 | 422;

export interface UnsupportedCapabilityResponse {
  error: "Capability unsupported";
  code: "unsupported";
  capability: string;
  status: RuntimeCapabilityStatus;
  reason?: string;
}

const VALID_RUNTIME_CAPABILITY_STATUSES: readonly RuntimeCapabilityStatus[] = [
  "planned",
  "unavailable",
  "disabled",
  "not-configured",
];

export function isRuntimeCapabilityStatus(value: string): value is RuntimeCapabilityStatus {
  return VALID_RUNTIME_CAPABILITY_STATUSES.includes(value as RuntimeCapabilityStatus);
}

export function normalizeRuntimeCapabilityStatus(value: string | null | undefined): RuntimeCapabilityStatus {
  if (value && isRuntimeCapabilityStatus(value)) {
    return value;
  }
  return "planned";
}

export function isUnsupportedCapabilityHttpStatus(status: number): status is UnsupportedCapabilityHttpStatus {
  return status === 501 || status === 422;
}

export function normalizeUnsupportedCapabilityHttpStatus(value: string | number | null | undefined): UnsupportedCapabilityHttpStatus {
  const numericStatus = typeof value === "number" ? value : Number(value);
  return isUnsupportedCapabilityHttpStatus(numericStatus) ? numericStatus : 501;
}

export function buildUnsupportedCapabilityResponse(
  capability: string,
  options: {
    readonly status?: RuntimeCapabilityStatus;
    readonly reason?: string;
  } = {},
): UnsupportedCapabilityResponse {
  return {
    error: "Capability unsupported",
    code: "unsupported",
    capability,
    status: options.status ?? "planned",
    ...(options.reason ? { reason: options.reason } : {}),
  };
}
