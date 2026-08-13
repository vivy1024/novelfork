import { clearRuntimeAuthentication, getRuntimeToken } from "@/app-next/runtime/auth";

const BASE = "/api";

export class ApiRequestError extends Error {
  readonly code?: string;
  readonly status?: number;

  constructor(message: string, options?: { code?: string; status?: number }) {
    super(message);
    this.name = "ApiRequestError";
    this.code = options?.code;
    this.status = options?.status;
  }
}

export function buildApiUrl(path: string): string | null {
  const normalized = String(path ?? "").trim();
  if (!normalized) return null;
  if (normalized.startsWith(`${BASE}/`) || normalized === BASE) {
    return normalized;
  }
  return normalized.startsWith("/") ? `${BASE}${normalized}` : `${BASE}/${normalized}`;
}

export function deriveInvalidationPaths(path: string): ReadonlyArray<string> {
  const normalized = buildApiUrl(path);
  if (!normalized) return [];

  if (normalized === "/api/books/create") {
    return ["/api/books"];
  }

  if (normalized === "/api/project") {
    return ["/api/project"];
  }

  if (normalized.startsWith("/api/project/")) {
    return ["/api/project", normalized];
  }

  const bookAction = normalized.match(/^\/api\/books\/([^/]+)\/write-next$/);
  if (bookAction) {
    return ["/api/books", `/api/books/${bookAction[1]}`];
  }

  const chapterAction = normalized.match(/^\/api\/books\/([^/]+)\/chapters\/\d+\/(approve|reject)$/);
  if (chapterAction) {
    return ["/api/books", `/api/books/${chapterAction[1]}`];
  }

  if (/^\/api\/daemon\/(start|stop)$/.test(normalized)) {
    return ["/api/daemon"];
  }

  return [];
}

async function readErrorDetails(res: Response): Promise<{ message: string; code?: string }> {
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      // 优先用 explanation（发生了什么/建议怎么做），不要只丢短 error 标题。
      // 否则「套路不存在」会覆盖 fork 失败、冷启动超时、格式非法等多种情况。
      const json = await res.json() as {
        error?: unknown;
        explanation?: unknown;
        code?: unknown;
      };
      const explanation =
        typeof json.explanation === "string" && json.explanation.trim()
          ? json.explanation.trim()
          : null;
      if (typeof json.error === "string" && json.error.trim()) {
        return {
          message: explanation ? `${json.error.trim()}：${explanation}` : json.error.trim(),
          code: typeof json.code === "string" && json.code.trim() ? json.code : undefined,
        };
      }
      if (json.error && typeof json.error === "object") {
        const structured = json.error as { code?: unknown; message?: unknown };
        if (typeof structured.message === "string" && structured.message.trim()) {
          return {
            message: explanation
              ? `${structured.message.trim()}：${explanation}`
              : structured.message.trim(),
            code: typeof structured.code === "string" && structured.code.trim()
              ? structured.code
              : undefined,
          };
        }
      }
      if (explanation) return { message: explanation };
    } catch {
      // fall through
    }
  }
  return { message: `${res.status} ${res.statusText}`.trim() };
}

export async function fetchJson<T>(
  path: string,
  init: RequestInit = {},
  deps?: { readonly fetchImpl?: typeof fetch },
): Promise<T> {
  const url = buildApiUrl(path);
  if (!url) {
    throw new Error("API path is required");
  }

  const fetchImpl = deps?.fetchImpl ?? fetch;
  const headers = new Headers(init.headers);
  const token = getRuntimeToken();
  if (token && !headers.has("authorization")) {
    headers.set("authorization", `Bearer ${token}`);
  }

  const res = await fetchImpl(url, { ...init, headers });

  if (res.status === 401) {
    clearRuntimeAuthentication("unauthorized");
  }

  if (!res.ok) {
    const error = await readErrorDetails(res);
    throw new ApiRequestError(error.message, { code: error.code, status: res.status });
  }

  if (res.status === 204) {
    return undefined as T;
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    const text = await res.text();
    if (!text.trim()) {
      return undefined as T;
    }
    return JSON.parse(text) as T;
  }

  return await res.json() as T;
}

/** react-query 缓存键：`["api", "/api/..."]`。前缀 ["api"] 可整树失效。 */
export function apiQueryKey(url: string): readonly ["api", string] {
  return ["api", url] as const;
}
