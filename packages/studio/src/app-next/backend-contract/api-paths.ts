export const USER_SETTINGS_API_PATH = "/api/settings/user";
export const PROXY_API_PATH = "/api/proxy";
export const PROVIDERS_API_PATH = "/api/providers";
export const PROVIDER_STATUS_API_PATH = "/api/providers/status";
export const PROVIDER_MODELS_API_PATH = "/api/providers/models";
export const PROVIDER_SUMMARY_API_PATH = "/api/providers/summary";
export const BOOKS_API_PATH = "/api/books";
export const BOOK_CREATE_API_PATH = "/api/books/create";
export const SESSIONS_API_PATH = "/api/sessions";
export const NARRATORS_API_PATH = "/api/narrators";
export const SEARCH_API_PATH = "/api/search";
export const WORKTREE_API_PATH = "/api/worktree";
export const MARKET_SCAN_API_PATH = "/api/market/scan";
export const MARKET_SCAN_PREFS_API_PATH = "/api/market/scan-prefs";
export const MARKET_RANKS_PROBE_API_PATH = "/api/market/ranks/probe";
export const MARKET_RANKS_CUSTOM_API_PATH = "/api/market/ranks/custom";
export const MARKET_LEXICON_API_PATH = "/api/market/lexicon";
export const MARKET_SAMPLE_PUBLIC_CHAPTERS_API_PATH = "/api/market/sample-public-chapters";

export type ApiPathSegment = string | number;

/** 自定义榜单按 key 删除。key 来自用户输入，交给 joinApiPath 统一转义。 */
export function buildMarketCustomRankApiPath(key: string): string {
	return joinApiPath(MARKET_RANKS_CUSTOM_API_PATH, [key]);
}

export function buildBookApiPath(
	bookId: string,
	...segments: readonly ApiPathSegment[]
): string {
	return joinApiPath(BOOKS_API_PATH, [bookId, ...segments]);
}

export function buildProviderModelTestApiPath(
	providerId: string,
	modelId: string,
): string {
	return joinApiPath(PROVIDERS_API_PATH, [
		providerId,
		"models",
		modelId,
		"test",
	]);
}

export function buildSessionApiPath(
	sessionId: string,
	...segments: readonly ApiPathSegment[]
): string {
	return joinApiPath(SESSIONS_API_PATH, [sessionId, ...segments]);
}

export function buildSessionsApiPath(
	...segments: readonly ApiPathSegment[]
): string {
	return joinApiPath(SESSIONS_API_PATH, segments);
}

export function buildNarratorsApiPath(
	...segments: readonly ApiPathSegment[]
): string {
	return joinApiPath(NARRATORS_API_PATH, segments);
}

export function buildWorktreeStatusApiPath(worktreePath: string): string {
	return appendApiQuery(
		joinApiPath(WORKTREE_API_PATH, ["status"]),
		`path=${encodeURIComponent(worktreePath)}`,
	);
}

export function appendApiQuery(
	path: string,
	query: string | URLSearchParams,
): string {
	const queryString = typeof query === "string" ? query : query.toString();
	return queryString ? `${path}?${queryString}` : path;
}

function joinApiPath(
	basePath: string,
	segments: readonly ApiPathSegment[],
): string {
	if (segments.length === 0) return basePath;
	const normalizedBase = normalizeApiPath(basePath);
	const encodedSegments = segments
		.map((segment) => encodeURIComponent(String(segment)))
		.filter(Boolean);
	return [normalizedBase, ...encodedSegments].join("/");
}

function normalizeApiPath(path: string): string {
	const normalized = path.replace(/\/+$/, "");
	return normalized.length === 0 ? path : normalized;
}
