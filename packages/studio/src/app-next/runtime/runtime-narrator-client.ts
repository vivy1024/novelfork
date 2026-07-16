import { runtimeJson } from "./auth";
import {
	createRuntimeProductClient,
	type RuntimeEntityCapabilities,
	type RuntimeNarratorSummary,
} from "./product-contract";

export type RuntimeNarratorStatus = "idle" | "working" | "waiting" | "archived";
export type RuntimePermissionMode =
	| "default"
	| "acceptEdits"
	| "bypassPermissions"
	| "readOnly"
	| "dontAsk";
export type RuntimeReasoningEffort =
	| "none"
	| "low"
	| "medium"
	| "high"
	| "xhigh"
	| "max"
	| null;
export type RuntimeForkInheritMode = "full" | "compressed" | "fresh";

export interface RuntimeRecentTab {
	readonly type:
		| "chapter"
		| "narrator"
		| "project"
		| "workspace"
		| "subagent"
		| "group";
	readonly id: string;
	readonly narratorId?: string;
	readonly parentNarratorId?: string;
	readonly workspaceId?: string | null;
	readonly title: string;
	readonly subtitle?: string;
	readonly status?: string;
	readonly substatus?: readonly string[];
	readonly lastVisitedAt: number;
	readonly pinned?: boolean;
}

export type RuntimeRecentTabMoveTarget =
	| { readonly toIndex: number }
	| { readonly position: "top" | "above_idle" };

export type RuntimeNarratorBinding =
	| { readonly kind: "standalone" }
	| {
			readonly kind: "novel.book";
			readonly bookId: string;
			readonly capabilities: RuntimeEntityCapabilities;
	  };

export interface RuntimeNarratorViewer {
	readonly userId: string;
	readonly username: string;
	readonly avatarColor: string | null;
	readonly avatarImageId: string | null;
}

export interface RuntimeNarratorRecord {
	readonly id: string;
	readonly chapterId: string | null;
	readonly type: string;
	readonly variant: string;
	readonly title: string;
	readonly model: string;
	readonly reasoningEffort: RuntimeReasoningEffort;
	readonly permissionMode: RuntimePermissionMode;
	readonly planMode: boolean;
	readonly cwd: string | null;
	readonly status: RuntimeNarratorStatus;
	readonly substatus: readonly string[];
	readonly traits: readonly string[];
	readonly messageCount: number;
	readonly activeTerminalCount: number;
	readonly containerCount: number;
	readonly runningContainerCount: number;
	readonly viewers: readonly RuntimeNarratorViewer[];
	readonly createdAt: string;
	readonly updatedAt: string;
	readonly lastMessageAt: string | null;
	readonly errorMessage: string | null;
	readonly pinned: boolean;
	readonly lastVisitedAt: number | null;
	readonly working: boolean;
	readonly unread: boolean;
	/** Server-owned product binding. Book-bound narrators are lifecycle protected. */
	readonly binding: RuntimeNarratorBinding;
}

export interface RuntimeNarratorListOptions {
	readonly status?: "active" | "archived";
	readonly scope?: "all" | "standalone" | "book";
	readonly search?: string;
	readonly sort?:
		| "recent"
		| "lastModified-desc"
		| "createdAt-desc"
		| "messageCount-desc"
		| "title";
	readonly activeNarratorId?: string;
}

export interface CreateRuntimeNarratorInput {
	readonly title: string;
	readonly model?: string;
	readonly reasoningEffort?: RuntimeReasoningEffort;
	readonly permissionMode?: RuntimePermissionMode;
	readonly startInPlanMode?: boolean;
	readonly cwd?: string;
}

export interface ForkRuntimeNarratorInput {
	readonly title?: string;
	readonly inheritMode?: RuntimeForkInheritMode;
}

interface PaginatedRuntimeNarrators {
	readonly items?: unknown[];
	readonly hasMore?: boolean;
	readonly nextCursor?: string | null;
	readonly totalCount?: number;
}

interface RuntimeUserPreferences {
	readonly recentTabs?: unknown[];
}

export interface RuntimeNarratorClient {
	readonly listNarrators: (
		options?: RuntimeNarratorListOptions,
	) => Promise<RuntimeNarratorRecord[]>;
	readonly getNarrator: (narratorId: string) => Promise<RuntimeNarratorRecord>;
	readonly getRecentTabs: () => Promise<RuntimeRecentTab[]>;
	readonly removeRecentTab: (
		tab: Pick<RuntimeRecentTab, "type" | "id">,
	) => Promise<void>;
	readonly moveRecentTab: (
		tab: Pick<RuntimeRecentTab, "type" | "id">,
		target: RuntimeRecentTabMoveTarget,
	) => Promise<void>;
	readonly setRecentTabPinned: (
		tab: Pick<RuntimeRecentTab, "type" | "id">,
		pinned: boolean,
	) => Promise<void>;
	readonly clearRecentTabs: (
		scope: "all" | "projects" | "inactive_narrators",
		keepTabKey?: string,
	) => Promise<void>;
	readonly createNarrator: (
		input: CreateRuntimeNarratorInput,
	) => Promise<RuntimeNarratorRecord>;
	readonly renameNarrator: (narratorId: string, title: string) => Promise<void>;
	readonly forkLatestNarrator: (
		narratorId: string,
		input: ForkRuntimeNarratorInput,
	) => Promise<RuntimeNarratorRecord>;
	readonly archiveNarrator: (narratorId: string) => Promise<void>;
	readonly unarchiveNarrator: (narratorId: string) => Promise<void>;
	readonly deleteNarrator: (narratorId: string) => Promise<void>;
	readonly openNarrator: (
		narrator: Pick<RuntimeNarratorRecord, "id" | "title" | "status">,
	) => Promise<void>;
	readonly setNarratorPinned: (
		narrator: Pick<RuntimeNarratorRecord, "id" | "title" | "status">,
		pinned: boolean,
	) => Promise<void>;
	readonly continueLatestNarrator: () => Promise<RuntimeNarratorRecord | null>;
}

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object"
		? (value as Record<string, unknown>)
		: {};
}

function asString(value: unknown, fallback = ""): string {
	return typeof value === "string" ? value : fallback;
}

function asNullableString(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}

function asStringArray(value: unknown): string[] {
	if (Array.isArray(value))
		return value.filter((item): item is string => typeof item === "string");
	if (typeof value === "string") {
		try {
			const parsed = JSON.parse(value);
			return Array.isArray(parsed)
				? parsed.filter((item): item is string => typeof item === "string")
				: [];
		} catch {
			return [];
		}
	}
	return [];
}

function parseViewers(value: unknown): RuntimeNarratorViewer[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((item) => {
		const record = asRecord(item);
		const userId = asString(record.userId);
		if (!userId) return [];
		return [
			{
				userId,
				username: asString(record.username, "未知用户"),
				avatarColor: asNullableString(record.avatarColor),
				avatarImageId: asNullableString(record.avatarImageId),
			} satisfies RuntimeNarratorViewer,
		];
	});
}

function normalizeStatus(value: unknown): RuntimeNarratorStatus {
	return value === "working" || value === "waiting" || value === "archived"
		? value
		: "idle";
}

function normalizePermissionMode(value: unknown): RuntimePermissionMode {
	return value === "acceptEdits" ||
		value === "bypassPermissions" ||
		value === "readOnly" ||
		value === "dontAsk"
		? value
		: "default";
}

function normalizeReasoningEffort(value: unknown): RuntimeReasoningEffort {
	return value === "none" ||
		value === "low" ||
		value === "medium" ||
		value === "high" ||
		value === "xhigh" ||
		value === "max"
		? value
		: null;
}

function parseRecentTab(value: unknown): RuntimeRecentTab | null {
	const record = asRecord(value);
	const type = record.type;
	const id = asString(record.id);
	if (
		!id ||
		(type !== "chapter" &&
			type !== "narrator" &&
			type !== "project" &&
			type !== "workspace" &&
			type !== "subagent" &&
			type !== "group")
	) {
		return null;
	}
	return {
		type,
		id,
		...(asString(record.narratorId)
			? { narratorId: asString(record.narratorId) }
			: {}),
		...(asString(record.parentNarratorId)
			? { parentNarratorId: asString(record.parentNarratorId) }
			: {}),
		...(record.workspaceId === null
			? { workspaceId: null }
			: asString(record.workspaceId)
				? { workspaceId: asString(record.workspaceId) }
				: {}),
		title: asString(record.title, "未命名叙述者"),
		...(asString(record.subtitle)
			? { subtitle: asString(record.subtitle) }
			: {}),
		...(asString(record.status) ? { status: asString(record.status) } : {}),
		...(asStringArray(record.substatus).length > 0
			? { substatus: asStringArray(record.substatus) }
			: {}),
		lastVisitedAt:
			typeof record.lastVisitedAt === "number" ? record.lastVisitedAt : 0,
		...(record.pinned === true ? { pinned: true } : {}),
	};
}

export function mapRuntimeNarrator(
	value: unknown,
	recentTab?: RuntimeRecentTab,
	activeNarratorId?: string,
	binding: RuntimeNarratorBinding = { kind: "standalone" },
): RuntimeNarratorRecord {
	const record = asRecord(value);
	const id = asString(record.id);
	if (!id) throw new Error("Runtime narrator response is missing id");
	const status = normalizeStatus(record.status);
	const updatedAt = asString(
		record.updatedAt,
		asString(record.createdAt, new Date(0).toISOString()),
	);
	const lastVisitedAt = recentTab?.lastVisitedAt ?? null;
	const updatedMs = Date.parse(updatedAt);
	const unread =
		activeNarratorId !== id &&
		lastVisitedAt !== null &&
		Number.isFinite(updatedMs) &&
		updatedMs > lastVisitedAt;

	return {
		id,
		chapterId: asNullableString(record.chapterId),
		type: asString(record.type, "primary"),
		variant: asString(record.variant, "primary"),
		title: asString(record.title, "未命名叙述者"),
		model: asString(record.model),
		reasoningEffort: normalizeReasoningEffort(record.reasoningEffort),
		permissionMode: normalizePermissionMode(record.permissionMode),
		planMode: record.planMode === true,
		cwd: asNullableString(record.cwd),
		status,
		substatus: asStringArray(record.substatus),
		traits: asStringArray(record.traits),
		messageCount:
			typeof record.messageCount === "number" ? record.messageCount : 0,
		activeTerminalCount:
			typeof record.activeTerminalCount === "number"
				? record.activeTerminalCount
				: 0,
		containerCount:
			typeof record.containerCount === "number" ? record.containerCount : 0,
		runningContainerCount:
			typeof record.runningContainerCount === "number"
				? record.runningContainerCount
				: 0,
		viewers: parseViewers(record.viewers),
		createdAt: asString(record.createdAt, updatedAt),
		updatedAt,
		lastMessageAt: asNullableString(record.lastMessageAt),
		errorMessage: asNullableString(record.errorMessage),
		pinned: recentTab?.pinned === true,
		lastVisitedAt,
		working: status === "working",
		unread,
		binding,
	};
}

function jsonRequest(method: string, body?: unknown): RequestInit {
	return {
		method,
		headers:
			body === undefined ? undefined : { "Content-Type": "application/json" },
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	};
}

function narratorQuery(
	options: RuntimeNarratorListOptions,
	cursor?: string,
): string {
	const params = new URLSearchParams({
		standalone: "true",
		limit: "100",
		sortBy:
			options.sort === "title"
				? "title"
				: options.sort === "createdAt-desc"
					? "createdAt"
					: options.sort === "messageCount-desc"
						? "messageCount"
						: "updatedAt",
		sortOrder: options.sort === "title" ? "asc" : "desc",
	});
	if (options.status === "archived") params.set("status", "archived");
	if (cursor) params.set("cursor", cursor);
	return `/api/narrators?${params.toString()}`;
}

function compareNarrators(
	a: RuntimeNarratorRecord,
	b: RuntimeNarratorRecord,
	sort: RuntimeNarratorListOptions["sort"],
): number {
	if (sort === "title") return a.title.localeCompare(b.title, "zh-CN");
	if (sort === "messageCount-desc") {
		return (
			b.messageCount - a.messageCount || a.title.localeCompare(b.title, "zh-CN")
		);
	}
	const activityTime = (narrator: RuntimeNarratorRecord): number => {
		const timestamp =
			sort === "lastModified-desc"
				? Date.parse(narrator.lastMessageAt ?? narrator.updatedAt)
				: sort === "createdAt-desc"
					? Date.parse(narrator.createdAt)
					: Math.max(
							Date.parse(narrator.updatedAt),
							narrator.lastVisitedAt ?? 0,
						);
		return Number.isFinite(timestamp) ? timestamp : 0;
	};
	return (
		activityTime(b) - activityTime(a) || a.title.localeCompare(b.title, "zh-CN")
	);
}

async function fetchRecentTabs(): Promise<RuntimeRecentTab[]> {
	const preferences = await runtimeJson<RuntimeUserPreferences>(
		"/api/user-preferences",
	);
	return (preferences.recentTabs ?? [])
		.map(parseRecentTab)
		.filter((tab): tab is RuntimeRecentTab => tab !== null);
}

function mapBookNarrator(
	summary: RuntimeNarratorSummary,
	recentTab?: RuntimeRecentTab,
	activeNarratorId?: string,
): RuntimeNarratorRecord {
	return mapRuntimeNarrator(
		{
			id: summary.id,
			chapterId: null,
			type: "primary",
			variant: "primary",
			title: summary.title,
			model: summary.model,
			reasoningEffort: summary.reasoningEffort,
			permissionMode: summary.permissionMode ?? "readOnly",
			planMode: summary.planMode,
			cwd: summary.cwd,
			status: summary.status,
			substatus: [],
			traits: [],
			messageCount: summary.messageCount,
			createdAt: summary.createdAt ?? summary.updatedAt,
			updatedAt: summary.updatedAt,
			lastMessageAt: summary.lastMessageAt,
			errorMessage: summary.errorMessage,
		},
		recentTab,
		activeNarratorId,
		{
			kind: "novel.book",
			bookId: summary.bookId,
			capabilities: summary.capabilities,
		},
	);
}

export function createRuntimeNarratorClient(): RuntimeNarratorClient {
	const getRecentTabs = () => fetchRecentTabs();
	const productClient = createRuntimeProductClient();

	const listNarrators = async (
		options: RuntimeNarratorListOptions = {},
	): Promise<RuntimeNarratorRecord[]> => {
		const [recentTabs, rawNarrators, bookNarrators] = await Promise.all([
			getRecentTabs().catch(() => []),
			(async () => {
				const items: unknown[] = [];
				let cursor: string | undefined;
				do {
					const page = await runtimeJson<PaginatedRuntimeNarrators>(
						narratorQuery(options, cursor),
					);
					items.push(...(Array.isArray(page.items) ? page.items : []));
					cursor =
						page.hasMore && page.nextCursor ? page.nextCursor : undefined;
				} while (cursor);
				return items;
			})(),
			productClient
				.getBootstrap()
				.then((bootstrap) => bootstrap.narrators)
				.catch(() => []),
		]);
		const recentById = new Map(
			recentTabs
				.filter((tab) => tab.type === "narrator")
				.map((tab) => [tab.id, tab]),
		);
		const standalone = rawNarrators.map((item) => {
			const id = asString(asRecord(item).id);
			return mapRuntimeNarrator(
				item,
				recentById.get(id),
				options.activeNarratorId,
			);
		});
		const protectedBooks = bookNarrators.map((item) =>
			mapBookNarrator(item, recentById.get(item.id), options.activeNarratorId),
		);
		const byId = new Map(
			[...standalone, ...protectedBooks].map((narrator) => [
				narrator.id,
				narrator,
			]),
		);
		const search = options.search?.trim().toLocaleLowerCase("zh-CN") ?? "";
		return [...byId.values()]
			.filter((narrator) =>
				options.status === "archived"
					? narrator.status === "archived"
					: narrator.status !== "archived",
			)
			.filter((narrator) => {
				if (options.scope === "standalone")
					return narrator.binding.kind === "standalone";
				if (options.scope === "book")
					return narrator.binding.kind === "novel.book";
				return true;
			})
			.filter(
				(narrator) =>
					!search ||
					[
						narrator.title,
						narrator.id,
						narrator.model,
						narrator.cwd ?? "",
						narrator.status,
						narrator.binding.kind === "novel.book"
							? narrator.binding.bookId
							: "",
					].some((field) => field.toLocaleLowerCase("zh-CN").includes(search)),
			)
			.sort((a, b) => compareNarrators(a, b, options.sort));
	};

	const getNarrator = async (
		narratorId: string,
	): Promise<RuntimeNarratorRecord> => {
		const [raw, recentTabs, bootstrap] = await Promise.all([
			runtimeJson<unknown>(`/api/narrators/${encodeURIComponent(narratorId)}`),
			getRecentTabs().catch(() => []),
			productClient.getBootstrap().catch(() => null),
		]);
		const recent = recentTabs.find(
			(tab) => tab.type === "narrator" && tab.id === narratorId,
		);
		const bookNarrator = bootstrap?.narrators.find(
			(narrator) => narrator.id === narratorId,
		);
		return bookNarrator
			? mapBookNarrator(bookNarrator, recent)
			: mapRuntimeNarrator(raw, recent);
	};

	const openNarrator = async (
		narrator: Pick<RuntimeNarratorRecord, "id" | "title" | "status">,
	): Promise<void> => {
		await Promise.allSettled([
			runtimeJson(
				`/api/narrators/${encodeURIComponent(narrator.id)}/mark-read`,
				jsonRequest("PATCH"),
			),
			runtimeJson(
				"/api/user-preferences/recent-tabs",
				jsonRequest("PUT", {
					type: "narrator",
					id: narrator.id,
					narratorId: narrator.id,
					title: narrator.title,
					status: narrator.status,
					lastVisitedAt: Date.now(),
				}),
			),
		]);
	};

	return {
		listNarrators,
		getNarrator,
		getRecentTabs,
		async removeRecentTab(tab) {
			await runtimeJson(
				`/api/user-preferences/recent-tabs/${encodeURIComponent(tab.type)}/${encodeURIComponent(tab.id)}`,
				jsonRequest("DELETE"),
			);
		},
		async moveRecentTab(tab, target) {
			await runtimeJson(
				"/api/user-preferences/recent-tabs/move",
				jsonRequest("PATCH", { key: `${tab.type}:${tab.id}`, ...target }),
			);
		},
		async setRecentTabPinned(tab, pinned) {
			await runtimeJson(
				"/api/user-preferences/recent-tabs/pin",
				jsonRequest("PATCH", { key: `${tab.type}:${tab.id}`, pinned }),
			);
		},
		async clearRecentTabs(scope, keepTabKey) {
			await runtimeJson(
				"/api/user-preferences/recent-tabs/clear",
				jsonRequest("POST", { scope, ...(keepTabKey ? { keepTabKey } : {}) }),
			);
		},
		async createNarrator(input) {
			const raw = await runtimeJson<unknown>(
				"/api/narrators",
				jsonRequest("POST", {
					chapterId: null,
					type: "primary",
					...(input.model ? { model: input.model } : {}),
					...(input.reasoningEffort !== undefined
						? { reasoningEffort: input.reasoningEffort }
						: {}),
					...(input.permissionMode
						? { permissionMode: input.permissionMode }
						: {}),
					...(input.startInPlanMode ? { startInPlanMode: true } : {}),
					...(input.cwd?.trim() ? { cwd: input.cwd.trim() } : {}),
				}),
			);
			const created = mapRuntimeNarrator(raw);
			const title = input.title.trim();
			if (title && title !== created.title) {
				await runtimeJson(
					`/api/narrators/${encodeURIComponent(created.id)}/title`,
					jsonRequest("PATCH", { title }),
				);
			}
			const result = { ...created, title: title || created.title };
			await openNarrator(result);
			return result;
		},
		async renameNarrator(narratorId, title) {
			await runtimeJson(
				`/api/narrators/${encodeURIComponent(narratorId)}/title`,
				jsonRequest("PATCH", { title: title.trim() }),
			);
		},
		async forkLatestNarrator(narratorId, input) {
			const raw = await runtimeJson<unknown>(
				`/api/narrators/${encodeURIComponent(narratorId)}/fork-latest`,
				jsonRequest("POST", input),
			);
			const narrator = mapRuntimeNarrator(raw);
			await openNarrator(narrator);
			return narrator;
		},
		async archiveNarrator(narratorId) {
			await runtimeJson(
				`/api/narrators/${encodeURIComponent(narratorId)}/archive`,
				jsonRequest("PATCH"),
			);
			await runtimeJson(
				`/api/user-preferences/recent-tabs/narrator/${encodeURIComponent(narratorId)}`,
				jsonRequest("DELETE"),
			).catch(() => undefined);
		},
		async unarchiveNarrator(narratorId) {
			await runtimeJson(
				`/api/narrators/${encodeURIComponent(narratorId)}/unarchive`,
				jsonRequest("PATCH"),
			);
		},
		async deleteNarrator(narratorId) {
			await runtimeJson(
				`/api/narrators/${encodeURIComponent(narratorId)}`,
				jsonRequest("DELETE"),
			);
			await runtimeJson(
				`/api/user-preferences/recent-tabs/narrator/${encodeURIComponent(narratorId)}`,
				jsonRequest("DELETE"),
			).catch(() => undefined);
		},
		openNarrator,
		async setNarratorPinned(narrator, pinned) {
			await runtimeJson(
				"/api/user-preferences/recent-tabs",
				jsonRequest("PUT", {
					type: "narrator",
					id: narrator.id,
					narratorId: narrator.id,
					title: narrator.title,
					status: narrator.status,
					lastVisitedAt: Date.now(),
				}),
			);
			await runtimeJson(
				"/api/user-preferences/recent-tabs/pin",
				jsonRequest("PATCH", {
					key: `narrator:${narrator.id}`,
					pinned,
				}),
			);
		},
		async continueLatestNarrator() {
			const [narrators, recentTabs] = await Promise.all([
				listNarrators({ status: "active", sort: "recent" }),
				getRecentTabs().catch(() => []),
			]);
			const byId = new Map(
				narrators.map((narrator) => [narrator.id, narrator]),
			);
			const recent = recentTabs
				.filter((tab) => tab.type === "narrator")
				.sort((a, b) => b.lastVisitedAt - a.lastVisitedAt)
				.map((tab) => byId.get(tab.id))
				.find(
					(narrator): narrator is RuntimeNarratorRecord =>
						narrator !== undefined,
				);
			return recent ?? narrators[0] ?? null;
		},
	};
}
