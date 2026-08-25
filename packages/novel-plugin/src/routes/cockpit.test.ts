/**
 * 驾驶舱读取接口的 HTTP 契约。
 *
 * 覆盖 WorkbenchCanvas「作品基础」区在生产上一直 404 的两个 endpoint：
 *   GET /api/books/:bookId/cockpit/recent-chapter-results
 *   GET /api/books/:bookId/cockpit/open-hooks
 *
 * 这些用例锁住三件事：
 * - 路由注册到了真实路径上（不再是 404）；
 * - 响应 shape 与前端 `CockpitListItem` 对齐（id/title|text/status/...）；
 * - limit 与 bookId 缺失/未知时的回落行为不会再让面板抖动（保持 200 + items: []）。
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { StateManager } from "@vivy1024/novelfork-core";
import {
	createStorageDatabase,
	runStorageMigrations,
	type StorageDatabase,
} from "@vivy1024/novelfork-core/storage";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createBookRepository } from "../engine/jingwei/repositories/book-repo.js";
import { createStoryJingweiEntryRepository } from "../engine/jingwei/repositories/entry-repo.js";
import { createStoryJingweiSectionRepository } from "../engine/jingwei/repositories/section-repo.js";
import { createCockpitRouter } from "./cockpit.js";
import type { RouterContext } from "./context.js";

const BOOK_ID = "book-cockpit";
const FIXED_NOW = "2026-08-01T00:00:00.000Z";

let storage: StorageDatabase;
let workspaceRoot: string;
const tempDirs: string[] = [];

function chapterMeta(number: number, overrides: Record<string, unknown> = {}) {
	return {
		number,
		title: `第${number}章 标题`,
		status: number === 1 ? "approved" : number === 2 ? "audit-failed" : "drafted",
		wordCount: 3000 + number,
		createdAt: new Date(Date.parse(FIXED_NOW) + number * 1000).toISOString(),
		updatedAt: new Date(Date.parse(FIXED_NOW) + number * 2000).toISOString(),
		auditIssues: [],
		lengthWarnings: [],
		...overrides,
	};
}

function buildBookConfig(id: string) {
	return {
		id,
		title: "驾驶舱测试书",
		platform: "qidian",
		genre: "xuanhuan",
		status: "active",
		targetChapters: 200,
		chapterWordCount: 3000,
		createdAt: FIXED_NOW,
		updatedAt: FIXED_NOW,
	};
}

function makeRouterContext(): RouterContext {
	// 必须按 bookId 路由 — 写成常量会让 /missing-book 误命中真书的 fixture。
	const state = new StateManager(workspaceRoot, {
		resolveBookDir: (id: string) => join(workspaceRoot, "books", id),
	});
	return {
		state,
		root: workspaceRoot,
		broadcast: () => undefined,
		buildPipelineConfig: async () => {
			throw new Error("not needed in cockpit test");
		},
		getSessionLlm: async () => undefined,
	} as RouterContext;
}

function app() {
	return createCockpitRouter(makeRouterContext(), { storage });
}

async function writeBookFixture(id: string = BOOK_ID): Promise<void> {
	const bookDir = join(workspaceRoot, "books", id);
	await mkdir(join(bookDir, "chapters"), { recursive: true });
	await writeFile(join(bookDir, "book.json"), JSON.stringify(buildBookConfig(id), null, 2), "utf8");
	await writeFile(
		join(bookDir, "chapters", "index.json"),
		JSON.stringify([chapterMeta(1), chapterMeta(2), chapterMeta(3)], null, 2),
		"utf8",
	);
}

async function insertForeshadowingEntry(
	input: { id: string; title: string; contentMd?: string; relatedChapterNumbers: number[] },
): Promise<void> {
	const now = new Date(FIXED_NOW);
	await createStoryJingweiEntryRepository(storage).create({
		id: input.id,
		bookId: BOOK_ID,
		sectionId: "foreshadowing-section",
		title: input.title,
		contentMd: input.contentMd ?? "",
		category: "foreshadowing",
		lifecycle: "active",
		fields: {},
		customFields: {},
		tags: [],
		aliases: [],
		relatedChapterNumbers: input.relatedChapterNumbers,
		relatedEntryIds: [],
		visibilityRule: { type: "tracked" },
		participatesInAi: true,
		tokenBudget: null,
		createdAt: now,
		updatedAt: now,
	});
}

beforeEach(async () => {
	workspaceRoot = await mkdtemp(join(tmpdir(), "novelfork-cockpit-route-"));
	tempDirs.push(workspaceRoot);
	await mkdir(join(workspaceRoot, "books"), { recursive: true });

	const dbDir = await mkdtemp(join(tmpdir(), "novelfork-cockpit-db-"));
	tempDirs.push(dbDir);
	storage = createStorageDatabase({ databasePath: join(dbDir, "novelfork.db") });
	runStorageMigrations(storage, { migrationsDir: join(process.cwd(), "../core/src/storage/migrations") });

	const now = new Date(FIXED_NOW);
	await createBookRepository(storage).create({
		id: BOOK_ID,
		name: "驾驶舱测试书",
		jingweiMode: "dynamic",
		currentChapter: 3,
		createdAt: now,
		updatedAt: now,
	});
	await createStoryJingweiSectionRepository(storage).create({
		id: "foreshadowing-section",
		bookId: BOOK_ID,
		key: "foreshadowing",
		name: "伏笔",
		description: "",
		icon: null,
		order: 0,
		enabled: true,
		showInSidebar: true,
		participatesInAi: true,
		defaultVisibility: "tracked",
		fieldsJson: [],
		builtinKind: "foreshadowing",
		sourceTemplate: "test",
		createdAt: now,
		updatedAt: now,
	});
});

afterEach(async () => {
	storage.close();
	await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("GET /api/books/:bookId/cockpit/recent-chapter-results", () => {
	it("returns a real payload instead of the 404 the workbench used to hit", async () => {
		await writeBookFixture();
		const response = await app().request(
			`http://localhost/api/books/${BOOK_ID}/cockpit/recent-chapter-results?limit=8`,
		);

		expect(response.status).toBe(200);
		const payload = await response.json() as {
			status: string;
			items: Array<{
				id: string;
				title: string;
				chapterNumber: number;
				status: string;
				wordCount: number;
				createdAt: string;
				updatedAt: string;
			}>;
		};
		expect(payload.status).toBe("available");
		expect(payload.items).toHaveLength(3);
		// 按更新时间倒序，第 3 章最新。
		expect(payload.items[0]).toMatchObject({
			id: "chapter:3",
			chapterNumber: 3,
			status: "drafted",
		});
		expect(payload.items[2]).toMatchObject({ chapterNumber: 1, status: "approved" });
		// 前端 CockpitListItem 必填字段都得在。
		for (const item of payload.items) {
			expect(typeof item.id).toBe("string");
			expect(typeof item.title).toBe("string");
			expect(typeof item.createdAt).toBe("string");
		}
	});

	it("honours the limit query parameter", async () => {
		await writeBookFixture();
		const response = await app().request(
			`http://localhost/api/books/${BOOK_ID}/cockpit/recent-chapter-results?limit=2`,
		);
		expect(response.status).toBe(200);
		const payload = await response.json() as { items: Array<{ chapterNumber: number }> };
		expect(payload.items.map((item) => item.chapterNumber)).toEqual([3, 2]);
	});

	it("returns status=missing with an empty items list when the book cannot be read", async () => {
		await writeBookFixture();
		const response = await app().request(
			`http://localhost/api/books/missing-book/cockpit/recent-chapter-results?limit=8`,
		);
		expect(response.status).toBe(200);
		const payload = await response.json() as { status: string; items: unknown[]; reason?: string };
		expect(payload.status).toBe("missing");
		expect(payload.items).toEqual([]);
		expect(payload.reason).toContain("missing-book");
	});
});

describe("GET /api/books/:bookId/cockpit/open-hooks", () => {
	it("returns active foreshadowing entries with the shape the workbench reads", async () => {
		await writeBookFixture();
		await insertForeshadowingEntry({
			id: "hook-1",
			title: "青铜铃异响",
			contentMd: " remind 晋升试炼",
			relatedChapterNumbers: [1],
		});
		await insertForeshadowingEntry({
			id: "hook-2",
			title: "师父留下的玉佩",
			relatedChapterNumbers: [2],
		});
		await insertForeshadowingEntry({
			id: "hook-archived",
			title: "已回收的旧伏笔",
			relatedChapterNumbers: [1],
		});
		// Archived hooks must not appear on the cockpit panel.
		await storage.sqlite
			.prepare(`UPDATE story_jingwei_entry SET lifecycle = 'archived' WHERE id = 'hook-archived'`)
			.run();

		const response = await app().request(
			`http://localhost/api/books/${BOOK_ID}/cockpit/open-hooks?limit=8`,
		);
		expect(response.status).toBe(200);
		const payload = await response.json() as {
			status: string;
			items: Array<{
				id: string;
				text: string;
				sourceChapter: number;
				status: string;
				sourceKind: string;
			}>;
		};
		expect(payload.status).toBe("available");
		expect(payload.items).toHaveLength(2);
		const ids = payload.items.map((item) => item.id);
		expect(ids).toContain("hook-1");
		expect(ids).toContain("hook-2");
		expect(ids).not.toContain("hook-archived");
		const hookOne = payload.items.find((item) => item.id === "hook-1");
		expect(hookOne).toBeDefined();
		expect(hookOne).toMatchObject({
			text: expect.stringContaining("青铜铃异响"),
			sourceChapter: 1,
			sourceKind: "jingwei",
		});
		// 状态来自 foreshadowing-debt 三态口径，前端会按这个字段决定警示强度。
		expect(["open", "payoff-due", "expired-risk"]).toContain(hookOne?.status);
	});

	it("returns status=empty with an empty items list when the book has no hooks", async () => {
		await writeBookFixture();
		const response = await app().request(
			`http://localhost/api/books/${BOOK_ID}/cockpit/open-hooks`,
		);
		expect(response.status).toBe(200);
		const payload = await response.json() as { status: string; items: unknown[]; reason?: string };
		expect(payload.status).toBe("empty");
		expect(payload.items).toEqual([]);
	});

	it("returns status=empty for a book with no jingwei data (unknown bookId)", async () => {
		await writeBookFixture();
		const response = await app().request(
			`http://localhost/api/books/unknown-book/cockpit/open-hooks`,
		);
		expect(response.status).toBe(200);
		const payload = await response.json() as { status: string; items: unknown[] };
		expect(payload.status).toBe("empty");
		expect(payload.items).toEqual([]);
	});
});

describe("query parameter parsing", () => {
	it("ignores non-numeric and negative limit values and falls back to the service default", async () => {
		await writeBookFixture();
		const nan = await app().request(
			`http://localhost/api/books/${BOOK_ID}/cockpit/recent-chapter-results?limit=abc`,
		);
		expect(nan.status).toBe(200);
		const nanPayload = await nan.json() as { items: unknown[] };
		expect(nanPayload.items).toHaveLength(3);

		const neg = await app().request(
			`http://localhost/api/books/${BOOK_ID}/cockpit/recent-chapter-results?limit=-1`,
		);
		expect(neg.status).toBe(200);
		const negPayload = await neg.json() as { items: unknown[] };
		expect(negPayload.items).toHaveLength(3);
	});
});
