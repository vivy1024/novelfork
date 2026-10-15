/**
 * 书删不掉（v0.0.4）：Runtime 删项目前要用 `git rev-parse --git-common-dir` 核实资源保护，
 * 受控目录下的书不是 git 仓库，删书必然 409。
 *
 * 修法（作者拍板）：
 * 1. 建书时对受控目录按 NarraFork 的 init 口径初始化 git（新建、复制导入、档案导入都覆盖）；
 *    git 不可用时建书照常成功，结果里带说明。
 * 2. 旧的受控书删除前补做初始化；补做失败时与外部目录同样兜底。
 * 3. 外部目录不碰：不是 git 仓库时只把 Runtime 项目的 gitPath 置空再删，目录保持原样、不出现 .git。
 * 4. 删书步骤保持可重入。
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { AppError } from "@vivy1024/narrafork-runtime-bridge";
import { getStorageDatabase } from "@vivy1024/novelfork-core";
import { novelForkProductIntegration } from "../index";
import { initializeNovelRuntimeStorage } from "../adapters/storage";

const owner = { sub: `book-git-owner-${crypto.randomUUID()}`, role: "user" as const };
const createdRoots: string[] = [];

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

type App = ReturnType<typeof productApp>;

/** 测试自己调 git：清掉继承的 GIT_DIR 等变量，避免在 git 钩子环境里误操作别的仓库。 */
async function git(cwd: string, args: string[]): Promise<{ code: number; out: string }> {
	const proc = Bun.spawn(["git", "-C", cwd, ...args], {
		env: { ...process.env, GIT_DIR: undefined, GIT_WORK_TREE: undefined, GIT_INDEX_FILE: undefined, GIT_COMMON_DIR: undefined },
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
	});
	const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
	return { code, out: out.trim() };
}

async function exists(path: string): Promise<boolean> {
	return access(path).then(() => true, () => false);
}

/** 书根自己就是 git 仓库的顶层（不是借了某个上级仓库）。 */
async function isGitTopLevel(root: string): Promise<boolean> {
	const result = await git(root, ["rev-parse", "--show-toplevel"]);
	if (result.code !== 0) return false;
	return (await realpath(result.out)) === (await realpath(root));
}

/** 目录的逐字节快照：相对路径 → 内容哈希；目录记为 "<dir>"。 */
async function snapshot(root: string): Promise<Record<string, string>> {
	const result: Record<string, string> = {};
	const walk = async (relativeDir: string): Promise<void> => {
		const entries = await readdir(join(root, relativeDir), { withFileTypes: true });
		for (const entry of entries) {
			const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
			if (entry.isDirectory()) {
				result[`${relativePath}/`] = "<dir>";
				await walk(relativePath);
			} else {
				result[relativePath] = createHash("sha256").update((await readFile(join(root, relativePath))).toString("base64")).digest("hex");
			}
		}
	};
	await walk("");
	return result;
}

function countRows(table: string, where = "1 = 1", ...params: unknown[]): number {
	return (getStorageDatabase().sqlite.prepare(`SELECT COUNT(*) AS count FROM "${table}" WHERE ${where}`).get(...(params as never[])) as { count: number } | undefined)?.count ?? 0;
}

function controlledRoot(bookId: string): string {
	const booksRoot = process.env.NOVELFORK_BOOKS_ROOT;
	if (!booksRoot) throw new Error("test-env must set NOVELFORK_BOOKS_ROOT");
	return join(booksRoot, bookId);
}

async function createBook(app: App, body: Record<string, unknown>): Promise<{ status: number; json: Record<string, unknown> }> {
	const response = await app.request("/api/novelfork/books", {
		method: "POST",
		headers: { "content-type": "application/json", "Idempotency-Key": `book-git-${crypto.randomUUID()}` },
		body: JSON.stringify(body),
	});
	return { status: response.status, json: (await response.json()) as Record<string, unknown> };
}

async function createReadyBook(app: App, body: Record<string, unknown>): Promise<string> {
	const created = await createBook(app, body);
	expect({ status: created.status, state: created.json.state, error: created.json.error ?? null }).toMatchObject({ status: 201, state: "ready" });
	return created.json.bookId as string;
}

async function deleteBook(app: App, bookId: string): Promise<{ status: number; body: string }> {
	const response = await app.request(`/api/novelfork/books/${encodeURIComponent(bookId)}`, { method: "DELETE" });
	return { status: response.status, body: await response.text() };
}

async function tempDir(prefix: string): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), prefix));
	createdRoots.push(root);
	return root;
}

/** 让本进程找不到 git：把 PATH 指向一个空目录。 */
async function withoutGit<T>(run: () => Promise<T>): Promise<T> {
	const emptyBin = await tempDir("novelfork-no-git-bin-");
	const previous = { PATH: process.env.PATH, Path: process.env.Path };
	process.env.PATH = emptyBin;
	if (previous.Path !== undefined) process.env.Path = emptyBin;
	try {
		return await run();
	} finally {
		process.env.PATH = previous.PATH;
		if (previous.Path !== undefined) process.env.Path = previous.Path;
	}
}

/** 在产品库清理那一步注入一次失败：Runtime 项目已删、绑定与建书记录还在。 */
async function withPurgeFailure<T>(bookId: string, run: () => Promise<T>): Promise<T> {
	const trigger = `nf_test_block_book_delete_${crypto.randomUUID().replaceAll("-", "")}`;
	getStorageDatabase().sqlite.exec(
		`CREATE TRIGGER "${trigger}" BEFORE DELETE ON "book" WHEN old.id = '${bookId}' BEGIN SELECT RAISE(ABORT, 'injected purge failure'); END;`,
	);
	try {
		return await run();
	} finally {
		getStorageDatabase().sqlite.exec(`DROP TRIGGER IF EXISTS "${trigger}"`);
	}
}

beforeAll(() => {
	initializeNovelRuntimeStorage();
});

afterAll(async () => {
	for (const root of createdRoots) await rm(root, { recursive: true, force: true });
});

describe("建书：受控目录按 NarraFork init 口径初始化为 git 仓库", () => {
	test("新建受控书：书根是仓库顶层，HEAD 在 main 且有初始提交，.gitignore 含 Runtime 目录", async () => {
		const app = productApp(owner);
		const created = await createBook(app, { title: `git-new-${crypto.randomUUID()}` });
		expect({ status: created.status, state: created.json.state }).toMatchObject({ status: 201, state: "ready" });
		expect(created.json.warnings).toBeUndefined();
		const root = controlledRoot(created.json.bookId as string);

		expect(await isGitTopLevel(root)).toBe(true);
		expect((await git(root, ["symbolic-ref", "--short", "HEAD"])).out).toBe("main");
		const log = await git(root, ["log", "--format=%s"]);
		expect(log.code).toBe(0);
		expect(log.out.split("\n")).toContain("Initial commit");
		const gitignore = await readFile(join(root, ".gitignore"), "utf8");
		expect(gitignore).toContain(".narrafork/");
		expect(gitignore).toContain(".worktrees/");
		// 书的内容不进初始提交（与 NarraFork init 一致：只提交 .gitignore）。
		expect((await git(root, ["ls-files"])).out.split("\n").filter(Boolean)).toEqual([".gitignore"]);

		expect((await deleteBook(app, created.json.bookId as string)).status).toBe(200);
		expect(await exists(root)).toBe(false);
	});

	test("复制导入（importExisting）：拷进受控根的书是仓库，源目录不出现 .git、内容不变", async () => {
		const app = productApp(owner);
		const source = await tempDir("novelfork-git-import-src-");
		const sourceId = `git-import-${crypto.randomUUID().slice(0, 8)}`;
		await mkdir(join(source, "chapters"), { recursive: true });
		await writeFile(join(source, "book.json"), `${JSON.stringify({ id: sourceId, title: "复制导入的旧书" })}\n`, "utf8");
		await writeFile(join(source, "chapters", "index.json"), "[]\n", "utf8");
		const before = await snapshot(source);

		const imported = await app.request("/api/novelfork/books/import", {
			method: "POST",
			headers: { "content-type": "application/json", "Idempotency-Key": `book-git-import-${crypto.randomUUID()}` },
			body: JSON.stringify({ sourcePath: source }),
		});
		const body = (await imported.json()) as { bookId: string; state: string };
		expect({ status: imported.status, state: body.state }).toMatchObject({ status: 201, state: "ready" });
		expect(await isGitTopLevel(controlledRoot(body.bookId))).toBe(true);
		expect(await exists(join(source, ".git"))).toBe(false);
		expect(await snapshot(source)).toEqual(before);

		expect((await deleteBook(app, body.bookId)).status).toBe(200);
		expect(await exists(controlledRoot(body.bookId))).toBe(false);
	});

	test("档案导入：导入为新书后书根是仓库", async () => {
		const app = productApp(owner);
		const sourceBookId = await createReadyBook(app, { title: `git-archive-src-${crypto.randomUUID()}` });
		const exported = await app.request(`/api/books/${encodeURIComponent(sourceBookId)}/archive`);
		expect(exported.status).toBe(200);
		const imported = await app.request("/api/novelfork/book-archives/import", {
			method: "POST",
			headers: { "content-type": "application/zip", "Idempotency-Key": `book-git-archive-${crypto.randomUUID()}` },
			body: await exported.arrayBuffer(),
		});
		const body = (await imported.json()) as { operation: { bookId: string; state: string } };
		expect({ status: imported.status, state: body.operation?.state }).toMatchObject({ status: 201, state: "ready" });
		expect(await isGitTopLevel(controlledRoot(body.operation.bookId))).toBe(true);

		for (const bookId of [sourceBookId, body.operation.bookId]) {
			expect((await deleteBook(app, bookId)).status).toBe(200);
			expect(await exists(controlledRoot(bookId))).toBe(false);
		}
	});

	test("外部目录建书不碰 git：source=new 与 source=existing 的普通目录里都不出现 .git", async () => {
		const app = productApp(owner);
		const fresh = await tempDir("novelfork-git-ext-new-");
		const existing = await tempDir("novelfork-git-ext-existing-");
		await writeFile(join(existing, "notes.md"), "作者自己的笔记\n", "utf8");

		const newBook = await createReadyBook(app, {
			title: `git-ext-new-${crypto.randomUUID()}`,
			projectInit: { source: "new", workspaceRoot: fresh, managedByNovelFork: false },
		});
		const existingBook = await createReadyBook(app, {
			title: `git-ext-existing-${crypto.randomUUID()}`,
			projectInit: { source: "existing", workspaceRoot: existing, managedByNovelFork: false },
		});
		expect(await exists(join(fresh, ".git"))).toBe(false);
		expect(await exists(join(existing, ".git"))).toBe(false);
		expect(await exists(join(fresh, ".gitignore"))).toBe(false);
		expect(await exists(join(existing, ".gitignore"))).toBe(false);

		for (const bookId of [newBook, existingBook]) expect((await deleteBook(app, bookId)).status).toBe(200);
	});

	test("git 不可用时建书照常成功，结果里带三段式说明；删书仍能完成并删掉受控目录", async () => {
		const app = productApp(owner);
		const { created, removed, root } = await withoutGit(async () => {
			const created = await createBook(app, { title: `git-missing-${crypto.randomUUID()}` });
			const root = controlledRoot(created.json.bookId as string);
			const hadGit = await exists(join(root, ".git"));
			const removed = await deleteBook(app, created.json.bookId as string);
			return { created: { ...created, hadGit }, removed, root };
		});
		expect({ status: created.status, state: created.json.state }).toMatchObject({ status: 201, state: "ready" });
		expect(created.hadGit).toBe(false);
		const warnings = created.json.warnings as Array<{ code: string; explanation: string }> | undefined;
		expect(warnings?.map((warning) => warning.code)).toEqual(["BOOK_GIT_INIT_FAILED"]);
		expect(warnings?.[0]?.explanation).toContain("git");
		expect(warnings?.[0]?.explanation.length ?? 0).toBeGreaterThan(40);

		expect({ status: removed.status, body: removed.body }).toMatchObject({ status: 200 });
		expect(await exists(root)).toBe(false);
	});
});

describe("删书：旧受控书补做初始化，外部目录只解绑", () => {
	test("受控旧书（v0.0.4 建的，没有 .git）删除成功，目录被删", async () => {
		const app = productApp(owner);
		const bookId = await createReadyBook(app, { title: `git-legacy-${crypto.randomUUID()}` });
		const root = controlledRoot(bookId);
		// 模拟修复前建的书：书根不是 git 仓库。
		await rm(join(root, ".git"), { recursive: true, force: true });
		await rm(join(root, ".gitignore"), { force: true });
		expect(await isGitTopLevel(root)).toBe(false);

		const removed = await deleteBook(app, bookId);
		expect({ status: removed.status, body: removed.body }).toMatchObject({ status: 200 });
		expect(await exists(root)).toBe(false);
		expect(countRows("book_provision_operations", "book_id = ?", bookId)).toBe(0);
		expect(countRows("book_runtime_bindings", "book_id = ?", bookId)).toBe(0);
	});

	test("外部非 git 目录的书删除成功：目录内容逐字节不变，且始终没有 .git", async () => {
		const app = productApp(owner);
		const workspace = await tempDir("novelfork-git-ext-plain-");
		await writeFile(join(workspace, "notes.md"), "作者自己的笔记，删书后必须原样保留。\n", "utf8");
		const bookId = await createReadyBook(app, {
			title: `git-ext-plain-${crypto.randomUUID()}`,
			projectInit: { source: "existing", workspaceRoot: workspace, managedByNovelFork: false },
		});
		const before = await snapshot(workspace);
		expect(Object.keys(before).some((path) => path.startsWith(".git"))).toBe(false);

		const removed = await deleteBook(app, bookId);
		expect({ status: removed.status, body: removed.body }).toMatchObject({ status: 200 });
		expect(await snapshot(workspace)).toEqual(before);
		expect(await exists(join(workspace, ".git"))).toBe(false);
		expect(countRows("book_provision_operations", "book_id = ?", bookId)).toBe(0);
		expect(countRows("book_runtime_bindings", "book_id = ?", bookId)).toBe(0);
	});

	test("外部 git 仓库的书删除成功：提交、索引与工作区都不变", async () => {
		const app = productApp(owner);
		const repo = await tempDir("novelfork-git-ext-repo-");
		await writeFile(join(repo, "notes.md"), "仓库里的笔记\n", "utf8");
		await git(repo, ["init", "-q"]);
		await git(repo, ["-c", "user.email=t@example.com", "-c", "user.name=t", "add", "."]);
		await git(repo, ["-c", "user.email=t@example.com", "-c", "user.name=t", "-c", "commit.gpgsign=false", "commit", "-q", "-m", "fixture"]);
		const bookId = await createReadyBook(app, {
			title: `git-ext-repo-${crypto.randomUUID()}`,
			projectInit: { source: "existing", workspaceRoot: repo, managedByNovelFork: false },
		});
		const before = {
			head: (await git(repo, ["rev-parse", "HEAD"])).out,
			commits: (await git(repo, ["rev-list", "--all", "--count"])).out,
			status: (await git(repo, ["status", "--porcelain", "--untracked-files=all"])).out,
			files: await snapshot(repo),
		};

		const removed = await deleteBook(app, bookId);
		expect({ status: removed.status, body: removed.body }).toMatchObject({ status: 200 });
		const files = await snapshot(repo);
		// .git 内部的 index/日志等可能被 git 自己刷新，只比较工作区文件。
		const worktreeOnly = (entries: Record<string, string>) =>
			Object.fromEntries(Object.entries(entries).filter(([path]) => !path.startsWith(".git/")));
		expect({
			head: (await git(repo, ["rev-parse", "HEAD"])).out,
			commits: (await git(repo, ["rev-list", "--all", "--count"])).out,
			status: (await git(repo, ["status", "--porcelain", "--untracked-files=all"])).out,
			files: worktreeOnly(files),
		}).toEqual({ ...before, files: worktreeOnly(before.files) });
	});

	test("外部目录在第一次删除前就被移走：仍能删除成功，只解绑并清数据", async () => {
		const app = productApp(owner);
		const workspace = await tempDir("novelfork-git-ext-gone-");
		const bookId = await createReadyBook(app, {
			title: `git-ext-gone-${crypto.randomUUID()}`,
			projectInit: { source: "existing", workspaceRoot: workspace, managedByNovelFork: false },
		});
		await rm(workspace, { recursive: true, force: true });

		const removed = await deleteBook(app, bookId);
		expect({ status: removed.status, body: removed.body }).toMatchObject({ status: 200 });
		expect(countRows("book_provision_operations", "book_id = ?", bookId)).toBe(0);
		expect(await exists(workspace)).toBe(false);
	});

	test("中途失败可重试：受控旧书第一次删到产品库清理失败，再删一次能做完并删掉目录", async () => {
		const app = productApp(owner);
		const bookId = await createReadyBook(app, { title: `git-legacy-retry-${crypto.randomUUID()}` });
		const root = controlledRoot(bookId);
		await rm(join(root, ".git"), { recursive: true, force: true });
		await rm(join(root, ".gitignore"), { force: true });

		const failed = await withPurgeFailure(bookId, () => deleteBook(app, bookId));
		expect(failed.status).toBeGreaterThanOrEqual(500);
		expect(countRows("book_runtime_bindings", "book_id = ?", bookId)).toBe(1);
		expect(await exists(join(root, "book.json"))).toBe(true);

		const retried = await deleteBook(app, bookId);
		expect({ status: retried.status, body: retried.body }).toMatchObject({ status: 200 });
		expect(await exists(root)).toBe(false);
		expect(countRows("book_provision_operations", "book_id = ?", bookId)).toBe(0);
	});

	test("中途失败可重试：外部非 git 目录第一次删到产品库清理失败，再删一次能做完，目录内容不变", async () => {
		const app = productApp(owner);
		const workspace = await tempDir("novelfork-git-ext-retry-");
		const bookId = await createReadyBook(app, {
			title: `git-ext-retry-${crypto.randomUUID()}`,
			projectInit: { source: "existing", workspaceRoot: workspace, managedByNovelFork: false },
		});
		const before = await snapshot(workspace);

		const failed = await withPurgeFailure(bookId, () => deleteBook(app, bookId));
		expect(failed.status).toBeGreaterThanOrEqual(500);
		expect(countRows("book_runtime_bindings", "book_id = ?", bookId)).toBe(1);

		const retried = await deleteBook(app, bookId);
		expect({ status: retried.status, body: retried.body }).toMatchObject({ status: 200 });
		expect(await snapshot(workspace)).toEqual(before);
		expect(await exists(join(workspace, ".git"))).toBe(false);
		expect(countRows("book_provision_operations", "book_id = ?", bookId)).toBe(0);
	});
});

describe("工作区文件树不暴露 .git", () => {
	test("受控书初始化为仓库后，文件树里没有 .git，也不能经文件网关改写 .git 下的文件", async () => {
		const app = productApp(owner);
		const bookId = await createReadyBook(app, { title: `git-tree-${crypto.randomUUID()}` });
		const base = `/api/books/${encodeURIComponent(bookId)}`;
		const tree = await app.request(`${base}/files/tree?depth=2&refresh=1`);
		const treeBody = (await tree.json()) as { tree?: Array<{ name: string }> };
		expect(tree.status).toBe(200);
		expect((treeBody.tree ?? []).map((entry) => entry.name)).toContain("book.json");
		expect((treeBody.tree ?? []).map((entry) => entry.name)).not.toContain(".git");

		const write = await app.request(`${base}/files`, {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ path: ".git/hooks/post-checkout", content: "#!/bin/sh\necho pwned\n" }),
		});
		expect(write.status).toBe(400);
		expect(await exists(join(controlledRoot(bookId), ".git", "hooks", "post-checkout"))).toBe(false);

		expect((await deleteBook(app, bookId)).status).toBe(200);
	});
});
