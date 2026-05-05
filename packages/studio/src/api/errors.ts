/**
 * Structured API error handling.
 * Ported from PR #96 (Te9ui1a) — typed error codes for consistent JSON responses.
 */

type ApiErrorHttpStatus = 400 | 401 | 403 | 404 | 409 | 422 | 500 | 501 | 502 | 503;

export type ProviderFailureCode = "unsupported" | "auth-missing" | "config-missing" | "upstream-error" | "network-error" | (string & {});

export interface ProviderFailureLike {
  readonly success: false;
  readonly code: ProviderFailureCode;
  readonly error: string;
  readonly capability?: string;
}

export interface ProviderFailureEnvelope {
  readonly success: false;
  readonly code: ProviderFailureCode;
  readonly error: string;
  readonly capability?: string;
}

export interface StructuredErrorEnvelopeOptions {
  readonly code: string;
  readonly message: string;
  readonly capability?: string;
  readonly gate?: unknown;
  readonly mirrorCode?: boolean;
}

export type StructuredErrorEnvelope = {
  readonly error: {
    readonly code: string;
    readonly message: string;
  };
  readonly code?: string;
  readonly capability?: string;
  readonly gate?: unknown;
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export function buildStructuredErrorEnvelope(options: StructuredErrorEnvelopeOptions): StructuredErrorEnvelope {
  return {
    error: {
      code: options.code,
      message: options.message,
    },
    ...(options.mirrorCode ? { code: options.code } : {}),
    ...(options.capability ? { capability: options.capability } : {}),
    ...(options.gate !== undefined ? { gate: options.gate } : {}),
  };
}

export function buildApiErrorResponse(error: ApiError): { readonly status: ApiErrorHttpStatus; readonly body: StructuredErrorEnvelope } {
  return {
    status: error.status as ApiErrorHttpStatus,
    body: buildStructuredErrorEnvelope({ code: error.code, message: error.message }),
  };
}

export function getProviderFailureHttpStatus(failure: ProviderFailureLike): 400 | 422 | 500 | 501 | 502 {
  switch (failure.code) {
    case "unsupported":
      return 501;
    case "auth-missing":
    case "config-missing":
      return 422;
    case "upstream-error":
    case "network-error":
      return 502;
    default:
      return 500;
  }
}

export function buildProviderFailureEnvelope(failure: ProviderFailureLike): ProviderFailureEnvelope {
  return {
    success: false,
    code: failure.code,
    error: failure.error,
    ...(failure.capability ? { capability: failure.capability } : {}),
  };
}

export function buildUnsupportedCapabilityFailure(capability: string): ProviderFailureEnvelope {
  return buildProviderFailureEnvelope({
    success: false,
    code: "unsupported",
    capability,
    error: `Capability unsupported: ${capability}`,
  });
}

export function isMissingFileError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}
