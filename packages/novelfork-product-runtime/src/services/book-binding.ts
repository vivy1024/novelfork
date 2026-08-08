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
import { and, eq, ne } from "@vivy1024/narrafork-runtime-bridge/runtime-db";
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
	const diagnosis = await diagnoseTrustedBookRoot(binding, booksRoot, allowExternalRoot);
	return diagnosis.reason === "trusted" ? diagnosis.bookRoot : null;
}

/**
 * Why a persisted binding is (not) trusted.
 *
 * `resolveTrustedBookRoot` deliberately collapses every failure into `null`,
 * which used to make a broken binding indistinguishable from "no binding at
 * all". That silence is what let a book narrator lose every novel domain tool
 * with no explanation: the model kept being told to maintain Jingwei while
 * `lore.write` had already been filtered out, so it fell back to rewriting
 * local files. Callers that surface diagnostics must use this function instead.
 */
export type TrustedBookRootDiagnosis =
	| { readonly reason: "trusted"; readonly bookRoot: string }
	| {
			readonly reason:
				| "empty-book-id"
				| "relative-book-root"
				| "book-root-missing"
				| "book-root-not-directory"
				| "external-root-unmarked";
			readonly bookRoot: null;
	  };

export async function diagnoseTrustedBookRoot(
	binding: BookRuntimeBindingRecord,
	booksRoot: string,
	allowExternalRoot = false,
): Promise<TrustedBookRootDiagnosis> {
	if (!binding.bookId.trim()) return { reason: "empty-book-id", bookRoot: null };
	if (!isAbsolute(binding.bookRoot)) return { reason: "relative-book-root", bookRoot: null };
	try {
		const canonicalBooksRoot = await realpath(resolve(booksRoot));
		const expectedBookRoot = deriveBookRoot(canonicalBooksRoot, binding.bookId);
		const [canonicalBookRoot, expectedCanonicalRoot, bookInfo] = await Promise.all([
			realpath(binding.bookRoot),
			realpath(expectedBookRoot).catch(() => null),
			stat(binding.bookRoot),
		]);
		if (!bookInfo.isDirectory()) return { reason: "book-root-not-directory", bookRoot: null };
		const isControlledRoot =
			canonicalBookRoot === expectedCanonicalRoot &&
			isContained(canonicalBooksRoot, canonicalBookRoot);
		if (isControlledRoot) return { reason: "trusted", bookRoot: canonicalBookRoot };
		if (!allowExternalRoot) return { reason: "external-root-unmarked", bookRoot: null };
		return (await isMarkedExternalBookRoot(canonicalBookRoot, binding.bookId))
			? { reason: "trusted", bookRoot: canonicalBookRoot }
			: { reason: "external-root-unmarked", bookRoot: null };
	} catch {
		// realpath/stat failure means the recorded root no longer resolves on disk.
		return { reason: "book-root-missing", bookRoot: null };
	}
}

/** Author-facing explanation: what happened / why it matters / what to do. */
export function explainTrustedBookRootFailure(
	reason: Exclude<TrustedBookRootDiagnosis["reason"], "trusted">,
	binding: Pick<BookRuntimeBindingRecord, "bookId" | "bookRoot">,
): string {
	const where = `书籍 ${binding.bookId}（记录根目录：${binding.bookRoot}）`;
	switch (reason) {
		case "empty-book-id":
			return `${where} 的绑定记录缺少 bookId，服务端无法解析可信书籍上下文，因此本会话不会加载任何小说领域工具。请在书籍设置中重新绑定该书。`;
		case "relative-book-root":
			return `${where} 的绑定记录保存的是相对路径，可信根解析要求绝对路径，因此本会话不会加载任何小说领域工具。请重新绑定该书以写入规范化的绝对路径。`;
		case "book-root-missing":
			return `${where} 的目录当前无法访问（可能已被移动、重命名或所在磁盘未挂载），因此本会话不会加载任何小说领域工具。请把目录恢复到记录路径，或重新绑定到新位置。`;
		case "book-root-not-directory":
			return `${where} 的记录路径存在但不是目录，因此本会话不会加载任何小说领域工具。请检查该路径并重新绑定该书。`;
		case "external-root-unmarked":
			return `${where} 位于受控 books 根之外，且其 book.json 缺少服务端写入的可信标记（${EXTERNAL_BOOK_WORKSPACE_MARKER}=true 且 id 与 bookId 一致），因此本会话不会加载任何小说领域工具。请在产品内重新绑定该外部书籍目录，由服务端补写标记。`;
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

	/**
	 * Why this narrator has (or lacks) a trusted book context.
	 *
	 * `resolveForNarrator` returns `null` both when a narrator is simply not
	 * bound to a book and when a real binding failed its trust check. Only the
	 * second case is a defect the author must fix, and it is the one that
	 * silently strips every novel domain tool from a book narrator. Callers that
	 * report diagnostics must use this instead of interpreting a bare `null`.
	 */
	async diagnoseForNarrator(narratorId: string): Promise<
		| { readonly status: "unbound" }
		| { readonly status: "trusted"; readonly binding: BookRuntimeBindingRecord }
		| {
				readonly status: "untrusted";
				readonly binding: BookRuntimeBindingRecord;
				readonly reason: Exclude<TrustedBookRootDiagnosis["reason"], "trusted">;
				readonly explanation: string;
		  }
	> {
		if (!narratorId.trim()) return { status: "unbound" };
		const binding = await this.store.findByNarratorId(narratorId);
		if (!binding) return { status: "unbound" };
		const diagnosis = await diagnoseTrustedBookRoot(binding, this.booksRoot, true);
		if (diagnosis.reason === "trusted") return { status: "trusted", binding };
		return {
			status: "untrusted",
			binding,
			reason: diagnosis.reason,
			explanation: explainTrustedBookRootFailure(diagnosis.reason, binding),
		};
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
