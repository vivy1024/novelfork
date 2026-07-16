import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ runtimeJson: vi.fn() }));

vi.mock("./auth", () => ({ runtimeJson: mocks.runtimeJson }));

import {
	createRuntimeNarratorClient,
	mapRuntimeNarrator,
} from "./runtime-narrator-client";

function rawNarrator(overrides: Record<string, unknown> = {}) {
	return {
		id: "narrator-1",
		chapterId: null,
		type: "primary",
		variant: "primary",
		title: "独立叙述者",
		model: "sub2api:gpt-5.6",
		reasoningEffort: "high",
		permissionMode: "acceptEdits",
		planMode: false,
		cwd: "D:\\novels\\demo",
		status: "idle",
		substatus: [],
		traits: ["standalone"],
		messageCount: 7,
		activeTerminalCount: 2,
		containerCount: 3,
		runningContainerCount: 1,
		viewers: [
			{
				userId: "user-1",
				username: "作者",
				avatarColor: null,
				avatarImageId: null,
			},
		],
		createdAt: "2026-07-15T01:00:00.000Z",
		updatedAt: "2026-07-15T02:00:00.000Z",
		lastMessageAt: "2026-07-15T02:00:00.000Z",
		errorMessage: null,
		...overrides,
	};
}

beforeEach(() => {
	mocks.runtimeJson.mockReset();
});

describe("runtime narrator client", () => {
	it("maps Runtime narrator state with recent pin and unread markers", () => {
		const narrator = mapRuntimeNarrator(rawNarrator(), {
			type: "narrator",
			id: "narrator-1",
			title: "独立叙述者",
			lastVisitedAt: Date.parse("2026-07-15T01:30:00.000Z"),
			pinned: true,
		});

		expect(narrator).toMatchObject({
			id: "narrator-1",
			pinned: true,
			unread: true,
			working: false,
			permissionMode: "acceptEdits",
			reasoningEffort: "high",
			chapterId: null,
			activeTerminalCount: 2,
			containerCount: 3,
			runningContainerCount: 1,
			viewers: [
				{
					userId: "user-1",
					username: "作者",
					avatarColor: null,
					avatarImageId: null,
				},
			],
		});
	});

	it("loads standalone narrators and filters search locally", async () => {
		mocks.runtimeJson.mockImplementation(async (path: string) => {
			if (path === "/api/user-preferences") {
				return {
					recentTabs: [
						{
							type: "narrator",
							id: "narrator-1",
							title: "独立叙述者",
							lastVisitedAt: 1,
							pinned: true,
						},
					],
				};
			}
			if (path.startsWith("/api/narrators?")) {
				return {
					items: [
						rawNarrator(),
						rawNarrator({
							id: "narrator-2",
							title: "无关会话",
							model: "other:model",
						}),
					],
					hasMore: false,
					nextCursor: null,
					totalCount: 2,
				};
			}
			throw new Error(`unexpected ${path}`);
		});

		const narrators = await createRuntimeNarratorClient().listNarrators({
			search: "GPT-5.6",
		});

		expect(narrators).toHaveLength(1);
		expect(narrators[0]).toMatchObject({ id: "narrator-1", pinned: true });
		expect(
			mocks.runtimeJson.mock.calls.some(([path]) =>
				String(path).includes("standalone=true"),
			),
		).toBe(true);
	});

	it("creates a Runtime narrator, updates its title, and records a recent tab", async () => {
		mocks.runtimeJson.mockImplementation(async (path: string) => {
			if (path === "/api/narrators") return rawNarrator({ title: null });
			return { ok: true };
		});

		const narrator = await createRuntimeNarratorClient().createNarrator({
			title: "世界观规划室",
			model: "sub2api:gpt-5.6",
			reasoningEffort: "xhigh",
			permissionMode: "readOnly",
			startInPlanMode: true,
			cwd: "D:\\novels\\world",
		});

		expect(narrator.title).toBe("世界观规划室");
		const createCall = mocks.runtimeJson.mock.calls.find(
			([path]) => path === "/api/narrators",
		);
		expect(JSON.parse(createCall?.[1]?.body as string)).toEqual({
			chapterId: null,
			type: "primary",
			model: "sub2api:gpt-5.6",
			reasoningEffort: "xhigh",
			permissionMode: "readOnly",
			startInPlanMode: true,
			cwd: "D:\\novels\\world",
		});
		expect(mocks.runtimeJson).toHaveBeenCalledWith(
			"/api/narrators/narrator-1/title",
			expect.objectContaining({ method: "PATCH" }),
		);
		expect(mocks.runtimeJson).toHaveBeenCalledWith(
			"/api/user-preferences/recent-tabs",
			expect.objectContaining({ method: "PUT" }),
		);
	});

	it("pins after upserting recent state and delegates archive lifecycle", async () => {
		mocks.runtimeJson.mockResolvedValue({ ok: true });
		const client = createRuntimeNarratorClient();

		await client.setNarratorPinned(
			{ id: "narrator-1", title: "独立叙述者", status: "idle" },
			true,
		);
		await client.archiveNarrator("narrator-1");

		expect(mocks.runtimeJson).toHaveBeenCalledWith(
			"/api/user-preferences/recent-tabs/pin",
			expect.objectContaining({
				method: "PATCH",
				body: JSON.stringify({ key: "narrator:narrator-1", pinned: true }),
			}),
		);
		expect(mocks.runtimeJson).toHaveBeenCalledWith(
			"/api/narrators/narrator-1/archive",
			expect.objectContaining({ method: "PATCH" }),
		);
	});

	it("merges trusted product-bound narrators and applies scope/search filters", async () => {
		mocks.runtimeJson.mockImplementation(async (path: string) => {
			if (path === "/api/user-preferences") return { recentTabs: [] };
			if (path.startsWith("/api/narrators?"))
				return { items: [rawNarrator()], hasMore: false };
			if (path === "/api/novelfork/bootstrap") {
				return {
					contractVersion: "phase-0",
					features: {},
					books: [],
					narrators: [
						{
							id: "book-narrator",
							bookId: "book-trusted",
							title: "书籍助手",
							model: "sub2api:gpt-5.6",
							permissionMode: "readOnly",
							status: "idle",
							messageCount: 3,
							createdAt: "2026-07-15T00:00:00.000Z",
							updatedAt: "2026-07-15T03:00:00.000Z",
							capabilities: {
								read: true,
								send: true,
								update: false,
								delete: false,
							},
						},
					],
					model: { setupRequired: false },
					capabilities: {},
				};
			}
			throw new Error(`unexpected ${path}`);
		});

		const client = createRuntimeNarratorClient();
		const books = await client.listNarrators({
			scope: "book",
			search: "trusted",
		});
		const standalone = await client.listNarrators({ scope: "standalone" });

		expect(books).toHaveLength(1);
		expect(books[0]).toMatchObject({
			id: "book-narrator",
			permissionMode: "readOnly",
			binding: { kind: "novel.book", bookId: "book-trusted" },
		});
		expect(standalone.map((item) => item.id)).toEqual(["narrator-1"]);
	});

	it("sorts by message count and creation time like the upstream list", async () => {
		mocks.runtimeJson.mockImplementation(async (path: string) => {
			if (path === "/api/user-preferences") return { recentTabs: [] };
			if (path.startsWith("/api/narrators?")) {
				return {
					items: [
						rawNarrator({
							id: "older-more",
							title: "旧而多",
							messageCount: 20,
							createdAt: "2026-07-14T01:00:00.000Z",
						}),
						rawNarrator({
							id: "newer-less",
							title: "新而少",
							messageCount: 2,
							createdAt: "2026-07-15T01:00:00.000Z",
						}),
					],
					hasMore: false,
				};
			}
			if (path === "/api/novelfork/bootstrap")
				return {
					contractVersion: "phase-0",
					features: {},
					books: [],
					narrators: [],
					model: { setupRequired: false },
					capabilities: {},
				};
			throw new Error(`unexpected ${path}`);
		});

		const client = createRuntimeNarratorClient();
		expect(
			(await client.listNarrators({ sort: "messageCount-desc" })).map(
				(item) => item.id,
			),
		).toEqual(["older-more", "newer-less"]);
		expect(
			(await client.listNarrators({ sort: "createdAt-desc" })).map(
				(item) => item.id,
			),
		).toEqual(["newer-less", "older-more"]);
	});

	it("loads recent tabs in Runtime-provided order", async () => {
		mocks.runtimeJson.mockImplementation(async (path: string) => {
			if (path === "/api/user-preferences") {
				return {
					recentTabs: [
						{ type: "narrator", id: "older", title: "较早", lastVisitedAt: 10 },
						{
							type: "chapter",
							id: "chapter-1",
							narratorId: "book-narrator",
							title: "书籍会话",
							lastVisitedAt: 30,
						},
						{
							type: "narrator",
							id: "pinned",
							title: "固定",
							lastVisitedAt: 1,
							pinned: true,
						},
					],
				};
			}
			throw new Error(`unexpected ${path}`);
		});

		const tabs = await createRuntimeNarratorClient().getRecentTabs();

		expect(tabs.map((tab) => tab.id)).toEqual(["older", "chapter-1", "pinned"]);
		expect(tabs[1]).toMatchObject({
			type: "chapter",
			narratorId: "book-narrator",
		});
	});

	it("moves and pins arbitrary recent tab types through canonical Runtime endpoints", async () => {
		mocks.runtimeJson.mockResolvedValue({ ok: true });
		const client = createRuntimeNarratorClient();

		await client.moveRecentTab(
			{ type: "chapter", id: "chapter/with space" },
			{ toIndex: 2 },
		);
		await client.setRecentTabPinned(
			{ type: "chapter", id: "chapter/with space" },
			true,
		);

		expect(mocks.runtimeJson).toHaveBeenCalledWith(
			"/api/user-preferences/recent-tabs/move",
			expect.objectContaining({
				method: "PATCH",
				body: JSON.stringify({ key: "chapter:chapter/with space", toIndex: 2 }),
			}),
		);
		expect(mocks.runtimeJson).toHaveBeenCalledWith(
			"/api/user-preferences/recent-tabs/pin",
			expect.objectContaining({
				method: "PATCH",
				body: JSON.stringify({
					key: "chapter:chapter/with space",
					pinned: true,
				}),
			}),
		);
	});

	it("uses canonical Runtime endpoints to close and clear recent tabs", async () => {
		mocks.runtimeJson.mockResolvedValue({ ok: true });
		const client = createRuntimeNarratorClient();

		await client.removeRecentTab({
			type: "narrator",
			id: "narrator/with space",
		});
		await client.clearRecentTabs("inactive_narrators", "narrator:active");

		expect(mocks.runtimeJson).toHaveBeenCalledWith(
			"/api/user-preferences/recent-tabs/narrator/narrator%2Fwith%20space",
			expect.objectContaining({ method: "DELETE" }),
		);
		expect(mocks.runtimeJson).toHaveBeenCalledWith(
			"/api/user-preferences/recent-tabs/clear",
			expect.objectContaining({
				method: "POST",
				body: JSON.stringify({
					scope: "inactive_narrators",
					keepTabKey: "narrator:active",
				}),
			}),
		);
	});

	it("sorts recent activity using the latest visit timestamp", async () => {
		mocks.runtimeJson.mockImplementation(async (path: string) => {
			if (path === "/api/user-preferences") {
				return {
					recentTabs: [
						{
							type: "narrator",
							id: "older-updated",
							title: "最近访问",
							lastVisitedAt: Date.parse("2026-07-15T04:00:00.000Z"),
						},
					],
				};
			}
			if (path.startsWith("/api/narrators?")) {
				return {
					items: [
						rawNarrator({
							id: "newer-updated",
							title: "新更新",
							updatedAt: "2026-07-15T03:00:00.000Z",
						}),
						rawNarrator({
							id: "older-updated",
							title: "最近访问",
							updatedAt: "2026-07-15T01:00:00.000Z",
						}),
					],
					hasMore: false,
				};
			}
			if (path === "/api/novelfork/bootstrap")
				return {
					contractVersion: "phase-0",
					features: {},
					books: [],
					narrators: [],
					model: { setupRequired: false },
					capabilities: {},
				};
			throw new Error(`unexpected ${path}`);
		});

		const narrators = await createRuntimeNarratorClient().listNarrators({
			sort: "recent",
		});
		expect(narrators.map((item) => item.id)).toEqual([
			"older-updated",
			"newer-updated",
		]);
	});
});
