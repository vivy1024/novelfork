import { fetchJson } from "../../hooks/use-api";

export interface RuntimeAdminClientOptions {
  readonly fetchImpl?: typeof fetch;
}

export type RuntimeAdminRequest = <T>(path: string, init?: RequestInit) => Promise<T>;

export function createRuntimeAdminRequest(
  options: RuntimeAdminClientOptions = {},
): RuntimeAdminRequest {
  const deps = options.fetchImpl ? { fetchImpl: options.fetchImpl } : undefined;
  return <T>(path: string, init: RequestInit = {}) => fetchJson<T>(path, init, deps);
}

export function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}

export function encodePath(value: string): string {
  return value.split("/").map(encodePathSegment).join("/");
}

export type QueryValue = string | number | boolean | null | undefined;

export function withQuery(
  path: string,
  values: Readonly<Record<string, QueryValue>>,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null) {
      params.set(key, String(value));
    }
  }
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

export function jsonRequest(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

export interface OkResponse {
  readonly ok: boolean;
}
