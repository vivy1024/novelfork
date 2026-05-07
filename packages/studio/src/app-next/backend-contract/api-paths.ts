export const USER_SETTINGS_API_PATH = "/api/settings/user";
export const PROXY_API_PATH = "/api/proxy";
export const PROVIDER_STATUS_API_PATH = "/api/providers/status";
export const PROVIDER_MODELS_API_PATH = "/api/providers/models";
export const PROVIDER_SUMMARY_API_PATH = "/api/providers/summary";
export const BOOK_CREATE_API_PATH = "/api/books/create";

export function buildWorktreeStatusApiPath(worktreePath: string): string {
  return `/api/worktree/status?path=${encodeURIComponent(worktreePath)}`;
}
