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
