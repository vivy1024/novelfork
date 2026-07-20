import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import {
	chapters,
	db as runtimeDb,
	generateId,
	getDbDir,
	narrators,
	projects,
	type RuntimeResolveContext,
	ValidationError,
} from "@vivy1024/narrafork-runtime-bridge";
import { and, eq, ne } from "drizzle-orm";
import { getNovelForkProductDatabase } from "../db/database";
import { bookRuntimeBindings } from "../db/schema";

export interface BookRuntimeBindingRecord {
	id: string;
	runtimeProjectId: string;
	bookId: string;
	bookRoot: string;
	createdByUserId: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface BookRuntimeBindingStore {
	findByProjectId(runtimeProjectId: string): Promise<BookRuntimeBindingRecord | null>;
	/** Optional for legacy test/adapter stores; production Drizzle store implements it. */
	findByBookId?(bookId: string): Promise<BookRuntimeBindingRecord | null>;
	findByNarratorId(narratorId: string): Promise<BookRuntimeBindingRecord | null>;
	projectExists(runtimeProjectId: string): Promise<boolean>;
	bookBoundElsewhere(bookId: string, runtimeProjectId: string): Promise<boolean>;
	upsert(record: BookRuntimeBindingRecord): Promise<BookRuntimeBindingRecord>;
	deleteByProjectId(runtimeProjectId: string): Promise<boolean>;
}

function isContained(root: string, candidate: string): boolean {
	const rel = relative(root, candidate);
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** Server-written marker required before a persisted external root is trusted. */
export const EXTERNAL_BOOK_WORKSPACE_MARKER = "novelforkExternalWorkspace";

async function isMarkedExternalBookRoot(bookRoot: string, bookId: string): Promise<boolean> {
	const raw = await readFile(join(bookRoot, "book.json"), "utf8").catch(() => null);
	if (!raw) return false;
	try {
		const config: unknown = JSON.parse(raw);
		return (
			Boolean(config) &&
			typeof config === "object" &&
			!Array.isArray(config) &&
			(config as Record<string, unknown>).id === bookId &&
			(config as Record<string, unknown>)[EXTERNAL_BOOK_WORKSPACE_MARKER] === true
		);
	} catch {
		return false;
	}
}

export function deriveBookRoot(booksRoot: string, bookId: string): string {
	const normalizedId = bookId.trim();
	if (!normalizedId) throw new ValidationError("bookId must not be empty");
	if (isAbsolute(normalizedId)) throw new ValidationError("bookId must be relative");
	if (
		normalizedId === "." ||
		normalizedId === ".." ||
		normalizedId.includes("/") ||
		normalizedId.includes("\\")
	) {
		throw new ValidationError("bookId must be a single path segment");
	}
	const canonicalRoot = resolve(booksRoot);
	const bookRoot = resolve(canonicalRoot, normalizedId);
	if (!isContained(canonicalRoot, bookRoot) || bookRoot === canonicalRoot) {
		throw new ValidationError("bookRoot must remain inside booksRoot");
	}
	return bookRoot;
}

export async function resolveTrustedBookRoot(
	binding: BookRuntimeBindingRecord,
	booksRoot: string,
	allowExternalRoot = false,
): Promise<string | null> {
	if (!binding.bookId.trim() || !isAbsolute(binding.bookRoot)) return null;
	try {
		const canonicalBooksRoot = await realpath(resolve(booksRoot));
		const expectedBookRoot = deriveBookRoot(canonicalBooksRoot, binding.bookId);
		const [canonicalBookRoot, expectedCanonicalRoot, bookInfo] = await Promise.all([
			realpath(binding.bookRoot),
			realpath(expectedBookRoot).catch(() => null),
			stat(binding.bookRoot),
		]);
		if (!bookInfo.isDirectory()) return null;
		const isControlledRoot =
			canonicalBookRoot === expectedCanonicalRoot &&
			isContained(canonicalBooksRoot, canonicalBookRoot);
		if (isControlledRoot) return canonicalBookRoot;
		if (!allowExternalRoot) return null;
		return (await isMarkedExternalBookRoot(canonicalBookRoot, binding.bookId))
			? canonicalBookRoot
			: null;
	} catch {
		return null;
	}
}

async function resolveTrustedContext(
	binding: BookRuntimeBindingRecord,
	booksRoot: string,
	allowExternalRoot = false,
): Promise<RuntimeResolveContext | null> {
	const canonicalBookRoot = await resolveTrustedBookRoot(binding, booksRoot, allowExternalRoot);
	if (!canonicalBookRoot) return null;
	const canonicalBooksRoot = await realpath(resolve(booksRoot)).catch(() => null);
	if (!canonicalBooksRoot) return null;
	const resourceBinding = Object.freeze({
		kind: "novel.book",
		bookId: binding.bookId,
		root: canonicalBookRoot,
	});
	return Object.freeze({
		runtimeProjectId: binding.runtimeProjectId,
		projectRoot: canonicalBooksRoot,
		projectType: "novel",
		enabledPluginIds: Object.freeze(["novelfork-novel"]),
		resourceBindings: Object.freeze({ "novel.book": resourceBinding }),
	});
}

export class BookRuntimeBindingService {
	constructor(
		private readonly store: BookRuntimeBindingStore,
		private readonly booksRoot: string,
	) {}

	getByProjectId(runtimeProjectId: string): Promise<BookRuntimeBindingRecord | null> {
		return this.store.findByProjectId(runtimeProjectId);
	}

	getByBookId(bookId: string): Promise<BookRuntimeBindingRecord | null> {
		return this.store.findByBookId?.(bookId) ?? Promise.resolve(null);
	}

	getByNarratorId(narratorId: string): Promise<BookRuntimeBindingRecord | null> {
		return this.store.findByNarratorId(narratorId);
	}

	async resolveForNarrator(narratorId: string): Promise<RuntimeResolveContext | null> {
		if (!narratorId.trim()) return null;
		const binding = await this.store.findByNarratorId(narratorId);
		// An external root remains fail-closed unless its server-created book manifest
		// proves it belongs to this exact binding.
		return binding ? resolveTrustedContext(binding, this.booksRoot, true) : null;
	}

	async upsert(
		runtimeProjectId: string,
		bookId: string,
		createdByUserId: string | null,
		bookRootOverride?: string,
	): Promise<BookRuntimeBindingRecord> {
		if (!runtimeProjectId.trim()) throw new ValidationError("projectId must not be empty");
		if (!(await this.store.projectExists(runtimeProjectId))) {
			throw new ValidationError(`Project not found: ${runtimeProjectId}`);
		}
		const normalizedBookId = bookId.trim();
		const canonicalBooksRoot = await realpath(resolve(this.booksRoot)).catch(() => {
			throw new ValidationError("Controlled books root is not accessible");
		});
		const derivedBookRoot = deriveBookRoot(canonicalBooksRoot, normalizedBookId);
		const requestedRoot = bookRootOverride?.trim() || derivedBookRoot;
		const bookRoot = await realpath(requestedRoot).catch(() => {
			throw new ValidationError(`Book not found: ${normalizedBookId}`);
		});
		const bookInfo = await stat(bookRoot).catch(() => null);
		if (!bookInfo?.isDirectory() || (!bookRootOverride && !isContained(canonicalBooksRoot, bookRoot))) {
			throw new ValidationError(
				"Book root must be an existing directory inside the controlled books root",
			);
		}
		if (await this.store.bookBoundElsewhere(normalizedBookId, runtimeProjectId)) {
			throw new ValidationError("Book is already bound to another runtime project");
		}
		const existing = await this.store.findByProjectId(runtimeProjectId);
		const now = new Date().toISOString();
		return this.store.upsert({
			id: existing?.id ?? generateId(),
			runtimeProjectId,
			bookId: normalizedBookId,
			bookRoot,
			createdByUserId: existing?.createdByUserId ?? createdByUserId,
			createdAt: existing?.createdAt ?? now,
			updatedAt: now,
		});
	}

	deleteByProjectId(runtimeProjectId: string): Promise<boolean> {
		return this.store.deleteByProjectId(runtimeProjectId);
	}
}

export const drizzleBookRuntimeBindingStore: BookRuntimeBindingStore = {
	async findByProjectId(runtimeProjectId) {
		const productDb = getNovelForkProductDatabase();
		return (
			(await productDb.query.bookRuntimeBindings.findFirst({
				where: eq(bookRuntimeBindings.runtimeProjectId, runtimeProjectId),
			})) ?? null
		);
	},
	async findByBookId(bookId) {
		const productDb = getNovelForkProductDatabase();
		return (
			(await productDb.query.bookRuntimeBindings.findFirst({
				where: eq(bookRuntimeBindings.bookId, bookId),
			})) ?? null
		);
	},
	async findByNarratorId(narratorId) {
		const [row] = await runtimeDb
			.select({ runtimeProjectId: projects.id })
			.from(narrators)
			.innerJoin(chapters, eq(narrators.chapterId, chapters.id))
			.innerJoin(projects, eq(chapters.projectId, projects.id))
			.where(eq(narrators.id, narratorId))
			.limit(1);
		if (!row) return null;
		return this.findByProjectId(row.runtimeProjectId);
	},
	async projectExists(runtimeProjectId) {
		return Boolean(
			await runtimeDb.query.projects.findFirst({
				where: eq(projects.id, runtimeProjectId),
				columns: { id: true },
			}),
		);
	},
	async bookBoundElsewhere(bookId, runtimeProjectId) {
		const productDb = getNovelForkProductDatabase();
		return Boolean(
			await productDb.query.bookRuntimeBindings.findFirst({
				where: and(
					eq(bookRuntimeBindings.bookId, bookId),
					ne(bookRuntimeBindings.runtimeProjectId, runtimeProjectId),
				),
				columns: { id: true },
			}),
		);
	},
	async upsert(record) {
		const productDb = getNovelForkProductDatabase();
		const [saved] = await productDb
			.insert(bookRuntimeBindings)
			.values(record)
			.onConflictDoUpdate({
				target: bookRuntimeBindings.runtimeProjectId,
				set: { bookId: record.bookId, bookRoot: record.bookRoot, updatedAt: record.updatedAt },
			})
			.returning();
		return saved;
	},
	async deleteByProjectId(runtimeProjectId) {
		const productDb = getNovelForkProductDatabase();
		const deleted = await productDb
			.delete(bookRuntimeBindings)
			.where(eq(bookRuntimeBindings.runtimeProjectId, runtimeProjectId))
			.returning({ id: bookRuntimeBindings.id });
		return deleted.length > 0;
	},
};

export function getControlledBooksRoot(): string {
	const configuredRoot =
		process.env.NOVELFORK_BOOKS_ROOT ??
		process.env.NARRAFORK_BOOKS_ROOT ??
		(process.env.NOVELFORK_PROJECT_ROOT
			? resolve(process.env.NOVELFORK_PROJECT_ROOT, "books")
			: resolve(getDbDir(), "books"));
	return resolve(configuredRoot);
}

export const bookRuntimeBindingService = new BookRuntimeBindingService(
	drizzleBookRuntimeBindingStore,
	getControlledBooksRoot(),
);
