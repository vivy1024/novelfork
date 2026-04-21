import { useState, useEffect, useCallback } from "react";
import { isTauriBridgeActive, tauriFetch } from "./tauri-api-bridge";

const BASE = "/api";
const API_INVALIDATE_EVENT = "novelfork:api-invalidate";

interface ApiInvalidateDetail {
  readonly paths: ReadonlyArray<string>;
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

  const bookAction = normalized.match(/^\/api\/books\/([^/]+)\/(write-next|draft)$/);
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

export function invalidateApiPaths(paths: ReadonlyArray<string>): void {
  if (!paths.length || typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new CustomEvent<ApiInvalidateDetail>(API_INVALIDATE_EVENT, {
    detail: { paths: [...new Set(paths)] },
  }));
}

async function readErrorMessage(res: Response): Promise<string> {
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      const json = await res.json() as { error?: unknown };
      if (typeof json.error === "string" && json.error.trim()) {
        return json.error;
      }
      if (
        json.error &&
        typeof json.error === "object" &&
        "message" in json.error &&
        typeof (json.error as { message?: unknown }).message === "string" &&
        (json.error as { message: string }).message.trim()
      ) {
        return (json.error as { message: string }).message;
      }
    } catch {
      // fall through
    }
  }
  return `${res.status} ${res.statusText}`.trim();
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

  // Tauri mode: route through local bridge instead of HTTP
  if (isTauriBridgeActive()) {
    return tauriFetch<T>(url, init);
  }

  const fetchImpl = deps?.fetchImpl ?? fetch;
  const res = await fetchImpl(url, init);

  if (!res.ok) {
    throw new Error(await readErrorMessage(res));
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

export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(path !== null);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (path === null) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }
    const url = buildApiUrl(path);
    if (!url) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const json = await fetchJson<T>(url);
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  useEffect(() => {
    if (path === null || typeof window === "undefined") return;
    const url = buildApiUrl(path);
    if (!url) {
      return;
    }

    const handleInvalidate = (event: Event) => {
      const detail = (event as CustomEvent<ApiInvalidateDetail>).detail;
      if (!detail?.paths.includes(url)) return;
      void refetch();
    };

    window.addEventListener(API_INVALIDATE_EVENT, handleInvalidate);
    return () => {
      window.removeEventListener(API_INVALIDATE_EVENT, handleInvalidate);
    };
  }, [path, refetch]);

  return { data, loading, error, refetch };
}

export async function postApi<T>(path: string, body?: unknown): Promise<T> {
  const result = await fetchJson<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  invalidateApiPaths(deriveInvalidationPaths(path));
  return result;
}

export async function putApi<T>(path: string, body?: unknown): Promise<T> {
  const result = await fetchJson<T>(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  invalidateApiPaths(deriveInvalidationPaths(path));
  return result;
}
