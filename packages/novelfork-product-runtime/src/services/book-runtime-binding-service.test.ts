import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type BookRuntimeBindingRecord,
	BookRuntimeBindingService,
	type BookRuntimeBindingStore,
	deriveBookRoot,
} from "./book-binding";

class MemoryBindingStore implements BookRuntimeBindingStore {
	readonly records = new Map<string, BookRuntimeBindingRecord>();
	readonly projects = new Set<string>();
	readonly narratorProjects = new Map<string, string>();

	async findByProjectId(runtimeProjectId: string) {
		return this.records.get(runtimeProjectId) ?? null;
	}

	async findByNarratorId(narratorId: string) {
		const projectId = this.narratorProjects.get(narratorId);
		return projectId ? (this.records.get(projectId) ?? null) : null;
	}

	async projectExists(runtimeProjectId: string) {
		return this.projects.has(runtimeProjectId);
	}

	async bookBoundElsewhere(bookId: string, runtimeProjectId: string) {
		return [...this.records.values()].some(
			(record) => record.bookId === bookId && record.runtimeProjectId !== runtimeProjectId,
		);
	}

	async upsert(record: BookRuntimeBindingRecord) {
		this.records.set(record.runtimeProjectId, record);
		return record;
	}

	async deleteByProjectId(runtimeProjectId: string) {
		return this.records.delete(runtimeProjectId);
	}
}

let booksRoot: string;
let store: MemoryBindingStore;
let service: BookRuntimeBindingService;

beforeEach(async () => {
	booksRoot = await mkdtemp(join(tmpdir(), "novelfork-books-"));
	await mkdir(join(booksRoot, "book-a"));
	store = new MemoryBindingStore();
	store.projects.add("project-a");
	store.projects.add("project-b");
	store.narratorProjects.set("narrator-a", "project-a");
	service = new BookRuntimeBindingService(store, booksRoot);
});

afterEach(async () => {
	await rm(booksRoot, { recursive: true, force: true });
});

describe("BookRuntimeBindingService", () => {
	test("rejects path-like book IDs", () => {
		for (const bookId of ["", ".", "..", "../escape", "nested/book", "nested\\book"]) {
			expect(() => deriveBookRoot(booksRoot, bookId)).toThrow();
		}
	});

	test("persists a canonical root and resolves it only through narrator ownership", async () => {
		const saved = await service.upsert("project-a", "book-a", "user-a");
		const canonicalBooksRoot = await realpath(booksRoot);
		const canonicalBookRoot = await realpath(join(booksRoot, "book-a"));

		expect(saved.bookRoot).toBe(canonicalBookRoot);
		expect(await service.resolveForNarrator("narrator-missing")).toBeNull();

		const context = await service.resolveForNarrator("narrator-a");
		expect(context?.runtimeProjectId).toBe("project-a");
		expect(context?.projectRoot).toBe(canonicalBooksRoot);
		expect(context?.enabledPluginIds).toEqual(["novelfork-novel"]);
		expect(context?.resourceBindings["novel.book"]).toEqual({
			kind: "novel.book",
			bookId: "book-a",
			root: canonicalBookRoot,
		});
		expect(Object.isFrozen(context)).toBe(true);
		expect(Object.isFrozen(context?.resourceBindings)).toBe(true);
	});

	test("fails closed when persisted root data no longer matches the controlled book", async () => {
		const saved = await service.upsert("project-a", "book-a", "user-a");
		store.records.set("project-a", { ...saved, bookRoot: booksRoot });

		expect(await service.resolveForNarrator("narrator-a")).toBeNull();
	});

	test("rejects missing projects, missing books, and cross-project duplicate bindings", async () => {
		await expect(service.upsert("project-missing", "book-a", "user-a")).rejects.toThrow(
			"Project not found",
		);
		await expect(service.upsert("project-a", "book-missing", "user-a")).rejects.toThrow(
			"Book not found",
		);

		await service.upsert("project-a", "book-a", "user-a");
		await expect(service.upsert("project-b", "book-a", "user-b")).rejects.toThrow(
			"already bound to another runtime project",
		);
	});
});
