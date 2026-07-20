import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppError } from "@vivy1024/narrafork-runtime-bridge";
import type { BookRuntimeBindingRecord } from "./book-binding";
import {
	type BookRuntimeAccessDeps,
	resolveTrustedBookRuntimeAccess,
} from "./book-runtime-access";

let root: string;
let bookRoot: string;
let otherRoot: string;
let binding: BookRuntimeBindingRecord;
let project: { id: string; gitPath: string | null } | null;
let trustedRoot: string | null;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "novelfork-book-access-"));
	bookRoot = join(root, "book-a");
	otherRoot = join(root, "book-b");
	await Promise.all([mkdir(bookRoot), mkdir(otherRoot)]);
	binding = {
		id: "binding-a",
		runtimeProjectId: "project-a",
		bookId: "book-a",
		bookRoot,
		createdByUserId: "owner-a",
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
	};
	project = { id: "project-a", gitPath: bookRoot };
	trustedRoot = bookRoot;
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

function deps(): BookRuntimeAccessDeps {
	return {
		findBindingByBookId: async (bookId) => (bookId === binding.bookId ? binding : null),
		resolveBookRoot: async () => trustedRoot,
		findProjectById: async (projectId) => (project?.id === projectId ? project : null),
		canonicalizePath: (path) => realpath(path),
	};
}

async function expectNotFound(promise: Promise<unknown>): Promise<void> {
	try {
		await promise;
		throw new Error("Expected access resolution to fail");
	} catch (error) {
		expect(error).toBeInstanceOf(AppError);
		expect((error as AppError).statusCode).toBe(404);
	}
}

describe("trusted book Runtime project access", () => {
	test("allows the binding owner and administrators", async () => {
		const owner = await resolveTrustedBookRuntimeAccess(
			"book-a",
			{ userId: "owner-a", role: "user" },
			deps(),
		);
		const admin = await resolveTrustedBookRuntimeAccess(
			"book-a",
			{ userId: "admin-a", role: "admin" },
			deps(),
		);

		expect(owner).toEqual({
			runtimeProjectId: "project-a",
			bookRoot: await realpath(bookRoot),
		});
		expect(admin).toEqual(owner);
	});

	test("fails closed when no binding exists", async () => {
		await expectNotFound(
			resolveTrustedBookRuntimeAccess("missing-book", { userId: "owner-a", role: "user" }, deps()),
		);
	});

	test("hides bindings from non-owners", async () => {
		await expectNotFound(
			resolveTrustedBookRuntimeAccess("book-a", { userId: "other-user", role: "user" }, deps()),
		);
	});

	test("fails closed when the binding root is stale", async () => {
		trustedRoot = null;
		await expectNotFound(
			resolveTrustedBookRuntimeAccess("book-a", { userId: "owner-a", role: "user" }, deps()),
		);
	});

	test("fails closed when the Runtime project is missing", async () => {
		project = null;
		await expectNotFound(
			resolveTrustedBookRuntimeAccess("book-a", { userId: "owner-a", role: "user" }, deps()),
		);
	});

	test("fails closed when the project git path does not match the canonical book root", async () => {
		project = { id: "project-a", gitPath: otherRoot };
		await expectNotFound(
			resolveTrustedBookRuntimeAccess("book-a", { userId: "owner-a", role: "user" }, deps()),
		);
	});
});
