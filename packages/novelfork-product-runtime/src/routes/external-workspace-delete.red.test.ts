import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { AppError } from "@vivy1024/narrafork-runtime-bridge";
import { novelForkProductIntegration } from "../index";
import { initializeNovelRuntimeStorage } from "../adapters/storage";

// S1.4: book deletion removes the book workspace directory only when the user asks for it
// (deleteWorkspace=true, the checkbox "同时删除 workspace 目录"), and always removes the
// narrator binding. The default delete only unbinds and keeps the user's files. A git
// workspace is used so the path reaches the real `rm` in book-provision.ts.
const owner = { sub: `external-delete-owner-${crypto.randomUUID()}`, role: "user" as const };
const SOURCE_TEXT = "user source, must survive deletion\n";

function productApp(user: typeof owner) {
	const app = new Hono<{ Variables: { user: typeof owner } }>();
	const { mountAuthenticatedGuards, mountAuthenticatedRoutes } = novelForkProductIntegration;
	if (!mountAuthenticatedGuards || !mountAuthenticatedRoutes) {
		throw new Error("NovelFork product integration did not provide authenticated HTTP mounts");
	}
	app.use("*", async (c, next) => { c.set("user", user as never); await next(); });
	mountAuthenticatedGuards(app);
	mountAuthenticatedRoutes(app);
	app.onError((error, c) => error instanceof AppError ? c.json({ code: error.code, error: error.message }, error.statusCode as never) : c.json({ error: String(error) }, 500));
	return app;
}

async function git(cwd: string, args: string[]): Promise<void> {
	const proc = Bun.spawn(["git", ...args], { cwd, stdout: "ignore", stderr: "ignore" });
	await proc.exited;
}

/** A fresh git workspace per test, so one test's binding cannot leak into another. */
async function makeExternalWorkspace(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "novelfork-s14-external-"));
	await mkdir(join(root, "jingwei"), { recursive: true });
	await writeFile(join(root, "source-marker.md"), SOURCE_TEXT, "utf8");
	await git(root, ["init", "-q"]);
	await git(root, ["config", "user.email", "s14@example.com"]);
	await git(root, ["config", "user.name", "s14"]);
	await git(root, ["add", "."]);
	await git(root, ["commit", "-q", "-m", "s14 fixture"]);
	return root;
}

const createdRoots: string[] = [];

beforeAll(() => {
	initializeNovelRuntimeStorage();
});

afterAll(async () => {
	for (const root of createdRoots) await rm(root, { recursive: true, force: true });
});

describe("S1.4 book deletion removes only the book workspace and narrator binding", () => {
	async function createExternalBook(app: ReturnType<typeof productApp>): Promise<{ bookId: string; root: string }> {
		const root = await makeExternalWorkspace();
		createdRoots.push(root);
		const create = await app.request("/api/novelfork/books", {
			method: "POST",
			headers: { "content-type": "application/json", "Idempotency-Key": `s14-${crypto.randomUUID()}` },
			body: JSON.stringify({
				title: "S1.4 external git workspace",
				projectInit: { source: "existing", workspaceRoot: root, managedByNovelFork: false },
			}),
		});
		const created = (await create.json()) as { bookId?: string; state?: string };
		expect({ status: create.status, state: created.state }).toMatchObject({ status: 201, state: "ready" });
		if (!created.bookId) throw new Error("external workspace book was not created");
		return { bookId: created.bookId, root };
	}

	test("default delete unbinds and keeps the external workspace", async () => {
		const app = productApp(owner);
		const { bookId, root } = await createExternalBook(app);

		const remove = await app.request(`/api/novelfork/books/${bookId}`, { method: "DELETE" });
		expect(remove.status).toBe(200);

		expect(await readFile(join(root, "source-marker.md"), "utf8")).toBe(SOURCE_TEXT);
	});

	test("deleteWorkspace=true removes the book workspace directory and nothing beside it", async () => {
		const app = productApp(owner);
		const { bookId, root } = await createExternalBook(app);

		// A sibling of the book's own directory, outside the book: it must survive the delete.
		const sibling = await makeExternalWorkspace();
		createdRoots.push(sibling);
		const siblingMarker = join(sibling, "source-marker.md");

		const remove = await app.request(`/api/novelfork/books/${bookId}?deleteWorkspace=true`, { method: "DELETE" });
		expect({ status: remove.status, body: await remove.clone().text() }).toMatchObject({ status: 200 });

		await expect(access(root)).rejects.toThrow();
		expect(await readFile(siblingMarker, "utf8")).toBe(SOURCE_TEXT);
	});
});
