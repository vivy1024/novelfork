export const USER_SETTINGS_API_PATH = "/api/settings/user";
export const PROXY_API_PATH = "/api/proxy";
export const PROVIDERS_API_PATH = "/api/providers";
export const PROVIDER_STATUS_API_PATH = "/api/providers/status";
export const PROVIDER_MODELS_API_PATH = "/api/providers/models";
export const PROVIDER_SUMMARY_API_PATH = "/api/providers/summary";
export const BOOKS_API_PATH = "/api/books";
export const BOOK_CREATE_API_PATH = "/api/books/create";
export const SESSIONS_API_PATH = "/api/sessions";
export const WORKTREE_API_PATH = "/api/worktree";

export type ApiPathSegment = string | number;

export function buildBookApiPath(bookId: string, ...segments: readonly ApiPathSegment[]): string {
  return joinApiPath(BOOKS_API_PATH, [bookId, ...segments]);
}

export function buildProviderModelTestApiPath(providerId: string, modelId: string): string {
  return joinApiPath(PROVIDERS_API_PATH, [providerId, "models", modelId, "test"]);
}

export function buildSessionApiPath(sessionId: string, ...segments: readonly ApiPathSegment[]): string {
  return joinApiPath(SESSIONS_API_PATH, [sessionId, ...segments]);
}

export function buildSessionsApiPath(...segments: readonly ApiPathSegment[]): string {
  return joinApiPath(SESSIONS_API_PATH, segments);
}

export function buildWorktreeStatusApiPath(worktreePath: string): string {
  return appendApiQuery(joinApiPath(WORKTREE_API_PATH, ["status"]), `path=${encodeURIComponent(worktreePath)}`);
}

export function appendApiQuery(path: string, query: string | URLSearchParams): string {
  const queryString = typeof query === "string" ? query : query.toString();
  return queryString ? `${path}?${queryString}` : path;
}

function joinApiPath(basePath: string, segments: readonly ApiPathSegment[]): string {
  if (segments.length === 0) return basePath;
  const normalizedBase = normalizeApiPath(basePath);
  const encodedSegments = segments.map((segment) => encodeURIComponent(String(segment))).filter(Boolean);
  return [normalizedBase, ...encodedSegments].join("/");
}

function normalizeApiPath(path: string): string {
  const normalized = path.replace(/\/+$/, "");
  return normalized.length === 0 ? path : normalized;
}
