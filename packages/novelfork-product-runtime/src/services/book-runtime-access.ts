import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { db, NotFoundError, projects } from "@vivy1024/narrafork-runtime-bridge";
import { eq } from "@vivy1024/narrafork-runtime-bridge/runtime-db";
import { ownsBookBinding } from "../policy/book-product-policy";
import {
	type BookRuntimeBindingRecord,
	bookRuntimeBindingService,
	getControlledBooksRoot,
	resolveTrustedBookRoot,
} from "./book-binding";

export type BookRuntimeAccessActor = { userId: string; role: "admin" | "user" };

export interface TrustedBookRuntimeAccess {
	runtimeProjectId: string;
	bookRoot: string;
}

export interface BookRuntimeAccessDeps {
	findBindingByBookId(bookId: string): Promise<BookRuntimeBindingRecord | null>;
	resolveBookRoot(binding: BookRuntimeBindingRecord): Promise<string | null>;
	findProjectById(projectId: string): Promise<{ id: string; gitPath: string | null } | null>;
	canonicalizePath(path: string): Promise<string>;
}

function comparableCanonicalPath(path: string): string {
	const normalized = resolve(path);
	return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

export function sameCanonicalPath(left: string, right: string): boolean {
	return comparableCanonicalPath(left) === comparableCanonicalPath(right);
}

export const defaultBookRuntimeAccessDeps: BookRuntimeAccessDeps = {
	findBindingByBookId(bookId) {
		return bookRuntimeBindingService.getByBookId(bookId);
	},
	resolveBookRoot(binding) {
		// Bound product books may live under the controlled books root or under a
		// previously marked external workspace (novelforkExternalWorkspace). The
		// marker check inside resolveTrustedBookRoot still rejects unmarked paths.
		return resolveTrustedBookRoot(binding, getControlledBooksRoot(), true);
	},
	async findProjectById(projectId) {
		return (
			(await db.query.projects.findFirst({
				where: eq(projects.id, projectId),
				columns: { id: true, gitPath: true },
			})) ?? null
		);
	},
	canonicalizePath(path) {
		return realpath(resolve(path));
	},
};

/**
 * Resolve a browser-visible book id into the server-owned Runtime project and
 * canonical book root. Every invalid ownership, binding, filesystem, or project
 * relationship is deliberately reported as the same 404 product result.
 */
export async function resolveTrustedBookRuntimeAccess(
	bookId: string,
	actor: BookRuntimeAccessActor,
	deps: BookRuntimeAccessDeps = defaultBookRuntimeAccessDeps,
): Promise<TrustedBookRuntimeAccess> {
	const normalizedBookId = bookId.trim();
	const notFound = () => new NotFoundError("Book", normalizedBookId || bookId);
	if (!normalizedBookId) throw notFound();

	const binding = await deps.findBindingByBookId(normalizedBookId);
	if (
		!binding ||
		binding.bookId !== normalizedBookId ||
		!ownsBookBinding(actor, binding.createdByUserId)
	) {
		throw notFound();
	}

	const bookRoot = await deps.resolveBookRoot(binding);
	if (!bookRoot) throw notFound();

	const project = await deps.findProjectById(binding.runtimeProjectId);
	if (!project || project.id !== binding.runtimeProjectId || !project.gitPath?.trim()) {
		throw notFound();
	}

	const [canonicalBookRoot, canonicalGitPath] = await Promise.all([
		deps.canonicalizePath(bookRoot).catch(() => null),
		deps.canonicalizePath(project.gitPath).catch(() => null),
	]);
	if (
		!canonicalBookRoot ||
		!canonicalGitPath ||
		!sameCanonicalPath(canonicalBookRoot, canonicalGitPath)
	) {
		throw notFound();
	}

	return Object.freeze({
		runtimeProjectId: binding.runtimeProjectId,
		bookRoot: canonicalBookRoot,
	});
}
