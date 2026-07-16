import {
	appendApiQuery,
	buildNarratorsApiPath,
	SEARCH_API_PATH,
} from "../backend-contract/api-paths";
import { runtimeJson } from "../runtime/auth";

export type SearchResultType = "all" | "chapter" | "narrator" | "message";
export type SearchSort = "relevance" | "time" | "type" | "title";

export interface RuntimeSearchFallback {
	readonly feature?: string;
	readonly entity?: string;
	readonly from?: string;
	readonly to?: string;
	readonly reason?: string;
	readonly error?: string;
	readonly message?: string;
	readonly code?: string;
}

export interface RuntimeSearchMetadata {
	readonly degraded?: boolean;
	readonly fallbacks?: RuntimeSearchFallback[];
	readonly mode?: string;
	readonly shortQuery?: boolean;
	readonly requestedEntities?: string[];
}

export interface RuntimeSearchResult {
	readonly id: string;
	readonly type?: string;
	readonly title?: string | null;
	readonly narratorTitle?: string | null;
	readonly chapterTitle?: string | null;
	readonly snippet?: string | null;
	readonly content?: string | null;
	readonly summary?: string | null;
	readonly matchScore?: number | null;
	readonly matchField?: string | null;
	readonly messageRole?: string | null;
	readonly status?: string | null;
	readonly projectTitle?: string | null;
	readonly projectName?: string | null;
	readonly narratorId?: string | null;
	readonly chapterId?: string | null;
	readonly createdAt?: string | number | null;
	readonly updatedAt?: string | number | null;
	readonly timestamp?: string | number | null;
	readonly lastMessageAt?: string | number | null;
	readonly [key: string]: unknown;
}

export interface RuntimeSearchResponse {
	readonly results: RuntimeSearchResult[];
	readonly degraded?: boolean;
	readonly fallbacks?: RuntimeSearchFallback[];
	readonly searchMetadata?: RuntimeSearchMetadata;
}

export interface SearchRuntimeStatus {
	readonly degraded: boolean;
	readonly mode?: string;
	readonly fallbackMessages: string[];
}

type RuntimeJson = <T>(path: string, init?: RequestInit) => Promise<T>;

export function normalizeSearchType(value: unknown): SearchResultType {
	switch (value) {
		case "chapter":
		case "chapters":
			return "chapter";
		case "narrator":
		case "narrators":
			return "narrator";
		case "message":
		case "messages":
			return "message";
		default:
			return "all";
	}
}

export function normalizeSearchSort(value: unknown): SearchSort {
	if (value === "date") return "time";
	return value === "time" || value === "type" || value === "title"
		? value
		: "relevance";
}

export function normalizeResultType(
	value: unknown,
): Exclude<SearchResultType, "all"> | "unknown" {
	return normalizeSearchType(value) === "all"
		? "unknown"
		: (normalizeSearchType(value) as Exclude<SearchResultType, "all">);
}

export function getSearchResultDisplayTitle(
	result: RuntimeSearchResult,
): string {
	return (
		result.title ||
		result.narratorTitle ||
		result.chapterTitle ||
		`未命名 ${String(result.id ?? "").slice(0, 8)}`
	);
}

function resultTimestamp(result: RuntimeSearchResult): number {
	const raw =
		result.updatedAt ??
		result.createdAt ??
		result.lastMessageAt ??
		result.timestamp;
	if (typeof raw === "number") return raw;
	const parsed = typeof raw === "string" ? Date.parse(raw) : Number.NaN;
	return Number.isFinite(parsed) ? parsed : 0;
}

export function filterAndSortSearchResults(
	results: RuntimeSearchResult[],
	type: SearchResultType,
	sort: SearchSort,
): RuntimeSearchResult[] {
	const filtered =
		type === "all"
			? [...results]
			: results.filter((result) => normalizeResultType(result.type) === type);
	return filtered.sort((a, b) => {
		if (sort === "time") return resultTimestamp(b) - resultTimestamp(a);
		if (sort === "type")
			return String(a.type ?? "").localeCompare(String(b.type ?? ""));
		if (sort === "title")
			return getSearchResultDisplayTitle(a).localeCompare(
				getSearchResultDisplayTitle(b),
				"zh-CN",
			);
		return Number(b.matchScore ?? 0) - Number(a.matchScore ?? 0);
	});
}

export function countSearchResultTypes(
	results: RuntimeSearchResult[],
): Record<SearchResultType, number> {
	const counts: Record<SearchResultType, number> = {
		all: results.length,
		chapter: 0,
		narrator: 0,
		message: 0,
	};
	for (const result of results) {
		const type = normalizeResultType(result.type);
		if (type !== "unknown") counts[type] += 1;
	}
	return counts;
}

export function compactSnippet(
	text: string,
	query: string,
	radius = 96,
): string {
	const clean = text.replace(/\s+/g, " ").trim();
	const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
	if (!normalizedQuery) return clean.slice(0, radius * 2);
	const index = clean.toLocaleLowerCase("zh-CN").indexOf(normalizedQuery);
	if (index < 0) return clean.slice(0, radius * 2);
	const start = Math.max(0, index - radius);
	const end = Math.min(clean.length, index + normalizedQuery.length + radius);
	return `${start > 0 ? "…" : ""}${clean.slice(start, end)}${end < clean.length ? "…" : ""}`;
}

export function summarizeSearchRuntimeState(
	response?: RuntimeSearchResponse,
): SearchRuntimeStatus {
	const fallbacks = [
		...(response?.searchMetadata?.fallbacks ?? []),
		...(response?.fallbacks ?? []),
	];
	const seen = new Set<string>();
	const fallbackMessages = fallbacks
		.map((fallback) => {
			const scope = String(fallback.entity ?? fallback.feature ?? "search");
			const detail = String(
				fallback.reason ??
					fallback.message ??
					fallback.error ??
					fallback.code ??
					"fallback",
			);
			const route =
				fallback.from && fallback.to
					? ` (${fallback.from} → ${fallback.to})`
					: "";
			return `${scope}: ${detail}${route}`;
		})
		.filter((message) => {
			if (seen.has(message)) return false;
			seen.add(message);
			return true;
		});
	return {
		degraded:
			response?.degraded === true ||
			response?.searchMetadata?.degraded === true ||
			fallbackMessages.length > 0,
		mode: response?.searchMetadata?.mode,
		fallbackMessages,
	};
}

export function buildSearchResultHref(
	result: RuntimeSearchResult,
): string | null {
	const type = normalizeResultType(result.type);
	if (type === "message") {
		const hash = `#msg-${encodeURIComponent(result.id)}`;
		if (result.narratorId)
			return `/narrators/${encodeURIComponent(result.narratorId)}${hash}`;
		if (result.chapterId)
			return `/chapters/${encodeURIComponent(result.chapterId)}${hash}`;
		return null;
	}
	if (type === "narrator") {
		return result.chapterId
			? `/chapters/${encodeURIComponent(result.chapterId)}`
			: `/narrators/${encodeURIComponent(result.id)}`;
	}
	if (type === "chapter") return `/chapters/${encodeURIComponent(result.id)}`;
	return null;
}

export async function resolvePrimaryNarratorForChapter(
	chapterId: string,
	json: RuntimeJson = runtimeJson,
): Promise<string | null> {
	const page = await json<{ items?: Array<{ id?: string; variant?: string }> }>(
		appendApiQuery(
			buildNarratorsApiPath(),
			new URLSearchParams({
				chapterId,
				limit: "100",
			}),
		),
	);
	return (
		page.items?.find(
			(narrator) => narrator.variant === "primary" && narrator.id,
		)?.id ?? null
	);
}

export function createRuntimeSearchClient(json: RuntimeJson = runtimeJson) {
	return {
		search(
			query: string,
			entities = "chapters,messages,narrators",
		): Promise<RuntimeSearchResponse> {
			const params = new URLSearchParams({ q: query, entities });
			return json<RuntimeSearchResponse>(
				appendApiQuery(SEARCH_API_PATH, params),
			);
		},
	};
}
