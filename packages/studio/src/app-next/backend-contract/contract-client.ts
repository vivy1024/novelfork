import { normalizeCapability, type BackendCapability, type CapabilityStatus } from "./capability-status";

export interface ContractClientOptions {
  fetch?: typeof fetch;
  baseUrl?: string;
}

export interface ContractRequestOptions {
  capability?: { id?: string; status?: CapabilityStatus };
  headers?: HeadersInit;
  signal?: AbortSignal;
}

export type ContractResult<T = unknown> =
  | {
      ok: true;
      data: T;
      raw: T;
      httpStatus: number;
      capability: BackendCapability;
    }
  | {
      ok: false;
      error?: unknown;
      raw?: unknown;
      rawText?: string;
      code?: string;
      cause?: unknown;
      httpStatus: number | null;
      capability: BackendCapability;
    };

export interface ContractClient {
  request<T = unknown>(method: string, path: string, body?: unknown, options?: ContractRequestOptions): Promise<ContractResult<T>>;
  get<T = unknown>(path: string, options?: ContractRequestOptions): Promise<ContractResult<T>>;
  post<T = unknown>(path: string, body?: unknown, options?: ContractRequestOptions): Promise<ContractResult<T>>;
  put<T = unknown>(path: string, body?: unknown, options?: ContractRequestOptions): Promise<ContractResult<T>>;
  patch<T = unknown>(path: string, body?: unknown, options?: ContractRequestOptions): Promise<ContractResult<T>>;
  delete<T = unknown>(path: string, options?: ContractRequestOptions): Promise<ContractResult<T>>;
}

function extractCode(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const record = payload as Record<string, unknown>;
  if (typeof record.code === "string") return record.code;
  const error = record.error;
  if (error && typeof error === "object" && typeof (error as Record<string, unknown>).code === "string") {
    return (error as Record<string, string>).code;
  }
  return typeof error === "string" ? error : undefined;
}

function splitBodyAndOptions(body: unknown, options?: ContractRequestOptions): { body: unknown; options?: ContractRequestOptions } {
  if (options === undefined && body && typeof body === "object" && "capability" in (body as Record<string, unknown>)) {
    return { body: undefined, options: body as ContractRequestOptions };
  }
  return { body, options };
}

export function createContractClient(options: ContractClientOptions = {}): ContractClient {
  const fetchImpl = options.fetch ?? fetch;
  const baseUrl = options.baseUrl ?? "";

  async function request<T = unknown>(method: string, path: string, rawBody?: unknown, rawOptions?: ContractRequestOptions): Promise<ContractResult<T>> {
    const { body, options: requestOptions } = splitBodyAndOptions(rawBody, rawOptions);
    const capability = normalizeCapability(requestOptions?.capability);
    const headers = new Headers(requestOptions?.headers);
    const init: RequestInit = { method, headers, signal: requestOptions?.signal };

    if (body !== undefined) {
      if (!headers.has("content-type")) headers.set("content-type", "application/json");
      init.body = typeof body === "string" ? body : JSON.stringify(body);
    }

    try {
      const response = await fetchImpl(`${baseUrl}${path}`, init);
      const rawText = await response.text();
      let payload: unknown = null;

      if (rawText.length > 0) {
        try {
          payload = JSON.parse(rawText);
        } catch {
          return {
            ok: false,
            code: "invalid-json",
            rawText,
            httpStatus: response.status,
            capability,
          };
        }
      }

      if (response.ok) {
        return {
          ok: true,
          data: payload as T,
          raw: payload as T,
          httpStatus: response.status,
          capability,
        };
      }

      return {
        ok: false,
        error: payload,
        raw: payload,
        code: extractCode(payload),
        httpStatus: response.status,
        capability,
      };
    } catch (cause) {
      return {
        ok: false,
        code: "network-error",
        cause,
        httpStatus: null,
        capability,
      };
    }
  }

  return {
    request,
    get: <T>(path: string, options?: ContractRequestOptions) => request<T>("GET", path, undefined, options),
    post: <T>(path: string, body?: unknown, options?: ContractRequestOptions) => request<T>("POST", path, body, options),
    put: <T>(path: string, body?: unknown, options?: ContractRequestOptions) => request<T>("PUT", path, body, options),
    patch: <T>(path: string, body?: unknown, options?: ContractRequestOptions) => request<T>("PATCH", path, body, options),
    delete: <T>(path: string, options?: ContractRequestOptions) => request<T>("DELETE", path, undefined, options),
  };
}
