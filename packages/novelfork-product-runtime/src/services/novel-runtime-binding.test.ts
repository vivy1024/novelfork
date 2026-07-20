import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
	BookRuntimeBindingService,
	deriveBookRoot,
	EXTERNAL_BOOK_WORKSPACE_MARKER,
	type BookRuntimeBindingRecord,
	type BookRuntimeBindingStore,
} from "./book-binding";
import { NovelRuntimeAdapter } from "../adapters/runtime-adapter";

class MemoryStore implements BookRuntimeBindingStore {
	bindings = new Map<string, BookRuntimeBindingRecord>();
	projects = new Set(["project-a", "project-b"]);
	narratorProjects = new Map([["narrator-a", "project-a"], ["narrator-b", "project-b"]]);

	async findByProjectId(id: string) { return this.bindings.get(id) ?? null; }
	async findByNarratorId(id: string) {
		const projectId = this.narratorProjects.get(id);
		return projectId ? this.bindings.get(projectId) ?? null : null;
	}
	async projectExists(id: string) { return this.projects.has(id); }
	async bookBoundElsewhere(bookId: string, projectId: string) {
		return [...this.bindings.values()].some((row) => row.bookId === bookId && row.runtimeProjectId !== projectId);
	}
	async upsert(record: BookRuntimeBindingRecord) { this.bindings.set(record.runtimeProjectId, record); return record; }
	async deleteByProjectId(id: string) { return this.bindings.delete(id); }
}

let booksRoot: string;
let externalBookRoot: string;
let unmarkedExternalBookRoot: string;

beforeAll(async () => {
	booksRoot = await mkdtemp(join(tmpdir(), "novel-runtime-binding-"));
	externalBookRoot = await mkdtemp(join(tmpdir(), "novel-runtime-binding-external-"));
	unmarkedExternalBookRoot = await mkdtemp(join(tmpdir(), "novel-runtime-binding-unmarked-"));
	await Promise.all([
		mkdir(join(booksRoot, "book-a"), { recursive: true }),
		mkdir(join(booksRoot, "book-b"), { recursive: true }),
		writeFile(
			join(externalBookRoot, "book.json"),
			JSON.stringify({
				id: "book-a",
				title: "External workspace",
				[EXTERNAL_BOOK_WORKSPACE_MARKER]: true,
			}),
			"utf8",
		),
	]);
});

afterAll(async () => {
	await Promise.all([
		rm(booksRoot, { recursive: true, force: true }),
		rm(externalBookRoot, { recursive: true, force: true }),
		rm(unmarkedExternalBookRoot, { recursive: true, force: true }),
	]);
});

function createHarness() {
	const store = new MemoryStore();
	const service = new BookRuntimeBindingService(store, booksRoot);
	return { store, service, adapter: new NovelRuntimeAdapter(service) };
}

describe("trusted novel runtime binding", () => {
	test("resolves frozen trusted context through narrator project chain", async () => {
		const { service } = createHarness();
		await service.upsert("project-a", "book-a", "user-a");
		const context = await service.resolveForNarrator("narrator-a");
		expect(context?.runtimeProjectId).toBe("project-a");
		expect(context?.resourceBindings["novel.book"]).toEqual({
			kind: "novel.book", bookId: "book-a", root: resolve(booksRoot, "book-a"),
		});
		expect(Object.isFrozen(context)).toBe(true);
		expect(Object.isFrozen(context?.resourceBindings)).toBe(true);
	});

	test("resolves a server-marked external workspace for its bound narrator", async () => {
		const { service, adapter } = createHarness();
		await service.upsert("project-a", "book-a", "user-a", externalBookRoot);

		const context = await service.resolveForNarrator("narrator-a");
		expect(context?.resourceBindings["novel.book"]).toEqual({
			kind: "novel.book",
			bookId: "book-a",
			root: resolve(externalBookRoot),
		});
		expect(await adapter.resolveToolNames("narrator-a")).toContain("chapter.read");
	});

	test("fails closed for an unmarked external workspace", async () => {
		const { service } = createHarness();
		await service.upsert("project-a", "book-a", "user-a", unmarkedExternalBookRoot);
		expect(await service.resolveForNarrator("narrator-a")).toBeNull();
	});

	test("fails closed without binding and rejects cross-project book reuse", async () => {
		const { service, adapter } = createHarness();
		expect(await service.resolveForNarrator("narrator-a")).toBeNull();
		expect((await adapter.execute("chapter.read", { bookId: "book-a", chapterNumber: 1 }, "narrator-a")).isError).toBe(true);
		await service.upsert("project-a", "book-a", null);
		await expect(service.upsert("project-b", "book-a", null)).rejects.toThrow("another runtime project");
		expect((await service.resolveForNarrator("narrator-b"))).toBeNull();
	});

	test("rejects forged tool bookId before reading another book", async () => {
		const { service, adapter } = createHarness();
		await service.upsert("project-a", "book-a", null);
		const result = await adapter.execute("chapter.read", { bookId: "book-b", chapterNumber: 1 }, "narrator-a");
		expect(result.isError).toBe(true);
		expect(JSON.parse(result.output).error).toBe("invalid-tool-input");
	});

	test("rejects traversal, absolute and empty book ids", () => {
		for (const id of ["", "../book", "folder/book", resolve(booksRoot, "book")]) {
			expect(() => deriveBookRoot(booksRoot, id)).toThrow();
		}
	});

	test("tool visibility appears only after trusted binding", async () => {
		const { service, adapter } = createHarness();
		expect(await adapter.resolveToolNames("narrator-a")).toEqual([]);
		await service.upsert("project-a", "book-a", null);
		expect(await adapter.resolveToolNames("narrator-a")).toContain("chapter.read");
	});

	test("returns one trusted product prompt extension", async () => {
		const { service, adapter } = createHarness();
		await service.upsert("project-a", "book-a", null);
		const extensions = await adapter.promptExtensions("narrator-a");
		expect(extensions).toHaveLength(1);
		expect(extensions[0]).toContain("NovelFork 小说创作运行时");
	});

	test("adapter preserves portable raw JSON schema", () => {
		const { adapter } = createHarness();
		const definition = adapter.toolDefinitions().find((tool) => tool.name === "chapter.read");
		expect(definition?.rawJsonSchema).toBeDefined();
	});
});
