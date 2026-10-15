import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { access, copyFile, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { AppError } from "@vivy1024/narrafork-runtime-bridge";
import { getStorageDatabase, type StorageDatabase } from "@vivy1024/novelfork-core";
import { novelForkProductIntegration } from "../index";
import { initializeNovelRuntimeStorage } from "../adapters/storage";
import { ensureNarrativeMemorySchema } from "../../../novel-plugin/src/engine/narrative-memory/storage";
import { ensureSettlementLedgerSchema } from "../../../novel-plugin/src/engine/narrative-memory/settlement-idempotency";
import { ensureNarrativeWaveSchema } from "../../../novel-plugin/src/engine/narrative-memory/wave/tag-graph";
import { ensureDissectionStagingSchema } from "../../../novel-plugin/src/engine/jingwei/dissection-staging";

// 外部目录「遵循 NarraFork」：任何登录用户都能把作品指向任意绝对路径（~ 展开），没有允许根；
// 删书只删 NovelFork 自己管理的目录（物理上位于受控书籍根之内），外部目录只解绑。
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

const createdRoots: string[] = [];

/** 每个用例一个独立的 git 工作区，避免一个用例的绑定泄漏到另一个。 */
async function makeExternalWorkspace(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "novelfork-s14-external-"));
	createdRoots.push(root);
	await mkdir(join(root, "jingwei"), { recursive: true });
	await writeFile(join(root, "source-marker.md"), SOURCE_TEXT, "utf8");
	await git(root, ["init", "-q"]);
	await git(root, ["config", "user.email", "s14@example.com"]);
	await git(root, ["config", "user.name", "s14"]);
	await git(root, ["add", "."]);
	await git(root, ["commit", "-q", "-m", "s14 fixture"]);
	return root;
}

async function exists(path: string): Promise<boolean> {
	return access(path).then(() => true, () => false);
}

function storage(): StorageDatabase {
	return getStorageDatabase();
}

function countRows(table: string, where = "1 = 1", ...params: unknown[]): number {
	return (storage().sqlite.prepare(`SELECT COUNT(*) AS count FROM "${table}" WHERE ${where}`).get(...(params as never[])) as { count: number } | undefined)?.count ?? 0;
}

function bookIdTables(): string[] {
	return (storage().sqlite
		.prepare(`SELECT DISTINCT m.name AS name FROM sqlite_master m JOIN pragma_table_info(m.name) p WHERE m.type = 'table' AND p.name = 'book_id' ORDER BY m.name`)
		.all() as Array<{ name: string }>).map(({ name }) => name);
}

/**
 * 往表里插一行属于 bookId 的数据：只填 NOT NULL 且无默认值的列。造数只为验证删除，
 * 因此临时关掉外键与 CHECK，让每张表都能独立造出一行。
 */
let seedCounter = 1_000;
function seedRow(table: string, bookId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
	const columns = storage().sqlite
		.prepare(`SELECT name, type, "notnull" AS "notNull", dflt_value AS dflt, pk FROM pragma_table_info(?)`)
		.all(table) as Array<{ name: string; type: string; notNull: number; dflt: string | null; pk: number }>;
	const values: Record<string, unknown> = {};
	const singleIntegerPk = columns.filter((column) => column.pk > 0).length === 1;
	for (const column of columns) {
		if (column.name in overrides) { values[column.name] = overrides[column.name]; continue; }
		if (column.name === "book_id") { values.book_id = bookId; continue; }
		const type = column.type.toUpperCase();
		if (column.pk > 0 && singleIntegerPk && type.includes("INT")) continue;
		if (!column.notNull && column.pk === 0) continue;
		if (column.dflt !== null && column.pk === 0) continue;
		values[column.name] = type.includes("INT")
			? seedCounter++
			: type.includes("REAL") || type.includes("FLOA") || type.includes("DOUB")
				? 0.5
				: type.includes("BLOB")
					? new Uint8Array([1])
					: column.name.endsWith("_json")
						? "{}"
						: `seed-${table}-${column.name}-${crypto.randomUUID()}`;
	}
	const names = Object.keys(values);
	storage().sqlite
		.prepare(`INSERT INTO "${table}" (${names.map((name) => `"${name}"`).join(", ")}) VALUES (${names.map(() => "?").join(", ")})`)
		.run(...(names.map((name) => values[name]) as never[]));
	return values;
}

function withRelaxedConstraints<T>(run: () => T): T {
	storage().sqlite.exec("PRAGMA foreign_keys = OFF; PRAGMA ignore_check_constraints = ON;");
	try {
		return run();
	} finally {
		storage().sqlite.exec("PRAGMA ignore_check_constraints = OFF; PRAGMA foreign_keys = ON;");
	}
}

async function createBook(
	app: ReturnType<typeof productApp>,
	body: Record<string, unknown>,
): Promise<{ status: number; json: Record<string, unknown> }> {
	const response = await app.request("/api/novelfork/books", {
		method: "POST",
		headers: { "content-type": "application/json", "Idempotency-Key": `s14-${crypto.randomUUID()}` },
		body: JSON.stringify(body),
	});
	return { status: response.status, json: (await response.json()) as Record<string, unknown> };
}

async function createExternalBook(app: ReturnType<typeof productApp>): Promise<{ bookId: string; root: string }> {
	const root = await makeExternalWorkspace();
	const created = await createBook(app, {
		title: "S1.4 external git workspace",
		projectInit: { source: "existing", workspaceRoot: root, managedByNovelFork: false },
	});
	expect({ status: created.status, state: created.json.state }).toMatchObject({ status: 201, state: "ready" });
	if (typeof created.json.bookId !== "string") throw new Error("external workspace book was not created");
	return { bookId: created.json.bookId, root };
}

/** 临时把 NOVELFORK_EXTERNAL_WORKSPACE_ROOTS 设成一个与夹具无关的目录：若仍有允许根机制，夹具都会被拒。 */
async function withUnrelatedAllowedRoot<T>(run: () => Promise<T>): Promise<T> {
	const previous = process.env.NOVELFORK_EXTERNAL_WORKSPACE_ROOTS;
	process.env.NOVELFORK_EXTERNAL_WORKSPACE_ROOTS = join(tmpdir(), `nf-unrelated-allowed-root-${crypto.randomUUID()}`);
	try {
		return await run();
	} finally {
		if (previous === undefined) delete process.env.NOVELFORK_EXTERNAL_WORKSPACE_ROOTS;
		else process.env.NOVELFORK_EXTERNAL_WORKSPACE_ROOTS = previous;
	}
}

/** 临时把主目录换成临时目录，验证 ~ 展开而绝不触碰真实主目录。 */
async function withFakeHome<T>(run: (home: string) => Promise<T>): Promise<T> {
	const home = await mkdtemp(join(tmpdir(), "novelfork-fake-home-"));
	createdRoots.push(home);
	const previous = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
	process.env.HOME = home;
	process.env.USERPROFILE = home;
	try {
		return await run(home);
	} finally {
		for (const [key, value] of Object.entries(previous)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
}

beforeAll(() => {
	const initialized = initializeNovelRuntimeStorage();
	// 叙事记忆等表由领域代码按需建表；先建出来，「无残留」才覆盖到它们。
	ensureNarrativeMemorySchema(initialized);
	ensureSettlementLedgerSchema(initialized);
	ensureNarrativeWaveSchema(initialized);
	ensureDissectionStagingSchema(initialized);
});

afterAll(async () => {
	for (const root of createdRoots) await rm(root, { recursive: true, force: true });
});

describe("删书：只删 NovelFork 自己管理的目录，外部目录只解绑", () => {
	test("默认删除只解绑，外部目录保留", async () => {
		const app = productApp(owner);
		const { bookId, root } = await createExternalBook(app);

		const remove = await app.request(`/api/novelfork/books/${bookId}`, { method: "DELETE" });
		expect(remove.status).toBe(200);
		expect(await readFile(join(root, "source-marker.md"), "utf8")).toBe(SOURCE_TEXT);
	});

	test("deleteWorkspace=true 被忽略：外部目录照样保留", async () => {
		const app = productApp(owner);
		const { bookId, root } = await createExternalBook(app);
		const sibling = await makeExternalWorkspace();

		const remove = await app.request(`/api/novelfork/books/${bookId}?deleteWorkspace=true`, { method: "DELETE" });
		expect({ status: remove.status, body: await remove.clone().text() }).toMatchObject({ status: 200 });
		expect(await readFile(join(root, "source-marker.md"), "utf8")).toBe(SOURCE_TEXT);
		expect(await readFile(join(sibling, "source-marker.md"), "utf8")).toBe(SOURCE_TEXT);
	});

	test("判定按物理位置而非输入记录：记录被改成「受控」时，外部目录仍保留且能删除成功", async () => {
		const app = productApp(owner);
		const { bookId, root } = await createExternalBook(app);
		storage().sqlite
			.prepare(`UPDATE "book_provision_operations" SET input_json = ? WHERE book_id = ?`)
			.run(JSON.stringify({ title: "tampered", projectInit: { source: "none", managedByNovelFork: true } }), bookId);

		const remove = await app.request(`/api/novelfork/books/${bookId}`, { method: "DELETE" });
		expect({ status: remove.status, body: await remove.clone().text() }).toMatchObject({ status: 200 });
		expect(await readFile(join(root, "source-marker.md"), "utf8")).toBe(SOURCE_TEXT);
		expect(countRows("book_provision_operations", "book_id = ?", bookId)).toBe(0);
	});

	test("旧版 source=new + workspaceRoot 实际落在受控书籍根里的书：删除时目录一并删除，不留孤儿", async () => {
		const app = productApp(owner);
		const booksRoot = process.env.NOVELFORK_BOOKS_ROOT;
		if (!booksRoot) throw new Error("test-env must set NOVELFORK_BOOKS_ROOT");
		const bookId = `legacy-orphan-${crypto.randomUUID().slice(0, 8)}`;
		const legacyRoot = join(booksRoot, bookId);
		const created = await createBook(app, {
			bookId,
			title: "旧版落在受控目录的书",
			projectInit: { source: "new", workspaceRoot: legacyRoot, managedByNovelFork: false },
		});
		expect({ status: created.status, state: created.json.state }).toMatchObject({ status: 201, state: "ready" });
		expect(await exists(join(legacyRoot, "book.json"))).toBe(true);
		// Runtime 删项目前要用 git 核实资源保护，非 git 目录会被 409 拒绝（见下方「Runtime 拒绝」用例）；
		// 这里只验证目录归属判定，先把它变成 git 仓库。
		await git(legacyRoot, ["init", "-q"]);

		const remove = await app.request(`/api/novelfork/books/${bookId}`, { method: "DELETE" });
		expect({ status: remove.status, body: await remove.clone().text() }).toMatchObject({ status: 200 });
		expect(await exists(legacyRoot)).toBe(false);
	});

	test("删除后所有带 book_id 的表都没有这本书的行（含 workflow_runs、narrative_retrieval_log、narrative_context_vector）", async () => {
		const app = productApp(owner);
		const { bookId } = await createExternalBook(app);

		const tables = bookIdTables();
		for (const required of ["workflow_runs", "narrative_retrieval_log", "narrative_context_vector", "narrative_fact", "narrative_event"]) {
			expect(tables).toContain(required);
		}
		const controlTables = new Set(["book_provision_operations", "book_runtime_bindings"]);
		const seeded = withRelaxedConstraints(() => {
			const runId = `seed-run-${crypto.randomUUID()}`;
			for (const table of tables) {
				if (controlTables.has(table)) continue;
				seedRow(table, bookId, table === "workflow_runs" ? { id: runId } : {});
			}
			// 自身没有 book_id、只挂在父表下的子表也不能残留。
			seedRow("workflow_run_steps", bookId, { run_id: runId });
			return { runId };
		});
		const before = tables.map((name) => ({ name, count: countRows(name, "book_id = ?", bookId) }));
		expect(before.filter((row) => row.count === 0)).toEqual([]);
		expect(countRows("book", "id = ?", bookId)).toBe(1);
		expect(countRows("workflow_run_steps", "run_id = ?", seeded.runId)).toBe(1);

		const remove = await app.request(`/api/novelfork/books/${bookId}`, { method: "DELETE" });
		expect({ status: remove.status, body: await remove.clone().text() }).toMatchObject({ status: 200 });

		const leftovers = tables.map((name) => ({ name, count: countRows(name, "book_id = ?", bookId) })).filter((row) => row.count > 0);
		expect(leftovers).toEqual([]);
		expect(countRows("book", "id = ?", bookId)).toBe(0);
		expect(countRows("workflow_run_steps", "run_id = ?", seeded.runId)).toBe(0);
	});

	test("产品库清理失败时绑定与建书记录都还在，书仍在书架上，再删一次能把剩下的步骤做完", async () => {
		const app = productApp(owner);
		const { bookId, root } = await createExternalBook(app);
		const trigger = `nf_test_block_book_delete_${crypto.randomUUID().replaceAll("-", "")}`;
		expect(countRows("book", "id = ?", bookId)).toBe(1);
		storage().sqlite.exec(
			`CREATE TRIGGER "${trigger}" BEFORE DELETE ON "book" WHEN old.id = '${bookId}' BEGIN SELECT RAISE(ABORT, 'injected purge failure'); END;`,
		);
		try {
			const failed = await app.request(`/api/novelfork/books/${bookId}`, { method: "DELETE" });
			expect(failed.status).toBeGreaterThanOrEqual(500);
		} finally {
			storage().sqlite.exec(`DROP TRIGGER IF EXISTS "${trigger}"`);
		}

		const shelf = (await (await app.request("/api/novelfork/books")).json()) as { books: Array<{ id: string }> };
		expect(shelf.books.map((book) => book.id)).toContain(bookId);
		expect(countRows("book_runtime_bindings", "book_id = ?", bookId)).toBe(1);
		expect(countRows("book_provision_operations", "book_id = ?", bookId)).toBe(1);

		const retried = await app.request(`/api/novelfork/books/${bookId}`, { method: "DELETE" });
		expect({ status: retried.status, body: await retried.clone().text() }).toMatchObject({ status: 200 });
		expect(countRows("book", "id = ?", bookId)).toBe(0);
		expect(countRows("book_provision_operations", "book_id = ?", bookId)).toBe(0);
		expect(countRows("book_runtime_bindings", "book_id = ?", bookId)).toBe(0);
		expect(await readFile(join(root, "source-marker.md"), "utf8")).toBe(SOURCE_TEXT);
	});

	test("Runtime 拒绝删除项目时（书目录不是 git 仓库，无法核实资源保护）什么都不改：产品库数据、绑定与目录原样保留", async () => {
		const app = productApp(owner);
		const created = await createBook(app, { title: `s14-runtime-refuses-${crypto.randomUUID()}` });
		expect({ status: created.status, state: created.json.state }).toMatchObject({ status: 201, state: "ready" });
		const bookId = created.json.bookId as string;
		withRelaxedConstraints(() => {
			seedRow("workflow_runs", bookId);
			seedRow("narrative_fact", bookId);
		});

		const refused = await app.request(`/api/novelfork/books/${bookId}`, { method: "DELETE" });
		expect(refused.status).toBe(409);
		expect({
			book: countRows("book", "id = ?", bookId),
			runs: countRows("workflow_runs", "book_id = ?", bookId),
			facts: countRows("narrative_fact", "book_id = ?", bookId),
			binding: countRows("book_runtime_bindings", "book_id = ?", bookId),
			operation: countRows("book_provision_operations", "book_id = ?", bookId),
		}).toEqual({ book: 1, runs: 1, facts: 1, binding: 1, operation: 1 });
		expect(await exists(join(process.env.NOVELFORK_BOOKS_ROOT as string, bookId, "book.json"))).toBe(true);
	});

	test("删到一半（Runtime 项目已删）后目录又被用户移走：重试仍能完成，只解绑并清数据，不卡在「目录无法解析」", async () => {
		const app = productApp(owner);
		const { bookId, root } = await createExternalBook(app);
		const trigger = `nf_test_block_book_delete_${crypto.randomUUID().replaceAll("-", "")}`;
		storage().sqlite.exec(
			`CREATE TRIGGER "${trigger}" BEFORE DELETE ON "book" WHEN old.id = '${bookId}' BEGIN SELECT RAISE(ABORT, 'injected purge failure'); END;`,
		);
		try {
			expect((await app.request(`/api/novelfork/books/${bookId}`, { method: "DELETE" })).status).toBeGreaterThanOrEqual(500);
		} finally {
			storage().sqlite.exec(`DROP TRIGGER IF EXISTS "${trigger}"`);
		}
		const movedAway = `${root}-moved-away`;
		createdRoots.push(movedAway);
		await rename(root, movedAway);

		const remove = await app.request(`/api/novelfork/books/${bookId}`, { method: "DELETE" });
		expect({ status: remove.status, body: await remove.clone().text() }).toMatchObject({ status: 200 });
		expect(countRows("book_runtime_bindings", "book_id = ?", bookId)).toBe(0);
		expect(countRows("book_provision_operations", "book_id = ?", bookId)).toBe(0);
		expect(countRows("book", "id = ?", bookId)).toBe(0);
		expect(await readFile(join(movedAway, "source-marker.md"), "utf8")).toBe(SOURCE_TEXT);
	});
});

describe("外部目录遵循 NarraFork：不设允许根，~ 展开", () => {
	test("设置了 NOVELFORK_EXTERNAL_WORKSPACE_ROOTS 也不限制：任意已有目录都能绑定", async () => {
		const app = productApp(owner);
		await withUnrelatedAllowedRoot(async () => {
			const { root } = await createExternalBook(app);
			expect(await readFile(join(root, "source-marker.md"), "utf8")).toBe(SOURCE_TEXT);
		});
	});

	test("重新绑定到任意目录（不在任何允许根里）可以成功", async () => {
		const app = productApp(owner);
		await withUnrelatedAllowedRoot(async () => {
			const { bookId, root } = await createExternalBook(app);
			const moved = await mkdtemp(join(tmpdir(), "novelfork-s14-moved-"));
			createdRoots.push(moved);
			await copyFile(join(root, "book.json"), join(moved, "book.json"));

			const rebind = await app.request(`/api/novelfork/books/${bookId}/rebind-workspace`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ workspaceRoot: moved }),
			});
			expect({ status: rebind.status, body: await rebind.clone().text() }).toMatchObject({ status: 200 });
			expect(await rebind.json()).toMatchObject({ bookId, bookRoot: await realpath(moved) });
		});
	});

	test("新建作品的 workspaceRoot 以 ~ 开头时按 NarraFork 展开为主目录", async () => {
		const app = productApp(owner);
		await withFakeHome(async (home) => {
			const created = await createBook(app, {
				title: "主目录下的新书",
				projectInit: { source: "new", workspaceRoot: "~/novel-tilde", managedByNovelFork: false },
			});
			expect({ status: created.status, json: created.json }).toMatchObject({ status: 201, json: { state: "ready" } });
			expect(await exists(join(home, "novel-tilde", "book.json"))).toBe(true);
		});
	});

	test("重新绑定与导入的路径以 ~ 开头时同样展开", async () => {
		const app = productApp(owner);
		const { bookId, root } = await createExternalBook(app);
		await withFakeHome(async (home) => {
			await mkdir(join(home, "moved-book"), { recursive: true });
			await copyFile(join(root, "book.json"), join(home, "moved-book", "book.json"));
			const rebind = await app.request(`/api/novelfork/books/${bookId}/rebind-workspace`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ workspaceRoot: "~/moved-book" }),
			});
			expect({ status: rebind.status, body: await rebind.clone().text() }).toMatchObject({ status: 200 });
			expect(await rebind.json()).toMatchObject({ bookRoot: await realpath(join(home, "moved-book")) });

			const sourceId = `tilde-import-${crypto.randomUUID().slice(0, 8)}`;
			await mkdir(join(home, "import-src", "chapters"), { recursive: true });
			await writeFile(join(home, "import-src", "book.json"), `${JSON.stringify({ id: sourceId, title: "主目录下的旧书" })}\n`, "utf8");
			await writeFile(join(home, "import-src", "chapters", "index.json"), "[]\n", "utf8");
			const imported = await app.request("/api/novelfork/books/import", {
				method: "POST",
				headers: { "content-type": "application/json", "Idempotency-Key": `s14-tilde-import-${crypto.randomUUID()}` },
				body: JSON.stringify({ sourcePath: "~/import-src" }),
			});
			expect({ status: imported.status, body: await imported.clone().text() }).toMatchObject({ status: 201 });
		});
	});
});

describe("source=new 的数据安全检查（不是权限限制）", () => {
	test("目录里已有 book.json：建书前拒绝并建议改用「导入已有作品」，不留任何记录", async () => {
		const app = productApp(owner);
		const occupied = await makeExternalWorkspace();
		const existingBook = `${JSON.stringify({ id: "someone-elses-book", title: "已有作品" })}\n`;
		await writeFile(join(occupied, "book.json"), existingBook, "utf8");
		const before = { books: countRows("book"), operations: countRows("book_provision_operations") };

		const refused = await createBook(app, {
			title: `s14-occupied-${crypto.randomUUID()}`,
			projectInit: { source: "new", workspaceRoot: occupied, managedByNovelFork: false },
		});
		expect(refused.status).toBe(400);
		expect(refused.json).toMatchObject({ code: "WORKSPACE_ALREADY_A_BOOK", error: expect.stringContaining("导入已有作品") });
		expect({ books: countRows("book"), operations: countRows("book_provision_operations") }).toEqual(before);
		expect(await readFile(join(occupied, "book.json"), "utf8")).toBe(existingBook);
	});

	test("目录里已有 chapters/index.json：同样拒绝", async () => {
		const app = productApp(owner);
		const occupied = await makeExternalWorkspace();
		await mkdir(join(occupied, "chapters"), { recursive: true });
		await writeFile(join(occupied, "chapters", "index.json"), "[{\"number\":1}]\n", "utf8");
		const before = countRows("book_provision_operations");

		const refused = await createBook(app, {
			title: `s14-chapters-${crypto.randomUUID()}`,
			projectInit: { source: "new", workspaceRoot: occupied, managedByNovelFork: false },
		});
		expect(refused.status).toBe(400);
		expect(refused.json).toMatchObject({ code: "WORKSPACE_ALREADY_A_BOOK", error: expect.stringContaining("导入已有作品") });
		expect(countRows("book_provision_operations")).toBe(before);
		expect(await exists(join(occupied, "book.json"))).toBe(false);
	});

	test("非空的普通目录允许建书，已有文件（含同名脚手架文件）一个字节都不改", async () => {
		const app = productApp(owner);
		const occupied = await makeExternalWorkspace();
		const userRules = "# 我自己的写作规则\n\n不许被覆盖。\n";
		await mkdir(join(occupied, "story"), { recursive: true });
		await writeFile(join(occupied, "story", "book_rules.md"), userRules, "utf8");

		const created = await createBook(app, {
			title: `s14-nonempty-${crypto.randomUUID()}`,
			projectInit: { source: "new", workspaceRoot: occupied, managedByNovelFork: false },
		});
		expect({ status: created.status, json: created.json }).toMatchObject({ status: 201, json: { state: "ready" } });
		expect(await readFile(join(occupied, "source-marker.md"), "utf8")).toBe(SOURCE_TEXT);
		expect(await readFile(join(occupied, "story", "book_rules.md"), "utf8")).toBe(userRules);
		expect(await exists(join(occupied, "book.json"))).toBe(true);
		expect(await exists(join(occupied, "story", "current_state.md"))).toBe(true);
	});
});
